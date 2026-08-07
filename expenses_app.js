// Standalone Shopper Expenses App Logic
let state = {
  products: [],
  marketExpenses: [],
  settings: { darkMode: true, currency: 'MMK' }
};

let fbApp = null;
let db = null;
let unsubscribeExpenses = null;
let unsubscribeProducts = null;
const SERVER_API = 'api/index.php';
let serverCsrfToken = null;
let serverStateVersion = 0;
let fullPosState = {};
let serverSaveTimer = null;

// 1. Setup Firebase Configuration Modals
function openFbConfigModal() {
  const overlay = document.getElementById('fbConfigModalOverlay');
  if (overlay) {
    const savedConfig = localStorage.getItem('EXPENSES_APP_FB_CONFIG');
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        document.getElementById('fbApiKey').value = parsed.apiKey || '';
        document.getElementById('fbProjectId').value = parsed.projectId || '';
        document.getElementById('fbAppId').value = parsed.appId || '';
      } catch (e) {}
    }
    overlay.style.display = 'flex';
  }
}

function closeFbConfigModal() {
  const overlay = document.getElementById('fbConfigModalOverlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
}

function saveFbConfig() {
  const apiKey = document.getElementById('fbApiKey').value.trim();
  const projectId = document.getElementById('fbProjectId').value.trim();
  const appId = document.getElementById('fbAppId').value.trim();
  
  if (!apiKey || !projectId || !appId) {
    alert("ကျေးဇူးပြု၍ API Key, Project ID နှင့် App ID အားလုံးကို ဖြည့်စွက်ပါ!");
    return;
  }
  
  const config = { apiKey, projectId, appId };
  localStorage.setItem('EXPENSES_APP_FB_CONFIG', JSON.stringify(config));
  closeFbConfigModal();
  alert("ချိတ်ဆက်မှု အောင်မြင်ပါသည်! Cloud Sync ကို စတင်ပါမည်။");
  window.location.reload();
}

// 2. Load Local State
function loadLocalState() {
  const saved = localStorage.getItem('RESTAURANT_POS_STATE');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      fullPosState = parsed;
      state.products = parsed.products || [];
      state.marketExpenses = parsed.marketExpenses || [];
      state.settings = parsed.settings || { darkMode: true, currency: 'MMK' };
    } catch (e) {
      console.error("Failed to parse POS State", e);
    }
  }
}

function saveLocalState() {
  const currentSavedStr = localStorage.getItem('RESTAURANT_POS_STATE');
  let currentSavedObj = {};
  if (currentSavedStr) {
    try {
      currentSavedObj = JSON.parse(currentSavedStr);
    } catch (e) {}
  }
  currentSavedObj.products = state.products;
  currentSavedObj.marketExpenses = state.marketExpenses;
  currentSavedObj.settings = state.settings;
  fullPosState = currentSavedObj;
  
  const finalStateStr = JSON.stringify(currentSavedObj);
  localStorage.setItem('RESTAURANT_POS_STATE', finalStateStr);
  
  scheduleServerSave();
}

