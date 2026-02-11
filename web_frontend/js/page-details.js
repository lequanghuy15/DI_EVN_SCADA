/**
 * Tệp page-details.js: Logic cho trang Chi tiết
 * - Quản lý biểu đồ tùy chọn.
 * - Xử lý việc chọn controller và các biến.
 * - Render danh sách checkbox.
 */
import { appData, CHART_MAX_DATA_POINTS, CHART_COLORS, pageInitFunctions, pageRenderFunctions, getMeasureAlias, getUnit } from './main.js';
let customVariableChart;


function initDetailPage() {
    const chartCanvas = document.getElementById('custom-variable-chart');
    if (chartCanvas && !customVariableChart) {
        customVariableChart = new Chart(chartCanvas.getContext('2d'), {
            type: 'line', data: { labels: [], datasets: [] },
            options: {
                responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
                scales: {
                    x: { type: 'time', time: { unit: 'minute', tooltipFormat: 'dd/MM/yyyy HH:mm:ss' }, title: { display: true, text: 'Thời gian' } },
                    y: { title: { display: true, text: 'Giá trị' }, beginAtZero: true }
                },
                plugins: { legend: { position: 'top', labels: { usePointStyle: true } }, tooltip: { mode: 'index', intersect: false } }
            }
        });
    }

    document.getElementById('controller-select-detail').addEventListener('change', (e) => {
        appData.detailsPage.selectedController = e.target.value;
        appData.detailsPage.selectedVariables = {};
        clearCustomChartData();
        renderDetailPage();
    });

    document.getElementById('clear-chart-data-btn').addEventListener('click', clearCustomChartData);
}

function renderDetailPage() {
    populateControllerDropdowns();
    generateVariableCheckboxes();
    updateCustomChart();
}

function populateControllerDropdowns() {
    const select = document.getElementById('controller-select-detail');
    const currentVal = appData.detailsPage.selectedController;
    select.innerHTML = '<option value="All">Tất cả Controllers</option>';
    Object.keys(appData.controllers_config).sort().forEach(ctrlName => {
        select.innerHTML += `<option value="${ctrlName}">${appData.controllers_config[ctrlName].name}</option>`;
    });
    select.value = currentVal;
}

function generateVariableCheckboxes() {
    const container = document.getElementById('variable-checkbox-list');
    let checkboxHTML = '';
    const selectedController = appData.detailsPage.selectedController;
    
    Object.keys(appData.measures_config).sort().forEach(measureName => {
        const config = appData.measures_config[measureName];
        if (selectedController === 'All' || config.ctrlName === selectedController) {
            const isChecked = appData.detailsPage.selectedVariables[measureName] ? 'checked' : '';
            checkboxHTML += `
                <div class="checkbox-item">
                    <input type="checkbox" id="chart-var-${measureName}" value="${measureName}" ${isChecked}>
                    <label for="chart-var-${measureName}">${getMeasureAlias(measureName)} (${getUnit(measureName)})</label>
                </div>`;
        }
    });
    container.innerHTML = checkboxHTML || '<p>Không có biến nào cho controller này.</p>';
    
    container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                appData.detailsPage.selectedVariables[e.target.value] = true;
            } else {
                delete appData.detailsPage.selectedVariables[e.target.value];
            }
        });
    });
}

function updateCustomChart() {
    if (!customVariableChart) return;
    const state = appData.detailsPage;
    const history = state.chartHistory;
    const currentTime = Date.now();
    const lastLabel = history.labels.length > 0 ? history.labels[history.labels.length - 1] : 0;

    if (history.labels.length === 0 || currentTime > lastLabel + 500) {
        if (history.labels.length >= CHART_MAX_DATA_POINTS) {
            history.labels.shift();
            Object.values(history.datasets).forEach(ds => ds.data.shift());
        }
        history.labels.push(currentTime);
        Object.keys(state.selectedVariables).forEach(varName => {
            if (!history.datasets[varName]) {
                history.datasets[varName] = { data: Array(history.labels.length - 1).fill(null) };
            }
            const currentValue = appData.realtime_values[varName]?.value ?? (history.datasets[varName].data[history.datasets[varName].data.length - 1] ?? null);
            history.datasets[varName].data.push(currentValue);
        });
    }

    Object.keys(history.datasets).forEach(varName => {
        if (!state.selectedVariables[varName]) {
            delete history.datasets[varName];
        }
    });

    customVariableChart.data.labels = history.labels;
    customVariableChart.data.datasets = Object.keys(state.selectedVariables).map((varName, index) => ({
        label: `${getMeasureAlias(varName)} (${getUnit(varName)})`,
        data: history.datasets[varName]?.data || [],
        borderColor: CHART_COLORS[index % CHART_COLORS.length],
        tension: 0.1, fill: false, borderWidth: 2, pointRadius: 2, spanGaps: true
    }));
    customVariableChart.update('none');
}

function clearCustomChartData() {
    appData.detailsPage.chartHistory = { labels: [], datasets: {} };
    updateCustomChart();
}

document.addEventListener('DOMContentLoaded', () => {
    pageInitFunctions['detail-page'] = initDetailPage;
    pageRenderFunctions['detail-page'] = renderDetailPage;
});