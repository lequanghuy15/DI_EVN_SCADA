import * as api from './apiService.js';
import { appData, pageInitFunctions, pageRenderFunctions, updatePendingChangesBar } from './main.js';

// Template mặc định đầy đủ các trường
const DEFAULT_CLOUD_TEMPLATE = {
    "_id": "cloud_default_" + Date.now(),
    "name": "default",
    "type": "Standard MQTT",
    "enable": 0,
    "uploadRules": [],
    "args": {
        "host": "",
        "port": 1883,
        "clientId": "gateway_" + Math.floor(Math.random() * 100000),
        "username": "",
        "passwd": "",
        "auth": 0,          // 0: Off, 1: On
        "keepalive": 60,
        "cleanSession": 1,  // 1: True, 0: False
        "mqttVersion": "v3.1.1",
        "ssl": 0            // 0: Off, 1: On
    }
};

// --- INIT ---
async function initCloudPage() {
    console.log("[Cloud] Initializing...");
    const container = document.getElementById('cloud-workbench');
    if (!container) return;

    container.innerHTML = `<p style="color: #94a3b8; text-align: center; margin-top: 20px;">Đang tải cấu hình Cloud...</p>`;

    try {
        // 1. Load Config Hệ thống
        const sysConfig = await api.getSystemComsConfig();
        appData.cloud_config = sysConfig.clouds || [];
        
        // 2. Load Config Rules
        const rules = await api.getCloudUploadRules();
        appData.cloud_upload_rules = rules || [];

        appData.cloud_pending_changes = {};
        appData.cloud_rules_pending = null;

        renderCloudPage();
        
    } catch (error) {
        console.error("[Cloud] Init error:", error);
        container.innerHTML = `<p style="color: #ef4444;">Lỗi: ${error.message}</p>`;
    }
}

