import * as api from './apiService.js';
import { appData, pageInitFunctions, pageRenderFunctions, getUnit, formatTimestamp } from './main.js';
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 74, g: 222, b: 128 }; // Mặc định xanh lá nếu lỗi
}

// 2. Tạo Gradient từ trên xuống dưới
function createGradient(ctx, r, g, b) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.5)`); // Đậm ở trên
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.0)`); // Trong suốt ở dưới
    return gradient;
}

let overviewPowerChart;

// Hàm helper xử lý thời gian cho input datetime-local
const toLocalISOString = date => {
    const pad = num => (num < 10 ? '0' : '') + num;
    return date.getFullYear() +
        '-' + pad(date.getMonth() + 1) +
        '-' + pad(date.getDate()) +
        'T' + pad(date.getHours()) +
        ':' + pad(date.getMinutes());
};

// 1. CẤU HÌNH MẶC ĐỊNH (Dùng khi chưa có localStorage)
const DEFAULT_OVERVIEW_CONFIG = [
    { id: 1, alias: "P-OUT", realName: "Công suất phát lưới", isMandatory: true, controller: "Zero_Export", fullName: "PM01:ActivePowerSum", defaultUnit: "kW" },
    { id: 2, alias: "P-INV-OUT", realName: "Công suất Inverter", isMandatory: true, controller: "Logger", fullName: "INVT_T:ActivePowerSum", defaultUnit: "kW" },
    { id: 3, alias: "A D-I", realName: "Điện năng giao hôm qua", isMandatory: false, controller: "EVN", fullName: "INVT_T:Ex_YEnergy", defaultUnit: "kWh" },
    { id: 4, alias: "A Daily", realName: "Điện năng giao hôm nay", isMandatory: false, controller: "EVN", fullName: "INVT_T:Ex_DEnergy", defaultUnit: "kWh" },
    { id: 5, alias: "Cosphi", realName: "Hệ số công suất", isMandatory: true, controller: "Zero_Export", fullName: "PM01:T_PowerFactor", defaultUnit: "" },
    { id: 6, alias: "Q-INV-OUT", realName: "Công suất phản kháng", isMandatory: true, controller: "Zero_Export", fullName: "PM01:ReActivePowerSum", defaultUnit: "kVar" },
    { id: 7, alias: "Ia", realName: "Dòng điện pha A", isMandatory: true, controller: "Zero_Export", fullName: "PM01:Ia", defaultUnit: "A" },
    { id: 8, alias: "Ib", realName: "Dòng điện pha B", isMandatory: true, controller: "Zero_Export", fullName: "PM01:Ib", defaultUnit: "A" },
    { id: 9, alias: "Ic", realName: "Dòng điện pha C", isMandatory: true, controller: "Zero_Export", fullName: "PM01:Ic", defaultUnit: "A" },
    { id: 10, alias: "Ua", realName: "Điện áp pha A", isMandatory: true, controller: "Zero_Export", fullName: "PM01:Ua", defaultUnit: "V" },
    { id: 11, alias: "Ub", realName: "Điện áp pha B", isMandatory: true, controller: "Zero_Export", fullName: "PM01:Ub", defaultUnit: "V" },
    { id: 12, alias: "Uc", realName: "Điện áp pha C", isMandatory: true, controller: "Zero_Export", fullName: "PM01:Uc", defaultUnit: "V" },
    { id: 13, alias: "Frequence", realName: "Tần số lưới", isMandatory: true, controller: "Zero_Export", fullName: "PM01:Freq", defaultUnit: "Hz" }
];

// Biến lưu cấu hình hiện tại
let currentOverviewConfig = [];

// --- CÁC HÀM HỖ TRỢ TIME & CHART ---
function getDateRange(range) {
    const now = new Date();
    let startTime, endTime = new Date();

    switch (range) {
        case 'today':
            startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
            break;
        case 'yesterday':
            const yesterday = new Date(now);
            yesterday.setDate(now.getDate() - 1);
            startTime = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0);
            endTime = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59);
            break;
        case '7d':
            const sevenDaysAgo = new Date(now);
            sevenDaysAgo.setDate(now.getDate() - 7);
            startTime = new Date(sevenDaysAgo.getFullYear(), sevenDaysAgo.getMonth(), sevenDaysAgo.getDate(), 0, 0, 0);
            break;
        default:
            return null;
    }
    return { startTime, endTime };
}

function updateActiveButtonUI(activeButton) {
    document.querySelectorAll('.custom-time-filter .btn').forEach(btn => {
        btn.classList.remove('active');
    });
    if (activeButton) {
        activeButton.classList.add('active');
    }
}

