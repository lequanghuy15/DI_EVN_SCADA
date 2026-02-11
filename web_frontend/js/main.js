// --- START OF FILE js/main.js ---

/**
 * Tệp main.js: Lõi của ứng dụng (Kiến trúc Nâng cao)
 * - Triển khai mô hình "Pull on Demand": Frontend đăng ký nhận dữ liệu cho trang đang xem.
 * - Triển khai mô hình "Data-Driven Chart": Biểu đồ Overview chỉ cập nhật khi có dữ liệu liên quan.
 * - Quản lý kết nối Socket.IO, trạng thái toàn cục, và logic chuyển trang.
 */
export const pageInitFunctions = {};
export const pageRenderFunctions = {};
export const appData = {
    // ... (nội dung của appData không đổi)
    realtime_values: {},
    health_status: {},
    controllers_config: {},
    measures_config: {},
    iec104_status: { "service_overall_status": "Not Monitored (Local)", "service_runtime": "N/A", "active_links": [] },
    overviewPage: {
        chartHistory: {
            labels: [],
            datasets: {
                "INVT_T:ActivePowerSum": { label: 'P Invt (kW)', data: [], borderColor: 'rgb(132, 245, 23)', tension: 0.4, fill: 'origin', borderWidth: 2, pointRadius: 0 },
                "PM01:PowerSetkW": { label: 'P Set (kW)', data: [], borderColor: 'rgb(237, 110, 113)', tension: 0.4, fill: 'origin', borderWidth: 2, pointRadius: 0 },
                "PM01:ActivePowerSum": { label: 'P Out (kW)', data: [], borderColor: 'rgb(128, 28, 208)', tension: 0.4, fill: 'origin', borderWidth: 2, pointRadius: 0 },
            },
            currentFilter: 'Real time'
        }
    },
    detailsPage: {
        selectedController: 'All',
        selectedVariables: {},
        chartHistory: { labels: [], datasets: {} }
    },
    solarConfigPage: {
        current_config: {},
        pending_changes: {},
        template_hierarchy: {},
        protocol_definitions: {},
        is_applying: false,
        latest_supervisor_status: {}
    },
    system_coms_config: [],
    system_coms_pending_changes: {},
    cloud_config: [],
    cloud_pending_changes: {},
    iec104_config: {},
    iec104_pending_changes: null,
    user_settings: {},
    chart_config: {},
    logging_whitelist: [],
};
// CHANGED: Import apiService để sử dụng tập trung
import * as api from './apiService.js';

// Đăng ký các thành phần cốt lõi của Chart.js
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (window.Chart) {
            const { LineController, LineElement, PointElement, LinearScale, Legend, Tooltip, TimeScale, CategoryScale } = Chart;
            Chart.register(LineController, LineElement, PointElement, LinearScale, Legend, Tooltip, TimeScale, CategoryScale);
            console.log("Chart.js v4.x core components registered successfully.");
        } else {
            console.error("Critical: Chart.js global object not found during explicit registration phase.");
        }
    }, 100);
    const applyBtn = document.getElementById('global-apply-btn');
    if (applyBtn) {
        applyBtn.addEventListener('click', applyGlobalChanges);
    }

    // Gắn sự kiện cho nút Discard toàn cục ở đây (nếu chưa có)
    const discardBtn = document.getElementById('global-discard-btn');
    if (discardBtn) {
        discardBtn.addEventListener('click', () => {
            if (confirm('Hủy bỏ tất cả thay đổi? Trang web sẽ tải lại.')) {
                location.reload();
            }
        });
    }
});

// CHANGED: Cấu trúc lại appData để tập trung hóa toàn bộ trạng thái
// Trạng thái toàn cục của ứng dụng

