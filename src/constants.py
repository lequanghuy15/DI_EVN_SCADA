# --- START OF FILE constants.py ---

import os
import socket

# Đường dẫn dự án
real_script_path = os.path.realpath(__file__)
current_script_dir = os.path.dirname(real_script_path)
project_root = os.path.dirname(current_script_dir)
STATIC_FOLDER_PATH = os.path.join(project_root, 'web_frontend')
JSON_OUTPUT_FILE_PATH = os.path.join(STATIC_FOLDER_PATH, 'customer_data.json')
TARGET_CFG_FILE_PATH_GATEWAY = "/var/user/cfg/device_supervisor/device_supervisor.cfg"

# SQLite DB
DB_DIR = "/var/user/data/database"
DB_FILE = os.path.join(DB_DIR, "sensor_history.db")
BATCH_SIZE = 1000
DAYS_TO_KEEP_HIGH_RES_DATA = 7
DAYS_TO_KEEP_1MIN_DATA = 30
DAYS_TO_KEEP_5MIN_DATA = 180

# MQTT
EMQX_BROKER_HOST = "127.0.0.1"
EMQX_BROKER_PORT = 9009
MQTT_TOPIC_SUBSCRIBE = "internal/modbus/telemetry" 
MQTT_COMMAND_TOPIC = "ds2/eventbus/south/write/1010" 
MQTT_COMMAND_RESPONSE_TOPIC = "ds2/eventbus/south/write/1010/response"

# API Gateway
dsa_gateway_host = "1.1.1.1"
api_username = "adm"
api_password = "Taidemo01"

# Danh sách sensor cần ghi vào SQLite