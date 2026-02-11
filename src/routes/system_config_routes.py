import os
import json
import logging
import sys
from copy import deepcopy
import time
import secrets
def generate_random_id(length=16):
    return secrets.token_hex(length // 2)

# Thiết lập đường dẫn
real_script_path = os.path.realpath(__file__)
current_script_dir = os.path.dirname(real_script_path)
project_root = os.path.dirname(current_script_dir)
lib_path = os.path.join(project_root, 'lib')
if lib_path not in sys.path:
    sys.path.insert(0, lib_path)
    
from flask import Blueprint, jsonify, request

from constants import TARGET_CFG_FILE_PATH_GATEWAY, project_root 
from config_utils import read_json_file_content
from routes.solar_config_routes import _apply_new_config_and_restart_supervisor, build_template_map, CON_TEMP_NAME_MAP, set_nested_dict_value

system_bp = Blueprint('system_config', __name__)

def _read_full_config():
    return read_json_file_content(TARGET_CFG_FILE_PATH_GATEWAY)


@system_bp.route('/api/system_configuration', methods=['GET'])
def get_system_configuration():
    """
    API GET: Trả về cấu hình hệ thống hiện tại (ban đầu chỉ là cổng COM).
    """
    try:
        config = _read_full_config()
        if not config:
            logging.error("[SystemRoutes] Failed to read config file on GET request.")
            return jsonify({"status": "error", "message": "Could not read config file."}), 500
        
        # Chỉ trả về phần misc.coms
        coms_config = config.get('misc', {}).get('coms', [])
        clouds_config = config.get('clouds', [])
        iec104_config = config.get('iec104Server', {})
        
        return jsonify({
            "status": "success",
            "coms": coms_config,
            "clouds": clouds_config,
            "iec104": iec104_config
        })
    except Exception as e:
        logging.error(f"API GET /system_configuration error: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Lỗi máy chủ khi đọc cấu hình hệ thống."}), 500

# --- TRONG FILE: routes/system_config_routes.py ---

