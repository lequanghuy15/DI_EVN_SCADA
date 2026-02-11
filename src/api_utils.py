import time
import base64
import urllib.request
import urllib.error
import json
import logging
import ssl
import errno
# Sửa đổi import
from constants import dsa_gateway_host, api_username, api_password
from app_state import current_api_token, realtime_data_lock, realtime_data_cache
# ... phần còn lại của file giữ nguyên ...

def login_and_get_token(host, username, password):
    login_url = f"https://{host}/v1/user/login"
    credentials = f"{username}:{password}"
    encoded_credentials = base64.b64encode(credentials.encode('utf-8')).decode('utf-8')
    headers = {"Authorization": f"Basic {encoded_credentials}", "Content-Type": "application/json"}
    try:
        context = ssl._create_unverified_context()
        req = urllib.request.Request(login_url, headers=headers)
        with urllib.request.urlopen(req, timeout=10, context=context) as response:
            login_data = json.loads(response.read().decode())
            web_session_token = login_data.get('results', {}).get('web_session')
            if web_session_token:
                logging.info("API login successful.")
                return web_session_token
            logging.error("API login failed: No web_session in response.")
            return None
    except urllib.error.HTTPError as e:
        # Giữ lại để xử lý các lỗi HTTP khác (404, 500...)
        logging.error(f"API login HTTP error: {e.code}")
        return None
    except urllib.error.URLError as e:
        # Bắt riêng lỗi URLError, là lỗi chứa các vấn đề về kết nối mạng
        # Kiểm tra xem có phải lỗi ENETUNREACH (Network is unreachable) không
        if isinstance(e.reason, OSError) and e.reason.errno == errno.ENETUNREACH:
            # Nếu đúng, chỉ ghi một dòng log INFO ngắn gọn
            logging.info(f"API login skipped: Network to {host} is unreachable (ENETUNREACH). This is expected.")
        else:
            # Nếu là một lỗi mạng khác (ví dụ: không phân giải được tên miền), ghi lỗi như bình thường
            logging.error(f"API login URL error: {e.reason}")
        return None
    except Exception as e:
        # Bắt tất cả các lỗi khác và vẫn in traceback để gỡ lỗi khi cần
        logging.error(f"API login unexpected error: {e}", exc_info=True)
        return None

def get_iec104_status(host, token, api_username, api_password, max_retries=1):
    global current_api_token
    request_url = f"https://{host}/v1/apps/device/supervisor2/north/basic/status?service=iec104-server"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    for attempt in range(max_retries + 1):
        try:
            context = ssl._create_unverified_context()
            req = urllib.request.Request(request_url, headers=headers)
            with urllib.request.urlopen(req, timeout=10, context=context) as response:
                return json.loads(response.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 401 and attempt < max_retries:
                new_token = login_and_get_token(host, api_username, api_password)
                if new_token:
                    current_api_token = new_token
                    headers["Authorization"] = f"Bearer {new_token}"
                    continue
            logging.error(f"IEC104: HTTP error: {e.code}")
            return None
        except Exception as e:
            logging.error(f"IEC104: Error: {e}", exc_info=True)
            return None

def iec104_monitor_task(socketio, app, interval_seconds=9999999999999):
    global current_api_token
    logging.info(f"IEC104 monitor task started, interval {interval_seconds}s.")
    if dsa_gateway_host != "YOUR_GATEWAY_IP_OR_DOMAIN" and api_username != "YOUR_API_USERNAME" and api_password != "YOUR_API_PASSWORD":
        current_api_token = login_and_get_token(dsa_gateway_host, api_username, api_password)
    while True:
        if current_api_token:
            iec104_data = get_iec104_status(dsa_gateway_host, current_api_token, api_username, api_password)
            if iec104_data:
                with realtime_data_lock:
                    service_status = iec104_data.get('result', {}).get('service_status', {})
                    link_statuses = iec104_data.get('result', {}).get('link_status', [])
                    service_overall_status = "Running" if service_status.get('status') == 2 else ("Not Started" if service_status.get('status') == 0 else "Unknown")
                    realtime_data_cache["iec104_status"] = {
                        "service_overall_status": service_overall_status,
                        "service_runtime": service_status.get('runtime', 'N/A'),
                        "active_links": [
                            {
                                "id": link.get('id'), "ip": link.get('ip'), "port": link.get('port'),
                                "status": "Connected" if service_overall_status == "Running" else "Disconnected",
                                "status_code": link.get('status'), "linktime": link.get('linktime')
                            } for link in link_statuses
                        ]
                    }
                    logging.debug(f"Updated IEC104 status: {service_overall_status}, {len(link_statuses)} links.")
                    with app.app_context():
                        socketio.emit('new_realtime_data_delta', {
                            "realtime_values": realtime_data_cache["realtime_values"],
                            "last_update_timestamp": realtime_data_cache["last_update_timestamp"],
                            "iec104_status": realtime_data_cache["iec104_status"]
                        }, broadcast=True)
        else:
            current_api_token = login_and_get_token(dsa_gateway_host, api_username, api_password)
        time.sleep(interval_seconds)