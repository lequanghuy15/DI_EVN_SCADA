# --- START OF FILE routes/api_routes.py ---

import os
import json
import logging
import time
import random
import string
import sys
import threading
real_script_path = os.path.realpath(__file__)
current_script_dir = os.path.dirname(real_script_path)
project_root = os.path.dirname(current_script_dir)
lib_path = os.path.join(project_root, 'lib')
if lib_path not in sys.path:
    sys.path.insert(0, lib_path)
from flask import Blueprint, jsonify, request, send_from_directory, Response

from constants import TARGET_CFG_FILE_PATH_GATEWAY, project_root, STATIC_FOLDER_PATH, MQTT_COMMAND_TOPIC, EMQX_BROKER_HOST, EMQX_BROKER_PORT
from app_state import realtime_data_lock, realtime_data_cache, CALCULATION_RULES, CALCULATION_RULES_LOCK, CLOUD_UPLOAD_RULES, CLOUD_RULES_LOCK, LOGGING_WHITELIST, LOGGING_RULES_LOCK
from db_utils import get_historical_readings
from routes.solar_config_routes import CON_TEMP_NAME_MAP, build_template_map, _apply_new_config_and_restart_supervisor
from app_state import MANUAL_STATES, MANUAL_STATES_LOCK, MANUAL_STATES_FILE

api_bp = Blueprint('api', __name__)
CALC_FILE_PATH = os.path.join(project_root, 'calculations.json')
CLOUD_RULES_FILE_PATH = os.path.join(project_root, 'cloud_upload_rules.json') # Giữ lại cho chức năng Cloud
VC_FILE_PATH = os.path.join(project_root, 'virtual_controllers.json')
USER_SETTINGS_FILE = os.path.join(project_root, 'user_settings.json')
LOGGING_RULES_FILE_PATH = os.path.join(project_root, 'logging_rules.json')
CHART_CONFIG_FILE_PATH = os.path.join(project_root, 'chart_config.json')
MANUAL_VAL_FILE = os.path.join(project_root, 'manual_values.json')

def save_manual_states_to_file():
    with MANUAL_STATES_LOCK:
        with open(os.path.join(project_root, MANUAL_STATES_FILE), 'w') as f:
            json.dump(MANUAL_STATES, f)

def load_manual_values():
    if os.path.exists(MANUAL_VAL_FILE):
        try:
            with open(MANUAL_VAL_FILE, 'r') as f:
                return json.load(f)
        except: return {}
    return {}

@api_bp.route('/api/update_manual_value', methods=['POST'])
def update_manual_value():
    data = request.json
    rule_id = data.get('id')
    val = float(data.get('value', 0))
    
    # 1. Cập nhật vào RAM ngay lập tức (Để main.py thấy số 9 luôn)
    with MANUAL_STATES_LOCK:
        MANUAL_STATES[rule_id] = val
    
    # 2. Lưu xuống file để lần sau khởi động lại vẫn nhớ
    all_vals = load_manual_values()
    all_vals[rule_id] = val
    save_manual_values(all_vals)
    
    return jsonify({"status": "success", "value": val})
def save_manual_values(data):
    try:
        with open(MANUAL_VAL_FILE, 'w') as f:
            json.dump(data, f, indent=4)
    except Exception as e:
        logging.error(f"Error saving manual values: {e}")

def load_manual_states():
    path = os.path.join(project_root, MANUAL_STATES_FILE)
    if os.path.exists(path):
        try:
            with open(path, 'r') as f:
                data = json.load(f)
                with MANUAL_STATES_LOCK:
                    MANUAL_STATES.update(data)
        except: pass

@api_bp.route('/api/update_manual_state', methods=['POST'])
def update_manual_state():
    data = request.json
    rule_id = data.get('id')
    val = int(data.get('value', 0))
    
    all_vals = load_manual_values()
    all_vals[rule_id] = val
    save_manual_values(all_vals)
    
    # Cập nhật ngay vào RAM để main.py thấy luôn
    from app_state import MANUAL_STATES, MANUAL_STATES_LOCK
    with MANUAL_STATES_LOCK:
        MANUAL_STATES[rule_id] = val
        
    return jsonify({"status": "success", "value": val})


def generate_random_id(length=16):
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))

