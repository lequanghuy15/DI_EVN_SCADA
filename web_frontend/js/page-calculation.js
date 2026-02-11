/**
 * js/page-calculation.js
 * Quản lý Virtual Controllers (Protocol: Virtual Controller)
 * và quy tắc cộng dồn dữ liệu (Calculations)
 */
import * as api from './apiService.js'; 
import { appData, pageInitFunctions, pageRenderFunctions, updatePendingChangesBar } from './main.js';

/**
 * Helper: Chuẩn hóa ID để tránh lỗi CSS Selector
 */
function safeId(str) {
    if (!str) return 'unknown';
    // 1. Chuyển thành chuỗi
    // 2. Thay dấu : thành _
    // 3. Thay khoảng trắng thành _
    // 4. Thay dấu . thành _ (nếu có)
    return String(str).replace(/:/g, '_').replace(/\s+/g, '_').replace(/\./g, '_');
}

/**
 * 1. KHỞI TẠO TRANG
 */
async function initCalculationPage() {
    console.log("[Calculation] Page Initializing...");
    
    // --- BƯỚC QUAN TRỌNG: ĐẢM BẢO CÓ DỮ LIỆU THIẾT BỊ ---
    // Nếu cả 2 nguồn dữ liệu đều trống, ta chủ động gọi API lấy về
    if (Object.keys(appData.controllers_config || {}).length === 0 && 
        (!appData.solarConfigPage?.current_config?.devices)) {
        
        console.log("⚠️ Dữ liệu trống, đang tải cấu hình từ Server...");
        try {
            const config = await api.getSolarConfiguration();
            appData.solarConfigPage.current_config = config;
            // Cập nhật luôn vào config dùng chung cho các trang khác
            if (config.devices) {
                config.devices.forEach(d => {
                    appData.controllers_config[d.id] = d;
                });
            }
        } catch (e) {
            console.error("Lỗi tải cấu hình:", e);
        }
    }

    if (!appData.solarConfigPage) appData.solarConfigPage = {};
    if (!appData.solarConfigPage.pending_changes) appData.solarConfigPage.pending_changes = {};

    attachGlobalClickListeners();
    await reloadCalculations(); // Hàm này sẽ gọi renderCalculationWorkbench
}

/**
 * 2. GẮN SỰ KIỆN CLICK TOÀN CỤC
 */
function attachGlobalClickListeners() {
    // Xóa bỏ các listener cũ để tránh trùng lặp nếu init lại
    document.removeEventListener('click', handleGlobalClick);
    document.addEventListener('click', handleGlobalClick);

    // --- LOGIC MỚI: XỬ LÝ ẨN/HIỆN TRONG MODAL ---
    const opSelect = document.getElementById('calc-input-operation');
    if (opSelect) {
        // Lắng nghe sự kiện thay đổi loại phép tính
        opSelect.onchange = () => {
            const val = opSelect.value;
            const areaConstant = document.getElementById('area-constant');
            const areaItems = document.getElementById('area-items');

            if (val === 'constant') {
                // Nếu là hằng số: Hiện ô nhập số, ẩn phần chọn thiết bị
                areaConstant?.classList.remove('hidden');
                areaItems?.classList.add('hidden');
            } else if (val === 'manual_status') {
                // Nếu là trạng thái: Ẩn cả hai (chỉ cần Tên/ID)
                areaConstant?.classList.add('hidden');
                areaItems?.classList.add('hidden');
            } else {
                // Các phép tính SUM/AVG/MAX/MIN: Hiện phần chọn thiết bị, ẩn ô hằng số
                areaConstant?.classList.add('hidden');
                areaItems?.classList.remove('hidden');
            }
        };
    }

    // --- LOGIC MỚI: XỬ LÝ GẠT CÔNG TẮC (MANUAL STATUS) ---
    // Sử dụng event delegation để bắt sự kiện thay đổi của các checkbox có class 'manual-status-toggle'
    document.addEventListener('change', async (e) => {
        if (e.target.classList.contains('calc-manual-input')) {
            const id = e.target.dataset.id;
            const val = parseFloat(e.target.value) || 0;
            try {
                // Gọi apiService đã viết ở các bước trước
                await api.updateManualValue(id, val); 
                console.log(`Saved constant ${id}: ${val}`);
            } catch (err) {
                alert("Lỗi lưu giá trị: " + err.message);
            }
        }
        if (e.target.classList.contains('manual-status-toggle')) {
            const ruleId = e.target.dataset.id;
            const isChecked = e.target.checked ? 1 : 0;
            
            try {
                // Gọi apiService để cập nhật giá trị 0/1 vào Backend
                // Lưu ý: Đảm bảo apiService đã được import trong file này
                await api.updateManualState(ruleId, isChecked);
                console.log(`[Manual Status] Đã cập nhật ${ruleId} thành ${isChecked}`);
            } catch (err) {
                alert("Lỗi cập nhật trạng thái: " + err.message);
                e.target.checked = !e.target.checked; // Trả lại trạng thái cũ nếu lỗi
            }
        }
    });
}

