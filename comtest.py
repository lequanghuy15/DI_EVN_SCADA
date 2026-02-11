import sys
from unittest.mock import MagicMock

# --- BƯỚC 1: CHẶN ĐỨNG CÁC MODULE GÂY LỖI ---
# Chúng ta giả lập (Mock) tất cả các module Cloud để InHand Core không crash
invalid_modules = [
    'azure', 
    'azure.iot', 
    'azure.iot.device', 
    'azure.iot.device.common',
    'azure.iot.device.common.models',
    'azure.iot.device.common.models.x509',
    'azure.iot.hub',
    'iothub_client'
]

for mod in invalid_modules:
    sys.modules[mod] = MagicMock()

# --- BƯỚC 2: THIẾT LẬP ĐƯỜNG DẪN ĐÚNG ---
# Lưu ý: Sử dụng 'device_supervisor' thay vì 'device_supervisorbak'
sys.path.insert(0, "/var/user/app/device_supervisor/src")
sys.path.insert(0, "/var/user/app/device_supervisor/lib")

# --- BƯỚC 3: IMPORT THƯ VIỆN HÃNG ---
try:
    from quickfaas.measure import recall2
    import json
    print(">>> Import thanh cong thư viện InHand!")
except Exception as e:
    print(f">>> Van con loi Import: {e}")
    sys.exit(1)

# --- BƯỚC 4: ĐỌC DỮ LIỆU ---
def on_data(message, userdata):
    print("\n--- NHAN DU LIEU TU HANG ---")
    # Hãng sẽ trả về JSON chứa toàn bộ các biến đã cấu hình trên Web
    print(json.dumps(message, indent=2))

print(">>> Dang cho du lieu tu Modbus Driver (Nhan Ctrl+C de dung)...")
try:
    # Hàm recall2 sẽ lấy dữ liệu cache từ Driver C++ của hãng
    recall2(callback=on_data, userdata="test_env")
    
    # Giữ cho script không bị thoát ngay lập tức
    import time
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("\n>>> Da dung script.")