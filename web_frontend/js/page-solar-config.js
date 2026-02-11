// --- START OF FILE js/page-solar-config.js ---

import * as api from './apiService.js'; // NEW: Import a centralized API service
import { appData, pageInitFunctions, pageRenderFunctions, updatePendingChangesBar, applyGlobalChanges } from './main.js';

// --- STATE MANAGEMENT ---
// CHANGED: All state variables have been moved to appData in main.js
// No more `let currentSolarConfig = {}`, `let pendingChanges = {}`, etc.
let isMonitoringRestart = false;
let restartMonitorTimeout = null;
let initialSupervisorPid = null;
let currentEditingMeasure = null;

// --- GLOBAL HANDLER ---
window.handleSystemStatusUpdate = function (data) {
    if (!data || !data.supervisor_status) return;
    // CHANGED: Update centralized state
    appData.solarConfigPage.latest_supervisor_status = data.supervisor_status;

    if (isMonitoringRestart) {
        const currentPid = appData.solarConfigPage.latest_supervisor_status.pid;
        console.log(`Monitoring: Initial PID=${initialSupervisorPid}, Current PID=${currentPid}`);
        if (currentPid && currentPid !== initialSupervisorPid) {
            console.log("New supervisor process detected (PID changed). Restart complete.");
            finalizeRestartAndReload("New PID detected");
        }
    }
};


// --- RESTART MONITORING FUNCTIONS (Không đổi logic, chỉ sửa tên biến) ---
function beginRestartMonitoring() {
    console.log("Starting restart monitoring. Initial PID:", initialSupervisorPid);
    isMonitoringRestart = true;
    restartMonitorTimeout = setTimeout(() => {
        console.warn("Restart monitoring timed out after 30 seconds.");
        finalizeRestartAndReload("Monitoring timed out");
    }, 30000);
}
function finalizeRestartAndReload(reason = "System stable") {
    if (!isMonitoringRestart) return;
    console.log(`Finalizing restart sequence. Reason: ${reason}`);
    clearTimeout(restartMonitorTimeout);
    isMonitoringRestart = false;
    initialSupervisorPid = null;
    initSolarPage();
}

// --- CORE FUNCTIONS ---
async function initSolarPage() {
    console.log("Initializing Solar Page...");
    const container = document.getElementById('solar-workbench-container');
    if (!container) return;

    container.innerHTML = `<p style="text-align: center; padding: 20px;">Loading configuration...</p>`;

    // Reset state
    const pageState = appData.solarConfigPage;
    pageState.pending_changes = {};
    if (typeof updatePendingChangesBar === 'function') updatePendingChangesBar();

    try {
        // [SỬA LẠI ĐOẠN NÀY]
        // Phải khai báo đủ 4 biến tương ứng với 4 hàm API gọi bên dưới
        const [templates, config, protocols, loggingRules] = await Promise.all([
            api.getTemplates(),
            api.getSolarConfiguration(),
            api.getProtocols(),
            api.getLoggingRules() // Hàm thứ 4 trả về loggingRules
        ]);

        // Lưu vào appData
        pageState.template_hierarchy = templates;
        pageState.current_config = config;
        pageState.protocol_definitions = protocols;

        // [QUAN TRỌNG] Gán biến loggingRules vừa nhận được vào appData
        appData.logging_whitelist = loggingRules || [];

        renderSolarWorkbench(config);

    } catch (error) {
        console.error("Failed to init solar page:", error);
        container.innerHTML = `<p style="text-align: center; color: red; padding: 20px;">Error loading configuration: ${error.message}</p>`;
    } finally {
        pageState.is_applying = false;
        const button = document.getElementById('global-apply-btn');
        if (button) {
            button.disabled = false;
            button.textContent = 'Apply Changes & Restart';
        }
    }
}

// ... (renderDynamicFields, renderSolarWorkbench không đổi logic, chỉ sửa tên biến)
function renderDynamicFields(cardElement, selectedProtocol) {
    const container = cardElement.querySelector('.dynamic-fields-container');
    if (!container) return;
    const { protocol_definitions } = appData.solarConfigPage; // Get from centralized state

    container.innerHTML = ''; // Xóa các trường cũ
    const definition = protocol_definitions[selectedProtocol];
    if (!definition) return;

    let html = '';
    definition.fields.forEach(field => {
        html += `<div class="form-group">
                    <label>${field.label}</label>`;

        const value = cardElement.dataset[field.name] || field.default || '';
        const required = field.required ? 'required' : '';

        if (field.type === 'select') {
            html += `<select class="edit-mode" data-field="${field.name}" ${required}>`;
            field.options.forEach(opt => {
                const isSelected = value == opt.value ? 'selected' : '';
                html += `<option value="${opt.value}" ${isSelected}>${opt.display}</option>`;
            });
            html += `</select>`;
        } else { // text, number
            html += `<input type="${field.type}" class="edit-mode" data-field="${field.name}" value="${value}" placeholder="${field.placeholder || ''}" ${required}>`;
        }
        html += `</div>`;
    });
    container.innerHTML = html;
}
function renderSolarWorkbench(config) {
    const container = document.getElementById('solar-workbench-container');
    const { template_hierarchy } = appData.solarConfigPage; // Get from centralized state

    const groupedDevices = { Logger: [], Inverter: [], Meter: [], Other: [] };

    if (config && config.devices) {
        config.devices.forEach(dev => {
            if (groupedDevices[dev.category]) {
                groupedDevices[dev.category].push(dev);
            }
        });
    }

    const categoryDisplayNames = {
        Logger: { singular: "Logger", plural: "Loggers" },
        Inverter: { singular: "Inverter", plural: "Inverters" },
        Meter: { singular: "Meter", plural: "Meters" },
        Other: { singular: "Bộ điều khiển", plural: "Bộ điều khiển" }
    };

    let html = '<div class="workbench-grid">';
    Object.keys(groupedDevices).forEach(category => {
        if (!template_hierarchy[category] && groupedDevices[category].length === 0) return;

        const displayName = categoryDisplayNames[category] || { singular: category, plural: category };

        // CHANGED: Use generateDeviceCard which returns a DOM element
        const cardsHTML = groupedDevices[category].map(dev => generateDeviceCard(dev).outerHTML).join('');

        html += `
            <div class="device-group">
                <div class="group-header">
                    <h3>${displayName.plural}</h3>
                    <button class="add-device-link action-add" data-category="${category}">+ Add ${displayName.singular}</button>
                </div>
                <div class="device-card-grid">
                    ${cardsHTML}
                </div>
            </div>`;
    });
    html += '</div>';
    container.innerHTML = html;
    attachWorkbenchListeners();
    const allCards = container.querySelectorAll('.edit-card');
    allCards.forEach(card => {
        const deviceId = card.dataset.deviceId;
        if (deviceId) {
            renderMiniTable(card, deviceId);
        }
    });
}


