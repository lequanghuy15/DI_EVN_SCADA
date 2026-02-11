# --- START OF FILE inhand_services.py ---

import os
import sys
import json
import time
import logging
from unittest.mock import MagicMock

# --- BƯỚC 1: STRONG MOCKING (PHẢI CHẠY TRƯỚC KHI IMPORT THƯ VIỆN HÃNG) ---
def mock_package(name):
    """Tạo một Mock object có thuộc tính __path__ để lừa Python đây là một Package"""
    m = MagicMock()
    m.__path__ = [] 
    sys.modules[name] = m

invalid_modules = [
    'azure', 
    'azure.iot', 
    'azure.iot.device', 
    'azure.iot.device.common',
    'azure.iot.device.common.models',
    'azure.iot.device.common.models.x509',
    'azure.iot.device.aio',
    'azure.iot.hub',
    'iothub_client'
]

for mod in invalid_modules:
    mock_package(mod)

# --- BƯỚC 2: THIẾT LẬP ĐƯỜNG DẪN (Sử dụng folder gốc của hãng) ---
# Kiểm tra xem đường dẫn này có tồn tại không
sys.path.insert(0, "/var/user/app/device_supervisor/src")
sys.path.insert(0, "/var/user/app/device_supervisor/lib")

# --- BƯỚC 3: IMPORT THƯ VIỆN HÃNG ---
try:
    from quickfaas.measure import recall2, write_plc_values
    import paho.mqtt.publish as publish
    from constants import EMQX_BROKER_HOST, EMQX_BROKER_PORT, MQTT_TOPIC_SUBSCRIBE, TARGET_CFG_FILE_PATH_GATEWAY
    logging.info(">>> [InHand Bridge] Import thư viện hãng thành công!")
except Exception as e:
    logging.error(f">>> [InHand Bridge] Lỗi Import nghiêm trọng: {e}", exc_info=True)

_last_cfg_mtime = 0
blacklisted_groups = set()

def reload_blacklist_if_changed():
    """
    Check thời gian thay đổi của file (mtime) để update blacklist.
    """
    global _last_cfg_mtime, blacklisted_groups
    
    try:
        if not os.path.exists(TARGET_CFG_FILE_PATH_GATEWAY):
            return

        current_mtime = os.path.getmtime(TARGET_CFG_FILE_PATH_GATEWAY)
        
        if current_mtime > _last_cfg_mtime:
            logging.info(f">>> [Bridge] Đang đọc lại file cấu hình: {TARGET_CFG_FILE_PATH_GATEWAY}")
            with open(TARGET_CFG_FILE_PATH_GATEWAY, 'r', encoding='utf-8') as f:
                config = json.load(f)
                # Logic: Chặn các thiết bị có protocol là Virtual Controller để tránh loop
                new_blacklist = {
                    c['name'] for c in config.get('controllers', []) 
                    if c.get('protocol') == "Virtual Controller"
                }
                blacklisted_groups = new_blacklist
                _last_cfg_mtime = current_mtime
                logging.info(f">>> [Bridge] Danh sách chặn (Blacklist) cập nhật: {list(blacklisted_groups)}")
                
    except Exception as e:
        logging.error(f">>> [Bridge] Lỗi khi đọc Blacklist: {e}")

