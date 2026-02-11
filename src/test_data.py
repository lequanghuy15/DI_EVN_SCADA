import sqlite3
import os
import logging
from constants import *
from datetime import datetime
import sys
import csv
import time
real_script_path = os.path.realpath(__file__)
current_script_dir = os.path.dirname(real_script_path)
project_root = os.path.dirname(current_script_dir)
lib_path = os.path.join(project_root, 'lib')
if lib_path not in sys.path:
    sys.path.insert(0, lib_path)
import sqlite_lttb_multi

start_ts = int(time.time()) - 24 * 3600  # timestamp UTC (ví dụ)
end_ts   = int(time.time())
n_out = 500  # số điểm cần giảm xuống

result = sqlite_lttb_multi.get_historical(DB_FILE, LOGGED_SENSORS, start_ts, end_ts, n_out)
print(result)