# --- START OF FILE main.py ---

import os
import sys
import logging
import argparse
import threading
import datetime
import time

# --- Cấu hình logging ban đầu ---
parser = argparse.ArgumentParser()
parser.add_argument('--debug', action='store_true', help='Enable debug logging')
args = parser.parse_args()
log_level = logging.DEBUG if args.debug else logging.INFO
logging.basicConfig(
    format='[%(asctime)s] [%(levelname)s] [%(threadName)s:%(filename)s %(lineno)d]: %(message)s',
    level=log_level
)
for logger_name in ["paho.mqtt", "urllib3", "socketio", "engineio"]:
    logging.getLogger(logger_name).setLevel(logging.WARNING)
logging.getLogger("transport").setLevel(logging.ERROR)
logging.getLogger("quickfaas").setLevel(logging.ERROR)
logging.info("Logging configured successfully.")

# --- Thiết lập đường dẫn và import các thư viện bên ngoài ---
real_script_path = os.path.realpath(__file__)
current_script_dir = os.path.dirname(real_script_path)
project_root = os.path.dirname(current_script_dir)
lib_path = os.path.join(project_root, 'lib')
if lib_path not in sys.path:
    sys.path.insert(0, lib_path)


# --- THAY ĐỔI: Import các đối tượng cốt lõi từ tệp riêng ---
import psutil
from app_instance import app, socketio
from flask import request
from flask_socketio import emit

import eventlet

# THAY ĐỔI: Thêm import json và publish
import json
from paho.mqtt import publish

# --- Import các module tùy chỉnh ---
from app_state import realtime_data_lock, realtime_data_cache, CALCULATION_RULES, CALCULATION_RULES_LOCK, CALC_TO_VIRTUAL_MAP, CALC_MAP_LOCK
from config_utils import process_and_save_config_data
from mqtt_utils import start_mqtt_subscriber
from api_utils import iec104_monitor_task
from db_utils import init_sqlite_db, db_writer_task, start_1min_downsampler, start_5min_downsampler
from cloud_service import start_cloud_service_task
from inhand_services import start_inhand_bridge, sync_to_inhand_system
from routes.api_routes import load_manual_values
from app_state import MANUAL_STATES
saved_user_values = load_manual_values()
MANUAL_STATES.update(saved_user_values)
# THAY ĐỔI: Import hằng số MQTT
from constants import EMQX_BROKER_HOST, EMQX_BROKER_PORT, MQTT_TOPIC_SUBSCRIBE

# --- Đăng ký các Blueprints (nhóm các route) ---
from routes.solar_config_routes import solar_bp, build_template_map
from routes.api_routes import api_bp, load_calculation_rules_from_file, load_manual_values
from routes.system_config_routes import system_bp
app.register_blueprint(solar_bp)
app.register_blueprint(api_bp)
app.register_blueprint(system_bp)

# --- Các biến và hàm dùng chung cho toàn ứng dụng ---
CLIENT_SUBSCRIPTIONS = {}
shutdown_event = threading.Event()

# ==============================================================================
# SECTION: SOCKET.IO HANDLERS
# ==============================================================================

@socketio.on('connect')
def on_connect():
    logging.info(f"Client connected: {request.sid}")

@socketio.on('disconnect')
def on_disconnect():
    logging.info(f"Client disconnected: {request.sid}. Removing from subscriptions.")
    CLIENT_SUBSCRIPTIONS.pop(request.sid, None)

@socketio.on('subscribe_page_data')
def on_subscribe(data):
    page_id = data.get('page')
    if page_id:
        logging.info(f"Client {request.sid} subscribed to data for page: {page_id}")
        CLIENT_SUBSCRIPTIONS[request.sid] = page_id
    with realtime_data_lock:
        initial_data = {
            "realtime_values": realtime_data_cache.get("realtime_values", {}),
            "health_status": realtime_data_cache.get("health_status", {}),
            "iec104_status": realtime_data_cache.get("iec104_status", {}),
            "controllers_by_name": realtime_data_cache.get("controllers_by_name", {}),
            "measures": realtime_data_cache.get("measures", []), 
            "measures_by_name": realtime_data_cache.get("measures_by_name", {})
        }
    emit('page_data_update', initial_data, room=request.sid)

