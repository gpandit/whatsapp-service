// ── Config ────────────────────────────────────────────────────────────────────
// After deploying with CDK, replace this with the ApiUrl output value
const API_BASE = window.ENV_API_BASE || 'https://YOUR_API_GATEWAY_URL/dev';

let authToken   = localStorage.getItem('wa_admin_token') || null;
let currentPage = 1;
let msgPage     = 1;
let totalMsgPages = 1;

// ── Axios setup ───────────────────────────────────────────────────────────────
const api = axios.create({ baseURL: API_BASE });
api.interceptors.request.use((config) => {
  if (authToken) config.headers.Authorization = `Bearer ${authToken}`;
  return config;
});
api.interceptors.response.use(null, (err) => {
  if (err.response?.status === 401) logout();
  return Promise.reject(err);
});

// ── Auth ──────────────────────────────────────────────────────────────────────
async function login() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  const btn      = document.getElementById('loginBtn');

  if (!email || !password) { showLoginError('Email and password required'); return; }

  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const res = await api.post('/admin/login', { email, password });
    authToken = res.data.data.token;
    localStorage.setItem('wa_admin_token', authToken);
    document.getElementById('adminName').textContent = res.data.data.admin.name;
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    showTab('dashboard');
    loadTemplatesIntoDropdowns();
  } catch (e) {
    showLoginError(e.response?.data?.error || 'Login failed');
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In';
  }
}

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function logout() {
  authToken = null;
  localStorage.removeItem('wa_admin_token');
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('mainApp').classList.add('hidden');
}

// ── Navigation ────────────────────────────────────────────────────────────────
function showTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('bg-gray-700', 'text-white'));
  document.getElementById(`tab-${tabName}`)?.classList.remove('hidden');
  document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('bg-gray-700', 'text-white');

  if (tabName === 'dashboard')  loadDashboard();
  if (tabName === 'customers')  loadCustomers();
  if (tabName === 'messages')   loadMessages();
  if (tabName === 'templates')  loadTemplates();
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const res = await api.get('/admin/stats');
    const { customers, messages, recentMessages } = res.data.data;
    document.getElementById('stat-total-customers').textContent = customers.total;
    document.getElementById('stat-opted-in').textContent = customers.optedIn;
    document.getElementById('stat-sent-today').textContent = messages.sentToday;
    document.getElementById('stat-failed-today').textContent = messages.failedToday;

    const tbody = document.getElementById('recent-messages-body');
    tbody.innerHTML = recentMessages.map(m => `
      <tr class="border-b hover:bg-gray-50">
        <td class="py-2">${m.customer?.name || '—'}</td>
        <td class="py-2 text-gray-500">${m.customer?.phone || '—'}</td>
        <td class="py-2">${badgeType(m.type)}</td>
        <td class="py-2">${badgeStatus(m.status)}</td>
        <td class="py-2 text-gray-500 text-xs">${fmtDate(m.createdAt)}</td>
      </tr>`).join('');
  } catch (e) { console.error('Dashboard load failed', e); }
}

// ── Customers ─────────────────────────────────────────────────────────────────
async function loadCustomers() {
  const search = document.getElementById('customerSearch').value;
  try {
    const res = await api.get('/customers', { params: { search, page: currentPage, limit: 20 } });
    const { customers } = res.data.data;
    document.getElementById('customers-body').innerHTML = customers.map(c => `
      <tr class="border-b hover:bg-gray-50">
        <td class="px-4 py-3 font-medium">${escHtml(c.name)}</td>
        <td class="px-4 py-3 text-gray-600">${c.phone}</td>
        <td class="px-4 py-3 text-gray-500 text-xs">${c.email || '—'}</td>
        <td class="px-4 py-3">
          ${c.isOptedIn
            ? '<span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Opted In</span>'
            : '<span class="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">Opted Out</span>'}
        </td>
        <td class="px-4 py-3 text-gray-500">${c._count?.messages || 0}</td>
        <td class="px-4 py-3">
          <button onclick="quickSend('${c.phone}')" class="text-green-600 hover:underline text-xs">
            <i class="fab fa-whatsapp"></i> Send
          </button>
        </td>
      </tr>`).join('');
  } catch (e) { console.error('Load customers failed', e); }
}

let searchTimeout;
function searchCustomers() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(loadCustomers, 400);
}