@api_bp.route('/')
def home():
    return send_from_directory(STATIC_FOLDER_PATH, 'index.html')

@api_bp.route('/api/config')
def get_config():
    with realtime_data_lock:
        return jsonify(realtime_data_cache.copy())

@api_bp.route('/api/write_device_value', methods=['POST'])
def write_device_value():
    data = request.json
    if not data or 'measure_name' not in data or 'new_value' not in data:
        logging.error("API /api/write_device_value: Invalid request data.")
        return jsonify({"status": "error", "message": "Invalid request"}), 400

    measure_name = data['measure_name']
    new_value = data['new_value']
    with realtime_data_lock:
        measure_info = realtime_data_cache["measures_by_name"].get(measure_name)

    if not measure_info:
        logging.warning(f"API /api/write_device_value: Measure '{measure_name}' not found.")
        return jsonify({"status": "error", "message": f"Measure '{measure_name}' not found"}), 404

    if measure_info.get("readWrite", "ro") != "rw":
        logging.warning(f"API /api/write_device_value: Measure '{measure_name}' is read-only.")
        return jsonify({"status": "error", "message": f"Measure '{measure_name}' is read-only"}), 403

    data_type = measure_info.get("dataType", "UNKNOWN")
    try:
        if data_type in ["INT", "WORD", "DINT"]:
            new_value = int(new_value)
        elif data_type in ["FLOAT", "LONG", "DWORD"]:
            new_value = float(new_value)
    except ValueError:
        logging.error(f"API /api/write_device_value: Invalid value '{new_value}' for dataType '{data_type}'.")
        return jsonify({"status": "error", "message": f"Invalid value '{new_value}' for data type '{data_type}'"}), 400

    controller_name = measure_info.get("ctrlName", "UnknownController")
    command_payload = {
        "msg_id": int(time.time() * 1000),
        "timestamp": int(time.time()),
        "payload": [{"name": controller_name, "measures": [{"name": measure_name, "value": new_value}]}]
    }
    try:
        from paho.mqtt import publish
        publish.single(MQTT_COMMAND_TOPIC, payload=json.dumps(command_payload), hostname=EMQX_BROKER_HOST, port=EMQX_BROKER_PORT)
        logging.info(f"Sent MQTT command: Topic={MQTT_COMMAND_TOPIC}, Measure={measure_name}")
        return jsonify({"status": "accepted", "message": f"Command for {measure_name} sent."}), 202
    except Exception as e:
        logging.error(f"Failed to send MQTT command: {e}", exc_info=True)
        return jsonify({"status": "error", "message": f"Failed to send command: {e}"}), 500

@api_bp.route('/api/history', methods=['GET'])
def get_historical_data():
    sensor_ids_str = request.args.get('sensor_ids')
    start_time_str = request.args.get('start_time')
    end_time_str = request.args.get('end_time')
    resolution = request.args.get('resolution', 'auto')

    sensor_ids = sensor_ids_str.split(',') if sensor_ids_str else []
    
    try:
        start_time = int(start_time_str) if start_time_str else 0
        end_time = int(end_time_str) if end_time_str else int(time.time())
    except (ValueError, TypeError):
        return jsonify({"status": "error", "message": "Invalid timestamp format"}), 400

    if start_time >= end_time:
        return jsonify({"status": "error", "message": "Start time must be before end time"}), 400

    historical_data = get_historical_readings(sensor_ids, start_time, end_time, resolution=resolution)
    return jsonify(historical_data)