// ... (attachWorkbenchListeners, attachCardListeners không đổi logic, chỉ sửa tên biến)
function attachWorkbenchListeners() {
    document.querySelectorAll('#solar-workbench-container .edit-card').forEach(attachCardListeners);

    document.querySelectorAll('.action-add').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const category = e.currentTarget.dataset.category;
            const newId = generateNextDeviceName(category);
            const newDeviceData = { id: newId, name: newId, category: category, ip: '', port: '', slave_address: '1', is_new: true };
            const cardGrid = e.currentTarget.closest('.device-group').querySelector('.device-card-grid');

            // CHANGED: Append DOM element directly
            const newCardElement = generateDeviceCard(newDeviceData);
            cardGrid.appendChild(newCardElement);
            attachCardListeners(newCardElement);
        });
    });


    const discardBtn = document.getElementById('global-discard-btn');
    if (discardBtn && !discardBtn.dataset.listenerAttached) {
        discardBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to discard all pending changes?')) {
                initSolarPage();
            }
        });
        discardBtn.dataset.listenerAttached = 'true';
    }
}
function attachCardListeners(card) {
    const originalId = card.dataset.deviceId;
    const protocolSelector = card.querySelector('.device-protocol-selector');
    const { template_hierarchy, protocol_definitions } = appData.solarConfigPage;

    if (protocolSelector) {
        protocolSelector.addEventListener('change', (e) => {
            const selectedProtocol = e.target.value;
            const dynamicFieldsContainer = card.querySelector('.dynamic-fields-container');
            dynamicFieldsContainer.innerHTML = generateDynamicFieldsHTML(selectedProtocol, {});
        });
    }

    if (card.classList.contains('state-new')) {
        const category = card.dataset.category;
        const brandSelector = card.querySelector('.new-device-brand');
        const modelSelector = card.querySelector('.new-device-model');

        brandSelector?.addEventListener('change', (event) => {
            const selectedBrand = event.target.value;
            modelSelector.innerHTML = '<option value="">-- Choose Model --</option>';
            modelSelector.disabled = true;
            if (selectedBrand && template_hierarchy[category] && template_hierarchy[category][selectedBrand]) {
                template_hierarchy[category][selectedBrand].forEach(model => {
                    modelSelector.innerHTML += `<option value="${category}/${selectedBrand}/${model}">${model}</option>`;
                });
                modelSelector.disabled = false;
            }
        });
    }
    card.querySelector('.action-settings')?.addEventListener('click', () => {
        const deviceId = card.dataset.deviceId;
        openDisplaySettingsModal(deviceId); // Gọi hàm mở Modal mới viết
    });

    card.querySelector('.action-edit')?.addEventListener('click', () => {
        // Thêm class này sẽ kích hoạt CSS display:none/block đã viết ở trên
        card.classList.add('state-editing');
    });

    card.querySelector('.action-delete')?.addEventListener('click', () => {
        if (confirm(`Đánh dấu '${originalId}' để xóa? Thay đổi sẽ được áp dụng sau khi bạn nhấn "Apply Changes".`)) {
            card.classList.add('state-deleted');
            appData.solarConfigPage.pending_changes[originalId] = { state: 'deleted', data: { original_name: originalId } };
            updatePendingChangesBar();
        }
    });

    card.querySelector('.action-cancel')?.addEventListener('click', () => {
        const originalId = card.dataset.deviceId;
        if (card.classList.contains('state-new')) {
            card.remove(); // Nếu là thẻ mới tạo thì xóa luôn
        } else {
            // Nếu là thẻ cũ, bỏ class editing để hiện lại bảng Mini
            card.classList.remove('state-editing');

            // TODO: Reset lại các ô input về giá trị cũ (đơn giản nhất là reload lại thẻ này, nhưng tạm thời ẩn đi là được)
        }
    });

    card.querySelector('.action-details')?.addEventListener('click', async () => {
        const deviceName = card.dataset.deviceId;
        console.log(`%c🔍 [DEBUG-CLICK] Đã bấm chi tiết thiết bị: "${deviceName}"`, "color: yellow; font-weight: bold;");

        // 1. Tìm cấu hình thiết bị trong danh sách hiện tại
        const configData = appData.solarConfigPage.current_config;
        const currentDeviceConfig = configData.devices
            ? configData.devices.find(d => d.id === deviceName)
            : null;

        if (!currentDeviceConfig) {
            console.error(`❌ [DEBUG-ERROR] Không tìm thấy config của thiết bị "${deviceName}" trong appData.`);
            alert("Lỗi: Không tìm thấy dữ liệu thiết bị trong bộ nhớ.");
            return;
        }

        // 2. Kiểm tra Template
        const templateName = currentDeviceConfig.conTempName;
        // Kiểm tra kỹ điều kiện có template
        const hasTemplate = templateName && templateName.trim() !== "";

        console.log(`ℹ️ [DEBUG-INFO] Template Name: "${templateName}"`);
        console.log(`❓ [DEBUG-CHECK] Có Template không? -> ${hasTemplate}`);

        if (hasTemplate) {
            // TRƯỜNG HỢP 1: CÓ TEMPLATE
            console.log("🚀 [DEBUG-ACTION] Đang gọi API lấy chi tiết Template...");
            try {
                const measuresData = await api.getDeviceMeasuresDetails(deviceName);
                console.log("✅ [DEBUG-SUCCESS] API trả về dữ liệu:", measuresData);
                showMeasuresManagementModal(measuresData);
            } catch (error) {
                console.warn('⚠️ [DEBUG-WARN] Lỗi tải template, chuyển sang Raw Monitor:', error);
                showRawMonitorModal(deviceName);
            }
        } else {
            // TRƯỜNG HỢP 2: KHÔNG CÓ TEMPLATE
            console.log("🚀 [DEBUG-ACTION] Chuyển sang chế độ Raw Monitor (showRawMonitorModal).");
            showRawMonitorModal(deviceName);
        }
    });

    card.querySelector('.action-save')?.addEventListener('click', () => {
        const pageState = appData.solarConfigPage;
        const isNew = card.classList.contains('state-new');
        const deviceId = isNew ? (card.querySelector('input[data-field="name"]')?.value || generateNextDeviceName(card.dataset.category)) : card.dataset.deviceId;

        const deviceData = {
            original_name: deviceId,
            category: card.dataset.category,
            is_new: isNew,
            args: {}
        };

        // Bước 1: Gom dữ liệu (Không đổi, đã đúng)
        card.querySelectorAll('.edit-mode[data-field]').forEach(input => {
            const field = input.dataset.field;
            const value = input.value;
            if (field === 'CT_Ratio' || field === 'PT_Ratio') {
                deviceData.args[field] = value;
            } else {
                deviceData[field] = value;
            }
        });

        // Bước 2: Lưu vào pendingChanges (Không đổi, đã đúng)
        pageState.pending_changes[deviceId] = {
            state: isNew ? 'new' : 'modified',
            data: deviceData
        };

        // Bước 3: Cập nhật giao diện VIEW-MODE (Đây là phần được sửa)
        const allViewElements = card.querySelectorAll('.view-mode.display-value');
        allViewElements.forEach(el => {
            // Tìm input/select tương ứng để lấy data-field
            const correspondingInput = el.nextElementSibling;
            if (!correspondingInput || !correspondingInput.dataset.field) return;

            const fieldName = correspondingInput.dataset.field;
            let valueToDisplay;

            // ================================================================
            // === SỬA LỖI: Lấy giá trị từ đúng vị trí trong deviceData ===
            if (fieldName === 'CT_Ratio' || fieldName === 'PT_Ratio') {
                // Nếu là CT/PT, tìm trong đối tượng con 'args'
                valueToDisplay = deviceData.args[fieldName];
            } else {
                // Nếu là các trường khác, tìm ở cấp cao nhất
                valueToDisplay = deviceData[fieldName];
            }
            // ================================================================

            if (valueToDisplay !== undefined) {
                let displayValue = valueToDisplay;
                if (fieldName === 'protocol') {
                    displayValue = protocol_definitions[displayValue]?.displayName || 'N/A';
                }
                el.textContent = displayValue;
            }
        });

        // Cập nhật các trường động và tiêu đề thẻ
        const dynamicContainer = card.querySelector('.dynamic-fields-container');
        dynamicContainer.innerHTML = generateDynamicFieldsHTML(deviceData.protocol, {
            ip: deviceData.address,
            port: deviceData.port,
            slave_address: deviceData.slave,
            physical_port: deviceData.endpoint
        });
        card.querySelector('.card-title').textContent = deviceData.name;

        card.classList.remove('state-editing');
        card.classList.add('state-modified');
        updatePendingChangesBar();
    });
}


