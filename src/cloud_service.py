import os
import sys
import time
import json
import logging
import socket
from app_state import realtime_data_cache, realtime_data_lock, CLOUD_UPLOAD_RULES, CLOUD_RULES_LOCK
from constants import TARGET_CFG_FILE_PATH_GATEWAY
import ssl

# --- CẤU HÌNH LOGGING DEBUG ---
logger = logging.getLogger("CloudService")
logger.setLevel(logging.DEBUG) # Bật mức DEBUG để soi lỗi kỹ hơn
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    # Format log chi tiết: Thời gian - Tên - Mức độ - Nội dung
    formatter = logging.Formatter('[%(asctime)s] [%(name)s] [%(levelname)s]: %(message)s', datefmt='%H:%M:%S')
    handler.setFormatter(formatter)
    logger.addHandler(handler)

real_script_path = os.path.realpath(__file__)
current_script_dir = os.path.dirname(real_script_path)
project_root = os.path.dirname(current_script_dir)
lib_path = os.path.join(project_root, 'lib')
if lib_path not in sys.path:
    sys.path.insert(0, lib_path)
import eventlet
import paho.mqtt.client as mqtt

# --- HÀM KIỂM TRA MẠNG ---
def check_internet(host="8.8.8.8", port=53, timeout=3):
    try:
        socket.setdefaulttimeout(timeout)
        socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect((host, port))
        return True
    except socket.error:
        return False

def check_dns(domain):
    try:
        socket.gethostbyname(domain)
        return True
    except socket.gaierror:
        return False

