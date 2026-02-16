// Global state
console.log("Dashboard script loaded!");
let allOrders = [];
let charts = {};

document.addEventListener('DOMContentLoaded', async () => {
    // Event Listeners
    const syncBtn = document.getElementById('syncButton');
    if (syncBtn) syncBtn.addEventListener('click', startSync);

    const startInput = document.getElementById('startDate');
    if (startInput) startInput.addEventListener('change', () => {
        clearFilterButtons();
        updateDashboard();
    });

    const endInput = document.getElementById('endDate');
    if (endInput) endInput.addEventListener('change', () => {
        clearFilterButtons();
        updateDashboard();
    });

    // Filter Buttons Logic
    document.querySelectorAll('.btn-filter').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            const range = e.target.dataset.range;
            if (range === 'all') {
                document.getElementById('startDate').value = '';
                document.getElementById('endDate').value = '';
            } else {
                const days = parseInt(range);
                const end = new Date();
                const start = new Date();
                start.setDate(end.getDate() - days);

                // Format YYYY-MM-DD
                document.getElementById('startDate').value = start.toISOString().split('T')[0];
                document.getElementById('endDate').value = end.toISOString().split('T')[0];
            }
            updateDashboard();
        });
    });

    // Listen for updates
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "status_update") {
            const el = document.getElementById('statusMsg');
            if (el) el.innerText = request.message;
        } else if (request.action === "sync_complete") {
            document.getElementById('loading').classList.add('hidden');
            loadData();
            alert(`Sync Complete! Parsed ${request.count} orders.`);
        }
    });

    // Initial Load
    await loadData();
});

function clearFilterButtons() {
    document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
}

async function loadData() {
    console.log("Loading data from storage...");
    try {
        const data = await chrome.storage.local.get(['zomatoOrders']);

        if (data.zomatoOrders && Array.isArray(data.zomatoOrders) && data.zomatoOrders.length > 0) {
            allOrders = data.zomatoOrders;
            // console.log(`Loaded ${allOrders.length} orders.`);

            document.getElementById('loading').classList.add('hidden');
            updateDashboard();
        } else {
            document.getElementById('statusMsg').innerText = "No data found. Click 'Sync Data' to fetch your Zomato history.";
            document.getElementById('loading').classList.remove('hidden');
            document.querySelector('.spinner').style.display = 'none';
        }
    } catch (e) {
        console.error("Storage Error:", e);
    }
}

// Special helper for Zomato dates like "January 17, 2026 at 09:56 PM"
function parseZomatoDate(dateStr) {
    if (!dateStr) return null;

    // Remove "at" to make it "January 17, 2026 09:56 PM", which JS can parse
    let cleaned = dateStr.replace(/ at /i, ' ');
    let d = new Date(cleaned);

    if (!isNaN(d.getTime())) return d;

    // Fallback
    d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;

    return null;
}

function processOrders(orders, startDate, endDate) {
    if (!orders) return { totalSpent: 0, totalOrders: 0, avgOrderValue: 0, monthlySpend: {}, timeOfDay: [], restaurantStats: {} };

    let filtered = orders.filter(order => {
        const dateVal = order.orderDate || order.order_date || order.date;
        const d = parseZomatoDate(dateVal);

        if (!d) return false;

        if (startDate) {
            const start = new Date(startDate);
            if (d < start) return false;
        }
        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            if (d > end) return false;
        }

        return order.paymentStatus === 1;
    });

    // Stats
    let totalSpent = 0;
    let monthlySpend = {};
    let restaurantStats = {};
    let timeOfDay = new Array(24).fill(0);

    filtered.forEach(order => {
        // Amount
        let amountStr = order.totalCost || order.total_cost || "0";
        let amount = parseFloat(amountStr.toString().replace(/[^0-9.]/g, ''));
        if (isNaN(amount)) amount = 0;

        totalSpent += amount;

        // Date
        const dateVal = order.orderDate || order.order_date || order.date;
        const d = parseZomatoDate(dateVal);

        if (d) {
            // Monthly Spend
            const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (!monthlySpend[monthKey]) monthlySpend[monthKey] = 0;
            monthlySpend[monthKey] += amount;

            // Time of Day
            const hour = d.getHours();
            timeOfDay[hour]++;
        }

        // Restaurant
        let rName = "Unknown";
        if (order.resInfo && order.resInfo.name) rName = order.resInfo.name;

        if (!restaurantStats[rName]) restaurantStats[rName] = { count: 0, amount: 0 };
        restaurantStats[rName].count++;
        restaurantStats[rName].amount += amount;
    });

    return {
        totalSpent,
        totalOrders: filtered.length,
        avgOrderValue: filtered.length > 0 ? (totalSpent / filtered.length).toFixed(2) : 0,
        monthlySpend,
        timeOfDay,
        restaurantStats
    };
}

