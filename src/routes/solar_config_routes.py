# --- START OF FILE routes/solar_config_routes.py ---

import os
import json
import logging
import shutil
from datetime import datetime
import sys

real_script_path = os.path.realpath(__file__)
current_script_dir = os.path.dirname(real_script_path)
project_root = os.path.dirname(current_script_dir)
lib_path = os.path.join(project_root, 'lib')
if lib_path not in sys.path:
    sys.path.insert(0, lib_path)
from flask import Blueprint, jsonify, request
import psutil

# Import các hằng số và trạng thái từ các module tương ứng
from constants import TARGET_CFG_FILE_PATH_GATEWAY, project_root
from config_utils import process_and_save_config_data
# THAY ĐỔI: Import từ app_instance thay vì main
from app_instance import app, socketio 

# Tạo một Blueprint
solar_bp = Blueprint('solar_config', __name__)

# THAY ĐỔI: Chuyển logic map template vào đây
CON_TEMP_NAME_MAP = {}

def build_template_map():
    global CON_TEMP_NAME_MAP
    templates_dir = os.path.join(project_root, 'templates')
    if not os.path.isdir(templates_dir):
        logging.warning(f"Template directory not found: {templates_dir}")
        return
    for root, _, files in os.walk(templates_dir):
        for filename in files:
            if filename.endswith('.json'):
                try:
                    full_path = os.path.join(root, filename)
                    relative_path = os.path.relpath(full_path, templates_dir).replace(os.sep, '/')
                    with open(full_path, 'r', encoding='utf-8') as f:
                        content = json.load(f)
                    con_temp_name = content.get("controller", {}).get("conTempName")
                    if con_temp_name:
                        CON_TEMP_NAME_MAP[con_temp_name] = relative_path
                except Exception as e:
                    logging.error(f"Error processing template {filename}: {e}")
    logging.info(f"Built template map with {len(CON_TEMP_NAME_MAP)} entries.")


def set_nested_dict_value(d, path, value):
    """Gán một giá trị vào dictionary theo đường dẫn, ví dụ: 'args.slaveAddr'."""
    keys = path.split('.')
    for key in keys[:-1]:
        d = d.setdefault(key, {})
    d[keys[-1]] = value

def _apply_new_config_and_restart_supervisor(new_config_data, action="update"):
    """
    Ghi đè file config và Kill tiến trình đích danh.
    """
    # 1. Ghi thẳng file cấu hình mới (BỎ QUA BACKUP)
    try:
        with open(TARGET_CFG_FILE_PATH_GATEWAY, 'w', encoding='utf-8') as f:
            json.dump(new_config_data, f, indent=4, ensure_ascii=False)
        logging.info(f"Overwritten config file: {TARGET_CFG_FILE_PATH_GATEWAY}")
    except Exception as e:
        logging.error(f"Failed to write config file: {e}")
        return # Nếu ghi lỗi thì dừng, không kill process

    # 2. Update cache ngay lập tức
    process_and_save_config_data(force_update=True, socketio_instance=socketio, app_instance=app)
    
    # 3. Tìm và kill chính xác tiến trình "python /var/user/bin/device_supervisor"
    target_cmd_string = "python /var/user/bin/device_supervisor"
    killed = False
    
    for proc in psutil.process_iter(['pid', 'cmdline']):
        try:
            cmdline_list = proc.info.get('cmdline')
            if cmdline_list:
                # Nối danh sách lệnh thành chuỗi: ['python', '/var/...'] -> "python /var/..."
                full_cmd_str = " ".join(cmdline_list)
                
                # Kiểm tra chuỗi chính xác có nằm trong lệnh chạy không
                if target_cmd_string in full_cmd_str:
                    logging.info(f"Found target process: '{full_cmd_str}' (PID: {proc.pid}). Killing...")
                    proc.kill()
                    killed = True
                    # Không break, lỡ có 2 tiến trình chạy cùng lúc thì kill hết cho sạch
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
            
    if not killed:
        logging.warning(f"Process not found: '{target_cmd_string}'. Maybe it's not running?")
    else:
        logging.info("Supervisor process killed. System should auto-restart it.")