function updateResolutionOptions() {
    const startPicker = document.getElementById('start-time-picker');
    const endPicker = document.getElementById('end-time-picker');
    const resolutionSelector = document.getElementById('resolution-selector');

    if (!resolutionSelector) return;

    const options = {
        auto: resolutionSelector.querySelector('option[value="auto"]'),
        raw: resolutionSelector.querySelector('option[value="raw"]'),
        '1min': resolutionSelector.querySelector('option[value="1min"]'),
        '5min': resolutionSelector.querySelector('option[value="5min"]')
    };

    // Reset disabled
    Object.values(options).forEach(opt => { if (opt) opt.disabled = false; });

    if (!startPicker.value || !endPicker.value) return;

    const startTime = new Date(startPicker.value);
    const endTime = new Date(endPicker.value);

    if (isNaN(startTime) || isNaN(endTime) || startTime >= endTime) return;

    const diffHours = (endTime - startTime) / (1000 * 60 * 60);

    if (diffHours > 72) {
        if (options.auto) options.auto.disabled = true;
        if (options.raw) options.raw.disabled = true;
        if (options['1min']) options['1min'].disabled = true;
        if (resolutionSelector.value === 'auto' || resolutionSelector.value === 'raw' || resolutionSelector.value === '1min') {
            resolutionSelector.value = '5min';
        }
    }
    else if (diffHours > 3) {
        if (options.auto) options.auto.disabled = true;
        if (options.raw) options.raw.disabled = true;
        if (resolutionSelector.value === 'auto' || resolutionSelector.value === 'raw') {
            resolutionSelector.value = '1min';
        }
    }
}

