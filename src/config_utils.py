import os
import json
import logging
import re
from copy import deepcopy
from constants import TARGET_CFG_FILE_PATH_GATEWAY, STATIC_FOLDER_PATH, JSON_OUTPUT_FILE_PATH
from app_state import realtime_data_lock, realtime_data_cache, CALC_TO_VIRTUAL_MAP, CALC_MAP_LOCK

_last_cfg_modified_time = 0

def rebuild_calc_mapping(json_config):
    """Quét cấu hình và lập bản đồ ánh xạ các biến được link"""
    new_map = {}
    if "measures" in json_config:
        for m in json_config["measures"]:
            calc_id = m.get("calculation_id")
            if calc_id:
                if calc_id not in new_map:
                    new_map[calc_id] = []
                new_map[calc_id].append({
                    "ctrl": m.get("ctrlName"),
                    "meas": m.get("name")
                })
    
    with CALC_MAP_LOCK:
        CALC_TO_VIRTUAL_MAP.clear()
        CALC_TO_VIRTUAL_MAP.update(new_map)
    logging.info(f"✅ Rebuilt Calc-to-Virtual Mapping: {len(new_map)} links found.")

def read_json_file_content(file_path):
    if not os.path.exists(file_path):
        logging.error(f"File not found: {file_path}")
        return None
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        logging.error(f"JSON decode error in {file_path}: {e}")
        return None
    except Exception as e:
        logging.error(f"Error reading {file_path}: {e}", exc_info=True)
        return None

def _calculate_meter_gains(config_data):
    """
    Tính toán gain từ công thức cho các measure của Meter.
    Trả về config đã cập nhật và một cờ báo hiệu có thay đổi hay không.
    """
    if not config_data or 'controllers' not in config_data or 'measures' not in config_data:
        return config_data, False

    has_changes = False
    controllers_map = {c.get('name'): c for c in config_data.get('controllers', [])}
    
    for measure in config_data.get('measures', []):
        controller = controllers_map.get(measure.get('ctrlName'))
        
        if controller and controller.get('category') == 'Meter':
            # Sử dụng gain_formula nếu có, nếu không thì fallback về gain
            formula_source = measure.get('gain_formula', measure.get('gain'))
            
            if isinstance(formula_source, str) and ('CT_Ratio' in formula_source or 'PT_Ratio' in formula_source or 'Base_Gain' in formula_source):
                try:
                    formula = formula_source
                    args = controller.get('args', {})
                    
                    ct = float(args.get('CT_Ratio', 1.0))
                    pt = float(args.get('PT_Ratio', 1.0))
                    base_gain = float(measure.get('Base_Gain', 1.0))
                    
                    eval_string = formula.replace('CT_Ratio', str(ct)) \
                                         .replace('PT_Ratio', str(pt)) \
                                         .replace('Base_Gain', str(base_gain))

                    if not re.match(r'^[\d\s\.\*\+\-\/()]+$', eval_string):
                        raise ValueError("Invalid characters in gain formula")
                        
                    calculated_value = eval(eval_string)
                    
                    # === BẮT ĐẦU SỬA LỖI: SỬ DỤNG STRING FORMATTING ===
                    # Định dạng số với tối đa 6 chữ số có nghĩa và loại bỏ số 0 thừa
                    calculated_gain_str = f'{calculated_value:.6g}'

                    
                    if measure.get('gain') != calculated_gain_str:
                        measure['gain'] = calculated_gain_str
                        has_changes = True
                        logging.info(f"Recalculated gain for {measure.get('name')}: {eval_string} = {measure['gain']}")

                except Exception as e:
                    logging.error(f"Failed to calculate gain for {measure.get('name')}. Error: {e}")
                    if measure.get('gain') != "1.0":
                        measure['gain'] = "1.0"
                        has_changes = True
                    
    return config_data, has_changes

