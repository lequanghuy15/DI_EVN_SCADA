# --- START OF FILE db_utils.py ---

import sqlite3
import os
import logging
import time
import sys
import queue

from constants import *
from app_state import (
    DB_WRITE_QUEUE,
    last_logged_values_lock, last_logged_values_to_db_cache,
    downsample_data_buffer_1min, downsample_data_lock_1min,
    downsample_data_buffer_5min, downsample_data_lock_5min
)

# ... (phần import LTTB giữ nguyên) ...
lib_path = os.path.join(project_root, 'lib')
if lib_path not in sys.path:
    sys.path.insert(0, lib_path)
try:
    import sqlite_lttb_multi as lttb_c
    LTTB_C_MODULE_AVAILABLE = True
    logging.info("Successfully imported C-based LTTB module (sqlite_lttb_multi).")
except ImportError:
    LTTB_C_MODULE_AVAILABLE = False
    logging.warning("C-based LTTB module not found. LTTB downsampling is disabled.")


def init_sqlite_db():
    # ... (Nội dung hàm này không thay đổi)
    global last_logged_values_to_db_cache
    os.makedirs(DB_DIR, exist_ok=True)
    
    conn = sqlite3.connect(DB_FILE)
    try:
        cursor = conn.cursor()
        
        cursor.execute("PRAGMA journal_mode = WAL;")
        cursor.execute("PRAGMA cache_size = -20000;")

        # Bảng dữ liệu gốc, độ phân giải cao
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS sensor_readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp_utc_sec INTEGER NOT NULL,
                sensor_id TEXT NOT NULL,
                value REAL NOT NULL,
                UNIQUE(timestamp_utc_sec, sensor_id) ON CONFLICT REPLACE
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_sensor_id_time ON sensor_readings (sensor_id, timestamp_utc_sec);')

        # Bảng dữ liệu down-sampling (1 phút/lần)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS sensor_readings_downsampled_1min (
                timestamp_utc_min INTEGER NOT NULL,
                sensor_id TEXT NOT NULL,
                value REAL NOT NULL,
                PRIMARY KEY (sensor_id, timestamp_utc_min)
            ) WITHOUT ROWID;
        ''')
        
        # --- START: TẠO BẢNG MỚI CHO DỮ LIỆU 5 PHÚT ---
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS sensor_readings_downsampled_5min (
                timestamp_utc_5min INTEGER NOT NULL,
                sensor_id TEXT NOT NULL,
                value REAL NOT NULL,
                PRIMARY KEY (sensor_id, timestamp_utc_5min)
            ) WITHOUT ROWID;
        ''')
        # --- END: TẠO BẢNG MỚI ---
        
        conn.commit()
        
        # Tải các giá trị cuối cùng vào cache (từ bảng gốc)
        cursor.execute('''
            SELECT sensor_id, value, timestamp_utc_sec
            FROM sensor_readings
            WHERE (sensor_id, timestamp_utc_sec) IN (
                SELECT sensor_id, MAX(timestamp_utc_sec)
                FROM sensor_readings
                GROUP BY sensor_id
            )
            LIMIT 1000
        ''')
        with last_logged_values_lock:
            last_logged_values_to_db_cache.update({row[0]: {"value": row[1], "timestamp_logged_sec": row[2]} for row in cursor.fetchall()})
        logging.info(f"Initialized SQLite DB with {len(last_logged_values_to_db_cache)} last values.")

    except sqlite3.Error as e:
        logging.error(f"Failed to initialize SQLite DB: {e}", exc_info=True)
    finally:
        if conn:
            conn.close()

def db_writer_task(shutdown_event):
    logging.info("DB writer thread started.")
    while not shutdown_event.is_set():
        batch = []
        try:
            first_item = DB_WRITE_QUEUE.get(timeout=1.0)
            batch.append(first_item)
            while not DB_WRITE_QUEUE.empty() and len(batch) < BATCH_SIZE:
                try:
                    batch.append(DB_WRITE_QUEUE.get_nowait())
                except queue.Empty:
                    break
        except queue.Empty:
            continue
        
        if batch:
            try:
                conn = sqlite3.connect(DB_FILE, timeout=10)
                cursor = conn.cursor()
                cursor.executemany("INSERT INTO sensor_readings (timestamp_utc_sec, sensor_id, value) VALUES (?, ?, ?)", batch)
                conn.commit()
                # THÊM DÒNG LOG NÀY
                logging.info(f"💾 [SQLITE] Đã thực thi ghi {len(batch)} bản ghi từ Queue vào ổ đĩa.")
            except sqlite3.Error as e:
                logging.error(f"DB Writer Error: {e}")
            finally:
                if conn: conn.close()
    logging.info("DB writer thread stopped.")