window.appData = appData;
function updateCalculationPage() {
    const rtData = appData.realtime_values;
    const calcData = rtData["Calculations"] || {};

    // Tìm tất cả các thẻ hiển thị giá trị phép tính
    document.querySelectorAll('.calc-total-value').forEach(el => {
        const id = el.id.replace('calc-val-', '');
        if (calcData[id]) {
            const val = calcData[id].value;
            el.textContent = typeof val === 'number' ? val.toFixed(2) : val;
        }
    });
}
// Đăng ký render function
pageRenderFunctions['calculation-page'] = updateCalculationPage;

// CHANGED: Thêm "export"
export const CHART_MAX_DATA_POINTS = 60;
export const CHART_COLORS = [
    'rgb(255, 99, 132)', 'rgb(255, 159, 64)', 'rgb(255, 205, 86)',
    'rgb(75, 192, 192)', 'rgb(54, 162, 235)', 'rgb(153, 102, 255)',
    'rgb(201, 203, 207)'
];


let currentPageId = null;

// --- HÀM TIỆN ÍCH DÙNG CHUNG ---
// CHANGED: Thêm "export"
export function getMeasureAlias(measureName) { return measureName ? measureName.replace(/^(INVT_T:|PM01:|EVN:|Calculation:)/g, '').trim() : ''; }
export function getUnit(measureName, defaultUnit = '') {
    if (!measureName) return defaultUnit;
    const configUnit = appData.measures_config[measureName]?.unit;
    return (configUnit !== undefined && configUnit !== null && configUnit !== '') ? configUnit : defaultUnit;
}
export function formatTimestamp(timestamp) { if (!timestamp) return ''; return new Date(timestamp).toLocaleTimeString('vi-VN'); }

// --- HÀM GỌI API GHI DỮ LIỆU (SỬ DỤNG apiService) ---
async function updateMeasureValue(measureName, newValue) {
    const config = appData.measures_config[measureName];
    if (!config || config.readWrite === "ro") {
        alert(`Lỗi: Biến '${getMeasureAlias(measureName)}' không cho phép ghi hoặc không tồn tại.`);
        return;
    }
    try {
        // CHANGED: Gọi hàm từ module apiService
        await api.updateMeasureValue(measureName, newValue);
        console.log(`Command for ${measureName} sent successfully.`);
    } catch (error) {
        console.error(`Error sending command for ${measureName}:`, error);
        alert(`Không thể gửi lệnh: ${error.message}`);
    }
}
// Gán vào window để các file khác có thể gọi
window.updateMeasureValue = updateMeasureValue;