function handleGlobalClick(e) {
    // A. Nút "Tạo Controller mới"
    if (e.target.closest('.action-add-vc')) {
        openVCModal();
    }
    
    // B. Nút "Lưu" trong Modal Tạo VC
    if (e.target.closest('#btn-save-vc')) {
        saveVC();
    }
    
    // C. Nút "Thêm phép tính"
    if (e.target.closest('.action-add-calc')) {
        openCalcModal();
    }
    if (e.target.closest('.action-edit-calc')) {
        const btn = e.target.closest('.action-edit-calc');
        const ruleId = btn.dataset.id;
        // Tìm rule trong appData
        const ruleToEdit = (appData.calculation_rules || []).find(r => r.id === ruleId);
        if (ruleToEdit) {
            openCalcModal(ruleToEdit); // Truyền object cần sửa vào hàm mở modal
        }
    }

    // D. Các nút đóng modal
    if (e.target.closest('[data-action="close-vc-modal"]')) {
        document.getElementById('vc-modal-overlay').classList.add('hidden');
    }
    if (e.target.closest('[data-action="close-calc-modal"]')) {
        document.getElementById('calc-modal-overlay').classList.add('hidden');
    }
    if (e.target.closest('[data-action="close-vm-modal"]')) {
        document.getElementById('v-measure-modal-overlay').classList.add('hidden');
    }
    
    // E. Nút xóa phép tính
    if (e.target.closest('.action-delete-calc')) {
        const id = e.target.closest('.action-delete-calc').dataset.id;
        deleteCalculation(id);
    }

    // [THÊM MỚI] F. Nút "Thêm biến đo" (+ tròn trên thẻ VC)
    if (e.target.closest('.action-add-vm')) {
        const btn = e.target.closest('.action-add-vm');
        const vcName = btn.dataset.id;
        // Gọi hàm mở Modal thêm biến (đã có ở code bài trước)
        openAddMeasureModal(vcName); 
    }

    // [THÊM MỚI] G. Nút "Lưu biến" trong Modal Biến
    if (e.target.closest('#btn-save-v-measure')) {
        saveVirtualMeasure();
    }
    if (e.target.closest('.action-edit-vm')) {
        const btn = e.target.closest('.action-edit-vm');
        openAddMeasureModal(btn.dataset.vc, btn.dataset.name);
    }

    // [THÊM] Nút Xóa biến
    if (e.target.closest('.action-del-vm')) {
        const btn = e.target.closest('.action-del-vm');
        deleteVirtualMeasure(btn.dataset.vc, btn.dataset.name);
    }
    if (e.target.closest('#btn-add-row')) {
        addCalcRow();
    }
    if (e.target.closest('.btn-remove-row')) {
        // Tìm phần tử cha là dòng .calc-row và xóa nó
        const row = e.target.closest('.calc-row');
        if (row) row.remove();
    }
    if (e.target.closest('#btn-save-calc')) {
        saveCalculation();
    }
}


/**
 * 3. LOGIC MODAL & LƯU TẠM
 */
function openVCModal() {
    const modal = document.getElementById('vc-modal-overlay');
    const input = document.getElementById('vc-input-id');
    if (input) input.value = '';
    if (modal) {
        modal.classList.remove('hidden');
        console.log("Modal VC opened");
    } else {
        console.error("Modal 'vc-modal-overlay' not found in HTML");
    }
}

// Lưu tạm vào danh sách chờ
function saveVC() {
    const inputEl = document.getElementById('vc-input-id');
    const nameValue = inputEl.value.trim();

    if (!nameValue) {
        alert("Vui lòng nhập tên!");
        return;
    }

    // Kiểm tra trùng tên
    const isExist = (appData.controllers_config && appData.controllers_config[nameValue]) || 
                    (appData.solarConfigPage?.pending_changes?.[nameValue]);
    
    if (isExist) {
        alert("Tên này đã tồn tại!");
        return;
    }

    // Tạo cấu trúc dữ liệu chuẩn để Backend có thể hiểu và ghi vào .cfg
    const generatedId = "vc_" + Date.now();
    const newVC = {
        "_id": generatedId,
        "name": nameValue,           // Người dùng nhập
        "protocol": "Virtual Controller",
        "enable": 1,
        "args": {
            "statusTimeout": 60
        },
        "desc": nameValue,
        "endpoint": "",
        "samplePeriod": 0,
        "expired": 0,
        "enableDebug": 0,
        "enablepollCycle": 0,
        "samplePeriod2": 60,
        
        "category": "Other", // Trường bổ sung để UI xếp nhóm
        "is_new": true       // Cờ để Backend biết là tạo mới
    };

    // Khởi tạo pending_changes nếu chưa có
    if (!appData.solarConfigPage.pending_changes) {
        appData.solarConfigPage.pending_changes = {};
    }

    // Lưu vào hàng đợi
    appData.solarConfigPage.pending_changes[nameValue] = { 
        state: 'new', 
        data: newVC 
    };

    // Đóng Modal và vẽ lại giao diện
    document.getElementById('vc-modal-overlay').classList.add('hidden');
    renderCalculationWorkbench(); 
    
    // Hiện thanh Apply Bar
    if (typeof updatePendingChangesBar === 'function') {
        updatePendingChangesBar();
    }
    
    console.log("✅ Saved to pending:", newVC);
}

/**
 * 4. RENDER GIAO DIỆN
 */
async function reloadCalculations() {
    try {
        const res = await fetch('/api/calculations');
        appData.calculation_rules = await res.json();
        renderCalculationWorkbench();
    } catch (e) { console.error(e); }
}

function renderCalculationWorkbench() {
    renderVirtualControllersFromCfg();
    renderCalculationStrips();
}