class CloudManager:
    def __init__(self):
        self.client = None
        self.connected = False
        self.config = {}
        self.last_sent_map = {} 
        self._update_status_cache(False)

    def _update_status_cache(self, is_connected):
        with realtime_data_lock:
            realtime_data_cache["cloud_runtime_status"] = {
                "connected": is_connected,
                "timestamp": int(time.time() * 1000)
            }

    def load_connection_config(self):
        try:
            with open(TARGET_CFG_FILE_PATH_GATEWAY, 'r', encoding='utf-8') as f:
                data = json.load(f)
                clouds = data.get('clouds', [])
                self.config = clouds[0] if clouds else {}
        except Exception as e:
            logger.error(f"Config Load Error: {e}")

    # --- CALLBACK LOGGING CHI TIẾT ---
    def on_mqtt_log(self, client, userdata, level, buf):
        """In tất cả nhật ký từ thư viện Paho MQTT"""
        # Chỉ in nếu là lỗi hoặc warning để đỡ rác màn hình
        if level <= mqtt.MQTT_LOG_WARNING: 
            logger.debug(f"Paho Log: {buf}")

    def on_connect(self, client, userdata, flags, rc):
        # MÃ LỖI KẾT NỐI (RC)
        rc_map = {
            0: "Success (Thành công)",
            1: "Protocol version incorrect (Sai phiên bản MQTT)",
            2: "Invalid client identifier (Sai Client ID)",
            3: "Server unavailable (Server từ chối/không phản hồi)",
            4: "Bad username or password (Sai tài khoản/mật khẩu)",
            5: "Not authorized (Không có quyền - Sai API Key?)",
        }
        status_text = rc_map.get(rc, f"Unknown error code {rc}")
        
        if rc == 0:
            self.connected = True
            self._update_status_cache(True)
            logger.info(f"✅ Cloud Connected OK! ({status_text})")
        else:
            self.connected = False
            logger.error(f"❌ Connection FAILED! Code={rc} -> {status_text}")

    def on_disconnect(self, client, userdata, rc):
        self.connected = False
        self._update_status_cache(False)
        if rc != 0:
            logger.warning(f"⚠️ Unexpected disconnection. Code: {rc}")

    def connect(self):
        app_enabled = self.config.get('enable_app', 0)
        if not app_enabled:
            if self.client:
                self.client.disconnect()
                self.client = None
                self.connected = False
                self._update_status_cache(False)
                logger.info("Cloud Service is DISABLED in config.")
            return

        # 1. Kiểm tra mạng
        if not check_internet():
            logger.warning("No Internet (Ping 8.8.8.8 fail). Waiting...")
            return

        args = self.config.get('args', {})
        host = args.get('host')
        
        if not host: 
            logger.warning("No Host configured.")
            return

        # 2. Kiểm tra DNS
        if not check_dns(host):
            logger.error(f"DNS Error: Cannot resolve domain '{host}'.")
            return

        if self.client and self.connected: return

        try:
            port = int(args.get('port', 1883))
            raw_client_id = args.get('clientId')
            if raw_client_id and str(raw_client_id).strip():
                client_id = str(raw_client_id)
            else:
                # Tự sinh ID nếu người dùng để trống
                client_id = f'gw_{int(time.time())}'
                logger.warning(f"Client ID missing. Auto-generated: {client_id}")
            clean_session = True if int(args.get('cleanSession', 1)) == 1 else False
            
            logger.info(f"Connecting to {host}:{port} | ClientID: {client_id} | User: {args.get('username')}")

            # Setup Client
            protocol = mqtt.MQTTv311
            if args.get('mqttVersion') == 'v5': protocol = mqtt.MQTTv5
            
            self.client = mqtt.Client(client_id=client_id, clean_session=clean_session, protocol=protocol)
            
            # Gắn Log Debug
            self.client.on_log = self.on_mqtt_log 
            self.client.on_connect = self.on_connect
            self.client.on_disconnect = self.on_disconnect

            # Auth
            user = args.get('username')
            pwd = args.get('passwd')
            if int(args.get('auth', 0)) == 1 and user:
                self.client.username_pw_set(user, pwd)
            
            # SSL
            if int(args.get('ssl', 0)) == 1 or port == 8883:
                logger.info("Enabling SSL/TLS (Insecure Mode for Testing)...")
                
                # Cấu hình bỏ qua xác thực chứng chỉ (quan trọng cho Gateway cũ/nhúng)
                self.client.tls_set(cert_reqs=ssl.CERT_NONE) 
                self.client.tls_insecure_set(True)

            keepalive = int(args.get('keepalive', 60))
            self.client.connect_async(host, port, keepalive=keepalive)
            self.client.loop_start()
            
        except Exception as e:
            logger.error(f"Setup Exception: {e}")
            self._update_status_cache(False)

    def process_and_send(self):
        if not self.connected or not self.client: return

        rules = []
        with CLOUD_RULES_LOCK:
            rules = list(CLOUD_UPLOAD_RULES)
        
        if not rules: return

        current_time = time.time()
        payload_values = {}
        
        with realtime_data_lock:
            rt_values = realtime_data_cache.get("realtime_values", {})
            
            for rule in rules:
                alias = rule.get('cloudKey')
                if not alias: continue

                interval = int(rule.get('interval', 60))
                last_sent = self.last_sent_map.get(alias, 0)
                
                if current_time - last_sent < interval: continue

                dev = rule.get('device')
                meas = rule.get('measure')
                
                # Lấy dữ liệu từ Cache (đã được Modbus Service đổ vào)
                val_obj = rt_values.get(dev, {}).get(meas)
                
                if val_obj and val_obj.get('value') is not None:
                    payload_values[alias] = val_obj.get('value')
                    self.last_sent_map[alias] = current_time

        if payload_values:
            final_payload = {"ts": int(current_time * 1000), "values": payload_values}
            try:
                # Topic này có thể sửa tùy Broker (đang để mặc định ThingsBoard)
                topic = "v1/devices/me/telemetry" 
                self.client.publish(topic, json.dumps(final_payload))
                logger.info(f"📤 Sent {len(payload_values)} items to Cloud.")
            except Exception as e:
                logger.error(f"Publish Error: {e}")

def start_cloud_service_task():
    manager = CloudManager()
    while True:
        try:
            manager.load_connection_config()
            manager.connect()
            manager.process_and_send()
        except Exception as e:
            logger.error(f"Cloud Loop Crash: {e}")
        eventlet.sleep(1)