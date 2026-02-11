import os
import sys
import json
import logging
import time
import queue
from constants import *

# --- Phần thiết lập đường dẫn ---
real_script_path = os.path.realpath(__file__)
current_script_dir = os.path.dirname(real_script_path)
project_root = os.path.dirname(current_script_dir)
lib_path = os.path.join(project_root, 'lib')
if lib_path not in sys.path:
    sys.path.insert(0, lib_path)
import paho.mqtt.client as mqtt

from app_state import (
    realtime_data_lock, realtime_data_cache,
    last_logged_values_lock, last_logged_values_to_db_cache, DB_WRITE_QUEUE,
    downsample_data_lock_1min, downsample_data_buffer_1min,
    LOGGING_WHITELIST
)

SUBSCRIBED_CLIENTS = {}

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        logging.info("MQTT Subscriber Connected.")
        client.subscribe(MQTT_TOPIC_SUBSCRIBE)
        client.subscribe(MQTT_COMMAND_RESPONSE_TOPIC)
    else:
        logging.error(f"Failed to connect to MQTT broker, code {rc}.")

def on_message(client, userdata, msg):
    socketio, app = userdata
    try:
        payload = json.loads(msg.payload.decode('utf-8'))
        on_message_logic(payload, socketio, app)
    except Exception as e:
        logging.error(f"MQTT Consumer Error: {e}")

def on_message_logic(payload, socketio=None, app=None):
    try:
        current_timestamp_sec = int(time.time())
        incoming_timestamp_msec = int(current_timestamp_sec * 1000)
        
        updates_values = {}
        updates_health = {}

        # --- LOG 1: KIỂM TRA WHITELIST ĐANG CÓ GÌ ---
        # print(f"DEBUG_WHITELIST: {list(LOGGING_WHITELIST)}")

        for controller_data in payload.get("controllers", []):
            ctrl_name = controller_data.get("name", "").strip()
            health = controller_data.get("health", -1)
            
            if not ctrl_name: continue

            updates_health[ctrl_name] = {"status": health, "timestamp": incoming_timestamp_msec}
            if health != 1: continue 

            if ctrl_name not in updates_values: updates_values[ctrl_name] = {}

            for measure in controller_data.get("measures", []):
                m_name = measure.get("name", "").strip()
                raw_val = measure.get("value")
                if raw_val is None: continue

                processed_value = round(float(raw_val), 2)
                updates_values[ctrl_name][m_name] = {"value": processed_value, "timestamp": incoming_timestamp_msec}

                # --- LOG 2: IN TẤT CẢ BIẾN NHẬN ĐƯỢC (BẤT KỂ WHITELIST) ---
                unique_key = f"{ctrl_name}:{m_name}"
                print(f"DEBUG_MQTT_RX: Key='{unique_key}' | Value={processed_value}")

                # Logic ghi DB
                for measure in controller_data.get("measures", []):
                    m_name = measure.get("name", "").strip()
                    raw_val = measure.get("value")
                    if raw_val is None: continue

                    processed_value = round(float(raw_val), 2)
                    updates_values[ctrl_name][m_name] = {"value": processed_value, "timestamp": incoming_timestamp_msec}

                    unique_key = f"{ctrl_name}:{m_name}"
                    # print(f"DEBUG_MQTT_RX: Key='{unique_key}' | Value={processed_value}")

                    # --- FIX LỖI GHI DATABASE ---
                    if unique_key in LOGGING_WHITELIST:
                        should_write = False  # KHỞI TẠO BIẾN Ở ĐÂY ĐỂ TRÁNH LỖI UnboundLocalError
                        
                        with last_logged_values_lock:
                            last_info = last_logged_values_to_db_cache.get(unique_key)
                            
                            if not last_info:
                                should_write = True
                            else:
                                # Quy tắc 1: Sau 15 phút buộc ghi
                                if (current_timestamp_sec - last_info['timestamp_logged_sec']) >= 900:
                                    should_write = True
                                # Quy tắc 2: Thay đổi giá trị > 0.1
                                elif abs(processed_value - last_info['value']) >= 0.1:
                                    should_write = True
                            
                            if should_write:
                                # Ghi vào hàng đợi lưu DB
                                print(f"👉 [DATABASE] Ghi thành công: {unique_key} = {processed_value}")
                                try:
                                    DB_WRITE_QUEUE.put_nowait((current_timestamp_sec, unique_key, processed_value))
                                    last_logged_values_to_db_cache[unique_key] = {
                                        "value": processed_value, 
                                        "timestamp_logged_sec": current_timestamp_sec
                                    }
                                except queue.Full:
                                    pass

                # Logic Downsampling (1 phút)
                with downsample_data_lock_1min:
                    downsample_data_buffer_1min[unique_key] = {"value": processed_value, "timestamp": current_timestamp_sec}

        # Cập nhật Cache Backend
        with realtime_data_lock:
            realtime_data_cache["realtime_values"].update(updates_values)
            realtime_data_cache["health_status"].update(updates_health)
            realtime_data_cache["last_update_timestamp"] = incoming_timestamp_msec

        # Đẩy dữ liệu ra Web qua Socket.IO
        if socketio and app and updates_values:
            with app.app_context():
                socketio.emit('page_data_update', {
                    "realtime_values": updates_values,
                    "health_status": updates_health,
                    "last_update_timestamp": incoming_timestamp_msec
                })

    except Exception as e:
        logging.error(f"MQTT Logic Error: {e}", exc_info=True)

def start_mqtt_subscriber(socketio, app, client_subscriptions_dict):
    global SUBSCRIBED_CLIENTS
    SUBSCRIBED_CLIENTS = client_subscriptions_dict
    
    logging.info("Starting MQTT Subscriber...")
    try:
        client = mqtt.Client(userdata=(socketio, app))
        client.on_connect = on_connect
        client.on_message = on_message
        client.connect(EMQX_BROKER_HOST, EMQX_BROKER_PORT, 60)
        client.loop_forever()
    except Exception as e:
        logging.error(f"Failed to start MQTT client: {e}", exc_info=True)
# --- END OF FILE mqtt_utils.py ---