// 3. Initialize the Namecheap PHP/MySQL sync service.
async function expensesApi(action, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (serverCsrfToken && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = serverCsrfToken;
  const response = await fetch(`${SERVER_API}?action=${encodeURIComponent(action)}`, {
    credentials: 'same-origin', cache: 'no-store', ...options, headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Server error (${response.status})`);
  return payload;
}

function applyRemoteExpenseState(remote) {
  if (!remote) return;
  fullPosState = remote;
  state.products = remote.products || [];
  state.marketExpenses = remote.marketExpenses || [];
  state.settings = remote.settings || state.settings;
  localStorage.setItem('RESTAURANT_POS_STATE', JSON.stringify(remote));
  populateProductsDropdown();
  applyThemeStyle();
  renderSummary();
  renderList();
}

async function initServerSync() {
  try {
    const session = await expensesApi('status', { method: 'GET' });
    if (!session.authenticated) {
      window.location.href = 'index.html';
      return;
    }
    serverCsrfToken = session.csrfToken;
    const remote = await expensesApi('state', { method: 'GET' });
    if (remote.exists) {
      serverStateVersion = remote.version;
      applyRemoteExpenseState(remote.state);
    }
    updateSyncBadge(true);
    setInterval(async () => {
      if (serverSaveTimer) return;
      try {
        const latest = await expensesApi('state', { method: 'GET' });
        if (latest.exists && latest.version > serverStateVersion) {
          serverStateVersion = latest.version;
          applyRemoteExpenseState(latest.state);
        }
      } catch (error) {
        updateSyncBadge(false);
      }
    }, 2000);
  } catch (error) {
    console.error('Expense server sync failed:', error);
    updateSyncBadge(false);
  }
}

function scheduleServerSave() {
  if (!serverCsrfToken) return;
  clearTimeout(serverSaveTimer);
  serverSaveTimer = setTimeout(async () => {
    serverSaveTimer = null;
    try {
      const result = await expensesApi('state', {
        method: 'PUT',
        body: JSON.stringify({ state: fullPosState, baseVersion: serverStateVersion })
      });
      serverStateVersion = result.version;
      updateSyncBadge(true);
    } catch (error) {
      console.error('Expense save failed:', error);
      updateSyncBadge(false);
    }
  }, 300);
}

function updateSyncBadge(online) {
  const badge = document.getElementById('syncStatusBadge');
  if (badge) {
    if (online) {
      badge.innerHTML = `<i class="fa-solid fa-cloud-arrow-up animate-pulse"></i> Cloud Sync On`;
      badge.style.color = "var(--accent-success)";
      badge.style.background = "rgba(16, 185, 129, 0.1)";
      badge.style.borderColor = "rgba(16, 185, 129, 0.2)";
    } else {
      badge.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> Local Only`;
      badge.style.color = "var(--text-muted)";
      badge.style.background = "rgba(255, 255, 255, 0.05)";
      badge.style.borderColor = "var(--panel-border)";
    }
  }
}

// 4. Populate Products Select Dropdown
function populateProductsDropdown() {
  const prodSelect = document.getElementById('expProductSelect');
  if (prodSelect) {
    prodSelect.innerHTML = state.products.map(p => {
      return `<option value="${p.id}">${p.name} [စတော့: ${p.stock || 0}]</option>`;
    }).join('');
  }
}

// 5. Normal page view lifecycle
function init() {
  loadLocalState();
  
  // Default Date to Today
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('expDate').value = today;
  
  populateProductsDropdown();
  applyThemeStyle();
  renderSummary();
  renderList();
  
  initServerSync();
}

function applyThemeStyle() {
  document.documentElement.setAttribute('data-theme', state.settings.darkMode ? 'dark' : 'light');
  const themeIcon = document.querySelector('#themeBtn i');
  if (themeIcon) {
    themeIcon.className = state.settings.darkMode ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  }
}

function toggleTheme() {
  state.settings.darkMode = !state.settings.darkMode;
  applyThemeStyle();
  saveLocalState();
}

function toggleInventoryLink(checked) {
  document.getElementById('expInventoryProductWrapper').style.display = checked ? 'block' : 'none';
}

function formatPrice(number) {
  return new Intl.NumberFormat().format(number) + ' ' + (state.settings.currency || 'MMK');
}

function generateId(prefix = 'exp') {
  return `${prefix}-${Math.random().toString(36).substr(2, 9)}`;
}

// 6. Save purchase expense
function saveExpense(e) {
  e.preventDefault();
  
  const name = document.getElementById('expItemName').value.trim();
  const cost = parseInt(document.getElementById('expCost').value) || 0;
  const qty = parseFloat(document.getElementById('expQty').value) || 0;
  const unit = document.getElementById('expUnit').value.trim();
  const date = document.getElementById('expDate').value;
  const notes = document.getElementById('expNotes').value.trim();
  const linkInv = document.getElementById('expLinkInventory').checked;
  const prodId = document.getElementById('expProductSelect').value;
  const addQty = parseInt(document.getElementById('expAddQty').value) || 0;

  const newExp = {
    id: generateId('exp'),
    itemName: name,
    cost: cost,
    quantity: qty,
    unit: unit,
    category: 'ကုန်ကြမ်း',
    date: date,
    notes: notes,
    addedToInventory: linkInv
  };

  if (linkInv && prodId && addQty > 0) {
    newExp.productId = prodId;
    newExp.addQty = addQty;
    const prod = state.products.find(p => p.id === prodId);
    if (prod) {
      prod.stock = (prod.stock || 0) + addQty;
    }
  }
  state.marketExpenses.unshift(newExp);
  saveLocalState();
  populateProductsDropdown();
  renderSummary();
  renderList();
  alert("ဈေးဝယ်စရိတ်အား Server သို့ သိမ်းဆည်းနေပါသည်! ✅");

  // Reset form
  document.getElementById('expenseForm').reset();
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('expDate').value = today;
  toggleInventoryLink(false);
}

// 7. Render summary statistics
function renderSummary() {
  const todayStr = new Date().toISOString().split('T')[0];
  const todayExpenses = state.marketExpenses.filter(e => e.date === todayStr);
  const totalCost = todayExpenses.reduce((sum, e) => sum + e.cost, 0);
  
  document.getElementById('sumTodayCost').textContent = formatPrice(totalCost);
  document.getElementById('sumTodayCount').textContent = `${todayExpenses.length} ခု`;
}

// 8. Render list of expenses
function renderList() {
  const todayStr = new Date().toISOString().split('T')[0];
  const todayExpenses = state.marketExpenses.filter(e => e.date === todayStr);
  const container = document.getElementById('expenseListContainer');
  
  if (todayExpenses.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 30px;">ယနေ့ ဝယ်ယူမှုမှတ်တမ်း မရှိသေးပါ</div>`;
    return;
  }

  container.innerHTML = todayExpenses.map(e => {
    const linkInfo = e.addedToInventory ? `<span style="color: var(--accent-success); font-size: 0.72rem; font-weight: bold;"><i class="fa-solid fa-cube"></i> စတော့သို့ပေါင်းပြီး</span>` : '';
    const categoryTag = `<span style="color: var(--accent-primary); font-size: 0.72rem; font-weight: bold; background: rgba(229, 183, 46, 0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(229, 183, 46, 0.2); margin-right: 4px;">ကုန်ကြမ်း</span>`;
    const qtyDisplay = e.unit ? `${e.quantity} ${e.unit}` : (e.quantity || '');
    return `
      <div class="expense-row">
        <div class="expense-details">
          <h4>${escapeHtml(e.itemName)}</h4>
          <p>${categoryTag} ${qtyDisplay} | ${e.date} ${linkInfo}</p>
          ${e.notes ? `<p style="font-style: italic; opacity: 0.8;">Note: ${escapeHtml(e.notes)}</p>` : ''}
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <span class="expense-cost">${formatPrice(e.cost)}</span>
          <button class="delete-btn" onclick="deleteExpense('${e.id}')" title="ဖျက်ရန်">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// 9. Delete logged expense
function deleteExpense(expId) {
  if (confirm("ဤစရိတ်မှတ်တမ်းအား အပြီးတိုင် ဖျက်ပစ်ပါမည်လား?")) {
    const exp = state.marketExpenses.find(e => e.id === expId);
    if (exp && exp.addedToInventory && exp.productId && exp.addQty) {
      const prod = state.products.find(p => p.id === exp.productId);
      if (prod) {
        prod.stock = Math.max(0, (prod.stock || 0) - exp.addQty);
      }
    }
    state.marketExpenses = state.marketExpenses.filter(e => e.id !== expId);
    saveLocalState();
    populateProductsDropdown();
    renderSummary();
    renderList();
    alert("ဈေးဝယ်စရိတ်မှတ်တမ်းအား ဖျက်သိမ်းပြီးပါပြီ! 🗑️");
  }
}

// Helper to escape HTML tags for security
function escapeHtml(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Run on load
window.onload = init;