function updateChartUIState(mode, startTime, endTime) {
    const titleEl = document.getElementById('overview-chart-title');
    const timeFilterContainer = document.querySelector('.custom-time-filter');

    if (timeFilterContainer) {
        timeFilterContainer.classList.remove('realtime-mode', 'history-mode');
    }

    if (mode === 'realtime') {
        titleEl.innerHTML = 'Biểu đồ công suất tổng <span class="chart-mode-badge realtime">(Real-time)</span>';
        if (timeFilterContainer) timeFilterContainer.classList.add('realtime-mode');
    } else if (mode === 'history') {
        const startStr = startTime.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const endStr = endTime.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        titleEl.innerHTML = `Biểu đồ công suất tổng <span class="chart-mode-badge history">(Từ ${startStr} - ${endStr})</span>`;
        if (timeFilterContainer) timeFilterContainer.classList.add('history-mode');
    } else {
        titleEl.innerHTML = 'Biểu đồ công suất tổng <span class="chart-mode-badge history">(Chọn khoảng thời gian)</span>';
        if (timeFilterContainer) timeFilterContainer.classList.add('history-mode');
    }
}
// --- INIT PAGE ---
function initOverviewPage() {

    // 1. Load cấu hình bảng từ LocalStorage (Giữ nguyên)
    loadOverviewConfig();
    const configBtn = document.getElementById('btn-open-chart-config');
    if (configBtn) {
        // Hiệu ứng hover cho đẹp
        configBtn.onmouseover = () => configBtn.style.color = '#fff';
        configBtn.onmouseout = () => configBtn.style.color = '#cbd5e1';

        // Gán hàm mở Modal
        configBtn.onclick = openChartConfigModal;
    } else {
        console.warn("Không tìm thấy nút cấu hình biểu đồ (btn-open-chart-config)");
    }
    const chartContainer = document.querySelector('.chart-container h3');
    if (chartContainer && !document.getElementById('btn-open-chart-config')) {
        const btn = document.createElement('button');
        btn.id = 'btn-open-chart-config';
        btn.innerHTML = '<i class="bi bi-gear-fill"></i>';
        btn.className = 'edit-icon';
        btn.style.marginLeft = '10px';
        btn.title = "Cấu hình đường vẽ";
        btn.onclick = openChartConfigModal;
        chartContainer.appendChild(btn);
    }

    // 2. Init Chart với Giao diện mới
    if (!overviewPowerChart && window.Chart) {
        const canvas = document.getElementById('realtime-power-chart-overview');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            overviewPowerChart = new Chart(ctx, {
                type: 'line',
                data: { labels: [], datasets: [] }, // Chưa có dataset nào
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    scales: {
                        x: { type: 'time', time: { unit: 'minute', tooltipFormat: 'dd/MM/yyyy HH:mm:ss' } },
                        y: { title: { display: true, text: 'Giá trị' }, beginAtZero: true }
                    },
                    plugins: {
                        legend: {
                            position: 'top',
                            align: 'end',
                            labels: {
                                usePointStyle: true, // <--- Bắt buộc để hiện hình tròn
                                pointStyle: 'circle', // <--- Hình tròn
                                color: '#cbd5e1',
                                font: { family: "'Montserrat', sans-serif", size: 12 }
                            }
                        },
                        tooltip: {
                            mode: 'index',
                            intersect: false,
                            usePointStyle: true // Tooltip cũng hiện hình tròn
                        }
                    },
                    interaction: {
                        mode: 'nearest',
                        axis: 'x',
                        intersect: false
                    },
                    elements: {
                        line: { tension: 0.4 } // Đường cong mềm mại
                    }
                }
            });
        }
    }
    refreshChartFromConfig();

    // ... (Phần Event Listeners phía dưới giữ nguyên) ...
    // Copy lại đoạn Event Listener từ code cũ vào đây
    const fetchBtn = document.getElementById('fetch-history-btn');
    if (fetchBtn) fetchBtn.addEventListener('click', fetchCustomHistoricalData);

    const rtBtn = document.getElementById('realtime-btn');
    if (rtBtn) rtBtn.addEventListener('click', switchToRealtimeMode);

    document.querySelectorAll('.preset-btn').forEach(button => {
        button.addEventListener('click', (event) => {
            const range = event.currentTarget.dataset.range;
            const dates = getDateRange(range);
            if (dates) {
                document.getElementById('start-time-picker').value = toLocalISOString(dates.startTime);
                document.getElementById('end-time-picker').value = toLocalISOString(dates.endTime);
                updateActiveButtonUI(event.currentTarget);
                updateResolutionOptions();
                fetchCustomHistoricalData();
            }
        });
    });

    const startPicker = document.getElementById('start-time-picker');
    if (startPicker) startPicker.addEventListener('change', updateResolutionOptions);

    const endPicker = document.getElementById('end-time-picker');
    if (endPicker) endPicker.addEventListener('change', updateResolutionOptions);

    const timeFilterContainer = document.querySelector('.custom-time-filter');
    if (timeFilterContainer) {
        timeFilterContainer.addEventListener('click', (event) => {
            if (timeFilterContainer.classList.contains('realtime-mode')) {
                updateChartUIState('standby');
                updateActiveButtonUI(null);
                if (event.target.matches('input, select')) {
                    event.target.focus();
                }
            }
        });
    }

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - (60 * 60 * 1000));
    if (endPicker) endPicker.value = toLocalISOString(now);
    if (startPicker) startPicker.value = toLocalISOString(oneHourAgo);
    if (appData.chart_config && appData.chart_config.datasets) {
        console.log("📈 Đang tái tạo biểu đồ từ file lưu trữ...");
        refreshChartFromConfig(); 
    }

    switchToRealtimeMode();
    updateResolutionOptions();
}
function refreshChartFromConfig() {
    if (!overviewPowerChart) return;

    const config = appData.chart_config || {};
    const datasetsConfig = config.datasets || [];
    const ctx = overviewPowerChart.ctx; // Lấy context vẽ từ biểu đồ

    // Reset dữ liệu
    overviewPowerChart.data.datasets = [];
    appData.overviewPage.chartHistory = {
        labels: [],
        datasets: {},
        currentFilter: 'Real time'
    };

    datasetsConfig.forEach(cfg => {
        const uniqueKey = `${cfg.device}:${cfg.measure}`;

        // 1. Tính toán màu sắc Gradient
        const hexColor = cfg.color || '#4ade80';
        const rgb = hexToRgb(hexColor);
        const gradient = createGradient(ctx, rgb.r, rgb.g, rgb.b);

        // 2. Tạo Dataset với Style đẹp
        const newDataset = {
            label: cfg.label || uniqueKey,

            borderColor: hexColor,       // Màu đường viền (Đậm)
            backgroundColor: gradient,   // Màu nền (Loang mờ)

            fill: true,                  // <--- BẬT FILL ĐỂ HIỆN GRADIENT
            borderWidth: 2,
            pointRadius: 0,              // Ẩn điểm trên đường (cho mượt)
            pointHoverRadius: 4,         // Hiện điểm khi di chuột
            tension: 0.4,                // Độ cong
            data: []
        };

        overviewPowerChart.data.datasets.push(newDataset);

        // Map vào appData để update realtime
        appData.overviewPage.chartHistory.datasets[uniqueKey] = newDataset;
    });

    overviewPowerChart.update();
    switchToRealtimeMode();
}
function openChartConfigModal() {
    const overlay = document.getElementById('chart-config-overlay');
    overlay.classList.remove('hidden');

    // Render bảng hiện tại
    renderChartConfigTable();

    // Nạp dropdown Device
    const devSelect = document.getElementById('chart-add-device');
    const controllers = Object.values(appData.controllers_config || {});
    devSelect.innerHTML = `<option value="">-- Chọn TB --</option>` +
        controllers.map(c => `<option value="${c.name}">${c.name}</option>`).join('');

    // Reset dropdown Measure
    document.getElementById('chart-add-measure').innerHTML = '';
    document.getElementById('chart-add-measure').disabled = true;
}