function renderVirtualControllersFromCfg() {
    console.group("🔍 [DEBUG-CALC] Bắt đầu tìm kiếm Virtual Controllers");
    const grid = document.getElementById('vc-card-grid');
    if (!grid) {
        console.error("❌ LỖI: Không tìm thấy phần tử HTML 'vc-card-grid'");
        console.groupEnd();
        return;
    }

    // 1. Kiểm tra nguồn từ Socket (Real-time)
    let socketControllers = Object.values(appData.controllers_config || {});
    console.log("Source 1 (Socket):", socketControllers.length, "thiết bị", socketControllers);

    // 2. Kiểm tra nguồn từ API Solar (Static)
    let apiControllers = appData.solarConfigPage?.current_config?.devices || [];
    console.log("Source 2 (API Solar):", apiControllers.length, "thiết bị", apiControllers);

    // 3. Gộp tất cả lại
    let allRaw = [...socketControllers, ...apiControllers];
    
    // 4. Lọc và Log chi tiết từng thiết bị để xem tại sao nó bị loại
    const filteredVCs = allRaw.filter(c => {
        if (!c) return false;

        // --- BƯỚC FIX: Kiểm tra tên thiết bị ---
        const name = String(c.name || "").trim();
        if (name === "" || name === "N/A") {
            // Nếu tên rỗng thì loại bỏ ngay, không cần kiểm tra tiếp
            return false;
        }

        const proto = String(c.protocol || "").trim();
        
        // Điều kiện 1: Đúng protocol Virtual Controller
        const isVirtualProto = (proto === "Virtual Controller" || proto === "Virtual_Controller");
        // Điều kiện 2: Tên là EVN (Dự phòng)
        const isEVN = (name === "EVN");

        const isMatch = isVirtualProto || isEVN;
        
        console.log(`   👉 Kiểm tra: Name='${name}' | Protocol='${proto}' | Match=${isMatch}`);
        return isMatch;
    });

    // 5. Kiểm tra Pending Changes
    const pendingChanges = appData.solarConfigPage?.pending_changes || {};
    const newVCs = Object.values(pendingChanges)
        .filter(c => c.state === 'new' && (String(c.data.protocol).trim() === "Virtual Controller"))
        .map(c => c.data);
    console.log("Source 3 (Pending):", newVCs.length, "thiết bị");

    // Gộp và khử trùng
    const allVCs = [...filteredVCs, ...newVCs];
    const uniqueVCs = Array.from(new Map(allVCs.map(item => [item.name, item])).values());
    
    console.log("✅ KẾT QUẢ CUỐI CÙNG:", uniqueVCs.length, "bộ Virtual Controller tìm thấy.");
    console.groupEnd();

    if (uniqueVCs.length === 0) {
        grid.innerHTML = `<p style="padding:20px; color:#94a3b8;">Không có bộ Virtual Controller nào (Xem Log F12 để debug).</p>`;
        return;
    }

    // --- PHẦN RENDER DƯỚI ĐÂY GIỮ NGUYÊN ---
    grid.innerHTML = uniqueVCs.map(vc => {
        const isPending = pendingChanges[vc.name]?.state === 'new';
        const measures = getEffectiveMeasures(vc.name);
        
        const measuresRows = measures.map(m => {
            const isNew = m._is_new;
            return `
                <tr class="${isNew ? 'state-new' : ''}">
                    <td style="color: #cbd5e1;">${m.name} ${isNew ? '<small style="color:#4ade80">(Mới)</small>' : ''}</td>
                    <td id="vc-val-${safeId(vc.name)}-${safeId(m.name)}" style="text-align:right; color:#4ade80; font-weight:bold;">--</td>
                    <td style="text-align:right; color:#94a3b8; width:40px;">${m.unit || ''}</td>
                    <td style="text-align:right; width:60px;">
                        <button class="tool-btn edit action-edit-vm" data-vc="${vc.name}" data-name="${m.name}"><i class="bi bi-pencil"></i></button>
                        <button class="tool-btn delete action-del-vm" data-vc="${vc.name}" data-name="${m.name}"><i class="bi bi-trash"></i></button>
                    </td>
                </tr>
            `;
        }).join('');

        return `
            <div class="edit-card ${isPending ? 'state-new' : ''}" 
                 style="border-left: 4px solid ${isPending ? '#22c55e' : '#a5b4fc'};">
                <div class="edit-card-header">
                    <h4><i class="bi bi-cpu-fill"></i> ${vc.name}</h4>
                    <div class="card-actions">
                        <button class="edit-icon action-add-vm" data-id="${vc.name}" title="Thêm biến đo">
                            <i class="bi bi-plus-circle"></i>
                        </button>
                    </div>
                </div>
                <div class="edit-card-body">
                    <table class="mini-monitor-table">
                        <tbody>
                            ${measuresRows || '<tr><td colspan="4" style="text-align:center; color:#64748b;">Chưa có biến đo</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>`;
    }).join('');
}