// ==========================================================
// === LOGIC NÂNG CAO CHO BIỂU ĐỒ OVERVIEW (DATA-DRIVEN) ===
// ==========================================================
function updateRealtimeOverviewChart(data) {
    const overviewState = appData.overviewPage;
    
    // 1. Chỉ chạy khi đang ở trang Overview và chế độ Realtime
    if (currentPageId !== 'overview-page' || overviewState.chartHistory.currentFilter !== 'Real time' || !data.realtime_values) {
        return;
    }

    const history = overviewState.chartHistory;
    const datasetKeys = Object.keys(history.datasets); // Các key cần vẽ, VD: "EVN:INVT_T:Ex_YEnergy"
    
    let newDataArrived = false;

    // 2. Kiểm tra xem dữ liệu mới về có khớp với key nào trong biểu đồ không
    for (const uniqueKey of datasetKeys) {
        // TÁCH KEY THÔNG MINH: Chỉ tách dấu hai chấm ĐẦU TIÊN
        const firstColonIndex = uniqueKey.indexOf(':');
        if (firstColonIndex === -1) continue;

        const devName = uniqueKey.substring(0, firstColonIndex);
        const measName = uniqueKey.substring(firstColonIndex + 1);
        
        // Kiểm tra trong dữ liệu Socket gửi về
        if (data.realtime_values[devName] && data.realtime_values[devName][measName]) {
            newDataArrived = true;
            // console.log(`>>> [Chart OK] Khớp dữ liệu: ${devName} -> ${measName}`);
        }
    }

    if (!newDataArrived) return;

    // 3. Cập nhật Trục thời gian (Labels)
    const currentTime = data.last_update_timestamp || Date.now();
    if (history.labels.length >= CHART_MAX_DATA_POINTS) {
        history.labels.shift();
        Object.values(history.datasets).forEach(ds => ds.data.shift());
    }
    history.labels.push(currentTime);

    // 4. Đẩy giá trị vào từng đường vẽ (Dataset)
    datasetKeys.forEach(uniqueKey => {
        const firstColonIndex = uniqueKey.indexOf(':');
        const dev = uniqueKey.substring(0, firstColonIndex);
        const meas = uniqueKey.substring(firstColonIndex + 1);
        
        const valObj = appData.realtime_values[dev]?.[meas];
        let newVal = null;

        if (valObj && valObj.value !== undefined && valObj.value !== null) {
            newVal = parseFloat(valObj.value);
        } else {
            // Nếu giây này ko có data, lấy lại giá trị cũ nhất để đường vẽ liên tục
            const currentDS = history.datasets[uniqueKey].data;
            newVal = currentDS.length > 0 ? currentDS[currentDS.length - 1] : null;
        }

        history.datasets[uniqueKey].data.push(newVal);
    });

    // 5. Quan trọng: Nếu hàm này không tự gọi chart.update(), biểu đồ sẽ không vẽ
    // Thông thường main.js update data, còn page-overview.js sẽ gọi chart.update() ở vòng render tiếp theo.
    // Để chắc chắn, ta có thể trigger nhẹ một event hoặc console log kiểm tra mảng data
    // console.log(">>> [Chart Data] Mảng dữ liệu hiện tại:", history.datasets[datasetKeys[0]].data);
}
// --- LOGIC CHUYỂN TRANG (NÂNG CẤP VỚI "PULL ON DEMAND") ---
// ... (Hàm switchPage không thay đổi)
function switchPage(pageId) {
    // 1. Gửi socket đăng ký dữ liệu (Giữ nguyên)
    if (window.socket && window.socket.connected) {
        // console.log(`Subscribing to data for page: ${pageId}`);
        window.socket.emit('subscribe_page_data', { page: pageId });
    }

    // 2. Cập nhật trạng thái nút Active trên Sidebar
    const pageName = pageId.replace('-page', '');
    const targetButton = document.querySelector(`.nav-button[data-page="${pageName}"]`);

    if (targetButton) {
        // Xóa active cũ
        document.querySelectorAll('.nav-button').forEach(btn => btn.classList.remove('active'));
        // Active nút mới
        targetButton.classList.add('active');

        // --- [ĐOẠN CODE ĐÃ SỬA LỖI] ---
        const parentGroup = targetButton.closest('.nav-group');

        if (parentGroup) {
            // TRƯỜNG HỢP 1: Nút nằm trong Menu con (VD: Solar, Calculation)
            // Mở menu cha nếu chưa mở
            if (!parentGroup.classList.contains('is-open')) {
                // Đóng các menu khác cho gọn
                document.querySelectorAll('.nav-group').forEach(group => group.classList.remove('is-open'));
                parentGroup.classList.add('is-open');
            }
        } else {
            // TRƯỜNG HỢP 2: Nút cấp 1 (VD: Giới thiệu, Tổng quan)
            // Đóng tất cả các menu con đang mở
            document.querySelectorAll('.nav-group').forEach(group => group.classList.remove('is-open'));
        }
        // --- [HẾT ĐOẠN SỬA LỖI] ---
    }

    // 3. Chuyển đổi hiển thị trang (Page Visibility) (Giữ nguyên)
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.classList.add('active');
        currentPageId = pageId;

        // Chạy hàm init nếu có (chạy 1 lần)
        if (typeof pageInitFunctions[pageId] === 'function') {
            pageInitFunctions[pageId]();
            delete pageInitFunctions[pageId];
        }

        // Chạy hàm render (cập nhật realtime)
        if (typeof pageRenderFunctions[pageId] === 'function') {
            pageRenderFunctions[pageId]();
        }
    } else {
        console.warn(`Page with ID ${pageId} not found.`);
    }
}