// Render bảng trong Modal
function renderChartConfigTable() {
    const tbody = document.getElementById('chart-config-body');
    const config = appData.chart_config || {};
    const datasets = config.datasets || [];

    tbody.innerHTML = datasets.map((ds, idx) => `
        <tr>
            <td>${ds.device}</td>
            <td>${ds.measure}</td>
            <td><input type="text" class="modal-input ds-label" value="${ds.label}" onchange="updateDataset(${idx}, 'label', this.value)"></td>
            <td><input type="color" value="${ds.color}" onchange="updateDataset(${idx}, 'color', this.value)"></td>
            <td style="text-align: center;"><button class="delete-icon" onclick="removeDataset(${idx})"><i class="bi bi-trash"></i></button></td>
        </tr>
    `).join('');
}

// Các hàm helper được gọi từ HTML (Gán vào window để HTML gọi được)
window.updateDataset = function (idx, field, value) {
    if (appData.chart_config.datasets[idx]) {
        appData.chart_config.datasets[idx][field] = value;
    }
};

window.removeDataset = function (idx) {
    appData.chart_config.datasets.splice(idx, 1);
    renderChartConfigTable();
};

// Gắn sự kiện cho các nút trong Modal
document.addEventListener('DOMContentLoaded', () => {
    // 1. Khi chọn Device -> Nạp Measure
    const devSelect = document.getElementById('chart-add-device');
    const measSelect = document.getElementById('chart-add-measure');

    if (devSelect) {
        devSelect.addEventListener('change', () => {
            const devName = devSelect.value;
            if (!devName) { measSelect.disabled = true; return; }

            const measures = (appData.measures_list || []).filter(m => m.ctrlName === devName);
            measSelect.innerHTML = measures.map(m => `<option value="${m.name}">${m.name} (${m.unit || ''})</option>`).join('');
            measSelect.disabled = false;
        });
    }

    // 2. Nút Thêm dòng
    const btnAdd = document.getElementById('btn-add-chart-line');
    if (btnAdd) {
        btnAdd.addEventListener('click', () => {
            const dev = devSelect.value;
            const meas = measSelect.value;
            const color = document.getElementById('chart-add-color').value;

            if (!dev || !meas) return alert("Vui lòng chọn thiết bị và biến!");

            if (!appData.chart_config.datasets) appData.chart_config.datasets = [];

            // Check trùng
            const exists = appData.chart_config.datasets.some(d => d.device === dev && d.measure === meas);
            if (exists) return alert("Biến này đã có trên biểu đồ!");

            appData.chart_config.datasets.push({
                device: dev,
                measure: meas,
                label: `${dev}:${meas}`,
                color: color
            });
            renderChartConfigTable();
        });
    }

    // 3. Nút Lưu (QUAN TRỌNG: LOGIC TỰ ĐỘNG GHI LOG)
    const btnSave = document.getElementById('save-chart-config');
    if (btnSave) {
        btnSave.addEventListener('click', async () => {
            const datasets = appData.chart_config.datasets || [];
            if (datasets.length === 0) return alert("Biểu đồ cần ít nhất 1 đường vẽ.");

            // A. Tự động thêm vào Logging Whitelist
            let whitelistChanged = false;
            datasets.forEach(ds => {
                const key = `${ds.device}:${ds.measure}`;
                if (!appData.logging_whitelist.includes(key)) {
                    appData.logging_whitelist.push(key);
                    whitelistChanged = true;
                    console.log(`Auto-added to logging: ${key}`);
                }
            });

            try {
                // B. Lưu Logging Rules trước (nếu có đổi)
                if (whitelistChanged) {
                    await api.saveLoggingRules(appData.logging_whitelist);
                }

                // C. Lưu Chart Config
                await api.saveChartConfig(appData.chart_config);

                alert("Đã lưu cấu hình biểu đồ thành công!");
                document.getElementById('chart-config-overlay').classList.add('hidden');

                // D. Vẽ lại
                refreshChartFromConfig();

            } catch (e) {
                console.error(e);
                alert("Lỗi khi lưu: " + e.message);
            }
        });
    }

    // Nút Đóng/Hủy
    const closeFunc = () => document.getElementById('chart-config-overlay').classList.add('hidden');
    if (document.getElementById('close-chart-modal')) document.getElementById('close-chart-modal').onclick = closeFunc;
    if (document.getElementById('cancel-chart-config')) document.getElementById('cancel-chart-config').onclick = closeFunc;
});

// --- DATA LOADING & SAVING (CONFIG) ---

