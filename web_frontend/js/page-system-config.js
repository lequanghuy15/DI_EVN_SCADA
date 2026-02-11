/**
 * js/page-system-config.js
 * Quản lý hiển thị và cấu hình các cổng giao tiếp (COM Ports)
 */

import * as api from './apiService.js';
import { appData, pageInitFunctions, pageRenderFunctions ,updatePendingChangesBar, applyGlobalChanges} from './main.js';

// --- HẰNG SỐ CẤU HÌNH ---
const COMS_PORTS = [
    { name: 'rs232', label: 'Cổng RS-232' },
    { name: 'rs485', label: 'Cổng RS-485' }
];

const BAUD_OPTIONS = [9600, 19200, 38400, 57600, 115200];
const BITS_OPTIONS = [7, 8];
const STOPBITS_OPTIONS = [1, 2];
const PARITY_OPTIONS = [
    { value: 'n', label: 'None (n)' }, 
    { value: 'e', label: 'Even (e)' },
    { value: 'o', label: 'Odd (o)' }
];

// --- HÀM KHỞI TẠO (INIT) ---
async function initSystemPage() {
    console.log("[System] Initializing System Page...");
    const container = document.getElementById('system-coms-workbench');
    if (!container) return;
    
    container.innerHTML = `<p style="text-align: center; color: #94a3b8;">Đang tải cấu hình cổng COM...</p>`;

    // Reset pending changes khi load lại trang
    appData.system_coms_pending_changes = {};
    updateGlobalBarVisibility(); // Ẩn thanh apply nếu có

    try {
        // 1. Gọi API lấy cấu hình
        const response = await api.getSystemComsConfig();
        
        // 2. Lưu vào AppData
        // API trả về: { status: "success", coms: [...] }
        appData.system_coms_config = response.coms || [];
        
        console.log("[System] Loaded config:", appData.system_coms_config);

        // 3. Render giao diện
        renderSystemPage();

    } catch (error) {
        console.error("[System] Init error:", error);
        container.innerHTML = `<p style="text-align: center; color: #ef4444;">Lỗi tải dữ liệu: ${error.message}</p>`;
    }
}

// --- HÀM RENDER CHÍNH ---
function renderSystemPage() {
    const workbench = document.getElementById('system-coms-workbench');
    if (!workbench) return;
    
    let html = '';

    // Duyệt qua danh sách các cổng định sẵn (RS232, RS485)
    COMS_PORTS.forEach(portDef => {
        // Tìm cấu hình hiện tại trong appData (hoặc dùng mặc định nếu chưa có)
        let config = appData.system_coms_config.find(c => c.name === portDef.name);
        
        // Nếu API chưa trả về cấu hình cho cổng này, tạo mặc định
        if (!config) {
            config = { name: portDef.name, baud: 9600, bits: 8, stopbits: 1, parityChk: 'n' };
        }

        // Kiểm tra xem có đang bị sửa đổi (pending) không?
        const pendingConfig = appData.system_coms_pending_changes[portDef.name];
        
        // Dữ liệu dùng để hiển thị (Ưu tiên Pending > Gốc)
        const displayConfig = pendingConfig || config;
        const isModified = !!pendingConfig;

        html += generateComsCard(portDef.label, displayConfig, isModified);
    });
    
    workbench.innerHTML = html;
    attachComsListeners();
}

// --- HÀM SINH HTML THẺ CARD ---
function generateComsCard(label, config, isModified) {
    const stateClass = isModified ? 'state-modified state-editing' : 'state-editing';
    const modifiedLabel = isModified ? `<span style="font-size:0.7em; color:#f59e0b; margin-left:10px;">(Đã sửa - Chờ áp dụng)</span>` : '';

    return `
        <div class="edit-card ${stateClass}" data-port-name="${config.name}">
            <div class="edit-card-header">
                <h4>
                    <i class="bi bi-usb-symbol"></i> 
                    <span class="card-title">${label}</span>
                    ${modifiedLabel}
                </h4>
            </div>
            
            <div class="edit-card-body" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                <!-- Baudrate -->
                <div class="form-group">
                    <label>Baud Rate</label>
                    <select class="edit-mode" data-field="baud">
                        ${generateOptions(BAUD_OPTIONS, config.baud)}
                    </select>
                </div>

                <!-- Data Bits -->
                <div class="form-group">
                    <label>Data Bits</label>
                    <select class="edit-mode" data-field="bits">
                        ${generateOptions(BITS_OPTIONS, config.bits)}
                    </select>
                </div>

                <!-- Stop Bits -->
                <div class="form-group">
                    <label>Stop Bits</label>
                    <select class="edit-mode" data-field="stopbits">
                        ${generateOptions(STOPBITS_OPTIONS, config.stopbits)}
                    </select>
                </div>

                <!-- Parity -->
                <div class="form-group">
                    <label>Parity</label>
                    <select class="edit-mode" data-field="parityChk">
                        ${PARITY_OPTIONS.map(opt => 
                            `<option value="${opt.value}" ${String(config.parityChk) === String(opt.value) ? 'selected' : ''}>${opt.label}</option>`
                        ).join('')}
                    </select>
                </div>
            </div>

            <div class="edit-card-footer">
                <button class="btn btn-secondary action-reset">Hủy bỏ</button>
                <button class="btn btn-primary action-save-local">Lưu tạm</button>
            </div>
        </div>
    `;
}