# ==============================================================================
# SECTION: BACKGROUND TASKS
# ==============================================================================

def monitor_system_status_task(socketio_instance):
    while not shutdown_event.is_set():
        supervisor_info = { "pid": None, "status": "not_found", "cpu_percent": 0 }
        try:
            for proc in psutil.process_iter(['pid', 'cmdline', 'cpu_percent']):
                if proc.info['cmdline'] and "device_supervisor" in " ".join(proc.info['cmdline']):
                    supervisor_info.update({
                        'pid': proc.pid,
                        'status': 'running',
                        'cpu_percent': proc.cpu_percent(interval=0.1)
                    })
                    break
            socketio_instance.emit('system_status_update', {'supervisor_status': supervisor_info})
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            socketio_instance.emit('system_status_update', {'supervisor_status': supervisor_info})
        except Exception as e:
            logging.error(f"Error in monitor_system_status_task: {e}")
        shutdown_event.wait(5)

def config_watcher_task():
    logging.info("Config watcher task started. Checking every 60 seconds.")
    while not shutdown_event.is_set():
        try:
            process_and_save_config_data(socketio_instance=socketio, app_instance=app)
        except Exception as e:
            logging.error(f"An unexpected error in config_watcher_task: {e}", exc_info=True)
        shutdown_event.wait(60)
    logging.info("Config watcher task stopped.")