async function saveOverviewConfigFromModal() {
    const rows = document.querySelectorAll('#config-table-body tr');
    const newConfig = [];

    rows.forEach((tr, index) => {
        const alias = tr.querySelector('.input-alias').value;
        const realName = tr.querySelector('.input-realname').value;
        const ctrl = tr.querySelector('.config-ctrl-select').value;
        const measure = tr.querySelector('.config-measure-select').value;
        const isMandatory = tr.querySelector('.input-mandatory').checked;

        let unit = "";
        // Tìm unit từ appData
        if (appData.measures_list) {
            const mInfo = appData.measures_list.find(m => m.name === measure && m.ctrlName === ctrl);
            if (mInfo) unit = mInfo.unit;
        }

        newConfig.push({
            id: index + 1,
            alias: alias,
            realName: realName,
            controller: ctrl,
            fullName: measure,
            isMandatory: isMandatory,
            defaultUnit: unit
        });
    });

    currentOverviewConfig = newConfig;

    // Cập nhật AppData
    if (!appData.user_settings) appData.user_settings = {};
    appData.user_settings.overview_table = currentOverviewConfig;

    // Gửi API
    try {
        const btn = document.getElementById('btn-save-overview-config');
        if (btn) { btn.textContent = "Đang lưu..."; btn.disabled = true; }

        await api.saveUserSettings(appData.user_settings);

        alert("Đã lưu cấu hình hiển thị vào Server thành công!");
        document.getElementById('overview-config-overlay').remove();
        renderOverviewPage(); // Vẽ lại trang ngay lập tức

    } catch (e) {
        console.error(e);
        alert("Lỗi khi lưu vào Server: " + e.message);
        if (btn) { btn.textContent = "Lưu thay đổi"; btn.disabled = false; }
    }
}

// --- MODAL LOGIC (ADD/REMOVE/EDIT) ---
function showConfigModal() {
    // 1. Xóa modal cũ nếu có để tránh trùng lặp
    const old = document.getElementById('overview-config-overlay');
    if (old) old.remove();

    // 2. Tạo HTML Modal
    const modalHtml = `
    <div id="overview-config-overlay" class="overlay" style="opacity: 1; visibility: visible; display: flex;">
        <div class="modal" style="max-width: 1000px; width: 95%; max-height: 90vh; display: flex; flex-direction: column;">
            <div class="modal-header">
                <h3>Cấu hình bảng hiển thị</h3>
                <button class="modal-close-btn" id="btn-close-overview-modal">&times;</button>
            </div>
            <div class="modal-body" style="overflow-y: auto; flex: 1; padding: 10px;">
                <table class="control-table" style="font-size: 0.85rem;">
                    <thead>
                        <tr>
                            <th style="width: 40px;">#</th>
                            <th style="width: 150px;">Ký hiệu (Alias)</th>
                            <th style="width: 200px;">Tên mô tả</th>
                            <th>Thiết bị (Controller)</th>
                            <th>Biến đo (Measure)</th>
                            <th style="width: 60px; text-align: center;">(*)</th>
                            <th style="width: 50px;">Xóa</th>
                        </tr>
                    </thead>
                    <tbody id="config-table-body">
                        <!-- Rows -->
                    </tbody>
                </table>
                <div style="margin-top: 15px; text-align: center;">
                    <!-- ID NÚT THÊM DÒNG -->
                    <button class="btn btn-secondary" id="btn-add-row-overview" style="width: 100%; border-style: dashed;">+ Thêm dòng mới</button>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" id="btn-reset-default" style="margin-right: auto;">Khôi phục gốc</button>
                <button class="btn btn-secondary" id="btn-cancel-overview">Hủy</button>
                <button class="btn btn-primary" id="btn-save-overview-config">Lưu thay đổi</button>
            </div>
        </div>
    </div>
    `;

    // 3. Chèn vào Body
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 4. Render dữ liệu hiện tại
    renderConfigRows();

    // 5. GÁN SỰ KIỆN (Quan trọng)

    // Nút Đóng / Hủy
    const closeModal = () => document.getElementById('overview-config-overlay').remove();
    document.getElementById('btn-close-overview-modal').onclick = closeModal;
    document.getElementById('btn-cancel-overview').onclick = closeModal;

    // Nút Khôi phục gốc
    document.getElementById('btn-reset-default').onclick = () => {
        if (confirm('Bạn có chắc muốn khôi phục về cấu hình mặc định?')) {
            currentOverviewConfig = JSON.parse(JSON.stringify(DEFAULT_OVERVIEW_CONFIG));
            saveOverviewConfigFromModal(); // Lưu luôn
        }
    };

    // Nút Lưu
    document.getElementById('btn-save-overview-config').onclick = saveOverviewConfigFromModal;

    // [FIX] Nút Thêm dòng mới
    const btnAdd = document.getElementById('btn-add-row-overview');
    if (btnAdd) {
        btnAdd.onclick = () => {
            console.log("Click Add Row"); // Debug log
            const tbody = document.getElementById('config-table-body');
            const newIndex = tbody.children.length + 1;

            // Tạo dữ liệu dòng rỗng
            const emptyRowData = {
                id: newIndex,
                alias: "",
                realName: "",
                controller: "",
                fullName: "",
                isMandatory: false
            };

            // Chèn HTML dòng mới vào cuối bảng
            tbody.insertAdjacentHTML('beforeend', generateRowHtml(emptyRowData, newIndex - 1));

            // Gán sự kiện cho các ô select/delete trong dòng mới vừa tạo
            attachRowListeners(tbody.lastElementChild);

            // Cuộn xuống cuối
            tbody.lastElementChild.scrollIntoView({ behavior: "smooth", block: "end" });
        };
    } else {
        console.error("Không tìm thấy nút btn-add-row-overview");
    }
}