// --- HELPER & UTILITY FUNCTIONS (Không đổi logic, chỉ sửa tên biến) ---
// ... (getDeviceIconClass, generateNextDeviceName, generateDynamicFieldsHTML không đổi)
function getDeviceIconClass(category) {
    switch (category) {
        case 'Logger': return 'bi-server';
        case 'Inverter': return 'bi-box-seam';
        case 'Meter': return 'bi-speedometer2';
        case 'Other': return 'bi-cpu-fill';
        default: return 'bi-cpu';
    }
}
function generateNextDeviceName(category) {
    let prefix = '';
    switch (category.toLowerCase()) {
        case 'logger': prefix = 'logger_'; break;
        case 'inverter': prefix = 'INVT_'; break;
        case 'meter': prefix = 'zero_export_'; break;
        default: prefix = `other_`; break;
    }

    // Lấy tất cả thẻ .edit-card
    const allDeviceIds = Array.from(document.querySelectorAll('.edit-card'))
        .map(card => card.dataset.deviceId)
        // QUAN TRỌNG: Lọc bỏ các thẻ không có ID (như thẻ của System/Cloud)
        .filter(id => id !== undefined && id !== null);

    let maxNumber = 0;
    allDeviceIds.forEach(id => {
        // Kiểm tra id tồn tại và khớp prefix
        if (id && id.startsWith(prefix)) {
            const numberPart = parseInt(id.substring(prefix.length), 10);
            if (!isNaN(numberPart) && numberPart > maxNumber) {
                maxNumber = numberPart;
            }
        }
    });

    return `${prefix}${maxNumber + 1}`;
}
function generateDynamicFieldsHTML(protocolKey, deviceData = {}) {
    const { protocol_definitions } = appData.solarConfigPage;
    const definition = protocol_definitions[protocolKey];
    if (!definition) return '<p class="edit-mode" style="color: red;">Lỗi: Không tìm thấy định nghĩa protocol.</p>';
    let html = '';
    const valueMap = {
        address: deviceData.ip,
        port: deviceData.port,
        slave: deviceData.slave_address,
        endpoint: deviceData.physical_port
    };
    definition.fields.forEach(field => {
        const currentValue = valueMap[field.name] !== undefined ? valueMap[field.name] : (field.default || '');
        const required = field.required ? 'required' : '';
        html += `<div class="form-group"><label>${field.label}</label>`;
        let displayValue = currentValue;
        if (field.type === 'select') {
            const selectedOption = field.options.find(opt => opt.value == currentValue);
            displayValue = selectedOption ? selectedOption.display : 'N/A';
        }
        html += `<div class="view-mode display-value">${displayValue}</div>`;
        if (field.type === 'select') {
            html += `<select class="edit-mode" data-field="${field.name}" ${required}>`;
            field.options.forEach(opt => {
                const isSelected = currentValue == opt.value ? 'selected' : '';
                html += `<option value="${opt.value}" ${isSelected}>${opt.display}</option>`;
            });
            html += `</select>`;
        } else {
            html += `<input type="${field.type}" class="edit-mode" data-field="${field.name}" value="${currentValue}" placeholder="${field.placeholder || ''}" ${required}>`;
        }
        html += `</div>`;
    });
    return html;
}
// --- TRONG FILE: js/page-solar-config.js ---

// --- TRONG FILE: js/page-solar-config.js ---