// --- KHỞI TẠO ỨNG DỤNG CHÍNH ---
// ... (Phần document.addEventListener('DOMContentLoaded') giữ nguyên logic, không cần thay đổi)
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Socket.IO
    window.socket = io();
     try {
        console.log("📂 Đang tải cấu hình từ ổ đĩa...");
        const [settings, chartCfg, logRules] = await Promise.all([
            api.getUserSettings(),
            api.getChartConfig(),
            api.getLoggingRules()
        ]);
        
        // Gán vào appData
        appData.user_settings = settings || {};
        appData.chart_config = chartCfg || { datasets: [] };
        appData.logging_whitelist = logRules || [];
        
        console.log("✅ Tải cấu hình thành công!");
    } catch (e) {
        console.error("❌ Lỗi khi tải cấu hình từ server:", e);
    }
    
    window.socket.on('connect', () => console.log('Socket.IO: Connected.'));
    window.socket.on('disconnect', () => console.log('Socket.IO: Disconnected.'));

    const handleRealtimeData = (data) => {
        if (data.controllers_by_name) appData.controllers_config = data.controllers_by_name;
        if (data.measures) {
            console.log(`✅ Đã nhận measures list: ${data.measures.length} biến`); // Log để kiểm tra
            appData.measures_list = data.measures;
        }
        if (data.measures_by_name) appData.measures_config = data.measures_by_name;
        if (data.iec104_status) appData.iec104_status = data.iec104_status;
        if (data.last_update_timestamp) appData.last_update_timestamp = data.last_update_timestamp;
        if (data.health_status) {
            if (!appData.health_status) appData.health_status = {};
            Object.assign(appData.health_status, data.health_status);
        }
        if (data.cloud_runtime_status) {
            appData.cloud_runtime_status = data.cloud_runtime_status;
            // console.log("Cloud Status Updated:", appData.cloud_runtime_status); // Bật lên nếu muốn test
        }
        if (data.realtime_values) {
            for (const controllerName in data.realtime_values) {
                if (!appData.realtime_values[controllerName]) {
                    appData.realtime_values[controllerName] = {};
                }
                Object.assign(appData.realtime_values[controllerName], data.realtime_values[controllerName]);
            }
        }
        updateRealtimeOverviewChart(data);
        if (currentPageId && typeof pageRenderFunctions[currentPageId] === 'function') {
            console.log(`🔄 [MAIN-DEBUG] Calling render for page: ${currentPageId}`); // <--- Thêm log này để test
            pageRenderFunctions[currentPageId]();
        }
    };
    window.socket.on('page_data_update', handleRealtimeData);

    window.socket.on('system_status_update', (data) => {
        if (window.handleSystemStatusUpdate) {
            window.handleSystemStatusUpdate(data);
        }
    });

    // 2. Navigation
    document.querySelectorAll('.nav-group-toggle').forEach(button => {
        button.addEventListener('click', () => button.parentElement.classList.toggle('is-open'));
    });
    document.querySelectorAll('.nav-button').forEach(button => {
        button.addEventListener('click', (e) => {
            const pageName = e.currentTarget.dataset.page;
            switchPage(`${pageName}-page`);
        });
    });

    // 3. LocalStorage
    const siteInput = document.getElementById('control-site-input');
    if (siteInput) {
        siteInput.value = localStorage.getItem('controlSite') || 'Main_Residence';
        siteInput.addEventListener('input', () => localStorage.setItem('controlSite', siteInput.value));
    }
    const provinceInput = document.getElementById('control-province-input');
    if (provinceInput) {
        provinceInput.value = localStorage.getItem('controlProvince') || 'Energy_Provider_Inc';
        provinceInput.addEventListener('input', () => localStorage.setItem('controlProvince', provinceInput.value));
    }

    // 4. Start initial page
    const initialPage = document.querySelector('.page.active');
    switchPage(initialPage ? initialPage.id : 'home-page');
    try {
        const [settings, chartConfig] = await Promise.all([
            api.getUserSettings(),
            api.getChartConfig() // <--- MỚI
        ]);
        appData.user_settings = settings || {};
        appData.chart_config = chartConfig || {};
        console.log("Loaded User Settings from Server:", appData.user_settings);
    } catch (e) {
        console.error("Failed to load user settings:", e);
    }
});
export function updatePendingChangesBar() {
    const bar = document.getElementById('global-apply-bar');
    const countSpan = document.getElementById('change-count');

    // 1. Đếm Solar
    const solarCount = appData.solarConfigPage?.pending_changes
        ? Object.keys(appData.solarConfigPage.pending_changes).length
        : 0;

    // 2. Đếm System
    const systemCount = appData.system_coms_pending_changes
        ? Object.keys(appData.system_coms_pending_changes).length
        : 0;

    // 3. Đếm Cloud
    const cloudCount = appData.cloud_pending_changes
        ? Object.keys(appData.cloud_pending_changes).length
        : 0;
    const iec104Count = appData.iec104_pending_changes ? 1 : 0;

    const totalCount = solarCount + systemCount + cloudCount + iec104Count;

    if (countSpan) countSpan.textContent = totalCount;

    if (bar) {
        bar.classList.toggle('visible', totalCount > 0);
    }
}
// --- TRONG FILE: js/page-solar-config.js ---

