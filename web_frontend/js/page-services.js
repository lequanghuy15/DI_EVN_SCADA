// --- START OF FILE js/page-services.js ---

import * as api from './apiService.js';
import { appData, pageInitFunctions, updatePendingChangesBar } from './main.js';

// Cấu hình mặc định cho IEC104
const DEFAULT_IEC104 = {
    "enable": 0, "port": 2404, "serverList": [{ "asduAddr": 3 }],
    "maximumLink": 1, "uploadPeriod": 3600, "enableSpontaneous": 1,
    "kValue": 12, "wValue": 8, "t0": 30, "t1": 15, "t2": 10, "t3": 20,
    "cotSize": 2, "asduLen": 2, "byteOrder": "abcd",
    "enableOfflinData": 1, "maxOfflineDataSize": 10000, "offlineDataPeriod": 50,
    "connectMode": "tcpServer", "useRawvalue": 0, "timeSet": 1,
    "mapping_table": []
};

// Định nghĩa các kiểu dữ liệu IEC 104 phổ biến để chọn nhanh
const IEC_TYPES = [
    { label: "Measured Float (13) - Mặc định", value: "float", typeId: [7, 13], northType: "FLOAT" },
    { label: "Single Point (1) - Trạng thái", value: "sp", typeId: [1], northType: "BOOL" },
    { label: "Measured Norm (9) - Cổ điển", value: "norm", typeId: [9], northType: "INT" }
];

// --- INIT ---
async function initServicesPage() {
    console.log("[Services] Initializing...");
    const container = document.getElementById('services-workbench');
    if (!container) return;

    container.innerHTML = `<p style="color: #94a3b8; width: 100%; text-align: center;">Đang tải cấu hình dịch vụ và danh sách biến...</p>`;

    try {
        // 1. Tải cấu hình hệ thống (System Config) chứa IEC104
        const sysResponse = await api.getSystemComsConfig();
        appData.iec104_config = sysResponse.iec104 || {};
        
        // 2. QUAN TRỌNG: Tải cấu hình Solar để lấy danh sách Controller/Measures cho Dropdown Mapping
        // Nếu appData chưa có measures_list, phải gọi API
        if (!appData.measures_list || appData.measures_list.length === 0) {
            const solarConfig = await api.getSolarConfiguration();
            // Xử lý làm phẳng danh sách measures từ config solar (nếu API solar trả về cấu trúc lồng)
            // Giả sử api.getSolarConfiguration trả về { devices: [...] } và backend đã xử lý,
            // nhưng để chắc chắn ta nên dùng api.getSolarConfiguration().
            // Tuy nhiên, cách tốt nhất là dùng dữ liệu cached từ main.js nếu có.
            // Ở đây ta gọi lại API cho chắc chắn.
        }
        
        // Reset pending changes
        appData.iec104_pending_changes = null; 

        renderServicesPage();
        
        if (typeof updatePendingChangesBar === 'function') updatePendingChangesBar();

    } catch (error) {
        console.error("[Services] Init error:", error);
        container.innerHTML = `<p style="color: #ef4444; text-align: center;">Lỗi: ${error.message}</p>`;
    }
}

// --- RENDER TỔNG ---
function renderServicesPage() {
    const container = document.getElementById('services-workbench');
    if (!container) return;

    // Reset layout thành dạng cột để chứa 2 thẻ dọc
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '30px';

    let html = '';
    
    // Card 1: Cấu hình Server (Port, Timers...)
    html += generateIEC104ServerCard();

    // Card 2: Mapping Table (MỚI)
    html += generateIEC104MappingCard();

    container.innerHTML = html;
    
    // Gắn sự kiện
    attachServerListeners();
    attachMappingListeners();
}