def process_and_save_config_data(force_update=False, socketio_instance=None, app_instance=None):
    global _last_cfg_modified_time
    if not os.path.exists(TARGET_CFG_FILE_PATH_GATEWAY):
        logging.error(f"Config file not found: {TARGET_CFG_FILE_PATH_GATEWAY}")
        return
        
    current_cfg_modified_time = os.path.getmtime(TARGET_CFG_FILE_PATH_GATEWAY)
    if not force_update and current_cfg_modified_time <= _last_cfg_modified_time:
        return
        
    logging.info(f"Processing config file: {TARGET_CFG_FILE_PATH_GATEWAY}")
    json_config = read_json_file_content(TARGET_CFG_FILE_PATH_GATEWAY)
    rebuild_calc_mapping(json_config)
    
    if json_config:
        original_config_copy = deepcopy(json_config)

        # Bước 1: Tính toán và gán category
        for controller in json_config.get("controllers", []):
            if "category" not in controller:
                controller_name = controller.get("name", "").lower()
                if "logger" in controller_name:
                    controller["category"] = "Logger"
                elif "invt" in controller_name:
                    controller["category"] = "Inverter"
                elif "export" in controller_name or "dtsd" in controller_name:
                    controller["category"] = "Meter"
                else:
                    controller["category"] = "Other"
        
        # Bước 2: Gọi hàm tính toán gain và nhận lại cờ báo hiệu
        json_config, gain_has_changed = _calculate_meter_gains(json_config)

        # Bước 3: Ghi lại file .cfg nếu gain đã được tính toán lại
        if gain_has_changed:
            logging.info("Gain values have been recalculated. Writing updated config back to .cfg file.")
            try:
                with open(TARGET_CFG_FILE_PATH_GATEWAY, 'w', encoding='utf-8') as f:
                    json.dump(json_config, f, indent=4, ensure_ascii=False)
                _last_cfg_modified_time = os.path.getmtime(TARGET_CFG_FILE_PATH_GATEWAY)
            except Exception as e:
                logging.error(f"Error writing calculated gains back to {TARGET_CFG_FILE_PATH_GATEWAY}: {e}")

        # Bước 4: Trích xuất dữ liệu để tạo cache
        extracted_controllers_data = []
        controllers_by_name_temp = {}
        extracted_measures_data = []
        measures_by_name_temp = {}
        
        if "controllers" in json_config and isinstance(json_config["controllers"], list):
            for controller in json_config["controllers"]:
                args_obj = controller.get("args", {})
                controller_info = {
                    "name": controller.get("name", "N/A"),
                    "protocol": controller.get("protocol", "N/A"),
                    "endpoint": controller.get("endpoint", ""),
                    "desc": controller.get("desc", ""),
                    "category": controller.get("category", "Other"),
                    "slave_address": args_obj.get("slaveAddr", ""),
                }
                extracted_controllers_data.append(controller_info)
                controllers_by_name_temp[controller_info["name"]] = controller_info

        if "measures" in json_config and isinstance(json_config["measures"], list):
            logging.info(f"🔍 [DEBUG-BACKEND] Found {len(json_config['measures'])} measures in .cfg file.")
            
            for i, measure in enumerate(json_config["measures"]):
                # --- START DEBUG LOG ---
                raw_name = measure.get("name")
                raw_ctrl = measure.get("ctrlName")
                
                # In 5 biến đầu tiên hoặc các biến bị thiếu ctrlName để kiểm tra
                if raw_ctrl is None or i < 5:
                    logging.info(f"   👉 Measure[{i}]: Name='{raw_name}' | ctrlName in CFG='{raw_ctrl}'")
                # --- END DEBUG LOG ---

                gain_value = measure.get("gain", 1)
                try:
                    factors = float(gain_value)
                except (ValueError, TypeError):
                    factors = 1
                    logging.warning(f"Could not convert gain '{gain_value}' to float for measure '{measure.get('name')}'. Defaulting to 1.")
                
                measure_info = { 
                    "name": measure.get("name", "N/A"), 
                    "ctrlName": measure.get("ctrlName", "N/A"), # <--- Kiểm tra kỹ dòng này
                    "addr": measure.get("addr", ""), 
                    "group": measure.get("group", "N/A"), 
                    "dataType": measure.get("dataType", "UNKNOWN"), 
                    "readWrite": measure.get("readWrite", "ro"), 
                    "unit": measure.get("unit", ""),
                    "factors": factors,
                    "round_decimals": measure.get("transDecimal", 2),
                    # Thêm trường này để frontend hiển thị đúng công thức nếu có
                    "gain_formula": measure.get("gain_formula", None),
                    "calculation_id": measure.get("calculation_id", None) 
                }
                extracted_measures_data.append(measure_info)
                measures_by_name_temp[measure_info["name"]] = measure_info
        
        output_data = {"controllers": extracted_controllers_data, "measures": extracted_measures_data}
        
        try:
            os.makedirs(STATIC_FOLDER_PATH, exist_ok=True)
            with open(JSON_OUTPUT_FILE_PATH, 'w', encoding='utf-8') as f:
                json.dump(output_data, f, indent=4, ensure_ascii=False)
            
            with realtime_data_lock:
                realtime_data_cache.update({ 
                    "controllers": extracted_controllers_data, 
                    "controllers_by_name": controllers_by_name_temp, 
                    "measures": extracted_measures_data, 
                    "measures_by_name": measures_by_name_temp 
                })
            logging.info(f"Updated config: {len(extracted_controllers_data)} controllers, {len(extracted_measures_data)} measures.")

            if socketio_instance and app_instance:
                with app_instance.app_context():
                    socketio_instance.emit('configuration_updated', output_data)

        except Exception as e:
            logging.error(f"Error writing cache files or emitting socket event: {e}", exc_info=True)
            
    _last_cfg_modified_time = current_cfg_modified_time