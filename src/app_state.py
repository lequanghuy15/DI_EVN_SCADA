# --- START OF FILE app_state.py ---

import threading
import queue

# Hàng đợi ghi vào Database
DB_WRITE_QUEUE = queue.Queue(maxsize=10000)

# Cache dữ liệu thời gian thực
realtime_data_cache = {
    "controllers": [], "controllers_by_name": {},
    "measures": [], "measures_by_name": {},
    "realtime_values": {}, "last_update_timestamp": 0,
    "iec104_status": {"service_overall_status": "N/A", "service_runtime": "N/A", "active_links": []},
    "health_status": {}
}
realtime_data_lock = threading.Lock()

# Cache cho việc ghi DB và downsampling
last_logged_values_to_db_cache = {}
last_logged_values_lock = threading.Lock()

downsample_data_buffer_1min = {}
downsample_data_lock_1min = threading.Lock()

downsample_data_buffer_5min = {}
downsample_data_lock_5min = threading.Lock()

# Trạng thái API
current_api_token = None
CALCULATION_RULES = []
CALCULATION_RULES_LOCK = threading.Lock()

CLOUD_UPLOAD_RULES = []
CLOUD_RULES_LOCK = threading.Lock()

LOGGING_WHITELIST = set() 
LOGGING_RULES_LOCK = threading.Lock()

DAILY_SNAPSHOTS = {
    "date": "",
    "values": {}
}
SNAPSHOT_LOCK = threading.Lock()

MANUAL_STATES = {} 
MANUAL_STATES_LOCK = threading.Lock()
MANUAL_STATES_FILE = "manual_states.json"

CALC_TO_VIRTUAL_MAP = {}
CALC_MAP_LOCK = threading.Lock()