// =============================================================================
// PHẦN 1: CARD CẤU HÌNH SERVER (Giữ nguyên logic cũ, chỉ đổi ID nút Advanced)
// =============================================================================
function generateIEC104ServerCard() {
    // Lấy config (Ưu tiên Pending > Gốc > Mặc định)
    let config = appData.iec104_pending_changes || appData.iec104_config || DEFAULT_IEC104;
    // Fix lỗi null object
    if (Object.keys(config).length === 0) config = JSON.parse(JSON.stringify(DEFAULT_IEC104));

    const asduAddr = (config.serverList && config.serverList.length > 0) ? config.serverList[0].asduAddr : 3;
    const isEnabled = config.enable === 1;
    const isModified = !!appData.iec104_pending_changes;
    const stateClass = isModified ? 'state-modified state-editing' : 'state-editing';

    return `
    <div class="edit-card ${stateClass}" id="card-iec104-server" style="width: 100%; max-width: 1000px;">
        <div class="edit-card-header">
            <h4><i class="bi bi-hdd-network"></i> <span class="card-title">1. IEC 104 Server Settings</span></h4>
            <div style="display: flex; align-items: center; gap: 10px;">
                <label style="font-size: 0.9rem; color: #cbd5e1;">Kích hoạt</label>
                <label class="toggle-switch">
                    <input type="checkbox" id="iec104-enable-toggle" ${isEnabled ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </div>
        </div>
        <div class="edit-card-body">
            <div id="iec104-settings-area" style="display: ${isEnabled ? 'block' : 'none'};">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px;">
                    <div class="form-group"><label>Port (TCP)</label><input type="number" class="edit-mode" id="iec104-port" value="${config.port || 2404}"></div>
                    <div class="form-group"><label>ASDU Address</label><input type="number" class="edit-mode" id="iec104-asdu" value="${asduAddr}"></div>
                    <div class="form-group"><label>Max Connections</label><input type="number" class="edit-mode" id="iec104-maxlink" value="${config.maximumLink || 1}"></div>
                </div>
                <!-- Nút mở rộng -->
                <div style="margin-bottom: 10px;">
                    <button type="button" class="btn btn-secondary btn-sm" id="btn-toggle-advanced-iec104" style="width: 100%;">
                        <i class="bi bi-sliders"></i> Hiển thị tham số nâng cao (Timers, APCI)
                    </button>
                </div>
                <!-- Advanced -->
                <div id="iec104-advanced-area" style="display: none; background: #1e293b; padding: 15px; border-radius: 8px; margin-top: 10px;">
                    <h5 style="margin-top:0; color:#94a3b8; border-bottom:1px solid #334155;">Timers</h5>
                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 15px;">
                        <div class="form-group"><label>t0</label><input type="number" class="edit-mode" id="iec104-t0" value="${config.t0}"></div>
                        <div class="form-group"><label>t1</label><input type="number" class="edit-mode" id="iec104-t1" value="${config.t1}"></div>
                        <div class="form-group"><label>t2</label><input type="number" class="edit-mode" id="iec104-t2" value="${config.t2}"></div>
                        <div class="form-group"><label>t3</label><input type="number" class="edit-mode" id="iec104-t3" value="${config.t3}"></div>
                    </div>
                    <h5 style="margin-top:0; color:#94a3b8; border-bottom:1px solid #334155;">APCI & Format</h5>
                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
                        <div class="form-group"><label>k</label><input type="number" class="edit-mode" id="iec104-k" value="${config.kValue}"></div>
                        <div class="form-group"><label>w</label><input type="number" class="edit-mode" id="iec104-w" value="${config.wValue}"></div>
                        <div class="form-group"><label>COT Size</label><input type="number" class="edit-mode" id="iec104-cotsize" value="${config.cotSize}"></div>
                        <div class="form-group"><label>ASDU Len</label><input type="number" class="edit-mode" id="iec104-asdulen" value="${config.asduLen}"></div>
                    </div>
                </div>
            </div>
            <div id="iec104-disabled-msg" style="display: ${isEnabled ? 'none' : 'block'}; padding: 20px; text-align: center; color: #64748b;">
                <i class="bi bi-slash-circle" style="font-size: 2rem;"></i><p>Server đang tắt.</p>
            </div>
        </div>
        <div class="edit-card-footer">
            ${isModified ? `<button class="btn btn-secondary action-reset">Hoàn tác</button>` : ''}
            <button class="btn btn-primary action-save-server">Lưu cấu hình Server</button>
        </div>
    </div>`;
}