function generateRowHtml(item, index) {
    const controllers = appData.controllers_config || {};
    const measures = appData.measures_config || {};

    // Option Controller
    let ctrlOptions = `<option value="">-- Chọn --</option>`;
    Object.values(controllers).forEach(c => {
        ctrlOptions += `<option value="${c.name}" ${c.name === item.controller ? 'selected' : ''}>${c.name}</option>`;
    });

    // Option Measure
    let measureOptions = `<option value="">-- Chọn biến --</option>`;
    if (item.controller) {
        Object.values(measures).forEach(m => {
            if (m.ctrlName === item.controller) {
                measureOptions += `<option value="${m.name}" ${m.name === item.fullName ? 'selected' : ''}>${m.name} (${m.unit})</option>`;
            }
        });
    }

    return `
        <tr data-index="${index}" class="config-row">
            <td style="text-align: center;">${index + 1}</td>
            <td><input type="text" class="modal-input input-alias" value="${item.alias}" placeholder="VD: Ua"></td>
            <td><input type="text" class="modal-input input-realname" value="${item.realName}" placeholder="VD: Điện áp pha A"></td>
            <td>
                <select class="config-ctrl-select modal-input" style="width: 100%;">${ctrlOptions}</select>
            </td>
            <td>
                <select class="config-measure-select modal-input" style="width: 100%;">${measureOptions}</select>
            </td>
            <td style="text-align: center;">
                <input type="checkbox" class="input-mandatory" ${item.isMandatory ? 'checked' : ''}>
            </td>
            <td style="text-align: center;">
                <button class="delete-row-btn" style="background:none; border:none; color:#ef4444; cursor:pointer;"><i class="bi bi-trash"></i></button>
            </td>
        </tr>
    `;
}

function renderConfigRows() {
    const tbody = document.getElementById('config-table-body');
    if (!tbody) return;
    tbody.innerHTML = currentOverviewConfig.map((item, idx) => generateRowHtml(item, idx)).join('');

    // Gắn sự kiện cho tất cả các dòng
    Array.from(tbody.children).forEach(attachRowListeners);
}

function attachRowListeners(tr) {
    const ctrlSelect = tr.querySelector('.config-ctrl-select');
    const measureSelect = tr.querySelector('.config-measure-select');
    const deleteBtn = tr.querySelector('.delete-row-btn');

    // Logic đổi Controller -> Load lại Measure
    ctrlSelect.addEventListener('change', (e) => {
        const selectedCtrl = e.target.value;
        const measures = appData.measures_config || {};
        let opts = `<option value="">-- Chọn biến --</option>`;
        if (selectedCtrl) {
            Object.values(measures).forEach(m => {
                if (m.ctrlName === selectedCtrl) {
                    opts += `<option value="${m.name}">${m.name} (${m.unit})</option>`;
                }
            });
        }
        measureSelect.innerHTML = opts;
    });

    // Logic Xóa dòng
    deleteBtn.addEventListener('click', () => {
        tr.remove();
        // Cập nhật lại số thứ tự trực quan
        document.querySelectorAll('#config-table-body tr').forEach((row, i) => {
            row.querySelector('td:first-child').textContent = i + 1;
        });
    });
}

// --- CHART DATA FETCHING ---
async function switchToRealtimeMode() {
    updateChartUIState('realtime');
    updateActiveButtonUI(document.getElementById('realtime-btn'));

    const chartHistory = appData.overviewPage.chartHistory;
    chartHistory.currentFilter = 'Real time';
    chartHistory.labels = [];
    Object.values(chartHistory.datasets).forEach(ds => ds.data = []);

    const endTime = Date.now();
    const startTime = endTime - (5 * 60 * 1000); // 5 phút trước
    const measuresToFetch = Object.keys(chartHistory.datasets);

    try {
        const backendResponse = await api.getHistoricalData(measuresToFetch, startTime, endTime, 'raw');
        processAndFillChartData(backendResponse);
    } catch (error) {
        console.error("Error pre-filling real-time chart:", error);
    }
}

