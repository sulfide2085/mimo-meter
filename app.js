// Auto-detect: local dev uses relative paths (Flask), production uses Worker URL
const API_BASE = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? ""
  : "https://mimo-meter.sulfide2085.workers.dev";

let currentYear, currentMonth, currentAccount = 0;
let adminToken = "";

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

function onAccountChange() {
  currentAccount = parseInt(document.getElementById('account-select').value, 10);
  loadData();
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

function usageLabel(name) {
  const map = {
    plan_total_token: '套餐总量',
    compensation_total_token: '补偿积分',
    month_total_token: '本月',
  };
  return map[name] || name;
}

function renderUsage(data) {
  const container = document.getElementById('quota-list');
  container.innerHTML = '';

  const usageItems = data.data.usage.items;
  const compItem = usageItems.find(i => i.name === 'compensation_total_token');
  const hasComp = compItem && compItem.limit > 0;

  const allItems = [];

  for (const i of data.data.monthUsage.items) {
    if (hasComp) {
      const planItem = usageItems.find(u => u.name === 'plan_total_token');
      const combinedLimit = (planItem ? planItem.limit : i.limit) + compItem.limit;
      const pct = combinedLimit > 0 ? i.used / combinedLimit : 0;
      allItems.push({ ...i, scope: '本月', limit: combinedLimit, pct, limitLabel: `${formatToken(planItem ? planItem.limit : i.limit)} + ${formatToken(compItem.limit)}` });
    } else {
      allItems.push({ ...i, scope: '本月', pct: i.percent });
    }
  }

  for (const i of usageItems.filter(i => i.limit > 0)) {
    allItems.push({ ...i, scope: usageLabel(i.name), pct: i.percent });
  }

  for (const item of allItems) {
    const pct = item.pct;
    const limitText = item.limitLabel ? item.limitLabel : formatToken(item.limit);
    const row = document.createElement('div');
    row.className = 'quota-row';
    row.innerHTML = `
      <div class="quota-header">
        <span class="name">${item.scope}</span>
        <span class="detail">${formatToken(item.used)} / ${limitText} (${(pct * 100).toFixed(2)}%)</span>
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

async function loadAccounts() {
  try {
    const resp = await fetch(`${API_BASE}/api/accounts`);
    if (!resp.ok) return;
    const accounts = await resp.json();

    if (accounts.length <= 1) {
      document.getElementById('account-bar').hidden = true;
      return;
    }

    const select = document.getElementById('account-select');
    select.innerHTML = accounts.map(a =>
      `<option value="${a.index}">${a.name}</option>`
    ).join('');
    document.getElementById('account-bar').hidden = false;
  } catch {
    // Single account, hide selector
    document.getElementById('account-bar').hidden = true;
  }
}

async function loadDaily() {
  try {
    const resp = await fetch(`${API_BASE}/api/daily?account=${currentAccount}`, {
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
    const resp = await fetch(`${API_BASE}/api/all?account=${currentAccount}`);
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

// Admin panel
function authHeaders() {
  return adminToken ? { "Authorization": `Bearer ${adminToken}` } : {};
}

async function verifyToken() {
  adminToken = document.getElementById('admin-token').value;
  if (!adminToken) return;
  // Test by trying a write operation with a no-op check
  // Just reveal the admin content - actual auth is checked on save/delete
  document.getElementById('admin-auth').hidden = true;
  document.getElementById('admin-content').hidden = false;
  loadAdminAccounts();
}

const COOKIE_FIELDS = [
  { id: 'ck-apiToken', key: 'api-platform_serviceToken', required: true },
  { id: 'ck-userId', key: 'userId', required: true },
  { id: 'ck-ph', key: 'api-platform_ph', required: false },
];

function assembleCookies() {
  return COOKIE_FIELDS.map(f => {
    const val = document.getElementById(f.id).value.trim().replace(/^"|"$/g, '');
    return val ? `${f.key}="${val}"` : '';
  }).filter(Boolean).join(';');
}

function clearCookieFields() {
  document.getElementById('acct-name').value = '';
  COOKIE_FIELDS.forEach(f => document.getElementById(f.id).value = '');
}

// Paste clipboard content to a specific field
async function pasteToField(fieldId) {
  try {
    const text = await navigator.clipboard.readText();
    const cleaned = text.trim().replace(/^"|"$/g, '');
    document.getElementById(fieldId).value = cleaned;
  } catch {
    alert('无法读取剪贴板，请手动粘贴');
  }
}

// Parse a full cookie string and fill individual fields
function parseAndFillCookies(str) {
  const parts = str.split(';').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx < 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim().replace(/^"|"$/g, '');
    const field = COOKIE_FIELDS.find(f => f.key === key);
    if (field) {
      document.getElementById(field.id).value = val;
    }
  }
}

// Paste from clipboard and parse
async function pasteCookies() {
  try {
    const text = await navigator.clipboard.readText();
    parseAndFillCookies(text);
  } catch {
    alert('无法读取剪贴板，请手动粘贴到各字段');
  }
}

async function loadAdminAccounts() {
  try {
    const resp = await fetch(`${API_BASE}/api/accounts`);
    if (!resp.ok) return;
    const accounts = await resp.json();
    const list = document.getElementById('acct-list');
    list.innerHTML = accounts.map(a => `
      <div class="acct-item">
        <span class="name">${a.name}</span>
        <div class="actions">
          <button onclick="renameAccount(${a.index}, '${a.name.replace(/'/g, "\\'")}')">改名</button>
          <button onclick="deleteAccount(${a.index})">删除</button>
        </div>
      </div>
    `).join('') || '<div style="color:var(--text-dim);font-size:0.85rem">暂无账号</div>';
  } catch {}
}

async function saveAccount() {
  const name = document.getElementById('acct-name').value.trim();
  const missing = COOKIE_FIELDS
    .filter(f => f.required && !document.getElementById(f.id).value.trim())
    .map(f => f.key);
  if (missing.length) { alert(`必填字段缺失：${missing.join(', ')}`); return; }
  const cookies = assembleCookies();
  if (!cookies) { alert('请至少填写一个 Cookie 字段'); return; }

  try {
    const resp = await fetch(`${API_BASE}/api/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name: name || undefined, cookies }),
    });
    const data = await resp.json();
    if (!resp.ok) { alert(data.error || '保存失败'); return; }

    clearCookieFields();
    loadAdminAccounts();
    loadAccounts();
    loadData();
  } catch (e) { alert(e.message); }
}

async function deleteAccount(idx) {
  if (!confirm('确定删除该账号？')) return;
  try {
    const resp = await fetch(`${API_BASE}/api/accounts?account=${idx}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    const data = await resp.json();
    if (!resp.ok) { alert(data.error || '删除失败'); return; }

    if (currentAccount >= data.count) currentAccount = Math.max(0, data.count - 1);
    loadAdminAccounts();
    loadAccounts();
    loadData();
  } catch (e) { alert(e.message); }
}

async function renameAccount(idx, currentName) {
  const newName = prompt('输入新名称', currentName);
  if (newName === null || newName.trim() === '' || newName === currentName) return;
  try {
    const resp = await fetch(`${API_BASE}/api/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ index: idx, name: newName.trim() }),
    });
    const data = await resp.json();
    if (!resp.ok) { alert(data.error || '改名失败'); return; }
    loadAdminAccounts();
    loadAccounts();
  } catch (e) { alert(e.message); }
}

async function init() {
  await loadAccounts();
  loadData();
}

init();