// --- RENDER TỔNG ---
function renderCloudPage() {
    const container = document.getElementById('cloud-workbench');
    if (!container) return;

    container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 30px;">
            <div id="cloud-connection-card-wrapper"></div>
            <div id="cloud-mapping-card-wrapper"></div>
        </div>
    `;

    renderConnectionCard(); 
    renderMappingCard();    
}

// =========================================================================
// PHẦN 1: CARD KẾT NỐI (FULL OPTION)
// =========================================================================
function renderConnectionCard() {
    const container = document.getElementById('cloud-connection-card-wrapper');
    
    // Lấy dữ liệu
    let displayData = appData.cloud_pending_changes['default_cloud'] || (appData.cloud_config[0] || {});
    if (!displayData.args) displayData.args = {}; // Fallback
    
    // Merge với default để đảm bảo không thiếu trường nào
    const args = { ...DEFAULT_CLOUD_TEMPLATE.args, ...displayData.args };
    const isAppEnabled = displayData.enable_app === 1; 
    
    const isEnabled = displayData.enable === 1;
    const isAuth = args.auth === 1;
    const isSSL = args.ssl === 1; // Trường SSL thủ công
    const stateClass = !!appData.cloud_pending_changes['default_cloud'] ? 'state-modified state-editing' : 'state-editing';

    const html = `
    <div class="edit-card ${stateClass}" style="width: 100%; max-width: 100%;">
        <div class="edit-card-header">
            <h4>
                <i class="bi bi-cloud-check"></i> <span class="card-title">1. Kết nối MQTT Broker</span>
                <span id="cloud-status-badge" class="status-badge" style="background-color: #64748b; color: white; font-size: 0.75rem;">Connecting...</span>
                ${stateClass.includes('modified') ? '<span style="font-size:0.75rem; color:#f59e0b; margin-left:10px;">(Chưa lưu)</span>' : ''}
            </h4>
            <div style="display: flex; align-items: center; gap: 10px;">
                <label style="color: #cbd5e1;">Kích hoạt</label>
                <label class="toggle-switch">
                    <input type="checkbox" id="cloud-enable-toggle" ${isAppEnabled ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </div>
        </div>

        <div class="edit-card-body">
            <div id="cloud-settings-area" style="display: ${isAppEnabled ? 'block' : 'none'};">
                
                <!-- GROUP 1: CƠ BẢN -->
                <h5 style="margin-top:0; color:#a5b4fc; border-bottom:1px solid #475569; padding-bottom:5px; margin-bottom:15px;">Thông tin máy chủ</h5>
                <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 20px; margin-bottom: 20px;">
                    <div class="form-group">
                        <label>Host / Broker Address</label>
                        <input type="text" class="edit-mode" id="cloud-host" value="${args.host || ''}" placeholder="broker.emqx.io">
                    </div>
                    <div class="form-group">
                        <label>Port</label>
                        <input type="number" class="edit-mode" id="cloud-port" value="${args.port || 1883}">
                    </div>
                    <div class="form-group">
                        <label>SSL/TLS</label>
                        <div style="margin-top: 8px;">
                            <label class="toggle-switch">
                                <input type="checkbox" id="cloud-ssl-toggle" ${isSSL ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- GROUP 2: XÁC THỰC -->
                <div style="margin-bottom: 20px;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                        <label style="font-weight: 600; color: #cbd5e1;">Xác thực (Username/Password)</label>
                        <input type="checkbox" id="cloud-auth-toggle" ${isAuth ? 'checked' : ''}>
                    </div>
                    <div id="cloud-auth-fields" style="display: ${isAuth ? 'grid' : 'none'}; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div class="form-group">
                            <label>Username (hoặc Access Token)</label>
                            <input type="text" class="edit-mode" id="cloud-username" value="${args.username || ''}">
                        </div>
                        <div class="form-group">
                            <label>Password</label>
                            <input type="password" class="edit-mode" id="cloud-passwd" value="${args.passwd || ''}">
                        </div>
                    </div>
                </div>

                <!-- GROUP 3: NÂNG CAO (ĐÃ TRẢ LẠI ĐẦY ĐỦ) -->
                <div style="margin-bottom: 10px;">
                    <button class="btn btn-secondary btn-sm" id="btn-toggle-advanced" style="width: 100%; border: 1px dashed #475569;">
                        <i class="bi bi-sliders"></i> Cấu hình nâng cao (Advanced)
                    </button>
                </div>

                <div id="cloud-advanced-fields" style="display: none; background: #293548; padding: 15px; border-radius: 8px; margin-top: 10px;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div class="form-group">
                            <label>Client ID</label>
                            <input type="text" class="edit-mode" id="cloud-clientid" value="${args.clientId || ''}">
                        </div>
                        <div class="form-group">
                            <label>Keep Alive (s)</label>
                            <input type="number" class="edit-mode" id="cloud-keepalive" value="${args.keepalive}">
                        </div>
                        <div class="form-group">
                            <label>MQTT Version</label>
                            <select class="edit-mode" id="cloud-mqttversion">
                                <option value="v3.1.1" ${args.mqttVersion === 'v3.1.1' ? 'selected' : ''}>v3.1.1 (Standard)</option>
                                <option value="v5" ${args.mqttVersion === 'v5' ? 'selected' : ''}>v5.0 (Modern)</option>
                                <option value="v3.1" ${args.mqttVersion === 'v3.1' ? 'selected' : ''}>v3.1 (Legacy)</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Clean Session</label>
                            <select class="edit-mode" id="cloud-cleansession">
                                <option value="1" ${args.cleanSession == 1 ? 'selected' : ''}>True (Mới hoàn toàn)</option>
                                <option value="0" ${args.cleanSession == 0 ? 'selected' : ''}>False (Giữ phiên)</option>
                            </select>
                        </div>
                    </div>
                </div>

            </div>
            
            <div id="cloud-disabled-msg" style="display: ${isAppEnabled ? 'none' : 'block'}; padding: 20px; text-align: center; color: #64748b;">
                <i class="bi bi-cloud-slash" style="font-size: 2rem;"></i>
                <p>Kết nối Cloud đang tắt.</p>
            </div>
        </div>

        <div class="edit-card-footer">
            ${appData.cloud_pending_changes['default_cloud'] ? '<button class="btn btn-secondary action-reset-conn">Hoàn tác</button>' : ''}
            <button class="btn btn-primary action-save-conn">Lưu cấu hình</button>
        </div>
    </div>`;

    container.innerHTML = html;

    // --- XỬ LÝ SỰ KIỆN ---
    
    // Toggle Enable
    document.getElementById('cloud-enable-toggle').addEventListener('change', (e) => {
        document.getElementById('cloud-settings-area').style.display = e.target.checked ? 'block' : 'none';
        document.getElementById('cloud-disabled-msg').style.display = e.target.checked ? 'none' : 'block';
    });

    // Toggle Auth
    document.getElementById('cloud-auth-toggle').addEventListener('change', (e) => {
        document.getElementById('cloud-auth-fields').style.display = e.target.checked ? 'grid' : 'none';
    });

    // Toggle Advanced
    document.getElementById('btn-toggle-advanced').addEventListener('click', (e) => {
        const advDiv = document.getElementById('cloud-advanced-fields');
        if (advDiv.style.display === 'none') {
            advDiv.style.display = 'block';
            e.target.innerHTML = '<i class="bi bi-chevron-up"></i> Ẩn cấu hình nâng cao';
        } else {
            advDiv.style.display = 'none';
            e.target.innerHTML = '<i class="bi bi-sliders"></i> Cấu hình nâng cao (Advanced)';
        }
    });

    // Nút Lưu
    container.querySelector('.action-save-conn').addEventListener('click', () => {
        const newData = JSON.parse(JSON.stringify(displayData));
        if (!newData.args) newData.args = {};
        const toggleState = document.getElementById('cloud-enable-toggle').checked; 
        const isEnabled = document.getElementById('cloud-enable-toggle').checked;
        newData.enable_app = toggleState ? 1 : 0;

        if (isEnabled) {
            // Basic
            newData.args.host = document.getElementById('cloud-host').value;
            newData.args.port = parseInt(document.getElementById('cloud-port').value);
            newData.args.ssl = document.getElementById('cloud-ssl-toggle').checked ? 1 : 0;

            // Auth
            const isAuth = document.getElementById('cloud-auth-toggle').checked;
            newData.args.auth = isAuth ? 1 : 0;
            newData.args.username = isAuth ? document.getElementById('cloud-username').value : "";
            newData.args.passwd = isAuth ? document.getElementById('cloud-passwd').value : "";

            // Advanced
            newData.args.clientId = document.getElementById('cloud-clientid').value;
            newData.args.keepalive = parseInt(document.getElementById('cloud-keepalive').value);
            newData.args.mqttVersion = document.getElementById('cloud-mqttversion').value;
            newData.args.cleanSession = parseInt(document.getElementById('cloud-cleansession').value);
        }
        
        appData.cloud_pending_changes['default_cloud'] = newData;
        renderConnectionCard(); 
        if (typeof updatePendingChangesBar === 'function') updatePendingChangesBar();
    });

    // Nút Reset
    const resetBtn = container.querySelector('.action-reset-conn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            delete appData.cloud_pending_changes['default_cloud'];
            renderConnectionCard();
            if (typeof updatePendingChangesBar === 'function') updatePendingChangesBar();
        });
    }
}

// =========================================================================
// PHẦN 2: CARD MAPPING (Giữ nguyên logic Realtime)
// =========================================================================
function renderMappingCard() {
    const container = document.getElementById('cloud-mapping-card-wrapper');
    
    const currentRules = appData.cloud_rules_pending || appData.cloud_upload_rules || [];
    const isModified = !!appData.cloud_rules_pending;

    const html = `
    <div class="edit-card ${isModified ? 'state-modified' : ''}" style="width: 100%;">
        <div class="edit-card-header">
            <h4>
                <i class="bi bi-list-check"></i> 
                <span class="card-title">2. Cấu hình biến tải lên (Upload Rules)</span>
                ${isModified ? '<span style="color:#f59e0b; font-size:0.8rem; margin-left:10px;">(Chưa lưu file)</span>' : ''}
            </h4>
        </div>
        <div class="edit-card-body">
            <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 15px;">
                Chọn các biến cần gửi lên Cloud.
            </p>
            <table class="control-table" id="mapping-table" style="font-size: 0.9rem;">
                <thead>
                    <tr>
                        <th style="width: 17.5%;">Thiết bị nguồn</th>
                        <th style="width: 17.5%;">Biến đo</th>
                        <th style="width: 25%;">Tên gửi đi (Cloud Key)</th>
                        <th style="width: 15%;">Chu kỳ (s)</th> <!-- CỘT MỚI -->
                        <th style="width: 15%;">Giá trị</th>
                        <th style="width: 10%; text-align: center;">Xóa</th>
                    </tr>
                </thead>
                <tbody id="mapping-table-body"></tbody>
            </table>
            <div style="margin-top: 15px; text-align: center;">
                <button class="btn btn-secondary" id="btn-add-rule" style="width: 100%; border-style: dashed;">+ Thêm dòng mới</button>
            </div>
        </div>
        <div class="edit-card-footer">
            ${isModified ? '<button class="btn btn-secondary action-cancel-rules" style="margin-right: 10px;">Hủy bỏ</button>' : ''}
            <button class="btn btn-primary action-save-rules">Lưu danh sách biến</button>
        </div>
    </div>`;

    container.innerHTML = html;
    const tbody = document.getElementById('mapping-table-body');
    currentRules.forEach((rule, index) => tbody.appendChild(createMappingRow(rule, index)));

    document.getElementById('btn-add-rule').addEventListener('click', () => {
        const newRule = { device: "", measure: "", cloudKey: "" };
        tbody.appendChild(createMappingRow(newRule, tbody.children.length));
        markRulesAsModified();
    });

    container.querySelector('.action-save-rules').addEventListener('click', async () => {
        const rows = document.querySelectorAll('.mapping-row');
        const newRules = [];
        rows.forEach(row => {
            const device = row.querySelector('.sel-device').value;
            const measure = row.querySelector('.sel-measure').value;
            const key = row.querySelector('.inp-key').value;
            if (device && measure && key) newRules.push({ device, measure, cloudKey: key });
        });
        const btn = container.querySelector('.action-save-rules');
        btn.textContent = "Đang lưu..."; btn.disabled = true;
        try {
            await api.saveCloudUploadRules(newRules);
            appData.cloud_upload_rules = newRules;
            appData.cloud_rules_pending = null;
            alert("Đã lưu danh sách biến thành công!");
            renderMappingCard(); 
        } catch (e) { alert("Lỗi: " + e.message); btn.disabled = false; }
    });

    const cancelBtn = container.querySelector('.action-cancel-rules');
    if (cancelBtn) cancelBtn.addEventListener('click', () => { appData.cloud_rules_pending = null; renderMappingCard(); });
}

function createMappingRow(rule, index) {
    const tr = document.createElement('tr');
    tr.className = 'mapping-row';
    tr.dataset.index = index;
    
    const controllers = Object.values(appData.controllers_config || {});
    let devOpts = `<option value="">-- Chọn TB --</option>`;
    controllers.forEach(c => { devOpts += `<option value="${c.name}" ${c.name === rule.device ? 'selected' : ''}>${c.name}</option>`; });

    // Mặc định chu kỳ là 60s nếu chưa có
    const intervalVal = rule.interval || 60;

    tr.innerHTML = `
        <td><select class="modal-input sel-device" style="width: 100%;">${devOpts}</select></td>
        <td><select class="modal-input sel-measure" style="width: 100%;" ${!rule.device ? 'disabled' : ''}>${generateMeasureOptions(rule.device, rule.measure)}</select></td>
        <td><input type="text" class="modal-input inp-key" value="${rule.cloudKey || ''}"></td>
        
        <!-- Ô NHẬP CHU KỲ (MỚI) -->
        <td><input type="number" class="modal-input inp-interval" value="${intervalVal}" min="1" step="1" style="text-align: center;"></td>
        
        <td style="font-family: monospace; color: #4ade80; text-align: right;" class="val-preview">--</td>
        <td style="text-align: center;"><button class="delete-icon btn-del-rule"><i class="bi bi-trash"></i></button></td>
    `;

    const selDevice = tr.querySelector('.sel-device');
    const selMeasure = tr.querySelector('.sel-measure');
    const inpKey = tr.querySelector('.inp-key');
    const valPreview = tr.querySelector('.val-preview');

    selDevice.addEventListener('change', () => {
        selMeasure.innerHTML = generateMeasureOptions(selDevice.value, null);
        selMeasure.disabled = !selDevice.value;
        inpKey.value = ""; valPreview.textContent = "--";
        markRulesAsModified();
    });
    selMeasure.addEventListener('change', () => {
        if (selDevice.value && selMeasure.value && inpKey.value.trim() === "") inpKey.value = `${selDevice.value}:${selMeasure.value}`;
        updatePreviewValue(selDevice.value, selMeasure.value, valPreview);
        markRulesAsModified();
    });
    tr.querySelector('.btn-del-rule').addEventListener('click', () => { tr.remove(); markRulesAsModified(); });
    if (rule.device && rule.measure) updatePreviewValue(rule.device, rule.measure, valPreview);
    return tr;
}

function generateMeasureOptions(devName, selectedMeasure) {
    if (!devName) return `<option value="">-- Trước tiên chọn TB --</option>`;
    let measures = appData.measures_list || Object.values(appData.measures_config || {});
    measures = measures.filter(m => m.ctrlName === devName);
    let opts = `<option value="">-- Chọn Biến --</option>`;
    measures.forEach(m => { opts += `<option value="${m.name}" ${m.name === selectedMeasure ? 'selected' : ''}>${m.name}</option>`; });
    return opts;
}

function updatePreviewValue(dev, meas, el) {
    const valObj = appData.realtime_values?.[dev]?.[meas];
    el.textContent = (valObj && valObj.value !== undefined) ? (typeof valObj.value === 'number' ? valObj.value.toFixed(2) : valObj.value) : "N/A";
}

function markRulesAsModified() {
    const rows = document.querySelectorAll('.mapping-row');
    const tempRules = [];
    rows.forEach(row => {
        tempRules.push({
            device: row.querySelector('.sel-device').value,
            measure: row.querySelector('.sel-measure').value,
            cloudKey: row.querySelector('.inp-key').value,
            interval: parseInt(row.querySelector('.inp-interval').value) || 60 // <--- LƯU CHU KỲ
        });
    });
    appData.cloud_rules_pending = tempRules;
    const card = document.querySelector('#cloud-mapping-card-wrapper .edit-card');
    if(card && !card.classList.contains('state-modified')) renderMappingCard();
}

function updateCloudPageRealtime() {
    const statusBadge = document.getElementById('cloud-status-badge');
    
    if (statusBadge) {
        // --- SỬA Ở ĐÂY: TÌM DỮ LIỆU Ở CẢ 2 NƠI ---
        
        // 1. Tìm ở Root (nơi api/config đang trả về)
        let cloudData = appData.cloud_runtime_status;

        let isConnected = false;
        if (cloudData) {
            // Chấp nhận mọi kiểu dữ liệu (true, "true", 1)
            const val = cloudData.connected;
            if (val === true || val === "true" || val === 1) {
                isConnected = true;
            }
        }

        // 4. Đổi màu đèn
        if (isConnected) {
            if (statusBadge.textContent !== "CONNECTED") {
                statusBadge.textContent = "CONNECTED";
                statusBadge.style.backgroundColor = "#22c55e"; // Xanh
            }
        } else {
            if (statusBadge.textContent !== "DISCONNECTED") {
                statusBadge.textContent = "DISCONNECTED";
                statusBadge.style.backgroundColor = "#ef4444"; // Đỏ
            }
        }
    }

    // Cập nhật bảng mapping (Giữ nguyên)
    document.querySelectorAll('.mapping-row').forEach(row => {
        const selDevice = row.querySelector('.sel-device');
        const selMeasure = row.querySelector('.sel-measure');
        const valPreview = row.querySelector('.val-preview');
        if (selDevice && selMeasure && valPreview && selDevice.value && selMeasure.value) {
            updatePreviewValue(selDevice.value, selMeasure.value, valPreview);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    pageInitFunctions['cloud-page'] = initCloudPage;
    pageRenderFunctions['cloud-page'] = updateCloudPageRealtime;
});