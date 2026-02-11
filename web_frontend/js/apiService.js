// --- START OF FILE js/apiService.js ---

/**
 * apiService.js: Module tập trung tất cả các lệnh gọi API (fetch) đến backend.
 * Cung cấp các hàm đã được trừu tượng hóa và xử lý lỗi chung.
 */

/**
 * Hàm helper xử lý response chung từ fetch.
 * @param {Response} response - Đối tượng response từ fetch.
 * @returns {Promise<any>} - Dữ liệu JSON nếu thành công.
 * @throws {Error} - Ném ra lỗi với thông điệp từ server nếu thất bại.
 */
async function handleResponse(response) {
    const data = await response.json();
    if (!response.ok) {
        // Ưu tiên message từ server, nếu không có thì dùng statusText
        const errorMessage = data?.message || response.statusText;
        throw new Error(errorMessage);
    }
    return data;
}

/** Lấy cấu hình solar hiện tại */
export async function getSolarConfiguration() {
    const response = await fetch('/api/solar_configuration');
    return handleResponse(response);
}

/** Lấy danh sách templates phân cấp */
export async function getTemplates() {
    const response = await fetch('/api/templates');
    return handleResponse(response);
}

/** Lấy định nghĩa các protocols */
export async function getProtocols() {
    const response = await fetch('/api/protocols');
    return handleResponse(response);
}

/** Gửi các thay đổi cấu hình solar lên server */
export async function applyGlobalChanges(payload) {
    const response = await fetch('/api/solar_configuration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ devices: payload })
    });
    return handleResponse(response);
}

/** Lấy chi tiết các biến đo của một thiết bị */
export async function getDeviceMeasuresDetails(deviceName) {
    const response = await fetch(`/api/device_measures_details/${deviceName}`);
    return handleResponse(response);
}

/** Gửi lệnh ghi giá trị mới cho một biến đo */
export async function updateMeasureValue(measureName, newValue) {
    const response = await fetch('/api/write_device_value', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ measure_name: measureName, new_value: newValue })
    });
    return handleResponse(response);
}

/** Lấy dữ liệu lịch sử cho biểu đồ */
export async function getHistoricalData(sensorIds, startTime, endTime, resolution) {
    const params = new URLSearchParams({
        sensor_ids: sensorIds.join(','),
        start_time: Math.floor(startTime / 1000), // convert to UNIX timestamp
        end_time: Math.floor(endTime / 1000),
        resolution: resolution
    });
    const response = await fetch(`/api/history?${params.toString()}`);
    return handleResponse(response);
}
export async function getSystemComsConfig() {
    const response = await fetch('/api/system_configuration');
    return handleResponse(response);
}
export async function applyUnifiedConfiguration(payload) {
    const response = await fetch('/api/system_configuration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return handleResponse(response);
}
export async function getCloudUploadRules() {
    try {
        const response = await fetch('/api/cloud_upload_rules');
        return handleResponse(response);
    } catch (e) {
        return [];
    }
}

export async function saveCloudUploadRules(rules) {
    const response = await fetch('/api/cloud_upload_rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rules)
    });
    return handleResponse(response);
}
export async function getUserSettings() {
    try {
        const response = await fetch('/api/user_settings');
        return await response.json();
    } catch (e) {
        console.warn("Could not load user settings, using default.", e);
        return {};
    }
}

export async function saveUserSettings(settings) {
    const response = await fetch('/api/user_settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
    });
    return handleResponse(response);
}
export async function getLoggingRules() {
    const response = await fetch('/api/logging_rules');
    return handleResponse(response);
}

// Lưu danh sách mới
export async function saveLoggingRules(rulesArray) {
    const response = await fetch('/api/logging_rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rulesArray)
    });
    return handleResponse(response);
}
export async function getChartConfig() {
    const response = await fetch('/api/chart_config');
    return handleResponse(response);
}

export async function saveChartConfig(config) {
    const response = await fetch('/api/chart_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
    });
    return handleResponse(response);
}
export async function updateManualState(id, value) {
    const response = await fetch('/api/update_manual_state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, value })
    });
    return handleResponse(response);
}
export async function updateManualValue(id, value) {
    const response = await fetch('/api/update_manual_value', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, value })
    });
    return handleResponse(response);
}
// --- END OF FILE js/apiService.js ---