@api_bp.route('/api/device_measures_details/<device_name>', methods=['GET'])
def get_device_measures_details(device_name):
    try:
        with open(TARGET_CFG_FILE_PATH_GATEWAY, 'r', encoding='utf-8') as f:
            config = json.load(f)

        target_controller = next((c for c in config.get('controllers', []) if c.get('name') == device_name), None)
        if not target_controller:
            return jsonify({"status": "error", "message": "Device not found."}), 404
        
        con_temp_name = target_controller.get('conTempName')
        if not con_temp_name:
            return jsonify({"status": "error", "message": "Device is not linked to a template."}), 404

        if not CON_TEMP_NAME_MAP: build_template_map()
        template_path_str = CON_TEMP_NAME_MAP.get(con_temp_name)
        if not template_path_str:
            return jsonify({"status": "error", "message": f"Template '{con_temp_name}' not found."}), 404
        
        templates_dir = os.path.join(project_root, 'templates')
        full_path = os.path.abspath(os.path.join(templates_dir, template_path_str))
        with open(full_path, 'r', encoding='utf-8') as f:
            template_data = json.load(f)
        
        template_measures_map = {str(m.get('addr')): m for m in template_data.get('measures', [])}
        active_measures_map_by_addr = {str(m.get('addr')): m for m in config.get('measures', []) if m.get('ctrlName') == device_name}

        final_measures_list = []
        for addr_str, template_measure in template_measures_map.items():
            final_measure = template_measure.copy()
            active_measure = active_measures_map_by_addr.get(addr_str)
            if active_measure:
                final_measure.update(active_measure)
                final_measure['isActive'] = True
            else:
                final_measure['isActive'] = False
            final_measures_list.append(final_measure)
        
        return jsonify({
            "deviceName": device_name,
            "conTempName": con_temp_name,
            "measures": final_measures_list
        })
    except Exception as e:
        logging.error(f"API /device_measures_details error: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Server error."}), 500

@api_bp.route('/api/protocols', methods=['GET'])
def get_protocols():
    try:
        protocols_path = os.path.join(project_root, 'protocols.json')
        with open(protocols_path, 'r', encoding='utf-8') as f:
            return jsonify(json.load(f))
    except Exception as e:
        logging.error(f"API /api/protocols error: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Could not retrieve protocols."}), 500

@api_bp.route('/api/templates', methods=['GET'])
def get_templates():
    try:
        templates_dir = os.path.join(project_root, 'templates')
        if not os.path.isdir(templates_dir):
            return jsonify({})

        template_hierarchy = {}
        for root, _, files in os.walk(templates_dir):
            if not files: continue
            relative_dir = os.path.relpath(root, templates_dir)
            if relative_dir == '.': continue
            parts = relative_dir.split(os.sep)
            if len(parts) != 2: continue
            
            device_type, brand = parts[0], parts[1]
            if device_type not in template_hierarchy:
                template_hierarchy[device_type] = {}
            if brand not in template_hierarchy[device_type]:
                template_hierarchy[device_type][brand] = []
            
            for filename in files:
                if filename.endswith('.json'):
                    template_hierarchy[device_type][brand].append(filename.replace('.json', ''))
        
        return jsonify(template_hierarchy)
    except Exception as e:
        logging.error(f"API /api/templates error: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Could not retrieve templates."}), 500

def load_calculation_rules_from_file():
    global CALCULATION_RULES
    if os.path.exists(CALC_FILE_PATH):
        try:
            with open(CALC_FILE_PATH, 'r', encoding='utf-8') as f:
                with CALCULATION_RULES_LOCK:
                    CALCULATION_RULES.clear()
                    data = json.load(f)
                    if isinstance(data, list): CALCULATION_RULES.extend(data)
            logging.info(f"Loaded {len(CALCULATION_RULES)} calc rules.")
        except Exception as e: logging.error(f"Error loading calculations.json: {e}")

@api_bp.route('/api/calculations', methods=['GET'])
def get_calculations():
    if os.path.exists(CALC_FILE_PATH):
        with open(CALC_FILE_PATH, 'r', encoding='utf-8') as f:
            return jsonify(json.load(f))
    return jsonify([])

@api_bp.route('/api/calculations', methods=['POST'])
def save_calculations():
    try:
        new_rule = request.json
        rules = []
        if os.path.exists(CALC_FILE_PATH):
            with open(CALC_FILE_PATH, 'r', encoding='utf-8') as f: rules = json.load(f)
        
        # Logic cập nhật hoặc thêm mới
        idx = next((i for i, r in enumerate(rules) if r["id"] == new_rule["id"]), None)
        if idx is not None: rules[idx] = new_rule # <--- Đã xử lý Update
        else: rules.append(new_rule) 
        
        # Ghi file
        with open(CALC_FILE_PATH, 'w', encoding='utf-8') as f: json.dump(rules, f, indent=4)
        
        # [QUAN TRỌNG - THÊM DÒNG NÀY]: Nạp lại vào bộ nhớ để main.py nhận được ngay
        load_calculation_rules_from_file()
        
        return jsonify({"status": "success"})
    except Exception as e: return jsonify({"status": "error", "message": str(e)}), 500