// =============================================================================
// PHẦN 2: CARD MAPPING TABLE (MỚI & XỊN)
// =============================================================================
function generateIEC104MappingCard() {
    let config = appData.iec104_pending_changes || appData.iec104_config || DEFAULT_IEC104;
    if (Object.keys(config).length === 0) config = JSON.parse(JSON.stringify(DEFAULT_IEC104));
    
    // Lấy mapping list (Array)
    const mappings = config.mapping_table || [];
    const isModified = !!appData.iec104_pending_changes; // Dùng chung cờ modified cho cả 2 card

    return `
    <div class="edit-card ${isModified ? 'state-modified' : ''}" id="card-iec104-mapping" style="width: 100%; max-width: 1000px;">
        <div class="edit-card-header">
            <h4><i class="bi bi-list-columns-reverse"></i> <span class="card-title">2. Data Mapping (Ánh xạ dữ liệu)</span></h4>
        </div>
        <div class="edit-card-body">
            <div class="table-wrapper" style="overflow-x: auto;">
                <table class="control-table" id="iec104-mapping-table" style="font-size: 0.9rem; min-width: 800px;">
                    <thead>
                        <tr>
                            <th style="width: 20%;">Thiết bị (Controller)</th>
                            <th style="width: 30%;">Biến (Measure)</th>
                            <th style="width: 10%;">IOA Addr</th>
                            <th style="width: 30%;">IEC Type</th>
                            <th style="width: 10%; text-align: center;">Xóa</th>
                        </tr>
                    </thead>
                    <tbody id="iec104-mapping-body">
                        <!-- Rows rendered via JS -->
                    </tbody>
                </table>
            </div>
            <div style="margin-top: 15px; text-align: center;">
                <button class="btn btn-secondary" id="btn-add-mapping-row" style="width: 100%; border-style: dashed;">+ Thêm dòng mới</button>
            </div>
        </div>
        <div class="edit-card-footer">
            <button class="btn btn-primary action-save-mapping">Lưu Bảng Mapping</button>
        </div>
    </div>`;
}

// Hàm sinh HTML cho 1 dòng trong bảng
function createMappingRow(rowData, index) {
    const tr = document.createElement('tr');
    tr.className = 'mapping-row';
    tr.dataset.index = index;

    // 1. Controller Options
    const controllers = Object.values(appData.controllers_config || {});
    let ctrlOpts = `<option value="">-- Chọn TB --</option>`;
    controllers.forEach(c => {
        ctrlOpts += `<option value="${c.name}" ${c.name === rowData.ctrlName ? 'selected' : ''}>${c.name}</option>`;
    });

    // 2. Measure Options (Ban đầu disable nếu chưa chọn Controller)
    let measureOpts = generateMeasureOptions(rowData.ctrlName, rowData.measureName);

    // 3. IEC Type Options
    // Xác định loại hiện tại dựa trên typeId[1] (ví dụ 13)
    let currentTypeIdVal = 13; 
    if (rowData.typeId && rowData.typeId.length > 1) currentTypeIdVal = rowData.typeId[1];
    else if (rowData.typeId && rowData.typeId.length === 1) currentTypeIdVal = rowData.typeId[0];

    // Map ngược từ ID sang value của select (float/sp/norm)
    let currentTypeSelect = 'float'; // Default
    if(currentTypeIdVal === 1) currentTypeSelect = 'sp';
    else if (currentTypeIdVal === 9) currentTypeSelect = 'norm';

    let typeOpts = '';
    IEC_TYPES.forEach(t => {
        typeOpts += `<option value="${t.value}" ${t.value === currentTypeSelect ? 'selected' : ''}>${t.label}</option>`;
    });

    tr.innerHTML = `
        <td><select class="modal-input sel-ctrl" style="width: 100%;">${ctrlOpts}</select></td>
        <td><select class="modal-input sel-meas" style="width: 100%;" ${!rowData.ctrlName ? 'disabled' : ''}>${measureOpts}</select></td>
        <td><input type="number" class="modal-input inp-ioa" value="${rowData.startMapAddr || ''}" style="text-align: center; font-weight: bold; color: #4ade80;"></td>
        <td><select class="modal-input sel-type" style="width: 100%;">${typeOpts}</select></td>
        <td style="text-align: center;"><button class="delete-icon btn-del-row"><i class="bi bi-trash"></i></button></td>
    `;

    // --- EVENTS ---
    const selCtrl = tr.querySelector('.sel-ctrl');
    const selMeas = tr.querySelector('.sel-meas');
    const inpIOA = tr.querySelector('.inp-ioa');

    // Đổi thiết bị -> Nạp lại biến
    selCtrl.addEventListener('change', () => {
        selMeas.innerHTML = generateMeasureOptions(selCtrl.value, null);
        selMeas.disabled = !selCtrl.value;
    });

    // Xóa dòng
    tr.querySelector('.btn-del-row').addEventListener('click', () => {
        tr.remove();
    });

    return tr;
}