function showAddCustomer() {
  document.getElementById('addCustomerForm').classList.toggle('hidden');
}

async function addCustomer() {
  const name  = document.getElementById('newCustName').value.trim();
  const phone = document.getElementById('newCustPhone').value.trim();
  const email = document.getElementById('newCustEmail').value.trim();
  if (!name || !phone) { alert('Name and phone are required'); return; }
  try {
    await api.post('/customers', { name, phone, email: email || undefined });
    document.getElementById('addCustomerForm').classList.add('hidden');
    ['newCustName','newCustPhone','newCustEmail'].forEach(id => document.getElementById(id).value = '');
    loadCustomers();
    alert('Customer added ✓');
  } catch (e) {
    alert(e.response?.data?.error || 'Failed to add customer');
  }
}

function quickSend(phone) {
  document.getElementById('sendPhone').value = phone;
  showTab('send');
}

// ── Send Message ──────────────────────────────────────────────────────────────
async function sendMessage() {
  const phone        = document.getElementById('sendPhone').value.trim();
  const type         = document.getElementById('sendMsgType').value;
  const templateName = document.getElementById('sendTemplateName').value;
  const rawComponents = document.getElementById('sendComponents').value.trim();

  if (!phone) { showAlert('sendMsgAlert', 'Phone is required', 'error'); return; }
  if (!templateName) { showAlert('sendMsgAlert', 'Select a template', 'error'); return; }

  let components;
  if (rawComponents) {
    try { components = JSON.parse(rawComponents); }
    catch { showAlert('sendMsgAlert', 'Invalid JSON in components', 'error'); return; }
  }

  try {
    await api.post('/messages/send', { phone, type, templateName, components });
    showAlert('sendMsgAlert', '✓ Message sent successfully!', 'success');
  } catch (e) {
    showAlert('sendMsgAlert', e.response?.data?.error || 'Send failed', 'error');
  }
}

// ── Broadcast ─────────────────────────────────────────────────────────────────
function toggleRecipients(radio) {
  document.getElementById('bcPhones').classList.toggle('hidden', radio.value !== 'specific');
}

async function broadcastMessages() {
  const name         = document.getElementById('bcName').value.trim();
  const description  = document.getElementById('bcDesc').value.trim();
  const templateName = document.getElementById('bcTemplate').value;
  const rawComponents = document.getElementById('bcComponents').value.trim();
  const recipientType = document.querySelector('input[name="recipientType"]:checked').value;
  const rawPhones     = document.getElementById('bcPhones').value;

  if (!name || !templateName) {
    showAlert('broadcastAlert', 'Campaign name and template required', 'error'); return;
  }

  let components;
  if (rawComponents) {
    try { components = JSON.parse(rawComponents); }
    catch { showAlert('broadcastAlert', 'Invalid JSON in components', 'error'); return; }
  }

  const payload = { campaignName: name, description, templateName, components };
  if (recipientType === 'all') {
    payload.sendToAll = true;
  } else {
    const phones = rawPhones.split('\n').map(p => p.trim()).filter(Boolean);
    if (!phones.length) { showAlert('broadcastAlert', 'Enter at least one phone', 'error'); return; }
    // Look up customerIds by phone — simplified: use phones as identifier
    payload.customerIds = phones;
  }

  if (!confirm(`Send "${name}" to ${recipientType === 'all' ? 'ALL opted-in' : 'selected'} customers?`)) return;

  const btn = document.getElementById('broadcastBtn');
  btn.disabled = true; btn.textContent = 'Sending…';

  try {
    const res = await api.post('/messages/broadcast', payload);
    const { sent, failed, total } = res.data.data;
    showAlert('broadcastAlert', `✓ Done! Sent: ${sent}, Failed: ${failed}, Total: ${total}`, 'success');
  } catch (e) {
    showAlert('broadcastAlert', e.response?.data?.error || 'Broadcast failed', 'error');
  } finally {
    btn.disabled = false; btn.textContent = '🔊 Send Broadcast';
  }
}