CURRENT_MAX_STATE_FILE = os.path.join(project_root, 'current_max_state.json')
DAILY_MAX_LOG_FILE = os.path.join(project_root, 'daily_max_log.txt')
def load_max_state():
    """Tải giá trị Max hiện tại từ file JSON"""
    if os.path.exists(CURRENT_MAX_STATE_FILE):
        try:
            with open(CURRENT_MAX_STATE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except: pass
    return {"date": "", "values": {}}

def save_max_state(state):
    """Lưu giá trị Max hiện tại vào file JSON"""
    try:
        with open(CURRENT_MAX_STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(state, f, indent=4)
    except Exception as e:
        logging.error(f"Error saving max state: {e}")

def calculation_loop_task(socketio_instance):
    load_calculation_rules_from_file()
    from routes.api_routes import load_manual_values
    from app_state import MANUAL_STATES, MANUAL_STATES_LOCK
    
    initial_values = load_manual_values()
    with MANUAL_STATES_LOCK:
        MANUAL_STATES.update(initial_values)
    
    stats_state = load_max_state()
    # Load trạng thái cũ (Max & Min) khi khởi động
    # Cấu trúc stats: {"date": "...", "values": {MAX}, "min_values": {MIN}, "yesterday_values": {}, "yesterday_min": {}}
    stats_state = load_max_state()
    if "values" not in stats_state: stats_state["values"] = {}             # Today Max
    if "min_values" not in stats_state: stats_state["min_values"] = {}     # Today Min
    if "yesterday_values" not in stats_state: stats_state["yesterday_values"] = {} # Yesterday Max
    if "yesterday_min" not in stats_state: stats_state["yesterday_min"] = {}       # Yesterday Min

    while not shutdown_event.is_set():
        time.sleep(1) # Chu kỳ 1 giây
        user_inputs = load_manual_values()
        now = datetime.datetime.now()
        today_str = now.strftime("%Y-%m-%d")
        updates = {}
        mqtt_payloads = []
        sdk_write_payload = []
        
        # 1. KIỂM TRA CHUYỂN NGÀY (Rollover) - Lưu trữ cả Max và Min
        if stats_state.get("date") != "" and stats_state.get("date") != today_str:
            logging.info(f"New day detected ({today_str}). Archiving stats.")
            try:
                with open(DAILY_MAX_LOG_FILE, 'a', encoding='utf-8') as f:
                    f.write(f"\n--- BÁO CÁO NGÀY {stats_state['date']} ---\n")
                    f.write(f"MAX: {json.dumps(stats_state['values'])}\n")
                    f.write(f"MIN: {json.dumps(stats_state['min_values'])}\n")
                
                # Chốt sổ hôm qua
                stats_state["yesterday_values"] = stats_state["values"].copy()
                stats_state["yesterday_min"] = stats_state["min_values"].copy()
                # Reset hôm nay
                stats_state["values"] = {}
                stats_state["min_values"] = {}
                stats_state["date"] = today_str
                save_max_state(stats_state)
            except Exception as e:
                logging.error(f"Rollover Daily Stats failed: {e}")

        if stats_state["date"] == "":
            stats_state["date"] = today_str
            save_max_state(stats_state)

        with CALCULATION_RULES_LOCK:
            current_rules = list(CALCULATION_RULES)
            
        if not current_rules:
            continue

        with realtime_data_lock:
            ts_now_ms = int(time.time() * 1000)
            rt_cache = realtime_data_cache.get("realtime_values", {})
            all_measures = realtime_data_cache.get("measures", [])

            for rule in current_rules:
                rule_id = rule.get('id')
                op_type = rule.get('operation', 'sum')
                if op_type in ['manual_status', 'constant']:
                    final_val = user_inputs.get(rule_id, rule.get('constant_value', 0.0))
                items = rule.get('items', [])
                
                final_val = 0.0

                # --- A. XỬ LÝ THEO LOẠI PHÉP TÍNH ---
                
                # Loại 1: Hằng số (Constant)
                if op_type == 'constant':
                    final_val = float(rule.get('constant_value', 0.0))

                # Loại 2: Trạng thái thủ công (Manual Status gửi từ Web)
                elif op_type == 'manual_status':
                    final_val = float(MANUAL_STATES.get(rule_id, 0.0))

                # Loại 3: Các phép tính dựa trên biến đo (SUM, AVG, SUB, MIN, MAX)
                else:
                    vals = []
                    for item in items:
                        val = rt_cache.get(item.get('device'), {}).get(item.get('measure'), {}).get("value")
                        if val is not None:
                            try: vals.append(float(val))
                            except: pass

                    # Bỏ qua nếu không có dữ liệu (trừ trường hợp lấy giá trị hôm qua)
                    if not vals and op_type not in ['max_yesterday', 'min_yesterday']:
                        continue

                    if op_type == 'sum':
                        final_val = sum(vals)
                    elif op_type == 'avg':
                        final_val = sum(vals) / len(vals) if vals else 0.0
                    elif op_type == 'sub':
                        final_val = vals[0] - sum(vals[1:]) if len(vals) >= 1 else 0.0
                    
                    # Thống kê Max
                    elif op_type == 'max_daily':
                        current_input = vals[0] if vals else 0.0
                        old_max = stats_state["values"].get(rule_id, -999999999.0)
                        if current_input > old_max:
                            stats_state["values"][rule_id] = current_input
                            save_max_state(stats_state)
                        final_val = stats_state["values"].get(rule_id, current_input)
                    elif op_type == 'max_yesterday':
                        final_val = stats_state["yesterday_values"].get(rule_id, 0.0)

                    # Thống kê Min (MỚI)
                    elif op_type == 'min_daily':
                        current_input = vals[0] if vals else 0.0
                        old_min = stats_state["min_values"].get(rule_id, 999999999.0)
                        if current_input < old_min:
                            stats_state["min_values"][rule_id] = current_input
                            save_max_state(stats_state)
                        final_val = stats_state["min_values"].get(rule_id, current_input)
                    elif op_type == 'min_yesterday':
                        final_val = stats_state["yesterday_min"].get(rule_id, 0.0)

                # --- B. ÁP DỤNG SCALING (NHÂN/CỘNG HẰNG SỐ) ---
                # Công thức: Kết quả = (Kết quả_gốc * scaling_factor) + scaling_offset
                factor = float(rule.get('scaling_factor', 1.0))
                offset = float(rule.get('scaling_offset', 0.0))
                final_val = (final_val * factor) + offset
                
                final_val = round(final_val, 2)

                # --- C. CẬP NHẬT CACHE VÀ GỬI UI ---
                if "Calculations" not in updates: updates["Calculations"] = {}
                result_obj = { "value": final_val, "timestamp": ts_now_ms }
                updates["Calculations"][rule_id] = result_obj
                
                if "Calculations" not in realtime_data_cache["realtime_values"]:
                    realtime_data_cache["realtime_values"]["Calculations"] = {}
                realtime_data_cache["realtime_values"]["Calculations"][rule_id] = result_obj

                # D. ĐÓNG GÓI MQTT CHO CÁC BIẾN LINK (VIRTUAL CONTROLLER)
                linked_measures = [m for m in all_measures if m.get('calculation_id') == rule_id]
                for target_m in linked_measures:
                    mqtt_payloads.append({
                        "name": target_m.get('ctrlName'),
                        "health": 1,
                        "timestamp": ts_now_ms,
                        "measures": [{
                            "name": target_m.get('name'),
                            "value": final_val,
                            "timestamp": ts_now_ms,
                            "health": 1
                        }]
                    })
                with CALC_MAP_LOCK:
                    linked_virtual_measures = CALC_TO_VIRTUAL_MAP.get(rule_id, [])
                
                if linked_virtual_measures:
                    # Gom các biến ảo của cùng 1 phép tính vào payload SDK
                    for target in linked_virtual_measures:
                        # Thêm vào mảng SDK (Format 3)
                        sdk_write_payload.append({
                            "name": target["ctrl"],
                            "measures": [{
                                "name": target["meas"],
                                "value": final_val
                            }]
                        })
                        
                        # Đồng thời chuẩn bị payload MQTT để Web sáng đèn
                        mqtt_payloads.append({
                            "name": target["ctrl"],
                            "health": 1,
                            "timestamp": ts_now_ms,
                            "measures": [{
                                "name": target["meas"],
                                "value": final_val,
                                "timestamp": ts_now_ms,
                                "health": 1
                            }]
                        })


        # GỬI SOCKET CẬP NHẬT UI

            
            
        # GỬI MQTT LOOPBACK (Đồng bộ biến ảo)
        if mqtt_payloads:
            try:
                publish.single(
                    MQTT_TOPIC_SUBSCRIBE, 
                    payload=json.dumps({ "controllers": mqtt_payloads }), 
                    hostname=EMQX_BROKER_HOST, 
                    port=EMQX_BROKER_PORT
                )
            except Exception as e:
                logging.error(f"Calculation MQTT Publish error: {e}")
        if sdk_write_payload:
            # sdk_write_payload lúc này là một mảng lớn các lệnh ghi
            sync_to_inhand_system(sdk_write_payload)
        if updates:
            socketio_instance.emit('page_data_update', { "realtime_values": updates })

# ==============================================================================
# SECTION: MAIN EXECUTION
# ==============================================================================

if __name__ == '__main__':
    init_sqlite_db()
    build_template_map() # Gọi hàm đã được import từ routes
    process_and_save_config_data(force_update=True, socketio_instance=socketio, app_instance=app)
    
    logging.info("Spawning background tasks as green threads.")
    eventlet.spawn(db_writer_task, shutdown_event)
    eventlet.spawn(start_1min_downsampler, shutdown_event)
    eventlet.spawn(start_5min_downsampler, shutdown_event)
    eventlet.spawn(monitor_system_status_task, socketio)
    eventlet.spawn(start_mqtt_subscriber, socketio, app, CLIENT_SUBSCRIPTIONS)
    #eventlet.spawn(iec104_monitor_task, socketio, app, 10)
    eventlet.spawn(config_watcher_task)
    eventlet.spawn(calculation_loop_task, socketio)
    eventlet.spawn(start_cloud_service_task)
    eventlet.spawn(start_inhand_bridge)
    logging.info("Application starting with Eventlet server.")
    try:
        socketio.run(app, host='0.0.0.0', port=8000, use_reloader=False)
    except KeyboardInterrupt:
        logging.info("Shutdown signal received. Stopping threads...")
        shutdown_event.set()
    
    logging.info("Application has shut down.")

# --- END OF FILE main.py ---