function renderCalculationStrips() {
    const container = document.getElementById('calc-card-grid');
    if (!container) return;
    const rules = appData.calculation_rules || [];

    // Cấu hình container trải dài
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "15px";
    container.style.width = "100%";

    if (rules.length === 0) {
        container.innerHTML = `<p style="text-align:center; padding:20px; color:#64748b;">Chưa có phép tính cộng dồn.</p>`;
        return;
    }

    container.innerHTML = rules.map(rule => {
        // --- PHẦN 1: XỬ LÝ HIỂN THỊ GIÁ TRỊ TÙY THEO LOẠI PHÉP TÍNH ---
        let valueDisplayHtml = `<span id="calc-val-${safeId(rule.id)}" style="font-size:1.6rem; font-weight:bold; color:#4ade80;">--</span>`;
        
        const currentVal = appData.realtime_values["Calculations"]?.[rule.id]?.value;

        if (rule.operation === 'manual_status') {
            // Hiển thị nút gạt (Toggle)
            const isChecked = currentVal === 1;
            valueDisplayHtml = `
                <label class="toggle-switch" style="transform: scale(1.1); transform-origin: left;">
                    <input type="checkbox" class="manual-status-toggle" data-id="${rule.id}" ${isChecked ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            `;
        } else if (rule.operation === 'constant') {
            // Hiển thị ô nhập số (Input)
            const displayVal = currentVal !== undefined ? currentVal : (rule.constant_value || 0);
            valueDisplayHtml = `
                <input type="number" 
                       class="calc-manual-input" 
                       data-id="${rule.id}" 
                       value="${displayVal}" 
                       step="any"
                       style="width: 120px; background: #1e293b; color: #4ade80; border: 1px solid #475569; border-radius: 6px; padding: 5px 10px; font-weight: bold; font-size: 1.4rem; font-family: 'Consolas', monospace;">
            `;
        }

        // --- PHẦN 2: HIỂN THỊ CÁC THÀNH PHẦN ĐẦU VÀO (CHIPS) ---
        const items = (rule.items || []).map(item => `
            <div class="source-chip" id="chip-${safeId(rule.id)}-${safeId(item.device)}-${safeId(item.measure)}" 
                 style="background:#1e293b; border:1px solid #475569; padding:5px 10px; border-radius:4px; display:flex; gap:10px; font-size:0.85rem;">
                <span style="color:#94a3b8; border-right:1px solid #475569; padding-right:8px;">${item.device}:${item.measure}</span>
                <span id="src-val-${safeId(rule.id)}-${safeId(item.device)}-${safeId(item.measure)}" style="color:#e2e8f0; font-weight:bold;">--</span>
            </div>
        `).join('');

        // --- PHẦN 3: RENDER DÒNG (ROW) ---
        return `
            <div class="calc-matrix-row" style="display:grid; grid-template-columns: 320px 1fr 60px; background:#334155; border:1px solid #475569; border-radius:8px; width:100%; overflow:hidden;">
                <!-- Cột trái: Tên & Giá trị/Điều khiển -->
                <div style="background:#1e293b; padding:15px; border-right:1px solid #475569; display: flex; flex-direction: column; justify-content: center;">
                    <div style="font-size:0.85rem; color:#a5b4fc; font-weight:600; margin-bottom: 5px;">${rule.name}</div>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        ${valueDisplayHtml}
                        <span style="color:#94a3b8; font-size:0.9rem;">${rule.unit || ''}</span>
                    </div>
                    <!-- [MỚI] Hiển thị ID nhỏ bên dưới để dễ nhận biết -->
                    <div style="font-size: 0.75rem; color: #64748b; margin-top: 4px;">ID: ${rule.id}</div>
                </div>
                <!-- Cột giữa: Các chip nguồn (Nếu có) -->
                <div style="padding:15px; display:flex; flex-wrap:wrap; gap:10px; align-items:center; background:#293548;">
                    ${items || '<span style="color: #64748b; font-style: italic; font-size: 0.8rem;">(Giá trị tĩnh / Thủ công)</span>'}
                </div>
                <!-- Cột phải: Nút Công cụ -->
                <div style="display:flex; flex-direction: column; align-items:center; justify-content:center; gap: 10px; background:#1e293b;">
                    
                    <!-- [MỚI] NÚT SỬA -->
                    <button class="tool-btn edit action-edit-calc" data-id="${rule.id}" style="color:#f59e0b; background:none; border:none; cursor:pointer; font-size:1.2rem;">
                        <i class="bi bi-pencil-square"></i>
                    </button>

                    <button class="tool-btn delete action-delete-calc" data-id="${rule.id}" style="color:#ef4444; background:none; border:none; cursor:pointer; font-size:1.2rem;">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>`;
    }).join('');
}

/**
 * 5. LOGIC PHÉP TÍNH (CALCULATION MODAL)
 * @param {Object|null} editData - Nếu có dữ liệu, chế độ Sửa. Nếu null, chế độ Thêm mới.
 */