function generateMeasureOptions(ctrlName, selectedMeas) {
    if (!ctrlName) return `<option value="">-- Trước tiên chọn TB --</option>`;
    
    // Lấy danh sách measures
    let allMeasures = appData.measures_list || [];
    // Fallback nếu list rỗng nhưng config có
    if(allMeasures.length === 0 && appData.measures_config) {
        allMeasures = Object.values(appData.measures_config);
    }

    const filtered = allMeasures.filter(m => m.ctrlName === ctrlName);
    
    let opts = `<option value="">-- Chọn Biến --</option>`;
    filtered.forEach(m => {
        const isSel = m.name === selectedMeas ? 'selected' : '';
        opts += `<option value="${m.name}" ${isSel}>${m.name} [${m.addr}]</option>`;
    });
    return opts;
}

// =============================================================================
// PHẦN 3: XỬ LÝ SỰ KIỆN (LISTENERS)
// =============================================================================

// A. Sự kiện cho Card Server (Giữ nguyên logic cũ, chỉ sửa ID nút Advanced)
function attachServerListeners() {
    // Toggle Enable
    const enableToggle = document.getElementById('iec104-enable-toggle');
    if (enableToggle) {
        enableToggle.addEventListener('change', (e) => {
            const isOn = e.target.checked;
            document.getElementById('iec104-settings-area').style.display = isOn ? 'block' : 'none';
            document.getElementById('iec104-disabled-msg').style.display = isOn ? 'none' : 'block';
        });
    }
    // Toggle Advanced
    const advBtn = document.getElementById('btn-toggle-advanced-iec104');
    if (advBtn) {
        advBtn.addEventListener('click', () => {
            const area = document.getElementById('iec104-advanced-area');
            const isHidden = area.style.display === 'none';
            area.style.display = isHidden ? 'block' : 'none';
            advBtn.innerHTML = isHidden 
                ? '<i class="bi bi-chevron-up"></i> Ẩn tham số nâng cao' 
                : '<i class="bi bi-sliders"></i> Hiển thị tham số nâng cao';
        });
    }
    // Save Server Config (Chỉ lưu phần settings, giữ nguyên mapping cũ)
    const saveBtn = document.querySelector('.action-save-server');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            saveFullConfig(false); // false = không update mapping từ bảng (giữ nguyên)
        });
    }
    // Reset
    const resetBtn = document.querySelector('.action-reset');
    if(resetBtn) resetBtn.addEventListener('click', () => {
        appData.iec104_pending_changes = null;
        renderServicesPage();
        updatePendingChangesBar();
    });
}

// B. Sự kiện cho Card Mapping
function attachMappingListeners() {
    const tbody = document.getElementById('iec104-mapping-body');
    const addBtn = document.getElementById('btn-add-mapping-row');
    const saveBtn = document.querySelector('.action-save-mapping');

    // Load dữ liệu hiện tại vào bảng
    let config = appData.iec104_pending_changes || appData.iec104_config || DEFAULT_IEC104;
    const mappings = config.mapping_table || [];
    
    mappings.forEach((mapItem, idx) => {
        tbody.appendChild(createMappingRow(mapItem, idx));
    });

    // Nút Thêm dòng
    addBtn.addEventListener('click', () => {
        // Tự động tính IOA tiếp theo
        let maxIOA = 0;
        document.querySelectorAll('.inp-ioa').forEach(inp => {
            const val = parseInt(inp.value) || 0;
            if (val > maxIOA) maxIOA = val;
        });

        const newRowData = {
            ctrlName: "",
            measureName: "",
            startMapAddr: maxIOA + 1,
            typeId: [7, 13] // Default Float
        };
        tbody.appendChild(createMappingRow(newRowData, tbody.children.length));
    });

    // Nút Lưu Mapping
    saveBtn.addEventListener('click', () => {
        saveFullConfig(true); // true = update mapping từ bảng
    });
}