function showRawMonitorModal(deviceName) {
    console.group(`🔍 DEBUG RAW MONITOR: ${deviceName}`);
    console.log(`1. Đang mở Modal cho thiết bị (ID): "%c${deviceName}%c"`, "color: yellow; font-weight: bold;", "");

    // 1. ƯU TIÊN LẤY TỪ LIST (Mảng)
    let allMeasuresArray = [];

    if (appData.measures_list && Array.isArray(appData.measures_list)) {
        console.log("✅ Sử dụng danh sách biến (Array) - An toàn với tên trùng.");
        allMeasuresArray = appData.measures_list;
    } else {
        console.warn("⚠️ Không tìm thấy appData.measures_list, dự phòng dùng measures_config.");
        // Fallback về config cũ nếu chưa có list
        allMeasuresArray = Object.values(appData.measures_config || {});
    }

    // 2. Lọc các biến thuộc về thiết bị này
    const deviceMeasures = allMeasuresArray.filter(m => m.ctrlName === deviceName);

    console.log(`4. Kết quả lọc: Tìm thấy ${deviceMeasures.length} biến của ${deviceName}`);

    // DEBUG NÂNG CAO NẾU KHÔNG TÌM THẤY
    if (deviceMeasures.length === 0) {
        console.warn("⚠️ KHÔNG TÌM THẤY BIẾN NÀO! Đang kiểm tra nguyên nhân...");

        // SỬA LỖI Ở ĐÂY: Dùng allMeasuresArray thay vì allMeasures
        const trimMatches = allMeasuresArray.filter(m => m.ctrlName && m.ctrlName.trim() === deviceName.trim());

        if (trimMatches.length > 0) {
            console.error(`💡 PHÁT HIỆN: Có ${trimMatches.length} biến khớp nếu bỏ khoảng trắng.`);
        }

        // Liệt kê các ctrlName đang có
        const availableControllers = [...new Set(allMeasuresArray.map(m => m.ctrlName))];
        console.log("ℹ️ Danh sách các 'ctrlName' hiện có trong hệ thống:", availableControllers);

        if (availableControllers.includes(deviceName)) {
            console.log("✅ Tên thiết bị CÓ tồn tại. Có thể do lỗi tải dữ liệu async.");
        } else {
            console.error(`❌ Tên thiết bị "${deviceName}" KHÔNG tồn tại trong danh sách biến đo.`);
        }
    }

    // Sắp xếp theo Address
    deviceMeasures.sort((a, b) => (parseInt(a.addr) || 0) - (parseInt(b.addr) || 0));

    // 3. Chuẩn bị Modal
    measuresModalManager.init();
    const overlay = document.getElementById('measures-management-overlay');
    const title = document.getElementById('measures-modal-title');
    const templateNameEl = document.getElementById('measures-modal-template-name');
    const tableContainer = document.getElementById('measures-modal-table-container');

    overlay.dataset.currentDevice = deviceName;

    title.innerHTML = `Giám sát: <span style="color: #a5b4fc;">${deviceName}</span>`;
    templateNameEl.innerHTML = `<span style="color: #f59e0b;"><i class="bi bi-activity"></i> Chế độ giám sát trực tiếp (Raw Data)</span>`;

    // 4. Hàm vẽ bảng
    const renderTable = () => {
        // 1. Lấy dữ liệu Realtime và Health
        const realtimeData = appData.realtime_values[deviceName] || {};
        const healthInfo = appData.health_status ? appData.health_status[deviceName] : null;
        const isHealthy = healthInfo && healthInfo.status === 1;

        if (deviceMeasures.length === 0) {
            tableContainer.innerHTML = `<div style="padding: 30px; text-align: center; color: #94a3b8;">
                <i class="bi bi-exclamation-triangle" style="font-size: 2rem; display: block; margin-bottom: 10px; color: #f59e0b;"></i>
                <p>Không tìm thấy biến đo nào.</p>
            </div>`;
            return;
        }

        // 2. Lấy danh sách các thay đổi đang chờ (Pending Changes)
        const pendingChanges = appData.solarConfigPage.pending_changes[deviceName] || {};
        const measuresToModify = pendingChanges.measures_to_modify || {};
        const measuresToRemove = new Set(pendingChanges.measures_to_remove || []);

        const tableHTML = `
            <table class="control-table" style="font-size: 0.85rem;">
                <thead>
                    <tr>
                        <th>Addr</th>
                        <th>Tên Biến</th>
                        <th>Giá trị</th>
                        <th>Đơn vị</th>
                        <th>Gain</th>
                        <th style="text-align: right;">Hành động</th>
                    </tr>
                </thead>
                <tbody>
                    ${deviceMeasures.map(m => {
            const addr = String(m.addr);

            // Bỏ qua nếu đang chờ xóa
            if (measuresToRemove.has(addr)) return '';

            // --- KHẮC PHỤC LỖI Ở ĐÂY: ĐỊNH NGHĨA isModified ---
            const modifications = measuresToModify[addr] || {};
            const isModified = Object.keys(modifications).length > 0;
            // --------------------------------------------------

            const currentName = modifications.name !== undefined ? modifications.name : m.name;
            const currentGain = modifications.gain !== undefined ? modifications.gain : (m.factors || 1);
            const currentUnit = modifications.unit !== undefined ? modifications.unit : m.unit;

            // Xử lý hiển thị giá trị và đèn báo
            const rtVal = realtimeData[m.name];
            let displayValueHTML = '<span style="color: #64748b;">--</span>';

            if (rtVal && rtVal.value !== undefined && rtVal.value !== null) {
                const num = parseFloat(rtVal.value);
                const valText = isNaN(num) ? rtVal.value : num;

                const dotClass = isHealthy ? 'good' : 'bad';
                const valClass = isHealthy ? 'active-green' : 'value-stale';
                const tooltip = isHealthy ? 'Đang cập nhật' : 'Mất kết nối (Dữ liệu cũ)';

                displayValueHTML = `
                                <div style="display: flex; align-items: center;" title="${tooltip}">
                                    <span class="status-dot-small ${dotClass}"></span>
                                    <span class="${valClass}" style="font-weight: bold;">${valText}</span>
                                </div>
                            `;
            }

            return `
                            <tr class="${isModified ? 'state-modified' : ''}">
                                <td style="font-family: monospace; color: #cbd5e1;">${addr}</td>
                                <td>${currentName}</td>
                                <td>${displayValueHTML}</td>
                                <td>${currentUnit}</td>
                                <td>${currentGain}</td>
                                <td style="text-align: right;">
                                    <button class="edit-icon action-edit-measure" title="Sửa" data-addr="${addr}"><i class="bi bi-pencil"></i></button>
                                    <button class="delete-icon action-delete-measure" title="Xóa" data-addr="${addr}" style="margin-left:5px;"><i class="bi bi-trash"></i></button>
                                </td>
                            </tr>
                        `;
        }).join('')}
                </tbody>
            </table>`;

        tableContainer.innerHTML = tableHTML;

        // Gắn lại sự kiện click (Copy logic cũ vào đây để đảm bảo nút bấm hoạt động)
        const attachRawTableListeners = () => {
            tableContainer.querySelectorAll('.action-edit-measure').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const addr = e.currentTarget.dataset.addr;
                    const measureData = deviceMeasures.find(m => String(m.addr) === addr);
                    if (measureData) {
                        window.currentEditingMeasure = measureData;
                        const pending = appData.solarConfigPage.pending_changes[deviceName] || {};
                        const modifications = (pending.measures_to_modify || {})[addr] || {};
                        renderMeasureDetailsForm(measureData, modifications);
                        overlay.classList.add('details-active');
                    }
                });
            });
            tableContainer.querySelectorAll('.action-delete-measure').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    if (!confirm("Xóa biến này?")) return;
                    const addr = e.currentTarget.dataset.addr;
                    if (!appData.solarConfigPage.pending_changes[deviceName]) {
                        appData.solarConfigPage.pending_changes[deviceName] = { measures_to_remove: [], measures_to_modify: {} };
                    }
                    const changes = appData.solarConfigPage.pending_changes[deviceName];
                    if (!changes.measures_to_remove) changes.measures_to_remove = [];
                    changes.measures_to_remove.push(addr);
                    updatePendingChangesBar();
                    renderTable();
                });
            });
        };
        attachRawTableListeners();
    };

    measuresModalManager.currentData = { deviceName, isRawMode: true, redraw: renderTable };
    renderTable();
    overlay.classList.remove('hidden', 'details-active');
    console.groupEnd();
}
/**
 * Creates and returns a DOM element for a device card.
 * @param {object} device - The device data object from backend, now includes `uses_ct_pt`.
 * @returns {HTMLElement} - The fully constructed card element.
 */
