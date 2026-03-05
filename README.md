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

🔌 Tài liệu API (API Documentation)
Hệ thống cung cấp RESTful API để frontend tương tác với dữ liệu thiết bị và cấu hình hệ thống. Tất cả phản hồi (response) đều định dạng JSON.
1. Solar Configuration
GET /api/solar_configuration: Lấy danh sách thiết bị và trạng thái cấu hình hiện tại.
POST /api/solar_configuration: Cập nhật cấu hình Solar (thêm/sửa/xóa thiết bị, sửa gain CT/PT).
2. Manual & Virtual Controls
POST /api/update_manual_value: Cập nhật giá trị hằng số cho biến Calculation (ví dụ: đặt công suất cố định).
POST /api/update_manual_state: Cập nhật trạng thái công tắc (0/1) cho biến Calculation.
POST /api/write_device_value: Gửi lệnh ghi xuống thiết bị vật lý qua MQTT (dành cho các biến có readWrite: "rw").
3. Historical Data
GET /api/history: Lấy dữ liệu biểu đồ.
Parameters: sensor_ids (chuỗi ID), start_time (Unix timestamp), end_time, resolution ('auto'|'raw'|'1min'|'5min').
4. System & Cloud
GET/POST /api/system_configuration: Đọc/Ghi cấu hình cổng COM, Cloud MQTT, và tham số IEC104.
GET/POST /api/cloud_upload_rules: Quản lý các biến được phép đẩy lên Cloud.
GET/POST /api/logging_rules: Quản lý Whitelist các biến được ghi vào Database.
🔄 Luồng dữ liệu: Cấu hình Hệ thống (Config Lifecycle)
Khi người dùng sửa một file cấu hình (ví dụ: thêm thiết bị, sửa gain), dữ liệu không chỉ được ghi xuống ổ đĩa mà còn phải đảm bảo tính nhất quán trên toàn hệ thống.
Quy trình: "Sửa - Lưu - Tái khởi động"
Giai đoạn Pending (Frontend):
Khi người dùng sửa cấu hình trên UI, các thay đổi được lưu tạm trong bộ nhớ của trình duyệt (thông qua appData.solarConfigPage.pending_changes).
Thanh global-apply-bar sẽ hiển thị số lượng thay đổi đang chờ.
Giai đoạn Apply (Payload Hợp nhất):
Khi bấm nút "Apply Changes", Frontend gom toàn bộ thay đổi từ: Devices (Solar), System (COMs), Cloud (MQTT) và IEC104.
Dữ liệu được gói thành một unifiedPayload duy nhất và gửi đến POST /api/system_configuration.
Giai đoạn Backend Processing (routes/system_config_routes.py):
Backend nhận payload, hợp nhất với cấu hình gốc từ device_supervisor.cfg.
Hàm _apply_new_config_and_restart_supervisor thực hiện:
Ghi file: Ghi đè file .cfg mới lên ổ cứng.
Flush: Ép dữ liệu xuống Flash (đảm bảo không mất dữ liệu khi mất điện đột ngột).
Restart: Kill tiến trình device_supervisor đang chạy. Hệ thống OS (thường là qua systemd hoặc trình quản lý process tương đương) sẽ tự động khởi động lại tiến trình này với cấu hình mới.
Giai đoạn Đồng bộ trạng thái:
Sau khi khởi động lại, process_and_save_config_data trong config_utils.py sẽ quét lại file .cfg mới, tạo lại cache (json_output) và calc_mapping.json.
Thông qua Socket.IO, Frontend được thông báo configuration_updated để cập nhật lại giao diện.
Sơ đồ Luồng Cấu hình (Config Flow)
code
Mermaid
sequenceDiagram
    participant User as Người dùng
    participant UI as Frontend
    participant API as Backend (Flask)
    participant FS as File System (.cfg)
    participant Proc as Device Supervisor

    User->>UI: Thay đổi cấu hình (Pending)
    User->>UI: Nhấn "Apply Changes"
    UI->>API: POST /api/system_configuration (Unified Payload)
    API->>FS: Ghi đè file .cfg & fsync
    API->>Proc: Kill Process (Restart)
    Proc->>FS: Đọc lại file .cfg (Khởi động mới)
    API->>UI: Trả về {status: "success"}
    UI->>UI: Tải lại trang (Reload)