// Hàm Lưu Tổng Hợp (Gộp dữ liệu từ cả 2 card vào 1 object Config)
function saveFullConfig(updateMappingFromTable) {
    // 1. Lấy dữ liệu nền (Base)
    let baseData = appData.iec104_pending_changes || appData.iec104_config || JSON.parse(JSON.stringify(DEFAULT_IEC104));
    // Clone để không sửa trực tiếp reference cũ
    baseData = JSON.parse(JSON.stringify(baseData));

    // 2. Cập nhật dữ liệu từ Card Server (nếu card này đang hiển thị)
    const isEnabled = document.getElementById('iec104-enable-toggle').checked;
    baseData.enable = isEnabled ? 1 : 0;
    
    if (isEnabled) {
        baseData.port = parseInt(document.getElementById('iec104-port').value) || 2404;
        baseData.maximumLink = parseInt(document.getElementById('iec104-maxlink').value) || 1;
        // ASDU
        const asdu = parseInt(document.getElementById('iec104-asdu').value) || 3;
        if (!baseData.serverList || baseData.serverList.length === 0) baseData.serverList = [{}];
        baseData.serverList[0].asduAddr = asdu;
        
        // Timers & APCI (Lấy từ DOM nếu user đã mở advanced, hoặc giữ nguyên giá trị cũ)
        // Lưu ý: Để an toàn, ta nên lấy value từ DOM bất kể nó ẩn hay hiện
        baseData.t0 = parseInt(document.getElementById('iec104-t0').value);
        baseData.t1 = parseInt(document.getElementById('iec104-t1').value);
        baseData.t2 = parseInt(document.getElementById('iec104-t2').value);
        baseData.t3 = parseInt(document.getElementById('iec104-t3').value);
        baseData.kValue = parseInt(document.getElementById('iec104-k').value);
        baseData.wValue = parseInt(document.getElementById('iec104-w').value);
        baseData.cotSize = parseInt(document.getElementById('iec104-cotsize').value);
        baseData.asduLen = parseInt(document.getElementById('iec104-asdulen').value);
    }

    // 3. Cập nhật dữ liệu từ Card Mapping (Nếu được yêu cầu)
    if (updateMappingFromTable) {
        const newMappings = [];
        const rows = document.querySelectorAll('.mapping-row');
        
        rows.forEach(row => {
            const ctrl = row.querySelector('.sel-ctrl').value;
            const meas = row.querySelector('.sel-meas').value;
            const ioa = parseInt(row.querySelector('.inp-ioa').value);
            const typeKey = row.querySelector('.sel-type').value;

            if (ctrl && meas && ioa) {
                // Tìm config của type đã chọn
                const typeConfig = IEC_TYPES.find(t => t.value === typeKey);
                
                // Tìm thông tin gốc của measure để lấy dataType (DINT/DWORD...)
                let originalDataType = "DINT"; // Default fallback
                if (appData.measures_list) {
                    const m = appData.measures_list.find(x => x.name === meas && x.ctrlName === ctrl);
                    if (m) originalDataType = m.dataType;
                }

                newMappings.push({
                    measureName: meas,
                    ctrlName: ctrl,
                    startMapAddr: ioa,
                    asduAddr: baseData.serverList[0].asduAddr, // Đồng bộ ASDU
                    // Các trường tự động điền theo Type đã chọn
                    typeId: typeConfig.typeId,
                    northDataType: typeConfig.northType,
                    // Các trường mặc định khác
                    readWrite: "ro", // Mặc định chỉ đọc
                    dataType: originalDataType,
                    enableBit: 0,
                    endMapAddr: `${typeConfig.typeId[1] || typeConfig.typeId[0]} ${ioa}` // Format PTech: "TypeID IOA"
                });
            }
        });
        
        baseData.mapping_table = newMappings;
    }

    // 4. Lưu vào App Data & Cập nhật UI
    appData.iec104_pending_changes = baseData;
    console.log("✅ Đã lưu IEC104 vào Pending:", appData.iec104_pending_changes);

    renderServicesPage(); // Vẽ lại để cập nhật trạng thái viền vàng
    if (typeof updatePendingChangesBar === 'function') updatePendingChangesBar();
    alert("Đã lưu cấu hình vào bộ nhớ tạm. Hãy nhấn 'Apply Changes' ở thanh dưới cùng để áp dụng.");
}

// --- REGISTER ---
document.addEventListener('DOMContentLoaded', () => {
    pageInitFunctions['services-page'] = initServicesPage;
});