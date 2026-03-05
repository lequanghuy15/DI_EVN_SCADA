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
## 🔄 Luồng dữ liệu (Data Flow)

Dữ liệu đi qua hệ thống theo hành trình từ **Thiết bị thật (Southbound)** đến **Người dùng cuối (Northbound)** như sau:

### 1. Thu thập dữ liệu
*   **Thiết bị thực tế:** Các biến (measures) từ Inverter, Meter được đọc thông qua Modbus.
*   **Bridge Layer:** `inhand_services.py` thực hiện polling và đẩy dữ liệu thô vào **Broker MQTT** (topic `internal/modbus/telemetry`).

### 2. Xử lý & Lưu trữ
*   **MQTT Consumer:** `mqtt_utils.py` lắng nghe dữ liệu, lọc theo `LOGGING_WHITELIST`, sau đó:
    *   **Lưu trữ:** Đẩy vào hàng đợi (`DB_WRITE_QUEUE`) để ghi vào **SQLite DB**.
    *   **Cache:** Cập nhật vào `realtime_data_cache` – trung tâm dữ liệu của hệ thống.
*   **Calculation Loop:** Quét các công thức trong `calculations.json`, tính toán (SUM, AVG, Max, Min) và cập nhật kết quả vào cache.

### 3. Hiển thị & Đồng bộ
*   **Socket.IO:** Khi dữ liệu cache thay đổi, server phát sự kiện `page_data_update` qua Websocket. Trình duyệt nhận sự kiện này để cập nhật trực tiếp lên Dashboard và Biểu đồ.
*   **Cloud Service:** Tự động đồng bộ các biến theo cấu hình `CLOUD_UPLOAD_RULES` lên các nền tảng IoT Cloud qua giao thức MQTT.

```mermaid
graph LR
    subgraph Southbound [Thiết bị ngoại vi]
        Device[Thiết bị thật] -->|Modbus| Bridge[InHand Bridge]
    end

    subgraph Backend [Backend Service]
        Bridge -->|MQTT| MQTT[MQTT Broker]
        MQTT -->|Subscription| Processor[mqtt_utils.py]
        Processor -->|Update| Cache[(realtime_data_cache)]
        Processor -->|Queue| DB[SQLite DB]
        Cache <-->|Tính toán| Calc[Calculation Loop]
    end

    subgraph Northbound [Người dùng]
        Cache -->|Socket.IO| Socket[Socket.IO Server]
        Socket -->|Realtime Update| Browser[Trình duyệt Web]
    end

    style Device fill:#f9f,stroke:#333
    style Browser fill:#bbf,stroke:#333
    style Cache fill:#ff9,stroke:#333Lite fill:#bbf,stroke:#333,stroke-width:2px
    style MQTT fill:#ff9,stroke:#333