function generateDeviceCard(device) {
    const { protocol_definitions, template_hierarchy } = appData.solarConfigPage;
    const isNew = device.is_new || false;

    const card = document.createElement('div');
    // Nếu là thiết bị mới, tự động vào chế độ Sửa (state-editing)
    card.className = `edit-card ${isNew ? 'state-new state-editing' : ''}`;
    card.dataset.deviceId = device.id;
    card.dataset.category = device.category;

    // --- 1. CHUẨN BỊ DỮ LIỆU SELECT PROTOCOL (GIỮ NGUYÊN) ---
    let initialProtocolKey = Object.keys(protocol_definitions)[0];
    if (!isNew && device.protocol) {
        const foundKey = Object.keys(protocol_definitions).find(key => protocol_definitions[key].protocolValue === device.protocol);
        if (foundKey) initialProtocolKey = foundKey;
    }
    const protocolOptions = Object.keys(protocol_definitions).map(key =>
        `<option value="${key}" ${key === initialProtocolKey ? 'selected' : ''}>${protocol_definitions[key].displayName}</option>`
    ).join('');

    // --- 2. HTML CHO PHẦN EDIT (GIỮ NGUYÊN LOGIC CŨ) ---
    let newDeviceFieldsHTML = '';
    if (isNew) {
        const brands = Object.keys(template_hierarchy[device.category] || {});
        const brandOptions = brands.map(brand => `<option value="${brand}">${brand}</option>`).join('');
        newDeviceFieldsHTML = `
            <div class="form-group"><label>Chọn Hãng</label><select class="edit-mode new-device-brand" data-field="brand"><option value="">-- Chọn Hãng --</option>${brandOptions}</select></div>
            <div class="form-group"><label>Chọn Model</label><select class="edit-mode new-device-model" data-field="template_path" disabled><option value="">-- Chọn Model --</option></select></div>
        `;
    }

    // HTML cho CT/PT (Giữ nguyên logic kiểm tra)
    let meterFieldsHTML = '';
    if (device.uses_ct_pt || (isNew && device.category === 'Meter')) {
        const ct_ratio = device.args?.CT_Ratio ?? 1;
        const pt_ratio = device.args?.PT_Ratio ?? 1;
        meterFieldsHTML = `
            <div class="form-group"><label>Tỉ số biến dòng (CT)</label><input type="number" step="any" class="edit-mode" data-field="CT_Ratio" value="${ct_ratio}"></div>
            <div class="form-group"><label>Tỉ số biến áp (PT)</label><input type="number" step="any" class="edit-mode" data-field="PT_Ratio" value="${pt_ratio}"></div>
        `;
    }

    // --- 3. HTML CHO PHẦN DISPLAY (MINI DASHBOARD - MỚI) ---
    // Tạm thời hiển thị placeholder, bước sau sẽ load từ LocalStorage
    const miniTableHTML = `
        <table class="mini-monitor-table">
            <thead>
                <tr>
                    <th>Thông số</th>
                    <th style="text-align: right;">Giá trị</th>
                </tr>
            </thead>
            <tbody class="mini-table-body" data-device-id="${device.id}">
                <tr>
                    <td colspan="2" style="text-align: center; color: #64748b; padding: 10px;">
                        <i class="bi bi-gear"></i> Bấm cài đặt để chọn biến
                    </td>
                </tr>
            </tbody>
        </table>
    `;

    // --- 4. RENDER TOÀN BỘ THẺ ---
    card.innerHTML = `
        <div class="edit-card-header">
            <h4>
                <span class="connection-status-dot" title="Trạng thái kết nối"></span>
                <i class="bi ${getDeviceIconClass(device.category)}"></i> 
                <span class="card-title">${device.name || device.id}</span>
            </h4>
            <div class="card-actions">
                <!-- NÚT MỚI: CÀI ĐẶT HIỂN THỊ -->
                <button class="edit-icon action-settings" title="Chọn biến hiển thị"><i class="bi bi-gear"></i></button>
                
                <!-- CÁC NÚT CŨ -->
                <button class="edit-icon action-details" title="Xem chi tiết Raw"><i class="bi bi-card-list"></i></button>
                <button class="edit-icon action-edit" title="Sửa cấu hình"><i class="bi bi-pencil"></i></button>
                <button class="edit-icon delete-icon action-delete" title="Xóa thiết bị"><i class="bi bi-trash"></i></button>
            </div>
        </div>

        <div class="edit-card-body">
            <!-- VIEW 1: MINI DASHBOARD -->
            <div class="device-display-view">
                ${miniTableHTML}
            </div>

            <!-- VIEW 2: EDIT FORM (Cấu hình kết nối) -->
            <div class="device-edit-view">
                ${newDeviceFieldsHTML}
                <div class="form-group">
                    <label>Tên định danh (ID)</label>
                    <input type="text" class="edit-mode" value="${device.id}" readonly style="opacity: 0.7; cursor: not-allowed;">
                </div>
                <div class="form-group">
                    <label>Tên hiển thị</label>
                    <input type="text" class="edit-mode" data-field="name" value="${device.name || device.id}">
                </div>
                <div class="form-group">
                    <label>Giao thức</label>
                    <select class="edit-mode device-protocol-selector" data-field="protocol">${protocolOptions}</select>
                </div>
                <div class="dynamic-fields-container">
                    ${generateDynamicFieldsHTML(initialProtocolKey, device)}
                </div>
                ${meterFieldsHTML}
                
                <!-- Footer của Edit Form chuyển vào trong view này -->
                <div style="margin-top: 15px; text-align: right; border-top: 1px solid #475569; padding-top: 10px;">
                     <button class="btn btn-secondary action-cancel">Hủy</button>
                     <button class="btn btn-primary action-save">Lưu</button>
                </div>
            </div>
        </div>
    `;
    setTimeout(() => {
        renderMiniTable(card, device.id);
    }, 0);
    return card;
}