@solar_bp.route('/api/solar_configuration', methods=['GET', 'POST'])
def solar_configuration_manager():
    # --- PHẦN GET: ĐỌC, PHÂN LOẠI VÀ LÀM PHẲNG CẤU HÌNH ---
    if request.method == 'GET':
        try:
            with open(TARGET_CFG_FILE_PATH_GATEWAY, 'r', encoding='utf-8') as f:
                data = json.load(f)

            plant_info = {"name": "Data Insight", "location": "Hà Nội"}
            devices = []
            
            for controller in data.get('controllers', []):
                # ... (phần xác định category, protocol, endpoint, args giữ nguyên) ...
                category = controller.get("category", "Other")
                protocol = controller.get("protocol", "")
                endpoint = controller.get("endpoint", "")
                args = controller.get("args", {})
                
                # ========================================================================
                # === THAY ĐỔI: LOGIC MỚI - KIỂM TRA TRỰC TIẾP TỪNG TEMPLATE FILE ===
                uses_ct_pt = False
                con_temp_name = controller.get('conTempName')

                if con_temp_name:
                    if not CON_TEMP_NAME_MAP: build_template_map()
                    template_path_str = CON_TEMP_NAME_MAP.get(con_temp_name)
                    
                    if template_path_str:
                        templates_dir = os.path.join(project_root, 'templates')
                        full_path = os.path.abspath(os.path.join(templates_dir, template_path_str))
                        
                        try:
                            with open(full_path, 'r', encoding='utf-8') as f_template:
                                template_data = json.load(f_template)
                            
                            template_measures = template_data.get('measures', [])
                            # Kiểm tra xem có BẤT KỲ measure nào trong template này
                            # chứa 'CT_Ratio' hoặc 'PT_Ratio' trong công thức gain không.
                            uses_ct_pt = any(
                                'CT_Ratio' in str(m.get('gain_formula')) or 'PT_Ratio' in str(m.get('gain_formula'))
                                for m in template_measures
                            )
                        except FileNotFoundError:
                            logging.warning(f"Template file not found for {con_temp_name}: {full_path}")
                        except Exception as e:
                            logging.error(f"Error reading template file {full_path}: {e}")
                # ========================================================================
                
                device_flat = {
                    "id": controller.get("name"),
                    "original_name": controller.get("name"),
                    "category": category,
                    "name": controller.get("desc", controller.get("name")),
                    "protocol": protocol,
                    "slave_address": args.get("slaveAddr"),
                    "configured": bool(endpoint),
                    "conTempName": con_temp_name,
                    "args": args,
                    "uses_ct_pt": uses_ct_pt  # <-- Cờ này giờ đã chính xác cho từng thiết bị
                }

                if "Modbus-TCP" in protocol:
                    ip_port = endpoint.split(':')
                    device_flat["ip"] = ip_port[0] if len(ip_port) > 0 else ""
                    device_flat["port"] = ip_port[1] if len(ip_port) > 1 else ""
                elif "Modbus-RTU" in protocol:
                    device_flat["physical_port"] = endpoint

                devices.append(device_flat)

            return jsonify({
                "plant": plant_info, 
                "devices": sorted(devices, key=lambda x: (str(x.get('category') or 'Other'), str(x.get('id') or '')))
            })
        except Exception as e:
            logging.error(f"API GET /solar_configuration error: {e}", exc_info=True)
            return jsonify({"status": "error", "message": "Lỗi máy chủ khi đọc cấu hình."}), 500
    # --- PHẦN POST: LOGIC HOÀN CHỈNH, AN TOÀN VÀ ĐƠN NHIỆM VỤ ---
    if request.method == 'POST':
        try:
            request_payload = request.json
            logging.debug(f"--- [DEBUG] PAYLOAD NHẬN ĐƯỢC: {json.dumps(request_payload, indent=2, ensure_ascii=False)}")

            protocols_path = os.path.join(project_root, 'protocols.json')
            with open(protocols_path, 'r', encoding='utf-8') as f:
                protocol_definitions = json.load(f)
            
            frontend_devices = request_payload.get('devices', [])
            
            with open(TARGET_CFG_FILE_PATH_GATEWAY, 'r', encoding='utf-8') as f:
                final_config = json.load(f)

            # 1. Xác định danh sách tên thiết bị cuối cùng từ frontend
            final_device_names = {dev.get("original_name") for dev in frontend_devices if dev and dev.get("state") != 'deleted'}

            # 2. Lọc lại cấu hình gốc, chỉ giữ lại những thiết bị và measure còn tồn tại
            final_config['controllers'] = [c for c in final_config.get('controllers', []) if c.get('name') in final_device_names]
            final_config['measures'] = [m for m in final_config.get('measures', []) if m.get('ctrlName') in final_device_names]
            
            controllers_map = {c['name']: c for c in final_config['controllers']}

            # 3. Duyệt qua payload từ frontend để áp dụng thay đổi hoặc thêm mới
            for device_data in frontend_devices:
                device_name = device_data.get("original_name")
                if not device_name or device_data.get("state") == 'deleted':
                    continue

                # --- Xử lý THÊM MỚI ---
                if device_data.get("is_new"):
                    if device_data.get("protocol") == "Virtual Controller":
                        import time # Đảm bảo đã import time ở đầu file
                        
                        # 1. Xử lý Args: Mặc định statusTimeout = 60
                        default_args = {"statusTimeout": 60}
                        incoming_args = device_data.get("args", {})
                        final_args = default_args.copy()
                        final_args.update(incoming_args)

                        # 2. Tạo object đầy đủ các trường
                        new_controller = {
                            # Lấy _id từ frontend gửi lên (đã sinh bằng JS: vc_timestamp)
                            # Nếu không có thì backend tự sinh dự phòng
                            "_id": device_data.get("_id", f"vc_{int(time.time()*1000)}"),
                            
                            "enable": 1,
                            "protocol": "Virtual Controller",
                            "name": device_name,           # VD: "Huy"
                            "desc": device_data.get("desc", ""), 
                            "endpoint": "",
                            
                            # Các trường mặc định theo mẫu bạn yêu cầu
                            "samplePeriod": int(device_data.get("samplePeriod", 0)),
                            "expired": 0,
                            "enableDebug": 0,
                            "enablepollCycle": 0,
                            "samplePeriod2": 60,
                            
                            "args": final_args,
                            
                            # Giữ lại category để Frontend hiển thị đúng nhóm (Backend không dùng nhưng Frontend cần)
                            "category": "Other" 
                        }
                        
                        final_config['controllers'].append(new_controller)
                        logging.info(f"Added new Virtual Controller: {device_name}")
                        continue
                    protocol_key = device_data.get("protocol")
                    if not protocol_key or protocol_key not in protocol_definitions: continue
                    definition = protocol_definitions[protocol_key]
                    
                    template_path_str = device_data.get('template_path')
                    if not template_path_str: continue
                    templates_dir = os.path.join(project_root, 'templates')
                    template_path = os.path.abspath(os.path.join(templates_dir, f"{template_path_str}.json"))
                    if not os.path.exists(template_path): continue
                    
                    with open(template_path, 'r', encoding='utf-8') as f:
                        template = json.load(f)

                    new_controller = template.get('controller', {}).copy()
                    
                    new_controller.update({
                        'name': device_name,
                        'desc': device_data.get("name"),
                        'protocol': definition.get("protocolValue"),
                        'category': device_data.get("category", "Other")
                    })

                    # Ghi đè các tham số động từ người dùng (ip, port, slave)
                    for field_def in definition.get('fields', []):
                        field_name = field_def['name']
                        if field_name in device_data:
                            value = device_data[field_name]
                            if field_def['type'] == 'number' and str(value).isdigit(): value = int(value)
                            set_nested_dict_value(new_controller, field_def['targetPath'], value)
                    
                    # Ghi đè CT/PT nếu người dùng nhập
                    if 'args' in device_data:
                        user_args = device_data['args']
                        if 'CT_Ratio' in user_args: set_nested_dict_value(new_controller, 'args.CT_Ratio', float(user_args['CT_Ratio']))
                        if 'PT_Ratio' in user_args: set_nested_dict_value(new_controller, 'args.PT_Ratio', float(user_args['PT_Ratio']))
                    
                    final_config['controllers'].append(new_controller)
                    
                    # Sao chép measures từ template (vẫn giữ nguyên công thức gain nếu có)
                    for measure_def in template.get('measures', []):
                        new_measure = measure_def.copy()
                        new_measure['ctrlName'] = device_name
                        final_config['measures'].append(new_measure)
                    
                    continue 

                # --- Xử lý SỬA ĐỔI ---
                elif device_name in controllers_map:
                    target_controller = controllers_map[device_name]
                    
                    if 'name' in device_data: target_controller['desc'] = device_data.get("name")

                    # Cập nhật CT/PT
                    if 'args' in device_data:
                        user_args = device_data['args']
                        if 'CT_Ratio' in user_args and user_args['CT_Ratio'] is not None:
                            set_nested_dict_value(target_controller, 'args.CT_Ratio', float(user_args['CT_Ratio']))
                        if 'PT_Ratio' in user_args and user_args['PT_Ratio'] is not None:
                            set_nested_dict_value(target_controller, 'args.PT_Ratio', float(user_args['PT_Ratio']))
                    
                    # Cập nhật các trường protocol động
                    protocol_key = device_data.get("protocol")
                    if not protocol_key:
                        current_protocol_value = target_controller.get('protocol')
                        protocol_key = next((k for k, v in protocol_definitions.items() if v.get('protocolValue') == current_protocol_value), None)

                    if protocol_key and protocol_key in protocol_definitions:
                        definition = protocol_definitions[protocol_key]
                        target_controller['protocol'] = definition.get("protocolValue", target_controller.get('protocol'))
                        
                        special_params = {}
                        for field_def in definition.get('fields', []):
                            field_name = field_def['name']
                            if field_name in device_data:
                                value = device_data[field_name]
                                if field_def['type'] == 'number' and str(value).isdigit(): value = int(value)
                                if field_def.get('specialHandling'): special_params[field_name] = value
                                else: set_nested_dict_value(target_controller, field_def['targetPath'], value)
                        
                        if 'join_ip_port' in [f.get('specialHandling', '') for f in definition.get('fields', [])]:
                            existing_parts = target_controller.get('endpoint', ':').split(':')
                            ip = special_params.get('address', existing_parts[0] if len(existing_parts) > 0 else '')
                            port = special_params.get('port', existing_parts[1] if len(existing_parts) > 1 else '')
                            set_nested_dict_value(target_controller, 'endpoint', f"{ip}:{port}")

                    # Sửa đổi measures
                    measures_to_modify = device_data.get('measures_to_modify', {})
                    if measures_to_modify:
                        for m in final_config['measures']:
                            addr_str = str(m.get('addr'))
                            if m.get('ctrlName') == device_name and addr_str in measures_to_modify:
                                m.update(measures_to_modify[addr_str])

                    # Xóa measures
                    measures_to_remove = device_data.get('measures_to_remove', [])
                    if measures_to_remove:
                        final_config['measures'] = [m for m in final_config['measures'] if not (m.get('ctrlName') == device_name and str(m.get('addr')) in measures_to_remove)]

                    # Thêm measures
                    measures_to_add = device_data.get('measures_to_add', [])
                    if measures_to_add:
                        con_temp_name = target_controller.get('conTempName')
                        if con_temp_name:
                            if not CON_TEMP_NAME_MAP: build_template_map()
                            template_path_str = CON_TEMP_NAME_MAP.get(con_temp_name)
                            if template_path_str:
                                templates_dir = os.path.join(project_root, 'templates')
                                full_path = os.path.abspath(os.path.join(templates_dir, template_path_str))
                                with open(full_path, 'r', encoding='utf-8') as f:
                                    template_data = json.load(f)
                                
                                template_measures_map = {str(m.get('addr')): m for m in template_data.get('measures', [])}
                                for addr_to_add in measures_to_add:
                                    measure_def = template_measures_map.get(addr_to_add)
                                    if measure_def:
                                        exists = any(m.get('ctrlName') == device_name and str(m.get('addr')) == addr_to_add for m in final_config['measures'])
                                        if not exists:
                                            new_measure = measure_def.copy()
                                            new_measure['ctrlName'] = device_name
                                            final_config['measures'].append(new_measure)
                                            
            _apply_new_config_and_restart_supervisor(final_config, action="update")
            
            return jsonify({"status": "success", "message": "Cấu hình đã được áp dụng."})

        except Exception as e:
            logging.error(f"API POST /solar_configuration error: {e}", exc_info=True)
            return jsonify({"status": "error", "message": "Lỗi máy chủ khi lưu cấu hình."}), 500