function openCalcModal(editData = null) {
    const nameInput = document.getElementById('calc-output-name');
    const idInput = document.getElementById('calc-output-id');
    const unitInput = document.getElementById('calc-output-unit');
    const opSelect = document.getElementById('calc-input-operation');
    const modalTitle = document.querySelector('#calc-modal-overlay h3');
    const btnSave = document.getElementById('btn-save-calc');

    // Các trường nâng cao
    const constInput = document.getElementById('calc-constant-value');
    const factorInput = document.getElementById('calc-scaling-factor');
    const offsetInput = document.getElementById('calc-scaling-offset');

    // --- CẬP NHẬT DROPDOWN OPERATION ---
    if (opSelect) {
        // (Giữ nguyên phần innerHTML của optgroup...)
        opSelect.innerHTML = `
            <optgroup label="Thống kê & Gộp">
                <option value="sum">Cộng dồn (SUM)</option>
                <option value="avg">Trung bình cộng (AVG)</option>
                <option value="sub">Phép trừ (SUB: Số đầu trừ các số sau)</option>
            </optgroup>
            <optgroup label="Giá trị thủ công">
                <option value="constant">Hằng số cố định (Constant)</option>
                <option value="manual_status">Công tắc trạng thái (Toggle 0/1)</option>
            </optgroup>
            <optgroup label="Thống kê thời gian">
                <option value="max_daily">Giá trị Max trong ngày (MAX Daily)</option>
                <option value="min_daily">Giá trị Min trong ngày (MIN Daily)</option>
                <option value="max_yesterday">Max hôm qua (Đã chốt sổ)</option>
                <option value="min_yesterday">Min hôm qua (Đã chốt sổ)</option>
            </optgroup>
        `;
    }

    const rowsContainer = document.getElementById('calc-rows-container');
    if (rowsContainer) rowsContainer.innerHTML = '';

    // --- LOGIC PHÂN BIỆT THÊM / SỬA ---
    if (editData) {
        // CHẾ ĐỘ SỬA
        modalTitle.textContent = `Sửa phép tính: ${editData.id}`;
        btnSave.textContent = "Cập nhật";
        
        // Điền dữ liệu cơ bản
        idInput.value = editData.id;
        idInput.disabled = true; // Không cho sửa ID để tránh tạo trùng/lỗi
        idInput.style.backgroundColor = "#334155";
        
        nameInput.value = editData.name || '';
        unitInput.value = editData.unit || '';
        opSelect.value = editData.operation || 'sum';

        // Điền dữ liệu nâng cao
        if(constInput) constInput.value = editData.constant_value ?? 0;
        if(factorInput) factorInput.value = editData.scaling_factor ?? 1;
        if(offsetInput) offsetInput.value = editData.scaling_offset ?? 0;

        // Kích hoạt sự kiện onchange để ẩn hiện các vùng nhập liệu phù hợp
        if (typeof opSelect.onchange === 'function') opSelect.onchange();

        // Điền các dòng Input Items
        if (editData.items && Array.isArray(editData.items) && editData.items.length > 0) {
            editData.items.forEach(item => {
                addCalcRow(item); // Truyền item vào để fill sẵn
            });
        } else {
            // Nếu phép tính dạng Constant/Manual thì không cần row, 
            // nhưng nếu là SUM mà chưa có row nào (lỗi data cũ) thì thêm 1 dòng trống
            if (['sum', 'avg', 'sub', 'min_daily', 'max_daily'].includes(editData.operation)) {
                addCalcRow();
            }
        }

    } else {
        // CHẾ ĐỘ THÊM MỚI
        modalTitle.textContent = "Cấu hình Phép tính & Hằng số";
        btnSave.textContent = "Lưu Phép tính";

        idInput.value = '';
        idInput.disabled = false;
        idInput.style.backgroundColor = "";
        
        nameInput.value = '';
        unitInput.value = '';
        opSelect.value = 'sum';
        
        if(constInput) constInput.value = 0;
        if(factorInput) factorInput.value = 1;
        if(offsetInput) offsetInput.value = 0;

        if (typeof opSelect.onchange === 'function') opSelect.onchange();
        
        // Thêm 1 dòng trống mặc định
        addCalcRow(); 
    }
    
    document.getElementById('calc-modal-overlay').classList.remove('hidden');
}


