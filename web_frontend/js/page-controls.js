/**
 * Tệp page-controls.js: Logic cho trang Điều khiển
 * - Xử lý các hành động của người dùng (bật/tắt, nhập giá trị).
 * - Gọi API để gửi lệnh điều khiển.
 * - Render trạng thái kết nối, giá trị đo lường và các mục điều khiển.
 */
import { appData, pageInitFunctions, pageRenderFunctions } from './main.js';
function initControlPage() {
    document.getElementById('control-evn-enable-adj-switch').addEventListener('change', (e) => {
        window.updateMeasureValue(e.target.dataset.measure, e.target.checked ? 1 : 0);
    });

    document.getElementById('apply-control-changes-btn').addEventListener('click', () => {
        const inputKw = document.getElementById('input-powerset-kw');
        const inputPe = document.getElementById('input-powerset-pe');
        if (inputKw.value !== '') updateMeasureValue(inputKw.dataset.measure, parseFloat(inputKw.value));
        if (inputPe.value !== '') updateMeasureValue(inputPe.dataset.measure, parseFloat(inputPe.value));
        inputKw.value = '';
        inputPe.value = '';
    });

    document.getElementById('reset-control-changes-btn').addEventListener('click', () => {
        document.getElementById('input-powerset-kw').value = '';
        document.getElementById('input-powerset-pe').value = '';
    });
}

function renderControlPage() {
    
    try {
        const rt = appData.realtime_values;
        const iec104Status = appData.iec104_status;
        if (!rt) return;
        
        // Hàm helper mới, dùng tên đầy đủ
        const getValue = (controller, fullName) => rt[controller]?.[fullName];
        const safeParseFloat = (controller, fullName, defaultValue = 0) => {
            const measure = getValue(controller, fullName);
            if (measure?.value !== null && measure?.value !== undefined) {
                const parsed = parseFloat(measure.value);
                return isNaN(parsed) ? defaultValue : parsed;
            }
            return defaultValue;
        };
        const formatDisplayValue = (controller, fullName, unit) => {
             const measure = getValue(controller, fullName);
             if (measure?.value !== null && measure?.value !== undefined) {
                 const parsed = parseFloat(measure.value);
                 return isNaN(parsed) ? `N/A ${unit}` : `${parsed.toFixed(2)} ${unit}`;
             }
             return `N/A ${unit}`;
        };

        // 1. Trạng thái kết nối (giữ nguyên)
        const isConnected = iec104Status?.active_links?.some(link => link.status_code === 1);
        const connectedIp = isConnected ? iec104Status.active_links.find(link => link.status_code === 1).ip : "N/A";
        document.getElementById('iec104-connection-status-indicator').classList.toggle('online', isConnected);
        document.getElementById('iec104-connection-status-text').textContent = isConnected ? 'Connected' : 'Disconnected';
        document.getElementById('control-ip-display').textContent = connectedIp;

        // 2. Measured Values - Sử dụng hàm helper mới
        const configuredPower = safeParseFloat("Logger", "INVT_T:P_Max", 1);
        const gridPower = safeParseFloat("Zero_Export", "PM01:ActivePowerSum");
        const solarPower = safeParseFloat("Logger", "INVT_T:ActivePowerSum");
        const powerSetkW = safeParseFloat("EVN", "PM01:PowerSetkW");
        
        // 3. Cập nhật giao diện với các giá trị đã được định dạng
        document.getElementById('control-pm01-activepowersum').textContent = formatDisplayValue("Zero_Export", "PM01:ActivePowerSum", "kW");
        document.getElementById('progress-grid-power').style.width = `${(Math.abs(gridPower) / configuredPower) * 100}%`;
        
        document.getElementById('control-invt-activepowersum').textContent = formatDisplayValue("Logger", "INVT_T:ActivePowerSum", "kW");
        document.getElementById('progress-solar-power').style.width = `${(solarPower / configuredPower) * 100}%`;
        
        document.getElementById('control-invt-pmax').textContent = formatDisplayValue("INVT_T", "INVT_T:P_Max", "kW");
        document.getElementById('progress-config-power').style.width = `${(powerSetkW / configuredPower) * 100}%`;

        // 4. Yesterday's Energy
        document.getElementById('control-invt-ex-yenergy').textContent = formatDisplayValue("EVNT", "INVT_T:Ex_YEnergy", "kWh");
        document.getElementById('control-pm01-im-yenergy').textContent = formatDisplayValue("EVN", "PM01:Im_YEnergy", "kWh");
        document.getElementById('control-pm01-ex-yenergy').textContent = formatDisplayValue("EVN", "PM01:Ex_YEnergy", "kWh");

        // 5. Set Values
        const enableAdjValue = getValue('EVN', 'EVN:Enable_Adj')?.value;
        document.getElementById('control-evn-enable-adj-switch').checked = (enableAdjValue === 1);
        
        const currentPowerSetkW = (getValue('EVN', 'PM01:PowerSetkW')?.value ?? 'N/A');
        document.querySelector('.current-value-display[data-measure="PM01:PowerSetkW"]').textContent = `Hiện tại: ${currentPowerSetkW} kW`;
        
        const currentPowerSetPe = (getValue('EVN', 'PM01:PowerSetPe')?.value ?? 'N/A');
        document.querySelector('.current-value-display[data-measure="PM01:PowerSetPe"]').textContent = `Hiện tại: ${currentPowerSetPe} %`;

    } catch (error) {
        console.error('[Control Page] LỖI NGHIÊM TRỌNG TRONG KHI RENDER:', error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    pageInitFunctions['control-page'] = initControlPage;
    pageRenderFunctions['control-page'] = renderControlPage;
});