// Helper sinh options cho select
function generateOptions(optionsArray, currentValue) {
    return optionsArray.map(val => 
        `<option value="${val}" ${String(val) === String(currentValue) ? 'selected' : ''}>${val}</option>`
    ).join('');
}

// --- XỬ LÝ SỰ KIỆN ---
function attachComsListeners() {
    const workbench = document.getElementById('system-coms-workbench');
    
    // Nút LƯU TẠM
    workbench.querySelectorAll('.action-save-local').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const card = e.target.closest('.edit-card');
            const portName = card.dataset.portName;

            // Thu thập dữ liệu từ form
            const newConfig = {
                name: portName,
                baud: parseInt(card.querySelector('[data-field="baud"]').value),
                bits: parseInt(card.querySelector('[data-field="bits"]').value),
                stopbits: parseInt(card.querySelector('[data-field="stopbits"]').value),
                parityChk: card.querySelector('[data-field="parityChk"]').value
            };

            // So sánh với config gốc để xem có thực sự thay đổi không
            const originalConfig = appData.system_coms_config.find(c => c.name === portName);
            
            // Logic so sánh đơn giản (JSON stringify)
            // Lưu ý: Cần đảm bảo thứ tự key hoặc so sánh từng field nếu muốn chính xác tuyệt đối
            // Ở đây ta giả định cấu trúc object giống nhau
            const isDifferent = JSON.stringify(newConfig) !== JSON.stringify(originalConfig);

            if (isDifferent) {
                // Lưu vào pending changes
                appData.system_coms_pending_changes[portName] = newConfig;
            } else {
                // Nếu giống hệt gốc thì xóa khỏi pending (coi như hủy thay đổi)
                delete appData.system_coms_pending_changes[portName];
            }

            // Render lại để cập nhật trạng thái UI (viền vàng, text thay đổi)
            renderSystemPage();
            updateGlobalBarVisibility();
        });
    });

    // Nút HỦY BỎ
    workbench.querySelectorAll('.action-reset').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const card = e.target.closest('.edit-card');
            const portName = card.dataset.portName;

            // Xóa khỏi pending changes
            delete appData.system_coms_pending_changes[portName];

            // Render lại về trạng thái gốc
            renderSystemPage();
            updateGlobalBarVisibility();
        });
    });
}

// --- CẬP NHẬT THANH APPLY TOÀN CỤC ---
// Hàm này tạm thời kiểm tra cả System và Solar (cần tích hợp logic Solar vào đây sau này)
function updateGlobalBarVisibility() {
    const bar = document.getElementById('global-apply-bar');
    const countSpan = document.getElementById('change-count');
    
    // Đếm thay đổi từ System
    const sysCount = Object.keys(appData.system_coms_pending_changes).length;
    
    // Đếm thay đổi từ Solar (Lấy từ appData nếu có)
    const solarCount = appData.solarConfigPage?.pending_changes ? Object.keys(appData.solarConfigPage.pending_changes).length : 0;

    const totalCount = sysCount + solarCount;

    if (countSpan) countSpan.textContent = totalCount;
    
    if (bar) {
        if (totalCount > 0) {
            bar.classList.add('visible');
        } else {
            bar.classList.remove('visible');
        }
    }
}

// --- ĐĂNG KÝ VỚI MAIN.JS ---
document.addEventListener('DOMContentLoaded', () => {
    pageInitFunctions['system-page'] = initSystemPage;
    //pageRenderFunctions['system-page'] = renderSystemPage;
});