function updateDashboard() {
    const start = document.getElementById('startDate').value;
    const end = document.getElementById('endDate').value;

    const metrics = processOrders(allOrders, start, end);

    // Update UI
    document.getElementById('totalSpent').innerText = "₹" + Math.round(metrics.totalSpent).toLocaleString();
    document.getElementById('totalOrders').innerText = metrics.totalOrders;
    document.getElementById('avgOrderValue').innerText = "₹" + Math.round(metrics.avgOrderValue).toLocaleString();

    // Render Charts
    renderMonthlyChart(metrics.monthlySpend);
    renderTimeChart(metrics.timeOfDay);
    renderTopRestaurants(metrics.restaurantStats);
}

function renderMonthlyChart(data) {
    const ctx = document.getElementById('monthlyChart').getContext('2d');
    const sortedKeys = Object.keys(data).sort();
    const values = sortedKeys.map(k => data[k]);

    if (charts.monthly) charts.monthly.destroy();

    charts.monthly = new Chart(ctx, {
        type: 'line',
        data: {
            labels: sortedKeys,
            datasets: [{
                label: 'Spending (₹)',
                data: values,
                borderColor: '#E23744',
                backgroundColor: 'rgba(226, 55, 68, 0.1)',
                tension: 0.3,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: '#f0f0f0' }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

function renderTimeChart(hoursData) {
    const ctx = document.getElementById('timeChart').getContext('2d');
    const labels = Array.from({ length: 24 }, (_, i) => {
        const h = i % 12 || 12;
        const ampm = i < 12 ? 'AM' : 'PM';
        return `${h}${ampm}`;
    });

    if (charts.time) charts.time.destroy();

    charts.time = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Orders',
                data: hoursData,
                backgroundColor: '#2A9D8F',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    ticks: { maxTicksLimit: 12 }
                }
            }
        }
    });
}

function renderTopRestaurants(stats) {
    const sorted = Object.entries(stats)
        .sort((a, b) => b[1].amount - a[1].amount)
        .slice(0, 10);

    const tbody = document.getElementById('topRestaurantsList');
    tbody.innerHTML = '';

    sorted.forEach(([name, data]) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${name}</td>
            <td>${data.count}</td>
            <td>₹${Math.round(data.amount).toLocaleString()}</td>
        `;
        tbody.appendChild(tr);
    });

    const ctx = document.getElementById('categoryChart').getContext('2d');
    const top5 = sorted.slice(0, 5);
    const othersAmount = Object.entries(stats)
        .sort((a, b) => b[1].amount - a[1].amount)
        .slice(5)
        .reduce((sum, item) => sum + item[1].amount, 0);

    const labels = top5.map(i => i[0]);
    const dataValues = top5.map(i => i[1].amount);

    if (othersAmount > 0) {
        labels.push('Others');
        dataValues.push(othersAmount);
    }

    if (charts.category) charts.category.destroy();

    charts.category = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: dataValues,
                backgroundColor: [
                    '#E23744', '#F4A261', '#2A9D8F', '#264653', '#E9C46A', '#ddd'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

function startSync() {
    document.getElementById('loading').classList.remove('hidden');
    document.querySelector('.spinner').style.display = 'block';

    const msgEl = document.getElementById('statusMsg');
    if (msgEl) msgEl.innerText = "Initializing sync...";

    chrome.tabs.query({ url: "*://*.zomato.com/*" }, (tabs) => {
        if (tabs.length > 0) {
            sendMessageToTab(tabs[0].id);
        } else {
            chrome.tabs.create({ url: "https://www.zomato.com" }, (tab) => {
                if (msgEl) msgEl.innerText = "Opened Zomato. Waiting for page load...";
                let retries = 0;
                // checking status
                const interval = setInterval(() => {
                    chrome.tabs.get(tab.id, (updatedTab) => {
                        if (updatedTab.status === 'complete') {
                            clearInterval(interval);
                            setTimeout(() => sendMessageToTab(tab.id), 2000);
                        }
                    });
                    retries++;
                    if (retries > 20) clearInterval(interval);
                }, 1000);
            });
        }
    });
}

function sendMessageToTab(tabId) {
    chrome.tabs.sendMessage(tabId, { action: "start_sync" }, (response) => {
        if (chrome.runtime.lastError) {
            console.log("Connect error:", chrome.runtime.lastError.message);
            const msgEl = document.getElementById('statusMsg');
            if (msgEl) msgEl.innerText = "Zomato tab not ready. Please refresh it.";
            // We can retry or just ask user
            setTimeout(() => sendMessageToTab(tabId), 2000);
        } else {
            console.log("Sync started", response);
        }
    });
}