# --- BƯỚC 4: LOGIC CẦU NỐI ---
def on_inhand_data(message, userdata):
    try:
        # LOGGING 1: Xác nhận callback được gọi
        # logging.debug(">>> [Bridge] Callback on_inhand_data triggered.") 

        reload_blacklist_if_changed()

        if not message:
            logging.warning(">>> [Bridge] Nhận message rỗng từ InHand.")
            return

        # LOGGING 2: Kiểm tra cấu trúc dữ liệu gốc
        # Chỉ in keys để tránh spam log quá nhiều, hoặc in full nếu cần thiết
        # logging.info(f">>> [Bridge] Raw Message Keys: {message.keys()}") 
        
        inhand_values = message.get("values", {})
        if not inhand_values:
            # logging.debug(">>> [Bridge] Không có 'values' trong message.")
            return

        ts_ms = int(time.time() * 1000)
        backend_controllers = []

        # Duyệt qua từng thiết bị nhận được từ SDK hãng
        for group_name, sensors in inhand_values.items():
            
            # LOGGING 3: Kiểm tra logic lọc
            if group_name in blacklisted_groups:
                # logging.debug(f">>> [Bridge] Bỏ qua thiết bị ảo: {group_name}")
                continue 

            measures_list = []
            group_health = 0
            
            for sensor_name, data in sensors.items():
                # Kiểm tra cấu trúc data của từng sensor
                # Thường là { "value": ..., "status": ..., "raw_data": ... }
                
                # Sửa đổi: Một số version trả về 'value' thay vì 'raw_data'
                val = data.get("raw_data")
                if val is None:
                    val = data.get("value", 0)

                status = 1 if data.get("status") == 1 else 0
                if status == 1: group_health = 1
                
                measures_list.append({
                    "name": sensor_name,
                    "value": val,
                    "timestamp": ts_ms,
                    "health": status
                })
            
            if measures_list:
                backend_controllers.append({
                    "name": group_name,
                    "health": group_health,
                    "timestamp": ts_ms,
                    "measures": measures_list
                })
            else:
                 logging.warning(f">>> [Bridge] Thiết bị {group_name} không có biến đo nào hợp lệ.")

        # LOGGING 4: Kiểm tra dữ liệu trước khi bắn sang MQTT
        if backend_controllers:
            # logging.info(f">>> [Bridge] Chuẩn bị gửi MQTT cho {len(backend_controllers)} thiết bị: {[c['name'] for c in backend_controllers]}")
            
            payload = {"controllers": backend_controllers}
            publish.single(
                MQTT_TOPIC_SUBSCRIBE, 
                payload=json.dumps(payload),
                hostname=EMQX_BROKER_HOST, 
                port=EMQX_BROKER_PORT
            )
            # logging.info(">>> [Bridge] Gửi MQTT thành công.")
        else:
            pass
            # logging.warning(">>> [Bridge] Không có dữ liệu controller nào để gửi (có thể bị lọc hết hoặc data rỗng).")

    except Exception as e:
        logging.error(f">>> [Bridge] Lỗi logic nghiêm trọng trong on_inhand_data: {e}", exc_info=True)

def start_inhand_bridge():
    # Load lần đầu khi khởi động
    logging.info(">>> [Bridge] Khởi động Service...")
    reload_blacklist_if_changed()
    
    try:
        # Kiểm tra xem hàm recall2 có tồn tại không
        if 'recall2' in globals():
            logging.info(">>> [Bridge] Đăng ký callback recall2...")
            recall2(callback=on_inhand_data, userdata="bridge_env")
            logging.info(">>> [Bridge] Đăng ký thành công. Đang chờ dữ liệu...")
        else:
            logging.error(">>> [Bridge] Hàm recall2 không tìm thấy. Kiểm tra lại import.")
    except Exception as e:
        logging.error(f">>> [Bridge] Crash khi gọi recall2: {e}", exc_info=True)

def sync_to_inhand_system(write_payload):
    """
    Ghi dữ liệu vào lõi hệ thống Gateway
    write_payload: List các thiết bị và biến theo Format 3 của SDK
    """
    if not write_payload:
        return
        
    try:
        # Gọi SDK (Format 3: List of controllers)
        write_plc_values(message=write_payload, timeout=5)
        # logging.debug(f">>> [SDK Write] Synced {len(write_payload)} controllers to InHand core.")
    except Exception as e:
        logging.error(f"Error syncing to InHand core via SDK: {e}")

# --- END OF FILE inhand_services.py ---