export async function applyGlobalChanges() {
    const pageState = appData.solarConfigPage;

    if (pageState.is_applying) return;

    // 1. Đếm tổng số thay đổi từ cả 3 nguồn
    const solarCount = Object.keys(pageState.pending_changes).length;

    // 2. Đếm System (SỬA TÊN BIẾN THÀNH systemCount)
    const systemCount = appData.system_coms_pending_changes ? Object.keys(appData.system_coms_pending_changes).length : 0;

    // 3. Đếm Cloud
    const cloudCount = appData.cloud_pending_changes ? Object.keys(appData.cloud_pending_changes).length : 0;

    // 4. Đếm IEC 104
    const iec104Count = appData.iec104_pending_changes ? 1 : 0;

    // 5. Tính tổng (Dùng systemCount)
    const totalCount = solarCount + systemCount + cloudCount + iec104Count;

    if (totalCount === 0) {
        alert("Không có thay đổi nào để áp dụng.");
        return;
    }

    // Hiển thị xác nhận chi tiết
    if (!confirm(`Bạn có ${totalCount} thay đổi đang chờ:\n- Solar Devices: ${solarCount}\n- System Coms: ${systemCount}\n- Cloud MQTT: ${cloudCount}\n- IEC 104: ${iec104Count}\n\nÁp dụng sẽ khởi động lại dịch vụ giám sát. Tiếp tục?`)) return;

    // Bắt đầu quy trình lưu
    pageState.is_applying = true;
    const button = document.getElementById('global-apply-btn');
    if (button) {
        button.disabled = true;
        button.textContent = 'Applying...';
    }

    try {
        // ============================================================
        // [SỬA LỖI NGHIÊM TRỌNG TẠI ĐÂY]
        // Thay vì lấy từ biến local (có thể rỗng), hãy GỌI API LẤY MỚI
        // ============================================================

        let initialDevices = [];
        try {
            // Gọi API lấy cấu hình hiện tại đang chạy trong máy
            const freshConfig = await api.getSolarConfiguration();
            initialDevices = freshConfig.devices || [];
            console.log("✅ Đã tải cấu hình gốc an toàn:", initialDevices.length, "thiết bị.");
        } catch (e) {
            throw new Error("Không thể tải cấu hình gốc từ Server. Hủy lưu để bảo toàn dữ liệu.");
        }

        // Tạo Map từ dữ liệu VỪA TẢI VỀ (thay vì pageState.current_config)
        const finalDeviceConfig = new Map(initialDevices.map(device => [device.id, { ...device }]));

        for (const deviceId in pageState.pending_changes) {
            const change = pageState.pending_changes[deviceId];

            if (change.state === 'deleted') {
                finalDeviceConfig.delete(deviceId);
                continue;
            }

            let baseConfig = finalDeviceConfig.get(deviceId) || {};
            if (change.state === 'new') {
                // Nếu là mới, baseConfig sẽ là object rỗng, ta khởi tạo các cờ
                baseConfig = { original_name: deviceId, is_new: true, state: 'new' };
            }

            const updatedDeviceConfig = { ...baseConfig, ...(change.data || {}) };

            if (baseConfig.args || change.data?.args) {
                updatedDeviceConfig.args = { ...(baseConfig.args || {}), ...(change.data?.args || {}) };
            }

            if (change.measures_to_add) updatedDeviceConfig.measures_to_add = change.measures_to_add;
            if (change.measures_to_remove) updatedDeviceConfig.measures_to_remove = change.measures_to_remove;
            if (change.measures_to_modify) updatedDeviceConfig.measures_to_modify = change.measures_to_modify;

            finalDeviceConfig.set(deviceId, updatedDeviceConfig);
        }
        const finalDevicesPayload = Array.from(finalDeviceConfig.values());


        // --- B. CHUẨN BỊ DỮ LIỆU SYSTEM (COMS) ---
        let finalComsPayload = JSON.parse(JSON.stringify(appData.system_coms_config || []));

        if (appData.system_coms_pending_changes) {
            for (const [portName, newConfig] of Object.entries(appData.system_coms_pending_changes)) {
                const index = finalComsPayload.findIndex(c => c.name === portName);
                if (index !== -1) {
                    finalComsPayload[index] = newConfig;
                } else {
                    finalComsPayload.push(newConfig);
                }
            }
        }

        // --- C. CHUẨN BỊ DỮ LIỆU CLOUD (MỚI THÊM) ---
        // Lấy config gốc của cloud (hoặc mảng rỗng)
        let finalCloudsPayload = JSON.parse(JSON.stringify(appData.cloud_config || []));

        // Kiểm tra xem có thay đổi pending nào cho cloud không
        // (Hiện tại ta dùng key cố định 'default_cloud' trong page-cloud-config.js)
        if (appData.cloud_pending_changes && appData.cloud_pending_changes['default_cloud']) {
            const newCloudConfig = appData.cloud_pending_changes['default_cloud'];

            // Logic: Vì hệ thống thường chỉ có 1 cloud "default", ta sẽ cập nhật phần tử đầu tiên
            // hoặc thêm mới nếu danh sách đang rỗng.
            if (finalCloudsPayload.length > 0) {
                // Giữ lại _id cũ nếu có để tránh tạo trùng lặp không mong muốn
                newCloudConfig._id = finalCloudsPayload[0]._id;
                finalCloudsPayload[0] = newCloudConfig;
            } else {
                finalCloudsPayload.push(newCloudConfig);
            }
        }
        let finalIec104Payload = JSON.parse(JSON.stringify(appData.iec104_config || {}));
        if (appData.iec104_pending_changes) {
            finalIec104Payload = appData.iec104_pending_changes;
        }


        // --- D. GỬI PAYLOAD HỢP NHẤT ---
        const unifiedPayload = {
            devices: finalDevicesPayload,
            coms: finalComsPayload,
            clouds: finalCloudsPayload,
            iec104: finalIec104Payload
        };

        console.log("🚀 [UNIFIED PAYLOAD] Sending:", unifiedPayload);

        // Gọi API Unified
        await api.applyUnifiedConfiguration(unifiedPayload);

        alert('Cấu hình hợp nhất (Solar, System, Cloud) đã được áp dụng thành công!');

        // Reload sau 3 giây
        setTimeout(() => {
            location.reload();
        }, 3000);

    } catch (error) {
        alert(`Lỗi khi áp dụng thay đổi: ${error.message}`);
        console.error("Critical Error in applyGlobalChanges:", error);
    } finally {
        pageState.is_applying = false;
        if (button) {
            button.disabled = false;
            button.textContent = 'Apply Changes & Restart';
        }
    }
}