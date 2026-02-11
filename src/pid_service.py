import os
import sys
import time
import logging
import json
real_script_path = os.path.realpath(__file__)
current_script_dir = os.path.dirname(real_script_path)
project_root = os.path.dirname(current_script_dir)
lib_path = os.path.join(project_root, 'lib')
if lib_path not in sys.path:
    sys.path.insert(0, lib_path)
import paho.mqtt.publish as publish
from constants import EMQX_BROKER_HOST, EMQX_BROKER_PORT, MQTT_COMMAND_TOPIC

logger = logging.getLogger(__name__)

# --- LỚP PID (LINH HOẠT VỚI Kp/kp) ---
class PID:
    """Bộ điều khiển PID đã được nâng cấp để linh hoạt hơn."""
    def __init__(self, dt, **kwargs):
        self.Kp = float(kwargs.get('Kp', kwargs.get('kp', 0.0)))
        self.Ki = float(kwargs.get('Ki', kwargs.get('ki', 0.0)))
        self.Kd = float(kwargs.get('Kd', kwargs.get('kd', 0.0)))
        self.dt = float(dt)
        self.prev_error, self.integral = 0.0, 0.0

    def compute(self, setpoint, measurement):
        error = setpoint - measurement
        self.integral += error * self.dt
        derivative = (error - self.prev_error) / self.dt
        output = (self.Kp * error + self.Ki * self.integral + self.Kd * derivative)
        self.prev_error = error
        return output

# --- HÀM GỬI LỆNH (HELPER FUNCTION) ---
def send_mqtt_command(controller_name, measure_name, value):
    """Hàm tiện ích để gửi một lệnh ghi duy nhất qua MQTT."""
    try:
        # Làm tròn giá trị số trước khi gửi
        if isinstance(value, float):
            value = round(value, 2)
            
        command_payload = {
            "payload": [{"name": controller_name, "measures": [{"name": measure_name, "value": value}]}]
        }
        publish.single(MQTT_COMMAND_TOPIC, payload=json.dumps(command_payload), hostname=EMQX_BROKER_HOST, port=EMQX_BROKER_PORT, qos=1)
        logger.info(f"Sent Command: {controller_name}/{measure_name} = {value}")
    except Exception as e:
        logger.error(f"Failed to send MQTT command for {measure_name}: {e}")