// ── Messages ──────────────────────────────────────────────────────────────────
async function loadMessages() {
  const type   = document.getElementById('msgTypeFilter').value;
  const status = document.getElementById('msgStatusFilter').value;
  try {
    const res = await api.get('/messages', { params: { type, status, page: msgPage, limit: 20 } });
    const { messages, total, pages } = res.data.data;
    totalMsgPages = pages;
    document.getElementById('msg-pagination-info').textContent = `${total} messages · Page ${msgPage} of ${pages}`;

    document.getElementById('messages-body').innerHTML = messages.map(m => `
      <tr class="border-b hover:bg-gray-50">
        <td class="px-4 py-3">${escHtml(m.customer?.name || '—')}</td>
        <td class="px-4 py-3 text-gray-500">${m.customer?.phone || '—'}</td>
        <td class="px-4 py-3">${badgeType(m.type)}</td>
        <td class="px-4 py-3 text-xs text-gray-500 font-mono">${m.templateName || '—'}</td>
        <td class="px-4 py-3">${badgeStatus(m.status)}</td>
        <td class="px-4 py-3 text-xs text-gray-400">${fmtDate(m.sentAt || m.createdAt)}</td>
      </tr>`).join('');
  } catch (e) { console.error('Load messages failed', e); }
}

function prevMsgPage() { if (msgPage > 1) { msgPage--; loadMessages(); } }
function nextMsgPage() { if (msgPage < totalMsgPages) { msgPage++; loadMessages(); } }

// ── Templates ─────────────────────────────────────────────────────────────────
async function loadTemplates() {
  try {
    const res = await api.get('/templates');
    const { templates } = res.data.data;
    document.getElementById('templates-grid').innerHTML = templates.map(t => `
      <div class="bg-white rounded-xl shadow-sm p-5">
        <div class="flex justify-between items-start mb-2">
          <p class="font-semibold text-gray-800 font-mono text-sm">${t.name}</p>
          <span class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">${t.status || 'APPROVED'}</span>
        </div>
        <p class="text-xs text-gray-400 mb-2">${t.language || 'en_US'} · ${t.category || 'UTILITY'}</p>
        <button onclick="useTemplate('${t.name}')"
          class="text-xs text-green-600 hover:underline">Use this template →</button>
      </div>`).join('');
  } catch (e) {
    document.getElementById('templates-grid').innerHTML =
      '<p class="text-gray-500 text-sm col-span-2">Failed to load templates. Check your WhatsApp API connection.</p>';
  }
}

async function loadTemplatesIntoDropdowns() {
  try {
    const res = await api.get('/templates');
    const { templates } = res.data.data;
    const opts = templates.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
    document.getElementById('sendTemplateName').innerHTML = '<option value="">Select template…</option>' + opts;
    document.getElementById('bcTemplate').innerHTML = '<option value="">Select template…</option>' + opts;
  } catch { /* fail silently */ }
}

function useTemplate(name) {
  document.getElementById('sendTemplateName').value = name;
  showTab('send');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function badgeStatus(status) {
  const map = {
    SENT:      '<span class="text-xs px-2 py-0.5 rounded-full badge-sent">Sent</span>',
    DELIVERED: '<span class="text-xs px-2 py-0.5 rounded-full badge-delivered">Delivered</span>',
    READ:      '<span class="text-xs px-2 py-0.5 rounded-full badge-read">Read</span>',
    FAILED:    '<span class="text-xs px-2 py-0.5 rounded-full badge-failed">Failed</span>',
    QUEUED:    '<span class="text-xs px-2 py-0.5 rounded-full badge-queued">Queued</span>',
  };
  return map[status] || `<span class="text-xs text-gray-400">${status}</span>`;
}

function badgeType(type) {
  const map = {
    OTP:           '<span class="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">OTP</span>',
    TRANSACTIONAL: '<span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Transactional</span>',
    MARKETING:     '<span class="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">Marketing</span>',
  };
  return map[type] || type;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showAlert(id, msg, type) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = `p-3 rounded-lg text-sm ${type === 'success'
    ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`;
  el.classList.remove('hidden');
  if (type === 'success') setTimeout(() => el.classList.add('hidden'), 5000);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
(function init() {
  if (authToken) {
    // Try to auto-login with stored token
    api.get('/admin/me')
      .then(res => {
        document.getElementById('adminName').textContent = res.data.data?.name || '';
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('mainApp').classList.remove('hidden');
        showTab('dashboard');
        loadTemplatesIntoDropdowns();
      })
      .catch(() => { authToken = null; localStorage.removeItem('wa_admin_token'); });
  }
})();