// ... (Các hàm còn lại: updateSolarDeviceStatus, renderSolarPage, modal manager không đổi logic, chỉ sửa tên biến)
function updateSolarDeviceStatus() {
    const allDeviceCards = document.querySelectorAll('#solar-workbench-container .edit-card');
    allDeviceCards.forEach(card => {
        const deviceId = card.dataset.deviceId;
        const statusDot = card.querySelector('.connection-status-dot');
        if (!deviceId || !statusDot) return;
        const healthInfo = appData.health_status ? appData.health_status[deviceId] : null;
        let isConnected = healthInfo?.status === 1;
        statusDot.classList.toggle('connected', isConnected);
        statusDot.classList.toggle('disconnected', !isConnected);
        if (isConnected) {
            statusDot.title = `Đã kết nối (health: 1) - Cập nhật lúc ${new Date(healthInfo.timestamp).toLocaleTimeString()}`;
        } else {
            const lastSeen = healthInfo ? `lúc ${new Date(healthInfo.timestamp).toLocaleTimeString()}` : 'chưa rõ';
            const healthValue = healthInfo ? healthInfo.status : 'N/A';
            statusDot.title = `Mất kết nối (health: ${healthValue}) - Cập nhật lần cuối ${lastSeen}`;
        }
    });
}
function renderSolarPage() {
    updateSolarDeviceStatus();
    updateSolarRealtimeData();
}
//... (modal manager, showMeasuresManagementModal, renderMeasureDetailsForm)
const measuresModalManager = {
    isInitialized: false,
    currentData: null,
    init: function () {
        if (this.isInitialized) return;
        const overlay = document.getElementById('measures-management-overlay');
        const backBtn = overlay.querySelector('[data-action="back-to-list"]');
        const saveBtn = overlay.querySelector('[data-action="save-measure-details"]');
        const closeBtn = overlay.querySelector('[data-action="close-measures-modal"]');
        backBtn.addEventListener('click', () => overlay.classList.remove('details-active'));
        closeBtn.addEventListener('click', () => overlay.classList.add('hidden'));
        saveBtn.addEventListener('click', () => {
            if (!currentEditingMeasure) return;
            const currentDeviceName = overlay.dataset.currentDevice;
            const liveData = this.currentData;
            if (!liveData) return;
            const addr = String(currentEditingMeasure.addr);
            const originalMeasureData = liveData.measures.find(m => String(m.addr) === addr);
            if (!originalMeasureData) return;
            const pendingChanges = appData.solarConfigPage.pending_changes;
            if (!pendingChanges[currentDeviceName]) {
                pendingChanges[currentDeviceName] = { measures_to_add: [], measures_to_remove: [], measures_to_modify: {} };
            }
            if (!pendingChanges[currentDeviceName].measures_to_modify) {
                pendingChanges[currentDeviceName].measures_to_modify = {};
            }
            const form = document.querySelector('.measure-details-form');
            const modifications = {};
            let hasChanged = false;
            const defaults = { name: '', unit: '', gain: '1', offset: '0', transDecimal: '2', Base_Gain: '1', transformType: 2 };
            form.querySelectorAll('input[data-field], select[data-field]').forEach(element => {
                const field = element.dataset.field;
                const newValue = element.value;
                const originalValue = originalMeasureData[field] ?? defaults[field];
                if (String(newValue) !== String(originalValue)) {
                    modifications[field] = newValue;
                    hasChanged = true;
                }
            });
            if (hasChanged) {
                pendingChanges[currentDeviceName].measures_to_modify[addr] = modifications;
            } else {
                delete pendingChanges[currentDeviceName].measures_to_modify[addr];
            }
            updatePendingChangesBar();

            const mainCard = document.querySelector(`.edit-card[data-device-id="${currentDeviceName}"]`);
            if (mainCard) mainCard.classList.add('state-modified');

            // KIỂM TRA CHẾ ĐỘ
            if (this.currentData && this.currentData.isRawMode) {
                this.currentData.redraw(); // Gọi hàm vẽ lại bảng Raw
            } else {
                showMeasuresManagementModal(this.currentData); // Gọi hàm vẽ lại bảng Template
            }

            overlay.classList.remove('details-active');
        });

        this.isInitialized = true;
    }
};
function showMeasuresManagementModal(data) {
    measuresModalManager.init();
    measuresModalManager.currentData = data;
    const overlay = document.getElementById('measures-management-overlay');
    const title = document.getElementById('measures-modal-title');
    const templateNameEl = document.getElementById('measures-modal-template-name');
    const tableContainer = document.getElementById('measures-modal-table-container');
    const deviceName = data.deviceName;
    overlay.dataset.currentDevice = deviceName;
    const redrawTableAndAttachListeners = () => {
        // 1. Lấy dữ liệu Realtime & Health
        const realtimeData = appData.realtime_values[deviceName] || {};
        const healthInfo = appData.health_status ? appData.health_status[deviceName] : null;
        const isHealthy = healthInfo && healthInfo.status === 1;

        const pendingChanges = appData.solarConfigPage.pending_changes;
        const deviceChanges = pendingChanges[deviceName] || {};
        const measuresToAdd = new Set(deviceChanges.measures_to_add || []);
        const measuresToRemove = new Set(deviceChanges.measures_to_remove || []);
        const measuresToModify = deviceChanges.measures_to_modify || {};

        const tableHTML = `
            <table class="control-table" style="font-size: 0.8rem;">
                <thead>
                    <tr>
                        <th>Tên Biến</th>
                        <th>Địa chỉ</th>
                        <th>Giá trị</th> <!-- CỘT MỚI -->
                        <th>Gain</th>
                        <th>Trạng thái</th>
                        <th>Hành động</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.measures.map(m => {
            const addr = String(m.addr);
            const modifications = measuresToModify[addr] || {};
            const isModified = Object.keys(modifications).length > 0;

            const currentGain = modifications.gain !== undefined ? modifications.gain : m.gain;
            const currentName = modifications.name !== undefined ? modifications.name : m.name;

            // --- LOGIC HIỂN THỊ GIÁ TRỊ REALTIME ---
            const rtVal = realtimeData[m.name];
            let displayValueHTML = '<span style="color: #64748b;">--</span>';

            if (rtVal && rtVal.value !== undefined && rtVal.value !== null) {
                const num = parseFloat(rtVal.value);
                const valText = isNaN(num) ? rtVal.value : num;

                const dotClass = isHealthy ? 'good' : 'bad';
                const valClass = isHealthy ? 'active-green' : 'value-stale';
                const tooltip = isHealthy ? 'Đang cập nhật' : 'Mất kết nối (Dữ liệu cũ)';

                displayValueHTML = `
                                <div style="display: flex; align-items: center;" title="${tooltip}">
                                    <span class="status-dot-small ${dotClass}"></span>
                                    <span class="${valClass}" style="font-weight: bold;">${valText}</span>
                                </div>
                            `;
            }
            // ---------------------------------------

            // Logic Trạng thái (Pending/Configured)
            let statusText = '<span class="status-badge pending">Chưa thêm</span>';
            let actionsHTML = `<button class="btn btn-primary btn-sm action-toggle-measure" data-addr="${addr}" data-action="add">Thêm</button>`;

            if (m.isActive && !measuresToRemove.has(addr)) {
                statusText = isModified
                    ? '<span class="status-badge" style="background-color: #f59e0b; color: white;">Đã sửa đổi</span>'
                    : '<span class="status-badge configured">Đang đo</span>';
                actionsHTML = `<button class="edit-icon action-edit-measure" title="Sửa chi tiết" data-addr="${addr}"><i class="bi bi-pencil"></i></button> <button class="btn btn-secondary btn-sm action-toggle-measure" data-addr="${addr}" data-action="remove">Xóa</button>`;
            } else if (measuresToAdd.has(addr)) {
                statusText = '<span class="status-badge" style="background-color: #22c55e; color: white;">Chờ thêm</span>';
                actionsHTML = `<button class="btn btn-secondary btn-sm action-toggle-measure" data-addr="${addr}" data-action="undo_add">Hủy</button>`;
            }

            if (m.isActive && measuresToRemove.has(addr)) {
                statusText = '<span class="status-badge" style="background-color: #ef4444; color: white;">Chờ xóa</span>';
                actionsHTML = `<button class="btn btn-primary btn-sm action-toggle-measure" data-addr="${addr}" data-action="undo_remove">Hủy</button>`;
            }

            return `
                            <tr class="${isModified ? 'state-modified' : ''}">
                                <td>${currentName}</td> 
                                <td>${addr}</td> 
                                <td>${displayValueHTML}</td> <!-- Cột Giá trị -->
                                <td>${currentGain}</td>
                                <td>${statusText}</td> 
                                <td>${actionsHTML}</td>
                            </tr>`;
        }).join('')}
                </tbody>
            </table>`;

        tableContainer.innerHTML = tableHTML;

        // Gắn lại sự kiện (Giữ nguyên logic cũ)
        tableContainer.querySelectorAll('.action-toggle-measure').forEach(button => {
            button.addEventListener('click', (e) => {
                const currentDeviceName = overlay.dataset.currentDevice;
                const addr = e.currentTarget.dataset.addr;
                const action = e.currentTarget.dataset.action;
                if (!pendingChanges[currentDeviceName]) {
                    pendingChanges[currentDeviceName] = { measures_to_add: [], measures_to_remove: [], measures_to_modify: {} };
                }
                const changes = pendingChanges[currentDeviceName];

                // Logic Add/Remove/Undo
                if (action === 'add') {
                    changes.measures_to_add = [...new Set([...changes.measures_to_add, addr])];
                    changes.measures_to_remove = changes.measures_to_remove.filter(a => a !== addr);
                } else if (action === 'remove') {
                    changes.measures_to_remove = [...new Set([...changes.measures_to_remove, addr])];
                    changes.measures_to_add = changes.measures_to_add.filter(a => a !== addr);
                } else if (action === 'undo_add') {
                    changes.measures_to_add = changes.measures_to_add.filter(a => a !== addr);
                } else if (action === 'undo_remove') {
                    changes.measures_to_remove = changes.measures_to_remove.filter(a => a !== addr);
                }

                updatePendingChangesBar();
                const mainCard = document.querySelector(`.edit-card[data-device-id="${currentDeviceName}"]`);
                if (mainCard) mainCard.classList.add('state-modified');
                redrawTableAndAttachListeners();
            });
        });

        tableContainer.querySelectorAll('.action-edit-measure').forEach(button => {
            button.addEventListener('click', (e) => {
                const addr = e.currentTarget.dataset.addr;
                const measureData = data.measures.find(m => String(m.addr) === addr);
                if (measureData) {
                    window.currentEditingMeasure = measureData; // Fix lỗi biến cục bộ
                    const currentDeviceName = overlay.dataset.currentDevice;
                    renderMeasureDetailsForm(measureData, (pendingChanges[currentDeviceName]?.measures_to_modify || {})[addr] || {});
                    overlay.classList.add('details-active');
                }
            });
        });
    };
    title.textContent = `Quản lý Biến đo cho "${deviceName}"`;
    templateNameEl.textContent = data.conTempName;
    overlay.classList.remove('hidden', 'details-active');
    redrawTableAndAttachListeners();
}
function renderMeasureDetailsForm(measureData, modifications) {
    const formContainer = document.querySelector('.measure-details-form');
    const nameEl = document.getElementById('measure-details-name');

    nameEl.textContent = `Sửa chi tiết: ${modifications.name || measureData.name || ''}`;

    const getValue = (field) => {
        // Luôn ưu tiên giá trị đang được sửa đổi trong `modifications`
        if (modifications[field] !== undefined) {
            return modifications[field];
        }
        // Nếu không, lấy giá trị gốc từ `measureData`
        if (measureData[field] !== undefined) {
            return measureData[field];
        }
        // Nếu không có gì cả, trả về giá trị mặc định
        if (field === 'Base_Gain' || field === 'gain') return '1.0';
        if (field === 'offset') return '0';
        if (field === 'transDecimal') return '2';
        return '';
    };

    const currentTransformType = getValue('transformType') ?? 2;
    // Xác định xem measure này có dùng công thức hay không, dựa trên sự tồn tại của gain_formula
    const isGainFormula = !!measureData.gain_formula;

    let gainFieldsHTML = '';

    // ========================================================================
    // === LOGIC CỐT LÕI ĐÃ ĐƯỢC LÀM RÕ ===
    if (isGainFormula) {
        // NẾU CÓ CÔNG THỨC: Luôn hiển thị ô nhập liệu cho "Base_Gain"
        gainFieldsHTML = `
            <div class="form-group">
                <label>Hệ số cơ bản (Base Gain)</label>
                <input type="number" step="any" class="modal-input" data-field="Base_Gain" value="${getValue('Base_Gain')}">
            </div>
            <div class="form-group">
                <label>Công thức Gain (tham khảo)</label>
                <div class="static-value">${measureData.gain_formula}</div>
            </div>
        `;
    } else {
        // NẾU KHÔNG CÓ CÔNG THỨC: Hiển thị ô nhập liệu cho "gain" bình thường
        gainFieldsHTML = `
            <div class="form-group">
                <label>Hệ số nhân (Gain)</label>
                <input type="number" step="any" class="modal-input" data-field="gain" value="${getValue('gain')}">
            </div>
        `;
    }
    // ========================================================================

    formContainer.innerHTML = `
        <div class="form-group">
            <label>Tên Biến Đo</label>
            <input type="text" class="modal-input" data-field="name" value="${getValue('name')}">
        </div>
        <div class="form-group">
            <label>Đơn vị (Unit)</label>
            <input type="text" class="modal-input" data-field="unit" value="${getValue('unit')}">
        </div>
        <div class="form-group">
            <label>Xử lý dữ liệu</label>
            <select class="modal-input" data-field="transformType" id="measure-transform-type-selector">
                <option value="2" ${currentTransformType == 2 ? 'selected' : ''}>Độ lệch và hệ số tỷ lệ</option>
                <option value="0" ${currentTransformType == 0 ? 'selected' : ''}>Giá trị gốc</option>
            </select>
        </div>
        <div id="gain-offset-container" style="display: ${currentTransformType == 2 ? 'contents' : 'none'}">
            ${gainFieldsHTML}
            <div class="form-group">
                <label>Hệ số cộng (Offset)</label>
                <input type="number" step="any" class="modal-input" data-field="offset" value="${getValue('offset')}">
            </div>
        </div>
        <div class="form-group">
            <label>Số chữ số thập phân</label>
            <input type="number" step="1" class="modal-input" data-field="transDecimal" value="${getValue('transDecimal')}">
        </div>
        <div class="form-group">
            <label>Địa chỉ thanh ghi (Addr)</label>
            <div class="static-value">${measureData.addr}</div>
        </div>
        <div class="form-group">
            <label>Kiểu dữ liệu (DataType)</label>
            <div class="static-value">${measureData.dataType}</div>
        </div>
    `;

    // Gắn sự kiện change cho dropdown để ẩn/hiện gain và offset
    const selector = formContainer.querySelector('#measure-transform-type-selector');
    selector.addEventListener('change', (e) => {
        document.getElementById('gain-offset-container').style.display = e.target.value == 2 ? 'contents' : 'none';
    });
}