async function fetchCustomHistoricalData() {
    if (!document.querySelector('.preset-btn.active')) {
        updateActiveButtonUI(document.getElementById('fetch-history-btn'));
    }

    appData.overviewPage.chartHistory.currentFilter = 'History';

    const startTimeValue = document.getElementById('start-time-picker').value;
    const endTimeValue = document.getElementById('end-time-picker').value;
    const resolution = document.getElementById('resolution-selector').value;

    if (!startTimeValue || !endTimeValue) {
        alert("Vui lòng chọn cả thời gian bắt đầu và kết thúc.");
        return;
    }

    const startTime = new Date(startTimeValue);
    const endTime = new Date(endTimeValue);

    if (isNaN(startTime) || isNaN(endTime) || startTime >= endTime) {
        alert("Thời gian không hợp lệ. Vui lòng đảm bảo thời gian bắt đầu nhỏ hơn thời gian kết thúc.");
        return;
    }

    updateChartUIState('history', startTime, endTime);

    const measuresToFetch = Object.keys(appData.overviewPage.chartHistory.datasets);
    const button = document.getElementById('fetch-history-btn');
    button.disabled = true;
    button.textContent = 'Đang tải...';

    try {
        const backendResponse = await api.getHistoricalData(measuresToFetch, startTime.getTime(), endTime.getTime(), resolution);
        processAndFillChartData(backendResponse);
    } catch (error) {
        console.error("Error fetching historical data:", error);
        alert(`Đã xảy ra lỗi khi tải dữ liệu lịch sử: ${error.message}`);
    } finally {
        button.disabled = false;
        button.textContent = 'Tải dữ liệu';
    }
}

function processAndFillChartData(backendResponse) {
    console.log(">>> [Chart History] Dữ liệu nhận từ API:", backendResponse);

    const chartHistory = appData.overviewPage.chartHistory;
    chartHistory.labels = [];
    
    // Reset data cũ
    Object.values(chartHistory.datasets).forEach(ds => ds.data = []);

    // Kiểm tra dữ liệu rỗng
    if (!backendResponse || Object.keys(backendResponse).length === 0) {
        console.warn(">>> [Chart History] API trả về rỗng! Kiểm tra lại DB hoặc khoảng thời gian.");
        alert("Không có dữ liệu lịch sử trong khoảng thời gian này.");
        renderOverviewPage();
        return;
    }

    const allTimestamps = new Set();
    Object.values(backendResponse).flat().forEach(item => allTimestamps.add(item.timestamp));
    
    // Sắp xếp thời gian
    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);
    console.log(`>>> [Chart History] Tìm thấy ${sortedTimestamps.length} điểm dữ liệu.`);

    // Convert sang ms cho ChartJS
    chartHistory.labels = sortedTimestamps.map(ts => ts * 1000);

    const measuresToProcess = Object.keys(chartHistory.datasets);
    
    measuresToProcess.forEach(uniqueKey => {
        // Backend trả về key dạng "Device:Measure" nếu bạn query đúng, 
        // hoặc backend trả về ID dạng "Device:Measure" tùy logic get_historical_readings
        // Ở db_utils.py của bạn đang trả về: grouped_results[sensor_id]
        
        const sensorData = backendResponse[uniqueKey] || [];
        
        if (sensorData.length === 0) {
            console.warn(`>>> [Chart History] Không có dữ liệu cho biến: ${uniqueKey}`);
        }

        const dataMap = new Map(sensorData.map(item => [item.timestamp, item.value]));
        
        // Map dữ liệu vào trục thời gian chung
        const dataArray = sortedTimestamps.map(ts => dataMap.get(ts) ?? null);

        // Fill gap (lấp đầy khoảng trống bằng giá trị trước đó)
        let lastValidValue = null;
        const filledData = dataArray.map(val => {
            if (val !== null) lastValidValue = val;
            return lastValidValue;
        });

        if (chartHistory.datasets[uniqueKey]) {
            chartHistory.datasets[uniqueKey].data = filledData;
        }
    });

    renderOverviewPage();
}