function addCalcRow(initialData = null) {
    const container = document.getElementById('calc-rows-container');
    const row = document.createElement('div');
    row.className = 'calc-row';
    row.style.cssText = 'display:grid; grid-template-columns: 1fr 1fr 40px; gap:10px; margin-bottom:10px; align-items: center;';

    // Lấy danh sách thiết bị + [Calculations]
    const controllers = Object.values(appData.controllers_config || {});
    let devOpts = `<option value="">-- Chọn Thiết Bị --</option>`;
    devOpts += `<option value="Calculations" style="color:#a5b4fc; font-weight:bold;">[ Phép tính khác ]</option>`;
    devOpts += controllers.map(c => `<option value="${c.name}">${c.name}</option>`).join('');

    row.innerHTML = `
        <select class="modal-input sel-device">${devOpts}</select>
        <select class="modal-input sel-measure" disabled><option value="">-- Chọn Biến --</option></select>
        <button type="button" class="btn-remove-row" style="color:#ef4444; background:none; border:none; cursor:pointer; font-size: 1.2rem;">
            <i class="bi bi-x-circle-fill"></i>
        </button>
    `;

    const selDev = row.querySelector('.sel-device');
    const selMeas = row.querySelector('.sel-measure');

    // Hàm tạo option cho Select Measure
    const populateMeasures = (devName, selectedMeasure = null) => {
        if (!devName) {
            selMeas.innerHTML = `<option value="">-- Chọn Biến --</option>`;
            selMeas.disabled = true;
            return;
        }

        let measures = [];
        if (devName === "Calculations") {
            // Lấy danh sách ID các phép tính hiện có
            // Lưu ý: Cần lọc bỏ chính phép tính đang sửa (nếu có) để tránh vòng lặp, 
            // nhưng ở đây làm đơn giản trước.
            measures = (appData.calculation_rules || []).map(r => ({ name: r.id, unit: r.unit }));
        } else {
            measures = (appData.measures_list || []).filter(m => m.ctrlName === devName);
        }

        if (measures.length > 0) {
            selMeas.innerHTML = `<option value="">-- Chọn Biến --</option>` + 
                measures.map(m => {
                    const isSelected = (selectedMeasure && m.name === selectedMeasure) ? 'selected' : '';
                    return `<option value="${m.name}" ${isSelected}>${m.name} (${m.unit || ''})</option>`;
                }).join('');
            selMeas.disabled = false;
        } else {
            selMeas.innerHTML = `<option value="">(Không có dữ liệu)</option>`;
            selMeas.disabled = true;
        }
    };

    // Sự kiện change
    selDev.onchange = () => {
        populateMeasures(selDev.value);
    };

    // --- LOGIC ĐIỀN DỮ LIỆU CŨ ---
    if (initialData) {
        selDev.value = initialData.device;
        // Gọi hàm populate ngay lập tức để điền select thứ 2
        populateMeasures(initialData.device, initialData.measure);
    }

    container.appendChild(row);
}
async function saveCalculation() {
    // 1. Lấy dữ liệu cơ bản
    const measId = document.getElementById('calc-output-id').value.trim();
    const name = document.getElementById('calc-output-name').value.trim();
    const unit = document.getElementById('calc-output-unit').value.trim();
    const operation = document.getElementById('calc-input-operation').value;

    // 2. Lấy dữ liệu nâng cao (Scaling & Constants)
    const constantValue = parseFloat(document.getElementById('calc-constant-value').value) || 0;
    const scalingFactor = parseFloat(document.getElementById('calc-scaling-factor').value) || 1.0;
    const scalingOffset = parseFloat(document.getElementById('calc-scaling-offset').value) || 0.0;

    if (!measId || !name) return alert("Vui lòng nhập Mã (ID) và Tên phép tính.");

    // 3. Gom nhóm các thành phần đầu vào (Chỉ khi không phải loại tĩnh)
    const items = [];
    if (operation !== 'constant' && operation !== 'manual_status') {
        document.querySelectorAll('.calc-row').forEach(row => {
            const device = row.querySelector('.sel-device').value;
            const measure = row.querySelector('.sel-measure').value;
            if (device && measure) {
                items.push({ device, measure });
            }
        });

        if (items.length === 0) {
            return alert("Vui lòng chọn ít nhất 1 biến đầu vào cho loại phép tính này.");
        }
    }

    // 4. Tạo Payload đầy đủ các trường mà Backend mới mong đợi
    const payload = {
        id: measId, 
        name: name,
        unit: unit,
        operation: operation,
        constant_value: constantValue,
        scaling_factor: scalingFactor,
        scaling_offset: scalingOffset,
        items: items
    };

    // 5. Gửi API lưu vào calculations.json
    try {
        const response = await fetch('/api/calculations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        if (result.status === "error") throw new Error(result.message);

        // 6. Dọn dẹp và Reload giao diện
        document.getElementById('calc-modal-overlay').classList.add('hidden');
        await reloadCalculations();
        
        alert(`Đã lưu thành công: ${name}`);

    } catch (e) {
        console.error(e);
        alert("Lỗi khi lưu phép tính: " + e.message);
    }
}
function autoCreateLinkedMeasure(vcName, measId, name, unit) {
    if (!appData.solarConfigPage.pending_changes) {
        appData.solarConfigPage.pending_changes = {};
    }
    
    // Khởi tạo pending struct nếu chưa có
    if (!appData.solarConfigPage.pending_changes[vcName]) {
        const isNew = !appData.controllers_config[vcName]; // Check xem VC này mới hay cũ
        appData.solarConfigPage.pending_changes[vcName] = { 
            state: isNew ? 'new' : 'modified', 
            data: { original_name: vcName },
            measures_to_add: [] 
        };
    }
    
    const pending = appData.solarConfigPage.pending_changes[vcName];
    if(!pending.measures_to_add) pending.measures_to_add = [];

    // Check xem biến đã tồn tại chưa
    const exists = getEffectiveMeasures(vcName).some(m => m.name === measId);
    if (!exists) {
        pending.measures_to_add.push({
            "name": measId, // Dùng ID làm tên biến cho khớp
            "ctrlName": vcName,
            "group": "default",
            "uploadType": "periodic",
            "dataType": "FLOAT",
            "addr": "",
            "enableRequestCount": 0,
            "decimal": 2,
            "readWrite": "ro",
            "unit": unit,
            "desc": name,
            "storageLwTSDB": 0,
            "transformType": 0,
            "calculation_id": `${vcName}:${measId}`, // Tự động link
            "_is_new": true
        });
        
        // Cập nhật UI
        renderCalculationWorkbench();
        if(typeof updatePendingChangesBar === 'function') updatePendingChangesBar();
        console.log(`✅ Đã tự động tạo biến ảo ${measId} liên kết với phép tính.`);
    }
}

async function deleteCalculation(id) {
    if (!confirm(`Xóa phép tính: ${id}?`)) return;
    await fetch('/api/calculations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    });
    await reloadCalculations();
}

/**
 * 6. GÁN SỰ KIỆN TĨNH (Phụ trợ)
 */
function attachStaticListeners() {
    // Nút mở Modal thêm phép tính mới
    const addCalcBtn = document.querySelector('.action-add-calc');
    if (addCalcBtn) addCalcBtn.onclick = openCalcModal;

    // Nút Lưu trong Modal Phép tính
    const btnSaveCalc = document.getElementById('btn-save-calc');
    if (btnSaveCalc) btnSaveCalc.onclick = saveCalculation;

    const btnAddRow = document.getElementById('btn-add-row');
    if (btnAddRow) btnAddRow.onclick = () => addCalcRow();

    // Nút Đóng các Modal
    document.querySelectorAll('[data-action="close-calc-modal"]').forEach(b => {
        b.onclick = () => document.getElementById('calc-modal-overlay').classList.add('hidden');
    });
    
    // Nút Lưu VC (Gán thêm ở đây cho chắc chắn nếu delegation fail)
    const btnSaveVC = document.getElementById('btn-save-vc');
    if (btnSaveVC) {
        btnSaveVC.onclick = saveVC;
    }
}

/**
 * 7. CẬP NHẬT REAL-TIME
 */
function updateCalculationPage() {
    const rtData = appData.realtime_values || {};
    const calcData = rtData["Calculations"] || {};
    const rules = appData.calculation_rules || [];

    // Cập nhật giá trị dải phép tính
    rules.forEach(rule => {
        const totalEl = document.getElementById(`calc-val-${safeId(rule.id)}`);
        if (totalEl && calcData[rule.id]) {
            totalEl.textContent = calcData[rule.id].value.toFixed(2);
        }

        rule.items.forEach(item => {
            const el = document.getElementById(`src-val-${safeId(rule.id)}-${safeId(item.device)}-${safeId(item.measure)}`);
            const valObj = rtData[item.device]?.[item.measure];
            if (el && valObj) el.textContent = valObj.value.toFixed(2);
        });
    });

    // Cập nhật giá trị Virtual Controller (Các biến trong CFG)
    const vcs = Object.values(appData.controllers_config || {}).filter(c => c.protocol === "Virtual Controller");
    vcs.forEach(vc => {
        const measures = (appData.measures_list || []).filter(m => m.ctrlName === vc.name);
        measures.forEach(m => {
            const el = document.getElementById(`vc-val-${safeId(vc.name)}-${safeId(m.name)}`);
            const valObj = rtData[vc.name]?.[m.name];
            if (el && valObj) el.textContent = valObj.value.toFixed(2);
        });
    });
    document.querySelectorAll('.manual-status-toggle').forEach(toggle => {
        const id = toggle.dataset.id;
        if (calcData[id] !== undefined) {
            const backendVal = calcData[id].value;
            // Chỉ cập nhật nếu trạng thái hiện tại khác với Backend
            // (để tránh làm gián đoạn lúc người dùng đang bấm)
            const isChecked = backendVal === 1;
            if (toggle.checked !== isChecked && !toggle.matches(':focus')) {
                toggle.checked = isChecked;
            }
        }
    });

    // 3. Cập nhật các ô nhập số (Constant)
    document.querySelectorAll('.calc-manual-input').forEach(input => {
        const id = input.dataset.id;
        if (calcData[id] !== undefined && !input.matches(':focus')) {
            input.value = calcData[id].value;
        }
    });
}
function getEffectiveMeasures(vcName) {
    // 1. Lấy biến gốc từ appData
    let measures = (appData.measures_list || [])
        .filter(m => m.ctrlName === vcName)
        .map(m => ({...m}));
    
    // 2. Kiểm tra Pending Changes
    const pending = appData.solarConfigPage?.pending_changes?.[vcName];
    if (pending) {
        // Loại bỏ các biến đang chờ xóa
        if (pending.measures_to_remove) {
            const removeSet = new Set(pending.measures_to_remove);
            // Với biến ảo, xóa theo Name (vì addr rỗng)
            measures = measures.filter(m => !removeSet.has(m.name));
        }
        
        // Thêm các biến mới (Add)
        if (pending.measures_to_add) {
            const newMeasures = pending.measures_to_add.map(m => ({...m, _is_new: true}));
            measures = [...measures, ...newMeasures];
        }
    }
    
    // Sắp xếp theo tên
    return measures.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Mở Modal thêm/sửa biến
 */
function openAddMeasureModal(vcName, measureName = null) {
    // ... (Code cũ giữ nguyên) ...
    document.getElementById('vm-target-vc-id').value = vcName;
    const title = document.getElementById('vm-modal-title');
    const addrInput = document.getElementById('vm-input-addr');
    if(addrInput) { addrInput.value = "(Tự động)"; addrInput.disabled = true; }

    // [THÊM] Nạp danh sách phép tính vào Dropdown
    const calcSelect = document.getElementById('vm-input-calc-link');
    if (calcSelect) {
        let opts = `<option value="">-- Không liên kết (Static) --</option>`;
        (appData.calculation_rules || []).forEach(rule => {
            opts += `<option value="${rule.id}">Kết quả: ${rule.name} (${rule.id})</option>`;
        });
        calcSelect.innerHTML = opts;
    }

    if (measureName) {
        // --- CHẾ ĐỘ SỬA ---
        title.textContent = `Sửa biến: ${measureName}`;
        const measures = getEffectiveMeasures(vcName);
        const m = measures.find(x => x.name === measureName);
        
        if (m) {
            document.getElementById('vm-input-name').value = m.name;
            document.getElementById('vm-input-unit').value = m.unit || '';
            document.getElementById('vm-input-datatype').value = m.dataType || 'FLOAT';
            document.getElementById('vm-target-addr').value = m.name;
            
            // [THÊM] Load giá trị link cũ
            if (calcSelect) calcSelect.value = m.calculation_id || ""; 
        }
    } else {
        // --- CHẾ ĐỘ THÊM MỚI ---
        title.textContent = `Thêm biến mới cho ${vcName}`;
        document.getElementById('vm-input-name').value = '';
        document.getElementById('vm-input-unit').value = '';
        document.getElementById('vm-input-datatype').value = 'FLOAT';
        document.getElementById('vm-target-addr').value = '';
        
        // [THÊM] Reset link
        if (calcSelect) calcSelect.value = "";
    }
    
    document.getElementById('v-measure-modal-overlay').classList.remove('hidden');
}

/**
 * Lưu biến vào danh sách chờ (Pending Changes)
 */
function saveVirtualMeasure() {
    const vcName = document.getElementById('vm-target-vc-id').value;
    const name = document.getElementById('vm-input-name').value.trim();
    const unit = document.getElementById('vm-input-unit').value.trim();
    const dtype = document.getElementById('vm-input-datatype').value;
    const targetName = document.getElementById('vm-target-addr').value;
    const calcLink = document.getElementById('vm-input-calc-link').value;  // Tên cũ nếu đang sửa

    if (!name) return alert("Vui lòng nhập tên biến!");
    
    // Validate tên biến (chỉ chữ, số, gạch dưới)
    if (!/^[a-zA-Z0-9_:]+$/.test(name)) {
        return alert("Tên biến không hợp lệ (không dấu, không khoảng trắng).");
    }

    // Khởi tạo cấu trúc pending nếu chưa có
    if (!appData.solarConfigPage.pending_changes[vcName]) {
        // Nếu VC này đã có sẵn (không phải mới tạo), khởi tạo struct modified
        const isNewVC = appData.solarConfigPage.pending_changes[vcName]?.state === 'new';
        if (!isNewVC) {
            appData.solarConfigPage.pending_changes[vcName] = { 
                state: 'modified', 
                data: { original_name: vcName },
                measures_to_add: [], measures_to_remove: [], measures_to_modify: {} 
            };
        }
    }
    
    const pending = appData.solarConfigPage.pending_changes[vcName];
    if(!pending.measures_to_add) pending.measures_to_add = [];
    if(!pending.measures_to_remove) pending.measures_to_remove = [];

    // Check trùng tên
    const measures = getEffectiveMeasures(vcName);
    // Nếu thêm mới hoặc đổi tên, phải check xem tên mới đã tồn tại chưa
    if ((!targetName || targetName !== name) && measures.some(m => m.name === name)) {
        return alert("Tên biến này đã tồn tại!");
    }

    // --- LOGIC LƯU ---
    if (targetName) {
        // EDIT: Xóa cũ thêm mới
        const existingNewIdx = pending.measures_to_add.findIndex(m => m.name === targetName);
        if (existingNewIdx !== -1) {
            pending.measures_to_add.splice(existingNewIdx, 1);
        } else {
            pending.measures_to_remove.push(targetName);
        }
    }

    // ADD: Thêm object biến mới
    const newMeasure = {
        "name": name,
        "ctrlName": vcName,
        "group": "default",
        "uploadType": "periodic",
        "dataType": dtype,
        "addr": "", 
        "enableRequestCount": 0,
        "decimal": 2,
        "readWrite": "ro",
        "unit": unit,
        "desc": "",
        "storageLwTSDB": 0,
        "transformType": 0,
        
        "calculation_id": calcLink, // [QUAN TRỌNG] Lưu ID phép tính vào đây
        
        "_is_new": true
    };
    pending.measures_to_add.push(newMeasure);

    document.getElementById('v-measure-modal-overlay').classList.add('hidden');
    renderCalculationWorkbench(); // Vẽ lại giao diện
    if(typeof updatePendingChangesBar === 'function') updatePendingChangesBar();
}

/**
 * Xóa biến ảo
 */
function deleteVirtualMeasure(vcName, measureName) {
    if (!confirm(`Xóa biến "${measureName}"?`)) return;

    // Khởi tạo pending
    if (!appData.solarConfigPage.pending_changes[vcName]) {
        appData.solarConfigPage.pending_changes[vcName] = { 
            state: 'modified', 
            data: { original_name: vcName },
            measures_to_add: [], measures_to_remove: []
        };
    }
    const pending = appData.solarConfigPage.pending_changes[vcName];
    if(!pending.measures_to_remove) pending.measures_to_remove = [];
    if(!pending.measures_to_add) pending.measures_to_add = [];

    // 1. Nếu xóa biến vừa thêm (chưa lưu vào DB) -> Xóa khỏi mảng add
    const newIdx = pending.measures_to_add.findIndex(m => m.name === measureName);
    if (newIdx !== -1) {
        pending.measures_to_add.splice(newIdx, 1);
    } else {
        // 2. Nếu xóa biến cũ -> Đẩy vào remove
        pending.measures_to_remove.push(measureName);
    }

    renderCalculationWorkbench();
    if(typeof updatePendingChangesBar === 'function') updatePendingChangesBar();
}
// Đăng ký với hệ thống
pageInitFunctions['calculation-page'] = initCalculationPage;
pageRenderFunctions['calculation-page'] = updateCalculationPage;