// --- TRONG FILE: js/page-solar-config.js ---

document.addEventListener('DOMContentLoaded', () => {
    pageInitFunctions['solar-page'] = initSolarPage;
    pageRenderFunctions['solar-page'] = renderSolarPage;
});
function getCardDisplayConfig() {
    // Nếu chưa có settings từ server, trả về object rỗng
    if (!appData.user_settings || !appData.user_settings.solar_card_display) {
        return {};
    }
    return appData.user_settings.solar_card_display;
}

function renderMiniTable(cardElement, deviceId) {
    const config = getCardDisplayConfig();
    const selectedMeasures = config[deviceId] || [];

    const tbody = cardElement.querySelector('.mini-table-body');
    if (!tbody) return;

    // Nếu người dùng chưa chọn biến nào
    if (selectedMeasures.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="2" style="text-align: center; color: #64748b; padding: 15px;">
                    <i class="bi bi-gear" style="font-size: 1.2rem; display: block; margin-bottom: 5px;"></i>
                    Bấm cài đặt để chọn biến
                </td>
            </tr>`;
        return;
    }


    // --- TÌM NGUỒN DỮ LIỆU ---
    let allMeasures = [];
    // 1. Ưu tiên Socket
    if (appData.measures_list && appData.measures_list.length > 0) {
        allMeasures = appData.measures_list;
    }
    // 2. Dự phòng Config API
    else if (appData.solarConfigPage?.current_config?.measures) {
        allMeasures = appData.solarConfigPage.current_config.measures;
    }

    let html = '';

    const tableHeader = cardElement.querySelector('thead tr');
    if (tableHeader && tableHeader.children.length === 2) {
        // Thêm cột DB vào header nếu chưa có
        const th = document.createElement('th');
        th.textContent = 'DB';
        th.style.width = '30px';
        th.style.textAlign = 'center';
        tableHeader.appendChild(th);
    }

    selectedMeasures.forEach(measureName => {
        const measureInfo = allMeasures.find(m => m.name === measureName && m.ctrlName === deviceId);
        const displayName = measureInfo ? measureInfo.name : measureName;
        const displayUnit = measureInfo ? (measureInfo.unit || '') : '';
        const liveId = `live-val-${deviceId}-${measureName}`;

        // [LOGIC MỚI] Kiểm tra xem biến này có trong whitelist không
        // Key chuẩn: "DeviceName:MeasureName"
        const uniqueKey = `${deviceId}:${measureName}`;
        const isChecked = appData.logging_whitelist.includes(uniqueKey) ? 'checked' : '';
        

        html += `
            <tr>
                <td style="padding: 6px 4px; border-bottom: 1px solid #334155;">
                    <span style="color: #e2e8f0; font-weight: 500;">${displayName}</span>
                    ${displayUnit ? `<span style="font-size: 0.75rem; color: #94a3b8; margin-left: 4px;">(${displayUnit})</span>` : ''}
                </td>
                <td class="mini-value" id="${liveId}" data-measure-name="${measureName}" 
                    style="padding: 6px 4px; border-bottom: 1px solid #334155; text-align: right; font-family: monospace; font-weight: bold; color: #64748b;">
                    --
                </td>
                <!-- [THÊM CỘT CHECKBOX] -->
                <td style="padding: 6px 4px; border-bottom: 1px solid #334155; text-align: center;">
                    <input type="checkbox" class="logging-checkbox" data-key="${uniqueKey}" ${isChecked} title="Lưu vào Database">
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;

    // [THÊM] Gắn sự kiện cho Checkbox ngay sau khi render
    tbody.querySelectorAll('.logging-checkbox').forEach(cb => {
        cb.addEventListener('change', handleLoggingChange);
    });
}
let currentConfiguringDevice = null;

// Hàm mở Modal
function openDisplaySettingsModal(deviceId) {
    currentConfiguringDevice = deviceId;
    const overlay = document.getElementById('display-settings-overlay');
    const listContainer = document.getElementById('display-settings-list');

    // Tìm danh sách tất cả biến của thiết bị này
    let allMeasures = appData.measures_list || [];
    if (allMeasures.length === 0 && appData.solarConfigPage.current_config) {
        allMeasures = appData.solarConfigPage.current_config.measures || [];
    }
    const deviceMeasures = allMeasures.filter(m => m.ctrlName === deviceId);

    // Lấy danh sách đã chọn trước đó để đánh dấu tick
    const config = getCardDisplayConfig();
    const checkedSet = new Set(config[deviceId] || []);

    if (deviceMeasures.length === 0) {
        listContainer.innerHTML = '<p style="text-align:center; color: #ef4444;">Không tìm thấy biến đo nào.</p>';
    } else {
        // Vẽ danh sách Checkbox
        listContainer.innerHTML = deviceMeasures.map(m => `
            <label class="checkbox-item" style="display: flex; align-items: center; gap: 10px; padding: 8px; cursor: pointer; border-bottom: 1px solid #334155;">
                <input type="checkbox" value="${m.name}" ${checkedSet.has(m.name) ? 'checked' : ''} style="width: 18px; height: 18px;">
                <div style="line-height: 1.2;">
                    <div style="font-weight: 500; color: #f1f5f9;">${m.name}</div>
                    <div style="font-size: 0.75rem; color: #94a3b8;">Addr: ${m.addr} ${m.unit ? '| ' + m.unit : ''}</div>
                </div>
            </label>
        `).join('');
    }

    overlay.classList.remove('hidden');
}

// Gắn sự kiện LƯU cho Modal (Chạy 1 lần khi load trang)
document.addEventListener('DOMContentLoaded', () => {
    const saveBtn = document.getElementById('btn-save-display-settings');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            if (!currentConfiguringDevice) return;

            // 1. Lấy danh sách biến được tick
            const checkboxes = document.querySelectorAll('#display-settings-list input[type="checkbox"]:checked');
            const selected = Array.from(checkboxes).map(cb => cb.value);

            // 2. Lưu vào LocalStorage (Giống trang Overview)
            saveCardDisplayConfig(currentConfiguringDevice, selected);

            // 3. Vẽ lại bảng ngay lập tức
            const card = document.querySelector(`.edit-card[data-device-id="${currentConfiguringDevice}"]`);
            if (card) {
                renderMiniTable(card, currentConfiguringDevice);
                // Gọi hàm update data ngay để nếu có số liệu thì hiện luôn, ko cần chờ giây tiếp theo
                updateSolarRealtimeData();
            }

            // 4. Đóng modal
            document.getElementById('display-settings-overlay').classList.add('hidden');
        });
    }
});
function updateSolarRealtimeData() {
    const rtData = appData.realtime_values;
    const healthData = appData.health_status || {}; // Lấy dữ liệu sức khỏe

    if (!rtData) return;

    // 1. Logic vẽ lại bảng nếu chưa có (Giữ nguyên logic cũ)
    const allCards = document.querySelectorAll('#solar-workbench-container .edit-card');
    allCards.forEach(card => {
        const deviceId = card.dataset.deviceId;
        const hasRendered = card.querySelector('.mini-value');
        if (!hasRendered && getCardDisplayConfig()[deviceId]) {
            renderMiniTable(card, deviceId);
        }

        // --- LOGIC MỚI: KIỂM TRA SỨC KHỎE THIẾT BỊ ---
        const deviceHealthObj = healthData[deviceId];
        const isHealthy = deviceHealthObj && deviceHealthObj.status === 1;
        // ----------------------------------------------

        // 2. Điền dữ liệu
        const valueCells = card.querySelectorAll('.mini-value');
        valueCells.forEach(cell => {
            const measureName = cell.dataset.measureName;

            if (rtData[deviceId] && rtData[deviceId][measureName]) {
                const dataObj = rtData[deviceId][measureName];
                let rawVal = dataObj.value;

                if (rawVal !== null && rawVal !== undefined) {
                    let displayVal = rawVal;
                    if (!isNaN(parseFloat(rawVal))) {
                        displayVal = parseFloat(rawVal).toFixed(2);
                    }

                    cell.textContent = displayVal;

                    // --- ĐỔI MÀU DỰA TRÊN SỨC KHỎE ---
                    if (isHealthy) {
                        // Nếu khỏe: Số > 0 màu xanh, = 0 màu trắng
                        cell.style.color = (parseFloat(rawVal) > 0) ? '#4ade80' : '#e2e8f0';
                        cell.style.fontStyle = 'normal';
                        cell.title = "Dữ liệu thực tế (Connected)";
                    } else {
                        // Nếu chết: Màu đỏ cảnh báo
                        cell.style.color = '#ef4444';
                        cell.style.fontStyle = 'italic';
                        cell.title = "Mất kết nối - Dữ liệu cũ";
                    }
                    // ---------------------------------
                }
            }
        });
    });
}