def _generic_downsampling_writer_task(interval_seconds, table_name, timestamp_col_name, data_buffer, buffer_lock, shutdown_event):
    """
    Hàm chung để xử lý downsampling, ghi giá trị CUỐI CÙNG của mỗi khoảng thời gian.
    """
    logging.info(f"DB downsampling writer ({interval_seconds}s) started for table '{table_name}'.")
    time.sleep(5) 
    
    while not shutdown_event.is_set():
        current_time = time.time()
        wait_seconds = interval_seconds - (current_time % interval_seconds)
        shutdown_event.wait(wait_seconds)
        if shutdown_event.is_set():
            break

        timestamp_to_log = (int(time.time()) // interval_seconds - 1) * interval_seconds

        data_to_process = {}
        with buffer_lock:
            if data_buffer:
                data_to_process = data_buffer.copy()
                data_buffer.clear()
        
        if data_to_process:
            batch = [(timestamp_to_log, sensor_id, data['value']) for sensor_id, data in data_to_process.items()]

            if batch:
                conn = None
                try:
                    conn = sqlite3.connect(DB_FILE, timeout=10)
                    cursor = conn.cursor()
                    cursor.executemany(f"INSERT OR REPLACE INTO {table_name} ({timestamp_col_name}, sensor_id, value) VALUES (?, ?, ?)", batch)
                    conn.commit()
                    logging.info(f"DB Writer ({interval_seconds}s): Wrote last values for {len(batch)} sensors.")
                except sqlite3.Error as e:
                    logging.error(f"DB Writer ({interval_seconds}s): Error writing batch: {e}", exc_info=True)
                    if conn: conn.rollback()
                finally:
                    if conn: conn.close()
                
    logging.info(f"DB downsampling writer ({interval_seconds}s) stopped.")

def start_1min_downsampler(shutdown_event):
    _generic_downsampling_writer_task(60, "sensor_readings_downsampled_1min", "timestamp_utc_min", downsample_data_buffer_1min, downsample_data_lock_1min, shutdown_event)

def start_5min_downsampler(shutdown_event):
    _generic_downsampling_writer_task(300, "sensor_readings_downsampled_5min", "timestamp_utc_5min", downsample_data_buffer_5min, downsample_data_lock_5min, shutdown_event)

def get_historical_readings(sensor_ids, start_timestamp_sec, end_timestamp_sec, resolution='auto', n_out=1440):
    # ... (Nội dung hàm này không thay đổi)
    try:
        target_table, timestamp_col, use_lttb = (None, None, False)

        # --- BƯỚC 1: QUYẾT ĐỊNH SỬ DỤNG NGUỒN DỮ LIỆU NÀO ---
        if resolution == 'raw':
            target_table, timestamp_col, use_lttb = "sensor_readings", "timestamp_utc_sec", False
            logging.info("Forcing fetch from HIGH-RES table due to user request.")
        elif resolution == '1min':
            target_table, timestamp_col, use_lttb = "sensor_readings_downsampled_1min", "timestamp_utc_min", True
            logging.info("Forcing fetch from 1-MIN table due to user request.")
        elif resolution == '5min':
            target_table, timestamp_col, use_lttb = "sensor_readings_downsampled_5min", "timestamp_utc_5min", True
            logging.info("Forcing fetch from 5-MIN table due to user request.")
        else: # Chế độ 'auto'
            query_duration_sec = end_timestamp_sec - start_timestamp_sec
            QUERY_THRESHOLD_1MIN_SECONDS = 3 * 3600
            QUERY_THRESHOLD_5MIN_SECONDS = 3 * 24 * 3600

            if query_duration_sec > QUERY_THRESHOLD_5MIN_SECONDS:
                target_table, timestamp_col, use_lttb = "sensor_readings_downsampled_5min", "timestamp_utc_5min", True
                logging.info(f"Auto-selecting 5-MIN table for long query.")
            elif query_duration_sec > QUERY_THRESHOLD_1MIN_SECONDS:
                target_table, timestamp_col, use_lttb = "sensor_readings_downsampled_1min", "timestamp_utc_min", True
                logging.info(f"Auto-selecting 1-MIN table for medium query.")
            else:
                target_table, timestamp_col, use_lttb = "sensor_readings", "timestamp_utc_sec", False
                logging.info(f"Auto-selecting HIGH-RES table for short query.")
        # --- END: LOGIC CHỌN BẢNG DỮ LIỆU ---

        if LTTB_C_MODULE_AVAILABLE and use_lttb:
            logging.info(f"Using C-LTTB on '{target_table}'. Target points: {n_out}.")
            return lttb_c.get_historical(
                DB_FILE, target_table, timestamp_col, sensor_ids,
                start_timestamp_sec, end_timestamp_sec, n_out
            )

        # Fallback - Sử dụng Python
        conn = None
        try:
            conn = sqlite3.connect(f"file:{DB_FILE}?mode=ro", uri=True)
            cursor = conn.cursor()
            grouped_results = {}
            
            query_parts = []
            params = []

            if sensor_ids:
                placeholders = ','.join('?' for _ in sensor_ids)
                query_parts.append(f"sensor_id IN ({placeholders})")
                params.extend(sensor_ids)

            query_parts.append(f"{timestamp_col} BETWEEN ? AND ?")
            params.extend([start_timestamp_sec, end_timestamp_sec])

            where_clause = " AND ".join(query_parts)
            full_query = f"SELECT {timestamp_col}, sensor_id, value FROM {target_table} WHERE {where_clause} ORDER BY {timestamp_col} ASC"
            
            cursor.execute(full_query, params)
            
            found_sensor_ids = set()
            for timestamp, sensor_id, value in cursor.fetchall():
                if sensor_id not in grouped_results:
                    grouped_results[sensor_id] = []
                grouped_results[sensor_id].append({"timestamp": timestamp, "value": value})
                found_sensor_ids.add(sensor_id)

            if sensor_ids:
                missing_sensor_ids = set(sensor_ids) - found_sensor_ids
                for s_id in missing_sensor_ids:
                    latest_query = f'SELECT {timestamp_col}, value FROM {target_table} WHERE sensor_id = ? ORDER BY {timestamp_col} DESC LIMIT 1'
                    cursor.execute(latest_query, (s_id,))
                    latest_reading = cursor.fetchone()
                    if latest_reading:
                        grouped_results[s_id] = [{"timestamp": latest_reading[0], "value": latest_reading[1]}]
            
            return grouped_results
        finally:
            if conn:
                conn.close()

    except Exception as e:
        logging.error(f"An unexpected error during historical data fetch: {e}", exc_info=True)
        return {}