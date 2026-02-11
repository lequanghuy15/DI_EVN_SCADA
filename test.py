import marshal
import types
import uncompyle6
import io
import os
import tempfile
import importlib.util

# --- CẤU HÌNH ---
# Vui lòng thay đổi tên file .pyc của bạn ở đây
PYC_FILE_PATH = 'services.pyc'

# Tên file Python sẽ được tạo ra
OUTPUT_PY_FILE = 'recovered_code.py'

def best_effort_decompile(pyc_path, output_path):
    """
    Sử dụng phương pháp tạo file .pyc tạm thời và xử lý đúng file lock trên Windows.
    """
    recovered_parts = []
    magic_number = importlib.util.MAGIC_NUMBER
    
    try:
        with open(pyc_path, 'rb') as f:
            f.seek(16)
            main_code_object = marshal.load(f)
            
            print(f"Bắt đầu quá trình cứu hộ file '{pyc_path}'...")
            
            for const in main_code_object.co_consts:
                if isinstance(const, types.CodeType):
                    tmp_file_path = None
                    try:
                        print(f"  - Đang xử lý hàm/lớp: {const.co_name}... ", end="")
                        
                        # --- SỬA LỖI PERMISSION DENIED ---
                        # 1. Tạo file tạm với delete=False để chúng ta có thể đóng nó mà không bị xóa
                        with tempfile.NamedTemporaryFile(suffix='.pyc', delete=False) as tmp:
                            tmp_file_path = tmp.name # Lưu lại đường dẫn để xóa sau
                            header = magic_number + (b'\x00\x00\x00\x00' * 3)
                            tmp.write(header)
                            marshal.dump(const, tmp)
                        
                        # 2. File tạm đã được tự động đóng khi ra khỏi khối 'with',
                        #    giải phóng file lock. Giờ uncompyle6 có thể truy cập.
                        string_io = io.StringIO()
                        uncompyle6.decompile_file(tmp_file_path, string_io)
                        
                        recovered_code = string_io.getvalue()
                        recovered_parts.append(recovered_code)
                        print("✅ Thành công")
                        
                    except Exception as e:
                        error_message = (
                            f"\n# LỖI: Không thể dịch ngược hàm/lớp '{const.co_name}'.\n"
                            f"# Lý do: {str(e).strip()}\n"
                        )
                        recovered_parts.append(error_message)
                        print(f"❌ Thất bại")
                    finally:
                        # 3. Dọn dẹp: Luôn đảm bảo file tạm được xóa dù có lỗi hay không
                        if tmp_file_path and os.path.exists(tmp_file_path):
                            os.remove(tmp_file_path)

            final_code = "\n\n".join(recovered_parts)
            
            with open(output_path, 'w', encoding='utf-8') as out_f:
                out_f.write(f"# File được khôi phục từ '{pyc_path}' bằng script cứu hộ.\n")
                out_f.write("# Một số phần có thể bị thiếu hoặc sai.\n\n")
                out_f.write(final_code)
                
            print(f"\n✅ Hoàn tất! Mã nguồn đã khôi phục được lưu tại: '{output_path}'")

    except FileNotFoundError:
        print(f"❌ LỖI: Không tìm thấy file '{pyc_path}'.")
    except Exception as e:
        print(f"❌ Đã xảy ra lỗi nghiêm trọng khi đọc file: {e}")

# --- Chạy chương trình ---
if __name__ == "__main__":
    best_effort_decompile(PYC_FILE_PATH, OUTPUT_PY_FILE)