async function saveCardDisplayConfig(deviceId, selectedMeasures) {
    // 1. Khởi tạo nếu chưa có
    if (!appData.user_settings) appData.user_settings = {};
    if (!appData.user_settings.solar_card_display) appData.user_settings.solar_card_display = {};

    // 2. Cập nhật vào biến toàn cục (Client)
    appData.user_settings.solar_card_display[deviceId] = selectedMeasures;

    // 3. Gửi lên Server (Backend) để lưu vào file json
    try {
        await api.saveUserSettings(appData.user_settings);
        console.log(`✅ Đã lưu cấu hình hiển thị cho ${deviceId} vào Server.`);
    } catch (e) {
        console.error("Lỗi khi lưu User Settings:", e);
        alert("Không thể lưu cấu hình: " + e.message);
    }
}
async function handleLoggingChange(e) {
    const checkbox = e.target;
    const key = checkbox.dataset.key;
    const isChecked = checkbox.checked;

    // 1. Cập nhật local Whitelist
    if (isChecked) {
        if (!appData.logging_whitelist.includes(key)) appData.logging_whitelist.push(key);
    } else {
        appData.logging_whitelist = appData.logging_whitelist.filter(k => k !== key);
    }

    try {
        checkbox.disabled = true;
        // 2. Gửi lên server
        await api.saveLoggingRules(appData.logging_whitelist);
        
        // 3. (QUAN TRỌNG) Thông báo cho các trang khác là Whitelist đã đổi
        console.log("Whitelist updated and synced across appData");
    } catch (err) {
        alert("Lỗi sync: " + err.message);
        checkbox.checked = !isChecked;
    } finally {
        checkbox.disabled = false;
    }
}