// --- RENDER CHÍNH ---
function renderOverviewPage() {
    const rt = appData.realtime_values;
    const getValue = (controller, fullName) => rt[controller]?.[fullName];

    // 1. HEADER & NÚT CẤU HÌNH
    const container = document.querySelector('.data-table-container');
    if (container) {
        let headerTitle = container.querySelector('h3');
        if (headerTitle && !headerTitle.querySelector('.config-btn')) {
            headerTitle.style.display = 'flex';
            headerTitle.style.justifyContent = 'space-between';
            headerTitle.style.alignItems = 'center';
            headerTitle.innerHTML = `
                <span>Thông số đo lường</span>
                <button class="config-btn" title="Cấu hình hiển thị" style="background:none; border:none; color:#cbd5e1; cursor:pointer;">
                    <i class="bi bi-gear-fill"></i>
                </button>
            `;
            headerTitle.querySelector('.config-btn').addEventListener('click', showConfigModal);
        }
    }

    // 2. RENDER BẢNG DỮ LIỆU
    const tableElement = document.getElementById('overview-data-table');
    if (tableElement) {
        const thead = tableElement.querySelector('thead');
        if (thead && !thead.innerHTML.includes('Tên mô tả')) {
            thead.innerHTML = `
                <tr>
                    <th style="width: 50px;">ID</th>
                    <th style="width: 150px;">Ký hiệu</th>
                    <th>Tên mô tả</th>
                    <th>Giá trị</th>
                    <th>Cập nhật lúc</th>
                </tr>
            `;
        }

        const tableBody = tableElement.querySelector('tbody');
        if (tableBody) {
            let tableHTML = '';
            currentOverviewConfig.forEach((measureInfo, idx) => {
                const data = getValue(measureInfo.controller, measureInfo.fullName);

                let unit = measureInfo.defaultUnit || "";
                // Nếu config ko có unit cứng, thử tìm trong metadata measure
                if (!unit && appData.measures_config && appData.measures_config[measureInfo.fullName]) {
                    unit = appData.measures_config[measureInfo.fullName].unit;
                }

                let valueText = 'N/A';
                let timestampText = '';

                if (data?.value !== undefined && data.value !== null) {
                    const num = parseFloat(data.value);
                    valueText = isNaN(num) ? data.value : num.toFixed(2);
                    timestampText = formatTimestamp(data.timestamp);
                }

                const mandatoryMark = measureInfo.isMandatory
                    ? `<sup style="color: #ef4444; font-weight: bold; margin-left: 2px; cursor: help;" title="Bắt buộc theo QĐ 378/QĐ-EVN">(*)</sup>`
                    : '';

                tableHTML += `
                    <tr>
                        <td>${idx + 1}</td>
                        <td style="font-weight: bold; color: #a5b4fc;">
                            ${measureInfo.alias}${mandatoryMark}
                        </td>
                        <td>
                            ${measureInfo.realName} 
                            <br><span style="font-size:0.7em; color:#64748b">(${measureInfo.controller || 'N/A'})</span>
                        </td>
                        <td style="font-weight: bold; color: #4ade80;">${valueText} <span style="font-size: 0.8em; color: #94a3b8;">${unit}</span></td>
                        <td style="font-size: 0.85em; color: #94a3b8;">${timestampText}</td>
                    </tr>
                `;
            });
            tableBody.innerHTML = tableHTML;
        }
    }

    // 3. RENDER CỘT PHẢI (CONTROL INFO)
    const powerSetKwEl = document.getElementById('overview-display-powersetkw');
    if (powerSetKwEl) {
        powerSetKwEl.textContent = `${getValue('EVN', 'PM01:PowerSetkW')?.value ?? 'N/A'} kW`;
    }

    const powerSetPeEl = document.getElementById('overview-display-powersetpe');
    if (powerSetPeEl) {
        powerSetPeEl.textContent = `${getValue('EVN', 'PM01:PowerSetPe')?.value ?? 'N/A'} %`;
    }

    const enableAdjDisplay = document.getElementById('overview-display-enable-adj');
    if (enableAdjDisplay) {
        const enableAdjValue = getValue('EVN', 'EVN:Enable_Adj')?.value;
        enableAdjDisplay.textContent = enableAdjValue === 1 ? 'Cho phép' : 'Không cho phép';
        enableAdjDisplay.className = `display-value ${enableAdjValue === 1 ? 'active-green' : 'active-red'}`;
    }

    // 4. RENDER CHART
    if (overviewPowerChart) {
        const chartHistory = appData.overviewPage.chartHistory;
        
        // Cập nhật Labels
        overviewPowerChart.data.labels = chartHistory.labels;

        // Cập nhật Datasets
        // Logic cũ của bạn đang dùng datasetOrder cứng (INVT_T...), cần sửa lại để động theo config
        
        // --- SỬA LOGIC CẬP NHẬT DATASET ---
        const configDatasets = appData.chart_config?.datasets || [];
        
        // Duyệt qua từng dataset trong Config để gán dữ liệu từ History
        configDatasets.forEach((cfg, index) => {
            const uniqueKey = `${cfg.device}:${cfg.measure}`;
            
            // Tìm dataset tương ứng trong ChartJS instance
            if (overviewPowerChart.data.datasets[index]) {
                const dataPoints = chartHistory.datasets[uniqueKey]?.data || [];
                overviewPowerChart.data.datasets[index].data = dataPoints;
                
                // console.log(`>>> [Chart Render] Vẽ đường ${uniqueKey}: ${dataPoints.length} điểm.`);
            }
        });
        
        overviewPowerChart.update('none'); // Update chế độ performance
    }
}

// --- REGISTER ---
document.addEventListener('DOMContentLoaded', () => {
    pageInitFunctions['overview-page'] = initOverviewPage;
    pageRenderFunctions['overview-page'] = renderOverviewPage;
});
function loadOverviewConfig() {
    // Ưu tiên lấy từ Server Settings
    if (appData.user_settings && appData.user_settings.overview_table) {
        currentOverviewConfig = appData.user_settings.overview_table;
    } else {
        // Nếu chưa có, dùng mặc định
        currentOverviewConfig = JSON.parse(JSON.stringify(DEFAULT_OVERVIEW_CONFIG));
    }
}