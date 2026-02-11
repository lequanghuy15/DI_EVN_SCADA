import sys
import time
import json
import random

# --- BƯỚC 1: THIẾT LẬP ĐƯỜNG DẪN ---
sys.path.insert(0, "/var/user/app/device_supervisor/src")
sys.path.insert(0, "/var/user/app/device_supervisor/lib")

try:
    from quickfaas.messagebus import publish
    print("✅ Đã nạp thư viện Messagebus.")
except ImportError:
    print("❌ Lỗi: Không tìm thấy thư viện hãng.")
    sys.exit(1)

def mqtt_write_command():
    # --- BƯỚC 2: CẤU HÌNH THEO MỤC 2.2.3 ---
    # requestServiceId của DataHub mặc định là 1010
    TOPIC = "ds2/eventbus/south/write/1010"
    
    DEVICE_NAME = "PMSum2"
    TAG_NAME = "tag1"
    VALUE = 88.5
    
    # Tạo msg_id ngẫu nhiên (mục 2.2.3 yêu cầu)
    msg_id = int(time.time() * 1000) + random.randint(1, 1000)

    # --- BƯỚC 3: TẠO PAYLOAD CHUẨN ---
    payload = {
        "msg_id": msg_id,
        "timestamp": int(time.time() * 1000),
        "payload": [
            {
                "name": DEVICE_NAME,
                "measures": [
                    {
                        "name": TAG_NAME,
                        "value": VALUE
                    }
                ]
            }
        ]
    }

    print(f"🚀 Đang gửi LỆNH GHI qua MQTT: {DEVICE_NAME} -> {TAG_NAME} = {VALUE}")
    
    try:
        # Gửi bản tin ghi
        publish(TOPIC, json.dumps(payload))
        print(f"✔️  Đã gửi lệnh (msg_id: {msg_id})")
        print("💡 Lưu ý: Hệ thống sẽ phản hồi kết quả tại topic: ds2/eventbus/south/write/1010/response")
        
    except Exception as e:
        print(f"❌ Lỗi khi gửi: {e}")

if __name__ == "__main__":
    mqtt_write_command()