# --- HÀM DỊCH VỤ CHÍNH (PHIÊN BẢN CUỐI CÙNG) ---
def run_pid_controller_service(config_cache, config_lock):
    logger.info("Dịch vụ điều khiển PID (Đầy đủ Logic) đang khởi động...")
    
    pid = None
    # TODO: Đọc các tham số này từ file config.yaml của bạn
    pid_params = {"Kp": 0.9, "Ki": 0.08, "Kd": 0.0} 
    system_params = {"cycle_time_seconds": 1.0, "invt_max_power_kw": 1540}
    
    # --- Biến để lưu trạng thái của bộ lọc ---
    p_grid_meas_prev = 0.0
    
    # --- Cấu hình cho Heartbeat ---
    HEARTBEAT_INTERVAL_SECONDS = 30
    last_heartbeat_time = 0
    EVN_HEARTBEAT_MEASURES = [
        "EVN:Enable_Adj", "EVN:Enable_Invt", "INVT_T:T_PowerFact", "PM01:PowerSetkW", 
        "PM01:PowerSetPe", "INVT_T:Freq", "INVT_1:YEnergy", "INVT_2:YEnergy", 
        "INVT_3:YEnergy", "EVN:Enable_QAdj"
    ]

    # === CẶP ĐIỀU KHIỂN & BIẾN ===
    # [ĐẦU VÀO]
    INPUT_SETPOINT = ("EVN", "PM01:PowerSetkW")
    INPUT_GRID_MEAS = ("Zero_Export", "PM01:ActivePowerSum")
    INPUT_INVT_MEAS = ("Logger", "INVT_T:ActivePowerSum")
    INPUT_INVT_MODE = ("Logger", "INVT_T:Mode")
    INPUT_INVT_POWERSET_READ = ("Logger", "INVT_T:PowerSetkW")
    # [ĐẦU RA]
    OUTPUT_INVT_COMMAND = ("Logger", "INVT_T:PowerSetkW")
    OUTPUT_INVT_MODE_COMMAND = ("Logger", "INVT_T:Mode")
    # ==============================

    while True:
        cycle_start_time = time.time()
        try:
            # === LOGIC HEARTBEAT TOÀN DIỆN ===
            if (cycle_start_time - last_heartbeat_time) >= HEARTBEAT_INTERVAL_SECONDS:
                try:
                    with config_lock:
                        realtime_values = config_cache.get("realtime_values", {})
                        measures_config = config_cache.get("measures_by_name", {})
                    
                    measures_to_refresh = []
                    for measure_name in EVN_HEARTBEAT_MEASURES:
                        measure_info = measures_config.get(measure_name)
                        if not measure_info: continue
                        
                        ctrl_name = measure_info.get("ctrlName")
                        current_value = realtime_values.get(ctrl_name, {}).get(measure_name, {}).get('value')
                        
                        if current_value is not None:
                            measures_to_refresh.append({"name": measure_name, "value": current_value})

                    if measures_to_refresh:
                        heartbeat_payload = {"payload": [{"name": "EVN", "measures": measures_to_refresh}]}
                        publish.single(MQTT_COMMAND_TOPIC, payload=json.dumps(heartbeat_payload), hostname=EMQX_BROKER_HOST, port=EMQX_BROKER_PORT, qos=0)
                        logger.info(f"Sent EVN heartbeat for {len(measures_to_refresh)} measures.")
                    
                    last_heartbeat_time = cycle_start_time
                except Exception as hb_err:
                    logger.warning(f"Failed to send EVN heartbeat: {hb_err}")

            # --- LOGIC ĐIỀU KHIỂN PID ---
            with config_lock:
                realtime_values = config_cache.get("realtime_values", {})
            
            if pid is None: pid = PID(dt=system_params['cycle_time_seconds'], **pid_params)
            
            # === PHA 1: ĐỌC DỮ LIỆU TỪ CACHE ===
            P_Grid_Set_kW = realtime_values.get(INPUT_SETPOINT[0], {}).get(INPUT_SETPOINT[1], {}).get('value')
            P_Grid_Meas_raw = realtime_values.get(INPUT_GRID_MEAS[0], {}).get(INPUT_GRID_MEAS[1], {}).get('value')
            P_Invt_Meas = realtime_values.get(INPUT_INVT_MEAS[0], {}).get(INPUT_INVT_MEAS[1], {}).get('value')
            Current_Invt_Mode = realtime_values.get(INPUT_INVT_MODE[0], {}).get(INPUT_INVT_MODE[1], {}).get('value')
            Current_Invt_PowerSet = realtime_values.get(INPUT_INVT_POWERSET_READ[0], {}).get(INPUT_INVT_POWERSET_READ[1], {}).get('value')

            if any(v is None for v in [P_Grid_Set_kW, P_Grid_Meas_raw, P_Invt_Meas]):
                logger.debug(f"PID Skip: Not enough data in cache. Set:{P_Grid_Set_kW}, Grid:{P_Grid_Meas_raw}, Invt:{P_Invt_Meas}")
                continue

            # ÁP DỤNG BỘ LỌC (FILTER)
            P_Grid_Meas_Ft = 0.2 * float(P_Grid_Meas_raw) + 0.8 * p_grid_meas_prev
            p_grid_meas_prev = float(P_Grid_Meas_raw)

            # === PHA 2: TÍNH TOÁN ===
            adjustment = pid.compute(float(P_Grid_Set_kW), P_Grid_Meas_Ft)
            P_Invt_Set = float(P_Invt_Meas) + adjustment
            
            if P_Invt_Set > system_params['invt_max_power_kw']: P_Invt_Set = system_params['invt_max_power_kw']
            if P_Invt_Set < 0: P_Invt_Set = 0
            
            P_Invt_Set_Final = round(P_Invt_Set, 2)

            # === PHA 3: LOGIC CHUYỂN MODE & GHI LỆNH ===
            if float(P_Grid_Set_kW) == 0:
                if Current_Invt_Mode is not None and Current_Invt_Mode != 6:
                    logger.info("Setpoint is 0. Commanding Inverter to Mode 6 (Zero Export).")
                    send_mqtt_command(OUTPUT_INVT_MODE_COMMAND[0], OUTPUT_INVT_MODE_COMMAND[1], 6)
            else:
                if Current_Invt_Mode is not None and Current_Invt_Mode != 4:
                    logger.info("Setpoint is active. Commanding Inverter to Mode 4 (Power Control).")
                    send_mqtt_command(OUTPUT_INVT_MODE_COMMAND[0], OUTPUT_INVT_MODE_COMMAND[1], 4)
                
                if Current_Invt_PowerSet is None or abs(P_Invt_Set_Final - float(Current_Invt_PowerSet)) > 1.0:
                    send_mqtt_command(OUTPUT_INVT_COMMAND[0], OUTPUT_INVT_COMMAND[1], P_Invt_Set_Final)
                else:
                    logger.debug(f"Command value {P_Invt_Set_Final} is close to current setpoint {Current_Invt_PowerSet}. Skipping write command.")

        except Exception as e:
            logger.error(f"Critical error in PID loop: {e}", exc_info=True)
        
        # Đảm bảo chu kỳ chính xác
        cycle_end_time = time.time()
        elapsed = cycle_end_time - cycle_start_time
        sleep_time = system_params['cycle_time_seconds'] - elapsed
        if sleep_time > 0:
            time.sleep(sleep_time)