@system_bp.route('/api/system_configuration', methods=['POST'])
def apply_unified_configuration():
    try:
        request_payload = request.json
        
        # 1. ĐỌC CẤU HÌNH GỐC TỪ FILE
        current_full_config = _read_full_config()
        if not current_full_config:
            current_full_config = {"controllers": [], "measures": []}

        # Load định nghĩa protocol để map IP/Port/Slave vào đúng vị trí
        protocols_path = os.path.join(project_root, 'protocols.json')
        with open(protocols_path, 'r', encoding='utf-8') as f:
            protocol_definitions = json.load(f)

        # ======================================================================
        # PHẦN 1: XỬ LÝ CONTROLLERS & MEASURES
        # ======================================================================
        devices_payload = request_payload.get('devices')
        
        if devices_payload is not None:
            existing_ctrls_map = {c['name']: c for c in current_full_config.get('controllers', [])}
            final_controllers_list = []
            
            # Tên các thiết bị có trong payload (để xóa measures cũ của chúng và nạp lại)
            updated_device_names = [dev.get("original_name") for dev in devices_payload]
            deleted_device_names = [dev.get("original_name") for dev in devices_payload if dev.get("state") == 'deleted']

            # Giữ lại measures của những thiết bị KHÔNG nằm trong danh sách thay đổi/xóa
            final_measures_list = [
                m for m in current_full_config.get('measures', []) 
                if m.get('ctrlName') not in updated_device_names
            ]

            for dev_data in devices_payload:
                dev_name = dev_data.get("original_name")
                
                if dev_data.get("state") == 'deleted':
                    continue 

                # --------------------------------------------------------------
                # TRƯỜNG HỢP 1: THÊM MỚI (is_new)
                # --------------------------------------------------------------
                if dev_data.get("is_new"):
                    # --- BƯỚC 1: XÁC ĐỊNH GIAO THỨC TRƯỚC ---
                    raw_proto = dev_data.get("protocol", "").lower()
                    is_tcp = "tcp" in raw_proto
                    protocol_label = "Modbus-TCP" if is_tcp else "Modbus-RTU"

                    # --- BƯỚC 2: KHỞI TẠO BỘ KHUNG (SKELETON) THEO ĐÚNG MẪU BẠN CẤP ---
                    new_ctrl = {
                        "_id": generate_random_id(16),
                        "enable": 1,
                        "protocol": protocol_label,
                        "name": dev_name,
                        "desc": dev_data.get("name", dev_name),
                        "samplePeriod": 10,
                        "enablepollCycle": 0,
                        "expired": 1000,
                        "enableDebug": 0,
                        "category": dev_data.get("category", "Other"),
                        "args": {
                            "slaveAddr": 1,
                            "enableMsecSample": 0,
                            "continuousAcquisition": 1,
                            "maxContinuousNumber": 64,
                            "communicationInterval": 10 if is_tcp else 100,
                            "writeCoilFunction": 15,
                            "writeRegisterFunction": 16
                        }
                    }

                    # Cấu hình đặc thù cho TCP
                    if is_tcp:
                        new_ctrl["args"]["connectTimeOut"] = 10000
                        ip = dev_data.get('address', '127.0.0.1')
                        port = dev_data.get('port', 502)
                        new_ctrl["endpoint"] = f"{ip}:{port}"
                    # Cấu hình đặc thù cho RTU
                    else:
                        new_ctrl["endpoint"] = dev_data.get('physical_port', 'rs485')

                    # --- BƯỚC 3: NẾU CÓ TEMPLATE THÌ GHI ĐÈ THAM SỐ SÂU ---
                    template_path_rel = dev_data.get('template_path')
                    if template_path_rel:
                        full_tmpl_path = os.path.join(project_root, 'templates', f"{template_path_rel}.json")
                        if os.path.exists(full_tmpl_path):
                            with open(full_tmpl_path, 'r', encoding='utf-8') as f:
                                tmpl_json = json.load(f)
                            
                            tmpl_ctrl = tmpl_json.get('controller', {})
                            
                            # Ghi đè các giá trị từ template vào khung (trừ ID và Name)
                            for key, val in tmpl_ctrl.items():
                                if key in ["_id", "name", "endpoint", "protocol"]: 
                                    continue
                                if key == "args":
                                    new_ctrl["args"].update(val)
                                else:
                                    new_ctrl[key] = val
                            
                            # Nạp measures từ template
                            for m in tmpl_json.get('measures', []):
                                new_m = m.copy()
                                new_m['ctrlName'] = dev_name
                                final_measures_list.append(new_m)

                    # --- BƯỚC 4: GHI ĐÈ THÔNG SỐ TỪ NGƯỜI DÙNG (SLAVE, CT/PT) ---
                    if 'args' in dev_data:
                        u_args = dev_data['args']
                        if 'slaveAddr' in u_args:
                            new_ctrl['args']['slaveAddr'] = int(u_args['slaveAddr'])
                        if 'CT_Ratio' in u_args:
                            new_ctrl['args']['CT_Ratio'] = float(u_args['CT_Ratio'])
                        if 'PT_Ratio' in u_args:
                            new_ctrl['args']['PT_Ratio'] = float(u_args['PT_Ratio'])

                    final_controllers_list.append(new_ctrl)


                # --------------------------------------------------------------
                # TRƯỜNG HỢP 2: CẬP NHẬT (Sửa thiết bị cũ)
                # --------------------------------------------------------------
                elif dev_name in existing_ctrls_map:
                    ctrl = existing_ctrls_map[dev_name]
                    if 'name' in dev_data: ctrl['desc'] = dev_data.get("name")
                    if 'args' in dev_data: ctrl['args'].update(dev_data['args'])
                    if "Modbus-TCP" in str(ctrl.get("protocol")):
                        # Lấy IP cũ nếu người dùng không nhập mới
                        current_endpoint = str(ctrl.get('endpoint', ''))
                        old_ip = current_endpoint.split(':')[0] if ':' in current_endpoint else ""
                        
                        # Lấy giá trị mới từ UI
                        new_ip = dev_data.get('address', old_ip)
                        new_port = dev_data.get('port', 502) # Mặc định 502 nếu thiếu
                        
                        # Ghi đè endpoint chuẩn format
                        ctrl['endpoint'] = f"{new_ip}:{new_port}"
                    elif 'endpoint' in dev_data: 
                        # Với RS485/RS232 thì lấy trực tiếp (VD: "rs485")
                        ctrl['endpoint'] = dev_data['endpoint']
                    
                    # Giữ lại measures cũ để xử lý modify/remove ở dưới
                    device_old_measures = [m for m in current_full_config.get('measures', []) if m.get('ctrlName') == dev_name]
                    final_measures_list.extend(device_old_measures)
                    final_controllers_list.append(ctrl)

            # --- C. XỬ LÝ SỬA/XÓA/THÊM MEASURES THỦ CÔNG (Dành cho cả VC và sửa thiết bị) ---
            for dev_data in devices_payload:
                dev_name = dev_data.get("original_name")
                
                # Sửa đổi
                to_modify = dev_data.get('measures_to_modify', {})
                for m in final_measures_list:
                    if m['ctrlName'] == dev_name:
                        key = str(m.get('addr')) if m.get('addr') else m.get('name')
                        if key in to_modify: m.update(to_modify[key])

                # Xóa bớt
                to_remove = set(dev_data.get('measures_to_remove', []))
                if to_remove:
                    final_measures_list = [
                        m for m in final_measures_list 
                        if not (m['ctrlName'] == dev_name and (str(m.get('addr')) in to_remove or m.get('name') in to_remove))
                    ]
                
                # Thêm thủ công (Dành cho Virtual Controller hoặc thêm biến lẻ)
                to_add = dev_data.get('measures_to_add', [])
                if to_add and dev_data.get("protocol") == "Virtual Controller":
                    for m_obj in to_add:
                        if isinstance(m_obj, dict):
                            m_obj['ctrlName'] = dev_name
                            if '_is_new' in m_obj: del m_obj['_is_new']
                            final_measures_list.append(m_obj)

            current_full_config['controllers'] = final_controllers_list
            current_full_config['measures'] = final_measures_list

        # ======================================================================
        # PHẦN 2: XỬ LÝ SYSTEM (COMS, CLOUD, IEC104)
        # ======================================================================
        if request_payload.get('coms'):
            if 'misc' not in current_full_config: current_full_config['misc'] = {}
            current_full_config['misc']['coms'] = request_payload['coms']
            
        if request_payload.get('clouds'):
            current_full_config['clouds'] = request_payload['clouds']
            
        if request_payload.get('iec104'):
            if 'iec104Server' not in current_full_config: current_full_config['iec104Server'] = {}
            current_full_config['iec104Server'].update(request_payload['iec104'])
            # Đảm bảo mapping_table không mất
            if 'mapping_table' not in current_full_config['iec104Server']:
                current_full_config['iec104Server']['mapping_table'] = []

        # ======================================================================
        # PHẦN 3: CỨU HỘ & TỰ SỬA LỖI (QUAN TRỌNG NHẤT)
        # ======================================================================
        # Đảm bảo group 'default' luôn tồn tại để tránh crash
        if 'groups' not in current_full_config or not isinstance(current_full_config['groups'], list):
            current_full_config['groups'] = []
            
        has_default = any(g.get('name') == 'default' for g in current_full_config['groups'])
        if not has_default:
            logging.warning("Auto-repairing missing 'default' group.")
            current_full_config['groups'].append({
                "_id": f"group_{int(time.time())}",
                "name": "default",
                "uploadInterval": 60,
                "LwTSDBSize": 1000,
                "strategy": 1,
                "enablePerOnchange": 0,
                "historyDataMode": "gateway",
                "historyDataPath": "/var/user/data/dbhome/device_supervisor/LwTSDB"
            })

        if 'alarmLables' not in current_full_config:
            current_full_config['alarmLables'] = ["default"]
            
        if 'alarms' not in current_full_config:
            current_full_config['alarms'] = []

        # ======================================================================
        # PHẦN 4: LƯU FILE
        # ======================================================================
        _apply_new_config_and_restart_supervisor(current_full_config, action="unified_update")
        
        return jsonify({"status": "success", "message": "Cấu hình đã được cập nhật an toàn."})

    except Exception as e:
        logging.error(f"Critical Error in apply_unified_configuration: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500  