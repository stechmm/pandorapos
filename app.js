// Restaurant POS Main Application Logic

// --- STATE MANAGEMENT ---
let state = {
  categories: [],
  products: [],
  tables: [],
  orders: [],
  salesHistory: [],
  marketExpenses: [],
  settings: {},
  users: [],
  currentUser: null,
  currentCart: {
    type: 'dine-in', // 'dine-in' or 'takeaway'
    tableId: null,
    activeOrderId: null,
    draftOrderId: null,
    items: [],
    subtotal: 0,
    discount: 0,
    tax: 0,
    total: 0
  },
  activeTab: 'dashboard-pane',
  selectedCategoryId: null,
  taxPresets: [],
  discountPresets: [],
  paymentMethods: [],
  activeFloorId: 'main',
  register: null
};

const OFFLINE_STORAGE_KEY = 'PANDORA_POS_FULL_UI_OFFLINE_STATE_V5';
let SERVER_API = 'api/index.php';
const LOCAL_PRINT_BRIDGE_URLS = ['http://127.0.0.1:4788', 'http://localhost:4788'];
let serverCsrfToken = null;
let serverStateVersion = 0;
let serverReady = false;
let cachedLocalIp = null; // cached local IP for tablet connection display
let serverApplyingState = false;
let serverSaveTimer = null;
let serverWriteInFlight = false;
let serverPollTimer = null;
let sseSource = null;       // Server-Sent Events source for real-time push
const OFFLINE_DEMO_MODE = false;
const BYPASS_LOGIN_FOR_DEMO = false;
const DEMO_USER = { id: 'u1', username: 'admin', name: 'Admin 1', role: 'admin' };
const DEFAULT_PAYMENT_METHODS = [
  { id: 'pay-cash', name: 'Cash' },
  { id: 'pay-kpay', name: 'KPAY' },
  { id: 'pay-mmqr', name: 'MMQR' }
];
const DEFAULT_VOUCHER_SETTINGS = {
  voucherTitle: 'Pandora POS',
  voucherAddress: '',
  voucherPhone: '',
  voucherFooter: 'Thank you for your purchase.',
  voucherShowLogo: true,
  voucherPaperSize: '80mm',
  printerCutPaper: false,
  brandLogoDataUrl: ''
};
const OWNER_DEFAULT_USER = {
  id: 'u4',
  username: 'owner',
  password: '123',
  role: 'owner',
  name: 'Owner',
  allowedTabs: ['dashboard-pane', 'reports-pane']
};

function ensureDemoUserSession() {
  if (!BYPASS_LOGIN_FOR_DEMO) return;
  state.currentUser = { ...DEMO_USER };
  localStorage.setItem('POS_PERSISTENT_USER', JSON.stringify(state.currentUser));
}

function normalizePaymentMethods() {
  const existing = Array.isArray(state.paymentMethods) ? state.paymentMethods : [];
  const byName = new Map(existing.map(m => [String(m.name || '').toLowerCase(), m]));
  state.paymentMethods = DEFAULT_PAYMENT_METHODS.map(base => {
    const old = byName.get(base.name.toLowerCase());
    return { id: old?.id || base.id, name: base.name };
  });
}

function ensureVoucherSettings() {
  if (!state.settings) state.settings = {};
  Object.entries(DEFAULT_VOUCHER_SETTINGS).forEach(([key, value]) => {
    if (state.settings[key] === undefined || state.settings[key] === null) {
      state.settings[key] = key === 'voucherTitle'
        ? (state.settings.restaurantName || value)
        : value;
    }
  });
}

function getBrandLogoSrc() {
  return state.settings?.brandLogoDataUrl || 'logo.png';
}

function formatBrandNameHtml(name) {
  const safeName = escapeHtml(String(name || 'Pandora POS').trim() || 'Pandora POS');
  return `${safeName}<br><span style="font-size: 0.72rem; font-weight: 600; opacity: 0.8; color: var(--accent-primary); letter-spacing: 0.5px;">POS</span>`;
}

function ensureOwnerUser() {
  if (!Array.isArray(state.users)) state.users = [];
  const existingOwner = state.users.find(user => String(user.username || '').toLowerCase() === 'owner');
  if (!existingOwner) {
    state.users.push({ ...OWNER_DEFAULT_USER });
    return;
  }
  existingOwner.role = 'owner';
  existingOwner.name = existingOwner.name || 'Owner';
  if (!Array.isArray(existingOwner.allowedTabs) || existingOwner.allowedTabs.length === 0) {
    existingOwner.allowedTabs = [...OWNER_DEFAULT_USER.allowedTabs];
  }
}

// Helper to get local date string (YYYY-MM-DD) reliably
function getLocalDateString(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Initialize State from LocalStorage or Mock Data
function initApp() {
  const localData = localStorage.getItem(OFFLINE_STORAGE_KEY);
  if (localData) {
    try {
      state = JSON.parse(localData);
      
      const mock = window.POS_MOCK_DATA;
      
      // Schema validation and migration to 1-level categories
      const cat1 = state.categories ? state.categories.find(c => c.id === 'c1') : null;
      if (state.menus !== undefined || !state.categories || state.categories.length === 0 || typeof state.categories[0] === 'string' || state.categories[0].color === undefined || (cat1 && cat1.color === '#ff7b00')) {
        state.categories = [...mock.categories];
        state.products = [...mock.products];
        delete state.menus;
        delete state.selectedMenuId;
      }
      if (!state.tables || state.tables.length === 0 || state.tables[0].x === undefined) {
        state.tables = [...mock.tables];
      }
      if (!state.users || state.users.length === 0) {
        state.users = [...mock.users];
      }
      ensureOwnerUser();
      
      // Force update admin name if cached in local storage
      if (state.users) {
        state.users.forEach(u => {
          if (u.username === 'admin' && (u.name.includes('á€€á€­á€¯á€™á€„á€ºá€¸á€™á€„á€ºá€¸') || u.name === 'Admin')) {
            u.name = 'Admin 1';
          }
        });
      }
      if (state.currentUser && state.currentUser.username === 'admin' && (state.currentUser.name.includes('á€€á€­á€¯á€™á€„á€ºá€¸á€™á€„á€ºá€¸') || state.currentUser.name === 'Admin')) {
        state.currentUser.name = 'Admin 1';
      }
      
      if (state.currentUser === undefined) {
        state.currentUser = null;
      }
      if (state.settings && state.settings.restaurantName === "Pandora Food House") {
        state.settings.restaurantName = "Pandora POS";
      }
      if (state.settings && !state.settings.drinksPrinterName) {
        state.settings.drinksPrinterName = "POS-80 Drinks Printer (Simulated)";
      }
      ensureVoucherSettings();
      
      // Ensure defaults for active filter
      if (!state.selectedCategoryId && state.categories.length > 0) {
        state.selectedCategoryId = state.categories[0].id;
      }
      
      // Ensure presets are initialized and deduplicated
      if (!state.taxPresets || state.taxPresets.length === 0) {
        state.taxPresets = [
          { id: 'tax-none', name: 'No Tax', value: 0 },
          { id: 'tax-5', name: 'Commercial Tax (5%)', value: 5 },
          { id: 'tax-10', name: 'Service Tax (10%)', value: 10 }
        ];
      } else {
        const seen = new Set();
        state.taxPresets = state.taxPresets.filter(t => {
          const key = t.id || `${t.name}_${t.value}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      if (!state.discountPresets || state.discountPresets.length === 0) {
        state.discountPresets = [
          { id: 'disc-none', name: 'No Discount', value: 0, type: 'percent' },
          { id: 'disc-5', name: 'Member Discount (5%)', value: 5, type: 'percent' },
          { id: 'disc-10', name: 'Happy Hour (10%)', value: 10, type: 'percent' },
          { id: 'disc-1000', name: 'Promo Coupon (1,000 MMK)', value: 1000, type: 'fixed' }
        ];
      } else {
        const seen = new Set();
        state.discountPresets = state.discountPresets.filter(d => {
          const key = d.id || `${d.name}_${d.value}_${d.type}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      
      // Ensure payment methods are initialized
      normalizePaymentMethods();
      
      // Ensure loyalty customers database is initialized
      if (!state.customers || state.customers.length === 0) {
        state.customers = [
          { id: 'cust-1', name: 'Customer 1', phone: '09771234567', points: 150, totalSpending: 150000 },
          { id: 'cust-2', name: 'Customer 2', phone: '09778765432', points: 340, totalSpending: 340000 },
          { id: 'cust-3', name: 'Customer 3', phone: '09440987654', points: 0, totalSpending: 0 }
        ];
      }
      
      // Ensure active floor is initialized
      if (!state.activeFloorId) {
        state.activeFloorId = 'main';
      }
      
      // Migrate tables to include floor attribute
      if (state.tables) {
        state.tables.forEach(t => {
          if (!t.floor) {
            t.floor = t.id <= 4 ? 'main' : '2nd';
          }
        });
      }
      // Ensure all products have a station property
      if (state.products) {
        state.products.forEach(p => {
          if (!p.station) {
            p.station = p.categoryId === 'c2' ? 'Bar' : 'Hot Kitchen';
          }
        });
      }
      
      // Ensure register state exists
      if (state.register === undefined) {
        state.register = null;
      }
      if (!state.transactionHistory) {
        state.transactionHistory = [];
      }
      if (!state.inventory) {
        state.inventory = [
          { id: 'inv-1', name: 'Coca Cola', stock: 48, unit: 'pcs', minStock: 10 },
          { id: 'inv-2', name: 'Water', stock: 120, unit: 'bottles', minStock: 20 },
          { id: 'inv-3', name: 'Noodle Pack', stock: 60, unit: 'packs', minStock: 15 },
          { id: 'inv-4', name: 'Eggs', stock: 180, unit: 'pcs', minStock: 30 }
        ];
      }
      if (!state.inventoryTransactions) {
        state.inventoryTransactions = [
          { id: 'tx-1', itemId: 'inv-1', itemName: 'Coca Cola', qty: 48, type: 'add', notes: 'Initial setup', timestamp: new Date().toISOString() }
        ];
      }
      
      // Ensure cart is reset on load to prevent weird states
      clearCart();
    } catch (e) {
      console.error("Error loading local state, falling back to mock data", e);
      loadMockData();
    }
  } else {
    loadMockData();
  }
  
  // Offline demo mode: keep data local and skip live/cloud sync boot.
  if (!OFFLINE_DEMO_MODE) initFirebaseLiveSync();

  applySettings();
  applyFontScale();
  setupEventListeners();
  startClock();
  
  // Login Check
  state.currentUser = OFFLINE_DEMO_MODE ? { ...DEMO_USER } : null;
  ensureDemoUserSession();
  checkLoginSession();

  if (!OFFLINE_DEMO_MODE) restoreServerSession();
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    // Check if script is already injected
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script ${url}`));
    document.head.appendChild(script);
  });
}

async function apiRequest(action, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (serverCsrfToken && options.method && options.method !== 'GET') {
    headers['X-CSRF-Token'] = serverCsrfToken;
  }
  const method = options.method || 'GET';
  const cacheBuster = method === 'GET' ? `&_=${Date.now()}` : '';
  const url = `${SERVER_API}?action=${encodeURIComponent(action)}${cacheBuster}`;
  
  const response = await fetch(url, {
    credentials: 'include',   // Must be 'include' for cross-origin Cloudflare proxy cookie support
    cache: 'no-store',
    ...options,
    headers
  });
  let payload;
  try {
    payload = await response.json();
  } catch (jsonError) {
    throw new Error(`Invalid server response format (non-JSON): ${jsonError.message}`);
  }
  
  if (!response.ok) {
    const error = new Error(payload.error || `Server request failed (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function sharedServerState(source = state) {
  const excluded = new Set(['currentUser', 'currentCart', 'activeTab', 'selectedCategoryId']);
  const shared = {};
  Object.entries(source).forEach(([key, value]) => {
    if (!excluded.has(key)) shared[key] = value;
  });
  return JSON.parse(JSON.stringify(shared));
}

function hasBusinessData(candidate) {
  return Boolean(
    (candidate.salesHistory && candidate.salesHistory.length) ||
    (candidate.marketExpenses && candidate.marketExpenses.length) ||
    (candidate.orders && candidate.orders.length)
  );
}

function applyServerState(remoteState) {
  if (!remoteState) return;
  const localSession = {
    currentUser: state.currentUser,
    currentCart: state.currentCart,
    activeTab: state.activeTab,
    selectedCategoryId: state.selectedCategoryId
  };
  serverApplyingState = true;
  Object.assign(state, remoteState, localSession);
  ensureOwnerUser();
  ensureVoucherSettings();
  localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(state));
  serverApplyingState = false;

  // Re-render ALL panels so any active view shows updated data immediately
  // Wrapped in try-catch so one panel failure doesn't stop the rest
  const safeRender = (fn) => { try { if (typeof fn === 'function') fn(); } catch(e) { console.warn('[applyServerState] render error:', e.message); } };

  safeRender(applySettings);
  safeRender(applyFontScale);
  safeRender(renderProducts);         // POS product list
  safeRender(renderCart);             // POS cart / active order panel
  safeRender(renderActiveOrdersList); // Active orders list
  safeRender(renderSalesCounter);     // Sales counter badge
  safeRender(renderTablesFloorMap);   // Table floor map
  safeRender(renderKitchenDisplay);   // Kitchen display
  safeRender(renderMarketPane);       // Expenses
  safeRender(renderReportsPane);      // Reports
  safeRender(renderDashboard);        // Dashboard
  safeRender(renderSettingsPane);     // Settings
  safeRender(renderInventoryStatus);  // Inventory
  safeRender(renderLoyaltyMembersList); // Loyalty members
  safeRender(renderInventoryPane);
  safeRender(normalizeStaticUiLabels);
}

async function restoreServerSession() {
  if (OFFLINE_DEMO_MODE) return;
  const localCandidate = sharedServerState();
  try {
    const session = await apiRequest('status', { method: 'GET' });
    
    // Display local IP for waiter tablet connections if server provides it
    if (session && session.localIp) {
      displayLocalIpAddress(session.localIp);
    } else {
      displayLocalIpAddress(null);
    }

    if (!session.authenticated) {
      if (BYPASS_LOGIN_FOR_DEMO) {
        try {
          const login = await apiRequest('login', {
            method: 'POST',
            body: JSON.stringify({ username: DEMO_USER.username, password: '1991' })
          });
          serverCsrfToken = login.csrfToken;
          state.currentUser = login.user || { ...DEMO_USER };
          localStorage.setItem('POS_PERSISTENT_USER', JSON.stringify(state.currentUser));
          checkLoginSession();
          applyServerState(state);
          await connectServerSync(localCandidate).catch(() => {});
          return;
        } catch (loginError) {
          console.warn('Demo auto-login failed:', loginError.message);
        }
      }
      state.currentUser = null;
      localStorage.removeItem('POS_PERSISTENT_USER');
      checkLoginSession();
      return;
    }
    serverCsrfToken = session.csrfToken;
    state.currentUser = session.user;
    checkLoginSession();
    applyServerState(state); // Instant local render for already logged-in users
    await connectServerSync(localCandidate);
  } catch (error) {
    console.warn('Unable to reach the POS server, checking local session:', error.message);
    state.currentUser = null;
    localStorage.removeItem('POS_PERSISTENT_USER');
    checkLoginSession();
  }
}

async function connectServerSync(localCandidate = sharedServerState()) {
  if (OFFLINE_DEMO_MODE) return;
  const hash = window.location.hash;
  const isCustomerPortal = hash.startsWith('#self-order') || hash === '#menu';

  const remote = await apiRequest('state', { method: 'GET' });
  serverStateVersion = remote.version || 0;
  if (remote.exists && remote.state) {
    serverReady = true;
    applyServerState(remote.state);
  } else {
    if (!isCustomerPortal) {
      // Initialize the empty local server with the local state immediately
      console.log('Initializing empty local server database with local state...');
      try {
        await writeServerState(localCandidate, 0);
        serverReady = true;
      } catch (writeErr) {
        console.error('Failed to initialize server state:', writeErr);
        serverReady = false;
      }
    }
  }
  if (!isCustomerPortal) {
    startSSEListener(); // Start SSE (primary) + polling (fallback) for POS staff only
  }
}

// â”€â”€ SSE Real-Time Listener â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Primary: Server pushes a lightweight "version changed" event instantly.
// Client then fetches full state only when version is newer.
// Falls back to 1.5-second polling if SSE is unsupported or disconnected.
function startSSEListener() {
  if (OFFLINE_DEMO_MODE) return;
  if (!window.EventSource) {
    console.warn('SSE not supported â€” falling back to polling only');
    startServerPolling();
    return;
  }

  function connectSSE() {
    if (sseSource) { sseSource.close(); sseSource = null; }

    const url = `${SERVER_API}?action=events&lastVersion=${serverStateVersion}&_=${Date.now()}`;
    sseSource = new EventSource(url, { withCredentials: true });

    sseSource.addEventListener('connected', () => {
      console.log('[SSE] Connected â€” real-time push active');
    });

    sseSource.addEventListener('update', async () => {
      // Server says version changed â€” fetch latest full state immediately
      // Note: do NOT block on serverSaveTimer â€” local cart is preserved by applyServerState()
      if (serverWriteInFlight) return;
      try {
        const remote = await apiRequest('state', { method: 'GET' });
        if (remote.exists && remote.version > serverStateVersion) {
          serverStateVersion = remote.version;
          serverReady = true;
          applyServerState(remote.state);
          console.log('[SSE] State updated to version', remote.version);
        }
      } catch (e) {
        console.warn('[SSE] State fetch after push failed:', e.message);
      }
    });

    sseSource.addEventListener('reconnect', () => {
      // Server is about to close â€” reconnect immediately
      sseSource.close();
      setTimeout(connectSSE, 200);
    });

    sseSource.onerror = () => {
      console.warn('[SSE] Connection dropped â€” will auto-reconnect in 3s');
      sseSource.close();
      sseSource = null;
      setTimeout(connectSSE, 3000);
    };
  }

  connectSSE();

  // Keep polling as safety net in case SSE misses an event
  startServerPolling();
}

function startServerPolling() {
  if (OFFLINE_DEMO_MODE) return;
  clearInterval(serverPollTimer);
  serverPollTimer = setInterval(async () => {
    // Only skip if actively writing â€” do NOT skip on serverSaveTimer (local cart is preserved)
    if (!state.currentUser || serverWriteInFlight) return;
    try {
      const remote = await apiRequest('state', { method: 'GET' });
      if (remote.exists && remote.version > serverStateVersion) {
        serverStateVersion = remote.version;
        serverReady = true;
        applyServerState(remote.state);
        console.log('[Poll] State updated to version', remote.version);
      }
    } catch (error) {
      console.warn('Live sync poll failed:', error.message);
    }
  }, 3000); // Poll every 3 seconds as fallback for SSE
}

function mergeEntityArray(remote = [], local = []) {
  const merged = new Map();
  remote.forEach((item, index) => merged.set(String(item.id || `remote-${index}`), item));
  local.forEach((item, index) => merged.set(String(item.id || `local-${index}`), item));
  return Array.from(merged.values());
}

function mergeServerConflict(remote, local) {
  const merged = { ...remote, ...local };
  ['salesHistory', 'marketExpenses', 'orders', 'tables', 'products'].forEach(key => {
    merged[key] = mergeEntityArray(remote[key], local[key]);
  });
  return merged;
}

async function writeServerState(payload = sharedServerState(), baseVersion = serverStateVersion) {
  if (OFFLINE_DEMO_MODE) return;
  serverWriteInFlight = true;
  const MAX_RETRIES = 3;
  let attempt = 0;
  let currentBase = baseVersion;

  while (attempt < MAX_RETRIES) {
    try {
      const result = await apiRequest('state', {
        method: 'PUT',
        body: JSON.stringify({ state: payload, baseVersion: currentBase })
      });
      serverStateVersion = result.version;
      serverReady = true;
      serverWriteInFlight = false;
      return;
    } catch (error) {
      if (error.status === 409 && error.payload) {
        // Version conflict â€” fetch latest and retry with newest base
        const latest = error.payload;
        currentBase = latest.version || 0;
        serverStateVersion = currentBase;
        if (latest.state) {
          const merged = mergeServerConflict(latest.state, payload);
          payload = merged;
        }
        attempt++;
        await new Promise(r => setTimeout(r, 100 * attempt)); // back-off
        continue;
      }
      serverWriteInFlight = false;
      throw error;
    }
  }
  serverWriteInFlight = false;
  throw new Error('writeServerState: max retries exceeded');
}

function scheduleServerSave() {
  if (OFFLINE_DEMO_MODE) return;
  if (serverApplyingState || !state.currentUser || !serverReady) return;
  clearTimeout(serverSaveTimer);
  serverSaveTimer = setTimeout(async () => {
    serverSaveTimer = null;
    try {
      await writeServerState();
    } catch (error) {
      console.error('Unable to save POS data to the server:', error);
    }
  }, 350);
}

// Bypass debounce timer â€” push to server immediately for critical actions
// (Order Send, Payment, Table Transfer, etc.)
function immediateServerSave() {
  if (OFFLINE_DEMO_MODE) return;
  if (serverApplyingState || !state.currentUser || !serverReady) return;
  clearTimeout(serverSaveTimer);
  serverSaveTimer = null;
  writeServerState().catch(err =>
    console.error('Immediate server sync failed:', err)
  );
}



function loadMockData() {
  const mock = window.POS_MOCK_DATA;
  state.categories = [...mock.categories];
  state.products = [...mock.products];
  state.tables = [...mock.tables];
  state.orders = [...mock.orders];
  state.salesHistory = [...mock.salesHistory];
  state.marketExpenses = [...mock.marketExpenses];
  state.inventory = mock.inventory ? [...mock.inventory] : [
    { id: 'inv-1', name: 'Coca Cola', stock: 48, unit: 'pcs', minStock: 10 },
    { id: 'inv-2', name: 'Water', stock: 120, unit: 'bottles', minStock: 20 },
    { id: 'inv-3', name: 'Noodle Pack', stock: 60, unit: 'packs', minStock: 15 },
    { id: 'inv-4', name: 'Eggs', stock: 180, unit: 'pcs', minStock: 30 }
  ];
  state.inventoryTransactions = mock.inventoryTransactions ? [...mock.inventoryTransactions] : [
    { id: 'tx-1', itemId: 'inv-1', itemName: 'Coca Cola', qty: 48, type: 'add', notes: 'Initial setup', timestamp: new Date().toISOString() }
  ];
  state.customers = mock.customers ? [...mock.customers] : [
    { id: 'cust-1', name: 'Customer 1', phone: '09771234567', points: 150, totalSpending: 150000 },
    { id: 'cust-2', name: 'Customer 2', phone: '09778765432', points: 340, totalSpending: 340000 },
    { id: 'cust-3', name: 'Customer 3', phone: '09440987654', points: 0, totalSpending: 0 }
  ];
  state.settings = { ...mock.settings };
  ensureVoucherSettings();
  state.users = [...mock.users];
  ensureOwnerUser();
  state.currentUser = null;
  state.activeFloorId = 'main';
  state.register = null;
  
  state.taxPresets = [
    { id: 'tax-none', name: 'No Tax', value: 0 },
    { id: 'tax-5', name: 'Commercial Tax (5%)', value: 5 },
    { id: 'tax-10', name: 'Service Tax (10%)', value: 10 }
  ];
  state.discountPresets = [
    { id: 'disc-none', name: 'No Discount', value: 0, type: 'percent' },
    { id: 'disc-5', name: 'Member Discount (5%)', value: 5, type: 'percent' },
    { id: 'disc-10', name: 'Happy Hour (10%)', value: 10, type: 'percent' },
    { id: 'disc-1000', name: 'Promo Coupon (1,000 MMK)', value: 1000, type: 'fixed' }
  ];
  
  state.paymentMethods = [...DEFAULT_PAYMENT_METHODS];
  
  if (state.categories.length > 0) {
    state.selectedCategoryId = state.categories[0].id;
  }
  
  clearCart();
  saveState();
}

// --- REAL-TIME LIVE STREAM SYNC ENGINE ---
const DEVICE_ID = 'dev-' + Math.random().toString(36).substring(2, 9);

function initFirebaseLiveSync() {
  // Production sync is handled by the same-origin server API with SSE + polling.
}

function broadcastLiveUpdate() {
  // Server state saves already notify connected PC/tablet clients.
}

function applyActiveLiveState(activeState) {
  if (!activeState) return;
  let updated = false;
  
  if (activeState.tables && Array.isArray(activeState.tables)) {
    state.tables = activeState.tables;
    updated = true;
  }
  if (activeState.orders && Array.isArray(activeState.orders)) {
    state.orders = activeState.orders;
    updated = true;
  }
  if (activeState.inventory && Array.isArray(activeState.inventory)) {
    state.inventory = activeState.inventory;
    updated = true;
  }
  
  if (updated) {
    localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(state));
    renderTablesFloorMap();
    renderKitchenKDS();
    renderSalesCounter();
    renderInventoryPane();
  }
}

async function fetchServerStateInstant() {
  if (OFFLINE_DEMO_MODE) return;
  try {
    const remote = await apiRequest('state', { method: 'GET' });
    if (remote.exists && remote.version > serverStateVersion) {
      serverStateVersion = remote.version;
      serverReady = true;
      applyServerState(remote.state);
    }
  } catch (e) {
    console.warn('[Live Sync] Instant fetch failed:', e.message);
  }
}

function saveState() {
  localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(state));
  if (OFFLINE_DEMO_MODE) return;
  scheduleServerSave();
  
  // Instant Real-time Live Stream Broadcast to all connected tablets/devices
  broadcastLiveUpdate();
  
  // Auto Cloud Backup in background (runs silently on PC Desktop App only)
  triggerAutoCloudUpload();
}



function populatePrinterDropdowns() {
  const kSelect = document.getElementById('setPrinterName');
  const dSelect = document.getElementById('setDrinksPrinterName');
  if (!kSelect || !dSelect) return;
  
  const printers = state.systemPrinters || [];
  
  let optionsHTML = '';
  if (printers.length === 0) {
    optionsHTML = `
      <option value="POS-80 Kitchen Printer">POS-80 Kitchen Printer (Simulated)</option>
      <option value="POS-80 Drinks Printer (Simulated)">POS-80 Drinks Printer (Simulated)</option>
    `;
  } else {
    optionsHTML = printers.map(p => `
      <option value="${escapeHtml(p.name)}" ${p.isDefault ? 'selected' : ''}>
        ${escapeHtml(p.name)}${p.driverName ? ` - ${escapeHtml(p.driverName)}` : ''}${p.portName ? ` - ${escapeHtml(p.portName)}` : ''}${p.isDefault ? ' (Default)' : ''}
      </option>
    `).join('');
  }
  
  kSelect.innerHTML = optionsHTML;
  dSelect.innerHTML = optionsHTML;
  
  // Set current selected names
  if (state.settings.printerName) kSelect.value = state.settings.printerName;
  if (state.settings.drinksPrinterName) dSelect.value = state.settings.drinksPrinterName;
  const status = document.getElementById('printerDetectionStatus');
  if (status) {
    const lptPrinters = printers.filter(p => String(p.portName || '').toUpperCase().startsWith('LPT'));
    status.textContent = printers.length
      ? `${printers.length} printer driver(s) detected.${lptPrinters.length ? ' Warning: LPT port printers may not print if your thermal printer is USB.' : ''}`
      : 'No system printer detected yet. Simulated printers are available.';
  }
}

async function requestLocalPrintBridge(path, options = {}) {
  let lastError = null;
  for (const baseUrl of LOCAL_PRINT_BRIDGE_URLS) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        mode: 'cors',
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      return { ...payload, bridgeUrl: baseUrl };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Local print bridge is not running.');
}

async function tryPrintWithLocalBridge(html, slipType) {
  const printerName = html.includes('DRINKS COUNTER TICKET')
    ? (state.settings.drinksPrinterName || '')
    : (state.settings.printerName || '');

  const payload = await requestLocalPrintBridge('/print-html', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html,
      title: slipType === 'kitchen' ? 'Kitchen Ticket' : 'Customer Receipt',
      printerName,
      cutPaper: state.settings?.printerCutPaper === true,
      paperSize: slipType === 'kitchen' ? '58mm' : (state.settings.voucherPaperSize || '80mm')
    })
  });
  return payload?.ok === true;
}

async function refreshSystemPrinters() {
  const status = document.getElementById('printerDetectionStatus');
  const btn = document.getElementById('refreshPrintersBtn');
  if (status) status.textContent = 'Detecting printer drivers...';
  if (btn) btn.disabled = true;
  try {
    try {
      const localPayload = await requestLocalPrintBridge('/printers', { method: 'GET' });
      const localPrinters = Array.isArray(localPayload.printers) ? localPayload.printers : [];
      if (localPrinters.length) {
        state.systemPrinters = localPrinters;
        populatePrinterDropdowns();
        if (status) status.textContent = `${localPrinters.length} local printer driver(s) detected via Pandora Print Bridge.`;
        return;
      }
    } catch (bridgeError) {
      console.warn('Local print bridge unavailable:', bridgeError);
    }

    const payload = await apiRequest('printers', { method: 'GET' });
    state.systemPrinters = Array.isArray(payload.printers) ? payload.printers : [];
    populatePrinterDropdowns();
  } catch (error) {
    console.warn('Printer detection failed:', error);
    if (status) status.textContent = 'Printer detection failed. Start Pandora Print Bridge on this cashier PC.';
  } finally {
    if (btn) btn.disabled = false;
  }
}

function switchRestaurantSettingsTab(tabName) {
  const tabIds = ['brand', 'printers', 'voucher', 'presets', 'users'];
  tabIds.forEach(id => {
    const pane = document.getElementById(`settingsTabPane_${id}`);
    const btn = document.getElementById(`settingsTabBtn_${id}`);
    const active = id === tabName;
    if (pane) pane.style.display = active ? 'block' : 'none';
    if (btn) btn.classList.toggle('active', active);
  });
  if (tabName === 'voucher') renderVoucherSettingsPreview();
}

function renderVoucherSettingsPreview() {
  const preview = document.getElementById('voucherSettingsPreview');
  if (!preview) return;

  const title = document.getElementById('setVoucherTitle')?.value.trim()
    || state.settings.voucherTitle
    || state.settings.restaurantName
    || 'Pandora POS';
  const phone = document.getElementById('setVoucherPhone')?.value.trim()
    || state.settings.voucherPhone
    || '09 123 456 789';
  const address = document.getElementById('setVoucherAddress')?.value.trim()
    || state.settings.voucherAddress
    || 'No. 12, Main Street';
  const footer = document.getElementById('setVoucherFooter')?.value.trim()
    || state.settings.voucherFooter
    || 'Thank you.';
  preview.innerHTML = `
    <div class="voucher-preview-center">
      <div class="voucher-preview-strong">${escapeHtml(title)}</div>
      <div>${escapeHtml(address)}</div>
      <div>Phone: ${escapeHtml(phone)}</div>
    </div>
    <div class="voucher-preview-line"></div>
    <div class="voucher-preview-row"><span>Bill</span><span>DEMO-001</span></div>
    <div class="voucher-preview-row"><span>Cashier</span><span>Admin</span></div>
    <div class="voucher-preview-line"></div>
    <div class="voucher-preview-row"><span>Chicken Noodle x1</span><span>5,000</span></div>
    <div class="voucher-preview-row"><span>Coca Cola x2</span><span>5,000</span></div>
    <div class="voucher-preview-line"></div>
    <div class="voucher-preview-row"><span>Subtotal</span><span>10,000</span></div>
    <div class="voucher-preview-row"><span>Tax</span><span>0</span></div>
    <div class="voucher-preview-row voucher-preview-strong"><span>Total</span><span>10,000 MMK</span></div>
    <div class="voucher-preview-line"></div>
    <div class="voucher-preview-center">${escapeHtml(footer)}</div>
  `;
}

function applySettings() {
  ensureVoucherSettings();
  // Hide Cloud Backup & Sync options on browsers/tablets (only show on PC Desktop App)
  const cloudSec = document.getElementById('settingsCloudSyncSection');
  if (cloudSec) {
    const isElectron = !!(window.chrome && window.chrome.ipcRenderer || navigator.userAgent.indexOf('Electron') > -1);
    cloudSec.style.display = isElectron ? 'flex' : 'none';
  }
  // Apply theme
  document.documentElement.setAttribute('data-theme', state.settings.darkMode ? 'dark' : 'light');
  const themeIcon = document.getElementById('themeTogglerIcon');
  if (themeIcon) {
    themeIcon.className = state.settings.darkMode ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  }
  
  // Apply restaurant name
  const restNameDisplays = document.querySelectorAll('#restaurantNameDisplay');
  restNameDisplays.forEach(el => el.textContent = state.settings.restaurantName);
  const brandLogoSrc = getBrandLogoSrc();
  document.querySelectorAll('.app-brand-logo').forEach(img => {
    img.src = brandLogoSrc;
    img.alt = `${state.settings.restaurantName || 'Shop'} Logo`;
  });
  const brandName = document.getElementById('appBrandName');
  if (brandName) brandName.innerHTML = formatBrandNameHtml(state.settings.restaurantName);
  document.title = `${state.settings.restaurantName || 'Pandora POS'} - POS System`;
  
  // Settings Form values
  const setRestName = document.getElementById('setRestName');
  const setTaxRate = document.getElementById('setTaxRate');
  const setCurrency = document.getElementById('setCurrency');
  const setPrinterName = document.getElementById('setPrinterName');
  
  if (setRestName) setRestName.value = state.settings.restaurantName;
  const setBrandLogoPreview = document.getElementById('setBrandLogoPreview');
  const setBrandLogoDataUrl = document.getElementById('setBrandLogoDataUrl');
  if (setBrandLogoPreview) setBrandLogoPreview.src = brandLogoSrc;
  if (setBrandLogoDataUrl) setBrandLogoDataUrl.value = state.settings.brandLogoDataUrl || '';
  if (setTaxRate) setTaxRate.value = state.settings.taxRate;
  populatePrinterDropdowns();
  if (setCurrency) setCurrency.value = state.settings.currency;
  if (setPrinterName) setPrinterName.value = state.settings.printerName;
  
  const setDrinksPrinterName = document.getElementById('setDrinksPrinterName');
  if (setDrinksPrinterName) {
    setDrinksPrinterName.value = state.settings.drinksPrinterName || "POS-80 Drinks Printer (Simulated)";
  }
  const setPrinterCutPaper = document.getElementById('setPrinterCutPaper');
  if (setPrinterCutPaper) setPrinterCutPaper.checked = state.settings.printerCutPaper === true;
  const setVoucherTitle = document.getElementById('setVoucherTitle');
  const setVoucherAddress = document.getElementById('setVoucherAddress');
  const setVoucherPhone = document.getElementById('setVoucherPhone');
  const setVoucherFooter = document.getElementById('setVoucherFooter');
  if (setVoucherTitle) setVoucherTitle.value = state.settings.voucherTitle || state.settings.restaurantName || 'Pandora POS';
  if (setVoucherAddress) setVoucherAddress.value = state.settings.voucherAddress || '';
  if (setVoucherPhone) setVoucherPhone.value = state.settings.voucherPhone || '';
  if (setVoucherFooter) setVoucherFooter.value = state.settings.voucherFooter || '';
  const setVoucherPaperSize = document.getElementById('setVoucherPaperSize');
  if (setVoucherPaperSize) setVoucherPaperSize.value = state.settings.voucherPaperSize || '80mm';
  [setVoucherTitle, setVoucherAddress, setVoucherPhone, setVoucherFooter, setVoucherPaperSize].forEach(el => {
    if (el && !el.dataset.voucherPreviewBound) {
      el.addEventListener('input', renderVoucherSettingsPreview);
      el.addEventListener('change', renderVoucherSettingsPreview);
      el.dataset.voucherPreviewBound = '1';
    }
  });
  renderVoucherSettingsPreview();
  
  // Online sync uses the same origin the app was loaded from.
  SERVER_API = 'api/index.php';

  // Refresh tablet connection IP display and cloud URL input
  displayLocalIpAddress(cachedLocalIp);
  const cloudUrlInput = document.getElementById('settingsCloudApiUrl');
  if (cloudUrlInput && !cloudUrlInput.dataset.userEditing) {
    cloudUrlInput.value = state.settings.serverApiUrl || '';
  }
  
  const setEnableChatBot = document.getElementById('setEnableChatBot');
  if (setEnableChatBot) {
    setEnableChatBot.checked = state.settings.enableChatBot !== false;
  }
  
  const botWidget = document.getElementById('aiChatBotWidget');
  if (botWidget) {
    botWidget.style.display = state.settings.enableChatBot !== false ? 'block' : 'none';
  }
  
  // Update settings tab UI elements
  updateSettingsPaneUI();
  applyFloorBackground();
}

function changeFloorBackground(value) {
  state.settings.floorBg = value;
  saveState();
  applyFloorBackground();
}

function applyFloorBackground() {
  const container = document.getElementById('tablesFloorContainer');
  if (!container) return;
  
  const bgType = state.settings.floorBg || 'default';
  if (bgType === 'decor') {
    container.classList.add('decor-bg');
  } else {
    container.classList.remove('decor-bg');
  }
  
  const select = document.getElementById('floorBgSelector');
  if (select) {
    select.value = bgType;
  }
}

// --- HELPERS ---
function formatPrice(number) {
  return new Intl.NumberFormat().format(number) + ' ' + (state.settings.currency || 'MMK');
}

function generateId(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).substr(2, 9)}`;
}

function generateSequentialOrderId() {
  if (!state.nextOrderId) {
    let maxId = 0;
    const allIds = [
      ...(state.salesHistory || []).map(s => s.id),
      ...(state.orders || []).map(o => o.id)
    ];
    allIds.forEach(id => {
      if (id && /^\d+$/.test(id)) {
        const val = parseInt(id, 10);
        if (val > maxId) maxId = val;
      }
    });
    state.nextOrderId = maxId + 1;
  }
  const orderIdStr = String(state.nextOrderId).padStart(9, '0');
  state.nextOrderId++;
  saveState();
  return orderIdStr;
}

function startClock() {
  const clockEl = document.getElementById('currentTimeDisplay');
  function updateTime() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  updateTime();
  setInterval(updateTime, 1000);
}

// --- ROUTING / TAB SWITCHING ---
function setupEventListeners() {
  // Navigation tabs
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.getAttribute('data-tab');
      switchTab(tabId);
    });
  });
  
  // Theme toggler
  const themeToggler = document.getElementById('themeTogglerBtn');
  if (themeToggler) {
    themeToggler.addEventListener('click', () => {
      state.settings.darkMode = !state.settings.darkMode;
      saveState();
      applySettings();
    });
  }
  
  // Product Search input
  const searchInput = document.getElementById('productSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderProducts();
    });
  }
  
  // Clear Cart
  const clearCartBtn = document.getElementById('clearCartBtn');
  if (clearCartBtn) {
    clearCartBtn.addEventListener('click', () => {
      clearCart();
      renderCart();
    });
  }
  
  // Cart table select listener
  const cartTableSelect = document.getElementById('cartTableSelect');
  if (cartTableSelect) {
    cartTableSelect.addEventListener('change', (e) => {
      state.currentCart.tableId = e.target.value ? parseInt(e.target.value) : null;
    });
  }
  
  // Send button
  const cartSendBtn = document.getElementById('cartSendBtn');
  if (cartSendBtn) {
    cartSendBtn.addEventListener('click', () => {
      processSendAction();
    });
  }
  
  // Payment button
  const cartPaymentBtn = document.getElementById('cartPaymentBtn');
  if (cartPaymentBtn) {
    cartPaymentBtn.addEventListener('click', () => {
      processPaymentAction();
    });
  }
  
  // Electron system printers listener
  const isElectron = !!(window.chrome && window.chrome.ipcRenderer || navigator.userAgent.indexOf('Electron') > -1);
  if (isElectron) {
    try {
      const { ipcRenderer } = require('electron');
      ipcRenderer.on('system-printers', (event, printers) => {
        console.log('Received system printers from main process:', printers);
        state.systemPrinters = printers || [];
        populatePrinterDropdowns();
      });
      // Request printer list from main process
      ipcRenderer.send('get-printers');
    } catch(e) {
      console.error('Electron IPC setup failed:', e);
    }
  }

  // Market expense link toggle handler
  const expLinkInventory = document.getElementById('expLinkInventory');
  if (expLinkInventory) {
    expLinkInventory.addEventListener('change', (e) => {
      const productWrapper = document.getElementById('expInventoryProductWrapper');
      if (productWrapper) {
        productWrapper.style.display = e.target.checked ? 'block' : 'none';
      }
    });
  }
  
  // Market form submit
  const marketForm = document.getElementById('marketPurchaseForm');
  if (marketForm) {
    marketForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleMarketPurchaseSubmit();
    });
  }
  
  // Settings form submit
  const settingsForm = document.getElementById('settingsGeneralForm');
  if (settingsForm) {
    settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSettingsSubmit();
    });
  }
  
  // Menu modal form submit
  const menuModalForm = document.getElementById('menuItemAddEditForm');
  if (menuModalForm) {
    menuModalForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleMenuItemAddEditSubmit();
    });
  }
  
  // Menu item modal track inventory dependency
  const prodTrackInventory = document.getElementById('prodTrackInventory');
  if (prodTrackInventory) {
    prodTrackInventory.addEventListener('change', (e) => {
      const stockWrapper = document.getElementById('prodInitialStockWrapper');
      if (stockWrapper) {
        stockWrapper.style.display = e.target.checked ? 'block' : 'none';
      }
    });
  }



  // Category Modal submit
  const categoryForm = document.getElementById('categoryAddEditForm');
  if (categoryForm) {
    categoryForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleCategoryAddEditSubmit();
    });
  }
  
  // Physical keyboard support for PIN pad
  document.addEventListener('keydown', (e) => {
    const overlay = document.getElementById('loginScreenOverlay');
    if (overlay && overlay.classList.contains('active')) {
      if (e.key >= '0' && e.key <= '9') {
        pressPinKey(e.key);
      } else if (e.key === 'Backspace') {
        pressPinKey('back');
      } else if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') {
        pressPinKey('C');
      } else if (e.key === 'Enter') {
        submitPinLogin();
      }
    }
  });
  
  // Logout button click
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      handleLogout();
    });
  }
  
  // User Modal form submit
  const userModalForm = document.getElementById('userAddEditForm');
  if (userModalForm) {
    userModalForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleUserAddEditSubmit();
    });
  }

  const userRoleSelect = document.getElementById('usrRole');
  if (userRoleSelect) {
    userRoleSelect.addEventListener('change', () => setUserAccessFromRole());
  }
  
  // Table Modal form submit
  const tableModalForm = document.getElementById('tableAddEditForm');
  if (tableModalForm) {
    tableModalForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleTableAddEditSubmit();
    });
  }
  
  // Register Open Form submit
  const openRegForm = document.getElementById('openRegisterForm');
  if (openRegForm) {
    openRegForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitOpenRegister();
    });
  }
  
  // Cash In/Out Form submit
  const cashForm = document.getElementById('cashInOutForm');
  if (cashForm) {
    cashForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitCashInOut();
    });
  }
  
  // Payment Method Form submit
  const payMethodForm = document.getElementById('paymentMethodAddEditForm');
  if (payMethodForm) {
    payMethodForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitPaymentMethod();
    });
  }
  
  // Close Register dropdown when clicking outside
  window.addEventListener('click', (e) => {
    const dropdown = document.getElementById('registerDropdownContent');
    const trigger = document.getElementById('registerDropdownTrigger');
    if (dropdown && trigger && dropdown.style.display === 'block') {
      if (!trigger.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    }

    const tableDropdown = document.getElementById('tableManageDropdown');
    const tableActions = document.getElementById('tableManageActions');
    if (tableDropdown && tableActions && tableDropdown.style.display === 'block' && !tableActions.contains(e.target)) {
      tableDropdown.style.display = 'none';
    }
  });
  
  // Font scale buttons
  const fontDecrease = document.getElementById('fontScaleDecreaseBtn');
  if (fontDecrease) fontDecrease.addEventListener('click', () => adjustFontScale(-1));
  
  const fontReset = document.getElementById('fontScaleResetBtn');
  if (fontReset) fontReset.addEventListener('click', () => adjustFontScale(0));
  
  const fontIncrease = document.getElementById('fontScaleIncreaseBtn');
  if (fontIncrease) fontIncrease.addEventListener('click', () => adjustFontScale(1));
  
  // Theme settings button
  const settingsThemeBtn = document.getElementById('settingsThemeToggleBtn');
  if (settingsThemeBtn) settingsThemeBtn.addEventListener('click', () => toggleThemeSettings());
  
  // Language settings select
  initLanguageSetting();
  
  // Category search more trigger listener
  const prodCategorySelect = document.getElementById('prodCategory');
  if (prodCategorySelect) {
    prodCategorySelect.addEventListener('change', (e) => {
      if (e.target.value === 'SEARCH_MORE') {
        // Reset select back to previously selected or default option so it doesn't stay on SEARCH_MORE
        e.target.value = state.lastSelectedProdCategoryId || (state.categories.length > 0 ? state.categories[0].id : '');
        openSearchCategoryModal();
      } else {
        state.lastSelectedProdCategoryId = e.target.value;
      }
    });
  }
}

function switchTab(tabId) {
  if (state.currentUser && !canUserAccessTab(state.currentUser, tabId)) {
    alert("Access denied.");
    return;
  }
  
  state.activeTab = tabId;
  saveState();
  
  // Update nav UI active class
  document.querySelectorAll('.nav-item').forEach(item => {
    if (item.getAttribute('data-tab') === tabId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
  
  // Update Pane Visibility
  document.querySelectorAll('.content-pane').forEach(pane => {
    if (pane.id === tabId) {
      pane.classList.add('active');
    } else {
      pane.classList.remove('active');
    }
  });
  
  // Update Header Title
  const pageTitle = document.getElementById('pageTitleDisplay');
  if (pageTitle) {
    const friendlyNames = {
      'dashboard-pane': 'Dashboard',
      'sales-pane': 'Checkout Counter',
      'kitchen-pane': 'Kitchen KDS',
      'market-pane': 'Expenses',
      'inventory-pane': 'Inventory Management',
      'reports-pane': 'Reports',
      'settings-pane': 'POS Settings',
      'admin-pane': 'Admin Management Panel'
    };
    pageTitle.textContent = friendlyNames[tabId] || 'POS System';
  }
  
  // Render specific tab content
  if (tabId === 'dashboard-pane') {
    renderDashboard();
  } else if (tabId === 'inventory-pane') {
    renderInventoryPane();
  } else if (tabId === 'sales-pane') {
    renderSalesCounter();
    // Intelligently restore correct POS mode
    if (!state.currentCart.tableId && state.currentCart.type !== 'takeaway') {
      setPosMode('tables');
    } else if (state.currentCart.type === 'takeaway') {
      setPosMode('takeaway');
    } else {
      const table = state.tables.find(t => t.id === state.currentCart.tableId);
      if (table) {
        setPosMode('products');
      } else {
        setPosMode('tables');
      }
    }
  } else if (tabId === 'kitchen-pane') {
    renderKitchenDisplay();
  } else if (tabId === 'market-pane') {
    renderMarketPane();
  } else if (tabId === 'reports-pane') {
    renderReportsPane();
  } else if (tabId === 'settings-pane') {
    updateSettingsPaneUI();
  } else if (tabId === 'admin-pane') {
    renderSettingsPane();
    switchAdminSubtab('products');
  }
  normalizeStaticUiLabels();
}

function normalizeStaticUiLabels() {
  const dashboardPane = document.getElementById('dashboard-pane');
  if (dashboardPane) {
    const statTitles = dashboardPane.querySelectorAll('.stat-card h3');
    ['Sales Today', 'Expenses Today', 'Low Stock'].forEach((label, index) => {
      if (statTitles[index]) statTitles[index].textContent = label;
    });
    const dateOptions = document.querySelectorAll('#dashboardDateFilter option');
    ['Today', '7 Days', '30 Days', '1 Year', 'All Time'].forEach((label, index) => {
      if (dateOptions[index]) dateOptions[index].textContent = label;
    });
    const soldTitle = dashboardPane.querySelector('.chart-card .card-header h2');
    const soldNote = dashboardPane.querySelector('.chart-card .card-header span');
    const popularTitle = dashboardPane.querySelector('.table-card .card-header h2');
    if (soldTitle) soldTitle.textContent = 'Items Sold Today';
    if (soldNote) soldNote.innerHTML = '<i class="fa-solid fa-pizza-slice"></i> Quantity list';
    if (popularTitle) popularTitle.textContent = 'Popular Items';
    const soldHeaders = dashboardPane.querySelectorAll('.sales-report-table th');
    ['Item', 'Category', 'Qty Sold', 'Total Sales'].forEach((label, index) => {
      if (soldHeaders[index]) soldHeaders[index].textContent = label;
    });
  }

  const kitchenPane = document.getElementById('kitchen-pane');
  if (kitchenPane) {
    const title = kitchenPane.querySelector('.kitchen-header-row h2');
    const subtitle = kitchenPane.querySelector('.kitchen-header-row p');
    if (title) title.textContent = 'Kitchen Display (KDS)';
    if (subtitle) subtitle.textContent = 'Live kitchen queue for confirmed orders.';
  }

  const inventoryPane = document.getElementById('inventory-pane');
  if (inventoryPane) {
    const layout = inventoryPane.querySelector('.market-layout');
    if (layout) layout.classList.add('inventory-management-layout');
    const cards = inventoryPane.querySelectorAll('.market-layout > div');
    if (cards[0]) cards[0].classList.add('inventory-main-card');
    if (cards[1]) cards[1].classList.add('inventory-history-card');
    const headings = inventoryPane.querySelectorAll('h3');
    if (headings[0]) headings[0].innerHTML = '<i class="fa-solid fa-boxes-stacked" style="color: var(--accent-brand-blue);"></i> Inventory Management';
    if (headings[1]) headings[1].innerHTML = '<i class="fa-solid fa-clock-rotate-left" style="color: var(--accent-success);"></i> Stock History';
    const headers = inventoryPane.querySelectorAll('thead th');
    ['Item', 'Stock', 'Unit', 'Min Stock', 'Actions'].forEach((label, index) => {
      if (headers[index]) headers[index].textContent = label;
    });
  }

  const marketPane = document.getElementById('market-pane');
  if (marketPane) {
    const inventoryStatusTitle = marketPane.querySelector('#inventoryStatusList')?.closest('div')?.querySelector('h3');
    if (inventoryStatusTitle) inventoryStatusTitle.innerHTML = '<i class="fa-solid fa-boxes-stacked" style="color: var(--accent-success);"></i> Inventory Status';
  }

  sanitizeMojibakeLeafText(document.querySelector('.content-pane.active'));
}

function sanitizeMojibakeLeafText(root) {
  if (!root) return;
  const badTextPattern = /[áÁâðï]/;
  root.querySelectorAll('*').forEach(el => {
    if (el.children.length > 0 || ['SCRIPT', 'STYLE'].includes(el.tagName)) return;
    const text = (el.textContent || '').trim();
    if (!text || !badTextPattern.test(text)) return;

    if (el.closest('#lowStockAlertsList')) {
      el.textContent = 'Stock levels are healthy';
    } else if (el.closest('#inventoryStatusList')) {
      el.textContent = 'pcs';
    } else if (el.id === 'settingsLocalIpDisplay') {
      el.textContent = 'Local server is not running yet. Open the PC desktop app first.';
    } else if (el.tagName === 'TD') {
      el.textContent = 'No data yet';
    } else if (el.tagName === 'TH') {
      el.textContent = 'Info';
    } else if (el.tagName === 'SPAN' || el.tagName === 'LABEL' || el.tagName === 'P' || el.tagName === 'DIV') {
      el.textContent = 'No data yet';
    } else if (el.tagName === 'BUTTON') {
      el.textContent = 'Action';
    }
  });
}

// --- A. DASHBOARD CONTROLLER ---
function getPaymentMethodKey(method) {
  const value = String(method || 'Cash').trim().toLowerCase();
  if (value.includes('kpay') || value.includes('kbz')) return 'kpay';
  if (value.includes('mmqr') || value.includes('qr')) return 'mmqr';
  return 'cash';
}

function getSalesPaymentSummary(sales) {
  const summary = {
    cash: { label: 'Cash', total: 0, count: 0 },
    kpay: { label: 'KPAY', total: 0, count: 0 },
    mmqr: { label: 'MMQR', total: 0, count: 0 }
  };

  (sales || []).forEach(sale => {
    const key = getPaymentMethodKey(sale.paymentMethod);
    const total = Number(sale.total || sale.subtotal || 0);
    summary[key].total += total;
    summary[key].count += 1;
  });

  return summary;
}

function renderDashboardSalesPaymentBreakdown(filteredSales) {
  const container = document.getElementById('dashboardSalesPaymentBreakdown');
  if (!container) return;

  const summary = getSalesPaymentSummary(filteredSales);
  container.innerHTML = ['cash', 'kpay', 'mmqr'].map(key => {
    const item = summary[key];
    return `<span>${item.label} ${formatPrice(item.total)}</span>`;
  }).join('');
}

function renderDashboard() {
  const filterSelect = document.getElementById('dashboardDateFilter');
  const filterMode = filterSelect ? filterSelect.value : 'today';
  
  const localToday = getLocalDateString();
  
  // Calculate date thresholds
  let thresholdDate = new Date();
  if (filterMode === '7days') {
    thresholdDate.setDate(thresholdDate.getDate() - 7);
  } else if (filterMode === '30days') {
    thresholdDate.setDate(thresholdDate.getDate() - 30);
  } else if (filterMode === '1year') {
    thresholdDate.setFullYear(thresholdDate.getFullYear() - 1);
  }
  
  const thresholdStr = getLocalDateString(thresholdDate);
  
  // 1. Filter Sales History
  let filteredSales = state.salesHistory;
  if (filterMode === 'today') {
    filteredSales = state.salesHistory.filter(s => {
      try {
        return getLocalDateString(s.timestamp) === localToday;
      } catch (e) {
        return false;
      }
    });
  } else if (filterMode !== 'all') {
    filteredSales = state.salesHistory.filter(s => {
      try {
        const saleDate = getLocalDateString(s.timestamp);
        return saleDate >= thresholdStr && saleDate <= localToday;
      } catch (e) {
        return false;
      }
    });
  }
  
  // Update UI Labels based on filter mode
  const salesTitle = document.querySelector('#dashboard-pane .stat-card:nth-child(1) h3');
  const expensesTitle = document.querySelector('#dashboard-pane .stat-card:nth-child(2) h3');
  const lowStockTitle = document.querySelector('#dashboard-pane .stat-card:nth-child(3) h3');
  
  let salesLabel = '';
  let expensesLabel = '';

  if (filterMode === 'today') {
    salesLabel = 'Sales Today';
    expensesLabel = 'Expenses Today';
  } else {
    let labelSuffix = '';
    if (filterMode === '7days') labelSuffix = ' (7 days)';
    else if (filterMode === '30days') labelSuffix = ' (30 days)';
    else if (filterMode === '1year') labelSuffix = ' (1 year)';
    else if (filterMode === 'all') labelSuffix = ' (All)';
    
    salesLabel = 'Sales' + labelSuffix;
    expensesLabel = 'Expenses' + labelSuffix;
  }
  
  if (salesTitle) salesTitle.textContent = salesLabel;
  if (expensesTitle) expensesTitle.textContent = expensesLabel;
  if (lowStockTitle) lowStockTitle.textContent = 'Low Stock';
  
  // Sum sales of only active products (excluding deleted menu items)
  const salesSum = filteredSales.reduce((sum, sale) => {
    let saleActiveSum = 0;
    if (sale.items && Array.isArray(sale.items)) {
      sale.items.forEach(item => {
        const prod = state.products.find(p => p.id === item.id);
        if (prod) {
          saleActiveSum += item.price * item.quantity;
        }
      });
      if (sale.subtotal > 0 && saleActiveSum > 0) {
        const ratio = saleActiveSum / sale.subtotal;
        const discountAlloc = (sale.discount || 0) * ratio;
        const taxAlloc = (sale.tax || 0) * ratio;
        saleActiveSum = saleActiveSum - discountAlloc + taxAlloc;
      }
    }
    return sum + saleActiveSum;
  }, 0);
  document.getElementById('statTodaySales').textContent = formatPrice(salesSum);
  renderDashboardSalesPaymentBreakdown(filteredSales);
  
  // Today's Orders (Completed in range + active orders filtered by range date)
  let todayActiveOrders = state.orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled');
  if (filterMode === 'today') {
    todayActiveOrders = todayActiveOrders.filter(o => {
      try {
        return getLocalDateString(o.timestamp) === localToday;
      } catch (e) {
        return false;
      }
    });
  } else if (filterMode !== 'all') {
    todayActiveOrders = todayActiveOrders.filter(o => {
      try {
        const orderDate = getLocalDateString(o.timestamp);
        return orderDate >= thresholdStr && orderDate <= localToday;
      } catch (e) {
        return false;
      }
    });
  }
  const todayOrdersEl = document.getElementById('statTodayOrders');
  if (todayOrdersEl) todayOrdersEl.textContent = filteredSales.length + todayActiveOrders.length;
  
  // 2. Filter Expenses
  let filteredExpenses = state.marketExpenses;
  if (filterMode === 'today') {
    filteredExpenses = state.marketExpenses.filter(e => e.date === localToday);
  } else if (filterMode !== 'all') {
    filteredExpenses = state.marketExpenses.filter(e => e.date >= thresholdStr && e.date <= localToday);
  }
  
  const expensesSum = filteredExpenses.reduce((sum, exp) => sum + exp.cost, 0);
  document.getElementById('statTodayExpenses').textContent = formatPrice(expensesSum);
  
  // Low Stock Items (stays unchanged as it's real-time current status)
  const lowStockCount = state.products.filter(p => p.track_inventory && p.stock <= 5).length;
  const lowStockEl = document.getElementById('statLowStockCount');
  if (lowStockEl) {
    lowStockEl.textContent = lowStockCount;
    const cardEl = lowStockEl.closest('.stat-card');
    if (cardEl) {
      if (lowStockCount > 0) {
        cardEl.style.setProperty('--card-color', 'var(--accent-danger)');
        cardEl.style.setProperty('--card-glow', 'var(--accent-danger-glow)');
      } else {
        cardEl.style.setProperty('--card-color', 'var(--accent-success)');
        cardEl.style.setProperty('--card-glow', 'var(--accent-success-glow)');
      }
    }
  }
  
  // 3. Render Today's Sold Items list (filtered by range)
  renderTodaySoldItems(filteredSales);
  
  // 4. Render Popular Items (filtered by range)
  renderPopularItems(filteredSales);
}

function renderTodaySoldItems(filteredSales) {
  const tbody = document.getElementById('todaySoldItemsTableBody');
  if (!tbody) return;
  
  const itemSummary = {};
  
  let targetSales = filteredSales;
  if (!targetSales) {
    const localToday = getLocalDateString();
    targetSales = state.salesHistory.filter(s => {
      try {
        return getLocalDateString(s.timestamp) === localToday;
      } catch (e) {
        return false;
      }
    });
  }
  
  // Aggregate items sold from target sales
  targetSales.forEach(sale => {
    if (sale.items && Array.isArray(sale.items)) {
      sale.items.forEach(item => {
        const originalProd = state.products.find(p => p.id === item.id);
        if (!originalProd) return; // Skip deleted menu items
        
        if (!itemSummary[item.id]) {
          let displayName = item.name || originalProd.name;
          let catName = 'Menu';
          if (originalProd.categoryId) {
            const cat = state.categories.find(c => c.id === originalProd.categoryId);
            if (cat) catName = cat.name;
          }
          itemSummary[item.id] = {
            name: displayName,
            category: catName,
            quantity: 0,
            revenue: 0
          };
        }
        itemSummary[item.id].quantity += item.quantity;
        itemSummary[item.id].revenue += item.price * item.quantity;
      });
    }
  });
  
  const sorted = Object.values(itemSummary).sort((a, b) => b.quantity - a.quantity);
  
  if (sorted.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 30px;">
          No sold items found.
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = sorted.map(item => `
    <tr>
      <td><strong>${item.name}</strong></td>
      <td><span class="expense-tag">${item.category.split(' ')[0]}</span></td>
      <td style="font-weight: 700; text-align: center;">${item.quantity} pcs</td>
      <td style="font-weight: 700; color: var(--accent-success);">${formatPrice(item.revenue)}</td>
    </tr>
  `).join('');
}

function renderPopularItems(filteredSales) {
  const container = document.getElementById('popularItemsList');
  if (!container) return;
  
  const itemCounts = {};
  
  // Initialize counts for all products
  state.products.forEach(p => {
    itemCounts[p.id] = { product: p, count: 0 };
  });
  
  let targetSales = filteredSales;
  if (!targetSales) {
    const localToday = getLocalDateString();
    targetSales = state.salesHistory.filter(s => {
      try {
        return getLocalDateString(s.timestamp) === localToday;
      } catch (e) {
        return false;
      }
    });
  }
  
  // Count sold quantities (excluding deleted items)
  targetSales.forEach(sale => {
    if (sale.items && Array.isArray(sale.items)) {
      sale.items.forEach(item => {
        if (itemCounts[item.id]) {
          itemCounts[item.id].count += item.quantity;
        }
      });
    }
  });
  
  // Filter out products with 0 count, sort, and slice
  const sorted = Object.values(itemCounts)
    .filter(entry => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  
  if (sorted.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 20px; font-size: 0.85rem;">
        á€œá€°á€€á€¼á€­á€¯á€€á€ºá€™á€»á€¬á€¸á€žá€±á€¬ á€Ÿá€„á€ºá€¸á€•á€½á€²á€…á€¬á€›á€„á€ºá€¸ á€™á€›á€¾á€­á€žá€±á€¸á€•á€«
      </div>
    `;
    return;
  }
  
  container.innerHTML = sorted.map((entry, idx) => `
    <div class="popular-item">
      <div class="popular-rank">${idx + 1}</div>
      <div class="popular-details">
        <div class="popular-name">${entry.product.name}</div>
        <div class="popular-sales">${entry.count} Pcs sold</div>
      </div>
      <div class="popular-val">${formatPrice(entry.product.price)}</div>
    </div>
  `).join('');
}

function viewActiveOrdersFromDashboard() {
  switchTab('sales-pane');
  setTimeout(() => {
    openActiveOrdersModal();
  }, 150);
}

function viewLowStockFromDashboard() {
  switchTab('market-pane');
  setTimeout(() => {
    const lowStockPanel = document.getElementById('lowStockAlertsList');
    if (lowStockPanel) {
      lowStockPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Add a brief glow effect to highlight the panel
      const parent = lowStockPanel.closest('div');
      if (parent) {
        parent.style.boxShadow = '0 0 20px var(--accent-warning)';
        parent.style.transition = 'box-shadow 0.5s ease';
        setTimeout(() => {
          parent.style.boxShadow = 'var(--shadow-sm)';
        }, 1500);
      }
    }
  }, 200);
}

function showDashboardDetail(type) {
  const modal = document.getElementById('dashboardDetailModal');
  const titleEl = document.getElementById('dashboardDetailTitle');
  const bodyEl = document.getElementById('dashboardDetailBody');
  if (!modal || !titleEl || !bodyEl) return;

  const filterSelect = document.getElementById('dashboardDateFilter');
  const filterMode = filterSelect ? filterSelect.value : 'today';
  const filterLabels = {
    today: 'Today',
    '7days': 'Last 7 Days',
    '30days': 'Last 30 Days',
    '1year': 'Last 1 Year',
    all: 'All Time'
  };
  const filterText = ` (${filterLabels[filterMode] || 'Today'})`;

  const localToday = getLocalDateString();
  let thresholdStr = '';
  if (filterMode !== 'all' && filterMode !== 'today') {
    const thresholdDate = new Date();
    if (filterMode === '7days') thresholdDate.setDate(thresholdDate.getDate() - 7);
    else if (filterMode === '30days') thresholdDate.setDate(thresholdDate.getDate() - 30);
    else if (filterMode === '1year') thresholdDate.setFullYear(thresholdDate.getFullYear() - 1);
    thresholdStr = getLocalDateString(thresholdDate);
  }

  const inSelectedRange = (dateInput) => {
    const value = getLocalDateString(dateInput);
    if (!value) return false;
    if (filterMode === 'today') return value === localToday;
    if (filterMode === 'all') return true;
    return value >= thresholdStr && value <= localToday;
  };

  const statusBadge = (status) => {
    const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Pending';
    const colors = {
      pending: ['rgba(245, 158, 11, 0.15)', 'var(--accent-warning)'],
      preparing: ['rgba(52, 152, 219, 0.15)', 'var(--accent-brand-blue)'],
      ready: ['rgba(16, 185, 129, 0.15)', 'var(--accent-success)'],
      billed: ['rgba(14, 165, 233, 0.15)', 'var(--accent-info)'],
      completed: ['rgba(16, 185, 129, 0.15)', 'var(--accent-success)']
    };
    const [bg, color] = colors[status] || ['rgba(255,255,255,0.08)', 'var(--text-secondary)'];
    return `<span class="expense-tag" style="background:${bg}; color:${color}; border-color:${color};">${label}</span>`;
  };

  const itemListText = (items = []) => {
    return items.map(item => `${escapeHtml(item.name || 'Item')} (${item.quantity || item.qty || 1})`).join(', ') || 'No items';
  };

  bodyEl.innerHTML = '';

  if (type === 'sales') {
    titleEl.textContent = 'Sales Summary' + filterText;
    const filteredSales = (state.salesHistory || []).filter(s => inSelectedRange(s.timestamp));
    const paymentSummary = getSalesPaymentSummary(filteredSales);
    const totalSalesVal = filteredSales.reduce((sum, sale) => sum + Number(sale.total || sale.subtotal || 0), 0);
    const salesCount = filteredSales.length;

    bodyEl.innerHTML = `
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:10px; margin-bottom:15px;">
        <div class="stat-card" style="padding:12px; --card-color:var(--accent-primary); cursor:default;"><div style="font-size:0.76rem; color:var(--text-secondary);">Total Sales</div><div style="font-size:1.1rem; font-weight:800;">${formatPrice(totalSalesVal)}</div><div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">${salesCount} bills</div></div>
        <div class="stat-card" style="padding:12px; --card-color:var(--accent-success); cursor:default;"><div style="font-size:0.76rem; color:var(--text-secondary);">Cash</div><div style="font-size:1.1rem; font-weight:800;">${formatPrice(paymentSummary.cash.total)}</div><div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">${paymentSummary.cash.count} bills</div></div>
        <div class="stat-card" style="padding:12px; --card-color:var(--accent-brand-blue); cursor:default;"><div style="font-size:0.76rem; color:var(--text-secondary);">KPAY</div><div style="font-size:1.1rem; font-weight:800;">${formatPrice(paymentSummary.kpay.total)}</div><div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">${paymentSummary.kpay.count} bills</div></div>
        <div class="stat-card" style="padding:12px; --card-color:var(--accent-warning); cursor:default;"><div style="font-size:0.76rem; color:var(--text-secondary);">MMQR</div><div style="font-size:1.1rem; font-weight:800;">${formatPrice(paymentSummary.mmqr.total)}</div><div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">${paymentSummary.mmqr.count} bills</div></div>
      </div>
      <div style="padding:14px 16px; border:1px solid var(--panel-border); border-radius:var(--border-radius-md); background:rgba(148,163,184,0.08); color:var(--text-secondary); font-size:0.86rem; line-height:1.5;">
        Dashboard sales summary only. For bill-by-bill history, use Reports.
      </div>
      <div style="margin-top:15px; text-align:right;"><button type="button" class="submit-btn" style="padding:8px 16px; font-size:0.85rem;" onclick="closeDashboardDetailModal(); switchTab('reports-pane');">Open Reports</button></div>`;
  } else if (type === 'orders') {
    titleEl.textContent = 'Orders Detail' + filterText;
    const activeOrders = (state.orders || []).filter(o => o.status !== 'completed' && o.status !== 'cancelled' && inSelectedRange(o.timestamp));
    const completedSales = (state.salesHistory || []).filter(s => inSelectedRange(s.timestamp));
    const totalCount = activeOrders.length + completedSales.length;
    const pendingCount = activeOrders.filter(o => o.status === 'pending').length;
    const prepCount = activeOrders.filter(o => o.status === 'preparing').length;
    const billedCount = activeOrders.filter(o => o.status === 'billed').length;

    const activeRows = activeOrders.map(o => `
      <tr style="border-bottom:1px solid var(--panel-border);">
        <td style="padding:10px 6px;"><strong>${o.id || 'N/A'}</strong><br><span style="font-size:0.75rem; color:var(--text-secondary);">${o.timestamp ? new Date(o.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</span></td>
        <td style="padding:10px 6px;">${escapeHtml(o.tableName || 'Takeaway')}</td>
        <td style="padding:10px 6px; font-size:0.82rem; white-space:normal;">${itemListText(o.items)}</td>
        <td style="padding:10px 6px;">${statusBadge(o.status || 'pending')}</td>
        <td style="padding:10px 6px; text-align:right; font-weight:800;">${formatPrice(o.total || 0)}</td>
      </tr>`).join('');

    const completedRows = completedSales.map(s => `
      <tr style="border-bottom:1px solid var(--panel-border);">
        <td style="padding:10px 6px;"><strong>${s.id || 'N/A'}</strong><br><span style="font-size:0.75rem; color:var(--text-secondary);">${s.timestamp ? new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</span></td>
        <td style="padding:10px 6px;">${escapeHtml(s.tableName || 'Takeaway')}</td>
        <td style="padding:10px 6px; font-size:0.82rem; white-space:normal;">${itemListText(s.items)}</td>
        <td style="padding:10px 6px;">${statusBadge('completed')}</td>
        <td style="padding:10px 6px; text-align:right; font-weight:800; color:var(--accent-success);">${formatPrice(s.total || 0)}</td>
      </tr>`).join('');

    bodyEl.innerHTML = `
      <div style="display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:10px; margin-bottom:15px;">
        <div class="stat-card" style="padding:10px; --card-color:var(--accent-success); cursor:default;"><div style="font-size:0.72rem; color:var(--text-secondary);">Total Orders</div><div style="font-size:1.1rem; font-weight:800;">${totalCount}</div></div>
        <div class="stat-card" style="padding:10px; --card-color:var(--accent-warning); cursor:default;"><div style="font-size:0.72rem; color:var(--text-secondary);">Pending</div><div style="font-size:1.1rem; font-weight:800;">${pendingCount}</div></div>
        <div class="stat-card" style="padding:10px; --card-color:var(--accent-brand-blue); cursor:default;"><div style="font-size:0.72rem; color:var(--text-secondary);">Preparing</div><div style="font-size:1.1rem; font-weight:800;">${prepCount}</div></div>
        <div class="stat-card" style="padding:10px; --card-color:var(--accent-danger); cursor:default;"><div style="font-size:0.72rem; color:var(--text-secondary);">Billed</div><div style="font-size:1.1rem; font-weight:800;">${billedCount}</div></div>
      </div>
      <div class="report-table-wrapper" style="max-height:400px; overflow:auto;">
        <table class="sales-report-table" style="width:100%; border-collapse:collapse;">
          <thead><tr style="text-align:left;"><th>Order ID</th><th>Table / Type</th><th>Items</th><th>Status</th><th style="text-align:right;">Total</th></tr></thead>
          <tbody>${activeRows + completedRows || '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">No orders yet.</td></tr>'}</tbody>
        </table>
      </div>
      <div style="margin-top:15px; display:flex; gap:10px; justify-content:flex-end;"><button type="button" class="submit-btn" style="padding:8px 16px; font-size:0.85rem; background:var(--accent-brand-blue);" onclick="closeDashboardDetailModal(); switchTab('sales-pane');">Open POS</button><button type="button" class="submit-btn" style="padding:8px 16px; font-size:0.85rem;" onclick="closeDashboardDetailModal(); switchTab('kitchen-pane');">Open KDS</button></div>`;
  } else if (type === 'expenses') {
    titleEl.textContent = 'Expenses Summary' + filterText;
    const filteredExpenses = (state.marketExpenses || []).filter(e => {
      if (filterMode === 'today') return e.date === localToday;
      if (filterMode === 'all') return true;
      return e.date >= thresholdStr && e.date <= localToday;
    });
    const totalExpVal = filteredExpenses.reduce((sum, e) => sum + Number(e.cost || 0), 0);
    bodyEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--panel-border); padding:15px; border-radius:var(--border-radius-md); margin-bottom:12px;"><span style="font-weight:800; color:var(--text-secondary);">Total Expenses</span><span style="font-size:1.35rem; font-weight:900; color:var(--accent-danger);">${formatPrice(totalExpVal)}</span></div>
      <div style="padding:14px 16px; border:1px solid var(--panel-border); border-radius:var(--border-radius-md); background:rgba(148,163,184,0.08); color:var(--text-secondary); font-size:0.86rem; line-height:1.5;">
        Dashboard expenses summary only. For item-by-item expense history, use Open Expenses.
      </div>
      <div style="margin-top:15px; text-align:right;"><button type="button" class="submit-btn" style="padding:8px 16px; font-size:0.85rem; background:var(--accent-danger);" onclick="closeDashboardDetailModal(); switchTab('market-pane');">Open Expenses</button></div>`;
  } else if (type === 'low_stock') {
    titleEl.textContent = 'Low Stock Items';
    const lowStockItems = (state.products || []).filter(p => p.track_inventory && p.stock <= 5);
    const rows = lowStockItems.map(prod => {
      const cat = (state.categories || []).find(c => c.id === prod.categoryId);
      return `<tr style="border-bottom:1px solid var(--panel-border);"><td><strong>${escapeHtml(prod.name)}</strong></td><td>${escapeHtml(cat ? cat.name : 'N/A')}</td><td style="text-align:center; font-weight:800; color:${prod.stock <= 0 ? 'var(--accent-danger)' : 'var(--accent-warning)'};">${prod.stock} left</td><td style="text-align:right;"><input type="number" id="restockInput_${prod.id}" class="form-control" placeholder="10" min="1" style="width:72px; height:32px; display:inline-block; margin-right:6px;"><button type="button" class="submit-btn" style="padding:6px 12px; font-size:0.8rem; background:var(--accent-success);" onclick="quickRestockProduct('${prod.id}')">Restock</button></td></tr>`;
    }).join('');
    bodyEl.innerHTML = `
      <div style="margin-bottom:12px; display:flex; justify-content:space-between; color:var(--text-secondary);"><span>Items with stock at or below <strong>5 units</strong>.</span><span>Total: <strong style="color:var(--accent-danger);">${lowStockItems.length}</strong></span></div>
      <div class="report-table-wrapper" style="max-height:400px; overflow:auto;"><table class="sales-report-table" style="width:100%;"><thead><tr><th>Item</th><th>Category</th><th style="text-align:center;">Stock</th><th style="text-align:right;">Restock</th></tr></thead><tbody>${rows || '<tr><td colspan="4" style="text-align:center; padding:30px; color:var(--text-muted);">No low stock items.</td></tr>'}</tbody></table></div>
      <div style="margin-top:15px; text-align:right;"><button type="button" class="submit-btn" style="padding:8px 16px; font-size:0.85rem; background:rgba(255,255,255,0.05); color:var(--text-primary); border:1px solid var(--panel-border);" onclick="closeDashboardDetailModal();">Close</button></div>`;
  }

  modal.classList.add('active');
}
function closeDashboardDetailModal(event) {
  const modal = document.getElementById('dashboardDetailModal');
  if (modal) {
    modal.classList.remove('active');
  }
}

function quickRestockProduct(productId) {
  const input = document.getElementById(`restockInput_${productId}`);
  if (!input) return;
  const qty = parseInt(input.value);
  if (isNaN(qty) || qty <= 0) {
    alert("Action completed.");
    return;
  }
  
  const product = state.products.find(p => p.id === productId);
  if (!product) return;
  
  // Update inventory
  product.stock += qty;
  
  // Also create a transaction/expense automatically for traceability
  const localToday = getLocalDateString();
  const restockExp = {
    id: "exp-" + Date.now(),
    itemName: `${product.name} (Restock ${qty} Pcs)`,
    cost: (product.price * 0.6) * qty, // Assume cost is 60% of price
    quantity: String(qty),
    unit: "Pcs",
    date: localToday,
    notes: `á€…á€á€±á€¬á€·á€–á€¼á€Šá€·á€ºá€žá€½á€„á€ºá€¸á€á€¼á€„á€ºá€¸ (Dashboard Quick Restock)`,
    addedToInventory: true,
    productId: product.id,
    addQty: qty
  };
  
  state.marketExpenses.unshift(restockExp);
  
  // Save State and sync
  saveState();
  
  // Show notification
  alert(`ðŸŽ‰ "${product.name}" á€€á€¯á€”á€ºá€•á€…á€¹á€…á€Šá€ºá€¸á€¡á€¬á€¸ á€…á€á€±á€¬á€· (${qty}) á€á€¯ á€–á€¼á€Šá€·á€ºá€žá€½á€„á€ºá€¸á€•á€¼á€®á€¸á€•á€«á€•á€¼á€®!\ná€€á€¯á€”á€ºá€€á€»á€…á€›á€­á€á€º: ${formatPrice(restockExp.cost)} á€¡á€–á€¼á€…á€º á€¡á€œá€­á€¯á€¡á€œá€»á€±á€¬á€€á€º á€žá€½á€„á€ºá€¸á€šá€°á€•á€¼á€®á€¸á€•á€«á€•á€¼á€®á‹`);
  
  // Update views
  renderDashboard();
  
  // Re-open detail modal to show updated stock
  showDashboardDetail('low_stock');
}

// --- B. SALES & CART CONTROLLER ---
// --- B. SALES & CART CONTROLLER ---
function renderSalesCounter() {
  // Render Categories
  const categoryScroll = document.getElementById('categoryScrollTabs');
  if (categoryScroll) {
    categoryScroll.innerHTML = state.categories.map(cat => `
      <div class="category-tab ${state.selectedCategoryId === cat.id ? 'active' : ''}" 
           style="--cat-color: ${cat.color || '#e5b72e'};" 
           onclick="selectCategory('${cat.id}')">
        ${cat.name}
      </div>
    `).join('');
  }
  
  // Render Products
  renderProducts();
  
  // Render Cart UI
  renderCart();
  
  // Render Tables Dropdown list
  populateCartTablesDropdown();
}

function selectCategory(catId) {
  state.selectedCategoryId = catId;
  saveState();
  renderSalesCounter();
}

function renderProducts() {
  const grid = document.getElementById('productsGridWrapper');
  const searchInput = document.getElementById('productSearchInput');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
  
  if (!grid) return;
  
  let filtered = state.products;
  
  // Filter by category
  if (state.selectedCategoryId) {
    filtered = filtered.filter(p => p.categoryId === state.selectedCategoryId);
  }
  
  // Filter by search query
  if (query) {
    filtered = filtered.filter(p => p.name.toLowerCase().includes(query));
  }
  
  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;">
        <i class="fa-solid fa-face-frown" style="font-size: 3rem; margin-bottom: 12px; opacity: 0.3;"></i>
        <p>No products found</p>
      </div>
    `;
    return;
  }
  
  grid.innerHTML = filtered.map(p => {
    let stockLabel = '';
    let isOutOfStock = false;
    
    if (p.track_inventory) {
      if (p.stock <= 0) {
        stockLabel = `<span class="product-stock out">Out</span>`;
        isOutOfStock = true;
      } else if (p.stock <= 5) {
        stockLabel = `<span class="product-stock low">Low (${p.stock})</span>`;
      } else {
        stockLabel = `<span class="product-stock">Stock (${p.stock})</span>`;
      }
    }
    
    const cartQty = state.currentCart.items
      .filter(item => item.id === p.id)
      .reduce((sum, item) => sum + item.quantity, 0);
    const qtyBadge = cartQty > 0 ? `<div class="product-card-qty-badge">${cartQty}</div>` : '';
    
    const cat = state.categories.find(c => c.id === p.categoryId);
    const catColor = cat ? cat.color : '#10b981';
    const hasOptions = p.options && p.options.length > 0;
    const optionsTag = hasOptions ? `<div style="font-size: 0.58rem; color: var(--accent-brand-blue); font-weight: 700; letter-spacing: 0.5px; margin-top: 1px; opacity: 0.85;"><i class="fa-solid fa-layer-group" style="margin-right: 2px;"></i>OPTIONS</div>` : '';
    
    const footerHTML = p.track_inventory ? `
      <div class="product-card-footer" style="display: flex; justify-content: center; align-items: center; margin-top: auto; padding-top: 2px; border-top: 1px solid rgba(0,0,0,0.04); width: 100%;">
        ${stockLabel}
      </div>
    ` : '';
      
    return `
      <div class="product-card" style="--prod-color: ${catColor}; opacity: ${isOutOfStock ? 0.6 : 1}; display: flex; flex-direction: column; justify-content: space-between; align-items: center; height: 85px; padding: 6px; text-align: center;" onclick="addToCart('${p.id}')">
        <div class="product-info-top" style="display: flex; flex-direction: column; align-items: center; justify-content: center; flex-grow: 1; width: 100%;">
          <div class="product-title" style="font-weight: 700; font-size: 0.78rem; line-height: 1.25; color: #1a1a1a; word-wrap: break-word; width: 100%; display: block; overflow: visible; text-align: center;">${p.name}</div>
          ${optionsTag}
        </div>
        ${footerHTML}
        ${qtyBadge}
      </div>
    `;
  }).join('');
}

function setCartType(type) {
  state.currentCart.type = type;
  
  const dineInBtn = document.getElementById('cartDineInBtn');
  const takeawayBtn = document.getElementById('cartTakeawayBtn');
  const tableSelector = document.getElementById('cartTableSelectorWrapper');
  
  if (type === 'dine-in') {
    if (dineInBtn) dineInBtn.classList.add('active');
    if (takeawayBtn) takeawayBtn.classList.remove('active');
    if (tableSelector) tableSelector.style.display = 'flex';
  } else {
    if (dineInBtn) dineInBtn.classList.remove('active');
    if (takeawayBtn) takeawayBtn.classList.add('active');
    if (tableSelector) tableSelector.style.display = 'none';
    state.currentCart.tableId = null;
  }
  saveState();
}

function addToCart(productId, selectedOptionName, selectedOptionPrice) {
  const prod = state.products.find(p => p.id === productId);
  if (!prod) return;
  
  // Stock Check
  if (prod.track_inventory && prod.stock <= 0) {
    alert("This item is out of stock.");
    return;
  }
  
  // If product has options and no option chosen yet, open options modal.
  if (prod.options && prod.options.length > 0 && selectedOptionName === undefined) {
    openProductOptionsModal(productId);
    return;
  }
  
  // Build the cart item name with option suffix
  const cartItemName = selectedOptionName ? `${prod.name} (${selectedOptionName})` : prod.name;
  const cartItemPrice = selectedOptionPrice !== undefined ? selectedOptionPrice : prod.price;
  
  // For products with options every selection is a separate line item (keyed by name+option)
  const cartItemKey = prod.options && prod.options.length > 0 ? `${prod.id}::${selectedOptionName}` : prod.id;
  
  const existing = state.currentCart.items.find(item => item.cartKey === cartItemKey);
  if (existing) {
    // Stock Check for increment
    if (prod.track_inventory && prod.stock <= existing.quantity) {
      alert("Not enough stock for this quantity.");
      return;
    }
    existing.quantity += 1;
  } else {
    state.currentCart.items.push({
      id: prod.id,
      cartKey: cartItemKey,
      name: cartItemName,
      price: cartItemPrice,
      quantity: 1,
      note: '',
      track_inventory: prod.track_inventory
    });
  }
  
  calculateCartTotals();
  renderCart();
}

// --- Product Options Modal ---
function openProductOptionsModal(productId) {
  const prod = state.products.find(p => p.id === productId);
  if (!prod || !prod.options) return;
  
  const overlay = document.getElementById('productOptionsModalOverlay');
  const titleEl = document.getElementById('productOptionsModalTitle');
  const gridEl = document.getElementById('productOptionsGrid');
  const totalEl = document.getElementById('productOptionsBasePrice');
  
  if (!overlay) return;
  
  titleEl.textContent = prod.name;
  totalEl.textContent = `Base: ${formatPrice(prod.price)}`;
  
  // Default selection: find default option
  const defaultOpt = prod.options.find(o => o.isDefault) || prod.options[0];
  
  gridEl.innerHTML = prod.options.map((opt, idx) => {
    const finalPrice = prod.price + (opt.priceModifier || 0);
    const isSelected = opt.name === defaultOpt.name;
    const priceTag = opt.priceModifier > 0 ? `+${formatPrice(opt.priceModifier)}` : formatPrice(finalPrice);
    return `
      <div class="option-modifier-card ${isSelected ? 'selected' : ''}" 
           id="opt-card-${idx}"
           onclick="selectProductOption(${idx}, ${prod.options.length})">
        <div class="option-mod-name">${opt.name}</div>
        <div class="option-mod-price">${priceTag}</div>
        <div class="option-mod-total">${formatPrice(finalPrice)}</div>
        ${opt.isDefault ? '<div class="option-mod-default-badge">Default</div>' : ''}
      </div>
    `;
  }).join('');
  
  // Store productId on button for confirm action
  const confirmBtn = document.getElementById('confirmProductOptionBtn');
  confirmBtn.setAttribute('data-product-id', productId);
  confirmBtn.setAttribute('data-selected-idx', prod.options.indexOf(defaultOpt));
  
  overlay.classList.add('active');
}

function selectProductOption(selectedIdx, totalCount) {
  // Update visual selection
  for (let i = 0; i < totalCount; i++) {
    const card = document.getElementById(`opt-card-${i}`);
    if (card) {
      card.classList.toggle('selected', i === selectedIdx);
    }
  }
  const confirmBtn = document.getElementById('confirmProductOptionBtn');
  if (confirmBtn) confirmBtn.setAttribute('data-selected-idx', selectedIdx);
}

function confirmProductOptionSelection() {
  const confirmBtn = document.getElementById('confirmProductOptionBtn');
  const productId = confirmBtn.getAttribute('data-product-id');
  const selectedIdx = parseInt(confirmBtn.getAttribute('data-selected-idx'));
  
  const prod = state.products.find(p => p.id === productId);
  if (!prod || !prod.options) return;
  
  const selectedOpt = prod.options[selectedIdx];
  const finalPrice = prod.price + (selectedOpt.priceModifier || 0);
  
  closeProductOptionsModal();
  addToCart(productId, selectedOpt.name, finalPrice);
}

function closeProductOptionsModal() {
  const overlay = document.getElementById('productOptionsModalOverlay');
  if (overlay) overlay.classList.remove('active');
}

function updateCartQty(cartKey, delta) {
  const item = state.currentCart.items.find(i => (i.cartKey || i.id) === cartKey);
  if (!item) return;
  
  const prod = state.products.find(p => p.id === item.id);
  
  if (delta > 0 && item.track_inventory && prod && prod.stock <= item.quantity) {
    alert("Action completed.");
    return;
  }
  
  item.quantity += delta;
  
  if (item.quantity <= 0) {
    state.currentCart.items = state.currentCart.items.filter(i => (i.cartKey || i.id) !== cartKey);
  }
  
  calculateCartTotals();
  renderCart();
}

function removeCartItem(cartKey) {
  state.currentCart.items = state.currentCart.items.filter(i => (i.cartKey || i.id) !== cartKey);
  calculateCartTotals();
  renderCart();
}

function updateCartItemNote(cartKey, noteText) {
  const item = state.currentCart.items.find(i => (i.cartKey || i.id) === cartKey);
  if (item) {
    item.note = noteText;
  }
}

function clearCart() {
  const previousType = state.currentCart.type;
  state.currentCart = {
    type: 'dine-in',
    tableId: null,
    items: [],
    subtotal: 0,
    discount: 0,
    tax: 0,
    total: 0,
    selectedTaxPresetId: 'tax-none',
    selectedDiscountPresetId: 'disc-none',
    draftOrderId: null,
    activeOrderId: null
  };
  
  const select = document.getElementById('cartTableSelect');
  if (select) select.selectedIndex = 0;
  
  setCartType('dine-in');
  calculateCartTotals();
  
  // Always go back to Step 1 after clearing
  backToOrderList();
  
  if (previousType === 'takeaway') {
    setPosMode('takeaway');
  } else {
    setPosMode('tables');
  }
}

function calculateCartTotals() {
  const subtotal = state.currentCart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  
  // Find selected tax preset
  const taxPresetId = state.currentCart.selectedTaxPresetId || 'tax-none';
  const taxPreset = state.taxPresets.find(t => t.id === taxPresetId) || { value: 0 };
  const taxRate = taxPreset.value;
  
  // Find selected discount preset
  const discountPresetId = state.currentCart.selectedDiscountPresetId || 'disc-none';
  const discountPreset = state.discountPresets.find(d => d.id === discountPresetId) || { value: 0, type: 'percent' };
  
  let discount = 0;
  if (discountPreset.type === 'percent') {
    discount = Math.round(subtotal * (discountPreset.value / 100));
  } else {
    discount = discountPreset.value;
  }
  discount = Math.min(subtotal, discount); // Clamp
  
  // Calculate tax on subtotal AFTER discount
  const taxableAmount = Math.max(0, subtotal - discount);
  const tax = Math.round(taxableAmount * (taxRate / 100));
  
  const total = taxableAmount + tax;
  
  state.currentCart.subtotal = subtotal;
  state.currentCart.discount = discount;
  state.currentCart.tax = tax;
  state.currentCart.total = total;
  
  saveState();
}

function ensureInventoryTransactions() {
  if (!Array.isArray(state.inventoryTransactions)) state.inventoryTransactions = [];
}

function logInventoryTransaction({ itemId, itemName, qty, type, notes, sourceType, sourceId }) {
  ensureInventoryTransactions();
  state.inventoryTransactions.unshift({
    id: generateId('tx'),
    itemId,
    itemName,
    qty: parseFloat(qty) || 0,
    type,
    notes: notes || '',
    sourceType: sourceType || '',
    sourceId: sourceId || '',
    timestamp: new Date().toISOString()
  });
}

function adjustInventoryItemStock(itemId, qty, type, notes, sourceType, sourceId) {
  if (!itemId || !qty) return false;
  const invItem = (state.inventory || []).find(i => i.id === itemId);
  if (!invItem) return false;
  const amount = parseFloat(qty) || 0;
  if (amount <= 0) return false;
  if (type === 'deduct') {
    invItem.stock = parseFloat(Math.max(0, (parseFloat(invItem.stock) || 0) - amount).toFixed(2));
  } else {
    invItem.stock = parseFloat(((parseFloat(invItem.stock) || 0) + amount).toFixed(2));
  }
  logInventoryTransaction({
    itemId: invItem.id,
    itemName: invItem.name,
    qty: amount,
    type: type === 'deduct' ? 'deduct' : 'add',
    notes,
    sourceType,
    sourceId
  });
  return true;
}

function adjustProductStock(productId, qty, type) {
  const prod = (state.products || []).find(p => p.id === productId);
  if (!prod || !prod.track_inventory) return false;
  const amount = parseFloat(qty) || 0;
  if (amount <= 0) return false;
  if (type === 'deduct') {
    prod.stock = parseFloat(Math.max(0, (parseFloat(prod.stock) || 0) - amount).toFixed(2));
  } else {
    prod.stock = parseFloat(((parseFloat(prod.stock) || 0) + amount).toFixed(2));
  }
  return true;
}

function getOrderItemKey(item) {
  return item.cartKey || `${item.id || item.productId || item.name}`;
}

function applyProductStockDeltaForOrder(order, newItems) {
  const previousItems = Array.isArray(order.stockAppliedItems) ? order.stockAppliedItems : [];
  const previousByKey = new Map(previousItems.map(item => [getOrderItemKey(item), item]));
  const nextItems = Array.isArray(newItems) ? newItems : [];

  nextItems.forEach(item => {
    const key = getOrderItemKey(item);
    const prev = previousByKey.get(key);
    const prevQty = prev ? parseFloat(prev.quantity) || 0 : 0;
    const nextQty = parseFloat(item.quantity) || 0;
    const diff = nextQty - prevQty;
    if (diff > 0) adjustProductStock(item.id || item.productId, diff, 'deduct');
    if (diff < 0) adjustProductStock(item.id || item.productId, Math.abs(diff), 'add');
    previousByKey.delete(key);
  });

  previousByKey.forEach(prev => {
    adjustProductStock(prev.id || prev.productId, parseFloat(prev.quantity) || 0, 'add');
  });

  order.stockAppliedItems = nextItems.map(item => ({
    id: item.id,
    productId: item.productId || item.id,
    cartKey: item.cartKey,
    name: item.name,
    quantity: parseFloat(item.quantity) || 0
  }));
}

function reverseProductStockForOrder(order) {
  if (!order || !Array.isArray(order.stockAppliedItems)) return;
  order.stockAppliedItems.forEach(item => {
    adjustProductStock(item.id || item.productId, parseFloat(item.quantity) || 0, 'add');
  });
  order.stockAppliedItems = [];
}

function reverseRecipeInventoryForOrder(order) {
  if (!order || !Array.isArray(order.recipeAppliedItems)) return;
  order.recipeAppliedItems.forEach(item => {
    adjustInventoryItemStock(
      item.itemId,
      item.qty,
      'add',
      `Order cancelled/reversed: ${order.tableName || order.id}`,
      'kds-ready-reversal',
      order.id
    );
  });
  order.recipeAppliedItems = [];
  delete order.recipeDeductedAt;
}

function reverseAllStockForOrder(order) {
  reverseProductStockForOrder(order);
  reverseRecipeInventoryForOrder(order);
}

function renderCart() {
  const container = document.getElementById('cartItemsContainer');
  if (!container) return;

  // Find selected tax rate
  const taxPresetId = state.currentCart.selectedTaxPresetId || 'tax-none';
  const taxPreset = state.taxPresets.find(t => t.id === taxPresetId) || { value: 0 };

  // Update Step 2 billing numbers
  const subEl = document.getElementById('cartSubtotalText');
  const taxRateEl = document.getElementById('cartTaxRateText');
  const taxEl = document.getElementById('cartTaxText');
  const totalEl = document.getElementById('cartTotalText');
  if (subEl) subEl.textContent = formatPrice(state.currentCart.subtotal);
  if (taxRateEl) taxRateEl.textContent = taxPreset.value;
  if (taxEl) taxEl.textContent = formatPrice(state.currentCart.tax);
  if (totalEl) totalEl.textContent = formatPrice(state.currentCart.total);

  // Render discount line
  const discountLine = document.getElementById('cartDiscountLine');
  const discountText = document.getElementById('cartDiscountText');
  if (discountLine && discountText) {
    if (state.currentCart.discount > 0) {
      discountLine.style.display = 'flex';
      discountText.textContent = '-' + formatPrice(state.currentCart.discount);
    } else {
      discountLine.style.display = 'none';
    }
  }

  // Populate dropdown selections
  populateCartPresetsDropdowns();

  // Update Send button total quantity badge
  const totalItems = state.currentCart.items.reduce((sum, item) => sum + item.quantity, 0);
  const badge = document.getElementById('cartSendCountBadge');
  if (badge) {
    if (totalItems > 0) {
      badge.textContent = totalItems;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  // Toggle Transfer Table button visibility (Step 2 and Step 1)
  const transferBtn = document.getElementById('transferTableBtn');
  if (transferBtn) {
    transferBtn.style.display = (state.currentCart.tableId && state.currentCart.items.length > 0) ? 'flex' : 'none';
  }
  
  const step1TransferBtn = document.getElementById('cartStep1TransferTableBtn');
  if (step1TransferBtn) {
    step1TransferBtn.style.display = (state.currentCart.tableId && state.currentCart.items.length > 0) ? 'inline-block' : 'none';
  }

  // Step 1 footer â€” show only when items exist
  const step1Footer = document.getElementById('cartStep1Footer');
  const step1Preview = document.getElementById('step1SubtotalPreview');
  if (step1Footer) {
    step1Footer.style.display = state.currentCart.items.length > 0 ? 'block' : 'none';
  }
  
  const step1PaymentBtn = document.getElementById('cartStep1PaymentBtn');
  const step1BillSummary = document.getElementById('cartStep1BillSummary');
  const step1BillSubtotal = document.getElementById('step1BillSubtotal');
  const step1BillDiscountLine = document.getElementById('step1BillDiscountLine');
  const step1BillDiscount = document.getElementById('step1BillDiscount');
  const step1BillTaxRate = document.getElementById('step1BillTaxRate');
  const step1BillTax = document.getElementById('step1BillTax');

  let isOccupied = false;
  let isPendingTakeaway = false;
  if (state.currentCart.type === 'dine-in' && state.currentCart.tableId) {
    const tableId = state.currentCart.tableId;
    const table = state.tables.find(t => t.id === tableId || t.id === parseInt(tableId));
    if (table && (table.status === 'occupied' || table.status === 'billed')) {
      isOccupied = true;
    }
  } else if (state.currentCart.type === 'takeaway' && state.currentCart.activeOrderId) {
    isPendingTakeaway = state.orders.some(o => o.id === state.currentCart.activeOrderId);
  }
  
  const confirmBtn = document.getElementById('cartConfirmBtn');
  if (confirmBtn) {
    if (isOccupied || isPendingTakeaway) {
      confirmBtn.innerHTML = `Send Kitchen`;
    } else {
      confirmBtn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Confirm Order`;
    }
  }

  if (step1PaymentBtn) {
    step1PaymentBtn.style.display = (isOccupied || isPendingTakeaway) ? 'flex' : 'none';
  }

  if (step1BillSummary) {
    if (isOccupied || isPendingTakeaway) {
      step1BillSummary.style.display = 'flex';
      if (step1BillSubtotal) step1BillSubtotal.textContent = formatPrice(state.currentCart.subtotal);
      
      if (step1BillDiscountLine && step1BillDiscount) {
        if (state.currentCart.discount > 0) {
          step1BillDiscountLine.style.display = 'flex';
          step1BillDiscount.textContent = '-' + formatPrice(state.currentCart.discount);
        } else {
          step1BillDiscountLine.style.display = 'none';
        }
      }
      
      const taxPresetId = state.currentCart.selectedTaxPresetId || 'tax-none';
      const taxPreset = state.taxPresets.find(t => t.id === taxPresetId) || { value: 0 };
      if (step1BillTaxRate) step1BillTaxRate.textContent = taxPreset.value;
      if (step1BillTax) step1BillTax.textContent = formatPrice(state.currentCart.tax);
      
      if (step1Preview) {
        step1Preview.textContent = formatPrice(state.currentCart.total);
      }
    } else {
      step1BillSummary.style.display = 'none';
      if (step1Preview) {
        step1Preview.textContent = formatPrice(state.currentCart.subtotal);
      }
    }
  } else {
    if (step1Preview) {
      step1Preview.textContent = formatPrice(state.currentCart.subtotal);
    }
  }

  if (state.currentCart.items.length === 0) {
    let releaseTableHtml = '';
    
    // Check if table is occupied/billed but empty in the cart
    if (state.currentCart.type === 'dine-in' && state.currentCart.tableId) {
      const tableId = state.currentCart.tableId;
      const table = state.tables.find(t => t.id === parseInt(tableId) || t.id === tableId);
      if (table && (table.status === 'occupied' || table.status === 'billed')) {
        releaseTableHtml = `
          <button type="button" class="submit-btn" style="margin-top: 15px; padding: 10px 16px; background: var(--accent-danger); font-size: 0.85rem; font-weight: bold; width: auto; display: flex; align-items: center; gap: 6px; justify-content: center; margin-left: auto; margin-right: auto;" onclick="releaseCurrentTable()">
            <i class="fa-solid fa-unlock"></i> Release Table
          </button>
        `;
      }
    }

    container.innerHTML = `
      <div class="cart-empty-state">
        <i class="fa-solid fa-cart-arrow-down"></i>
        <p>ပစ္စည်းမရှိသေးပါ</p>
        ${releaseTableHtml}
      </div>
    `;
    renderProducts();
    
    // Update cart table badge in header even if empty
    const tableBadge = document.getElementById('cartTableBadge');
    if (tableBadge) {
      if (state.currentCart.type === 'dine-in' && state.currentCart.tableId) {
        const t = state.tables.find(t => t.id === parseInt(state.currentCart.tableId) || t.id === state.currentCart.tableId);
        tableBadge.textContent = t ? t.name : 'Dine-in';
        tableBadge.style.display = 'inline-block';
        tableBadge.style.background = 'var(--accent-brand-blue)';
      } else {
        tableBadge.style.display = 'none';
      }
    }
    return;
  }

  container.innerHTML = state.currentCart.items.map(item => {
    const key = item.cartKey || item.id;
    return `
    <div class="cart-item">
      <div class="cart-item-main-row">
        <span class="cart-item-name" title="${item.name}">${item.name}</span>
        <div class="cart-item-qty">
          <button class="qty-btn" onclick="updateCartQty('${key}', -1)">-</button>
          <span class="qty-val">${item.quantity}</span>
          <button class="qty-btn" onclick="updateCartQty('${key}', 1)">+</button>
        </div>
        <span class="cart-item-price">${formatPrice(item.price * item.quantity)}</span>
        <button class="cart-item-remove" onclick="removeCartItem('${key}')" title="Remove">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <input type="text" class="cart-item-note-input"
        placeholder="Kitchen note..."
        value="${item.note || ''}"
        onchange="updateCartItemNote('${key}', this.value)">
    </div>
  `;
  }).join('');

  renderProducts();

  // Update cart table badge in header
  const tableBadge = document.getElementById('cartTableBadge');
  if (tableBadge) {
    if (state.currentCart.type === 'dine-in' && state.currentCart.tableId) {
      const t = state.tables.find(t => t.id === parseInt(state.currentCart.tableId) || t.id === state.currentCart.tableId);
      tableBadge.textContent = t ? t.name : 'Dine-in';
      tableBadge.style.display = 'inline-block';
      tableBadge.style.background = 'var(--accent-brand-blue)';
    } else if (state.currentCart.type === 'takeaway') {
      tableBadge.textContent = 'Takeaway';
      tableBadge.style.display = 'inline-block';
      tableBadge.style.background = '#d97706';
    } else {
      tableBadge.style.display = 'none';
    }
  }
}

function populateCartPresetsDropdowns() {
  const taxSelect = document.getElementById('cartTaxPresetSelect');
  const discountSelect = document.getElementById('cartDiscountPresetSelect');
  const memberSelect = document.getElementById('cartMemberSelect');
  
  if (taxSelect) {
    taxSelect.innerHTML = state.taxPresets.map(t => `
      <option value="${t.id}" ${state.currentCart.selectedTaxPresetId === t.id ? 'selected' : ''}>${t.name} (${t.value}%)</option>
    `).join('');
  }
  
  if (discountSelect) {
    discountSelect.innerHTML = state.discountPresets.map(d => `
      <option value="${d.id}" ${state.currentCart.selectedDiscountPresetId === d.id ? 'selected' : ''}>${d.name} (${d.type === 'percent' ? d.value + '%' : formatPrice(d.value)})</option>
    `).join('');
  }

  if (memberSelect) {
    const activeMemberId = state.currentCart.memberId || '';
    let optionsHtml = '<option value="">-- No Member --</option>';
    if (state.customers && state.customers.length > 0) {
      optionsHtml += state.customers.map(c => 
        `<option value="${c.id}" ${activeMemberId === c.id ? 'selected' : ''}>${escapeHtml(c.name)} (${c.phone}) - ${c.points} pt</option>`
      ).join('');
    }
    memberSelect.innerHTML = optionsHtml;
  }
}

function handleCartMemberChange(memberId) {
  state.currentCart.memberId = memberId || null;
  if (memberId) {
    // Automatically apply Member Discount (5%)
    state.currentCart.selectedDiscountPresetId = 'disc-5';
  } else {
    // Revert discount
    state.currentCart.selectedDiscountPresetId = 'disc-none';
  }
  calculateCartTotals();
  renderCart();
}

function applyCartTaxPreset(presetId) {
  state.currentCart.selectedTaxPresetId = presetId;
  calculateCartTotals();
  renderCart();
}

function applyCartDiscountPreset(presetId) {
  state.currentCart.selectedDiscountPresetId = presetId;
  calculateCartTotals();
  renderCart();
}

function upsertTakeawayOrderFromCart(status = 'pending') {
  const cart = state.currentCart;
  if (!cart || cart.type !== 'takeaway' || !Array.isArray(cart.items) || cart.items.length === 0) return null;

  let order = null;
  const existingId = cart.activeOrderId || cart.draftOrderId;
  if (existingId) {
    order = state.orders.find(o => o.id === existingId);
  }

  if (!order) {
    order = {
      id: generateSequentialOrderId(),
      tableName: 'Takeaway',
      type: 'takeaway',
      status: status,
      timestamp: new Date().toISOString().replace('Z', '')
    };
    state.orders.push(order);
  }

  applyProductStockDeltaForOrder(order, cart.items);
  Object.assign(order, {
    tableName: 'Takeaway',
    type: 'takeaway',
    items: cart.items.map(item => ({ ...item })),
    subtotal: cart.subtotal,
    discount: cart.discount,
    tax: cart.tax,
    total: cart.total,
    memberId: cart.memberId || null,
    selectedTaxPresetId: cart.selectedTaxPresetId || 'tax-none',
    selectedDiscountPresetId: cart.selectedDiscountPresetId || 'disc-none',
    status: status,
    timestamp: new Date().toISOString().replace('Z', '')
  });

  cart.activeOrderId = order.id;
  cart.draftOrderId = order.id;
  return order;
}

// --- 2-STEP CART FLOW ---
function confirmCartStep() {
  const cart = state.currentCart;
  if (cart.items.length === 0) return;
  
  const orderId = generateSequentialOrderId();
  const now = new Date();
  let targetOrder = null;
  
  if (cart.type === 'dine-in') {
    const table = cart.tableId ? state.tables.find(t => t.id === cart.tableId || t.id === parseInt(cart.tableId)) : null;
    
    // If table is already billed â†’ go straight to payment instead of sending to kitchen again
    if (table && table.status === 'billed') {
      processPaymentAction();
      return;
    }
    
    let existingOrder = null;
    if (table && table.activeOrderId) {
      existingOrder = state.orders.find(o => o.id === table.activeOrderId);
    }
    
    if (existingOrder) {
      // Update existing kitchen order
      applyProductStockDeltaForOrder(existingOrder, cart.items);
      existingOrder.items = [...cart.items];
      existingOrder.subtotal = cart.subtotal;
      existingOrder.discount = cart.discount;
      existingOrder.tax = cart.tax;
      existingOrder.total = cart.total;
      existingOrder.memberId = cart.memberId || null;
      existingOrder.status = 'pending';
      existingOrder.timestamp = now.toISOString().replace('Z', '');
      targetOrder = existingOrder;
      alert(`Order for "${displayText(table.name)}" has been updated and sent to kitchen.`);
    } else {
      // Create new kitchen order
      const newOrder = {
        id: orderId,
        tableId: cart.tableId,
        tableName: table ? table.name : "New Order (Draft)",
        type: 'dine-in',
        items: [...cart.items],
        subtotal: cart.subtotal,
        discount: cart.discount,
        tax: cart.tax,
        total: cart.total,
        memberId: cart.memberId || null,
        status: 'pending',
        timestamp: now.toISOString().replace('Z', '')
      };
      applyProductStockDeltaForOrder(newOrder, cart.items);
      state.orders.push(newOrder);
      if (table) {
        table.status = 'occupied';
        table.activeOrderId = orderId;
      }
      targetOrder = newOrder;
      alert(table ? `Order for "${displayText(table.name)}" has been confirmed and sent to kitchen.` : 'New order has been confirmed and sent to kitchen.');
    }
    
    queueKitchenPrintJob(targetOrder);
    
    // Clear cart and return to Tables Floor Map (hiding cart)
    clearCart();
    saveState();
    setPosMode('tables');
    
  } else {
    const takeawayOrder = upsertTakeawayOrderFromCart('pending');
    if (!takeawayOrder) return;

    saveState();
    immediateServerSave();
    queueKitchenPrintJob(takeawayOrder);
    alert("Takeaway order saved. You can start another order now, then recall this one from Orders for payment.");

    clearCart();
    renderSalesCounter();
    setPosMode('takeaway');
  }
}

function backToOrderList() {
  const step1 = document.getElementById('cartStep1Panel');
  const step2 = document.getElementById('cartStep2Panel');
  if (step1) step1.style.display = 'flex';
  if (step2) step2.style.display = 'none';
}

function populateCartTablesDropdown() {
  const select = document.getElementById('cartTableSelect');
  if (!select) return;
  
  // Keep the first option
  let html = `<option value="">-- Select Table --</option>`;
  
  // Render tables
  state.tables.forEach(t => {
    html += `<option value="${t.id}" ${state.currentCart.tableId === t.id ? 'selected' : ''}>${t.name}</option>`;
  });
  
  select.innerHTML = html;
}

// --- C. CHECKOUT LOGIC & PRINTER SLIP DIALOG ---
function processSendAction() {
  const cart = state.currentCart;
  if (cart.items.length === 0) {
    alert("Action completed.");
    return;
  }
  
  if (cart.type === 'dine-in' && !cart.tableId) {
    alert("Action completed.");
    return;
  }
  
  if (cart.type === 'dine-in') {
    const table = state.tables.find(t => t.id === cart.tableId || t.id === parseInt(cart.tableId));
    
    // Find the order that was created/updated during confirmCartStep
    let existingOrder = null;
    if (cart.draftOrderId) {
      existingOrder = state.orders.find(o => o.id === cart.draftOrderId);
    } else if (table && table.activeOrderId) {
      existingOrder = state.orders.find(o => o.id === table.activeOrderId);
    }
    
    if (existingOrder) {
      // Update with final presets from Step 2
      applyProductStockDeltaForOrder(existingOrder, cart.items);
      existingOrder.tableId = cart.tableId;
      existingOrder.tableName = table ? table.name : `Table ${cart.tableId}`;
      existingOrder.items = [...cart.items];
      existingOrder.subtotal = cart.subtotal;
      existingOrder.discount = cart.discount;
      existingOrder.tax = cart.tax;
      existingOrder.total = cart.total;
      existingOrder.memberId = cart.memberId || null;
      existingOrder.status = 'pending';
      existingOrder.timestamp = new Date().toISOString().replace('Z', '');
      
      if (table) {
        table.status = 'occupied';
        table.activeOrderId = existingOrder.id;
      }
      
      delete cart.draftOrderId;
      saveState();
      immediateServerSave(); // Push order to all devices instantly
      queueKitchenPrintJob(existingOrder);
      alert(table ? `Order for "${displayText(table.name)}" has been saved and sent to kitchen.` : 'Order has been saved and sent to kitchen.');
    }
    
    clearCart();
    renderSalesCounter();
    setPosMode('tables');
  } else {
    const takeawayOrder = upsertTakeawayOrderFromCart('pending');
    if (takeawayOrder) {
      queueKitchenPrintJob(takeawayOrder);
      saveState();
      immediateServerSave();
      alert("Takeaway order sent to kitchen. You can start another order now.");
    }
    clearCart();
    renderSalesCounter();
    setPosMode('takeaway');
  }
}

function processPaymentAction() {
  const cart = state.currentCart;
  const now = new Date();
  
  if (cart.type === 'dine-in') {
    if (!cart.tableId) {
      alert("Action completed.");
      return;
    }
    
    const table = state.tables.find(t => t.id === cart.tableId || t.id === parseInt(cart.tableId));
    if (!table) return;
    
    // Find active order
    const activeOrder = state.orders.find(o => o.id === table.activeOrderId);
    if (!activeOrder) {
      alert("Action completed.");
      return;
    }
    
    openPaymentSelectorModal(activeOrder, (method, target) => {
      // Use computed values from checkout modal (with adjusted tax/discount)
      const finalSubtotal = target._computedSubtotal != null ? target._computedSubtotal : activeOrder.subtotal;
      const finalDiscount = target._computedDiscount != null ? target._computedDiscount : activeOrder.discount;
      const finalTax = target._computedTax != null ? target._computedTax : activeOrder.tax;
      const finalTotal = target._computedTotal != null ? target._computedTotal : activeOrder.total;

      // 1. Move to history
      activeOrder.status = 'completed';
      
      const completedSale = {
        id: activeOrder.id,
        tableName: table.name,
        type: 'dine-in',
        items: [...activeOrder.items],
        subtotal: finalSubtotal,
        discount: finalDiscount,
        tax: finalTax,
        total: finalTotal,
        paymentMethod: method,
        memberId: activeOrder.memberId || null,
        stockAppliedItems: activeOrder.stockAppliedItems ? [...activeOrder.stockAppliedItems] : [],
        recipeAppliedItems: activeOrder.recipeAppliedItems ? [...activeOrder.recipeAppliedItems] : [],
        recipeDeductedAt: activeOrder.recipeDeductedAt || null,
        timestamp: now.toISOString().replace('Z', '')
      };
      
      // Calculate and add points if member is linked
      if (completedSale.memberId) {
        const pointsEarned = Math.floor(finalTotal / 1000);
        completedSale.pointsEarned = pointsEarned;
        
        const customer = state.customers.find(c => c.id === completedSale.memberId);
        if (customer) {
          customer.points = (customer.points || 0) + pointsEarned;
          customer.totalSpending = (customer.totalSpending || 0) + finalTotal;
        }
      }
      
      state.salesHistory.push(completedSale);
      
      // 2. Remove from active orders
      state.orders = state.orders.filter(o => o.id !== activeOrder.id);
      
      // 3. Clear Table
      table.status = 'available';
      table.activeOrderId = null;
      
      saveState();
      immediateServerSave(); // Push payment to all devices instantly
      
      // 4. Print customer copy
      showPrinterSlipModal(completedSale, 'customer');
      
      clearCart();
      renderSalesCounter();
      switchTab('sales-pane');
      setPosMode('tables');
      renderTablesFloorMap(); // force floor map refresh so table turns green
      alert(`Payment completed. (${method})`);
    });
  } else {
    // Takeaway payment checkout
    if (cart.items.length === 0) {
      alert("Action completed.");
      return;
    }

    const pendingOrderId = cart.activeOrderId || cart.draftOrderId;
    const pendingOrder = pendingOrderId ? state.orders.find(o => o.id === pendingOrderId && o.type === 'takeaway') : null;
    if (pendingOrder) {
      applyProductStockDeltaForOrder(pendingOrder, cart.items);
      Object.assign(pendingOrder, {
        items: cart.items.map(item => ({ ...item })),
        subtotal: cart.subtotal,
        discount: cart.discount,
        tax: cart.tax,
        total: cart.total,
        memberId: cart.memberId || null,
        selectedTaxPresetId: cart.selectedTaxPresetId || 'tax-none',
        selectedDiscountPresetId: cart.selectedDiscountPresetId || 'disc-none'
      });
      saveState();
      immediateServerSave();

      openPaymentSelectorModal(pendingOrder, (method, target) => {
        const finalSubtotal = target._computedSubtotal != null ? target._computedSubtotal : pendingOrder.subtotal;
        const finalDiscount = target._computedDiscount != null ? target._computedDiscount : pendingOrder.discount;
        const finalTax = target._computedTax != null ? target._computedTax : pendingOrder.tax;
        const finalTotal = target._computedTotal != null ? target._computedTotal : pendingOrder.total;

        const completedSale = {
          id: pendingOrder.id,
          orderId: pendingOrder.id,
          tableName: 'Takeaway',
          type: 'takeaway',
          items: [...pendingOrder.items],
          subtotal: finalSubtotal,
          discount: finalDiscount,
          tax: finalTax,
          total: finalTotal,
          paymentMethod: method,
          memberId: pendingOrder.memberId || null,
          stockAppliedItems: pendingOrder.stockAppliedItems ? [...pendingOrder.stockAppliedItems] : [],
          recipeAppliedItems: pendingOrder.recipeAppliedItems ? [...pendingOrder.recipeAppliedItems] : [],
          recipeDeductedAt: pendingOrder.recipeDeductedAt || null,
          timestamp: now.toISOString().replace('Z', '')
        };

        if (completedSale.memberId) {
          const pointsEarned = Math.floor(finalTotal / 1000);
          completedSale.pointsEarned = pointsEarned;
          const customer = state.customers.find(c => c.id === completedSale.memberId);
          if (customer) {
            customer.points = (customer.points || 0) + pointsEarned;
            customer.totalSpending = (customer.totalSpending || 0) + finalTotal;
          }
        }

        pendingOrder.status = 'completed';
        state.orders = state.orders.filter(o => o.id !== pendingOrder.id);
        state.salesHistory.push(completedSale);
        saveState();
        immediateServerSave();

        showPrinterSlipModal(completedSale, 'customer');
        clearCart();
        renderSalesCounter();
        setPosMode('takeaway');
        alert(`Takeaway payment completed. (${method})`);
      });
      return;
    }
    
    openPaymentSelectorModal(cart, (method, target) => {
      const finalSubtotal = target._computedSubtotal != null ? target._computedSubtotal : cart.subtotal;
      const finalDiscount = target._computedDiscount != null ? target._computedDiscount : cart.discount;
      const finalTax = target._computedTax != null ? target._computedTax : cart.tax;
      const finalTotal = target._computedTotal != null ? target._computedTotal : cart.total;

      const orderId = generateSequentialOrderId();
      const stockOrder = { id: orderId, stockAppliedItems: [] };
      applyProductStockDeltaForOrder(stockOrder, cart.items);
      const completedSale = {
        id: orderId,
        tableName: 'Takeaway',
        type: 'takeaway',
        items: [...cart.items],
        subtotal: finalSubtotal,
        discount: finalDiscount,
        tax: finalTax,
        total: finalTotal,
        paymentMethod: method,
        memberId: cart.memberId || null,
        stockAppliedItems: stockOrder.stockAppliedItems ? [...stockOrder.stockAppliedItems] : [],
        timestamp: now.toISOString().replace('Z', '')
      };
      
      // Calculate and add points if member is linked
      if (completedSale.memberId) {
        const pointsEarned = Math.floor(finalTotal / 1000);
        completedSale.pointsEarned = pointsEarned;
        
        const customer = state.customers.find(c => c.id === completedSale.memberId);
        if (customer) {
          customer.points = (customer.points || 0) + pointsEarned;
          customer.totalSpending = (customer.totalSpending || 0) + finalTotal;
        }
      }
      
      state.salesHistory.push(completedSale);
      saveState();
      immediateServerSave(); // Push takeaway payment to all devices instantly
      
      // Print customer slip
      showPrinterSlipModal({
        id: orderId,
        tableName: 'Takeaway',
        type: 'takeaway',
        items: [...cart.items],
        subtotal: finalSubtotal,
        discount: finalDiscount,
        tax: finalTax,
        total: finalTotal,
        paymentMethod: method,
        memberId: cart.memberId || null,
        pointsEarned: completedSale.pointsEarned || 0,
        timestamp: completedSale.timestamp
      }, 'customer');
      
      clearCart();
      renderSalesCounter();
      alert(`Takeaway payment completed. (${method})`);
    });
  }
}

function buildKitchenPrintJobs(order) {
  if (!order || !Array.isArray(order.items)) return [];

  const drinksItems = order.items.filter(item => {
    const prod = state.products.find(p => p.id === item.id);
    return prod && prod.station === 'Bar';
  });

  const kitchenItems = order.items.filter(item => {
    const prod = state.products.find(p => p.id === item.id);
    return !prod || prod.station !== 'Bar';
  });

  const buildTicket = ({ title, subtitle, items, footer, station, printerName }) => {
    if (!items.length) return null;
    let html = `
      <div class="receipt-header receipt-kitchen-header">
        <div class="receipt-kitchen-title">${title}</div>
        <div class="receipt-kitchen-subtitle">Printer: ${escapeHtml(printerName)}</div>
      </div>
      <div class="receipt-divider"></div>
      <div class="receipt-info-row">
        <span>Order: <strong>${escapeHtml(order.id)}</strong></span>
        <span>Table: <strong>${escapeHtml(displayText(order.tableName, 'Takeaway'))}</strong></span>
      </div>
      <div class="receipt-info-row">
        <span>Time: ${new Date().toLocaleTimeString()}</span>
        <span>Type: ${order.type === 'takeaway' ? 'Takeaway' : 'Dine-in'}</span>
      </div>
      <div class="receipt-divider"></div>
      <div class="receipt-kitchen-items">
    `;

    items.forEach(item => {
      html += `
        <div class="receipt-item-row receipt-kitchen-item">
          <span class="receipt-item-name"><strong>[ ${item.quantity} x ] ${escapeHtml(displayText(item.name, 'Item'))}</strong></span>
        </div>
      `;
      if (item.note) {
        html += `<div class="receipt-item-note receipt-kitchen-note">*** Note: ${escapeHtml(displayText(item.note))}</div>`;
      }
    });

    html += `
      </div>
      <div class="receipt-divider"></div>
      <div class="receipt-footer receipt-kitchen-footer">${footer}</div>
    `;

    return {
      id: `pj-${order.id}-${station}-${Date.now()}`,
      orderId: order.id,
      kind: 'kitchen',
      station,
      title: subtitle,
      printerName,
      paperSize: '58mm',
      html
    };
  };

  return [
    buildTicket({
      title: 'KITCHEN ORDER TICKET',
      subtitle: 'Kitchen Ticket',
      items: kitchenItems,
      footer: '* Prepare this order as soon as possible *',
      station: 'kitchen',
      printerName: state.settings.printerName || 'POS-80 Kitchen Printer'
    }),
    buildTicket({
      title: 'DRINKS COUNTER TICKET',
      subtitle: 'Drinks Ticket',
      items: drinksItems,
      footer: '* Prepare drinks as soon as possible *',
      station: 'drinks',
      printerName: state.settings.drinksPrinterName || 'POS-80 Drinks Printer (Simulated)'
    })
  ].filter(Boolean);
}

async function queueKitchenPrintJob(order) {
  const jobs = buildKitchenPrintJobs(order);
  if (!jobs.length) return false;
  try {
    await apiRequest('print-jobs', {
      method: 'POST',
      body: JSON.stringify({ jobs })
    });
    console.log(`Queued ${jobs.length} kitchen print job(s) for ${order.id}.`);
    return true;
  } catch (error) {
    console.warn('Could not queue kitchen print job:', error);
    return false;
  }
}

function showPrinterSlipModal(order, slipType) {
  const overlay = document.getElementById('printerSlipModalOverlay');
  const title = document.getElementById('printerSlipModalTitle');
  const content = document.getElementById('simulatedThermalReceipt');
  
  if (!overlay || !content) return;
  
  ensureVoucherSettings();
  const isKitchenSlip = slipType === 'kitchen';
  content.dataset.paperSize = isKitchenSlip ? '58mm' : (state.settings.voucherPaperSize || '80mm');
  content.dataset.slipType = slipType;
  title.textContent = slipType === 'kitchen' ? 'Kitchen Ticket' : 'Customer Receipt';
  
  const formattedTime = new Date(order.timestamp).toLocaleString('my-MM');
  
  let slipHtml = '';
  
  if (slipType === 'kitchen') {
    const drinksItems = order.items.filter(item => {
      const prod = state.products.find(p => p.id === item.id);
      return prod && prod.station === 'Bar';
    });
    
    const kitchenItems = order.items.filter(item => {
      const prod = state.products.find(p => p.id === item.id);
      return !prod || prod.station !== 'Bar';
    });
    
    let slips = [];
    
    if (kitchenItems.length > 0) {
      let kitchenSlip = `
        <div class="receipt-header receipt-kitchen-header">
          <div class="receipt-kitchen-title">KITCHEN ORDER TICKET</div>
          <div class="receipt-kitchen-subtitle">Printer: ${state.settings.printerName || "POS-80 Kitchen Printer"}</div>
        </div>
        <div class="receipt-divider"></div>
        <div class="receipt-info-row">
          <span>Order: <strong>${order.id}</strong></span>
          <span>Table: <strong>${escapeHtml(displayText(order.tableName, 'Takeaway'))}</strong></span>
        </div>
        <div class="receipt-info-row">
          <span>Time: ${new Date().toLocaleTimeString()}</span>
          <span>Type: ${order.type === 'takeaway' ? 'Takeaway' : 'Dine-in'}</span>
        </div>
        <div class="receipt-divider"></div>
        <div class="receipt-kitchen-items">
      `;
      
        kitchenItems.forEach(item => {
          kitchenSlip += `
          <div class="receipt-item-row receipt-kitchen-item">
            <span class="receipt-item-name"><strong>[ ${item.quantity} x ] ${escapeHtml(displayText(item.name, 'Item'))}</strong></span>
          </div>
        `;
        if (item.note) {
          kitchenSlip += `<div class="receipt-item-note receipt-kitchen-note">*** Note: ${escapeHtml(displayText(item.note))}</div>`;
        }
      });
      
      kitchenSlip += `
        </div>
        <div class="receipt-divider"></div>
        <div class="receipt-footer receipt-kitchen-footer">
          * Prepare this order as soon as possible *
        </div>
      `;
      slips.push(kitchenSlip);
    }
    
    if (drinksItems.length > 0) {
      const drinksPrinterName = state.settings.drinksPrinterName || "POS-80 Drinks Printer (Simulated)";
      let drinksSlip = `
        <div class="receipt-header receipt-kitchen-header">
          <div class="receipt-kitchen-title">DRINKS COUNTER TICKET</div>
          <div class="receipt-kitchen-subtitle">Printer: ${drinksPrinterName}</div>
        </div>
        <div class="receipt-divider"></div>
        <div class="receipt-info-row">
          <span>Order: <strong>${order.id}</strong></span>
          <span>Table: <strong>${escapeHtml(displayText(order.tableName, 'Takeaway'))}</strong></span>
        </div>
        <div class="receipt-info-row">
          <span>Time: ${new Date().toLocaleTimeString()}</span>
          <span>Type: ${order.type === 'takeaway' ? 'Takeaway' : 'Dine-in'}</span>
        </div>
        <div class="receipt-divider"></div>
        <div class="receipt-kitchen-items">
      `;
      
      drinksItems.forEach(item => {
        drinksSlip += `
          <div class="receipt-item-row receipt-kitchen-item">
            <span class="receipt-item-name"><strong>[ ${item.quantity} x ] ${escapeHtml(displayText(item.name, 'Item'))}</strong></span>
          </div>
        `;
        if (item.note) {
          drinksSlip += `<div class="receipt-item-note receipt-kitchen-note">*** Note: ${escapeHtml(displayText(item.note))}</div>`;
        }
      });
      
      drinksSlip += `
        </div>
        <div class="receipt-divider"></div>
        <div class="receipt-footer receipt-kitchen-footer">
          * Prepare drinks as soon as possible *
        </div>
      `;
      slips.push(drinksSlip);
    }
    
    slipHtml = slips.join('<div class="receipt-page-break"></div>');
  } else {
    const voucherTitle = displayText(state.settings.voucherTitle || state.settings.restaurantName, 'Pandora POS');
    const voucherAddress = displayText(state.settings.voucherAddress || '');
    const voucherPhone = displayText(state.settings.voucherPhone || '');
    const voucherFooter = displayText(state.settings.voucherFooter, 'Thank you.');
    slipHtml = `
      <div class="receipt-header">
        <div class="receipt-title" style="font-size: 1.35rem; font-weight: 800;">${escapeHtml(voucherTitle)}</div>
        ${voucherAddress ? `<div style="font-size: 0.82rem; margin-top: 4px; line-height:1.35;">${escapeHtml(voucherAddress)}</div>` : ''}
        ${voucherPhone ? `<div class="receipt-subtitle" style="font-size: 0.82rem; margin-top: 2px;">Phone: ${escapeHtml(voucherPhone)}</div>` : ''}
      </div>
      <div class="receipt-divider"></div>
      <div class="receipt-info-row">
        <span>Bill ID: ${order.id}</span>
        <span>Table: ${escapeHtml(displayText(order.tableName, 'Takeaway'))}</span>
      </div>
      <div class="receipt-info-row">
        <span>Date: ${new Date(order.timestamp).toLocaleDateString()}</span>
        <span>Time: ${new Date(order.timestamp).toLocaleTimeString()}</span>
      </div>
      <div class="receipt-divider"></div>
    `;
    
    order.items.forEach(item => {
      // For customer receipt: strip variant suffix like " (Pork)" from name
      const receiptName = displayText(item.name, 'Item').replace(/\s*\([^)]+\)$/, '');
      slipHtml += `
        <div class="receipt-item-row">
          <span class="receipt-item-name">${escapeHtml(receiptName)}</span>
          <span class="receipt-item-qty-price">${item.quantity} x ${formatPrice(item.price)}</span>
        </div>
      `;
      if (item.note) {
        slipHtml += `<div class="receipt-item-note">Note: ${escapeHtml(displayText(item.note))}</div>`;
      }
    });
    
    // Member loyalty info if present
    let loyaltyHtml = '';
    if (order.memberId) {
      const c = state.customers.find(cust => cust.id === order.memberId);
      if (c) {
        loyaltyHtml = `
          <div class="receipt-divider"></div>
          <div style="font-size:0.82rem; line-height: 1.4; color: var(--text-primary); margin-top: 4px; padding: 4px 0;">
            <div style="display:flex; justify-content:space-between;">
              <span>Member:</span>
              <span><strong>${escapeHtml(displayText(c.name, 'Member'))}</strong></span>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span>Points Earned:</span>
              <span style="color:var(--accent-success);"><strong>+${order.pointsEarned || Math.floor(order.total / 1000)} pt</strong></span>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span>Total Points:</span>
              <span><strong>${c.points || 0} pt</strong></span>
            </div>
          </div>
        `;
      }
    }

    slipHtml += `
      <div class="receipt-divider"></div>
      <div class="receipt-total-section receipt-inset-section">
        <div class="receipt-total-row">
          <span>Subtotal:</span>
          <span>${formatPrice(order.subtotal)}</span>
        </div>
        ${order.discount > 0 ? `
        <div class="receipt-total-row" style="color: var(--accent-danger);">
          <span>Discount:</span>
          <span>-${formatPrice(order.discount)}</span>
        </div>
        ` : ''}
        <div class="receipt-total-row">
          <span>Tax:</span>
          <span>${formatPrice(order.tax)}</span>
        </div>
        <div class="receipt-total-row grand">
          <span>Total:</span>
          <span>${formatPrice(order.total)}</span>
        </div>
        <div class="receipt-total-row receipt-payment-row" style="font-size:0.85rem; margin-top:2px;">
          <span>Payment:</span>
          <span><strong>${order.paymentMethod || 'Cash'}</strong></span>
        </div>
      </div>
      ${loyaltyHtml}
      <div class="receipt-divider"></div>
      <div class="receipt-footer">
        ${escapeHtml(voucherFooter)}<br>
        Powered by Pandora POS
      </div>
    `;
  }
  
  content.innerHTML = slipHtml;
  overlay.classList.add('active');
}

function closePrinterSlipModal() {
  document.getElementById('printerSlipModalOverlay').classList.remove('active');
}

function printReceiptInBrowser() {
  const content = document.getElementById('simulatedThermalReceipt');
  if (!content) return false;

  const paperSize = content.dataset.paperSize || '80mm';
  const slipType = content.dataset.slipType || 'customer';
  const width = paperSize === '58mm' ? '58mm' : '80mm';
  const printWindow = window.open('', '_blank', 'width=420,height=650');
  if (!printWindow) {
    alert('Print popup was blocked. Please allow popups for this POS app and try again.');
    return false;
  }

  printWindow.document.open();
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Print Slip</title>
        <style>
          @page { size: ${width} auto; margin: 0; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            padding: 6px 6px 16mm;
            background: #ffffff;
            color: #000000;
            font-family: Arial, "Myanmar Text", "Noto Sans Myanmar", sans-serif;
            font-size: ${slipType === 'kitchen' ? '11px' : '11px'};
            font-weight: 400;
          }
          .print-paper {
            width: ${width};
            max-width: 100%;
            margin: 0 auto;
            padding-bottom: 14mm;
          }
          .receipt-header { text-align: center; margin-bottom: 10px; }
          .receipt-kitchen-header { margin-bottom: 6px; }
          .receipt-kitchen-title { font-size: 15px; font-weight: 800; letter-spacing: 0; }
          .receipt-kitchen-subtitle { font-size: 11px; margin-top: 2px; }
          .receipt-title { font-size: 15px; font-weight: 800; }
          .receipt-subtitle { font-size: 11px; margin-top: 3px; }
          .receipt-divider { border-top: 1px dashed #000; margin: ${slipType === 'kitchen' ? '5px' : '8px'} 0; }
          .receipt-info-row,
          .receipt-item-row,
          .receipt-total-row {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 4px;
          }
          .receipt-item-name { flex: 1; }
          .receipt-item-qty-price { white-space: nowrap; }
          .receipt-item-note { margin: 2px 0 5px 10px; font-size: 10px; }
          .receipt-inset-section { padding-left: 3mm; padding-right: 3mm; }
          .receipt-payment-row span:last-child { padding-right: 1mm; white-space: nowrap; }
          .receipt-kitchen-items { margin-top: 4px; }
          .receipt-kitchen-item { display: block; margin-bottom: 10px; line-height: 1.3; font-size: 12px; font-weight: 700; }
          .receipt-kitchen-note { margin-left: 14px; font-size: 10px; font-style: normal; font-weight: 700; }
          .receipt-kitchen-footer { margin-top: 10px; font-size: 12px; font-weight: 700; }
          .receipt-page-break { page-break-after: always; break-after: page; height: 0; overflow: hidden; }
          .receipt-total-row.grand { font-weight: 800; border-top: 1px solid #000; padding-top: 5px; }
          .receipt-footer { text-align: center; margin-top: 12px; }
          img { max-width: 42px; max-height: 42px; }
        </style>
      </head>
      <body>
        <div class="print-paper">${content.innerHTML}</div>
        <script>
          window.onload = function () {
            window.focus();
            window.print();
            setTimeout(function () { window.close(); }, 500);
          };
        <\/script>
      </body>
    </html>
  `);
  printWindow.document.close();
  return true;
}

async function simulatePrintSuccess() {
  const isElectron = !!(window.chrome && window.chrome.ipcRenderer || navigator.userAgent.indexOf('Electron') > -1);
  const cutPaper = state.settings?.printerCutPaper === true;
  
  if (isElectron) {
    try {
      const { ipcRenderer } = require('electron');
      const content = document.getElementById('simulatedThermalReceipt');
      if (!content) return;
      
      const html = content.innerHTML;
      
      // Split Kitchen vs Drinks slips if page breaks are present
      if (html.includes('receipt-page-break')) {
        const parts = html.split(/<div[^>]*class="receipt-page-break"[^>]*>.*?<\/div>/i);
        
        // Part 1 goes to Kitchen Printer
        if (parts[0] && parts[0].trim()) {
          const kitchenPrinterName = state.settings.printerName || 'POS-80 Kitchen Printer';
          ipcRenderer.send('print-receipt', { html: parts[0], printerName: kitchenPrinterName, cutPaper });
        }
        
        // Part 2 goes to Drinks Printer
        if (parts[1] && parts[1].trim()) {
          const drinksPrinterName = state.settings.drinksPrinterName || 'POS-80 Drinks Printer (Simulated)';
          ipcRenderer.send('print-receipt', { html: parts[1], printerName: drinksPrinterName, cutPaper });
        }
      } else {
        // Single ticket (customer receipt or single kitchen slip)
        let targetPrinter = state.settings.printerName || 'POS-80 Kitchen Printer';
        if (html.includes('DRINKS COUNTER TICKET')) {
          targetPrinter = state.settings.drinksPrinterName || 'POS-80 Drinks Printer (Simulated)';
        }
        ipcRenderer.send('print-receipt', { html: html, printerName: targetPrinter, cutPaper });
      }
      
      alert("Print job sent to selected printer.");
    } catch (err) {
      console.error('Silent printing error:', err);
      alert("Silent printer failed. Opening browser print dialog instead. Error: " + err.message);
      printReceiptInBrowser();
    }
  } else {
    const content = document.getElementById('simulatedThermalReceipt');
    const html = content ? content.innerHTML : '';
    const slipType = content?.dataset?.slipType || 'customer';
    if (html.trim()) {
      try {
        if (html.includes('receipt-page-break')) {
          const parts = html.split(/<div[^>]*class="receipt-page-break"[^>]*>.*?<\/div>/i).filter(part => part.trim());
          for (const part of parts) {
            await tryPrintWithLocalBridge(part, slipType);
          }
          closePrinterSlipModal();
          return;
        }
        const printed = await tryPrintWithLocalBridge(html, slipType);
        if (printed) {
          closePrinterSlipModal();
          return;
        }
      } catch (bridgeError) {
        console.warn('Local bridge print failed, falling back to browser dialog:', bridgeError);
      }
    }
    printReceiptInBrowser();
  }
  closePrinterSlipModal();
}


// --- D. TABLES MANAGEMENT SCREEN ---


function renderTablesFloorMap() {
  const container = document.getElementById('tablesGridContainer');
  const floorContainer = document.getElementById('tablesFloorContainer');
  if (!container) return;
  
  // Render active floor tabs classes just in case
  const mainBtn = document.getElementById('floorMainBtn');
  const ndBtn = document.getElementById('floor2ndBtn');
  const activeFloor = state.activeFloorId || 'main';
  if (mainBtn && ndBtn) {
    if (activeFloor === 'main') {
      mainBtn.classList.add('active');
      ndBtn.classList.remove('active');
    } else {
      mainBtn.classList.remove('active');
      ndBtn.classList.add('active');
    }
  }
  
  if (floorContainer) {
    if (state.isTableLayoutEditing) {
      floorContainer.classList.add('edit-mode');
    } else {
      floorContainer.classList.remove('edit-mode');
    }
  }
  
  let needsSave = false;
  const filteredTables = state.tables.filter(t => (t.floor || 'main') === activeFloor);
  
  container.innerHTML = filteredTables.map((t, index) => {
    let orderDetailText = '';
    
    if (t.status === 'occupied' || t.status === 'billed') {
      const activeOrder = state.orders.find(o => o.id === t.activeOrderId);
      if (activeOrder) {
        orderDetailText = `<span style="font-size:0.75rem; line-height:1.2; color:var(--text-muted); font-weight:700; margin-top:2px; text-align:center;">${formatPrice(activeOrder.total)}</span>`;
      }
    }
    
    // Auto layout if missing coordinates
    if (t.x === undefined || t.x === null) {
      const col = index % 4;
      const row = Math.floor(index / 4);
      t.x = 10 + col * 23;
      t.y = 15 + row * 38;
      needsSave = true;
    }
    
    const statusTranslations = {
      'available': 'အားလပ်',
      'reserved': 'ကြိုတင်',
      'occupied': 'လူရှိ',
      'billed': 'ရှင်းမည်'
    };
    const translatedStatus = statusTranslations[t.status] || t.status;
    
    return `
      <div class="restaurant-table ${t.status}" id="dom-table-${t.id}" style="left: ${t.x}%; top: ${t.y}%;" onclick="handleTableClick(${t.id})">
        <div class="table-num" style="font-weight: 800; color: var(--text-primary);">${t.name}</div>
        ${orderDetailText}
        <div class="table-badge">${translatedStatus}</div>
        
        <div class="table-edit-overlay">
          <button class="table-overlay-btn" onclick="event.stopPropagation(); openEditTableModal(${t.id})"><i class="fa-solid fa-pen"></i></button>
          <button class="table-overlay-btn delete" onclick="event.stopPropagation(); deleteTable(${t.id})"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </div>
    `;
  }).join('');
  
  if (needsSave) {
    saveState();
  }
  
  filteredTables.forEach(t => {
    const el = document.getElementById(`dom-table-${t.id}`);
    if (el) {
      makeTableDraggable(el, t.id);
    }
  });
}

function switchFloor(floorId) {
  state.activeFloorId = floorId;
  saveState();
  renderTablesFloorMap();
}

function startNewOrderWithoutTable() {
  clearCart();
  state.currentCart.type = 'dine-in';
  state.currentCart.tableId = null;
  saveState();
  
  setPosMode('products');
  renderCart();
}

function handleTableClick(tableId) {
  if (state.isTableLayoutEditing) return; // Prevent action if editing layout!
  
  const table = state.tables.find(t => t.id === tableId);
  if (!table) return;
  
  // Load table active order into cart and switch to POS (Sales pane)
  state.currentCart.tableId = tableId;
  state.currentCart.type = 'dine-in';
  
  const activeOrder = state.orders.find(o => o.id === table.activeOrderId);
  if (activeOrder) {
    state.currentCart.items = activeOrder.items.map(item => ({
      id: item.id,
      cartKey: item.cartKey || item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      note: item.note || '',
      track_inventory: state.products.find(p => p.id === item.id)?.track_inventory || false
    }));
    // Sync totals and presets from the active order so the checkout modal is accurate
    state.currentCart.subtotal = activeOrder.subtotal || 0;
    state.currentCart.discount = activeOrder.discount || 0;
    state.currentCart.tax = activeOrder.tax || 0;
    state.currentCart.total = activeOrder.total || 0;
    if (activeOrder.selectedTaxPresetId) state.currentCart.selectedTaxPresetId = activeOrder.selectedTaxPresetId;
    if (activeOrder.selectedDiscountPresetId) state.currentCart.selectedDiscountPresetId = activeOrder.selectedDiscountPresetId;
  } else {
    state.currentCart.items = [];
  }
  
  saveState();
  renderSalesCounter();
  setCartType('dine-in'); // Ensure UI elements (Dine-in button, table dropdown selector) reflect this
  
  setPosMode('products');
}
// --- E. KITCHEN DISPLAY SCREEN (KDS) ---
function renderKitchenDisplay() {
  const grid = document.getElementById('kitchenOrdersGrid');
  if (!grid) return;
  
  // Filters active pending or preparing orders
  const activeOrders = state.orders.filter(o => o.status === 'pending' || o.status === 'preparing');
  
  if (activeOrders.length === 0) {
    grid.innerHTML = `
      <div class="kds-empty-state">
        <i class="fa-solid fa-circle-check"></i>
        <h2>No kitchen orders</h2>
        <p>New confirmed orders will appear here.</p>
      </div>
    `;
    return;
  }
  
  grid.innerHTML = activeOrders.map(order => {
    const elapsedMinutes = Math.round((new Date() - new Date(order.timestamp)) / 60000);
    const timeDisplay = isNaN(elapsedMinutes) ? '0 mins ago' : `${elapsedMinutes} mins ago`;
    const headerColor = order.status === 'preparing' ? 'style="border-bottom: 2px solid var(--accent-warning);"' : '';
    
    let actionBtn = '';
    // No "Start Cooking" step â€” order goes straight from pending to ready
    if (order.status === 'pending' || order.status === 'preparing') {
      actionBtn = `<button class="k-btn k-btn-success" onclick="setOrderStatus('${order.id}', 'ready')"><i class="fa-solid fa-check"></i> Ready</button>`;
    }
    
    return `
      <div class="kitchen-card ${order.status}">
        <div class="kitchen-card-header" ${headerColor}>
          <div class="kitchen-table-name">${order.tableName}</div>
          <div class="kitchen-time">${timeDisplay}</div>
        </div>
        <div class="kitchen-card-items">
          ${order.items.map(item => `
            <div class="k-item">
              <span class="k-qty">${item.quantity} x</span>
              <span class="k-name">
                ${escapeHtml(item.name)}
                ${item.note ? `<span class="k-note">*** ${escapeHtml(item.note)}</span>` : ''}
              </span>
            </div>
          `).join('')}
        </div>
        <div class="kitchen-card-footer">
          ${actionBtn}
          <button class="k-btn k-btn-print" onclick="simulateKitchenReprint('${order.id}')" title="Print kitchen slip">
            <i class="fa-solid fa-print"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function setOrderStatus(orderId, newStatus) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;
  
  if (newStatus === 'ready') {
    // If table order, it sets status to ready in kitchen display, order remains in table orders
    order.status = 'ready';
    
    // Auto-deduct matching inventory items (Recipe or Name fallback)
    if (!order.recipeDeductedAt && Array.isArray(state.inventory) && Array.isArray(order.items)) {
      order.recipeAppliedItems = [];
      order.items.forEach(item => {
        // Find product to see if recipe exists
        const prod = state.products.find(p => p.id === item.productId || p.id === item.id || p.name === item.name);
        
        if (prod && Array.isArray(prod.ingredients) && prod.ingredients.length > 0) {
          // Recipe deduction
          prod.ingredients.forEach(ing => {
            const invItem = state.inventory.find(i => i.id === ing.inventoryItemId);
            if (invItem) {
              const qtyToDeduct = (parseFloat(ing.quantity) || 0) * (parseFloat(item.quantity) || 1);
              if (qtyToDeduct > 0) {
                adjustInventoryItemStock(
                  invItem.id,
                  qtyToDeduct,
                  'deduct',
                  `Recipe KDS Ready: ${prod.name} x${item.quantity} (${order.tableName})`,
                  'kds-ready',
                  order.id
                );
                order.recipeAppliedItems.push({ itemId: invItem.id, qty: qtyToDeduct, itemName: invItem.name });
              }
            }
          });
        } else {
          // Name matching fallback
          const matchName = item.name.trim().toLowerCase();
          const invItem = state.inventory.find(inv => 
            inv.name.trim().toLowerCase() === matchName ||
            inv.name.trim().toLowerCase().includes(matchName) ||
            matchName.includes(inv.name.trim().toLowerCase())
          );
          
          if (invItem) {
            const qtyToDeduct = parseFloat(item.quantity) || 0;
            if (qtyToDeduct > 0) {
              adjustInventoryItemStock(
                invItem.id,
                qtyToDeduct,
                'deduct',
                `KDS Direct Ready: ${item.name} (${order.tableName})`,
                'kds-ready',
                order.id
              );
              order.recipeAppliedItems.push({ itemId: invItem.id, qty: qtyToDeduct, itemName: invItem.name });
            }
          }
        }
      });
      order.recipeDeductedAt = new Date().toISOString();
    }
    
    alert(`${order.tableName} is ready.`);
  } else {
    order.status = newStatus;
  }
  
  saveState();
  renderKitchenDisplay();
}

function simulateKitchenReprint(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (order) {
    showPrinterSlipModal(order, 'kitchen');
  }
}


// --- F. MARKET PURCHASES & EXPENSES CONTROLLER ---
function toggleExpenseForm() {
  const overlay = document.getElementById('expenseModalOverlay');
  if (!overlay) return;
  overlay.classList.add('active');
  
  // Set today's date if empty
  const expDateInput = document.getElementById('expDate');
  if (expDateInput && !expDateInput.value) {
    expDateInput.value = new Date().toISOString().substr(0, 10);
  }
}

function closeExpenseForm() {
  const overlay = document.getElementById('expenseModalOverlay');
  if (overlay) {
    overlay.classList.remove('active');
  }
  document.getElementById('marketPurchaseForm').reset();
  const productWrapper = document.getElementById('expInventoryProductWrapper');
  if (productWrapper) productWrapper.style.display = 'none';
}

function saveAndNewExpense(event) {
  event.preventDefault();
  const form = document.getElementById('marketPurchaseForm');
  if (form && form.checkValidity()) {
    handleMarketPurchaseSubmit(false); // do not close modal
  } else if (form) {
    form.reportValidity();
  }
}

function filterExpenses() {
  renderMarketPane();
}

function clearExpenseFilters() {
  const startInput = document.getElementById('expenseFilterStartDate');
  const endInput = document.getElementById('expenseFilterEndDate');
  if (startInput) startInput.value = '';
  if (endInput) endInput.value = '';
  renderMarketPane();
}

function renderMarketPane() {
  // Populate trackable products dropdown
  const prodSelect = document.getElementById('expProductSelect');
  if (prodSelect) {
    const inventoryList = Array.isArray(state.inventory) ? state.inventory : [];
    prodSelect.innerHTML = inventoryList.map(inv => `
      <option value="${inv.id}">${inv.name} (Stock: ${inv.stock} ${inv.unit})</option>
    `).join('');
  }
  
  // Render table
  const tbody = document.getElementById('marketExpensesTableBody');
  if (!tbody) return;
  
  // Apply date filters
  const startInput = document.getElementById('expenseFilterStartDate');
  const endInput = document.getElementById('expenseFilterEndDate');
  const startDateVal = startInput ? startInput.value : '';
  const endDateVal = endInput ? endInput.value : '';
  
  let filteredExpenses = state.marketExpenses;
  if (startDateVal) {
    filteredExpenses = filteredExpenses.filter(e => e.date >= startDateVal);
  }
  if (endDateVal) {
    filteredExpenses = filteredExpenses.filter(e => e.date <= endDateVal);
  }
  
  // Reset selection states
  const masterChk = document.getElementById('selectAllExpenses');
  if (masterChk) {
    masterChk.checked = false;
    masterChk.indeterminate = false;
  }
  const actionBtn = document.getElementById('expenseActionsBtn');
  if (actionBtn) {
    actionBtn.disabled = true;
    actionBtn.style.background = 'rgba(255,255,255,0.05)';
    actionBtn.style.borderColor = 'var(--panel-border)';
    actionBtn.style.color = 'var(--text-secondary)';
  }

  if (filteredExpenses.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">
          No expense records yet.
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = filteredExpenses.map(exp => {
    let linkedLabel = ``;
    if (exp.addedToInventory && exp.productId) {
      const invItem = (state.inventory || []).find(i => i.id === exp.productId);
      const invName = invItem ? invItem.name : 'Inventory';
      linkedLabel = `<span class="expense-tag stock-linked" title="Added to ${invName} stock">+${exp.addQty || 0} Stock</span>`;
    } else {
      linkedLabel = `<span style="color: var(--text-muted); font-size: 0.8rem;">-</span>`;
    }
    
    const qtyDisplay = exp.quantity ? `${exp.quantity} ${exp.unit || ''}` : '-';
    
    // Highlight date with pill info-tag style
    const dateHighlightHtml = `<span class="expense-tag" style="background: rgba(14, 165, 233, 0.15); color: var(--accent-info); border-color: var(--accent-info); font-weight: 800; font-family: monospace; font-size: 0.85rem; padding: 4px 10px;">${exp.date}</span>`;
    
    return `
      <tr data-expense-id="${exp.id}">
        <td style="text-align: center; vertical-align: middle; padding: 12px 8px;">
          <input type="checkbox" class="expense-row-checkbox" value="${exp.id}" onchange="updateExpenseSelectionState()" style="cursor: pointer; width: 15px; height: 15px; vertical-align: middle;">
        </td>
        <td style="padding: 12px 8px; vertical-align: middle; white-space: nowrap;">${dateHighlightHtml}</td>
        <td style="vertical-align: middle;"><strong>${exp.itemName}</strong><br><small style="color: var(--text-muted); font-size: 0.75rem;">${exp.notes || ''}</small></td>
        <td style="vertical-align: middle;">${qtyDisplay}</td>
        <td class="expense-cost" style="vertical-align: middle;">${formatPrice(exp.cost)}</td>
        <td style="vertical-align: middle;">${linkedLabel}</td>
      </tr>
    `;
  }).join('');
  
  // Call to render inventory list on this page
  renderInventoryStatus();
}

function renderInventoryStatus() {
  const alertsList = document.getElementById('lowStockAlertsList');
  const statusList = document.getElementById('inventoryStatusList');
  if (!alertsList || !statusList) return;

  const trackableProducts = state.products.filter(p => p.track_inventory);

  // 1. Render Inventory Status List
  if (trackableProducts.length === 0) {
    statusList.innerHTML = `<div style="text-align:center; padding:15px; color:var(--text-muted); font-size:0.85rem;">No tracked inventory items yet.</div>`;
  } else {
    statusList.innerHTML = trackableProducts.map(p => {
      const isLow = p.stock <= 5; // Define threshold
      const badgeColor = isLow ? 'var(--accent-danger)' : 'var(--accent-success)';
      const badgeBg = isLow ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)';
      const badgeText = isLow ? 'Low Stock' : 'In Stock';
      
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:rgba(255,255,255,0.02); border:1px solid var(--panel-border); border-radius:var(--border-radius-sm); font-size:0.85rem;">
          <div style="display:flex; flex-direction:column; gap:2px;">
            <span style="font-weight:700; color:var(--text-primary);">${escapeHtml(p.name)}</span>
            <span style="font-size:0.75rem; color:${badgeColor}; background:${badgeBg}; padding:2px 6px; border-radius:4px; align-self:start; font-weight:bold; margin-top:2px;">${badgeText}</span>
          </div>
          <div style="text-align:right;">
            <span style="font-size:1.15rem; font-weight:800; color:${isLow ? 'var(--accent-danger)' : 'var(--text-primary)'};">${p.stock}</span>
            <span style="font-size:0.75rem; color:var(--text-muted); display:block;">unit</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // 2. Render Low Stock Alerts List
  const lowStockProducts = trackableProducts.filter(p => p.stock <= 5);
  if (lowStockProducts.length === 0) {
    alertsList.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; padding:12px; background:rgba(16, 185, 129, 0.1); border:1px solid rgba(16, 185, 129, 0.2); border-radius:var(--border-radius-sm); color:var(--accent-success); font-size:0.82rem; font-weight:bold;">
        <i class="fa-solid fa-circle-check"></i>
        <span>All tracked items have enough stock.</span>
      </div>
    `;
  } else {
    alertsList.innerHTML = lowStockProducts.map(p => `
      <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:rgba(239, 68, 68, 0.08); border:1px solid rgba(239, 68, 68, 0.18); border-radius:var(--border-radius-sm); color:var(--accent-danger); font-size:0.82rem; animation: pulse-light 2s infinite;">
        <div style="display:flex; align-items:center; gap:8px; font-weight:bold;">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span>${escapeHtml(p.name)} is low stock!</span>
        </div>
        <span style="font-weight:900; font-size:1rem; background:rgba(239,68,68,0.2); padding:2px 8px; border-radius:4px;">${p.stock} left</span>
      </div>
    `).join('');
  }
}

function handleMarketPurchaseSubmit(shouldClose = true) {
  const name = document.getElementById('expItemName').value;
  const cost = parseInt(document.getElementById('expCost').value);
  const qty = parseFloat(document.getElementById('expQty').value) || 0;
  const unit = document.getElementById('expUnit')?.value || '';
  const date = document.getElementById('expDate').value;
  const notes = document.getElementById('expNotes').value;
  
  const linkInv = document.getElementById('expLinkInventory').checked;
  const prodId = document.getElementById('expProductSelect').value;
  const addQty = parseInt(document.getElementById('expAddQty').value) || 0;
  
  const newExp = {
    id: generateId('exp'),
    itemName: name,
    cost: cost,
    quantity: qty,
    unit: unit,
    date: date,
    notes: notes,
    addedToInventory: linkInv
  };
  
  if (linkInv && prodId && addQty > 0) {
    newExp.productId = prodId;
    newExp.addQty = addQty;
    
    adjustInventoryItemStock(prodId, addQty, 'add', `Expense Purchase: ${name}`, 'expense', newExp.id);
  }
  
  state.marketExpenses.unshift(newExp);
  saveState();
  
  // reset form
  document.getElementById('marketPurchaseForm').reset();
  const productWrapper = document.getElementById('expInventoryProductWrapper');
  if (productWrapper) productWrapper.style.display = 'none';
  
  // Set default date back
  const expDateInput = document.getElementById('expDate');
  if (expDateInput) {
    expDateInput.value = new Date().toISOString().substr(0, 10);
  }
  
  if (shouldClose) {
    closeExpenseForm();
  }
  
  renderMarketPane();
  alert("Expense record saved.");
}

function deleteMarketExpense(expId) {
  if (confirm("Delete this expense record?")) {
    const exp = state.marketExpenses.find(e => e.id === expId);
    reverseExpenseInventoryLink(exp);
    state.marketExpenses = state.marketExpenses.filter(e => e.id !== expId);
    saveState();
    renderMarketPane();
  }
}

function reverseExpenseInventoryLink(exp) {
  if (!exp || !exp.addedToInventory || !exp.productId || !exp.addQty) return;
  adjustInventoryItemStock(
    exp.productId,
    exp.addQty,
    'deduct',
    `Expense deleted/reversed: ${exp.itemName}`,
    'expense-reversal',
    exp.id
  );
  exp.addedToInventory = false;
}



// --- G. REPORTS CONTROLLER ---
function renderReportsPane() {
  const tbody = document.getElementById('salesHistoryReportTableBody');
  if (!tbody) return;
  
  // Period filter
  const periodFilter = document.getElementById('salesHistoryPeriodFilter');
  const period = periodFilter ? periodFilter.value : 'today';
  
  let filteredSales = [...state.salesHistory];
  const todayStr = new Date().toISOString().slice(0, 10);
  
  if (period === 'today') {
    filteredSales = filteredSales.filter(s => s.timestamp.startsWith(todayStr));
  } else if (period === '7days') {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    filteredSales = filteredSales.filter(s => new Date(s.timestamp) >= cutoff);
  } else if (period === '10days') {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 10);
    filteredSales = filteredSales.filter(s => new Date(s.timestamp) >= cutoff);
  } else if (period === '1month') {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 1);
    filteredSales = filteredSales.filter(s => new Date(s.timestamp) >= cutoff);
  }
  
  // Sort sales history descending by date
  const sortedSales = filteredSales.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  if (sortedSales.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 30px;">
          No sales history found.
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = sortedSales.map(sale => {
      const timeStr = new Date(sale.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
      const saleId = escapeJsString(sale.id);
      return `
        <tr class="clickable-report-row" onclick="openOrderDetailModal('${saleId}', 'sale')" title="View voucher detail">
          <td><strong>${escapeHtml(sale.id)}</strong></td>
          <td>${timeStr}</td>
          <td><span class="expense-tag">${escapeHtml(displayText(sale.tableName, 'Takeaway'))}</span></td>
          <td style="font-weight: 700; color: var(--accent-success);">${formatPrice(sale.total)}</td>
        </tr>
      `;
    }).join('');
  }
  
  // Financial indicators
  const totalSales = state.salesHistory.reduce((sum, s) => sum + s.total, 0);
  const totalExpenses = state.marketExpenses.reduce((sum, e) => sum + e.cost, 0);
  const netProfit = totalSales - totalExpenses;
  
  document.getElementById('reportGrossRevenueText').textContent = formatPrice(totalSales);
  document.getElementById('reportTotalExpensesText').textContent = formatPrice(totalExpenses);
  
  const profitEl = document.getElementById('reportNetProfitText');
  profitEl.textContent = formatPrice(netProfit);
  if (netProfit >= 0) {
    profitEl.style.color = 'var(--accent-success)';
  } else {
    profitEl.style.color = 'var(--accent-danger)';
  }
  
  // Ratio calculation
  const ratioText = document.getElementById('revenueExpenseRatioText');
  const progressBar = document.getElementById('revenueRatioProgressBar');
  
  if (totalSales > 0) {
    const expensePercent = Math.min(100, Math.round((totalExpenses / totalSales) * 100));
    const profitPercent = 100 - expensePercent;
    
    ratioText.textContent = `Profit is ${profitPercent}% of sales. Expenses are ${expensePercent}%.`;
    progressBar.style.width = profitPercent + '%';
  } else {
    ratioText.textContent = 'No sales yet.';
    progressBar.style.width = '0%';
  }
  
  // --- Transaction History Ledger rendering ---
  const txBody = document.getElementById('txHistoryReportTableBody');
  if (txBody) {
    const dateFilterVal = document.getElementById('txHistoryDateFilter').value;
    const typeFilterVal = document.getElementById('txHistoryTypeFilter').value;
    const methodFilterVal = document.getElementById('txHistoryMethodFilter').value;
    
    let txList = state.transactionHistory || [];
    if (txList.length === 0 && state.register) {
      txList = [...(state.register.cashIn || []), ...(state.register.cashOut || [])];
    }
    
    let filteredTxs = [...txList].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    if (dateFilterVal) {
      filteredTxs = filteredTxs.filter(t => {
        const tDate = new Date(t.timestamp).toISOString().slice(0, 10);
        return tDate === dateFilterVal;
      });
    }
    
    if (typeFilterVal && typeFilterVal !== 'ALL') {
      filteredTxs = filteredTxs.filter(t => t.type === typeFilterVal);
    }
    
    if (methodFilterVal && methodFilterVal !== 'ALL') {
      filteredTxs = filteredTxs.filter(t => t.method && t.method.toLowerCase() === methodFilterVal.toLowerCase());
    }
    
    if (filteredTxs.length === 0) {
      txBody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">
            No transactions found.
          </td>
        </tr>
      `;
    } else {
      txBody.innerHTML = filteredTxs.map(t => {
        const formattedTime = new Date(t.timestamp).toLocaleString('my-MM');
        const typeLabel = t.type === 'in' ? '<span class="status-badge preparing">In</span>' : '<span class="status-badge alert">Out</span>';
        const amountStyle = t.type === 'in' ? 'color: var(--accent-success); font-weight: 700;' : 'color: var(--accent-danger); font-weight: 700;';
        const amountPrefix = t.type === 'in' ? '+' : '-';
        
        return `
          <tr>
            <td>${formattedTime}</td>
            <td>${typeLabel}</td>
            <td><strong>${escapeHtml(t.method || 'Cash')}</strong></td>
            <td>${escapeHtml(t.note)}</td>
            <td style="text-align: right; ${amountStyle}">${amountPrefix}${formatPrice(t.amount)}</td>
          </tr>
        `;
      }).join('');
    }
  }
  
  // --- Register Shift History rendering ---
  const shiftBody = document.getElementById('shiftHistoryReportTableBody');
  if (shiftBody) {
    const shifts = state.registerHistory || [];
    const sortedShifts = [...shifts].sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));
    
    if (sortedShifts.length === 0) {
      shiftBody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">
            No register shift history found.
          </td>
        </tr>
      `;
    } else {
      shiftBody.innerHTML = sortedShifts.map(s => {
        const openedTime = s.openedAt ? new Date(s.openedAt).toLocaleString() : 'N/A';
        const closedTime = s.closedAt ? new Date(s.closedAt).toLocaleString() : 'N/A';
        
        let diffColor = 'var(--text-primary)';
        let diffText = formatPrice(s.difference);
        if (s.difference > 0) {
          diffColor = 'var(--accent-success)';
          diffText = `+${diffText} (Over)`;
        } else if (s.difference < 0) {
          diffColor = 'var(--accent-danger)';
          diffText = `-${formatPrice(Math.abs(s.difference))} (Short)`;
        }
        
        return `
          <tr>
            <td>
              <small><b>Open:</b> ${openedTime}</small><br>
              <small><b>Close:</b> ${closedTime}</small>
            </td>
            <td><strong>${escapeHtml(s.openedBy)}</strong></td>
            <td style="text-align: right;">${formatPrice(s.openingCash)}</td>
            <td style="text-align: right;">${formatPrice(s.expectedCash)}</td>
            <td style="text-align: right; font-weight: bold;">${formatPrice(s.actualCash)}</td>
            <td style="text-align: right; font-weight: 800; color: ${diffColor};">${diffText}</td>
            <td><small style="color: var(--text-muted);">${escapeHtml(s.closingNote || '-')}</small></td>
          </tr>
        `;
      }).join('');
    }
  }
}

function exportDataToCSV() {
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Type,Ref ID,Date/Time,Source/Name,Amount\n";
  
  state.salesHistory.forEach(s => {
    csvContent += `Sale,${s.id},"${new Date(s.timestamp).toLocaleString()}",${s.tableName},${s.total}\n`;
  });
  
  state.marketExpenses.forEach(e => {
    csvContent += `Expense,${e.id},${e.date},"${e.itemName}",-${e.cost}\n`;
  });
  
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `POS_Financial_Export_${new Date().toISOString().substr(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}


// --- H. SETTINGS CONTROLLER (MENU MANAGER & GENERAL CONFIG) ---
function populateAdminCategoryFilter() {
  const filterSelect = document.getElementById('adminProductCategoryFilter');
  if (!filterSelect) return;
  
  const currentValue = filterSelect.value || 'ALL';
  
  let optionsHTML = `<option value="ALL">All Categories</option>`;
  optionsHTML += state.categories.map(cat => {
    return `<option value="${cat.id}">${cat.name}</option>`;
  }).join('');
  
  filterSelect.innerHTML = optionsHTML;
  filterSelect.value = currentValue;
}

function adjustStockQuick(productId, amount) {
  const prod = state.products.find(p => p.id === productId);
  if (prod && prod.track_inventory) {
    prod.stock = Math.max(0, prod.stock + amount);
    saveState();
    renderSettingsPane();
    renderSalesCounter();
  }
}

function renderSettingsPane() {
  const container = document.getElementById('settingsProductEditContainer');
  if (!container) return;
  
  // Categorized dropdown inside menuItemAddEditModal
  populateProductCategoriesDropdown();
  
  // Populate the admin category filter dropdown
  populateAdminCategoryFilter();
  
  if (state.products.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 40px;">
        <i class="fa-solid fa-utensils" style="font-size: 3rem; margin-bottom: 12px; opacity: 0.3;"></i>
        <p>No products yet. Use New Product or Import to add menu items.</p>
      </div>
    `;
    updateBatchDeleteButtonState();
    return;
  }
  
  // Apply Search & Category Filtering
  const searchInput = document.getElementById('adminProductSearchInput');
  const categoryFilter = document.getElementById('adminProductCategoryFilter');
  
  const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const selectedCatId = categoryFilter ? categoryFilter.value : 'ALL';
  
  let filteredProducts = state.products;
  
  if (selectedCatId !== 'ALL') {
    filteredProducts = filteredProducts.filter(p => p.categoryId === selectedCatId);
  }
  
  if (searchQuery) {
    filteredProducts = filteredProducts.filter(p => p.name.toLowerCase().includes(searchQuery));
  }
  
  if (filteredProducts.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 40px;">
        <i class="fa-solid fa-magnifying-glass" style="font-size: 2.5rem; margin-bottom: 12px; opacity: 0.3;"></i>
        <p>No products match your search or category filter.</p>
      </div>
    `;
    updateBatchDeleteButtonState();
    return;
  }
  
  // Select All Header Bar
  const selectAllBar = `
    <div style="display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: rgba(255,255,255,0.02); border-bottom: 1px solid var(--panel-border); margin-bottom: 10px; border-radius: var(--border-radius-sm);">
      <input type="checkbox" id="selectAllProductsCheckbox" style="width: 18px; height: 18px; cursor: pointer;" onchange="toggleSelectAllProducts(this)">
      <label for="selectAllProductsCheckbox" style="font-size: 0.85rem; font-weight: bold; cursor: pointer; color: var(--text-secondary); margin: 0; user-select: none;">Select All Products</label>
    </div>
  `;
  
  const rowsHTML = filteredProducts.map(p => {
    const cat = state.categories.find(c => c.id === p.categoryId);
    const catName = cat ? cat.name : 'Unknown';
    return `
      <div class="edit-product-row" style="display: flex; align-items: center; gap: 12px; padding: 10px 14px;">
        <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
          <input type="checkbox" class="product-select-checkbox" data-product-id="${p.id}" style="width: 18px; height: 18px; cursor: pointer; margin: 0;" onchange="updateBatchDeleteButtonState()">
          <div class="edit-row-details" style="display: flex; align-items: center; gap: 10px; flex: 1; margin: 0;">
            ${p.image ? `
              <img src="${p.image}" style="width: 36px; height: 36px; border-radius: var(--border-radius-sm); object-fit: cover; flex-shrink: 0; border: 1px solid var(--panel-border);" alt="${p.name}">
            ` : `
              <div class="edit-prod-color-dot" style="background: ${p.color || '#10b981'}; width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; margin-left: 12px; margin-right: 12px;"></div>
            `}
            <div class="edit-row-text">
              <h4 style="margin: 0 0 3px 0; font-size: 0.95rem; font-weight: 700; color: var(--text-primary);">${p.name}</h4>
              <p style="margin: 0; font-size: 0.8rem; color: var(--text-secondary);">Category: <strong>${catName}</strong> | ${formatPrice(p.price)} ${p.track_inventory ? `| Stock: <strong style="color: var(--accent-brand-blue);">${p.stock}</strong>` : '| No Stock Track'}</p>
            </div>
          </div>
        </div>
        
        <!-- Inline stock adjuster and action buttons -->
        <div class="edit-row-actions" style="margin-left: auto; flex-shrink: 0; display: flex; align-items: center; gap: 6px;">
          ${p.track_inventory ? `
            <div style="display: flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.03); padding: 2px; border-radius: var(--border-radius-sm); border: 1.5px solid var(--panel-border); margin-right: 6px;">
              <button type="button" class="btn-edit-action" onclick="adjustStockQuick('${p.id}', -1)" style="width: 28px; height: 28px; font-size: 0.85rem; padding: 0; display: flex; align-items: center; justify-content: center;" title="Decrease Stock">-</button>
              <button type="button" class="btn-edit-action" onclick="adjustStockQuick('${p.id}', 1)" style="width: 28px; height: 28px; font-size: 0.85rem; padding: 0; display: flex; align-items: center; justify-content: center;" title="Increase Stock">+</button>
            </div>
          ` : ''}
          <button class="btn-edit-action" onclick="openEditProductModal('${p.id}')">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="btn-edit-action delete" onclick="deleteProduct('${p.id}')">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = selectAllBar + rowsHTML;

  // Update batch delete button and checkboxes state
  updateBatchDeleteButtonState();

  // Call other settings sections rendering
  renderCategoryManagement();
  renderUserManagement();
  renderLoyaltyMembersList();
  // Refresh local IP display after settings render
  displayLocalIpAddress(cachedLocalIp);
}

function handleSettingsSubmit() {
  const name = document.getElementById('setRestName')?.value?.trim() || state.settings.restaurantName || 'Pandora POS';
  const taxInput = document.getElementById('setTaxRate');
  const tax = taxInput ? (parseInt(taxInput.value) || 0) : (state.settings.taxRate || 0);
  const curr = document.getElementById('setCurrency')?.value?.trim() || state.settings.currency || 'MMK';
  const printer = document.getElementById('setPrinterName')?.value || state.settings.printerName || 'POS-80 Kitchen Printer';
  const drinksPrinter = document.getElementById('setDrinksPrinterName')?.value || state.settings.drinksPrinterName || 'POS-80 Drinks Printer (Simulated)';
  
  state.settings.restaurantName = name;
  state.settings.brandLogoDataUrl = document.getElementById('setBrandLogoDataUrl')?.value || '';
  state.settings.taxRate = tax;
  state.settings.currency = curr;
  state.settings.printerName = printer;
  state.settings.drinksPrinterName = drinksPrinter;
  state.settings.printerCutPaper = document.getElementById('setPrinterCutPaper')?.checked === true;
  state.settings.voucherTitle = document.getElementById('setVoucherTitle')?.value.trim() || name;
  state.settings.voucherAddress = document.getElementById('setVoucherAddress')?.value.trim() || '';
  state.settings.voucherPhone = document.getElementById('setVoucherPhone')?.value.trim() || '';
  state.settings.voucherFooter = document.getElementById('setVoucherFooter')?.value.trim() || '';
  state.settings.voucherShowLogo = false;
  state.settings.voucherPaperSize = document.getElementById('setVoucherPaperSize')?.value || '80mm';
  
  const setEnableChatBot = document.getElementById('setEnableChatBot');
  if (setEnableChatBot) {
    state.settings.enableChatBot = setEnableChatBot.checked;
  }
  
  saveState();
  applySettings();
  closeRestaurantConfigModal();
  
  // Close the settings pane by returning to the Dashboard pane
  switchTab('dashboard-pane');
  
  alert("Action completed.");
}

function handleBrandLogoUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    alert('Please choose a PNG, JPG, or WebP logo image.');
    event.target.value = '';
    return;
  }
  if (file.size > 800 * 1024) {
    alert('Logo image is too large. Please choose an image under 800 KB.');
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result || '');
    const hiddenInput = document.getElementById('setBrandLogoDataUrl');
    const preview = document.getElementById('setBrandLogoPreview');
    if (hiddenInput) hiddenInput.value = dataUrl;
    if (preview) preview.src = dataUrl;
    renderVoucherSettingsPreview();
  };
  reader.onerror = () => {
    alert('Could not read the logo image. Please try another file.');
  };
  reader.readAsDataURL(file);
}

function removeBrandLogo() {
  const fileInput = document.getElementById('setBrandLogoFile');
  const hiddenInput = document.getElementById('setBrandLogoDataUrl');
  const preview = document.getElementById('setBrandLogoPreview');
  if (fileInput) fileInput.value = '';
  if (hiddenInput) hiddenInput.value = '';
  if (preview) preview.src = 'logo.png';
  renderVoucherSettingsPreview();
}

// Menu Items Edit Modals
function openAddProductModal() {
  document.getElementById('menuItemModalTitle').textContent = 'New Product';
  document.getElementById('editProductId').value = '';
  document.getElementById('menuItemAddEditForm').reset();
  switchProductModalTab('basic');
  
  const optionsTextarea = document.getElementById('prodOptions');
  if (optionsTextarea) optionsTextarea.value = '';
  
  // Reset image preview state
  state.tempProductImage = null;
  const preview = document.getElementById('productImagePreview');
  const placeholder = document.getElementById('imageUploadPlaceholder');
  if (preview) preview.style.display = 'none';
  if (placeholder) placeholder.style.display = 'flex';
  
  // Set default active color preset
  setActiveColorPreset('#10b981', 'prodColorPresetsGrid', 'prodColor');
  
  document.getElementById('prodInitialStockWrapper').style.display = 'block';
  // Clear product ingredients rows
  const recipeContainer = document.getElementById('productRecipeRowsContainer');
  if (recipeContainer) recipeContainer.innerHTML = '';
  document.getElementById('menuItemModalOverlay').classList.add('active');
}
function openEditProductModal(productId) {
  const p = state.products.find(item => item.id === productId);
  if (!p) return;
  
  document.getElementById('menuItemModalTitle').textContent = 'Edit Product';
  document.getElementById('editProductId').value = p.id;
  document.getElementById('prodName').value = p.name;
  document.getElementById('prodPrice').value = p.price;
  document.getElementById('prodCategory').value = p.categoryId || '';
  document.getElementById('prodBarcode').value = p.barcode || '';
  document.getElementById('prodColor').value = p.color || '#10b981';
  document.getElementById('prodTrackInventory').checked = p.track_inventory;
  switchProductModalTab('basic');
  
  const stationSel = document.getElementById('prodStation');
  if (stationSel) {
    stationSel.value = p.station || 'Hot Kitchen';
  }
  
  const stockWrapper = document.getElementById('prodInitialStockWrapper');
  if (stockWrapper) {
    stockWrapper.style.display = p.track_inventory ? 'block' : 'none';
    document.getElementById('prodInitialStock').value = p.stock || 0;
  }
  
  // Load options into textarea
  const optionsTextarea = document.getElementById('prodOptions');
  if (optionsTextarea) {
    if (p.options && p.options.length > 0) {
      optionsTextarea.value = p.options.map((o, idx) => {
        return idx === 0 ? `${o.name}, 0 (default)` : `${o.name}, ${o.priceModifier || 0}`;
      }).join('\n');
    } else {
      optionsTextarea.value = '';
    }
  }
  
  // Set active color preset
  setActiveColorPreset(p.color || '#10b981', 'prodColorPresetsGrid', 'prodColor');
  
  // Populate product ingredients rows
  const recipeContainer = document.getElementById('productRecipeRowsContainer');
  if (recipeContainer) {
    recipeContainer.innerHTML = '';
    if (p.ingredients && Array.isArray(p.ingredients)) {
      p.ingredients.forEach(ing => {
        addProductIngredientRow(ing.inventoryItemId, ing.quantity);
      });
    }
  }
  
  // Load image preview
  state.tempProductImage = p.image || null;
  const preview = document.getElementById('productImagePreview');
  const placeholder = document.getElementById('imageUploadPlaceholder');
  if (preview && p.image) {
    preview.src = p.image;
    preview.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';
  } else {
    if (preview) preview.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
  }
  
  document.getElementById('menuItemModalOverlay').classList.add('active');
}

function closeMenuItemModal() {
  document.getElementById('menuItemModalOverlay').classList.remove('active');
}

function switchProductModalTab(tabName) {
  document.querySelectorAll('.product-modal-tab').forEach(btn => {
    const active = btn.dataset.productTab === tabName;
    btn.classList.toggle('active', active);
    btn.style.background = active ? 'var(--accent-brand-blue)' : 'var(--input-bg)';
    btn.style.color = active ? '#ffffff' : 'var(--text-primary)';
    btn.style.borderColor = active ? 'var(--accent-brand-blue)' : 'var(--panel-border)';
  });
  document.querySelectorAll('.product-tab-panel').forEach(panel => {
    panel.style.display = panel.dataset.productPanel === tabName ? 'block' : 'none';
    panel.classList.toggle('active', panel.dataset.productPanel === tabName);
  });
}

function handleMenuItemAddEditSubmit() {
  const id = document.getElementById('editProductId').value;
  const name = document.getElementById('prodName').value;
  const price = parseInt(document.getElementById('prodPrice').value);
  const categoryId = document.getElementById('prodCategory').value;
  const barcode = document.getElementById('prodBarcode')?.value.trim() || '';
  const color = document.getElementById('prodColor').value;
  const track = document.getElementById('prodTrackInventory').checked;
  const stock = parseInt(document.getElementById('prodInitialStock').value) || 0;
  const station = document.getElementById('prodStation')?.value || 'Hot Kitchen';
  
  // Parse options from textarea: "Option Name, priceModifier" one per line
  const optionsRaw = (document.getElementById('prodOptions')?.value || '').trim();
  let parsedOptions = [];
  if (optionsRaw) {
    parsedOptions = optionsRaw.split('\n')
      .map((line, idx) => {
        const parts = line.split(',').map(s => s.trim());
        const optName = parts[0].replace('(default)', '').trim();
        const optPrice = parseInt(parts[1]) || 0;
        const entry = { name: optName, priceModifier: optPrice };
        if (idx === 0) entry.isDefault = true;
        return entry;
      })
      .filter(o => o.name);
  }
  
  // Read recipe ingredients list
  const recipeRows = document.querySelectorAll('#productRecipeRowsContainer > div');
  const ingredients = [];
  recipeRows.forEach(row => {
    const selectEl = row.querySelector('.recipe-item-select');
    const qtyEl = row.querySelector('.recipe-item-qty');
    if (selectEl && qtyEl) {
      const invId = selectEl.value;
      const qty = parseFloat(qtyEl.value) || 0;
      if (invId && qty > 0) {
        ingredients.push({ inventoryItemId: invId, quantity: qty });
      }
    }
  });

  if (id) {
    // Edit Mode
    const prod = state.products.find(p => p.id === id);
    if (prod) {
      prod.name = name;
      prod.ingredients = ingredients;
      prod.price = price;
      prod.categoryId = categoryId;
      prod.barcode = barcode;
      prod.color = color;
      prod.track_inventory = track;
      prod.station = station;
      if (track) prod.stock = stock;
      if (parsedOptions.length > 0) {
        prod.options = parsedOptions;
      } else {
        delete prod.options;
      }
      
      // Save product image
      if (state.tempProductImage) {
        prod.image = state.tempProductImage;
      } else {
        delete prod.image;
      }
    }
  } else {
    // Add Mode
    const newProd = {
      id: generateId('p'),
      name: name,
      price: price,
      categoryId: categoryId,
      barcode: barcode,
      color: color,
      track_inventory: track,
      stock: track ? stock : 0,
      station: station,
      ingredients: ingredients
    };
    if (parsedOptions.length > 0) newProd.options = parsedOptions;
    if (state.tempProductImage) newProd.image = state.tempProductImage;
    state.products.push(newProd);
  }
  
  saveState();
  renderSettingsPane();
  renderSalesCounter(); // Dynamic reload checkout
  closeMenuItemModal();
  alert("Action completed.");
}

function deleteProduct(productId) {
  if (confirm("Are you sure?")) {
    state.products = state.products.filter(p => p.id !== productId);
    saveState();
    renderSettingsPane();
  }
}

// --- I. LOGIN SYSTEM LOGIC & SESSION CONTROL ---
function checkLoginSession() {
  ensureDemoUserSession();

  const overlay = document.getElementById('loginScreenOverlay');
  const userDisplay = document.getElementById('currentLoggedInUserName');
  const roleDisplay = document.getElementById('currentLoggedInUserRole');
  
  const hash = window.location.hash;
  const isCustomerPortal = hash.startsWith('#self-order') || hash === '#menu';

  if (!state.currentUser && !isCustomerPortal) {
    // Show login block overlay
    if (overlay) {
      overlay.classList.add('active');
      overlay.style.display = 'flex';
    }
    // Clean fields
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    updatePinDisplay(0);
    renderLoginUsers();
    
    // Reset selection dropdown
    const selectEl = document.getElementById('loginUserSelect');
    if (selectEl) selectEl.value = '';
    setLoginPasswordStepVisible(false);
    
    document.getElementById('loginErrorMessage').style.display = 'none';
  } else {
    // Hide overlay
    if (overlay) {
      overlay.classList.remove('active');
      overlay.style.display = 'none';
    }
    
    // Update footer info
    if (state.currentUser) {
      if (userDisplay) userDisplay.textContent = state.currentUser.name;
      if (roleDisplay) roleDisplay.textContent = state.currentUser.role;
      
      // Restrict sidebar items based on role
      const navItems = document.querySelectorAll('.nav-item');
      const allowedTabs = new Set(getUserAllowedTabs(state.currentUser));
      
      navItems.forEach(item => {
        const tabId = item.getAttribute('data-tab');
        item.style.display = allowedTabs.has(tabId) ? 'flex' : 'none';
      });
    }
  }
}

async function handleLoginSubmit(username, password) {
  const errorMessage = document.getElementById('loginErrorMessage');
  const submitBtn = document.getElementById('loginSubmitBtn');
  const localCandidate = sharedServerState();
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.7';
    submitBtn.style.pointerEvents = 'none';
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Logging in...';
  }
  
  try {
    const result = await apiRequest('login', {
      method: 'POST',
      body: JSON.stringify({ username: username.trim(), password })
    });
    serverCsrfToken = result.csrfToken;
    state.currentUser = result.user;
    localStorage.setItem('POS_PERSISTENT_USER', JSON.stringify(state.currentUser));
    errorMessage.style.display = 'none';
    checkLoginSession();
    applyServerState(state); // Instant local render while server sync runs
    await connectServerSync(localCandidate);
  } catch (error) {
    console.warn('Server login failed:', error.message);
    errorMessage.textContent = error.status === 401
      ? 'Invalid PIN/password. Please try again.'
      : 'Cannot connect to the online POS server. Please check internet/server connection and try again.';
    errorMessage.style.display = 'block';
    resetPinInput();
    return;
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
      submitBtn.style.pointerEvents = 'auto';
      submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> စနစ်ထဲသို့ဝင်မည် (Login)';
    }
  }
}

// â”€â”€ PIN Keypad & User Selector Login Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let selectedLoginUsername = null;

function setLoginPasswordStepVisible(visible) {
  const step = document.getElementById('loginPasswordStep');
  if (step) step.style.display = visible ? 'block' : 'none';
}

function renderLoginUsers() {
  const selectEl = document.getElementById('loginUserSelect');
  if (!selectEl) return;

  let usersList = [];
  if (state.users && state.users.length > 0) {
    usersList = state.users.map(u => ({
      username: u.username,
      name: u.name,
      role: u.role
    }));
  } else {
    // Fallback roles if state.users is not yet synced/empty
    usersList = [
      { username: 'admin', name: 'Admin', role: 'admin' },
      { username: 'cashier', name: 'Cashier', role: 'cashier' },
      { username: 'waiter', name: 'Waiter', role: 'waiter' }
    ];
  }

  // Ensure unique usernames
  const uniqueUsers = [];
  const seenUsernames = new Set();
  usersList.forEach(u => {
    if (!seenUsernames.has(u.username)) {
      seenUsernames.add(u.username);
      uniqueUsers.push(u);
    }
  });

  // Render option elements (with placeholder option at top)
  let html = '<option value="">Select user</option>';
  html += uniqueUsers.map(u => {
    const roleLabel = u.role.toUpperCase();
    return `<option value="${u.username}">${u.name} (${roleLabel})</option>`;
  }).join('');

  selectEl.innerHTML = html;

  // Restore selected state if match exists
  if (selectedLoginUsername && seenUsernames.has(selectedLoginUsername)) {
    selectEl.value = selectedLoginUsername;
  } else {
    selectedLoginUsername = null;
    const usernameInput = document.getElementById('loginUsername');
    if (usernameInput) usernameInput.value = '';
  }
}

function selectLoginUser(username, displayName) {
  selectedLoginUsername = username;
  const usernameInput = document.getElementById('loginUsername');
  if (usernameInput) usernameInput.value = username;
  
  resetPinInput();
  setLoginPasswordStepVisible(Boolean(username));
  const errorMessage = document.getElementById('loginErrorMessage');
  if (errorMessage) errorMessage.style.display = 'none';
}

function pressPinKey(key) {
  const username = document.getElementById('loginUsername')?.value;
  if (!username) return;
  const pinInput = document.getElementById('loginPassword');
  if (!pinInput) return;

  let currentPin = pinInput.value;

  if (key === 'C') {
    currentPin = '';
  } else if (key === 'back') {
    currentPin = currentPin.slice(0, -1);
  } else {
    // Max 4 digits for PIN
    if (currentPin.length < 4) {
      currentPin += key;
    }
  }

  pinInput.value = currentPin;
  updatePinDisplay(currentPin.length);

  // If user hit C or backspace, clean error
  const errorMessage = document.getElementById('loginErrorMessage');
  if (errorMessage && (key === 'C' || key === 'back')) {
    errorMessage.style.display = 'none';
  }

  // Auto-submit immediately once the PIN reaches exactly 4 digits!
  if (currentPin.length === 4) {
    // Slight timeout so the user sees the last PIN dot illuminate
    setTimeout(() => {
      submitPinLogin();
    }, 80);
  }
}

function resetPinInput() {
  const pinInput = document.getElementById('loginPassword');
  if (pinInput) pinInput.value = '';
  updatePinDisplay(0);
}

function updatePinDisplay(length) {
  for (let i = 1; i <= 4; i++) {
    const dot = document.getElementById(`pin-dot-${i}`);
    if (dot) {
      if (i <= length) {
        dot.classList.add('active');
      } else {
        dot.classList.remove('active');
      }
    }
  }
}

function submitPinLogin() {
  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;

  if (!username) {
    const errorMessage = document.getElementById('loginErrorMessage');
    if (errorMessage) {
      errorMessage.textContent = 'Please select a user first.';
      errorMessage.style.display = 'block';
    }
    return;
  }
  if (password.length < 3) {
    const errorMessage = document.getElementById('loginErrorMessage');
    if (errorMessage) {
      errorMessage.textContent = 'Please enter your PIN/password.';
      errorMessage.style.display = 'block';
    }
    return;
  }

  handleLoginSubmit(username, password);
}

async function handleLogout() {
  if (confirm("Are you sure?")) {
    try {
      await apiRequest('logout', { method: 'POST', body: '{}' });
    } catch (error) {
      console.warn('Server logout failed:', error.message);
    }
    clearInterval(serverPollTimer);
    serverCsrfToken = null;
    serverReady = false;
    state.currentUser = null;
    localStorage.removeItem('POS_PERSISTENT_USER');
    localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(state));
    checkLoginSession();
  }
}

// --- J. USER ACCOUNTS MANAGEMENT ---
const USER_ACCESS_TABS = [
  { id: 'dashboard-pane', label: 'Dashboard' },
  { id: 'sales-pane', label: 'POS' },
  { id: 'kitchen-pane', label: 'Kitchen KDS' },
  { id: 'market-pane', label: 'Expenses' },
  { id: 'inventory-pane', label: 'Inventory' },
  { id: 'reports-pane', label: 'Reports' },
  { id: 'settings-pane', label: 'Settings' },
  { id: 'admin-pane', label: 'Admin Panel' }
];
let reopenRestaurantSettingsAfterUserModal = false;

function defaultAllowedTabsForRole(role) {
  if (role === 'admin') return USER_ACCESS_TABS.map(t => t.id);
  if (role === 'owner') return ['dashboard-pane', 'reports-pane'];
  if (role === 'cashier') return ['sales-pane', 'kitchen-pane', 'market-pane', 'inventory-pane', 'settings-pane'];
  if (role === 'waiter') return ['sales-pane', 'kitchen-pane', 'settings-pane'];
  return ['sales-pane'];
}

function getUserAllowedTabs(user) {
  if (!user) return [];
  if (Array.isArray(user.allowedTabs) && user.allowedTabs.length > 0) {
    return user.allowedTabs;
  }
  return defaultAllowedTabsForRole(user.role);
}

function canUserAccessTab(user, tabId) {
  return getUserAllowedTabs(user).includes(tabId);
}

function renderUserTabAccessChecklist(selectedTabs = []) {
  const container = document.getElementById('userTabAccessChecklist');
  if (!container) return;
  const selected = new Set(selectedTabs);
  container.innerHTML = USER_ACCESS_TABS.map(tab => `
    <label style="display:flex; align-items:center; gap:8px; padding:7px 8px; border:1px solid var(--panel-border); border-radius:var(--border-radius-sm); background:var(--input-bg); font-size:0.82rem; font-weight:800; cursor:pointer; user-select:none;">
      <input type="checkbox" class="usr-access-tab-checkbox" value="${tab.id}" ${selected.has(tab.id) ? 'checked' : ''} style="width:16px; height:16px; accent-color:var(--accent-brand-blue);">
      <span>${tab.label}</span>
    </label>
  `).join('');
}

function getSelectedUserAccessTabs() {
  return Array.from(document.querySelectorAll('.usr-access-tab-checkbox:checked')).map(cb => cb.value);
}

function setUserAccessFromRole() {
  const role = document.getElementById('usrRole')?.value || 'cashier';
  renderUserTabAccessChecklist(defaultAllowedTabsForRole(role));
}

window.setUserAccessFromRole = setUserAccessFromRole;

function renderUserManagement() {
  const container = document.getElementById('settingsUserEditContainer');
  if (!container) return;
  
  if (!state.users || state.users.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 15px;">No users yet</div>`;
    return;
  }
  
  container.innerHTML = state.users.map(u => {
    // Avoid deleting self
    const deleteBtn = state.currentUser && state.currentUser.id === u.id 
      ? `<span style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">Self</span>`
      : `<button class="btn-edit-action delete" onclick="deleteUser('${u.id}')"><i class="fa-solid fa-trash-can"></i></button>`;
      
    const roleLabel = u.role === 'admin' 
      ? `<span class="expense-tag stock-linked" style="background: rgba(11, 87, 164, 0.15); border-color: var(--accent-brand-blue); color: var(--accent-brand-blue);">ADMIN</span>` 
      : `<span class="expense-tag">${String(u.role || 'staff').toUpperCase()}</span>`;
    const allowedLabels = getUserAllowedTabs(u)
      .map(tabId => USER_ACCESS_TABS.find(tab => tab.id === tabId)?.label)
      .filter(Boolean)
      .join(', ');
      
    return `
      <div class="edit-product-row">
        <div class="edit-row-details">
          <div class="edit-row-text">
            <h4 style="display: flex; align-items: center; gap: 8px;">${u.name} ${roleLabel}</h4>
            <p>Username: <strong>${u.username}</strong> | Password: <strong>Hidden</strong></p>
            <p style="margin-top:4px;">Allowed Tabs: <strong>${allowedLabels || 'None'}</strong></p>
          </div>
        </div>
        <div class="edit-row-actions">
          <button class="btn-edit-action" onclick="openEditUserModal('${u.id}')">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          ${deleteBtn}
        </div>
      </div>
    `;
  }).join('');
}

function openAddUserModal() {
  prepareUserModalLayer();
  document.getElementById('userModalTitle').textContent = 'New User';
  document.getElementById('editUserId').value = '';
  document.getElementById('userAddEditForm').reset();
  renderUserTabAccessChecklist(defaultAllowedTabsForRole('cashier'));
  document.getElementById('userModalOverlay').classList.add('active');
}

function openEditUserModal(userId) {
  const u = state.users.find(usr => usr.id === userId);
  if (!u) return;
  
  prepareUserModalLayer();
  document.getElementById('userModalTitle').textContent = 'Edit User';
  document.getElementById('editUserId').value = u.id;
  document.getElementById('usrFullName').value = u.name;
  document.getElementById('usrUsername').value = u.username;
  document.getElementById('usrPassword').value = '';
  document.getElementById('usrRole').value = u.role;
  renderUserTabAccessChecklist(getUserAllowedTabs(u));
  
  document.getElementById('userModalOverlay').classList.add('active');
}

function prepareUserModalLayer() {
  const settingsModal = document.getElementById('restaurantConfigModalOverlay');
  reopenRestaurantSettingsAfterUserModal = Boolean(settingsModal && settingsModal.classList.contains('active'));
  if (reopenRestaurantSettingsAfterUserModal) {
    settingsModal.classList.remove('active');
  }
}

function closeUserModal() {
  document.getElementById('userModalOverlay').classList.remove('active');
  if (reopenRestaurantSettingsAfterUserModal) {
    reopenRestaurantSettingsAfterUserModal = false;
    renderUserManagement();
    const settingsModal = document.getElementById('restaurantConfigModalOverlay');
    if (settingsModal) settingsModal.classList.add('active');
  }
}

function handleUserAddEditSubmit() {
  const id = document.getElementById('editUserId').value;
  const fullName = document.getElementById('usrFullName').value.trim();
  const username = document.getElementById('usrUsername').value.trim();
  const password = document.getElementById('usrPassword').value.trim();
  const role = document.getElementById('usrRole').value;
  const allowedTabs = getSelectedUserAccessTabs();
  
  if (!fullName || !username || (!id && !password)) {
    alert("Action completed.");
    return;
  }
  
  // Check for duplicate username
  const dup = state.users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.id !== id);
  if (dup) {
    alert("Action completed.");
    return;
  }
  
  if (id) {
    // Edit User
    const user = state.users.find(u => u.id === id);
    if (user) {
      user.name = fullName;
      user.username = username;
      if (password) user.password = password;
      user.role = role;
      user.allowedTabs = allowedTabs;
      
      // Update session details if editing logged in self
      if (state.currentUser && state.currentUser.id === id) {
        state.currentUser = user;
      }
    }
  } else {
    // Add User
    const newUser = {
      id: generateId('u'),
      name: fullName,
      username: username,
      password: password,
      role: role,
      allowedTabs: allowedTabs
    };
    state.users.push(newUser);
  }
  
  saveState();
  renderUserManagement();
  closeUserModal();
  checkLoginSession(); // Refresh session in case logged-in self was edited
  alert("Action completed.");
}

function deleteUser(userId) {
  if (confirm("Are you sure?")) {
    state.users = state.users.filter(u => u.id !== userId);
    saveState();
    renderUserManagement();
    alert("Action completed.");
  }
}

// --- K. ROOT MENU MANAGEMENT CONTROLLER ---
// --- K. CATEGORY MANAGEMENT CONTROLLER ---
function renderCategoryManagement() {
  const container = document.getElementById('settingsCategoryEditContainer');
  if (!container) return;
  
  if (!state.categories || state.categories.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 15px;">á€™á€”á€ºá€”á€°á€¸á€¡á€¯á€•á€ºá€…á€¯á€™á€»á€¬á€¸ á€™á€›á€¾á€­á€žá€±á€¸á€•á€«</div>`;
    return;
  }
  
  container.innerHTML = state.categories.map(c => `
    <div class="edit-product-row">
      <div class="edit-row-details">
        <div class="edit-prod-color-dot" style="background: ${c.color || '#ff7b00'}; border-radius: 4px;"></div>
        <div class="edit-row-text">
          <h4>${c.name}</h4>
        </div>
      </div>
      <div class="edit-row-actions">
        <button class="btn-edit-action" onclick="openEditCategoryModal('${c.id}')">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        <button class="btn-edit-action delete" onclick="deleteCategory('${c.id}')">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    </div>
  `).join('');
}

function openAddCategoryModal() {
  document.getElementById('categoryModalTitle').textContent = 'Create new category';
  document.getElementById('editCategoryId').value = '';
  document.getElementById('categoryAddEditForm').reset();
  
  // Set default active color preset
  setActiveColorPreset('#10b981', 'catColorPresetsGrid', 'categoryColor');
  
  document.getElementById('categoryModalOverlay').classList.add('active');
}

function openEditCategoryModal(catId) {
  const c = state.categories.find(item => item.id === catId);
  if (!c) return;
  
  document.getElementById('categoryModalTitle').textContent = 'Edit Category';
  document.getElementById('editCategoryId').value = c.id;
  document.getElementById('categoryName').value = c.name;
  
  // Set active color preset
  setActiveColorPreset(c.color || '#10b981', 'catColorPresetsGrid', 'categoryColor');
  
  document.getElementById('categoryModalOverlay').classList.add('active');
}

function closeCategoryModal() {
  document.getElementById('categoryModalOverlay').classList.remove('active');
}

function handleCategoryAddEditSubmit() {
  const id = document.getElementById('editCategoryId').value;
  const name = document.getElementById('categoryName').value.trim();
  const color = document.getElementById('categoryColor').value;
  
  if (!name) {
    alert("Action completed.");
    return;
  }
  
  // Duplicate check
  const dup = state.categories.find(c => c.name.toLowerCase() === name.toLowerCase() && c.id !== id);
  if (dup) {
    alert("Action completed.");
    return;
  }
  
  let targetId = id;
  if (id) {
    const cat = state.categories.find(c => c.id === id);
    if (cat) {
      cat.name = name;
      cat.color = color;
    }
  } else {
    targetId = generateId('c');
    state.categories.push({
      id: targetId,
      name: name,
      color: color
    });
  }
  
  saveState();
  renderSettingsPane();
  renderSalesCounter(); // Refresh POS Tab filters if active
  
  if (state.isCreatingCategoryFromProductForm) {
    state.isCreatingCategoryFromProductForm = false;
    populateProductCategoriesDropdown();
    const prodCatSelect = document.getElementById('prodCategory');
    if (prodCatSelect) prodCatSelect.value = targetId;
    closeCategoryModal();
    alert("Action completed.");
    return;
  }
  
  if (state.isCreatingCategoryFromSearchBox) {
    state.isCreatingCategoryFromSearchBox = false;
    renderSearchCategoryTable();
    selectSearchCategoryRow(targetId);
    closeCategoryModal();
    alert("Category created successfully!");
    return;
  }
  
  closeCategoryModal();
  alert("Action completed.");
}

function deleteCategory(catId) {
  // Check if items are linked
  const hasLinkedProds = state.products.some(p => p.categoryId === catId);
  if (hasLinkedProds) {
    alert("Action completed.");
    return;
  }
  
  if (confirm("Are you sure?")) {
    state.categories = state.categories.filter(c => c.id !== catId);
    
    // Safety check for active POS filter
    if (state.selectedCategoryId === catId) {
      state.selectedCategoryId = state.categories.length > 0 ? state.categories[0].id : null;
    }
    
    saveState();
    renderSettingsPane();
    renderSalesCounter();
    alert("Action completed.");
  }
}
// --- L. TABLE LAYOUT EDIT & DRAGGING LOGIC ---
function toggleTableManageDropdown(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('tableManageDropdown');
  if (!dropdown) return;
  dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
}

function closeTableManageDropdown() {
  const dropdown = document.getElementById('tableManageDropdown');
  if (dropdown) dropdown.style.display = 'none';
}

function startTableLayoutManagement() {
  if (!state.isTableLayoutEditing) {
    toggleTableLayoutEdit();
  }
}

function finishTableLayoutManagement() {
  if (state.isTableLayoutEditing) {
    toggleTableLayoutEdit();
  } else {
    saveState();
    renderTablesFloorMap();
  }
}

function toggleTableLayoutEdit() {
  state.isTableLayoutEditing = !state.isTableLayoutEditing;
  
  const btn = document.getElementById('toggleTableLayoutEditBtn');
  if (btn) {
    if (state.isTableLayoutEditing) {
      btn.innerHTML = `<i class="fa-solid fa-check"></i> Managing Tables`;
      btn.style.background = 'var(--accent-success)';
      btn.style.color = 'white';
    } else {
      btn.innerHTML = `<i class="fa-solid fa-sliders"></i> Manage Table`;
      btn.style.background = 'rgba(255,255,255,0.08)';
      btn.style.color = 'var(--text-primary)';
    }
  }
  
  renderTablesFloorMap();
}

function makeTableDraggable(el, tableId) {
  el.addEventListener('mousedown', function(e) {
    if (!state.isTableLayoutEditing) return;
    // Don't drag if clicking overlays
    if (e.target.closest('.table-overlay-btn')) return;
    
    e.preventDefault();
    
    const container = document.getElementById('tablesFloorContainer');
    const rect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = parseFloat(el.style.left) || 0;
    const startTop = parseFloat(el.style.top) || 0;
    
    const alignV = document.getElementById('alignLineV');
    const alignH = document.getElementById('alignLineH');
    
    // Filter out the current table we are dragging
    const otherTables = state.tables.filter(t => t.id !== tableId);
    
    function onMouseMove(moveEvent) {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      
      let newLeftPercent = startLeft + (deltaX / rect.width) * 100;
      let newTopPercent = startTop + (deltaY / rect.height) * 100;
      
      const elWidthPercent = (elRect.width / rect.width) * 100;
      const elHeightPercent = (elRect.height / rect.height) * 100;
      
      newLeftPercent = Math.max(0, Math.min(100 - elWidthPercent, newLeftPercent));
      newTopPercent = Math.max(0, Math.min(100 - elHeightPercent, newTopPercent));
      
      let snapX = null;
      let snapY = null;
      const threshold = 2.0; // snapping threshold in percent
      
      // 1. Snapping to other tables' coordinates
      otherTables.forEach(t => {
        if (t.x !== undefined && Math.abs(newLeftPercent - t.x) < threshold) {
          snapX = t.x;
        }
        if (t.y !== undefined && Math.abs(newTopPercent - t.y) < threshold) {
          snapY = t.y;
        }
      });
      
      // 2. Snapping to a general 5% grid if no other table to snap to
      if (snapX === null) {
        const gridSnap = Math.round(newLeftPercent / 5) * 5;
        if (Math.abs(newLeftPercent - gridSnap) < 1.0) {
          snapX = gridSnap;
        }
      }
      if (snapY === null) {
        const gridSnap = Math.round(newTopPercent / 5) * 5;
        if (Math.abs(newTopPercent - gridSnap) < 1.0) {
          snapY = gridSnap;
        }
      }
      
      // Apply snaps
      if (snapX !== null) {
        newLeftPercent = snapX;
        if (alignV) {
          alignV.style.left = `${snapX + (elWidthPercent / 2)}%`; // vertical line centered on card
          alignV.style.display = 'block';
        }
      } else {
        if (alignV) alignV.style.display = 'none';
      }
      
      if (snapY !== null) {
        newTopPercent = snapY;
        if (alignH) {
          alignH.style.top = `${snapY + (elHeightPercent / 2)}%`; // horizontal line centered on card
          alignH.style.display = 'block';
        }
      } else {
        if (alignH) alignH.style.display = 'none';
      }
      
      el.style.left = `${newLeftPercent}%`;
      el.style.top = `${newTopPercent}%`;
      
      const table = state.tables.find(t => t.id === tableId);
      if (table) {
        table.x = Math.round(newLeftPercent);
        table.y = Math.round(newTopPercent);
      }
    }
    
    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (alignV) alignV.style.display = 'none';
      if (alignH) alignH.style.display = 'none';
      saveState();
    }
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
  
  // Touch Dragging
  el.addEventListener('touchstart', function(e) {
    if (!state.isTableLayoutEditing) return;
    if (e.target.closest('.table-overlay-btn')) return;
    
    const touch = e.touches[0];
    const container = document.getElementById('tablesFloorContainer');
    const rect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    
    const startX = touch.clientX;
    const startY = touch.clientY;
    const startLeft = parseFloat(el.style.left) || 0;
    const startTop = parseFloat(el.style.top) || 0;
    
    const alignV = document.getElementById('alignLineV');
    const alignH = document.getElementById('alignLineH');
    
    const otherTables = state.tables.filter(t => t.id !== tableId);
    
    function onTouchMove(moveEvent) {
      const tTouch = moveEvent.touches[0];
      const deltaX = tTouch.clientX - startX;
      const deltaY = tTouch.clientY - startY;
      
      let newLeftPercent = startLeft + (deltaX / rect.width) * 100;
      let newTopPercent = startTop + (deltaY / rect.height) * 100;
      
      const elWidthPercent = (elRect.width / rect.width) * 100;
      const elHeightPercent = (elRect.height / rect.height) * 100;
      
      newLeftPercent = Math.max(0, Math.min(100 - elWidthPercent, newLeftPercent));
      newTopPercent = Math.max(0, Math.min(100 - elHeightPercent, newTopPercent));
      
      let snapX = null;
      let snapY = null;
      const threshold = 2.0;
      
      otherTables.forEach(t => {
        if (t.x !== undefined && Math.abs(newLeftPercent - t.x) < threshold) {
          snapX = t.x;
        }
        if (t.y !== undefined && Math.abs(newTopPercent - t.y) < threshold) {
          snapY = t.y;
        }
      });
      
      if (snapX === null) {
        const gridSnap = Math.round(newLeftPercent / 5) * 5;
        if (Math.abs(newLeftPercent - gridSnap) < 1.0) {
          snapX = gridSnap;
        }
      }
      if (snapY === null) {
        const gridSnap = Math.round(newTopPercent / 5) * 5;
        if (Math.abs(newTopPercent - gridSnap) < 1.0) {
          snapY = gridSnap;
        }
      }
      
      if (snapX !== null) {
        newLeftPercent = snapX;
        if (alignV) {
          alignV.style.left = `${snapX + (elWidthPercent / 2)}%`;
          alignV.style.display = 'block';
        }
      } else {
        if (alignV) alignV.style.display = 'none';
      }
      
      if (snapY !== null) {
        newTopPercent = snapY;
        if (alignH) {
          alignH.style.top = `${snapY + (elHeightPercent / 2)}%`;
          alignH.style.display = 'block';
        }
      } else {
        if (alignH) alignH.style.display = 'none';
      }
      
      el.style.left = `${newLeftPercent}%`;
      el.style.top = `${newTopPercent}%`;
      
      const table = state.tables.find(t => t.id === tableId);
      if (table) {
        table.x = Math.round(newLeftPercent);
        table.y = Math.round(newTopPercent);
      }
    }
    
    function onTouchEnd() {
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      if (alignV) alignV.style.display = 'none';
      if (alignH) alignH.style.display = 'none';
      saveState();
    }
    
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
  });
}

function openAddTableModal() {
  document.getElementById('tableModalTitle').textContent = 'Add Table';
  document.getElementById('editTableId').value = '';
  document.getElementById('tableAddEditForm').reset();
  
  const statusGroup = document.getElementById('tableStatusGroup');
  if (statusGroup) statusGroup.style.display = 'none';
  
  document.getElementById('tableModalOverlay').classList.add('active');
}

function openEditTableModal(tableId) {
  const t = state.tables.find(item => item.id === tableId);
  if (!t) return;
  
  document.getElementById('tableModalTitle').textContent = 'Edit Table';
  document.getElementById('editTableId').value = t.id;
  document.getElementById('tableNameInput').value = t.name;
  document.getElementById('tableSeatsInput').value = t.seats;
  
  const statusGroup = document.getElementById('tableStatusGroup');
  if (statusGroup) statusGroup.style.display = 'block';
  
  const statusInput = document.getElementById('tableStatusInput');
  if (statusInput) statusInput.value = t.status || 'available';
  
  document.getElementById('tableModalOverlay').classList.add('active');
}

function closeTableModal() {
  document.getElementById('tableModalOverlay').classList.remove('active');
}

function handleTableAddEditSubmit() {
  const idStr = document.getElementById('editTableId').value;
  const name = document.getElementById('tableNameInput').value.trim();
  const seats = parseInt(document.getElementById('tableSeatsInput').value) || 2;
  
  if (!name) {
    alert("Action completed.");
    return;
  }
  
  if (idStr) {
    const id = parseInt(idStr);
    const table = state.tables.find(t => t.id === id);
    if (table) {
      table.name = name;
      table.seats = seats;
      
      const statusInput = document.getElementById('tableStatusInput');
      if (statusInput) {
        const oldStatus = table.status;
        const newStatus = statusInput.value;
        table.status = newStatus;
        
        // If status changed from occupied/billed to available/reserved, clear the activeOrderId
        if ((oldStatus === 'occupied' || oldStatus === 'billed') && (newStatus === 'available' || newStatus === 'reserved')) {
          table.activeOrderId = null;
        }
      }
    }
  } else {
    const nextId = state.tables.length > 0 ? Math.max(...state.tables.map(t => t.id)) + 1 : 1;
    state.tables.push({
      id: nextId,
      name: name,
      seats: seats,
      floor: state.activeFloorId || 'main',
      status: 'available',
      activeOrderId: null,
      x: 20,
      y: 20
    });
  }
  
  saveState();
  renderTablesFloorMap();
  closeTableModal();
  alert("Action completed.");
}

function deleteTable(tableId) {
  const table = state.tables.find(t => t.id === tableId);
  if (!table) return;
  
  if (table.status !== 'available') {
    alert("Action completed.");
    return;
  }
  
  if (confirm(`Delete "${table.name}" permanently?`)) {
    state.tables = state.tables.filter(t => t.id !== tableId);
    saveState();
    renderTablesFloorMap();
    alert("Action completed.");
  }
}

// Start POS on load
window.addEventListener('DOMContentLoaded', initApp);




// --- J. TABLE TRANSFER SYSTEM ---
function openTransferTableModal() {
  const sourceTableId = state.currentCart.tableId;
  const sourceTable = state.tables.find(t => t.id === sourceTableId);
  if (!sourceTable) {
    alert("Action completed.");
    return;
  }
  
  document.getElementById('transferSourceTableName').value = sourceTable.name;
  
  // Populate target tables dropdown (exclude source table)
  const targetSelect = document.getElementById('transferTargetTableSelect');
  if (targetSelect) {
    let html = '<option value="">-- No Member --</option>';
    state.tables.forEach(t => {
      if (t.id !== sourceTableId) {
        let statusLabel = '';
        if (t.status === 'occupied') statusLabel = ' (á€œá€°á€‘á€­á€¯á€„á€ºá€”á€±á€†á€²)';
        else if (t.status === 'billed') statusLabel = ' (á€›á€¾á€„á€ºá€¸á€›á€”á€ºá€•á€¼á€„á€ºá€†á€„á€ºá€”á€±)';
        html += `<option value="${t.id}">${t.name} [${t.seats} á€šá€±á€¬á€€á€ºá€‘á€­á€¯á€„á€º]${statusLabel}</option>`;
      }
    });
    targetSelect.innerHTML = html;
  }
  
  // Reset fields
  document.querySelector('input[name="transferType"][value="all"]').checked = true;
  toggleTransferItemsList(false);
  
  // Render partial items checklist
  const checklistContainer = document.getElementById('transferItemsCheckboxContainer');
  if (checklistContainer) {
    checklistContainer.innerHTML = state.currentCart.items.map((item, idx) => {
      const key = item.cartKey || item.id;
      return `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1; margin: 0; color: var(--text-primary);">
            <input type="checkbox" class="transfer-item-chk" data-key="${key}" style="width: 16px; height: 16px;">
            <span style="font-size: 0.9rem;">${item.name}</span>
          </label>
          <div style="display: flex; align-items: center; gap: 5px;">
            <span style="font-size: 0.78rem; color: var(--text-muted);">á€•á€¼á€±á€¬á€„á€ºá€¸á€›á€”á€º -</span>
            <input type="number" class="transfer-item-qty" data-key="${key}" min="1" max="${item.quantity}" value="${item.quantity}" style="width: 55px; padding: 4px; text-align: center; border-radius: 4px; border: 1px solid var(--input-border); background: rgba(0,0,0,0.15); color: var(--text-primary); font-size: 0.85rem;">
            <span style="font-size: 0.85rem; color: var(--text-primary);">/ ${item.quantity} á€•á€½á€²</span>
          </div>
        </div>
      `;
    }).join('');
  }
  
  document.getElementById('tableTransferModalOverlay').classList.add('active');
}

function closeTransferTableModal() {
  const overlay = document.getElementById('tableTransferModalOverlay');
  if (overlay) overlay.classList.remove('active');
}

function toggleTransferItemsList(show) {
  const wrapper = document.getElementById('transferItemsListWrapper');
  if (wrapper) {
    wrapper.style.display = show ? 'block' : 'none';
  }
}

function executeTableTransfer() {
  const sourceTableId = state.currentCart.tableId;
  const targetSelect = document.getElementById('transferTargetTableSelect');
  const targetTableIdStr = targetSelect ? targetSelect.value : '';
  
  if (!targetTableIdStr) {
    alert("Action completed.");
    return;
  }
  
  const targetTableId = parseInt(targetTableIdStr);
  const sourceTable = state.tables.find(t => t.id === sourceTableId);
  const targetTable = state.tables.find(t => t.id === targetTableId);
  
  if (!sourceTable || !targetTable) return;
  
  const sourceOrderId = sourceTable.activeOrderId;
  const sourceOrder = state.orders.find(o => o.id === sourceOrderId);
  if (!sourceOrder) {
    alert("Action completed.");
    return;
  }
  
  const transferType = document.querySelector('input[name="transferType"]:checked').value;
  
  if (transferType === 'all') {
    // Transfer entire order
    if (targetTable.activeOrderId) {
      // Target table already occupied â†’ Merge orders
      const targetOrder = state.orders.find(o => o.id === targetTable.activeOrderId);
      if (targetOrder) {
        sourceOrder.items.forEach(sourceItem => {
          const key = sourceItem.cartKey || sourceItem.id;
          const targetItem = targetOrder.items.find(i => (i.cartKey || i.id) === key);
          if (targetItem) {
            targetItem.quantity += sourceItem.quantity;
          } else {
            targetOrder.items.push({ ...sourceItem });
          }
        });
        // Recalculate target totals
        const subtotal = targetOrder.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const taxRate = state.settings.taxRate || 5;
        const tax = Math.round(subtotal * (taxRate / 100));
        targetOrder.subtotal = subtotal;
        targetOrder.tax = tax;
        targetOrder.total = subtotal + tax;
        
        // Remove source order
        state.orders = state.orders.filter(o => o.id !== sourceOrderId);
      }
    } else {
      // Target table empty â†’ Simply transfer the order ownership
      sourceOrder.tableId = targetTableId;
      sourceOrder.tableName = targetTable.name;
      targetTable.activeOrderId = sourceOrderId;
      targetTable.status = sourceTable.status || 'occupied';
    }
    
    // Free the source table
    sourceTable.status = 'available';
    sourceTable.activeOrderId = null;
    
    alert(`á€…á€¬á€¸á€•á€½á€² "${sourceTable.name}" á á€™á€¾á€¬á€šá€°á€™á€¾á€¯á€¡á€¬á€¸á€œá€¯á€¶á€¸á€€á€­á€¯ á€…á€¬á€¸á€•á€½á€² "${targetTable.name}" á€žá€­á€¯á€· á€•á€¼á€±á€¬á€„á€ºá€¸á€›á€½á€¾á€±á€·á€•á€¼á€®á€¸á€•á€«á€•á€¼á€®!`);
  } else {
    // Partial Transfer
    const checkboxes = document.querySelectorAll('.transfer-item-chk:checked');
    if (checkboxes.length === 0) {
      alert("Action completed.");
      return;
    }
    
    const itemsToTransfer = [];
    let hasError = false;
    
    checkboxes.forEach(chk => {
      const key = chk.getAttribute('data-key');
      const qtyInput = document.querySelector(`.transfer-item-qty[data-key="${key}"]`);
      const transferQty = parseInt(qtyInput ? qtyInput.value : '0') || 0;
      
      const orderItem = sourceOrder.items.find(i => (i.cartKey || i.id) === key);
      if (orderItem) {
        if (transferQty <= 0 || transferQty > orderItem.quantity) {
          alert(`á€Ÿá€„á€ºá€¸á€•á€½á€² "${orderItem.name}" á€¡á€á€½á€€á€º á€•á€¼á€±á€¬á€„á€ºá€¸á€›á€½á€¾á€±á€·á€™á€Šá€·á€ºá€¡á€›á€±á€¡á€á€½á€€á€ºá€žá€Šá€º á€œá€½á€²á€™á€¾á€¬á€¸á€”á€±á€•á€«á€žá€Šá€º!`);
          hasError = true;
          return;
        }
        itemsToTransfer.push({
          item: orderItem,
          qty: transferQty,
          key: key
        });
      }
    });
    
    if (hasError) return;
    
    // Process items subtraction from source order
    itemsToTransfer.forEach(transfer => {
      transfer.item.quantity -= transfer.qty;
    });
    
    // Remove items with 0 quantity from source order
    sourceOrder.items = sourceOrder.items.filter(i => i.quantity > 0);
    
    // Recalculate source totals
    const sourceSubtotal = sourceOrder.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const taxRate = state.settings.taxRate || 5;
    const sourceTax = Math.round(sourceSubtotal * (taxRate / 100));
    sourceOrder.subtotal = sourceSubtotal;
    sourceOrder.tax = sourceTax;
    sourceOrder.total = sourceSubtotal + sourceTax;
    
    // If source order empty, free source table and remove order
    if (sourceOrder.items.length === 0) {
      state.orders = state.orders.filter(o => o.id !== sourceOrderId);
      sourceTable.status = 'available';
      sourceTable.activeOrderId = null;
    }
    
    // Add to target table
    if (targetTable.activeOrderId) {
      // Merge with existing
      const targetOrder = state.orders.find(o => o.id === targetTable.activeOrderId);
      if (targetOrder) {
        itemsToTransfer.forEach(transfer => {
          const targetItem = targetOrder.items.find(i => (i.cartKey || i.id) === transfer.key);
          if (targetItem) {
            targetItem.quantity += transfer.qty;
          } else {
            targetOrder.items.push({
              ...transfer.item,
              quantity: transfer.qty
            });
          }
        });
        
        // Recalculate target totals
        const targetSubtotal = targetOrder.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const targetTax = Math.round(targetSubtotal * (taxRate / 100));
        targetOrder.subtotal = targetSubtotal;
        targetOrder.tax = targetTax;
        targetOrder.total = targetSubtotal + targetTax;
      }
    } else {
      // Create new order for target table
      const targetOrderId = generateSequentialOrderId();
      const now = new Date();
      const newOrder = {
        id: targetOrderId,
        tableId: targetTableId,
        tableName: targetTable.name,
        type: 'dine-in',
        items: itemsToTransfer.map(t => ({
          ...t.item,
          quantity: t.qty
        })),
        subtotal: 0,
        discount: 0,
        tax: 0,
        total: 0,
        status: 'occupied',
        timestamp: now.toISOString().replace('Z', '')
      };
      
      const subtotal = newOrder.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const tax = Math.round(subtotal * (taxRate / 100));
      newOrder.subtotal = subtotal;
      newOrder.tax = tax;
      newOrder.total = subtotal + tax;
      
      state.orders.push(newOrder);
      targetTable.activeOrderId = targetOrderId;
      targetTable.status = 'occupied';
    }
    
    alert(`á€…á€¬á€¸á€•á€½á€² "${sourceTable.name}" á€™á€¾ á€›á€½á€±á€¸á€á€»á€šá€ºá€‘á€¬á€¸á€žá€±á€¬ á€Ÿá€„á€ºá€¸á€•á€½á€²á€™á€»á€¬á€¸á€€á€­á€¯ á€…á€¬á€¸á€•á€½á€² "${targetTable.name}" á€žá€­á€¯á€· á€•á€¼á€±á€¬á€„á€ºá€¸á€›á€½á€¾á€±á€·á€•á€¼á€®á€¸á€•á€«á€•á€¼á€®!`);
  }
  
  saveState();
  clearCart();
  closeTransferTableModal();
  renderTablesFloorMap();
  switchTab('sales-pane');
  setPosMode('tables');
}


// --- K. SYSTEM SETTINGS CONTROLS ---
function adjustFontScale(delta) {
  if (delta === 0) {
    state.settings.fontScale = 14.5;
  } else {
    if (!state.settings.fontScale) state.settings.fontScale = 14.5;
    state.settings.fontScale = Math.max(11, Math.min(18, state.settings.fontScale + (delta * 0.5)));
  }
  saveState();
  applyFontScale();
}

function applyFontScale() {
  const scale = state.settings.fontScale || 14.5;
  document.documentElement.style.fontSize = `${scale}px`;
}

function toggleThemeSettings() {
  state.settings.darkMode = !state.settings.darkMode;
  saveState();
  applySettings();
  updateSettingsPaneUI();
}

function updateSettingsPaneUI() {
  const themeBtn = document.getElementById('settingsThemeToggleBtn');
  if (themeBtn) {
    themeBtn.innerHTML = state.settings.darkMode 
      ? `<i class="fa-solid fa-sun"></i> Light Mode`
      : `<i class="fa-solid fa-moon"></i> Dark Mode`;
  }
  
}

function initLanguageSetting() {
  // Language switching was removed from the product UI.
}

// --- L. STORAGE EVENT REAL-TIME SYNC ---
window.addEventListener('storage', (e) => {
  if (e.key === OFFLINE_STORAGE_KEY) {
    try {
      const parsed = JSON.parse(e.newValue);
      if (parsed) {
        state.products = parsed.products || [];
        state.marketExpenses = parsed.marketExpenses || [];
        state.orders = parsed.orders || [];
        state.tables = parsed.tables || [];
        state.salesHistory = parsed.salesHistory || [];
        state.settings = parsed.settings || state.settings;
        
        // Refresh active views
        if (state.activeTab === 'dashboard-pane') {
          renderDashboard();
        } else if (state.activeTab === 'sales-pane') {
          renderSalesCounter();
        } else if (state.activeTab === 'kitchen-pane') {
          renderKitchenDisplay();
        } else if (state.activeTab === 'market-pane') {
          renderMarketPane();
        } else if (state.activeTab === 'reports-pane') {
          renderReportsPane();
        } else if (state.activeTab === 'admin-pane') {
          renderSettingsPane();
        }
        applySettings();
        applyFontScale();
      }
    } catch (err) {
      console.error("Failed to sync storage event", err);
    }
  }
});

// --- M. POS SCREEN MULTI-MODE & ACTIVE ORDERS CONTROLS ---
function setPosMode(mode) {
  const tablesSubpane = document.getElementById('posTableLayoutSubpane');
  const productsSubpane = document.getElementById('posProductsSubpane');
  const tablesBtn = document.getElementById('posModeTablesBtn');
  const takeawayBtn = document.getElementById('posModeTakeawayBtn');
  const layout = document.getElementById('salesLayout');
  
  if (layout) {
    if (mode === 'tables') {
      layout.classList.add('cart-hidden');
    } else {
      layout.classList.remove('cart-hidden');
    }
  }
  
  if (mode === 'tables') {
    if (tablesSubpane) tablesSubpane.style.display = 'block';
    if (productsSubpane) productsSubpane.style.display = 'none';
    
    if (tablesBtn) tablesBtn.classList.add('active');
    if (takeawayBtn) takeawayBtn.classList.remove('active');
    
    // Deselect active table mapping if showing floor layout again
    state.currentCart.tableId = null;
    state.currentCart.type = 'dine-in';
    saveState();
    
    renderTablesFloorMap();
    renderCart(); // clear cart UI for tables selection
    populateCartTablesDropdown();
  } else if (mode === 'takeaway') {
    if (tablesSubpane) tablesSubpane.style.display = 'none';
    if (productsSubpane) productsSubpane.style.display = 'block';
    
    if (tablesBtn) tablesBtn.classList.remove('active');
    if (takeawayBtn) takeawayBtn.classList.add('active');
    
    setCartType('takeaway');
    renderProducts();
    renderCart();
  } else if (mode === 'products') {
    if (tablesSubpane) tablesSubpane.style.display = 'none';
    if (productsSubpane) productsSubpane.style.display = 'block';
    
    if (tablesBtn) tablesBtn.classList.remove('active');
    if (takeawayBtn) takeawayBtn.classList.remove('active');
    
    renderProducts();
    renderCart();
  }
}

function openActiveOrdersModal() {
  const modal = document.getElementById('activeOrdersListModal');
  if (modal) {
    modal.classList.add('active');
    // Default filter to ongoing when opening
    const filterSelect = document.getElementById('activeOrdersFilter');
    if (filterSelect) filterSelect.value = 'ongoing';
    renderActiveOrdersList();
  }
}

function renderActiveOrdersList() {
  const container = document.getElementById('activeOrdersListModalContainer');
  if (!container) return;
  
  const filterSelect = document.getElementById('activeOrdersFilter');
  const filter = filterSelect ? filterSelect.value : 'ongoing';
  
  let html = '';
  
  if (filter === 'ongoing') {
    // Get active/ongoing order list
    const activeOrders = state.orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled');
    
    if (activeOrders.length === 0) {
      html = `<div style="text-align: center; color: var(--text-muted); padding: 30px;">No ongoing orders yet. Confirm Order or Send Kitchen will keep unpaid orders here.</div>`;
    } else {
      html = activeOrders.map(o => {
        const typeLabel = o.type === 'takeaway' ? '<i class="fa-solid fa-basket-shopping"></i> Takeaway' : `<i class="fa-solid fa-chair"></i> Table - ${escapeHtml(o.tableName || '')}`;
        const elapsedMinutes = Math.round((new Date() - new Date(o.timestamp)) / 60000);
        const timeDisplay = isNaN(elapsedMinutes) ? '0 mins ago' : `${elapsedMinutes} mins ago`;
        const orderId = escapeJsString(o.id);
        
        let statusBadge = '';
        if (o.status === 'occupied') statusBadge = `<span class="expense-tag" style="background: rgba(239, 68, 68, 0.15); color: var(--accent-danger); border-color: var(--accent-danger); font-size: 0.72rem;">Occupied</span>`;
        else if (o.status === 'pending') statusBadge = `<span class="expense-tag" style="background: rgba(245, 158, 11, 0.15); color: var(--accent-warning); border-color: var(--accent-warning); font-size: 0.72rem;">Pending</span>`;
        else if (o.status === 'preparing') statusBadge = `<span class="expense-tag" style="background: rgba(245, 158, 11, 0.15); color: var(--accent-warning); border-color: var(--accent-warning); font-size: 0.72rem;">Preparing</span>`;
        else if (o.status === 'ready') statusBadge = `<span class="expense-tag" style="background: rgba(16, 185, 129, 0.15); color: var(--accent-success); border-color: var(--accent-success); font-size: 0.72rem;">Ready</span>`;
        else if (o.status === 'billed') statusBadge = `<span class="expense-tag" style="background: rgba(14, 165, 233, 0.15); color: var(--accent-info); border-color: var(--accent-info); font-size: 0.72rem;">Billed</span>`;
        
        let adminActionHtml = '';
        if (state.currentUser && state.currentUser.role === 'admin') {
          adminActionHtml = `
            <button type="button" class="btn-primary" onclick="event.stopPropagation(); cancelActiveOrderDirectly('${orderId}')" style="font-size: 0.8rem; padding: 6px 12px; border-radius: var(--border-radius-sm); border: none; background: var(--accent-danger); color: white; cursor: pointer; font-weight: bold; display: flex; align-items: center; gap: 4px;">
              <i class="fa-solid fa-trash-can"></i> Cancel
            </button>
          `;
        }

        return `
          <div class="order-list-card-clickable" onclick="openOrderDetailModal('${orderId}', 'active')" title="View order detail" style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: rgba(255,255,255,0.03); border: 1px solid var(--panel-border); border-radius: var(--border-radius-md); gap: 10px;">
            <div>
              <h4 style="font-weight: 700; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">${typeLabel} ${statusBadge}</h4>
              <p style="font-size: 0.8rem; color: var(--text-secondary);">Total: <strong style="color:var(--accent-success);">${formatPrice(o.total)}</strong> | Items: ${o.items.reduce((sum, i) => sum + i.quantity, 0)} | ${timeDisplay}</p>
            </div>
            <div style="display: flex; gap: 6px;">
              <button class="btn-primary" onclick="event.stopPropagation(); recallActiveOrder('${orderId}')" style="font-size: 0.8rem; padding: 6px 12px; border-radius: var(--border-radius-sm); border: none; background: var(--accent-brand-blue); color: white; cursor: pointer; font-weight: bold; display: flex; align-items: center; gap: 4px;">
                <i class="fa-solid fa-folder-open"></i> Recall
              </button>
              ${adminActionHtml}
            </div>
          </div>
        `;
      }).join('');
    }
  } else {
    // Show paid/completed orders (recent salesHistory, say last 50 items)
    const paidSales = [...state.salesHistory].reverse().slice(0, 50);
    
    if (paidSales.length === 0) {
      html = `<div style="text-align: center; color: var(--text-muted); padding: 30px;">No paid sales yet.</div>`;
    } else {
      html = paidSales.map(s => {
        const typeLabel = s.type === 'takeaway' ? '<i class="fa-solid fa-basket-shopping"></i> Takeaway' : `<i class="fa-solid fa-chair"></i> Table - ${escapeHtml(s.tableName || '')}`;
        const timeStr = s.timestamp ? new Date(s.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
        const dateStr = s.timestamp ? getLocalDateString(s.timestamp) : '';
        const itemsCount = s.items ? s.items.reduce((sum, i) => sum + i.quantity, 0) : 0;
        const saleId = escapeJsString(s.id);
        
        let adminActionHtml = '';
        if (state.currentUser && state.currentUser.role === 'admin') {
          adminActionHtml = `
            <button type="button" class="btn-primary" onclick="event.stopPropagation(); deleteCompletedSaleDirectly('${saleId}')" style="font-size: 0.8rem; padding: 6px 12px; border-radius: var(--border-radius-sm); border: none; background: var(--accent-danger); color: white; cursor: pointer; font-weight: bold; display: flex; align-items: center; gap: 4px;">
              <i class="fa-solid fa-trash-can"></i> Delete
            </button>
          `;
        }

        return `
          <div class="order-list-card-clickable" onclick="openOrderDetailModal('${saleId}', 'sale')" title="View voucher detail" style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: rgba(255,255,255,0.03); border: 1px solid var(--panel-border); border-radius: var(--border-radius-md); gap: 10px;">
            <div>
              <h4 style="font-weight: 700; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">${typeLabel} <span class="expense-tag" style="background: rgba(16, 185, 129, 0.15); color: var(--accent-success); border-color: var(--accent-success); font-size: 0.72rem;">Paid</span></h4>
              <p style="font-size: 0.8rem; color: var(--text-secondary);">Total: <strong style="color:var(--accent-success);">${formatPrice(s.total)}</strong> | Items: ${itemsCount} | ${dateStr} ${timeStr}</p>
            </div>
            <div>
              ${adminActionHtml}
            </div>
          </div>
        `;
      }).join('');
    }
  }
  
  container.innerHTML = html;
}

function cancelActiveOrderDirectly(orderId) {
  if (confirm("Are you sure?")) {
    const order = state.orders.find(o => o.id === orderId);
    if (!order) return;
    reverseAllStockForOrder(order);
    
    // If it's dine-in table, release table status
    if (order.type === 'dine-in' && order.tableId) {
      const table = state.tables.find(t => t.id === order.tableId);
      if (table) {
        table.status = 'available';
        table.activeOrderId = null;
      }
    }
    
    // Remove from active orders list
    state.orders = state.orders.filter(o => o.id !== orderId);
    
    saveState();
    alert("Action completed.");
    renderActiveOrdersList();
    renderTablesFloorMap();
  }
}

function deleteCompletedSaleDirectly(saleId) {
  if (confirm("Are you sure?")) {
    const sale = state.salesHistory.find(s => s.id === saleId);
    reverseAllStockForOrder(sale);
    state.salesHistory = state.salesHistory.filter(s => s.id !== saleId);
    saveState();
    alert("Action completed.");
    renderActiveOrdersList();
    renderDashboard();
  }
}

function closeActiveOrdersModal() {
  const modal = document.getElementById('activeOrdersListModal');
  if (modal) modal.classList.remove('active');
}

let currentOrderDetailRef = null;

function openOrderDetailModal(recordId, recordType = 'sale') {
  const record = recordType === 'active'
    ? state.orders.find(o => o.id === recordId)
    : state.salesHistory.find(s => s.id === recordId);

  if (!record) {
    alert('Order record not found.');
    return;
  }

  currentOrderDetailRef = { id: recordId, type: recordType };

  const overlay = document.getElementById('orderDetailModalOverlay');
  const title = document.getElementById('orderDetailModalTitle');
  const subtitle = document.getElementById('orderDetailModalSubtitle');
  const body = document.getElementById('orderDetailModalBody');
  const printBtn = document.getElementById('orderDetailPrintBtn');
  if (!overlay || !body) return;

  const isSale = recordType === 'sale';
  const items = Array.isArray(record.items) ? record.items : [];
  const itemTotal = items.reduce((sum, item) => sum + ((Number(item.price) || 0) * (Number(item.quantity) || 1)), 0);
  const subtotal = Number(record.subtotal ?? itemTotal) || 0;
  const discount = Number(record.discountAmount ?? record.discount ?? 0) || 0;
  const tax = Number(record.taxAmount ?? record.tax ?? 0) || 0;
  const total = Number(record.total ?? (subtotal - discount + tax)) || 0;
  const tableLabel = record.type === 'takeaway' ? 'Takeaway' : displayText(record.tableName, 'Table');
  const statusLabel = isSale ? 'Paid' : displayText(record.status || 'Ongoing', 'Ongoing');

  if (title) title.textContent = isSale ? `Voucher Detail - ${record.id}` : `Order Detail - ${record.id}`;
  if (subtitle) subtitle.textContent = `${tableLabel} | ${formatOrderDetailDate(record.timestamp)}`;

  const itemRows = items.map(item => {
    const qty = Number(item.quantity || item.qty || 1);
    const price = Number(item.price || 0);
    const lineTotal = qty * price;
    return `
      <div class="order-detail-item-row">
        <div class="order-detail-item-info">
          <div class="order-detail-item-name">${escapeHtml(displayText(item.name, 'Item'))}</div>
          ${item.note ? `<div class="order-detail-item-note">Note: ${escapeHtml(displayText(item.note, ''))}</div>` : ''}
        </div>
        <div class="order-detail-item-meta">
          <span>${qty} x ${formatPrice(price)}</span>
          <strong>${formatPrice(lineTotal)}</strong>
        </div>
      </div>
    `;
  }).join('');

  body.innerHTML = `
    <div class="order-detail-summary-grid">
      <div class="order-detail-summary-box">
        <span>Order ID</span>
        <strong>${escapeHtml(record.id || '-')}</strong>
      </div>
      <div class="order-detail-summary-box">
        <span>Table / Type</span>
        <strong>${escapeHtml(tableLabel)}</strong>
      </div>
      <div class="order-detail-summary-box">
        <span>Status</span>
        <strong>${escapeHtml(statusLabel)}</strong>
      </div>
      <div class="order-detail-summary-box">
        <span>Payment</span>
        <strong>${escapeHtml(isSale ? (record.paymentMethod || 'Cash') : 'Not paid')}</strong>
      </div>
    </div>

    <div class="order-detail-section-title">Included Items</div>
    <div class="order-detail-items-list">
      ${itemRows || '<div class="order-detail-empty">No items in this record.</div>'}
    </div>

    <div class="order-detail-total-box">
      <div><span>Subtotal</span><strong>${formatPrice(subtotal)}</strong></div>
      <div><span>Discount</span><strong>${formatPrice(discount)}</strong></div>
      <div><span>Tax</span><strong>${formatPrice(tax)}</strong></div>
      <div class="grand-total"><span>Total</span><strong>${formatPrice(total)}</strong></div>
    </div>
  `;

  if (printBtn) {
    printBtn.innerHTML = isSale ? '<i class="fa-solid fa-print"></i> Print Voucher' : '<i class="fa-solid fa-print"></i> Print Kitchen';
  }

  overlay.classList.add('active');
}

function closeOrderDetailModal() {
  const overlay = document.getElementById('orderDetailModalOverlay');
  if (overlay) overlay.classList.remove('active');
  currentOrderDetailRef = null;
}

function printOrderDetailRecord() {
  if (!currentOrderDetailRef) return;
  const record = currentOrderDetailRef.type === 'active'
    ? state.orders.find(o => o.id === currentOrderDetailRef.id)
    : state.salesHistory.find(s => s.id === currentOrderDetailRef.id);
  if (!record) {
    alert('Order record not found.');
    return;
  }
  showPrinterSlipModal(record, currentOrderDetailRef.type === 'active' ? 'kitchen' : 'customer');
}

function formatOrderDetailDate(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function recallActiveOrder(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;
  
  // ALWAYS switch the active tab to POS (sales-pane) first
  switchTab('sales-pane');
  
  if (order.type === 'dine-in') {
    handleTableClick(order.tableId);
  } else {
    // Takeaway recall
    state.currentCart.tableId = null;
    state.currentCart.type = 'takeaway';
    state.currentCart.activeOrderId = order.id;
    state.currentCart.draftOrderId = order.id;
    state.currentCart.items = order.items.map(item => ({
      id: item.id,
      cartKey: item.cartKey || item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      note: item.note || '',
      track_inventory: state.products.find(p => p.id === item.id)?.track_inventory || false
    }));
    state.currentCart.subtotal = order.subtotal || 0;
    state.currentCart.discount = order.discount || 0;
    state.currentCart.tax = order.tax || 0;
    state.currentCart.total = order.total || 0;
    state.currentCart.memberId = order.memberId || null;
    state.currentCart.selectedTaxPresetId = order.selectedTaxPresetId || 'tax-none';
    state.currentCart.selectedDiscountPresetId = order.selectedDiscountPresetId || 'disc-none';
    
    saveState();
    renderSalesCounter();
    setCartType('takeaway');
    setPosMode('takeaway');
  }
  
  closeActiveOrdersModal();
}

function releaseCurrentTable() {
  if (state.currentCart.type !== 'dine-in' || !state.currentCart.tableId) return;

  const tableId = state.currentCart.tableId;
  const table = state.tables.find(t => t.id === parseInt(tableId) || t.id === tableId);
  if (!table) return;

  if (confirm(`စားပွဲ "${table.name}" ကို Available အဖြစ် ပြန်လွှတ်မလား?`)) {
    if (table.activeOrderId) {
      const activeOrder = state.orders.find(o => o.id === table.activeOrderId);
      reverseAllStockForOrder(activeOrder);
      state.orders = state.orders.filter(o => o.id !== table.activeOrderId);
    }

    table.status = 'available';
    table.activeOrderId = null;
    state.currentCart.items = [];
    state.currentCart.tableId = null;

    saveState();
    alert(`စားပွဲ "${table.name}" ကို Release လုပ်ပြီးပါပြီ။`);
    setPosMode('tables');
  }
}

// --- N. CONSOLIDATED ADMIN PANEL SUBTABS & DIALOGS ---
function switchAdminSubtab(tabName) {
  const productsTab = document.getElementById('settingsProductEditContainer');
  const categoriesTab = document.getElementById('settingsCategoryEditContainer');
  const paymentsTab = document.getElementById('settingsPaymentMethodEditContainer');
  const loyaltyTab = document.getElementById('settingsLoyaltyEditContainer');
  const productsBtn = document.getElementById('adminTabProductsBtn');
  const categoriesBtn = document.getElementById('adminTabCategoriesBtn');
  const paymentsBtn = document.getElementById('adminTabPaymentMethodsBtn');
  const loyaltyBtn = document.getElementById('adminTabLoyaltyBtn');
  const productsActions = document.getElementById('adminProductsActions');
  const addCategoryBtn = document.getElementById('adminAddCategoryBtn');
  const addPaymentMethodBtn = document.getElementById('adminAddPaymentMethodBtn');
  const addLoyaltyBtn = document.getElementById('adminAddLoyaltyBtn');
  const searchFilterRow = document.getElementById('adminProductSearchFilterRow');
  
  if (tabName === 'products') {
    if (productsTab) productsTab.style.display = 'block';
    if (categoriesTab) categoriesTab.style.display = 'none';
    if (paymentsTab) paymentsTab.style.display = 'none';
    if (loyaltyTab) loyaltyTab.style.display = 'none';
    if (productsBtn) productsBtn.classList.add('active');
    if (categoriesBtn) categoriesBtn.classList.remove('active');
    if (paymentsBtn) paymentsBtn.classList.remove('active');
    if (loyaltyBtn) loyaltyBtn.classList.remove('active');
    if (productsActions) productsActions.style.display = 'flex';
    if (addCategoryBtn) addCategoryBtn.style.display = 'none';
    if (addPaymentMethodBtn) addPaymentMethodBtn.style.display = 'none';
    if (addLoyaltyBtn) addLoyaltyBtn.style.display = 'none';
    if (searchFilterRow) searchFilterRow.style.display = 'flex';
  } else if (tabName === 'categories') {
    if (productsTab) productsTab.style.display = 'none';
    if (categoriesTab) categoriesTab.style.display = 'block';
    if (paymentsTab) paymentsTab.style.display = 'none';
    if (loyaltyTab) loyaltyTab.style.display = 'none';
    if (productsBtn) productsBtn.classList.remove('active');
    if (categoriesBtn) categoriesBtn.classList.add('active');
    if (paymentsBtn) paymentsBtn.classList.remove('active');
    if (loyaltyBtn) loyaltyBtn.classList.remove('active');
    if (productsActions) productsActions.style.display = 'none';
    if (addCategoryBtn) addCategoryBtn.style.display = 'block';
    if (addPaymentMethodBtn) addPaymentMethodBtn.style.display = 'none';
    if (addLoyaltyBtn) addLoyaltyBtn.style.display = 'none';
    if (searchFilterRow) searchFilterRow.style.display = 'none';
  } else if (tabName === 'payments') {
    if (productsTab) productsTab.style.display = 'none';
    if (categoriesTab) categoriesTab.style.display = 'none';
    if (paymentsTab) paymentsTab.style.display = 'block';
    if (loyaltyTab) loyaltyTab.style.display = 'none';
    if (productsBtn) productsBtn.classList.remove('active');
    if (categoriesBtn) categoriesBtn.classList.remove('active');
    if (paymentsBtn) paymentsBtn.classList.add('active');
    if (loyaltyBtn) loyaltyBtn.classList.remove('active');
    if (productsActions) productsActions.style.display = 'none';
    if (addCategoryBtn) addCategoryBtn.style.display = 'none';
    if (addPaymentMethodBtn) addPaymentMethodBtn.style.display = 'none';
    if (addLoyaltyBtn) addLoyaltyBtn.style.display = 'none';
    if (searchFilterRow) searchFilterRow.style.display = 'none';
    renderPaymentMethodsList();
  } else if (tabName === 'loyalty') {
    if (productsTab) productsTab.style.display = 'none';
    if (categoriesTab) categoriesTab.style.display = 'none';
    if (paymentsTab) paymentsTab.style.display = 'none';
    if (loyaltyTab) loyaltyTab.style.display = 'block';
    if (productsBtn) productsBtn.classList.remove('active');
    if (categoriesBtn) categoriesBtn.classList.remove('active');
    if (paymentsBtn) paymentsBtn.classList.remove('active');
    if (loyaltyBtn) loyaltyBtn.classList.add('active');
    if (productsActions) productsActions.style.display = 'none';
    if (addCategoryBtn) addCategoryBtn.style.display = 'none';
    if (addPaymentMethodBtn) addPaymentMethodBtn.style.display = 'none';
    if (addLoyaltyBtn) addLoyaltyBtn.style.display = 'block';
    if (searchFilterRow) searchFilterRow.style.display = 'none';
    renderLoyaltyMembersList();
  }
}

function openRestaurantConfigModal() {
  const modal = document.getElementById('restaurantConfigModalOverlay');
  if (modal) {
    applySettings(); // Sync current values
    renderPresetsSettingsLists();
    renderUserManagement();
    switchRestaurantSettingsTab('brand');
    refreshSystemPrinters();
    modal.classList.add('active');
  }
}

function renderPresetsSettingsLists() {
  const taxList = document.getElementById('settingsTaxPresetsList');
  const discountList = document.getElementById('settingsDiscountPresetsList');
  
  if (taxList) {
    taxList.innerHTML = state.taxPresets.map(t => `
      <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); padding: 8px 12px; border-radius: var(--border-radius-sm); border: 1px solid var(--panel-border);">
        <span style="font-size: 0.82rem; color: var(--text-primary); font-weight: 500;">${t.name} (<strong>${t.value}%</strong>)</span>
        ${t.id === 'tax-none' ? '' : `
          <button type="button" onclick="deletePreset('tax', '${t.id}')" style="background: none; border: none; color: var(--accent-danger); cursor: pointer; padding: 2px; display: flex; align-items: center; justify-content: center;">
            <i class="fa-solid fa-trash-can" style="font-size: 0.85rem;"></i>
          </button>
        `}
      </div>
    `).join('');
  }
  
  if (discountList) {
    discountList.innerHTML = state.discountPresets.map(d => `
      <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); padding: 8px 12px; border-radius: var(--border-radius-sm); border: 1px solid var(--panel-border);">
        <span style="font-size: 0.82rem; color: var(--text-primary); font-weight: 500;">${d.name} (<strong>${d.type === 'percent' ? d.value + '%' : formatPrice(d.value)}</strong>)</span>
        ${d.id === 'disc-none' ? '' : `
          <button type="button" onclick="deletePreset('discount', '${d.id}')" style="background: none; border: none; color: var(--accent-danger); cursor: pointer; padding: 2px; display: flex; align-items: center; justify-content: center;">
            <i class="fa-solid fa-trash-can" style="font-size: 0.85rem;"></i>
          </button>
        `}
      </div>
    `).join('');
  }
}

function addNewPreset(type) {
  if (type === 'tax') {
    const name = prompt("Tax á€¡á€™á€Šá€ºá€‘á€Šá€·á€ºá€•á€« (á€¥á€•á€™á€¬- Commercial Tax 5%):");
    if (!name) return;
    const value = parseFloat(prompt("Tax % á€á€”á€ºá€–á€­á€¯á€¸á€‘á€Šá€·á€ºá€•á€« (á€¥á€•á€™á€¬- 5):"));
    if (isNaN(value)) {
      alert("Action completed.");
      return;
    }
    const id = 'tax-' + Date.now();
    state.taxPresets.push({ id, name, value });
  } else {
    const name = prompt("Discount á€¡á€™á€Šá€ºá€‘á€Šá€·á€ºá€•á€« (á€¥á€•á€™á€¬- VIP Discount 10%):");
    if (!name) return;
    const typeOption = prompt("Discount á€¡á€™á€»á€­á€¯á€¸á€¡á€…á€¬á€¸ á€›á€½á€±á€¸á€á€»á€šá€ºá€•á€« (1 = á€›á€¬á€á€­á€¯á€„á€ºá€”á€¾á€¯á€”á€ºá€¸ %, 2 = á€€á€»á€•á€ºá€„á€½á€±á€žá€á€ºá€žá€á€ºá€™á€¾á€á€ºá€™á€¾á€á€º):");
    if (typeOption !== '1' && typeOption !== '2') {
      alert("Action completed.");
      return;
    }
    const discountType = typeOption === '1' ? 'percent' : 'fixed';
    const value = parseFloat(prompt(discountType === 'percent' ? "Discount % á€á€”á€ºá€–á€­á€¯á€¸á€‘á€Šá€·á€ºá€•á€« (á€¥á€•á€™á€¬- 10):" : "Discount á€€á€»á€•á€ºá€„á€½á€±á€á€”á€ºá€–á€­á€¯á€¸á€‘á€Šá€·á€ºá€•á€« (á€¥á€•á€™á€¬- 1000):"));
    if (isNaN(value)) {
      alert("Action completed.");
      return;
    }
    const id = 'disc-' + Date.now();
    state.discountPresets.push({ id, name, value, type: discountType });
  }
  saveState();
  renderPresetsSettingsLists();
  renderSalesCounter(); // refresh POS panel options too!
}

function deletePreset(type, id) {
  if (confirm("Are you sure?")) {
    if (type === 'tax') {
      state.taxPresets = state.taxPresets.filter(t => t.id !== id);
    } else {
      state.discountPresets = state.discountPresets.filter(d => d.id !== id);
    }
    saveState();
    renderPresetsSettingsLists();
    renderSalesCounter();
  }
}

function closeRestaurantConfigModal() {
  const modal = document.getElementById('restaurantConfigModalOverlay');
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  if (modal) modal.classList.remove('active');
}

function openAddCategoryModalFromProduct() {
  state.isCreatingCategoryFromProductForm = true;
  openAddCategoryModal();
}

function populateProductCategoriesDropdown() {
  const prodCategorySelect = document.getElementById('prodCategory');
  if (prodCategorySelect) {
    const optionsHTML = state.categories.map(cat => {
      return `<option value="${cat.id}">${cat.name}</option>`;
    }).join('');
    prodCategorySelect.innerHTML = optionsHTML + `<option value="SEARCH_MORE" style="color: #888888; border-top: 1px solid var(--panel-border);">Search More...</option>`;
  }
}

// --- O. CATEGORY MODAL SEARCH & COLOR/IMAGE PRESET HELPERS ---
function selectColorPreset(el, color, inputId) {
  const input = document.getElementById(inputId);
  if (input) input.value = color;
  
  const siblings = el.parentElement.querySelectorAll('.color-preset');
  siblings.forEach(s => {
    s.style.borderColor = 'transparent';
    s.classList.remove('active');
  });
  
  el.style.borderColor = 'var(--text-primary)';
  el.classList.add('active');
}

function setActiveColorPreset(color, gridId, inputId) {
  const grid = document.getElementById(gridId);
  const hiddenInput = document.getElementById(inputId);
  if (!grid || !hiddenInput) return;
  
  hiddenInput.value = color || '#10b981';
  
  const presets = grid.querySelectorAll('.color-preset');
  let matched = false;
  
  const tempDiv = document.createElement('div');
  tempDiv.style.color = color;
  document.body.appendChild(tempDiv);
  const resolvedColor = window.getComputedStyle(tempDiv).color;
  document.body.removeChild(tempDiv);
  
  presets.forEach(p => {
    const pStyleColor = window.getComputedStyle(p).backgroundColor;
    if (pStyleColor === resolvedColor) {
      p.classList.add('active');
      p.style.borderColor = 'var(--text-primary)';
      matched = true;
    } else {
      p.classList.remove('active');
      p.style.borderColor = 'transparent';
    }
  });
  
  if (!matched && presets.length > 0) {
    presets[0].classList.add('active');
    presets[0].style.borderColor = 'var(--text-primary)';
    hiddenInput.value = '#10b981';
  }
}

// Product Image Upload helpers
function triggerProductImageUpload() {
  const input = document.getElementById('productImageFileInput');
  if (input) input.click();
}

function handleProductImageSelected(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      state.tempProductImage = e.target.result;
      const preview = document.getElementById('productImagePreview');
      const placeholder = document.getElementById('imageUploadPlaceholder');
      if (preview) {
        preview.src = e.target.result;
        preview.style.display = 'block';
      }
      if (placeholder) placeholder.style.display = 'none';
    };
    reader.readAsDataURL(input.files[0]);
  }
}

// Search Category Modal controllers
function openSearchCategoryModal() {
  const modal = document.getElementById('searchCategoryModalOverlay');
  if (modal) {
    state.selectedSearchCategoryId = null;
    document.getElementById('searchCategoryInput').value = '';
    
    // Disable select button initially
    const selectBtn = document.getElementById('searchCategorySelectBtn');
    if (selectBtn) {
      selectBtn.disabled = true;
      selectBtn.style.opacity = '0.6';
      selectBtn.style.cursor = 'not-allowed';
    }
    
    renderSearchCategoryTable();
    modal.classList.add('active');
  }
}

function closeSearchCategoryModal() {
  const modal = document.getElementById('searchCategoryModalOverlay');
  if (modal) modal.classList.remove('active');
}

function renderSearchCategoryTable() {
  const tbody = document.getElementById('searchCategoryTableBody');
  const query = (document.getElementById('searchCategoryInput')?.value || '').toLowerCase().trim();
  const countDisplay = document.getElementById('searchCategoryCountDisplay');
  
  if (!tbody) return;
  
  let filtered = state.categories;
  if (query) {
    filtered = filtered.filter(c => c.name.toLowerCase().includes(query));
  }
  
  if (countDisplay) {
    countDisplay.textContent = `1-${filtered.length} / ${filtered.length}`;
  }
  
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 30px;">á€¡á€¯á€•á€ºá€…á€¯ á€›á€¾á€¬á€™á€á€½á€±á€·á€•á€«</td></tr>`;
    return;
  }
  
  tbody.innerHTML = filtered.map(cat => {
    const isSelected = state.selectedSearchCategoryId === cat.id;
    const checkedAttr = isSelected ? 'checked' : '';
    const rowStyle = isSelected 
      ? 'style="background: rgba(11, 87, 164, 0.12); font-weight: 700; border-left: 3px solid var(--accent-brand-blue); cursor: pointer;"' 
      : 'style="cursor: pointer;"';
      
    return `
      <tr ${rowStyle} onclick="selectSearchCategoryRow('${cat.id}')" ondblclick="confirmSearchCategorySelection('${cat.id}')">
        <td style="padding: 10px 12px; text-align: center;"><input type="checkbox" ${checkedAttr} style="width: 16px; height: 16px; pointer-events: none; cursor: pointer;"></td>
        <td style="padding: 10px 12px; font-weight: bold; color: var(--text-primary);">${cat.name}</td>
        <td style="padding: 10px 12px; color: var(--text-secondary);">-</td>
        <td style="padding: 10px 12px; text-align: center;"><div style="background: ${cat.color || '#10b981'}; width: 14px; height: 14px; border-radius: 50%; margin: 0 auto; border: 1px solid rgba(255,255,255,0.15);"></div></td>
      </tr>
    `;
  }).join('');
}

function selectSearchCategoryRow(catId) {
  state.selectedSearchCategoryId = catId;
  renderSearchCategoryTable();
  
  const selectBtn = document.getElementById('searchCategorySelectBtn');
  if (selectBtn) {
    selectBtn.disabled = false;
    selectBtn.style.opacity = '1';
    selectBtn.style.cursor = 'pointer';
  }
}

function confirmSearchCategorySelection(catId) {
  const targetId = catId || state.selectedSearchCategoryId;
  if (!targetId) return;
  
  const prodCatSelect = document.getElementById('prodCategory');
  if (prodCatSelect) {
    prodCatSelect.value = targetId;
    state.lastSelectedProdCategoryId = targetId;
  }
  
  closeSearchCategoryModal();
}

function selectCategoryFromSearchBox() {
  confirmSearchCategorySelection();
}

function openAddCategoryModalFromSearch() {
  state.isCreatingCategoryFromSearchBox = true;
  openAddCategoryModal();
}

// --- P. EXCEL (.XLSX) IMPORT & DELETE ALL PRODUCTS CONTROLLERS ---
function toggleProductsMenu(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const dropdown = document.getElementById('productsActionsDropdown');
  if (dropdown) {
    const isVisible = dropdown.style.display === 'block';
    dropdown.style.display = isVisible ? 'none' : 'block';
  }
}

// Global click handler to close products actions menu dropdown when clicked outside
window.addEventListener('click', (e) => {
  const dropdown = document.getElementById('productsActionsDropdown');
  if (dropdown && !e.target.closest('#adminProductsActions')) {
    dropdown.style.display = 'none';
  }
});

function exportProductsToJSON(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  // Close dropdown
  const dropdown = document.getElementById('productsActionsDropdown');
  if (dropdown) dropdown.style.display = 'none';
  
  if (state.products.length === 0) {
    alert("Action completed.");
    return;
  }
  
  const menuData = {
    restaurantName: state.settings.restaurantName || "Pandora POS",
    categories: state.categories || [],
    products: state.products || []
  };
  
  const jsonString = JSON.stringify(menuData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `pandora_menu_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  console.log('[JSON Export] Menu exported successfully');
}

function exportProductsToExcel(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  // Close dropdown
  const dropdown = document.getElementById('productsActionsDropdown');
  if (dropdown) dropdown.style.display = 'none';
  
  if (state.products.length === 0) {
    alert("Action completed.");
    return;
  }
  
  // Prepare data for export matching our import columns
  const data = state.products.map(p => {
    const cat = state.categories.find(c => c.id === p.categoryId);
    return {
      'Product Name': p.name,
      'Sales Price': p.price,
      'Category': cat ? cat.name : 'General',
      'Category Color': cat ? cat.color : '',
      'Stock': p.track_inventory ? p.stock : 'N/A',
      'Track Stock': p.track_inventory ? 'yes' : 'no',
      'Barcode': p.barcode || '',
      'Kitchen Station': p.station || 'Hot Kitchen',
      'Options JSON': p.options ? JSON.stringify(p.options) : '',
      'Ingredients JSON': p.ingredients ? JSON.stringify(p.ingredients) : ''
    };
  });
  
  try {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
    XLSX.writeFile(workbook, "POS_Products_Export.xlsx");
  } catch (err) {
    console.error(err);
    alert("Action completed.");
  }
}

function toggleSelectAllProducts(master) {
  const checkboxes = document.querySelectorAll('.product-select-checkbox');
  checkboxes.forEach(cb => {
    cb.checked = master.checked;
  });
  updateBatchDeleteButtonState();
}

function updateBatchDeleteButtonState() {
  const checked = document.querySelectorAll('.product-select-checkbox:checked');
  const deleteOption = document.getElementById('deleteSelectedOptionBtn');
  
  if (deleteOption) {
    const countSpan = deleteOption.querySelector('.badge-count');
    if (checked.length > 0) {
      deleteOption.style.opacity = '1';
      deleteOption.style.pointerEvents = 'auto';
      if (countSpan) countSpan.textContent = `(${checked.length})`;
    } else {
      deleteOption.style.opacity = '0.5';
      deleteOption.style.pointerEvents = 'none';
      if (countSpan) countSpan.textContent = '';
    }
  }
  
  // Update master checkbox status
  const master = document.getElementById('selectAllProductsCheckbox');
  const totalCheckboxes = document.querySelectorAll('.product-select-checkbox');
  if (master && totalCheckboxes.length > 0) {
    master.checked = (checked.length === totalCheckboxes.length);
  }
}

function deleteSelectedProducts(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  // Close dropdown
  const dropdown = document.getElementById('productsActionsDropdown');
  if (dropdown) dropdown.style.display = 'none';
  
  const checked = document.querySelectorAll('.product-select-checkbox:checked');
  if (checked.length === 0) {
    alert("Action completed.");
    return;
  }
  
  const selectedIds = Array.from(checked).map(cb => cb.getAttribute('data-product-id'));
  
  // Accidental data loss prevention check
  if (confirm(`âš ï¸ á€žá€á€­á€•á€±á€¸á€á€»á€€á€º: á€›á€½á€±á€¸á€á€»á€šá€ºá€‘á€¬á€¸á€žá€±á€¬ á€Ÿá€„á€ºá€¸á€•á€½á€² ${selectedIds.length} á€™á€»á€­á€¯á€¸á€€á€­á€¯ á€¡á€•á€¼á€®á€¸á€á€­á€¯á€„á€º á€–á€»á€€á€ºá€•á€…á€ºá€•á€«á€™á€Šá€ºá€œá€¬á€¸? á€•á€¼á€”á€ºá€œá€Šá€ºá€›á€šá€°á á€™á€›á€”á€­á€¯á€„á€ºá€•á€«á‹`)) {
    state.products = state.products.filter(p => !selectedIds.includes(p.id));
    
    saveState();
    renderSettingsPane();
    renderSalesCounter(); // Dynamic refresh checkout counter
    alert("Action completed.");
  }
}

function triggerProductImport(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const dropdown = document.getElementById('productsActionsDropdown');
  if (dropdown) dropdown.style.display = 'none';

  const fileInput = document.getElementById('excelImportFileInput');
  if (fileInput) fileInput.accept = '.xlsx, .xls, .json';
  if (fileInput) fileInput.dataset.importType = 'auto';
  if (fileInput) fileInput.click();
}

function triggerExcelImport(e) {
  triggerProductImport(e);
}

function triggerJSONImport(e) {
  triggerProductImport(e);
}

function handleProductImportSelected(input) {
  if (!input.files || input.files.length === 0) return;
  
  const file = input.files[0];
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'json') {
    handleProductsJSONImport(file, input);
    return;
  }
  handleExcelImportSelected(input);
}

function normalizeImportedProducts(rawProducts) {
  const rows = Array.isArray(rawProducts) ? rawProducts : [];
  const colors = ['#10b981', '#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6'];
  const parsedProducts = [];
  let newCategoriesCount = 0;

  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object') return;
    const prodName = String(row.name ?? row.productName ?? row['Product Name'] ?? row.product ?? '').trim();
    if (!prodName) return;

    const sourceCategoryId = row.categoryId ?? row['Category ID'] ?? '';
    const categoryName = String(row.categoryName ?? row.category ?? row.Category ?? 'General').trim() || 'General';
    let category = sourceCategoryId
      ? state.categories.find(c => String(c.id) === String(sourceCategoryId))
      : state.categories.find(c => c.name && c.name.toLowerCase() === categoryName.toLowerCase());
    if (!category) {
      category = {
        id: generateId('c'),
        name: categoryName,
        slug: categoryName.toLowerCase().replace(/\s+/g, '-'),
        color: row.categoryColor || row['Category Color'] || row.color || colors[index % colors.length]
      };
      state.categories.push(category);
      newCategoriesCount++;
    }

    const price = parseInt(String(row.price ?? row.salesPrice ?? row['Sales Price'] ?? 0).replace(/[^0-9.-]/g, '')) || 0;
    const stockRaw = row.stock ?? row.initialStock ?? row.Stock ?? '';
    const stock = parseInt(String(stockRaw).replace(/[^0-9.-]/g, '')) || 0;
    const track = row.track_inventory ?? row.trackInventory ?? row.trackStock ?? row['Track Stock'];
    const trackInventory = typeof track === 'boolean'
      ? track
      : (track !== undefined ? /^(yes|true|1)$/i.test(String(track).trim()) : stockRaw !== '' && stockRaw !== 'N/A');

    const product = {
      id: row.id || generateId('p'),
      name: prodName,
      price,
      categoryId: category.id,
      color: row.color || category.color || '#10b981',
      track_inventory: trackInventory,
      stock: trackInventory ? stock : 0,
      barcode: String(row.barcode ?? row.Barcode ?? row.sku ?? '').trim(),
      station: row.station || row.kitchenStation || row.printer || row['Kitchen Station'] || 'Hot Kitchen'
    };

    if (Array.isArray(row.options)) product.options = row.options;
    if (Array.isArray(row.ingredients)) product.ingredients = row.ingredients;
    if (!product.options && row['Options JSON']) {
      try { product.options = JSON.parse(row['Options JSON']); } catch (e) {}
    }
    if (!product.ingredients && row['Ingredients JSON']) {
      try { product.ingredients = JSON.parse(row['Ingredients JSON']); } catch (e) {}
    }
    if (row.image) product.image = row.image;
    parsedProducts.push(product);
  });

  return { parsedProducts, newCategoriesCount };
}

function applyImportedProducts(parsedProducts, newCategoriesCount, sourceLabel) {
  if (parsedProducts.length === 0) {
    alert('No valid products found in the selected file.');
    return;
  }

  const overwrite = confirm(`${sourceLabel} file contains ${parsedProducts.length} products and ${newCategoriesCount} new categories.\n\nOK = overwrite current products\nCancel = append to current products`);
  state.products = overwrite ? parsedProducts : [...state.products, ...parsedProducts];
  saveState();
  renderSettingsPane();
  renderSalesCounter();
  alert(`${parsedProducts.length} products imported successfully.`);
}

function handleProductsJSONImport(file, input) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const json = JSON.parse(e.target.result);
      const rows = Array.isArray(json) ? json : (json.products || []);
      if (Array.isArray(json.categories)) {
        json.categories.forEach(cat => {
          if (!cat || !cat.name) return;
          const exists = state.categories.some(c => c.name && c.name.toLowerCase() === cat.name.toLowerCase());
          if (!exists) state.categories.push({ ...cat, id: cat.id || generateId('c') });
        });
      }
      const { parsedProducts, newCategoriesCount } = normalizeImportedProducts(rows);
      applyImportedProducts(parsedProducts, newCategoriesCount, 'JSON');
    } catch (err) {
      console.error(err);
      alert(`JSON import failed: ${err.message}`);
    } finally {
      input.value = '';
    }
  };
  reader.readAsText(file, 'UTF-8');
}

function handleExcelImportSelected(input) {
  if (!input.files || input.files.length === 0) return;

  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      if (typeof XLSX === 'undefined') {
        throw new Error('Excel library is not loaded. Please check internet connection or use JSON import.');
      }
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet);
      const { parsedProducts, newCategoriesCount } = normalizeImportedProducts(rows);
      applyImportedProducts(parsedProducts, newCategoriesCount, 'Excel');
    } catch (err) {
      console.error(err);
      alert(`Excel import failed: ${err.message}`);
    } finally {
      input.value = '';
    }
  };

  reader.readAsArrayBuffer(file);
}

// --- REGISTER MANAGEMENT & PAYMENT METHOD CRUD FUNCTIONS ---

function escapeHtml(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeJsString(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, ' ');
}

function repairMojibakeText(text) {
  if (typeof text !== 'string' || !/[áÁâðï]/.test(text)) return text;

  const win1252 = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84,
    0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
    0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C,
    0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
    0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
    0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F
  };

  try {
    const bytes = Array.from(text, char => {
      const code = char.codePointAt(0);
      if (code <= 0xff) return code;
      return win1252[code] ?? 0x3f;
    });
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
    return decoded && !/[áÁâðï]/.test(decoded) ? decoded : text;
  } catch (err) {
    return text;
  }
}

function displayText(text, fallback = '') {
  const value = text == null || text === '' ? fallback : String(text);
  return repairMojibakeText(value);
}

// 1. Dropdown toggle
function toggleRegisterDropdown(event) {
  event.stopPropagation();
  const dropdown = document.getElementById('registerDropdownContent');
  if (dropdown) {
    dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
  }
}

// 2. Open Register Modal actions
function openRegisterModal() {
  const overlay = document.getElementById('openRegisterModalOverlay');
  if (overlay) {
    overlay.classList.add('active');
    overlay.style.display = 'flex';
  }
}

function closeRegisterModal() {
  const overlay = document.getElementById('openRegisterModalOverlay');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.style.display = 'none';
  }
}

function submitOpenRegister() {
  const amountInput = document.getElementById('openingCashAmount');
  if (!amountInput) return;
  const cashAmount = parseFloat(amountInput.value) || 0;
  
  state.register = {
    status: 'open',
    openingCash: cashAmount,
    cashIn: [],
    cashOut: [],
    sales: [],
    openedAt: new Date().toISOString(),
    openedBy: state.currentUser ? state.currentUser.name : 'Unknown'
  };
  
  saveState();
  closeRegisterModal();
  
  // Refresh UI
  const regLabel = document.getElementById('registerCloseOpenLink');
  if (regLabel) {
    regLabel.innerHTML = `<i class="fa-solid fa-door-closed" style="color: var(--accent-danger); width: 16px;"></i> Close Register`;
  }
  
  alert(`Register opened. Opening cash: ${formatPrice(cashAmount)}`);
}

// 3. Cash In / Out transactions
function openRegisterCashInOutModal(event) {
  if (event) event.preventDefault();
  
  // Close register dropdown
  const dropdown = document.getElementById('registerDropdownContent');
  if (dropdown) dropdown.style.display = 'none';
  
  if (!state.register || state.register.status !== 'open') {
    alert("Action completed.");
    return;
  }
  
  const overlay = document.getElementById('cashInOutModalOverlay');
  if (overlay) {
    overlay.classList.add('active');
    overlay.style.display = 'flex';
  }
  
  // Reset fields
  document.getElementById('cashInOutAmount').value = '';
  document.getElementById('cashInOutNote').value = '';
  document.getElementById('cashInOutType').selectedIndex = 0;
}

function closeCashInOutModal() {
  const overlay = document.getElementById('cashInOutModalOverlay');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.style.display = 'none';
  }
}

function submitCashInOut() {
  const type = document.getElementById('cashInOutType').value;
  const method = document.getElementById('cashInOutMethod').value || 'Cash';
  const amount = parseFloat(document.getElementById('cashInOutAmount').value) || 0;
  const note = document.getElementById('cashInOutNote').value;
  
  if (amount <= 0 || !note) {
    alert("Action completed.");
    return;
  }
  
  const transaction = {
    id: generateId('tx'),
    type: type,
    method: method,
    amount: amount,
    note: note,
    timestamp: new Date().toISOString()
  };
  
  if (type === 'in') {
    state.register.cashIn.push(transaction);
    alert(`${method} In saved: ${formatPrice(amount)}`);
  } else {
    state.register.cashOut.push(transaction);
    alert(`${method} Out saved: ${formatPrice(amount)}`);
  }
  
  state.transactionHistory = state.transactionHistory || [];
  state.transactionHistory.push(transaction);
  
  saveState();
  closeCashInOutModal();
}

// 4. Close Register summary and closure
function triggerRegisterCloseOpen(event) {
  if (event) event.preventDefault();
  
  // Close dropdown
  const dropdown = document.getElementById('registerDropdownContent');
  if (dropdown) dropdown.style.display = 'none';
  
  if (!state.register || state.register.status === 'closed') {
    openRegisterModal();
  } else {
    openCloseRegisterModal();
  }
}

let _currentExpectedCash = 0;

function openCloseRegisterModal() {
  const overlay = document.getElementById('closeRegisterModalOverlay');
  if (!overlay) return;
  
  // Generate daily report HTML
  generateDailySaleReport();
  
  // Reset fields
  document.getElementById('closeRegisterNote').value = '';
  const cashInput = document.getElementById('closeRegisterActualCash');
  if (cashInput) cashInput.value = '';
  
  const diffLabel = document.getElementById('closeRegisterDiffLabel');
  if (diffLabel) {
    diffLabel.textContent = '0 MMK';
    diffLabel.style.color = 'var(--text-muted)';
  }
  
  overlay.classList.add('active');
  overlay.style.display = 'flex';
}

function closeCloseRegisterModal() {
  const overlay = document.getElementById('closeRegisterModalOverlay');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.style.display = 'none';
  }
}

function openCashInOutFromClose() {
  closeCloseRegisterModal();
  openRegisterCashInOutModal();
}

function generateDailySaleReport() {
  const container = document.getElementById('dailySaleReportPrintArea');
  if (!container) return;
  
  const reg = state.register || { openingCash: 0, cashIn: [], cashOut: [], sales: [] };
  
  // Calculate sales from this session
  const openedTime = reg.openedAt ? new Date(reg.openedAt).getTime() : 0;
  const currentSales = state.salesHistory.filter(sale => {
    const saleTime = new Date(sale.timestamp).getTime();
    return saleTime >= openedTime;
  });
  
  // Separate Cash vs Mobile
  const cashSales = currentSales.filter(s => !s.paymentMethod || s.paymentMethod.toLowerCase() === 'cash');
  const mobileSales = currentSales.filter(s => s.paymentMethod && s.paymentMethod.toLowerCase() !== 'cash');
  
  const totalCashSales = cashSales.reduce((sum, s) => sum + s.total, 0);
  const totalMobileSales = mobileSales.reduce((sum, s) => sum + s.total, 0);
  
  const cashInTransactions = (reg.cashIn || []).filter(t => !t.method || t.method.toLowerCase() === 'cash');
  const cashOutTransactions = (reg.cashOut || []).filter(t => !t.method || t.method.toLowerCase() === 'cash');
  
  const mobileInTransactions = (reg.cashIn || []).filter(t => t.method && t.method.toLowerCase() !== 'cash');
  const mobileOutTransactions = (reg.cashOut || []).filter(t => t.method && t.method.toLowerCase() !== 'cash');
  
  const totalCashIn = cashInTransactions.reduce((sum, t) => sum + t.amount, 0);
  const totalCashOut = cashOutTransactions.reduce((sum, t) => sum + t.amount, 0);
  
  const expectedCash = reg.openingCash + totalCashSales + totalCashIn - totalCashOut;
  _currentExpectedCash = expectedCash; // Save globally for discrepancy calculation
  
  let mobileTransHtml = '';
  if (mobileInTransactions.length > 0 || mobileOutTransactions.length > 0) {
    mobileTransHtml = `
      <hr style="border: 0; border-top: 1px dashed #000000; margin: 10px 0;">
      <h4 style="margin: 10px 0 5px 0; font-weight: bold; font-size: 0.9rem; text-decoration: underline; color: #000000;">4. BANKING / MOBILE IN-OUT</h4>
      <table style="width:100%; font-size:0.8rem; text-align:left; border-collapse:collapse; margin-bottom:10px;">
        <thead>
          <tr style="border-bottom:1px solid #000;">
            <th style="padding:4px; color:#000;">Type</th>
            <th style="padding:4px; color:#000;">Account</th>
            <th style="padding:4px; color:#000;">Note</th>
            <th style="padding:4px; text-align:right; color:#000;">Amount</th>
          </tr>
        </thead>
        <tbody>
    `;
    
    mobileInTransactions.forEach(t => {
      mobileTransHtml += `
        <tr>
          <td style="padding:4px; color:#000;">In</td>
          <td style="padding:4px; color:#000;">${escapeHtml(t.method)}</td>
          <td style="padding:4px; color:#000;">${escapeHtml(t.note)}</td>
          <td style="padding:4px; text-align:right; color: green; font-weight: bold;">+${formatPrice(t.amount)}</td>
        </tr>
      `;
    });
    
    mobileOutTransactions.forEach(t => {
      mobileTransHtml += `
        <tr>
          <td style="padding:4px; color:#000;">Out</td>
          <td style="padding:4px; color:#000;">${escapeHtml(t.method)}</td>
          <td style="padding:4px; color:#000;">${escapeHtml(t.note)}</td>
          <td style="padding:4px; text-align:right; color: red; font-weight: bold;">-${formatPrice(t.amount)}</td>
        </tr>
      `;
    });
    
    mobileTransHtml += `
        </tbody>
      </table>
    `;
  }
  
  let html = `
    <div style="text-align: center; border-bottom: 2px dashed #000000; padding-bottom: 15px; margin-bottom: 15px;">
      <h2 style="font-weight: 800; font-size: 1.25rem; margin: 0; color: #000000;">${state.settings.restaurantName || 'Pandora POS'}</h2>
      <p style="margin: 3px 0 0 0; font-size: 0.82rem; color: #000000;">Daily Sale Report / Close Register Summary</p>
    </div>
    
    <div style="margin-bottom: 12px; font-size: 0.85rem; color: #000000;">
      <div>Opened At: ${reg.openedAt ? new Date(reg.openedAt).toLocaleString() : 'N/A'}</div>
      <div>Closed At: ${new Date().toLocaleString()}</div>
      <div>Cashier: ${escapeHtml(reg.openedBy || 'Staff')}</div>
    </div>
    
    <hr style="border: 0; border-top: 1px dashed #000000; margin: 10px 0;">
    
    <h4 style="margin: 10px 0 5px 0; font-weight: bold; font-size: 0.9rem; text-decoration: underline; color: #000000;">1. CASH SALES</h4>
  `;
  
  if (cashSales.length === 0) {
    html += `<div style="font-size: 0.82rem; margin-bottom: 10px; color: #000000;">-- No cash sales --</div>`;
  } else {
    html += `<table style="width:100%; font-size:0.8rem; text-align:left; border-collapse:collapse; margin-bottom:10px;">
      <thead>
        <tr style="border-bottom:1px solid #000;">
          <th style="padding:4px; color:#000;">ID</th>
          <th style="padding:4px; color:#000;">Table/Type</th>
          <th style="padding:4px; text-align:right; color:#000;">Amount</th>
        </tr>
      </thead>
      <tbody>`;
    cashSales.forEach(s => {
      html += `
        <tr>
          <td style="padding:4px; color:#000;">${escapeHtml(s.id)}</td>
          <td style="padding:4px; color:#000;">${escapeHtml(s.tableName || s.type)}</td>
          <td style="padding:4px; text-align:right; color:#000;">${formatPrice(s.total)}</td>
        </tr>
      `;
    });
    html += `
      <tr style="border-top:1px dashed #000; font-weight:bold;">
        <td colspan="2" style="padding:4px; color:#000;">Total Cash Sales:</td>
        <td style="padding:4px; text-align:right; color:#000;">${formatPrice(totalCashSales)}</td>
      </tr>
      </tbody>
    </table>`;
  }
  
  html += `
    <hr style="border: 0; border-top: 1px dashed #000000; margin: 10px 0;">
    <h4 style="margin: 10px 0 5px 0; font-weight: bold; font-size: 0.9rem; text-decoration: underline; color: #000000;">2. MOBILE / MOBILE PAY SALES</h4>
  `;
  
  if (mobileSales.length === 0) {
    html += `<div style="font-size: 0.82rem; margin-bottom: 10px; color: #000000;">-- No mobile pay sales --</div>`;
  } else {
    html += `<table style="width:100%; font-size:0.8rem; text-align:left; border-collapse:collapse; margin-bottom:10px;">
      <thead>
        <tr style="border-bottom:1px solid #000;">
          <th style="padding:4px; color:#000;">ID</th>
          <th style="padding:4px; color:#000;">Method</th>
          <th style="padding:4px; text-align:right; color:#000;">Amount</th>
        </tr>
      </thead>
      <tbody>`;
    mobileSales.forEach(s => {
      html += `
        <tr>
          <td style="padding:4px; color:#000;">${escapeHtml(s.id)}</td>
          <td style="padding:4px; color:#000;">${escapeHtml(s.paymentMethod)}</td>
          <td style="padding:4px; text-align:right; color:#000;">${formatPrice(s.total)}</td>
        </tr>
      `;
    });
    html += `
      <tr style="border-top:1px dashed #000; font-weight:bold;">
        <td colspan="2" style="padding:4px; color:#000;">Total Mobile Pay Sales:</td>
        <td style="padding:4px; text-align:right; color:#000;">${formatPrice(totalMobileSales)}</td>
      </tr>
      </tbody>
    </table>`;
  }
  
  html += `
    <hr style="border: 0; border-top: 1px dashed #000000; margin: 10px 0;">
    <h4 style="margin: 10px 0 5px 0; font-weight: bold; font-size: 0.9rem; text-decoration: underline; color: #000000;">3. CASH FLOW SUMMARY</h4>
    <table style="width:100%; font-size:0.85rem; border-collapse:collapse; margin-top:5px; color: #000000;">
      <tr>
        <td style="padding:4px; color:#000;">(+) Opening Cash:</td>
        <td style="padding:4px; text-align:right; color:#000;">${formatPrice(reg.openingCash)}</td>
      </tr>
      <tr>
        <td style="padding:4px; color:#000;">(+) Cash Sales:</td>
        <td style="padding:4px; text-align:right; color:#000;">${formatPrice(totalCashSales)}</td>
      </tr>
      <tr>
        <td style="padding:4px; color:#000;">(+) Cash In:</td>
        <td style="padding:4px; text-align:right; color:#000; font-weight:bold;">+${formatPrice(totalCashIn)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #000;">
        <td style="padding:4px; color:#000;">(-) Cash Out:</td>
        <td style="padding:4px; text-align:right; color:#000; font-weight:bold;">-${formatPrice(totalCashOut)}</td>
      </tr>
      <tr style="font-weight:bold; font-size:0.92rem; background:rgba(0,0,0,0.05);">
        <td style="padding:4px; color:#000;">(=) Expected Cash:</td>
        <td style="padding:4px; text-align:right; color:#000;">${formatPrice(expectedCash)}</td>
      </tr>
    </table>
    
    ${mobileTransHtml}
    
    <div style="margin-top: 25px; border-top: 1px dashed #000; padding-top: 10px; font-size: 0.85rem; color: #000000;">
      <div>Total Sales (Cash + Mobile) = <b>${formatPrice(totalCashSales + totalMobileSales)}</b></div>
    </div>
  `;
  
  container.innerHTML = html;
}

function updateCloseRegisterDiff() {
  const cashInput = document.getElementById('closeRegisterActualCash');
  const diffLabel = document.getElementById('closeRegisterDiffLabel');
  if (!cashInput || !diffLabel) return;
  
  const actualCash = parseFloat(cashInput.value) || 0;
  const difference = actualCash - _currentExpectedCash;
  
  if (difference === 0) {
    diffLabel.textContent = '0 MMK (Balanced)';
    diffLabel.style.color = 'var(--text-muted)';
  } else if (difference > 0) {
    diffLabel.textContent = `+${formatPrice(difference)} MMK (Over)`;
    diffLabel.style.color = 'var(--accent-success)';
  } else {
    diffLabel.textContent = `-${formatPrice(Math.abs(difference))} MMK (Short)`;
    diffLabel.style.color = 'var(--accent-danger)';
  }
}

function finalizeRegisterClose() {
  if (!state.register) return;
  
  const actualCashInput = document.getElementById('closeRegisterActualCash');
  const actualCash = actualCashInput ? parseFloat(actualCashInput.value) : 0;
  if (actualCashInput && actualCashInput.value === '') {
    alert("Action completed.");
    return;
  }
  
  const note = document.getElementById('closeRegisterNote').value;
  const difference = actualCash - _currentExpectedCash;
  
  // Save closed shift log
  if (!state.registerHistory) {
    state.registerHistory = [];
  }
  
  const closedShift = {
    id: generateId('shift'),
    openedBy: state.register.openedBy || (state.currentUser ? state.currentUser.name : 'Unknown'),
    openedAt: state.register.openedAt,
    closedAt: new Date().toISOString(),
    openingCash: state.register.openingCash,
    expectedCash: _currentExpectedCash,
    actualCash: actualCash,
    difference: difference,
    closingNote: note
  };
  
  state.registerHistory.push(closedShift);
  
  state.register.status = 'closed';
  state.register.closedAt = new Date().toISOString();
  state.register.closingNote = note;
  
  state.register = null;
  
  saveState();
  closeCloseRegisterModal();
  
  // Force Open Register overlay again for next shift
  checkLoginSession();
  
  alert(`Register closed successfully.\n\nExpected: ${formatPrice(_currentExpectedCash)} MMK\nActual: ${formatPrice(actualCash)} MMK\nDifference: ${formatPrice(difference)} MMK`);
}


function triggerReportDownload() {
  const prevTitle = document.title;
  document.title = `Daily_Sale_Report_${new Date().toISOString().slice(0, 10)}`;
  window.print();
  document.title = prevTitle;
}

// 5. Payment Checkout Modal â€” integrated validation flow
let activePaymentCallback = null;
let _checkoutTarget = null; // holds { subtotal, discount, tax, total } snapshot
let _checkoutSelectedMethod = null;

function openPaymentSelectorModal(orderTarget, callback) {
  // orderTarget may be an order or cart object with { subtotal, discount, tax, total, selectedTaxPresetId, selectedDiscountPresetId }
  const overlay = document.getElementById('paymentSelectorModalOverlay');
  const grid = document.getElementById('paymentMethodsGrid');
  if (!overlay || !grid) return;
  normalizePaymentMethods();

  activePaymentCallback = callback;
  _checkoutSelectedMethod = null;
  _checkoutTarget = orderTarget;

  // Render payment method buttons
  grid.innerHTML = state.paymentMethods.map(m => {
    let logoHtml = '';
    const mName = m.name.toLowerCase();
    
    if (mName.includes('cash')) {
      logoHtml = `
        <svg viewBox="0 0 100 100" style="width: 32px; height: 32px;">
          <rect x="5" y="20" width="90" height="60" rx="8" fill="#10b981"/>
          <circle cx="50" cy="50" r="18" fill="#047857"/>
          <circle cx="50" cy="50" r="14" fill="#10b981"/>
          <text x="50" y="56" font-family="'Outfit', sans-serif" font-size="18" font-weight="bold" fill="#ffffff" text-anchor="middle">$</text>
        </svg>
      `;
    } else if (mName.includes('kpay') || mName.includes('kbz')) {
      logoHtml = `<img src="kpay_logo.png" style="width: 32px; height: 32px; border-radius: 6px; object-fit: cover;" alt="KPay" />`;
    } else if (mName.includes('mmqr') || mName.includes('qr')) {
      logoHtml = `<i class="fa-solid fa-qrcode" style="font-size:1.65rem; color:var(--accent-brand-blue);"></i>`;
    } else {
      logoHtml = `<i class="fa-solid fa-credit-card" style="font-size:1.4rem;"></i>`;
    }
    
    return `
      <button type="button" class="payment-method-select-btn" id="pmBtn_${m.name.replace(/\s+/g,'_')}" onclick="selectCheckoutPaymentMethod('${m.name}')" style="min-height: 68px;">
        ${logoHtml}
        <span style="display:block; margin-top:2px;">${m.name}</span>
      </button>
    `;
  }).join('');

  // Reset confirm button
  const confirmBtn = document.getElementById('checkoutConfirmPaymentBtn');
  if (confirmBtn) {
    confirmBtn.style.opacity = '0.5';
    confirmBtn.style.pointerEvents = 'none';
  }

  // Update billing summary
  updateCheckoutTotals();

  overlay.classList.add('active');
  overlay.style.display = 'flex';
}

function updateCheckoutTotals() {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  let total = 0;
  let taxRate = 0;

  if (_checkoutTarget) {
    subtotal = _checkoutTarget.subtotal || 0;
    discount = _checkoutTarget.discount || 0;
    tax = _checkoutTarget.tax || 0;
    total = _checkoutTarget.total || 0;

    const taxPresetId = _checkoutTarget.selectedTaxPresetId || 'tax-none';
    const taxPreset = state.taxPresets.find(t => t.id === taxPresetId) || { value: 0 };
    taxRate = taxPreset.value;
  }

  // Store computed values back so submitCheckoutPayment can use them
  _checkoutTarget._computedSubtotal = subtotal;
  _checkoutTarget._computedDiscount = discount;
  _checkoutTarget._computedTax = tax;
  _checkoutTarget._computedTotal = total;

  // Update DOM
  const subEl = document.getElementById('checkoutSubtotalText');
  const discRow = document.getElementById('checkoutDiscountRow');
  const discEl = document.getElementById('checkoutDiscountText');
  const taxRateEl = document.getElementById('checkoutTaxRateText');
  const taxEl = document.getElementById('checkoutTaxText');
  const totalEl = document.getElementById('checkoutTotalText');

  if (subEl) subEl.textContent = formatPrice(subtotal);
  if (discRow) discRow.style.display = discount > 0 ? 'flex' : 'none';
  if (discEl) discEl.textContent = '-' + formatPrice(discount);
  if (taxRateEl) taxRateEl.textContent = taxRate;
  if (taxEl) taxEl.textContent = formatPrice(tax);
  if (totalEl) totalEl.textContent = formatPrice(total);
}

function selectCheckoutPaymentMethod(methodName) {
  _checkoutSelectedMethod = methodName;

  // Highlight selected button
  document.querySelectorAll('.payment-method-select-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const selected = document.getElementById('pmBtn_' + methodName.replace(/\s+/g,'_'));
  if (selected) selected.classList.add('active');

  // Enable confirm button
  const confirmBtn = document.getElementById('checkoutConfirmPaymentBtn');
  if (confirmBtn) {
    confirmBtn.style.opacity = '1';
    confirmBtn.style.pointerEvents = 'auto';
  }
}

function submitCheckoutPayment() {
  if (!_checkoutSelectedMethod) {
    alert('á€€á€»á€±á€¸á€‡á€°á€¸á€•á€¼á€¯á á€„á€½á€±á€•á€±á€¸á€á€»á€±á€™á€¾á€¯á€•á€¯á€¶á€…á€¶ á€›á€½á€±á€¸á€á€»á€šá€ºá€•á€±á€¸á€•á€«!');
    return;
  }
  if (activePaymentCallback) {
    activePaymentCallback(_checkoutSelectedMethod, _checkoutTarget);
  }
  closePaymentSelectorModal();
}

function closePaymentSelectorModal() {
  const overlay = document.getElementById('paymentSelectorModalOverlay');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.style.display = 'none';
  }
  activePaymentCallback = null;
  _checkoutSelectedMethod = null;
}

// Legacy alias kept for any callers that might use selectPaymentMethod directly
function selectPaymentMethod(methodName) {
  selectCheckoutPaymentMethod(methodName);
}


// 6. CRUD Operations for Payment Methods
function openAddPaymentMethodModal() {
  const overlay = document.getElementById('paymentMethodModalOverlay');
  const title = document.getElementById('paymentMethodModalTitle');
  const form = document.getElementById('paymentMethodAddEditForm');
  
  if (!overlay || !title || !form) return;
  
  title.textContent = "New Payment Method";
  document.getElementById('editPaymentMethodId').value = '';
  document.getElementById('paymentMethodName').value = '';
  
  overlay.classList.add('active');
  overlay.style.display = 'flex';
}

function openEditPaymentMethodModal(id) {
  const overlay = document.getElementById('paymentMethodModalOverlay');
  const title = document.getElementById('paymentMethodModalTitle');
  
  if (!overlay || !title) return;
  
  const m = state.paymentMethods.find(pm => pm.id === id);
  if (!m) return;
  
  title.textContent = "Edit Payment Method";
  document.getElementById('editPaymentMethodId').value = m.id;
  document.getElementById('paymentMethodName').value = m.name;
  
  overlay.classList.add('active');
  overlay.style.display = 'flex';
}

function closePaymentMethodModal() {
  const overlay = document.getElementById('paymentMethodModalOverlay');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.style.display = 'none';
  }
}

function submitPaymentMethod() {
  const id = document.getElementById('editPaymentMethodId').value;
  const name = document.getElementById('paymentMethodName').value.trim();
  
  if (!name) {
    alert("Action completed.");
    return;
  }
  
  if (id) {
    const m = state.paymentMethods.find(pm => pm.id === id);
    if (m) {
      m.name = name;
    }
  } else {
    const newMethod = {
      id: generateId('pay'),
      name: name
    };
    state.paymentMethods.push(newMethod);
  }
  
  saveState();
  closePaymentMethodModal();
  renderPaymentMethodsList();
}

function deletePaymentMethod(id) {
  alert("Payment methods are fixed for this shop: Cash, KPAY, MMQR.");
}

function renderPaymentMethodsList() {
  const container = document.getElementById('settingsPaymentMethodEditContainer');
  if (!container) return;
  normalizePaymentMethods();
  
  if (state.paymentMethods.length === 0) {
    container.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-muted);">No payment methods yet.</div>`;
    return;
  }
  
  let html = `<table class="admin-table" style="width:100%; border-collapse:collapse; margin-top:10px;">
    <thead>
      <tr style="border-bottom: 2px solid var(--panel-border); text-align:left;">
        <th style="padding:10px; color:var(--text-secondary);">Name</th>
        <th style="padding:10px; color:var(--text-secondary); text-align:right;">Status</th>
      </tr>
    </thead>
    <tbody>`;
    
  state.paymentMethods.forEach(m => {
    html += `
      <tr style="border-bottom:1px solid var(--panel-border);">
        <td style="padding:10px; font-weight:bold; color:var(--text-primary);">${escapeHtml(m.name)}</td>
        <td style="padding:10px; text-align:right;">
          <span class="expense-tag stock-linked">Enabled</span>
        </td>
      </tr>
    `;
  });
  
  html += `</tbody></table>`;
  container.innerHTML = html;
}

// 6B. CRUD Operations for Loyalty Members
function openAddLoyaltyModal() {
  const overlay = document.getElementById('loyaltyMemberModalOverlay');
  const title = document.getElementById('loyaltyMemberModalTitle');
  const form = document.getElementById('loyaltyMemberAddEditForm');
  
  if (!overlay || !title || !form) return;
  
  title.textContent = "Create Member";
  document.getElementById('editLoyaltyMemberId').value = '';
  document.getElementById('loyaltyMemberName').value = '';
  document.getElementById('loyaltyMemberPhone').value = '';
  document.getElementById('loyaltyMemberPoints').value = '0';
  
  overlay.classList.add('active');
  overlay.style.display = 'flex';
}

function openEditLoyaltyModal(id) {
  const overlay = document.getElementById('loyaltyMemberModalOverlay');
  const title = document.getElementById('loyaltyMemberModalTitle');
  
  if (!overlay || !title) return;
  
  const c = state.customers.find(cust => cust.id === id);
  if (!c) return;
  
  title.textContent = "Edit Member";
  document.getElementById('editLoyaltyMemberId').value = c.id;
  document.getElementById('loyaltyMemberName').value = c.name;
  document.getElementById('loyaltyMemberPhone').value = c.phone;
  document.getElementById('loyaltyMemberPoints').value = c.points || 0;
  
  overlay.classList.add('active');
  overlay.style.display = 'flex';
}

function closeLoyaltyMemberModal() {
  const overlay = document.getElementById('loyaltyMemberModalOverlay');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.style.display = 'none';
  }
}

function handleLoyaltyMemberFormSubmit(event) {
  if (event) event.preventDefault();
  
  const id = document.getElementById('editLoyaltyMemberId').value;
  const name = document.getElementById('loyaltyMemberName').value.trim();
  const phone = document.getElementById('loyaltyMemberPhone').value.trim();
  const points = parseInt(document.getElementById('loyaltyMemberPoints').value) || 0;
  
  if (!name || !phone) {
    alert("Please fill in member name and phone number.");
    return;
  }
  
  if (id) {
    // Edit member
    const c = state.customers.find(cust => cust.id === id);
    if (c) {
      c.name = name;
      c.phone = phone;
      c.points = points;
    }
  } else {
    // Add new member
    const newMember = {
      id: generateId('cust'),
      name: name,
      phone: phone,
      points: points,
      totalSpending: 0
    };
    state.customers.push(newMember);
  }
  
  saveState();
  closeLoyaltyMemberModal();
  renderLoyaltyMembersList();
  populateCartPresetsDropdowns(); // Update selector in POS view
}

function deleteLoyaltyMember(id) {
  if (confirm("Are you sure?")) {
    state.customers = state.customers.filter(c => c.id !== id);
    saveState();
    renderLoyaltyMembersList();
    populateCartPresetsDropdowns(); // Update selector in POS view
  }
}

function renderLoyaltyMembersList() {
  const container = document.getElementById('settingsLoyaltyEditContainer');
  if (!container) return;
  
  if (!state.customers || state.customers.length === 0) {
    container.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-muted);">No loyalty members yet.</div>`;
    return;
  }
  
  let html = `<table class="admin-table" style="width:100%; border-collapse:collapse; margin-top:10px;">
    <thead>
      <tr style="border-bottom: 2px solid var(--panel-border); text-align:left;">
        <th style="padding:10px; color:var(--text-secondary);">Name</th>
        <th style="padding:10px; color:var(--text-secondary);">Phone</th>
        <th style="padding:10px; color:var(--text-secondary); text-align:right;">Spending</th>
        <th style="padding:10px; color:var(--text-secondary); text-align:right;">Points</th>
        <th style="padding:10px; color:var(--text-secondary); text-align:right;">Actions</th>
      </tr>
    </thead>
    <tbody>`;
    
  state.customers.forEach(c => {
    html += `
      <tr style="border-bottom:1px solid var(--panel-border);">
        <td style="padding:10px; font-weight:bold; color:var(--text-primary);">${escapeHtml(c.name)}</td>
        <td style="padding:10px; color:var(--text-secondary);">${escapeHtml(c.phone)}</td>
        <td style="padding:10px; color:var(--text-secondary); text-align:right;">${formatPrice(c.totalSpending || 0)}</td>
        <td style="padding:10px; font-weight:bold; color:var(--accent-success); text-align:right;">${c.points || 0} pt</td>
        <td style="padding:10px; text-align:right;">
          <button class="btn-edit-action" onclick="openEditLoyaltyModal('${escapeHtml(c.id)}')" style="margin-right:6px;"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-edit-action delete" onclick="deleteLoyaltyMember('${escapeHtml(c.id)}')"><i class="fa-solid fa-trash-can"></i></button>
        </td>
      </tr>
    `;
  });
  
  html += `</tbody></table>`;
  container.innerHTML = html;
}

// ==========================================================================
// Customer Self-Order QR Simulator & Customer Ordering Portal
// ==========================================================================

let selfOrderCart = { tableId: null, items: [], activeCategory: 'ALL' };

function openGlobalQrManagerModal() {
  const overlay = document.getElementById('qrSimulatorModalOverlay');
  if (!overlay) return;
  generateQrCodeForType();
  overlay.classList.add('active');
}

function generateQrCodeForType() {
  const qrContainer = document.getElementById('simulatedQrCodeContainer');
  const urlText = document.getElementById('qrMenuUrlText');
  const testBtn = document.getElementById('openSelfOrderBtn');
  
  if (!qrContainer) return;
  
  const targetUrl = window.location.origin + window.location.pathname + '#menu';
  const modeLabel = 'Customers can scan this QR code to view the shop digital menu.';
  
  // Render Dynamic Scanable QR Code using dynamic qrserver api
  qrContainer.innerHTML = `
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(targetUrl)}" 
         alt="Scan QR" 
         style="border: 4px solid white; border-radius: 8px; box-shadow: var(--shadow-md); width: 220px; height: 220px;"
         onerror="this.src='https://chart.googleapis.com/chart?cht=qr&chs=250x250&chl='+encodeURIComponent('${targetUrl}')" />
  `;
  
  if (urlText) {
    urlText.innerHTML = `
      <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 6px;">${modeLabel}</div>
      <div style="font-size: 0.72rem; color: var(--accent-primary); word-break: break-all; background: rgba(255,255,255,0.03); padding: 6px 10px; border-radius: 4px; border: 1px solid var(--panel-border); font-family: monospace;">${targetUrl}</div>
    `;
  }
  
  if (testBtn) {
    testBtn.onclick = () => {
      window.open(targetUrl, '_blank');
    };
  }
}

function closeQrSimulatorModal() {
  const overlay = document.getElementById('qrSimulatorModalOverlay');
  if (overlay) overlay.classList.remove('active');
}

function getMenuCategoryColor(categoryId) {
  const category = state.categories.find(c => c.id === categoryId);
  return (category && category.color) ? category.color : '#0b57a4';
}

function getMenuProductVisual(product) {
  const color = product.color || getMenuCategoryColor(product.categoryId);
  if (product.image) {
    return `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name || 'Menu item')}">`;
  }

  return `
    <div class="digital-menu-fallback-art" style="background: linear-gradient(135deg, ${color}, rgba(15, 23, 42, 0.86));">
      <i class="fa-solid fa-bowl-food"></i>
    </div>
  `;
}

function renderSelfOrderPortal(tableId) {
  const container = document.getElementById('selfOrderPortalContainer');
  if (!container) return;
  
  const isReadOnlyMenu = true; // Always read-only menu
  
  // Set default structure
  container.style.display = 'block';
  selfOrderCart.tableId = isReadOnlyMenu ? 'menu' : tableId;
  
  const table = isReadOnlyMenu ? null : state.tables.find(t => t.id === tableId);
  const tableName = isReadOnlyMenu ? 'Digital Menu' : (table ? table.name : `Table ${tableId}`);
  
  // Build category list
  const activeCat = selfOrderCart.activeCategory || 'ALL';
  const categoryButtons = `
    <button class="digital-menu-chip ${activeCat === 'ALL' ? 'active' : ''}" onclick="switchSelfOrderCategory('ALL')">
      All Items
    </button>
    ` + state.categories.map(c => `
      <button class="digital-menu-chip ${activeCat === c.id ? 'active' : ''}" onclick="switchSelfOrderCategory('${c.id}')" style="${activeCat === c.id ? `background:${c.color || '#0b57a4'};` : ''}">
        ${escapeHtml(c.name)}
      </button>
    `).join('');
    
  // Build product list
  const filteredProducts = activeCat === 'ALL'
    ? state.products
    : state.products.filter(p => p.categoryId === activeCat);
    
  const productsHtml = filteredProducts.map(p => {
    // Check if in cart
    const cartItem = selfOrderCart.items.find(item => item.id === p.id);
    const qty = cartItem ? cartItem.quantity : 0;
    
    let actionArea = '';
    if (!isReadOnlyMenu) {
      actionArea = `
        <button type="button" onclick="addSelfOrderProduct('${p.id}')" style="background: var(--accent-brand-blue); border: none; border-radius: var(--border-radius-sm); color: white; padding: 6px 12px; font-weight: 700; font-size: 0.78rem; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: var(--transition-smooth);">
          <i class="fa-solid fa-circle-plus"></i> Add
        </button>
      `;
      
      if (qty > 0) {
        actionArea = `
          <div style="display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.06); padding: 4px; border-radius: var(--border-radius-sm); border: 1px solid var(--panel-border);">
            <button type="button" onclick="removeSelfOrderProduct('${p.id}')" style="background: none; border: none; color: var(--text-primary); cursor: pointer; width: 22px; height: 22px; font-weight: 900; font-size: 0.88rem;">-</button>
            <span style="font-weight: 800; font-size: 0.85rem; min-width: 14px; text-align: center; color: var(--text-primary);">${qty}</span>
            <button type="button" onclick="addSelfOrderProduct('${p.id}')" style="background: none; border: none; color: var(--text-primary); cursor: pointer; width: 22px; height: 22px; font-weight: 900; font-size: 0.88rem;">+</button>
          </div>
        `;
      }
    }
    
    const category = state.categories.find(c => c.id === p.categoryId);
    const categoryName = category ? category.name : 'Menu';
    const categoryColor = p.color || (category && category.color) || '#0b57a4';
    return `
      <article class="digital-menu-card">
        <div class="digital-menu-photo">
          ${getMenuProductVisual(p)}
        </div>
        <div class="digital-menu-card-body">
          <h4>${escapeHtml(p.name)}</h4>
          <div class="digital-menu-card-meta">
            <span class="digital-menu-price">${formatPrice(p.price)}</span>
            <span class="digital-menu-category-pill" style="background:${categoryColor};">${escapeHtml(categoryName)}</span>
          </div>
          ${actionArea ? `<div style="margin-top:10px;">${actionArea}</div>` : ''}
        </div>
      </article>
    `;
  }).join('');
  
  // Calculate cart summary
  const subtotal = selfOrderCart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const totalQty = selfOrderCart.items.reduce((sum, item) => sum + item.quantity, 0);
  
  let bottomBarHtml = '';
  if (!isReadOnlyMenu && totalQty > 0) {
    bottomBarHtml = `
      <div style="position: fixed; bottom: 0; left: 0; right: 0; background: var(--panel-bg); border-top: 1px solid var(--panel-border); padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 -8px 24px rgba(0,0,0,0.15); z-index: 100;">
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <span style="font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Selected total</span>
          <span style="font-size: 1.15rem; font-weight: 800; color: var(--text-primary);">${formatPrice(subtotal)}</span>
        </div>
        <div style="background: rgba(11, 87, 164, 0.15); border: 1px solid var(--accent-brand-blue); border-radius: var(--border-radius-sm); color: var(--text-primary); padding: 8px 12px; font-weight: 700; font-size: 0.8rem; display: flex; align-items: center; gap: 6px; max-width: 60%; line-height: 1.3;">
          <i class="fa-solid fa-info-circle" style="color: var(--accent-primary); font-size: 1rem;"></i>
          <span>Please show the selected items to staff to place the order.</span>
        </div>
      </div>
    `;
  }
  
  container.innerHTML = `
    <div class="digital-menu-shell">
      <div class="digital-menu-hero">
        <div class="digital-menu-brand">
          <img src="${escapeHtml(getBrandLogoSrc())}" alt="Logo" class="digital-menu-logo" onerror="this.src='logo.png'">
          <div>
            <h2 class="digital-menu-title">${escapeHtml((state.settings && state.settings.restaurantName) ? state.settings.restaurantName : 'Pandora POS')}</h2>
            <div class="digital-menu-subtitle">
              <i class="fa-solid fa-utensils"></i>
              <span>Digital Menu</span>
            </div>
          </div>
        </div>
        <div class="digital-menu-hero-actions">
          <button type="button" onclick="document.getElementById('selfOrderPortalContainer').style.display='none'; window.location.hash='';" class="digital-menu-icon-btn" title="Close Menu">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>

      <div class="digital-menu-tabs">
        ${categoryButtons}
      </div>

      <main class="digital-menu-content" style="padding-bottom:${(!isReadOnlyMenu && totalQty > 0) ? '90px' : '32px'};">
        <div class="digital-menu-heading">
          <div>
            <h3>Menu</h3>
            <p>Choose a category and browse today&apos;s dishes.</p>
          </div>
          <span style="color:#64748b; font-size:0.78rem; font-weight:850;">${filteredProducts.length} items</span>
        </div>
        ${productsHtml.length === 0 ? '<div class="digital-menu-empty"><i class="fa-solid fa-bowl-food" style="font-size:2rem; margin-bottom:10px; display:block;"></i>No menu items in this category yet.</div>' : `<div class="digital-menu-grid">${productsHtml}</div>`}
      </main>

      ${bottomBarHtml}
    </div>
  `;
}

function switchSelfOrderCategory(catId) {
  selfOrderCart.activeCategory = catId;
  renderSelfOrderPortal(selfOrderCart.tableId);
}

function toggleSelfOrderTheme() {
  state.settings.darkMode = !state.settings.darkMode;
  saveState();
  renderSelfOrderPortal(selfOrderCart.tableId);
}

function addSelfOrderProduct(prodId) {
  const prod = state.products.find(p => p.id === prodId);
  if (!prod) return;
  
  const existing = selfOrderCart.items.find(item => item.id === prodId);
  if (existing) {
    existing.quantity++;
  } else {
    selfOrderCart.items.push({
      id: prod.id,
      name: prod.name,
      price: prod.price,
      quantity: 1,
      categoryId: prod.categoryId
    });
  }
  
  renderSelfOrderPortal(selfOrderCart.tableId);
}

function removeSelfOrderProduct(prodId) {
  const existing = selfOrderCart.items.find(item => item.id === prodId);
  if (existing) {
    existing.quantity--;
    if (existing.quantity <= 0) {
      selfOrderCart.items = selfOrderCart.items.filter(item => item.id !== prodId);
    }
  }
  
  renderSelfOrderPortal(selfOrderCart.tableId);
}

function submitSelfOrder() {
  if (selfOrderCart.items.length === 0) return;
  
  const table = state.tables.find(t => t.id === selfOrderCart.tableId);
  if (!table) return;
  
  const now = new Date();
  
  // Check if table is occupied
  if (table.status === 'occupied' || table.status === 'billed') {
    // Append to existing active order
    const activeOrder = state.orders.find(o => o.id === table.activeOrderId);
    if (activeOrder) {
      const mergedItems = [...activeOrder.items];
      selfOrderCart.items.forEach(item => {
        const existing = mergedItems.find(i => i.id === item.id);
        if (existing) {
          existing.quantity += item.quantity;
        } else {
          mergedItems.push({...item});
        }
      });
      applyProductStockDeltaForOrder(activeOrder, mergedItems);
      activeOrder.items = mergedItems;
      
      // Re-calculate totals
      activeOrder.subtotal = activeOrder.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const taxRate = state.settings.taxRate || 0;
      activeOrder.tax = Math.round((activeOrder.subtotal * taxRate) / 100);
      activeOrder.total = activeOrder.subtotal + activeOrder.tax;
      activeOrder.status = 'pending'; // Reset status to pending so KDS picks it up!
      activeOrder.timestamp = now.toISOString().replace('Z', '');
    }
  } else {
    // Create new order
    const orderId = generateSequentialOrderId();
    const subtotal = selfOrderCart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const taxRate = state.settings.taxRate || 0;
    const tax = Math.round((subtotal * taxRate) / 100);
    const total = subtotal + tax;
    
    const newOrder = {
      id: orderId,
      tableName: table.name,
      tableId: table.id,
      type: 'dine-in',
      status: 'pending',
      items: [...selfOrderCart.items],
      subtotal: subtotal,
      discount: 0,
      tax: tax,
      total: total,
      timestamp: now.toISOString().replace('Z', '')
    };
    applyProductStockDeltaForOrder(newOrder, selfOrderCart.items);
    
    state.orders.push(newOrder);
    table.status = 'occupied';
    table.activeOrderId = orderId;
  }
  
  saveState();
  
  // Clear cart and show confirmation screen
  selfOrderCart.items = [];
  
  const container = document.getElementById('selfOrderPortalContainer');
  if (container) {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 80vh; padding: 24px; text-align: center; gap: 20px; font-family: var(--font-family);">
        <div style="width: 80px; height: 80px; background: rgba(16, 185, 129, 0.1); color: var(--accent-success); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; margin-bottom: 10px; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.15);">
          <i class="fa-solid fa-circle-check"></i>
        </div>
        <h2 style="margin: 0; font-size: 1.35rem; font-weight: 800; color: var(--text-primary);">Order sent successfully.</h2>
        <p style="margin: 0; font-size: 0.88rem; color: var(--text-secondary); max-width: 320px; line-height: 1.6;">
          Your order has been sent to the kitchen. Staff will prepare it shortly.
        </p>
        <button type="button" onclick="renderSelfOrderPortal(${table.id})" style="margin-top: 15px; background: var(--accent-brand-blue); border: none; border-radius: var(--border-radius-sm); color: white; padding: 12px 30px; font-weight: 800; font-size: 0.88rem; cursor: pointer;">
          Order More
        </button>
      </div>
    `;
  }
}

function checkSelfOrderRoute() {
  const hash = window.location.hash;
  if (hash.startsWith('#self-order')) {
    const qIndex = hash.indexOf('?');
    const tableId = qIndex !== -1 ? new URLSearchParams(hash.substring(qIndex)).get('table') : null;
    if (tableId) {
      renderSelfOrderPortal(tableId);
    } else {
      renderSelfOrderPortal('menu');
    }
  } else if (hash === '#menu') {
    renderSelfOrderPortal('menu');
  } else {
    const portal = document.getElementById('selfOrderPortalContainer');
    if (portal) portal.style.display = 'none';
  }
}

// Listen for hash change and page load routing
window.addEventListener('hashchange', checkSelfOrderRoute);

// Call route check on load after initialization
const originalInitApp = initApp;
initApp = function() {
  originalInitApp();
  checkSelfOrderRoute();
};


// --- FLOATING AI ASSISTANT CHAT BOT LOGIC ---
function toggleAiChatBot() {
  const win = document.getElementById('aiChatBotWindow');
  const btn = document.getElementById('aiChatBotToggle');
  if (!win) return;
  
  if (win.style.display === 'none') {
    win.style.display = 'flex';
    btn.style.transform = 'scale(0.9)';
  } else {
    win.style.display = 'none';
    btn.style.transform = 'scale(1)';
  }
}

function sendBotQuickAction(text) {
  const input = document.getElementById('aiChatBotInput');
  if (input) {
    input.value = text;
    const form = document.getElementById('aiChatBotForm');
    if (form) {
      handleBotSubmit();
    }
  }
}

function appendBotMessage(text, isUser = false) {
  const chatArea = document.getElementById('aiChatBotMessages');
  if (!chatArea) return;
  
  const msg = document.createElement('div');
  msg.style.alignSelf = isUser ? 'flex-end' : 'flex-start';
  msg.style.maxWidth = '85%';
  msg.style.padding = '10px 12px';
  msg.style.borderRadius = isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px';
  msg.style.fontSize = '0.85rem';
  msg.style.lineHeight = '1.4';
  
  if (isUser) {
    msg.style.background = 'var(--accent-brand-blue)';
    msg.style.color = 'white';
  } else {
    msg.style.background = 'rgba(255,255,255,0.05)';
    msg.style.border = '1px solid var(--panel-border)';
    msg.style.color = 'var(--text-primary)';
  }
  
  msg.innerHTML = text;
  chatArea.appendChild(msg);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function handleBotSubmit(event) {
  if (event) event.preventDefault();
  const input = document.getElementById('aiChatBotInput');
  if (!input) return;
  
  const query = input.value.trim();
  if (!query) return;
  
  // Clear input
  input.value = '';
  
  // Append user message
  appendBotMessage(query, true);
  
  // Process query
  setTimeout(() => {
    const response = processBotQuery(query);
    appendBotMessage(response, false);
  }, 250);
}

function processBotQuery(query) {
  const q = query.toLowerCase();
  
  // Helper calculations (Using device local YYYY-MM-DD reliably)
  const localToday = getLocalDateString();
  
  const todaySales = state.salesHistory.filter(s => {
    try {
      return getLocalDateString(s.timestamp) === localToday;
    } catch (e) {
      return false;
    }
  });
  const totalSalesToday = todaySales.reduce((sum, s) => {
    let activeTotal = 0;
    if (s.items && Array.isArray(s.items)) {
      s.items.forEach(item => {
        const prod = state.products.find(p => p.id === item.id);
        if (prod) activeTotal += item.price * item.quantity;
      });
      if (s.subtotal > 0 && activeTotal > 0) {
        const ratio = activeTotal / s.subtotal;
        activeTotal = activeTotal - (s.discount || 0) * ratio + (s.tax || 0) * ratio;
      }
    }
    return sum + activeTotal;
  }, 0);
  
  const todayExpenses = state.marketExpenses.filter(e => {
    return e.date === localToday;
  });
  const totalExpensesToday = todayExpenses.reduce((sum, e) => sum + (e.cost || 0), 0);
  const netProfitToday = totalSalesToday - totalExpensesToday;
  
  // 1. TODAY SALES QUERY
  if (q.includes('á€›á€±á€¬á€„á€ºá€¸') || q.includes('sale') || q.includes('today sales') || q.includes('á€¡á€›á€±á€¬á€„á€ºá€¸')) {
    if (q.includes('list') || q.includes('á€¡á€žá€±á€¸á€…á€­á€á€º') || q.includes('á€…á€¬á€›á€„á€ºá€¸')) {
      if (todaySales.length === 0) {
        return `á€šá€”á€±á€· á€¡á€›á€±á€¬á€„á€ºá€¸á€…á€¬á€›á€„á€ºá€¸ á€™á€›á€¾á€­á€žá€±á€¸á€•á€«á€á€„á€ºá€—á€»á€¬á‹`;
      }
      let listHtml = `<div style="font-weight:bold; margin-bottom:4px;">ðŸ“Š á€šá€”á€±á€·á€¡á€›á€±á€¬á€„á€ºá€¸á€…á€¬á€›á€„á€ºá€¸:</div>`;
      todaySales.forEach(s => {
        listHtml += `<div style="font-size:0.8rem; margin-top:3px;">â€¢ <strong>${s.id}</strong> (${s.tableName}) - <span style="color:var(--accent-success);">${formatPrice(s.total)}</span></div>`;
      });
      return listHtml;
    }
    return `á€šá€”á€±á€· á€¡á€›á€±á€¬á€„á€ºá€¸á€…á€¯á€…á€¯á€•á€±á€«á€„á€ºá€¸á€™á€¾á€¬ <span style="font-weight:800; color:var(--accent-success);">${formatPrice(totalSalesToday)}</span> á€–á€¼á€…á€ºá€•á€«á€á€šá€º á€á€„á€ºá€—á€»á€¬á‹ (á€…á€¯á€…á€¯á€•á€±á€«á€„á€ºá€¸ ${todaySales.length} á€€á€¼á€­á€™á€º á€›á€±á€¬á€„á€ºá€¸á€›á€•á€«á€žá€Šá€º)`;
  }
  
  // 2. EXPENSES QUERY
  if (q.includes('á€á€šá€º') || q.includes('á€…á€›á€­á€á€º') || q.includes('expense') || q.includes('á€‘á€½á€€á€º') || q.includes('á€–á€­á€¯á€¸')) {
    if (q.includes('list') || q.includes('á€¡á€žá€±á€¸á€…á€­á€á€º') || q.includes('á€…á€¬á€›á€„á€ºá€¸')) {
      if (todayExpenses.length === 0) {
        return `á€šá€”á€±á€· á€á€šá€ºá€šá€°á€…á€›á€­á€á€ºá€™á€¾á€á€ºá€á€™á€ºá€¸ á€™á€›á€¾á€­á€žá€±á€¸á€•á€«á€á€„á€ºá€—á€»á€¬á‹`;
      }
      let listHtml = `<div style="font-weight:bold; margin-bottom:4px;">ðŸ’¸ á€šá€”á€±á€·á€€á€¯á€”á€ºá€€á€»á€…á€›á€­á€á€ºá€™á€»á€¬á€¸:</div>`;
      todayExpenses.forEach(e => {
        listHtml += `<div style="font-size:0.8rem; margin-top:3px;">â€¢ <strong>${escapeHtml(e.itemName)}</strong> - <span style="color:var(--accent-danger);">${formatPrice(e.cost)}</span></div>`;
      });
      return listHtml;
    }
    return `á€šá€”á€±á€· á€…á€›á€­á€á€º/á€¡á€žá€¯á€¶á€¸á€…á€›á€­á€á€º á€…á€¯á€…á€¯á€•á€±á€«á€„á€ºá€¸á€™á€¾á€¬ <span style="font-weight:800; color:var(--accent-danger);">${formatPrice(totalExpensesToday)}</span> á€–á€¼á€…á€ºá€•á€«á€á€šá€º á€á€„á€ºá€—á€»á€¬á‹`;
  }
  
  // 3. NET PROFIT QUERY
  if (q.includes('á€™á€¼á€á€º') || q.includes('profit') || q.includes('á€€á€»á€”á€ºá€„á€½á€±')) {
    const profitColor = netProfitToday >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)';
    return `á€šá€”á€±á€· á€…á€¯á€…á€¯á€•á€±á€«á€„á€ºá€¸á€¡á€™á€¼á€á€ºá€„á€½á€± (á€¡á€›á€±á€¬á€„á€ºá€¸ - á€…á€›á€­á€á€º) á€™á€¾á€¬ <span style="font-weight:800; color:${profitColor};">${formatPrice(netProfitToday)}</span> á€–á€¼á€…á€ºá€•á€«á€á€šá€º á€á€„á€ºá€—á€»á€¬á‹`;
  }
  
  // 4. LOW STOCK QUERY
  if (q.includes('á€…á€á€±á€¬á€·') || q.includes('stock') || q.includes('á€€á€¯á€”á€ºá€•á€…á€¹á€…á€Šá€ºá€¸')) {
    const trackable = state.products.filter(p => p.track_inventory);
    const lowStock = trackable.filter(p => p.stock <= 5);
    
    if (q.includes('á€”á€Šá€ºá€¸') || q.includes('low') || q.includes('á€žá€á€­á€•á€±á€¸')) {
      if (lowStock.length === 0) {
        return `ðŸŽ‰ á€…á€á€±á€¬á€·á€”á€Šá€ºá€¸á€”á€±á€žá€±á€¬ á€€á€¯á€”á€ºá€•á€…á€¹á€…á€Šá€ºá€¸ á€œá€¯á€¶á€¸á€á€™á€›á€¾á€­á€•á€«á€á€„á€ºá€—á€»á€¬á‹ á€¡á€¬á€¸á€œá€¯á€¶á€¸á€¡á€†á€„á€ºá€•á€¼á€±á€•á€«á€á€šá€ºá‹`;
      }
      let listHtml = `<div style="font-weight:bold; color:var(--accent-danger); margin-bottom:4px;">âš ï¸ á€…á€á€±á€¬á€·á€”á€Šá€ºá€¸á€”á€±á€žá€±á€¬ á€•á€…á€¹á€…á€Šá€ºá€¸á€™á€»á€¬á€¸:</div>`;
      lowStock.forEach(p => {
        listHtml += `<div style="font-size:0.8rem; margin-top:3px;">â€¢ <strong>${escapeHtml(p.name)}</strong> - <span style="font-weight:bold;">${p.stock} á€á€¯á€€á€»á€”á€º</span></div>`;
      });
      return listHtml;
    }
    
    if (trackable.length === 0) {
      return `á€…á€á€±á€¬á€·á€…á€±á€¬á€„á€·á€ºá€€á€¼á€Šá€·á€ºá€‘á€¬á€¸á€žá€±á€¬ á€€á€¯á€”á€ºá€•á€…á€¹á€…á€Šá€ºá€¸ á€™á€›á€¾á€­á€žá€±á€¸á€•á€«á€á€„á€ºá€—á€»á€¬á‹`;
    }
    
    let listHtml = `<div style="font-weight:bold; margin-bottom:4px;">ðŸ“¦ á€œá€€á€ºá€›á€¾á€­á€…á€á€±á€¬á€·á€…á€¬á€›á€„á€ºá€¸:</div>`;
    trackable.forEach(p => {
      const isLow = p.stock <= 5;
      const color = isLow ? 'var(--accent-danger)' : 'var(--text-primary)';
      listHtml += `<div style="font-size:0.8rem; margin-top:3px; color:${color};">â€¢ <strong>${escapeHtml(p.name)}</strong> - ${p.stock} á€á€¯á€€á€»á€”á€º ${isLow ? '(Low)' : ''}</div>`;
    });
    return listHtml;
  }
  
  // 5. GREETINGS OR OTHER INFO
  if (q.includes('á€™á€„á€ºá€¹á€‚á€œá€¬á€•á€«') || q.includes('hello') || q.includes('hi') || q.includes('á€™á€„á€ºá€¸á€˜á€šá€ºá€žá€°á€œá€²') || q.includes('bot') || q.includes('á€¡á€€á€°á€¡á€Šá€®')) {
    return `á€™á€„á€ºá€¹á€‚á€œá€¬á€•á€«! á€€á€»á€½á€”á€ºá€á€±á€¬á€ºá€€ Pandora POS Bot á€–á€¼á€…á€ºá€•á€«á€á€šá€ºá‹ á€€á€»á€½á€”á€ºá€á€±á€¬á€·á€ºá€€á€­á€¯ á€šá€”á€±á€·á€¡á€›á€±á€¬á€„á€ºá€¸áŠ á€…á€›á€­á€á€ºáŠ á€¡á€™á€¼á€á€ºá€„á€½á€± á€žá€­á€¯á€·á€™á€Ÿá€¯á€á€º á€…á€á€±á€¬á€·á€¡á€á€¼á€±á€¡á€”á€±á€™á€»á€¬á€¸á€€á€­á€¯ á€…á€¬á€žá€¬á€¸á€›á€­á€¯á€€á€ºá á€™á€±á€¸á€™á€¼á€”á€ºá€¸á€”á€­á€¯á€„á€ºá€žá€œá€­á€¯áŠ Suggestions á€á€œá€¯á€á€ºá€™á€»á€¬á€¸á€€á€­á€¯ á€”á€¾á€­á€•á€ºáá€œá€Šá€ºá€¸ á€¡á€œá€½á€šá€ºá€á€€á€° á€™á€±á€¸á€™á€¼á€”á€ºá€¸á€”á€­á€¯á€„á€ºá€•á€«á€á€šá€ºá€á€„á€ºá€—á€»á€¬á‹`;
  }
  
  return `á€”á€¬á€¸á€™á€œá€Šá€ºá€•á€«á€á€„á€ºá€—á€»á€¬á‹ á€¥á€•á€™á€¬ - "á€’á€®á€”á€±á€· á€˜á€šá€ºá€œá€±á€¬á€€á€ºá€›á€±á€¬á€„á€ºá€¸á€›á€œá€²"áŠ "á€…á€›á€­á€á€ºá€…á€¬á€›á€„á€ºá€¸ á€•á€¼á€•á€«"áŠ "á€…á€á€±á€¬á€·á€”á€Šá€ºá€¸á€”á€±á€á€¬á€á€½á€±á€•á€¼á€•á€«" á€žá€­á€¯á€·á€™á€Ÿá€¯á€á€º "á€¡á€™á€¼á€á€ºá€˜á€šá€ºá€œá€±á€¬á€€á€ºá€œá€²" á€…á€žá€–á€¼á€„á€·á€º á€™á€±á€¸á€™á€¼á€”á€ºá€¸á€”á€­á€¯á€„á€ºá€•á€«á€á€šá€º á€á€„á€ºá€—á€»á€¬á‹`;
}

function clearBotChatHistory() {
  const chatArea = document.getElementById('aiChatBotMessages');
  if (chatArea) {
    chatArea.innerHTML = `
      <div style="align-self: flex-start; max-width: 85%; background: rgba(255,255,255,0.05); border: 1px solid var(--panel-border); color: var(--text-primary); padding: 10px 12px; border-radius: 12px 12px 12px 2px; font-size: 0.85rem; line-height: 1.4;">
        á€™á€„á€ºá€¹á€‚á€œá€¬á€•á€«á€á€„á€ºá€—á€»á€¬! á€€á€»á€½á€”á€ºá€á€±á€¬á€ºá€€ Pandora POS AI Assistant á€–á€¼á€…á€ºá€•á€«á€á€šá€ºá‹ á€…á€”á€…á€ºá€á€½á€„á€ºá€¸ á€…á€¬á€›á€„á€ºá€¸á€‡á€šá€¬á€¸á€™á€»á€¬á€¸á€”á€¾á€„á€·á€º á€•á€á€ºá€žá€€á€ºá€•á€¼á€®á€¸ á€™á€±á€¸á€™á€¼á€”á€ºá€¸á€”á€­á€¯á€„á€ºá€•á€«á€á€šá€ºá‹ ðŸ‘‡
      </div>
    `;
  }
}

function exportDatabaseState() {
  const dataStr = JSON.stringify(state, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  
  const shopName = (state.settings?.shopName || 'Pandora').replace(/\s+/g, '_');
  const todayStr = getLocalDateString();
  link.download = `${shopName}_backup_${todayStr}.json`;
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  
  alert("Action completed.");
}

function triggerRestoreDatabase() {
  const fileInput = document.getElementById('databaseRestoreFileInput');
  if (fileInput) fileInput.click();
}

function importDatabaseState(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const importedData = JSON.parse(e.target.result);
      
      if (importedData.products && Array.isArray(importedData.products) && importedData.tables && Array.isArray(importedData.tables)) {
        if (confirm("Are you sure?")) {
          state = importedData;
          saveState();
          
          alert("Action completed.");
          event.target.value = '';
          window.location.reload();
        }
      } else {
        alert("Action completed.");
      }
    } catch (err) {
      alert("á€–á€­á€¯á€„á€ºá€€á€­á€¯ á€–á€á€ºáá€™á€›á€•á€« á€žá€­á€¯á€·á€™á€Ÿá€¯á€á€º á€–á€­á€¯á€„á€ºá€•á€¯á€¶á€…á€¶ á€•á€»á€€á€ºá€…á€®á€¸á€”á€±á€•á€«á€žá€Šá€ºá‹\ná€¡á€™á€¾á€¬á€¸:" + err.message);
    }
  };
  reader.readAsText(file);
}

// â”€â”€ Manual Sync Action â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function triggerManualSync() {
  if (serverWriteInFlight || serverSaveTimer) return;
  const btn = document.getElementById('manualSyncBtn');
  const icon = document.getElementById('manualSyncIcon');
  if (btn && icon) {
    btn.disabled = true;
    icon.classList.add('fa-spin');
  }
  try {
    const remote = await apiRequest('state', { method: 'GET' });
    if (remote.exists && remote.version > serverStateVersion) {
      serverStateVersion = remote.version;
      serverReady = true;
      applyServerState(remote.state);
    }
    alert("Action completed.");
  } catch (error) {
    console.error('Manual sync failed:', error);
    alert("Action completed.");
  } finally {
    if (btn && icon) {
      btn.disabled = false;
      icon.classList.remove('fa-spin');
    }
  }
}

// â”€â”€ Display Local IP helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function displayLocalIpAddress(localIp) {
  if (localIp) cachedLocalIp = localIp; // cache for re-use after renderSettingsPane()
  
  const infoBar = document.getElementById('localIpInfoBar');
  const display = document.getElementById('localIpAddressDisplay');
  const settingsDisplay = document.getElementById('settingsLocalIpDisplay');

  const ip = cachedLocalIp;
  if (ip && ip !== '127.0.0.1') {
    const url = `http://${ip}:3000`;
    if (display) { display.textContent = url; }
    if (infoBar) { infoBar.style.display = 'flex'; }
    if (settingsDisplay) {
      settingsDisplay.textContent = url;
      settingsDisplay.style.color = 'var(--accent-primary)';
    }
  } else {
    if (infoBar) { infoBar.style.display = 'none'; }
    if (settingsDisplay) {
      settingsDisplay.textContent = 'Local Server á€™á€–á€½á€„á€·á€ºá€›á€žá€±á€¸ (PC Desktop App á€€á€­á€¯á€–á€½á€„á€·á€ºá€•á€«)';
      settingsDisplay.style.color = 'var(--text-muted)';
    }
  }
}

// â”€â”€ Cloud Credentials Auto-System â”€â”€

// â”€â”€ Cloud Sync Auto-System â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DEFAULT_CLOUD_URL = 'https://pos.stechmm.com/api/index.php';

function getCloudSettings() {
  // Use URL in settings, or DEFAULT
  const cloudUrl = (state.settings && state.settings.serverApiUrl && state.settings.serverApiUrl.trim()) || DEFAULT_CLOUD_URL;
  
  // Find current user's PIN/Password from database automatically
  const currentUsername = (state.currentUser && state.currentUser.username) || '';
  const usersList = Array.isArray(state.users) ? state.users : [];
  const matched = usersList.find(u => u && u.username === currentUsername);
  const password = matched ? matched.password : '';

  return {
    cloudUrl,
    username: currentUsername,
    password: String(password || '')
  };
}

// â”€â”€ Auto-Cloud Download (1-Click) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function triggerCloudDownload() {
  if (!state.currentUser) {
    alert("Action completed.");
    return;
  }

  const { cloudUrl, username, password } = getCloudSettings();
  
  if (!password) {
    const pin = prompt("Cloud á€žá€­á€¯á€· á€á€»á€­á€á€ºá€†á€€á€ºá€›á€”á€º á€žá€„á€ºá PIN/Password á€€á€­á€¯ á€›á€­á€¯á€€á€ºá€‘á€Šá€·á€ºá€•á€«:");
    if (!pin) return;
    await _executeCloudDownload(cloudUrl, username, pin.trim());
  } else {
    await _executeCloudDownload(cloudUrl, username, password);
  }
}

async function _executeCloudDownload(cloudUrl, username, password) {
  const btn = document.getElementById('cloudDownloadBtn');
  const icon = document.getElementById('cloudDownloadIcon');
  const text = document.getElementById('cloudDownloadText');

  if (!confirm("Are you sure?")) return;

  if (btn && icon && text) {
    btn.disabled = true;
    icon.className = 'fa-solid fa-spinner fa-spin';
    text.textContent = 'Cloud á€™á€¾ á€†á€½á€²á€šá€°á€”á€±á€žá€Šá€º...';
  }

  try {
    console.log('[Cloud Download] Connecting to:', cloudUrl);
    const proxyRes = await fetch(`api/cloud-download?_=${Date.now()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ cloudUrl, username, password })
    });
    const proxyData = await proxyRes.json();

    if (!proxyRes.ok) {
      throw new Error(proxyData.error || `Request failed (${proxyRes.status})`);
    }

    const cloudState = proxyData.state;
    if (!cloudState) {
      alert("Action completed.");
      return;
    }

    // Write to local server
    const localRes = await fetch(`api/index.php?action=state&_=${Date.now()}`, { credentials: 'include' });
    let localVersion = 0;
    if (localRes.ok) {
      const ld = await localRes.json().catch(() => ({}));
      localVersion = ld.version || 0;
    }

    const putRes = await fetch(`api/index.php?action=state&_=${Date.now()}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': serverCsrfToken },
      body: JSON.stringify({ state: cloudState, baseVersion: localVersion })
    });

    if (!putRes.ok) {
      const e = await putRes.json().catch(() => ({}));
      if (putRes.status === 409 && e.version !== undefined) {
        await fetch(`api/index.php?action=state&_=${Date.now()}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': serverCsrfToken },
          body: JSON.stringify({ state: cloudState, baseVersion: e.version })
        });
      } else {
        throw new Error(e.error || `Write failed (${putRes.status})`);
      }
    }

    applyServerState(cloudState);
    alert("Action completed.");

  } catch (err) {
    console.error('[Cloud Download]', err);
    alert(`Cloud Download á€™á€¡á€±á€¬á€„á€ºá€™á€¼á€„á€ºá€•á€«:\ná€¡á€™á€¾á€¬á€¸: ${err.message}`);
  } finally {
    if (btn && icon && text) {
      btn.disabled = false;
      icon.className = 'fa-solid fa-cloud-arrow-down';
      text.textContent = 'Cloud Download';
    }
  }
}

// â”€â”€ Auto-Cloud Upload (1-Click) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function triggerCloudBackup() {
  if (!state.currentUser) {
    alert("Action completed.");
    return;
  }

  const { cloudUrl, username, password } = getCloudSettings();

  if (!password) {
    const pin = prompt("Cloud á€žá€­á€¯á€· á€á€„á€ºá€›á€”á€º á€žá€„á€ºá PIN/Password á€€á€­á€¯ á€›á€­á€¯á€€á€ºá€‘á€Šá€·á€ºá€•á€«:");
    if (!pin) return;
    await _executeCloudUpload(cloudUrl, username, pin.trim());
  } else {
    await _executeCloudUpload(cloudUrl, username, password);
  }
}

async function _executeCloudUpload(cloudUrl, username, password) {
  const btn = document.getElementById('cloudSyncBtn');
  const icon = document.getElementById('cloudSyncIcon');
  const text = document.getElementById('cloudSyncText');

  if (btn && icon && text) {
    btn.disabled = true;
    icon.className = 'fa-solid fa-spinner fa-spin';
    text.textContent = 'Cloud á€žá€­á€¯á€· á€á€„á€ºá€”á€±á€žá€Šá€º...';
  }

  try {
    // 1. Authenticate with cloud
    const proxyRes = await fetch(`api/cloud-download?_=${Date.now()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ cloudUrl, username, password, testOnly: true })
    });
    const proxyData = await proxyRes.json();

    if (!proxyRes.ok) {
      throw new Error(proxyData.error || `Cloud login failed (${proxyRes.status})`);
    }

    // 2. Upload state to cloud
    const uploadRes = await fetch(`api/cloud-upload?_=${Date.now()}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cloudUrl, username, password, state: sharedServerState() })
    });
    const uploadData = await uploadRes.json();

    if (!uploadRes.ok) {
      throw new Error(uploadData.error || `Upload failed (${uploadRes.status})`);
    }

    alert("Action completed.");

  } catch (err) {
    console.error('[Cloud Upload]', err);
    alert(`Cloud Upload á€™á€¡á€±á€¬á€„á€ºá€™á€¼á€„á€ºá€•á€«:\ná€¡á€™á€¾á€¬á€¸: ${err.message}`);
  } finally {
    if (btn && icon && text) {
      btn.disabled = false;
      icon.className = 'fa-solid fa-cloud-arrow-up';
      text.textContent = 'Cloud Upload';
    }
  }
}

// â”€â”€ Expenses Selection & Bulk Actions Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function toggleExpenseActionsDropdown(event) {
  event.stopPropagation();
  const dropdown = document.getElementById('expenseActionsDropdown');
  if (!dropdown) return;
  const isVisible = dropdown.style.display === 'block';
  dropdown.style.display = isVisible ? 'none' : 'block';
}

// Close dropdown on click outside
document.addEventListener('click', () => {
  const dropdown = document.getElementById('expenseActionsDropdown');
  if (dropdown) dropdown.style.display = 'none';
});

function toggleSelectAllExpenses(master) {
  const checkboxes = document.querySelectorAll('.expense-row-checkbox');
  checkboxes.forEach(cb => cb.checked = master.checked);
  updateExpenseSelectionState();
}

function updateExpenseSelectionState() {
  const checkboxes = document.querySelectorAll('.expense-row-checkbox');
  const checkedCount = document.querySelectorAll('.expense-row-checkbox:checked').length;
  
  const btn = document.getElementById('expenseActionsBtn');
  if (btn) {
    btn.disabled = checkedCount === 0;
    if (checkedCount > 0) {
      btn.style.background = 'var(--accent-brand-blue)';
      btn.style.borderColor = 'var(--accent-brand-blue)';
      btn.style.color = '#fff';
    } else {
      btn.style.background = 'rgba(255,255,255,0.05)';
      btn.style.borderColor = 'var(--panel-border)';
      btn.style.color = 'var(--text-secondary)';
    }
  }
  
  const master = document.getElementById('selectAllExpenses');
  if (master && checkboxes.length > 0) {
    master.checked = checkedCount === checkboxes.length;
    master.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
  }
}

async function deleteSelectedExpenses() {
  const checkboxes = document.querySelectorAll('.expense-row-checkbox:checked');
  if (checkboxes.length === 0) return;
  
  if (confirm(`Delete ${checkboxes.length} selected expense record(s)?`)) {
    const idsToDelete = Array.from(checkboxes).map(cb => cb.value);
    state.marketExpenses
      .filter(e => idsToDelete.includes(e.id))
      .forEach(exp => reverseExpenseInventoryLink(exp));
    state.marketExpenses = state.marketExpenses.filter(e => !idsToDelete.includes(e.id));
    saveState();
    
    const master = document.getElementById('selectAllExpenses');
    if (master) master.checked = false;
    
    renderMarketPane();
    alert("Action completed.");
  }
}

// â”€â”€ Background Auto-Cloud Backup Helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let _autoCloudUploadTimeout = null;
async function triggerAutoCloudUpload() {
  // Throttle auto-uploads to avoid spamming the server on rapid keypresses/saves
  clearTimeout(_autoCloudUploadTimeout);
  _autoCloudUploadTimeout = setTimeout(async () => {
    // Only run if credentials exist and we are running inside Electron PC App
    const isElectron = !!(window.chrome && window.chrome.ipcRenderer || navigator.userAgent.indexOf('Electron') > -1);
    if (!isElectron) return;

    const creds = getStoredCloudCredentials();
    if (!creds.password || !creds.url) return;

    try {
      console.log('[Auto Cloud Backup] Syncing to cloud in background...');
      const response = await fetch(`api/cloud-upload?_=${Date.now()}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cloudUrl: creds.url,
          username: creds.username,
          password: creds.password,
          state: sharedServerState()
        })
      });
      if (response.ok) {
        console.log('[Auto Cloud Backup] Upload successful');
      } else {
        console.warn('[Auto Cloud Backup] Upload returned status:', response.status);
      }
    } catch (err) {
      console.warn('[Auto Cloud Backup] Failed to upload:', err.message);
    }
  }, 3000); // 3-second throttle delay
}

// â”€â”€ NEW INVENTORY SYSTEM HELPERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderInventoryPane() {
  const tbody = document.getElementById('inventoryTableBody');
  if (!tbody) return;
  
  const items = state.inventory || [];
  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="inventory-empty-cell">No inventory items yet</td></tr>`;
    return;
  }
  
  tbody.innerHTML = items.map(item => {
    const isLow = item.stock <= (item.minStock || 10);
    const badgeColor = isLow ? 'var(--accent-danger)' : 'var(--accent-success)';
    
    return `
      <tr>
        <td class="inventory-name-cell"><strong>${escapeHtml(item.name)}</strong></td>
        <td class="inventory-stock-cell" style="color:${badgeColor};">${item.stock}</td>
        <td class="inventory-muted-cell">${escapeHtml(item.unit)}</td>
        <td class="inventory-muted-cell">${item.minStock || 10}</td>
        <td class="inventory-actions-cell">
          <button class="inventory-action-btn add" onclick="adjustInventoryStock('${item.id}', 'add')" title="Add stock">
            <i class="fa-solid fa-plus"></i> Add
          </button>
          <button class="inventory-action-btn deduct" onclick="adjustInventoryStock('${item.id}', 'deduct')" title="Deduct stock">
            <i class="fa-solid fa-minus"></i> Use
          </button>
          <button class="inventory-icon-btn" onclick="openEditInventoryModal('${item.id}')" title="Edit">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="inventory-icon-btn danger" onclick="deleteInventoryItem('${item.id}')" title="Delete">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
  
  renderInventoryHistory();
}

function renderInventoryHistory() {
  const list = document.getElementById('inventoryHistoryList');
  if (!list) return;
  
  const txs = state.inventoryTransactions || [];
  if (txs.length === 0) {
    list.innerHTML = `<div class="inventory-history-empty">No stock history yet</div>`;
    return;
  }
  
  list.innerHTML = txs.slice(0, 50).map(tx => {
    const isAdd = tx.type === 'add';
    const icon = isAdd ? 'fa-circle-plus' : 'fa-circle-minus';
    const color = isAdd ? 'var(--accent-success)' : 'var(--accent-danger)';
    const sign = isAdd ? '+' : '-';
    
    // Parse timestamp safely
    let timeStr = '--:--';
    let dateStr = '';
    try {
      const dt = new Date(tx.timestamp);
      timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      dateStr = dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch (e) {}
    
    return `
      <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(255,255,255,0.01); border:1px solid var(--panel-border); border-radius:var(--border-radius-sm); font-size:0.78rem;">
        <div style="display:flex; align-items:center; gap:6px;">
          <i class="fa-solid ${icon}" style="color:${color}; font-size:0.95rem;"></i>
          <div>
            <span style="font-weight:700; color:var(--text-primary); display:block;">${escapeHtml(tx.itemName)}</span>
            <span style="font-size:0.7rem; color:var(--text-muted);">${tx.notes || ''}</span>
          </div>
        </div>
        <div style="text-align:right;">
          <span style="font-weight:900; color:${color}; font-size:0.88rem;">${sign}${tx.qty}</span>
          <span style="font-size:0.65rem; color:var(--text-muted); display:block;">${dateStr} ${timeStr}</span>
        </div>
      </div>
    `;
  }).join('');
}

function openAddInventoryModal() {
  document.getElementById('inventoryItemForm').reset();
  document.getElementById('inventoryItemId').value = '';
  document.getElementById('inventoryModalTitle').textContent = 'Add Inventory Item';
  const overlay = document.getElementById('inventoryItemModalOverlay');
  if (overlay) overlay.classList.add('active');
}

function openEditInventoryModal(id) {
  const item = state.inventory.find(i => i.id === id);
  if (!item) return;
  
  document.getElementById('inventoryItemId').value = item.id;
  document.getElementById('inventoryItemName').value = item.name;
  document.getElementById('inventoryItemStock').value = item.stock;
  document.getElementById('inventoryItemUnit').value = item.unit;
  document.getElementById('inventoryItemMinStock').value = item.minStock || 10;
  
  document.getElementById('inventoryModalTitle').textContent = 'Edit Inventory Item';
  const overlay = document.getElementById('inventoryItemModalOverlay');
  if (overlay) overlay.classList.add('active');
}

function closeInventoryModal() {
  const overlay = document.getElementById('inventoryItemModalOverlay');
  if (overlay) overlay.classList.remove('active');
}

function saveInventoryItem(event) {
  if (event) event.preventDefault();
  
  const id = document.getElementById('inventoryItemId').value;
  const name = document.getElementById('inventoryItemName').value.trim();
  const stock = parseFloat(document.getElementById('inventoryItemStock').value) || 0;
  const unit = document.getElementById('inventoryItemUnit').value.trim();
  const minStock = parseFloat(document.getElementById('inventoryItemMinStock').value) || 10;
  
  if (!name || !unit) {
    alert("Please fill in item name and unit.");
    return;
  }
  
  if (!state.inventory) state.inventory = [];
  if (!state.inventoryTransactions) state.inventoryTransactions = [];
  
  if (id) {
    // Edit
    const item = state.inventory.find(i => i.id === id);
    if (item) {
      const oldStock = item.stock;
      item.name = name;
      item.stock = stock;
      item.unit = unit;
      item.minStock = minStock;
      
      if (oldStock !== stock) {
        const diff = stock - oldStock;
        state.inventoryTransactions.unshift({
          id: generateId('tx'),
          itemId: item.id,
          itemName: item.name,
          qty: Math.abs(diff),
          type: diff > 0 ? 'add' : 'deduct',
          notes: 'Manual Stock Adjustment',
          timestamp: new Date().toISOString()
        });
      }
    }
  } else {
    // Add new
    const newId = generateId('inv');
    const newItem = { id: newId, name, stock, unit, minStock };
    state.inventory.push(newItem);
    
    state.inventoryTransactions.unshift({
      id: generateId('tx'),
      itemId: newId,
      itemName: name,
      qty: stock,
      type: 'add',
      notes: 'Initial Setup',
      timestamp: new Date().toISOString()
    });
  }
  
  saveState();
  closeInventoryModal();
  renderInventoryPane();
  alert("Inventory item saved.");
}

function deleteInventoryItem(id) {
  if (confirm("Delete this inventory item?")) {
    state.inventory = state.inventory.filter(i => i.id !== id);
    saveState();
    renderInventoryPane();
  }
}

function adjustInventoryStock(id, type) {
  const item = state.inventory.find(i => i.id === id);
  if (!item) return;
  
  const label = type === 'add' ? 'add' : 'use';
  const qtyStr = prompt(`Enter quantity to ${label} for "${item.name}":`);
  if (!qtyStr) return;
  
  const qty = parseFloat(qtyStr);
  if (isNaN(qty) || qty <= 0) {
    alert("Please enter a valid quantity.");
    return;
  }
  
  if (type === 'deduct' && qty > item.stock) {
    alert("Quantity is higher than current stock.");
    return;
  }
  
  const noteStr = prompt("Note for stock history (optional):");
  const finalNote = noteStr ? noteStr.trim() : (type === 'add' ? 'Manual Addition' : 'Kitchen/Staff Withdrawal');
  
  if (type === 'add') {
    item.stock += qty;
  } else {
    item.stock = parseFloat((item.stock - qty).toFixed(2));
  }
  
  if (!state.inventoryTransactions) state.inventoryTransactions = [];
  state.inventoryTransactions.unshift({
    id: generateId('tx'),
    itemId: item.id,
    itemName: item.name,
    qty: qty,
    type: type,
    notes: finalNote,
    timestamp: new Date().toISOString()
  });
  
  saveState();
  renderInventoryPane();
}

// â”€â”€ DATABASE RESET FUNCTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function resetDatabaseState() {
  if (!confirm("Are you sure?")) return;
  if (!confirm("Are you sure?")) return;
  
  // Clear transactional tables
  state.orders = [];
  state.salesHistory = [];
  state.marketExpenses = [];
  state.transactionHistory = [];
  state.customers = [];
  state.inventoryTransactions = [];
  
  // Reset register
  state.register = null;
  
  // Reset tables status back to vacant
  if (Array.isArray(state.tables)) {
    state.tables.forEach(t => {
      t.status = 'available';
      t.activeOrderId = null;
      t.currentCart = { items: [] };
    });
  }
  
  // Reset inventory back to setup seeds
  state.inventory = [
    { id: 'inv-1', name: 'Coca Cola', stock: 48, unit: 'pcs', minStock: 10 },
    { id: 'inv-2', name: 'Water', stock: 120, unit: 'bottles', minStock: 20 },
    { id: 'inv-3', name: 'Noodle Pack', stock: 60, unit: 'packs', minStock: 15 },
    { id: 'inv-4', name: 'Eggs', stock: 180, unit: 'pcs', minStock: 30 }
  ];
  
  saveState();
  applyServerState(state);
  alert("Action completed.");
}


// --- RECIPE INGREDIENT ROW CREATOR ---
function addProductIngredientRow(itemId = '', qty = 1) {
  const container = document.getElementById('productRecipeRowsContainer');
  if (!container) return;
  
  const rowId = 'recipe-row-' + Math.random().toString(36).substr(2, 9);
  const selectOptions = (state.inventory || []).map(inv => `
    <option value="${inv.id}" ${inv.id === itemId ? 'selected' : ''}>${escapeHtml(inv.name)} (${escapeHtml(inv.unit)})</option>
  `).join('');
  
  const rowHTML = `
    <div id="${rowId}" style="display: flex; gap: 8px; align-items: center; margin-top: 4px;">
      <select class="form-control recipe-item-select" style="flex: 2; height: 32px; font-size: 0.82rem; cursor: pointer; padding: 4px; border-radius: var(--border-radius-sm); border: 1px solid var(--input-border); background: var(--input-bg); color: var(--text-primary); outline: none;">
        <option value="">-- No Member --</option>
        ${selectOptions}
      </select>
      <input type="number" class="form-control recipe-item-qty" step="any" min="0.01" value="${qty}" style="flex: 1; height: 32px; font-size: 0.82rem; padding: 4px 6px; border-radius: var(--border-radius-sm); border: 1px solid var(--input-border); background: var(--input-bg); color: var(--text-primary); outline: none;" placeholder="Kitchen note...">
      <button type="button" onclick="document.getElementById('${rowId}').remove()" style="padding: 4px 8px; height: 32px; background: var(--accent-danger); border: none; border-radius: 4px; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center;">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </div>
  `;
  container.insertAdjacentHTML('beforeend', rowHTML);
}



