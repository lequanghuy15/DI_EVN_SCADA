from pymodbus.client.sync import ModbusTcpClient
from pymodbus.exceptions import ConnectionException
import time
import sys
sys.stdout.reconfigure(encoding='utf-8')

def run_test():
    """
    Hàm thực hiện kiểm tra đọc/ghi Modbus với một thiết bị thật.
    """
    print("--- CHƯƠNG TRÌNH KIỂM TRA GIAO TIẾP MODBUS TCP ---")
    
    # --- BƯỚC 1: LẤY THÔNG TIN KẾT NỐI TỪ NGƯỜI DÙNG ---
    try:
        # Sử dụng địa chỉ IP của thiết bị thật hoặc ModSim
        # Nếu chạy ModSim trên cùng máy, IP là 'localhost' hoặc '127.0.0.1'
        device_ip = input("Nhập địa chỉ IP của thiết bị (hoặc ModSim, ví dụ: localhost): ")
        
        # Cổng tiêu chuẩn của Modbus TCP là 502
        device_port = int(input("Nhập cổng Modbus TCP (mặc định là 502): ") or "502")
        
        # Unit ID (Slave ID)
        unit_id = int(input("Nhập Unit ID (Slave ID) của thiết bị: "))
        
    except ValueError:
        print("\n[LỖI] Dữ liệu nhập vào không hợp lệ. Vui lòng chạy lại.")
        return

    # --- BƯỚC 2: KẾT NỐI ---
    print(f"\nĐang thử kết nối đến {device_ip}:{device_port}...")
    client = ModbusTcpClient(device_ip, port=device_port, timeout=5)

    if not client.connect():
        print(f"[LỖI] KẾT NỐI THẤT BẠI. Vui lòng kiểm tra:")
        print(f"  - Địa chỉ IP và cổng có đúng không?")
        print(f"  - Thiết bị có đang bật và kết nối vào mạng LAN không?")
        print(f"  - Tường lửa có đang chặn kết nối không?")
        return

    print(f"[THÀNH CÔNG] Đã kết nối đến thiết bị tại {device_ip}:{device_port}")

    try:
        while True:
            print("\n--- MENU CHỨC NĂNG ---")
            print("1. Đọc Holding Register")
            print("2. Ghi vào Holding Register")
            print("3. Thoát")
            
            choice = input("Nhập lựa chọn của bạn (1-3): ")

            if choice == '1':
                # --- CHỨC NĂNG ĐỌC ---
                try:
                    addr_to_read = int(input("Nhập địa chỉ thanh ghi cần ĐỌC (ví dụ: 0 cho 40001): "))
                    num_regs = int(input("Nhập số lượng thanh ghi cần đọc (ví dụ: 1): ") or "1")
                    
                    print(f"\nĐang đọc {num_regs} thanh ghi từ địa chỉ {addr_to_read}...")
                    response = client.read_holding_registers(addr_to_read, num_regs, unit=unit_id)
                    
                    if response.isError():
                        print(f"[LỖI ĐỌC] Không thể đọc thanh ghi. Phản hồi: {response}")
                    else:
                        print(f"[ĐỌC THÀNH CÔNG] Giá trị đọc được: {response.registers}")

                except (ValueError, IndexError):
                    print("[LỖI] Dữ liệu nhập vào không hợp lệ.")

            elif choice == '2':
                # --- CHỨC NĂNG GHI ---
                try:
                    addr_to_write = int(input("Nhập địa chỉ thanh ghi cần GHI (ví dụ: 10 cho 40011): "))
                    value_to_write = int(input("Nhập giá trị (số nguyên) cần GHI: "))
                    
                    print(f"\nĐang ghi giá trị '{value_to_write}' vào địa chỉ {addr_to_write}...")
                    response = client.write_register(addr_to_write, value_to_write, unit=unit_id)
                    
                    if response.isError():
                        print(f"[LỖI GHI] Không thể ghi vào thanh ghi. Phản hồi: {response}")
                    else:
                        print(f"[GHI THÀNH CÔNG] Lệnh ghi đã được gửi.")
                        # Đọc lại để xác minh
                        print("Đang đọc lại để xác minh...")
                        time.sleep(0.5)
                        verify_response = client.read_holding_registers(addr_to_write, 1, unit=unit_id)
                        if not verify_response.isError() and verify_response.registers[0] == value_to_write:
                            print(f"[XÁC MINH OK] Giá trị tại địa chỉ {addr_to_write} bây giờ là: {verify_response.registers[0]}")
                        else:
                            print(f"[LỖI XÁC MINH] Đọc lại thanh ghi thất bại hoặc giá trị không khớp. Phản hồi: {verify_response}")

                except (ValueError, IndexError):
                    print("[LỖI] Dữ liệu nhập vào không hợp lệ.")
            
            elif choice == '3':
                print("Đang thoát chương trình...")
                break
                
            else:
                print("Lựa chọn không hợp lệ. Vui lòng thử lại.")
            
            time.sleep(1)

    except KeyboardInterrupt:
        print("\nĐã nhận tín hiệu dừng. Đang thoát...")
    finally:
        # Đóng kết nối khi kết thúc
        client.close()
        print("Đã đóng kết nối Modbus.")


if __name__ == "__main__":
    run_test()