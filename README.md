# Device Supervisor Bridge

Hệ thống trung tâm dùng để kết nối, giám sát thời gian thực và cấu hình các thiết bị năng lượng mặt trời (Inverters, Meters, Loggers) thông qua giao thức Modbus và API. Hệ thống hỗ trợ tính toán dữ liệu ảo (Virtual Controllers), đồng bộ lên Cloud (ThingsBoard/MQTT) và ghi nhật ký dữ liệu chuyên sâu vào SQLite.

## 🏗 Kiến trúc Hệ thống

Hệ thống được xây dựng theo mô hình **Backend-Frontend tách biệt**:
*   **Backend (Python/Flask/Eventlet):** Xử lý giao tiếp MQTT, quản lý cấu hình thiết bị, tính toán dữ liệu, và giao tiếp với SQLite.
*   **Frontend (JS/Chart.js/Socket.IO):** Giao diện quản trị thời gian thực với khả năng tùy chỉnh cấu hình thiết bị và biểu đồ linh hoạt.

## 📁 Cấu trúc Thư mục

### Backend (Python)
- `main.py`: Điểm khởi chạy chính, quản lý các tiến trình nền.
- `app_state.py`: Quản lý Cache toàn cục và Threading Locks.
- `mqtt_utils.py`: Xử lý việc sub/pub dữ liệu MQTT.
- `db_utils.py`: Quản lý CSDL SQLite và cơ chế downsampling (1ph, 5ph).
- `cloud_service.py`: Đồng bộ dữ liệu lên Cloud (MQTT Telemetry).
- `inhand_services.py`: Cầu nối dữ liệu với hệ thống thiết bị InHand.
- `config_utils.py`: Xử lý việc đọc/ghi và tái tạo cấu hình hệ thống.
- `api_utils.py`: Tương tác với API Gateway (đăng nhập, giám sát IEC104).

### Frontend (JavaScript/Static)
- `js/main.js`: Lõi điều khiển, quản lý kết nối Socket.IO.
- `js/apiService.js`: Dịch vụ tập trung xử lý các yêu cầu API (fetch).
- `js/page-overview.js`: Logic trang tổng quan và biểu đồ công suất.
- `js/page-solar-config.js`: Logic cấu hình thiết bị (thêm/sửa/xóa).
- `js/page-calculation.js`: Quản lý Virtual Controllers và các phép tính (Calculations).

### Cấu hình & Dữ liệu
Hệ thống sử dụng các tệp JSON để lưu trữ cấu hình:
- `calculations.json`: Công thức tính toán (SUM, AVG, Max, Min...).
- `cloud_upload_rules.json`: Quy tắc đồng bộ dữ liệu Cloud.
- `logging_rules.json`: Danh sách Whitelist các biến đo cần ghi vào DB.
- `virtual_controllers.json`: Danh sách các Virtual Controllers.
- `chart_config.json`: Cấu hình đường vẽ biểu đồ Overview.

## 🚀 Tính năng Nổi bật

1.  **Tính toán thời gian thực:** Tạo các biến ảo (Calculated Tags) dựa trên công thức linh hoạt.
2.  **Downsampling thông minh:** Tự động tối ưu hóa lưu trữ DB với các bảng dữ liệu 1 phút và 5 phút.
3.  **Logging Whitelist:** Kiểm soát dữ liệu đầu vào DB, tránh quá tải ổ đĩa Flash.
4.  **Real-time Config:** Nhiều cấu hình áp dụng ngay lập tức thông qua Socket.IO mà không cần khởi động lại.
5.  **CT/PT Handling:** Tự động tính toán lại gain cho các thiết bị Meter dựa trên thông số biến dòng/áp.

## 🛠 Cách triển khai

1.  **Cài đặt môi trường:**
    ```bash
    pip install -r requirements.txt
    ```
2.  **Cấu hình:** Chỉnh sửa các đường dẫn trong `constants.py` để phù hợp với môi trường cài đặt (đường dẫn `/var/user/...`).
3.  **Khởi chạy:**
    ```bash
    python main.py
    ```
4.  **Truy cập:** Mở trình duyệt tại `http://<IP_GATEWAY>:8000`.

## ⚙️ Yêu cầu hệ thống
- Hệ điều hành: Linux (khuyến nghị cho các thiết bị Gateway/Embedded).
- Python 3.8+
- SQLite3 (đã cài đặt sẵn)
- Broker MQTT (ví dụ: EMQX) hoạt động tại localhost:9009.
### Sơ đồ Luồng dữ liệu (Data Flow)

```mermaid
graph TD
    %% Định nghĩa các node
    Device[Thiết bị/Modbus]
    MQTT[MQTT Broker]
    MQTT_Utils[mqtt_utils.py]
    RealtimeCache[(realtime_data_cache)]
    SQLite[(SQLite DB)]
    CalcLoop[Calculation Loop]
    SocketIO[Socket.IO Server]
    CloudService[Cloud Service]
    WebUI[Web Frontend]

    %% Luồng dữ liệu
    Device -->|Telemetry| MQTT
    MQTT -->|Payload| MQTT_Utils
    
    MQTT_Utils -->|Ghi log| SQLite
    MQTT_Utils -->|Cập nhật| RealtimeCache
    
    RealtimeCache <-->|Đọc/Ghi| CalcLoop
    CalcLoop -->|Gửi Virtual Data| Device
    
    RealtimeCache -->|Phát sự kiện| SocketIO
    SocketIO -->|Update Realtime| WebUI
    
    RealtimeCache -->|Lấy dữ liệu theo Rules| CloudService
    CloudService -->|Publish| MQTT

    %% Định nghĩa màu sắc
    style RealtimeCache fill:#f9f,stroke:#333,stroke-width:2px
    style SQLite fill:#bbf,stroke:#333,stroke-width:2px
    style MQTT fill:#ff9,stroke:#333