@api_bp.route('/api/calculations', methods=['DELETE'])
def delete_calculation():
    try:
        target_id = request.json.get('id')
        if os.path.exists(CALC_FILE_PATH):
            with open(CALC_FILE_PATH, 'r', encoding='utf-8') as f: rules = json.load(f)
            rules = [r for r in rules if r['id'] != target_id]
            with open(CALC_FILE_PATH, 'w', encoding='utf-8') as f: json.dump(rules, f, indent=4)
            
            # [QUAN TRỌNG - THÊM DÒNG NÀY]
            load_calculation_rules_from_file()
            
        return jsonify({"status": "success"})
    except Exception as e: 
        return jsonify({"status": "error", "message": str(e)}), 500

def load_cloud_rules_startup():
    if os.path.exists(CLOUD_RULES_FILE_PATH):
        try:
            with open(CLOUD_RULES_FILE_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                with CLOUD_RULES_LOCK:
                    CLOUD_UPLOAD_RULES.clear()
                    if isinstance(data, list):
                        CLOUD_UPLOAD_RULES.extend(data)
            logging.info(f"Loaded {len(CLOUD_UPLOAD_RULES)} cloud upload rules.")
        except Exception as e:
            logging.error(f"Error loading cloud rules: {e}")
            
load_cloud_rules_startup()

@api_bp.route('/api/cloud_upload_rules', methods=['GET'])
def get_cloud_rules():
    with CLOUD_RULES_LOCK:
        return jsonify(CLOUD_UPLOAD_RULES)

@api_bp.route('/api/cloud_upload_rules', methods=['POST'])
def save_cloud_rules():
    try:
        new_rules = request.json
        if not isinstance(new_rules, list):
            return jsonify({"status": "error", "message": "Payload must be a list"}), 400
            
        with CLOUD_RULES_LOCK:
            CLOUD_UPLOAD_RULES.clear()
            CLOUD_UPLOAD_RULES.extend(new_rules)
            
        with open(CLOUD_RULES_FILE_PATH, 'w', encoding='utf-8') as f:
            json.dump(new_rules, f, indent=4)
            
        return jsonify({"status": "success"})
    except Exception as e:
        logging.error(f"Error saving cloud rules: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500
def load_vcs():
    if os.path.exists(VC_FILE_PATH):
        try:
            with open(VC_FILE_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except: return []
    return []

@api_bp.route('/api/virtual_controllers', methods=['GET'])
def get_virtual_controllers():
    return jsonify(load_vcs())

@api_bp.route('/api/virtual_controllers', methods=['POST'])
def save_virtual_controller():
    try:
        new_vc = request.json
        all_vcs = load_vcs()
        idx = next((i for i, v in enumerate(all_vcs) if v["id"] == new_vc["id"]), None)
        if idx is not None: all_vcs[idx] = new_vc
        else: all_vcs.append(new_vc)
        with open(VC_FILE_PATH, 'w', encoding='utf-8') as f:
            json.dump(all_vcs, f, indent=4)
        return jsonify({"status": "success"})
    except Exception as e: return jsonify({"status": "error", "message": str(e)}), 500

@api_bp.route('/api/virtual_controllers', methods=['DELETE'])
def delete_virtual_controller():
    try:
        target_id = request.json.get('id')
        all_vcs = [v for v in load_vcs() if v['id'] != target_id]
        with open(VC_FILE_PATH, 'w', encoding='utf-8') as f:
            json.dump(all_vcs, f, indent=4)
        return jsonify({"status": "success"})
    except Exception as e: return jsonify({"status": "error", "message": str(e)}), 500
@api_bp.route('/api/user_settings', methods=['GET', 'POST'])
def handle_user_settings():
    # Khóa thread để tránh ghi đè cùng lúc (Optional nhưng tốt)
    # Ở đây file nhỏ nên ta làm đơn giản
    
    if request.method == 'GET':
        if os.path.exists(USER_SETTINGS_FILE):
            try:
                with open(USER_SETTINGS_FILE, 'r', encoding='utf-8') as f:
                    return jsonify(json.load(f))
            except Exception as e:
                logging.error(f"Error reading user settings: {e}")
                return jsonify({}) # Trả về rỗng nếu lỗi
        return jsonify({}) # Trả về rỗng nếu chưa có file

    if request.method == 'POST':
        try:
            new_settings = request.json
            with open(USER_SETTINGS_FILE, 'w', encoding='utf-8') as f:
                json.dump(new_settings, f, indent=4, ensure_ascii=False)
            return jsonify({"status": "success"})
        except Exception as e:
            logging.error(f"Error saving user settings: {e}")
            return jsonify({"status": "error", "message": str(e)}), 500
def load_logging_rules_startup():
    if os.path.exists(LOGGING_RULES_FILE_PATH):
        try:
            with open(LOGGING_RULES_FILE_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                # Data trong file là List, ta chuyển thành Set để tra cứu nhanh
                if isinstance(data, list):
                    with LOGGING_RULES_LOCK:
                        LOGGING_WHITELIST.clear()
                        LOGGING_WHITELIST.update(data)
            logging.info(f"Loaded {len(LOGGING_WHITELIST)} logging rules from file.")
        except Exception as e:
            logging.error(f"Error loading logging rules: {e}")
    else:
        logging.info("logging_rules.json not found. Starting with empty whitelist.")

# Gọi ngay khi file này được import (để nạp dữ liệu lúc khởi động)
load_logging_rules_startup()

# 2. API Lấy danh sách (Frontend dùng để tick checkbox)
@api_bp.route('/api/logging_rules', methods=['GET'])
def get_logging_rules():
    with LOGGING_RULES_LOCK:
        # Chuyển Set về List để trả về JSON
        return jsonify(list(LOGGING_WHITELIST))

# 3. API Lưu danh sách (Frontend gọi khi người dùng Save)
@api_bp.route('/api/logging_rules', methods=['POST'])
def save_logging_rules():
    try:
        new_rules = request.json # Đây là mảng ["Device:Var", ...] gửi từ Web
        if not isinstance(new_rules, list):
            return jsonify({"status": "error", "message": "Dữ liệu phải là một mảng chuỗi"}), 400
            
        # 1. Ghi xuống file .json để lần sau khởi động lại vẫn nhớ
        with open(LOGGING_RULES_FILE_PATH, 'w', encoding='utf-8') as f:
            json.dump(new_rules, f, indent=4)
            
        # 2. CẬP NHẬT TRỰC TIẾP VÀO RAM NGAY LÚC NÀY
        # Chúng ta import các biến quản lý trạng thái từ app_state
        from app_state import LOGGING_WHITELIST, LOGGING_RULES_LOCK
        
        with LOGGING_RULES_LOCK:
            LOGGING_WHITELIST.clear() # Xóa danh sách cũ trong RAM
            LOGGING_WHITELIST.update(new_rules) # Nạp danh sách mới vào RAM
            
        logging.info(f"✅ Đã đồng bộ Whitelist vào RAM. Tổng cộng: {len(new_rules)} biến.")
        
        return jsonify({
            "status": "success", 
            "message": "Cấu hình đã áp dụng ngay lập tức mà không cần restart!",
            "count": len(new_rules)
        })
    except Exception as e:
        logging.error(f"Lỗi khi lưu logging rules: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500
@api_bp.route('/api/chart_config', methods=['GET', 'POST'])
def handle_chart_config():
    if request.method == 'GET':
        if os.path.exists(CHART_CONFIG_FILE_PATH):
            try:
                with open(CHART_CONFIG_FILE_PATH, 'r', encoding='utf-8') as f:
                    return jsonify(json.load(f))
            except:
                return jsonify({}) # Trả về rỗng nếu lỗi
        return jsonify({}) # Mặc định rỗng

    if request.method == 'POST':
        try:
            new_config = request.json
            with open(CHART_CONFIG_FILE_PATH, 'w', encoding='utf-8') as f:
                json.dump(new_config, f, indent=4, ensure_ascii=False)
            return jsonify({"status": "success"})
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500
@api_bp.route('/favicon.ico')
def favicon():
    return Response(status=204)
# --- END OF FILE routes/api_routes.py ---