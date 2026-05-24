// ============================================================
// CONFIG: Set this to your Cloudflare Worker URL after deployment
// ============================================================
const API_BASE = "https://mimo-meter.sulfide2085.workers.dev";

let currentYear, currentMonth;

function formatToken(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return String(n);
}

function fillClass(pct) {
  if (pct >= 0.8) return 'fill-high';
  if (pct >= 0.5) return 'fill-mid';
  return 'fill-low';
}

function updateMonthLabel() {
  document.getElementById('month-label').textContent = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
}

function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 12) { currentMonth = 1; currentYear++; }
  if (currentMonth < 1) { currentMonth = 12; currentYear--; }
  updateMonthLabel();
  loadDaily();
}

function renderPlan(data) {
  const d = data.data;
  document.getElementById('plan-name').textContent = `${d.planName} (${d.planCode})`;
  document.getElementById('plan-expires').textContent = d.currentPeriodEnd;

  const statusEl = document.getElementById('plan-status');
  if (d.expired) {
    statusEl.textContent = '已过期';
    statusEl.className = 'value status-expired';
  } else {
    statusEl.textContent = '生效中';
    statusEl.className = 'value status-active';
  }

  document.getElementById('plan-renew').textContent = d.hasAutoRenewSubscribed ? '开启' : '关闭';
}

function renderUsage(data) {
  const container = document.getElementById('quota-list');
  container.innerHTML = '';

  const allItems = [
    ...data.data.monthUsage.items.map(i => ({ ...i, scope: '本月' })),
    ...data.data.usage.items.filter(i => i.limit > 0).map(i => ({ ...i, scope: '套餐总量' })),
  ];

  for (const item of allItems) {
    const pct = item.percent;
    const row = document.createElement('div');
    row.className = 'quota-row';
    row.innerHTML = `
      <div class="quota-header">
        <span class="name">${item.scope}</span>
        <span class="detail">${formatToken(item.used)} / ${formatToken(item.limit)} (${(pct * 100).toFixed(2)}%)</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill ${fillClass(pct)}" style="width:${Math.max(pct * 100, 0.5)}%"></div>
      </div>
    `;
    container.appendChild(row);
  }
}

function renderDaily(data) {
  const tbody = document.querySelector('#daily-table tbody');
  tbody.innerHTML = '';

  const records = data.data || [];
  if (records.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="7" style="text-align:center;color:var(--text-dim)">本月暂无数据</td>';
    tbody.appendChild(tr);
    return;
  }

  for (const r of records) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.date}</td>
      <td>${r.model}</td>
      <td class="num">${r.requestCount}</td>
      <td class="num">${formatToken(r.totalToken)}</td>
      <td class="num">${formatToken(r.inputHitToken)}</td>
      <td class="num">${formatToken(r.inputMissToken)}</td>
      <td class="num">${formatToken(r.outputToken)}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function loadDaily() {
  try {
    const resp = await fetch(`${API_BASE}/api/daily`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: currentYear, month: currentMonth }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    if (json.code !== 0) throw new Error(json.message || `API error: code ${json.code}`);
    renderDaily(json);
  } catch (e) {
    const tbody = document.querySelector('#daily-table tbody');
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--red)">${e.message}</td></tr>`;
  }
}

async function loadData() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;

  document.getElementById('loading').hidden = false;
  document.getElementById('error').hidden = true;
  document.getElementById('content').hidden = true;

  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth() + 1;
  updateMonthLabel();

  try {
    const resp = await fetch(`${API_BASE}/api/all`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();

    const errDetail = [json.detail, json.usage, json.daily].find(d => d && d.code !== 0);
    if (errDetail) {
      throw new Error(errDetail.message || `API error: code ${errDetail.code}`);
    }

    renderPlan(json.detail);
    renderUsage(json.usage);
    renderDaily(json.daily);

    document.getElementById('loading').hidden = true;
    document.getElementById('content').hidden = false;
  } catch (e) {
    document.getElementById('loading').hidden = true;
    const errEl = document.getElementById('error');
    errEl.textContent = e.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

loadData();
