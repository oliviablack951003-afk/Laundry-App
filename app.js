/* ═══════════════════════════════════════════════
   Laundry Manager — app.js
   ═══════════════════════════════════════════════ */

'use strict';

/* ── State ── */
const State = {
  gasUrl:        '',
  employeeName:  '',
  isManager:     false,
  managerPin:    '',
  pricing:       [],   // [{service_key, service_label, unit, base_price, express_multiplier}]
  config:        {},   // {business_name, punch_threshold, punch_reward_description, currency_symbol}
  activePromos:  [],
  lineItems:     [],   // [{id, type, label, unit_price, qty, kg, line_total}]
  expressOn:     false,
  currentCustomer: null, // {phone, name, punch_count, total_orders} or null
  appliedPromo:  null,   // {code, discount_type, discount_value, message} or null
  punchRewardActive: false,
  collectTarget: null,   // {order_id, total}
  currentOrdersFilter: 'active',
  dashRange:     'today',
  currentSearchMode: 'order',
  ironQty:       1,
};

/* ── LocalStorage helpers ── */
const LS = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: k => { try { localStorage.removeItem(k); } catch {} },
};

/* ── Currency ── */
const fmt = v => {
  const sym = State.config.currency_symbol || '$';
  return `${sym}${Number(v).toFixed(2)}`;
};

/* ── API module ── */
const API = {
  async call(action, params = {}, timeoutMs = 15000) {
    if (!State.gasUrl) throw new Error('No GAS URL configured. Go to Settings.');
    const url = new URL(State.gasUrl);
    url.searchParams.set('action', action);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Request timed out. Check your connection.');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  },
};

/* ═══════════════════════════════════════════════
   ROUTER — screen navigation
   ═══════════════════════════════════════════════ */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.hidden = true;
  });
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const screen = document.getElementById(`screen-${name}`);
  if (screen) { screen.classList.add('active'); screen.hidden = false; }

  const navBtn = document.getElementById(`nav-${name}`);
  if (navBtn) navBtn.classList.add('active');

  const refreshBtn = document.getElementById('headerRefresh');
  refreshBtn.hidden = name !== 'orders';

  // Side effects on screen load
  if (name === 'orders')     loadOrders();
  if (name === 'dashboard')  loadDashboard();
  if (name === 'promotions') loadPromotions();
  if (name === 'pricing')    renderPricingTable();
  if (name === 'settings')   renderSettings();
}

/* ── Nav button wiring ── */
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const screen = btn.dataset.screen;
    if (screen) showScreen(screen);
  });
});

/* ── Header refresh ── */
document.getElementById('headerRefresh').addEventListener('click', loadOrders);

/* ═══════════════════════════════════════════════
   SETTINGS SCREEN
   ═══════════════════════════════════════════════ */
function renderSettings() {
  document.getElementById('gasUrl').value = State.gasUrl;
  document.getElementById('settingsEmployeeName').value = State.employeeName;
  updateManagerUI();
}

document.getElementById('testConnectionBtn').addEventListener('click', async () => {
  const url = document.getElementById('gasUrl').value.trim();
  if (!url) { showStatus('err', 'Please enter a URL first.'); return; }
  State.gasUrl = url;
  LS.set('gasUrl', url);
  showStatus('', 'Testing…');
  try {
    const data = await API.call('ping');
    showStatus('ok', `Connected — ${data.business_name || 'Laundry Manager'}`);
    // Update config + pricing after successful connect
    await loadInitialData();
  } catch (e) {
    showStatus('err', e.message);
  }
});

document.getElementById('saveEmployeeBtn').addEventListener('click', () => {
  const name = document.getElementById('settingsEmployeeName').value.trim();
  State.employeeName = name;
  LS.set('employeeName', name);
  document.getElementById('employeeName').value = name;
  alert('Name saved!');
});

document.getElementById('unlockManagerBtn').addEventListener('click', async () => {
  const pin = document.getElementById('managerPin').value.trim();
  const correctPin = State.config.manager_pin || State.managerPin;
  if (!correctPin) {
    // If no PIN in config yet, any 4-digit pin sets it (first-time setup)
    if (pin.length >= 4) {
      activateManager();
    } else {
      document.getElementById('pinError').hidden = false;
    }
    return;
  }
  if (pin === correctPin) {
    activateManager();
    document.getElementById('pinError').hidden = true;
  } else {
    document.getElementById('pinError').hidden = false;
  }
});

document.getElementById('lockManagerBtn').addEventListener('click', deactivateManager);

document.getElementById('clearLocalBtn').addEventListener('click', () => {
  if (confirm('Clear all local data (URL, name, manager session)?')) {
    LS.del('gasUrl'); LS.del('employeeName');
    State.gasUrl = ''; State.employeeName = '';
    State.isManager = false;
    renderSettings();
    deactivateManager();
  }
});

function activateManager() {
  State.isManager = true;
  updateManagerUI();
  showManagerTabs();
  LS.set('isManager', '1');
}

function deactivateManager() {
  State.isManager = false;
  updateManagerUI();
  hideManagerTabs();
  LS.del('isManager');
  // If on a manager screen, go back to new order
  const activeScreen = document.querySelector('.screen.active');
  const managerScreens = ['dashboard', 'promotions', 'pricing'];
  if (activeScreen && managerScreens.some(s => activeScreen.id === `screen-${s}`)) {
    showScreen('new-order');
  }
}

function updateManagerUI() {
  const badge = document.getElementById('managerBadge');
  const unlockSection = document.getElementById('managerUnlockSection');
  const activeSection = document.getElementById('managerActiveSection');
  badge.hidden = !State.isManager;
  unlockSection.hidden = State.isManager;
  activeSection.hidden = !State.isManager;
}

function showManagerTabs() {
  document.querySelectorAll('.manager-tab').forEach(t => t.hidden = false);
}
function hideManagerTabs() {
  document.querySelectorAll('.manager-tab').forEach(t => t.hidden = true);
}

function showStatus(type, msg) {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  dot.className = 'status-dot' + (type === 'ok' ? ' ok' : type === 'err' ? ' err' : '');
  txt.textContent = msg;
}

/* ═══════════════════════════════════════════════
   INITIAL DATA LOAD
   ═══════════════════════════════════════════════ */
async function loadInitialData() {
  try {
    const [configData, pricingData] = await Promise.all([
      API.call('getConfig'),
      API.call('getPricing'),
    ]);
    State.config = configData.config || {};
    State.pricing = pricingData.pricing || [];
    State.managerPin = State.config.manager_pin || '';

    // Update header with business name
    const biz = State.config.business_name;
    if (biz) document.getElementById('headerTitle').textContent = biz;

    populateServiceSelects();
  } catch (e) {
    console.warn('Could not load initial data:', e.message);
  }
}

function populateServiceSelects() {
  // Dry clean items
  const dcSelect = document.getElementById('dcSelect');
  dcSelect.innerHTML = '';
  const dcItems = State.pricing.filter(p => p.service_key.startsWith('dry_clean'));
  dcItems.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.service_key;
    opt.textContent = `${p.service_label} (${fmt(p.base_price)})`;
    dcSelect.appendChild(opt);
  });
  updateDcPreview();

  // Ironing items
  const ironSelect = document.getElementById('ironSelect');
  ironSelect.innerHTML = '';
  const ironItems = State.pricing.filter(p => p.service_key.startsWith('ironing'));
  ironItems.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.service_key;
    opt.textContent = `${p.service_label} (${fmt(p.base_price)})`;
    ironSelect.appendChild(opt);
  });
  updateIronPreview();
}

/* ═══════════════════════════════════════════════
   NEW ORDER SCREEN
   ═══════════════════════════════════════════════ */

/* ── Customer lookup ── */
document.getElementById('lookupCustomerBtn').addEventListener('click', lookupCustomer);
document.getElementById('newOrderPhone').addEventListener('keydown', e => {
  if (e.key === 'Enter') lookupCustomer();
});

async function lookupCustomer() {
  const phone = document.getElementById('newOrderPhone').value.trim().replace(/\D/g, '');
  if (!phone) return;
  try {
    const data = await API.call('searchCustomer', { phone });
    const resultEl = document.getElementById('customerResult');
    const foundEl  = document.getElementById('customerFound');
    const newRow   = document.getElementById('newCustomerRow');
    resultEl.hidden = false;

    if (data.customer) {
      State.currentCustomer = data.customer;
      document.getElementById('customerFoundName').textContent = data.customer.customer_name;
      const punch = data.customer.punch_count || 0;
      const threshold = parseInt(State.config.punch_threshold) || 10;
      const punchBadge = document.getElementById('punchBadge');
      punchBadge.textContent = `${punch}/${threshold} punches`;
      punchBadge.hidden = false;

      // Check if punch reward is due on NEXT order
      State.punchRewardActive = (punch + 1) >= threshold;
      document.getElementById('punchRewardBanner').hidden = !State.punchRewardActive;

      foundEl.hidden = false;
      newRow.hidden  = true;
    } else {
      State.currentCustomer = { phone, customer_name: '', punch_count: 0, total_orders: 0 };
      foundEl.hidden = true;
      newRow.hidden  = false;
      document.getElementById('newCustomerName').value = '';
      document.getElementById('punchRewardBanner').hidden = true;
    }
    validateCreateBtn();
  } catch (e) {
    // Offline or no GAS — allow manual entry
    document.getElementById('customerResult').hidden = false;
    document.getElementById('customerFound').hidden = true;
    document.getElementById('newCustomerRow').hidden = false;
  }
}

/* ── Service type buttons ── */
document.querySelectorAll('.btn-service').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.service;
    // Toggle active
    document.querySelectorAll('.btn-service').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Show correct form
    document.querySelectorAll('.service-form').forEach(f => f.hidden = true);
    document.getElementById(`sf-${type}`).hidden = false;
  });
});

/* ── Wash & Fold ── */
document.getElementById('wfKg').addEventListener('input', updateWfPreview);
function updateWfPreview() {
  const kg = parseFloat(document.getElementById('wfKg').value) || 0;
  const priceItem = State.pricing.find(p => p.service_key === 'wash_fold');
  const unitPrice = priceItem ? parseFloat(priceItem.base_price) : 0;
  document.getElementById('wfPreview').textContent = kg > 0 ? fmt(kg * unitPrice) : '';
}

document.getElementById('addWfBtn').addEventListener('click', () => {
  const kg = parseFloat(document.getElementById('wfKg').value);
  if (!kg || kg <= 0) return;
  const priceItem = State.pricing.find(p => p.service_key === 'wash_fold');
  const unitPrice = priceItem ? parseFloat(priceItem.base_price) : 0;
  addLineItem({ type: 'wash_fold', label: `Wash & Fold (${kg}kg)`, unit_price: unitPrice, qty: 1, kg, line_total: kg * unitPrice });
  document.getElementById('wfKg').value = '';
  updateWfPreview();
});

/* ── Dry Cleaning ── */
document.getElementById('dcSelect').addEventListener('change', updateDcPreview);
function updateDcPreview() {
  const key = document.getElementById('dcSelect').value;
  const p = State.pricing.find(pr => pr.service_key === key);
  document.getElementById('dcPreview').textContent = p ? fmt(p.base_price) : '';
}

document.getElementById('addDcBtn').addEventListener('click', () => {
  const key = document.getElementById('dcSelect').value;
  const p = State.pricing.find(pr => pr.service_key === key);
  if (!p) return;
  addLineItem({ type: 'dry_clean', label: p.service_label, unit_price: parseFloat(p.base_price), qty: 1, kg: 0, line_total: parseFloat(p.base_price) });
});

/* ── Ironing ── */
document.getElementById('ironSelect').addEventListener('change', updateIronPreview);
function updateIronPreview() {
  const key = document.getElementById('ironSelect').value;
  const p = State.pricing.find(pr => pr.service_key === key);
  const qty = State.ironQty;
  document.getElementById('ironPreview').textContent = p ? fmt(parseFloat(p.base_price) * qty) : '';
}

document.getElementById('ironQtyMinus').addEventListener('click', () => {
  if (State.ironQty > 1) { State.ironQty--; document.getElementById('ironQty').textContent = State.ironQty; updateIronPreview(); }
});
document.getElementById('ironQtyPlus').addEventListener('click', () => {
  State.ironQty++; document.getElementById('ironQty').textContent = State.ironQty; updateIronPreview();
});

document.getElementById('addIronBtn').addEventListener('click', () => {
  const key = document.getElementById('ironSelect').value;
  const p = State.pricing.find(pr => pr.service_key === key);
  if (!p) return;
  const qty = State.ironQty;
  addLineItem({ type: 'ironing', label: `${p.service_label} ×${qty}`, unit_price: parseFloat(p.base_price), qty, kg: 0, line_total: parseFloat(p.base_price) * qty });
  State.ironQty = 1; document.getElementById('ironQty').textContent = 1; updateIronPreview();
});

/* ── Line items ── */
function addLineItem(item) {
  item.id = Date.now() + Math.random();
  State.lineItems.push(item);
  renderLineItems();
  updateSummary();
  validateCreateBtn();
}

function renderLineItems() {
  const list = document.getElementById('lineItemsList');
  const wrap = document.getElementById('lineItems');
  if (State.lineItems.length === 0) { wrap.hidden = true; return; }
  wrap.hidden = false;
  list.innerHTML = State.lineItems.map(item => `
    <div class="line-item" data-id="${item.id}">
      <span class="li-label">${item.label}</span>
      <span class="li-price">${fmt(item.line_total)}</span>
      <button class="li-remove btn" onclick="removeLineItem(${item.id})">✕</button>
    </div>
  `).join('');
}

window.removeLineItem = function(id) {
  State.lineItems = State.lineItems.filter(i => i.id !== id);
  renderLineItems();
  updateSummary();
  validateCreateBtn();
};

/* ── Express toggle ── */
document.getElementById('expressToggle').addEventListener('change', e => {
  State.expressOn = e.target.checked;
  const note = document.getElementById('expressNote');
  if (State.expressOn) {
    note.hidden = false;
    note.textContent = 'Express surcharge applied to all items';
  } else {
    note.hidden = true;
  }
  updateSummary();
});

/* ── Promo ── */
document.getElementById('applyPromoBtn').addEventListener('click', applyPromo);
async function applyPromo() {
  const code = document.getElementById('promoInput').value.trim().toUpperCase();
  const result = document.getElementById('promoResult');
  result.hidden = false;
  if (!code) {
    State.appliedPromo = null;
    result.textContent = 'Code cleared.';
    result.className = 'promo-result';
    updateSummary();
    return;
  }
  const subtotal = calcSubtotal();
  try {
    const data = await API.call('applyPromo', {
      code,
      subtotal: subtotal.toFixed(2),
      customer_phone: State.currentCustomer?.phone || '',
    });
    if (data.valid) {
      State.appliedPromo = { code, discount_amount: parseFloat(data.discount_amount), message: data.message };
      result.textContent = `✓ ${data.message}`;
      result.className = 'promo-result ok';
    } else {
      State.appliedPromo = null;
      result.textContent = data.message || 'Invalid code';
      result.className = 'promo-result err';
    }
  } catch {
    // Offline — accept code locally for now
    State.appliedPromo = null;
    result.textContent = 'Could not validate — check connection.';
    result.className = 'promo-result err';
  }
  updateSummary();
}

/* ── Price calculation ── */
function calcSubtotal() {
  return State.lineItems.reduce((sum, item) => sum + item.line_total, 0);
}

function calcExpress() {
  if (!State.expressOn) return 0;
  return State.lineItems.reduce((sum, item) => {
    const p = State.pricing.find(pr => pr.service_key === item.type || pr.service_key.startsWith(item.type.replace('_fold','').replace('dry_clean','dry_clean')));
    const mult = p ? (parseFloat(p.express_multiplier) - 1) : 0.5;
    return sum + item.line_total * mult;
  }, 0);
}

function updateSummary() {
  const subtotal = calcSubtotal();
  const express  = calcExpress();
  const afterExpress = subtotal + express;

  let discount = 0;
  let discountLabel = 'Discount';
  if (State.punchRewardActive && !State.appliedPromo) {
    // Punch reward - apply as free wash reward (fixed amount = wash_fold base price * 3)
    const reward = State.config.punch_reward_description || 'Free reward';
    discountLabel = `Punch reward (${reward})`;
    discount = afterExpress; // entire order free or capped
    discount = Math.min(discount, afterExpress); // can't be more than total
  } else if (State.appliedPromo) {
    discount = Math.min(State.appliedPromo.discount_amount, afterExpress);
    discountLabel = `Discount (${State.appliedPromo.code})`;
  }

  const total = Math.max(0, afterExpress - discount);

  // Render
  const show = (id, val) => {
    document.getElementById(id).hidden = val <= 0;
  };
  show('srSubtotal', subtotal);
  document.getElementById('srSubtotalVal').textContent = fmt(subtotal);
  show('srExpress', express);
  document.getElementById('srExpressVal').textContent = `+${fmt(express)}`;
  show('srDiscount', discount);
  document.getElementById('srDiscountLabel').textContent = discountLabel;
  document.getElementById('srDiscountVal').textContent = `−${fmt(discount)}`;
  document.getElementById('srTotal').textContent = State.lineItems.length > 0 ? fmt(total) : '—';
}

/* ── Validate create button ── */
function validateCreateBtn() {
  const phone  = document.getElementById('newOrderPhone').value.trim();
  const hasItems = State.lineItems.length > 0;
  const hasCustomer = phone.length > 0;
  document.getElementById('createOrderBtn').disabled = !(hasItems && hasCustomer);
}

document.getElementById('newOrderPhone').addEventListener('input', validateCreateBtn);

/* ── Create Order ── */
document.getElementById('createOrderBtn').addEventListener('click', createOrder);
async function createOrder() {
  const phone = document.getElementById('newOrderPhone').value.trim().replace(/\D/g, '');
  let name = '';
  if (State.currentCustomer && State.currentCustomer.customer_name) {
    name = State.currentCustomer.customer_name;
  } else {
    name = document.getElementById('newCustomerName').value.trim();
  }
  if (!name) { showCreateError('Please enter customer name.'); return; }
  if (State.lineItems.length === 0) { showCreateError('Add at least one service.'); return; }

  const employeeName = document.getElementById('employeeName').value.trim() || State.employeeName || 'Staff';
  const subtotal  = calcSubtotal();
  const express   = calcExpress();
  const afterExpress = subtotal + express;
  let discountAmount = 0;
  let discountCode = '';
  if (State.punchRewardActive && !State.appliedPromo) {
    discountAmount = afterExpress;
    discountCode   = 'PUNCH_REWARD';
  } else if (State.appliedPromo) {
    discountAmount = Math.min(State.appliedPromo.discount_amount, afterExpress);
    discountCode   = State.appliedPromo.code;
  }
  const total = Math.max(0, afterExpress - discountAmount);

  const order = {
    customer_name:      name,
    customer_phone:     phone,
    employee_name:      employeeName,
    services_json:      JSON.stringify(State.lineItems.map(i => ({
      type: i.type, label: i.label, unit_price: i.unit_price, qty: i.qty, kg: i.kg, line_total: i.line_total,
    }))),
    subtotal:           subtotal.toFixed(2),
    express_surcharge:  express.toFixed(2),
    discount_code:      discountCode,
    discount_amount:    discountAmount.toFixed(2),
    total:              total.toFixed(2),
    notes:              document.getElementById('orderNotes').value.trim(),
    promo_punch_count:  State.punchRewardActive ? 1 : 0,
  };

  const btn = document.getElementById('createOrderBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    const data = await API.call('createOrder', { order: JSON.stringify(order) });
    showSuccessModal(data.order_id, name, fmt(total));
    resetNewOrder();
  } catch (e) {
    showCreateError(e.message);
    btn.disabled = false;
    btn.textContent = 'Create Order';
  }
}

function showCreateError(msg) {
  const el = document.getElementById('createOrderError');
  el.textContent = msg; el.hidden = false;
  setTimeout(() => el.hidden = true, 4000);
}

function resetNewOrder() {
  State.lineItems = [];
  State.currentCustomer = null;
  State.appliedPromo = null;
  State.punchRewardActive = false;
  State.expressOn = false;
  document.getElementById('newOrderPhone').value = '';
  document.getElementById('customerResult').hidden = true;
  document.getElementById('customerFound').hidden = true;
  document.getElementById('newCustomerRow').hidden = true;
  document.getElementById('punchRewardBanner').hidden = true;
  document.getElementById('expressToggle').checked = false;
  document.getElementById('expressNote').hidden = true;
  document.getElementById('promoInput').value = '';
  document.getElementById('promoResult').hidden = true;
  document.getElementById('orderNotes').value = '';
  document.getElementById('lineItems').hidden = true;
  document.getElementById('lineItemsList').innerHTML = '';
  document.getElementById('createOrderBtn').disabled = true;
  document.getElementById('createOrderBtn').textContent = 'Create Order';
  document.querySelectorAll('.btn-service').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.service-form').forEach(f => f.hidden = true);
  document.getElementById('ironQty').textContent = 1;
  State.ironQty = 1;
  updateSummary();
}

/* ── Success Modal ── */
function showSuccessModal(orderId, customer, total) {
  document.getElementById('successOrderId').textContent = orderId;
  document.getElementById('successCustomer').textContent = customer;
  document.getElementById('successTotal').textContent = total;
  document.getElementById('successModal').style.display = 'flex';
}

document.getElementById('shareOrderBtn').addEventListener('click', () => {
  const orderId = document.getElementById('successOrderId').textContent;
  const customer = document.getElementById('successCustomer').textContent;
  const total = document.getElementById('successTotal').textContent;
  const text = `Order ${orderId} for ${customer} — Total: ${total}`;
  if (navigator.share) {
    navigator.share({ title: 'Laundry Order', text });
  } else {
    navigator.clipboard?.writeText(text).then(() => alert('Copied to clipboard!')).catch(() => alert(text));
  }
});

document.getElementById('newOrderAfterBtn').addEventListener('click', () => {
  document.getElementById('successModal').style.display = 'none';
});

/* ═══════════════════════════════════════════════
   ORDERS SCREEN
   ═══════════════════════════════════════════════ */
async function loadOrders() {
  const loading = document.getElementById('ordersLoading');
  const empty   = document.getElementById('ordersEmpty');
  const list    = document.getElementById('ordersList');
  loading.hidden = false; empty.hidden = true; list.innerHTML = '';

  try {
    const filter = State.currentOrdersFilter;
    const params = {};
    if (filter === 'active') {
      // We'll filter client-side
    } else if (filter !== 'all') {
      params.status = filter;
    }
    const data = await API.call('getOrders', params);
    let orders = data.orders || [];
    if (filter === 'active') {
      orders = orders.filter(o => ['received', 'processing', 'ready'].includes(o.status));
    }
    loading.hidden = true;
    if (orders.length === 0) { empty.hidden = false; return; }
    list.innerHTML = orders.map(renderOrderCard).join('');
    // Expand/collapse
    list.querySelectorAll('.order-card-head').forEach(head => {
      head.addEventListener('click', () => {
        head.closest('.order-card').classList.toggle('expanded');
      });
    });
  } catch (e) {
    loading.hidden = true;
    list.innerHTML = `<p class="error-msg" style="padding:1rem">${e.message}</p>`;
  }
}

function renderOrderCard(o) {
  const services = parseServices(o.services_json);
  const servicesSummary = services.map(s => s.label).join(', ').slice(0, 50);
  const timeAgo = getTimeAgo(o.created_at);
  const statusBadge = `<span class="status-badge status-${o.status}">${o.status}</span>`;
  const actionBtns = renderOrderActions(o);

  return `
  <div class="order-card" data-id="${o.order_id}">
    <div class="order-card-head">
      <span class="order-id">${o.order_id}</span>
      <span class="order-name">${o.customer_name}</span>
      <span class="order-time">${timeAgo}</span>
    </div>
    <div class="order-card-sub">
      ${statusBadge}
      <span class="order-total">${fmt(o.total)}</span>
      <span>${servicesSummary}</span>
    </div>
    <div class="order-detail">
      ${services.map(s => `<div class="order-detail-row"><span>${s.label}</span><span>${fmt(s.line_total)}</span></div>`).join('')}
      ${parseFloat(o.discount_amount) > 0 ? `<div class="order-detail-row" style="color:var(--green)"><span>Discount (${o.discount_code})</span><span>−${fmt(o.discount_amount)}</span></div>` : ''}
      <div class="order-detail-row" style="font-weight:800"><span>Total</span><span>${fmt(o.total)}</span></div>
      <div class="order-detail-row"><span>Phone</span><span>${o.customer_phone}</span></div>
      <div class="order-detail-row"><span>Employee</span><span>${o.employee_name || '—'}</span></div>
      ${o.notes ? `<p class="order-notes">"${o.notes}"</p>` : ''}
      <div class="order-actions">${actionBtns}</div>
    </div>
  </div>`;
}

function renderOrderActions(o) {
  if (o.status === 'received')   return `<button class="btn btn-sm btn-secondary" onclick="updateStatus('${o.order_id}','processing')">▶ Start Processing</button>`;
  if (o.status === 'processing') return `<button class="btn btn-sm btn-secondary" onclick="updateStatus('${o.order_id}','ready')">✓ Mark Ready</button>`;
  if (o.status === 'ready')      return `<button class="btn btn-sm btn-primary" onclick="openCollectModal('${o.order_id}','${o.total}')">📦 Mark Collected</button>`;
  if (o.status === 'collected')  return `<span style="color:var(--text-muted);font-size:.82rem">Collected ${getTimeAgo(o.collected_at)}</span>`;
  return '';
}

window.updateStatus = async function(orderId, status) {
  try {
    await API.call('updateOrderStatus', { order_id: orderId, status, employee: State.employeeName || 'Staff' });
    loadOrders();
  } catch (e) {
    alert('Error: ' + e.message);
  }
};

/* ── Collect Modal ── */
window.openCollectModal = function(orderId, total) {
  State.collectTarget = { order_id: orderId, total };
  document.getElementById('collectOrderId').textContent = orderId;
  document.getElementById('collectModal').style.display = 'flex';
};

// Payment option selection
let selectedPayment = 'cash';
document.querySelectorAll('.btn-payment').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-payment').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedPayment = btn.dataset.pay;
  });
});

document.getElementById('cancelCollectBtn').addEventListener('click', () => {
  document.getElementById('collectModal').style.display = 'none';
});

document.getElementById('confirmCollectBtn').addEventListener('click', async () => {
  if (!State.collectTarget) return;
  try {
    await API.call('collectOrder', {
      order_id: State.collectTarget.order_id,
      payment_method: selectedPayment,
      employee: State.employeeName || 'Staff',
    });
    document.getElementById('collectModal').style.display = 'none';
    loadOrders();
  } catch (e) {
    alert('Error: ' + e.message);
  }
});

/* ── Filter chips ── */
document.querySelectorAll('#filterChips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#filterChips .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    State.currentOrdersFilter = chip.dataset.filter;
    loadOrders();
  });
});

/* ═══════════════════════════════════════════════
   SEARCH SCREEN
   ═══════════════════════════════════════════════ */
document.querySelectorAll('.btn-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-toggle').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    State.currentSearchMode = btn.dataset.search;
    document.getElementById('searchInput').placeholder = State.currentSearchMode === 'order' ? 'Order ID (e.g. ORD-20240101-0001)' : 'Phone number';
    document.getElementById('searchInput').inputMode = State.currentSearchMode === 'phone' ? 'numeric' : 'text';
    document.getElementById('searchResult').innerHTML = '';
  });
});

document.getElementById('searchBtn').addEventListener('click', performSearch);
document.getElementById('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') performSearch(); });

async function performSearch() {
  const val = document.getElementById('searchInput').value.trim();
  const result = document.getElementById('searchResult');
  const err = document.getElementById('searchError');
  err.hidden = true; result.innerHTML = '';
  if (!val) return;

  try {
    if (State.currentSearchMode === 'order') {
      const data = await API.call('getOrder', { order_id: val });
      if (data.order) {
        result.innerHTML = `<div class="orders-list">${renderOrderCard(data.order)}</div>`;
        result.querySelectorAll('.order-card-head').forEach(h => {
          h.addEventListener('click', () => h.closest('.order-card').classList.toggle('expanded'));
        });
      } else {
        err.textContent = 'Order not found.'; err.hidden = false;
      }
    } else {
      const phone = val.replace(/\D/g, '');
      const data = await API.call('searchCustomer', { phone });
      if (data.customer) {
        renderCustomerDetail(data.customer, data.recent_orders || []);
      } else {
        err.textContent = 'Customer not found.'; err.hidden = false;
      }
    }
  } catch (e) {
    err.textContent = e.message; err.hidden = false;
  }
}

function renderCustomerDetail(c, orders) {
  const result = document.getElementById('searchResult');
  const threshold = parseInt(State.config.punch_threshold) || 10;
  const dots = Array.from({ length: threshold }, (_, i) =>
    `<span class="punch-dot ${i < c.punch_count ? 'filled' : ''}"></span>`
  ).join('');

  result.innerHTML = `
    <div class="search-customer-card">
      <p class="search-customer-name">${c.customer_name}</p>
      <p style="color:var(--text-muted);font-size:.85rem;margin-bottom:.75rem">${c.customer_phone}</p>
      <div class="search-customer-stats">
        <div class="search-stat"><strong>${c.total_orders || 0}</strong> Orders</div>
        <div class="search-stat"><strong>${fmt(c.lifetime_spend || 0)}</strong> Lifetime</div>
        <div class="search-stat"><strong>${c.punch_count || 0}/${threshold}</strong> Punches</div>
      </div>
      <div class="punch-dots">${dots}</div>
      ${orders.length > 0 ? `
        <p class="order-history-title" style="margin-top:.75rem">Recent orders</p>
        <div class="orders-list" style="padding:0;gap:.4rem;margin-top:.25rem">
          ${orders.map(o => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:.3rem 0;border-bottom:1px solid var(--grey-border)">
              <span style="font-size:.82rem;font-weight:700;color:var(--blue)">${o.order_id}</span>
              <span class="status-badge status-${o.status}">${o.status}</span>
              <span style="font-weight:700;font-size:.85rem">${fmt(o.total)}</span>
              <span style="font-size:.75rem;color:var(--text-muted)">${getTimeAgo(o.created_at)}</span>
            </div>`).join('')}
        </div>` : ''}
    </div>`;
}

/* ═══════════════════════════════════════════════
   DASHBOARD (MANAGER)
   ═══════════════════════════════════════════════ */
async function loadDashboard() {
  const { from, to } = getDashDateRange();
  document.getElementById('dashLoading').hidden = false;
  document.getElementById('dashContent').style.opacity = '.4';

  try {
    const data = await API.call('getDashboard', { from, to });
    renderDashboard(data);
  } catch (e) {
    alert('Dashboard error: ' + e.message);
  } finally {
    document.getElementById('dashLoading').hidden = true;
    document.getElementById('dashContent').style.opacity = '1';
  }
}

function getDashDateRange() {
  const today = new Date();
  const fmt = d => d.toISOString().slice(0, 10);
  if (State.dashRange === 'today') {
    return { from: fmt(today), to: fmt(today) };
  } else if (State.dashRange === 'week') {
    const mon = new Date(today); mon.setDate(today.getDate() - today.getDay() + 1);
    return { from: fmt(mon), to: fmt(today) };
  } else if (State.dashRange === 'month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: fmt(start), to: fmt(today) };
  } else {
    return {
      from: document.getElementById('dashFrom').value || fmt(today),
      to:   document.getElementById('dashTo').value   || fmt(today),
    };
  }
}

function renderDashboard(data) {
  const sym = State.config.currency_symbol || '$';
  document.getElementById('dashRevenue').textContent = fmt(data.revenue || 0);
  document.getElementById('dashOrders').textContent  = data.order_count || 0;
  document.getElementById('dashAvg').textContent     = fmt(data.revenue && data.order_count ? data.revenue / data.order_count : 0);

  // Service breakdown chart
  const chart = document.getElementById('serviceChart');
  const byService = data.by_service || {};
  const total = Object.values(byService).reduce((a, b) => a + b, 0) || 1;
  const labels = { wash_fold: 'Wash & Fold', dry_clean: 'Dry Clean', ironing: 'Ironing' };
  chart.innerHTML = Object.entries(byService).map(([key, val]) => {
    const pct = Math.round((val / total) * 100);
    return `<div class="chart-row">
      <span class="chart-label">${labels[key] || key}</span>
      <div class="chart-bar-wrap"><div class="chart-bar" style="width:${pct}%"></div></div>
      <span class="chart-val">${fmt(val)} (${pct}%)</span>
    </div>`;
  }).join('') || '<p style="color:var(--text-muted);font-size:.85rem">No data</p>';

  // Top customers
  const tc = document.getElementById('topCustomers');
  const customers = data.top_customers || [];
  tc.innerHTML = customers.length === 0 ? '<p style="color:var(--text-muted);font-size:.85rem">No data</p>' :
    customers.slice(0, 5).map((c, i) => `
      <div class="top-customer-row">
        <span class="tc-rank">${i + 1}</span>
        <div style="flex:1">
          <span class="tc-name">${c.customer_name}</span>
          <span class="tc-phone">&nbsp;${c.customer_phone}</span>
        </div>
        <span class="tc-spend">${fmt(c.total)}</span>
      </div>`).join('');
}

// Date range chips
document.querySelectorAll('.date-range-bar .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.date-range-bar .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    State.dashRange = chip.dataset.range;
    document.getElementById('customDateRow').hidden = State.dashRange !== 'custom';
    if (State.dashRange !== 'custom') loadDashboard();
  });
});
document.getElementById('dashApplyRange').addEventListener('click', loadDashboard);

document.getElementById('exportCsvBtn').addEventListener('click', async () => {
  const { from, to } = getDashDateRange();
  try {
    const data = await API.call('getOrders', { from, to });
    const orders = data.orders || [];
    const rows = [['Order ID', 'Date', 'Customer', 'Phone', 'Services', 'Total', 'Status', 'Payment']];
    orders.forEach(o => rows.push([o.order_id, o.created_at?.slice(0,10), o.customer_name, o.customer_phone, parseServices(o.services_json).map(s => s.label).join('; '), o.total, o.status, o.payment_method]));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    navigator.clipboard?.writeText(csv).then(() => alert('CSV copied to clipboard!'));
  } catch (e) { alert('Export error: ' + e.message); }
});

/* ═══════════════════════════════════════════════
   PROMOTIONS (MANAGER)
   ═══════════════════════════════════════════════ */
async function loadPromotions() {
  try {
    const data = await API.call('getActivePromos');
    State.activePromos = data.promos || [];
    renderPromoCodes();
    renderSeasonalList();
    renderPunchConfig();
  } catch (e) {
    console.warn('Could not load promos:', e.message);
  }
}

function renderPromoCodes() {
  const list = document.getElementById('codesList');
  const codes = State.activePromos.filter(p => p.type === 'code');
  list.innerHTML = codes.length === 0 ? '' : codes.map(p => `
    <div class="promo-item">
      <div class="promo-info">
        <p class="promo-code">${p.code}</p>
        <p class="promo-desc">${p.description || (p.discount_type === 'percent' ? `${p.discount_value}% off` : `${fmt(p.discount_value)} off`)}</p>
        <p class="promo-meta">${p.valid_to ? `Expires ${p.valid_to}` : 'No expiry'} · Used ${p.usage_count || 0}×</p>
      </div>
      <button class="promo-toggle-btn ${p.is_active === 'TRUE' || p.is_active === true ? 'active-btn' : 'inactive-btn'}"
        onclick="togglePromo('${p.promo_id}', ${p.is_active === 'TRUE' || p.is_active === true ? 'false' : 'true'})">
        ${p.is_active === 'TRUE' || p.is_active === true ? 'Active' : 'Inactive'}
      </button>
    </div>`).join('');
}

function renderSeasonalList() {
  const list = document.getElementById('seasonalList');
  const deals = State.activePromos.filter(p => p.type === 'seasonal');
  list.innerHTML = deals.length === 0 ? '' : deals.map(p => `
    <div class="promo-item">
      <div class="promo-info">
        <p class="promo-code">${p.description}</p>
        <p class="promo-desc">${p.discount_type === 'percent' ? `${p.discount_value}%` : fmt(p.discount_value)} off</p>
        <p class="promo-meta">${p.valid_from} → ${p.valid_to}</p>
      </div>
      <button class="promo-toggle-btn ${p.is_active === 'TRUE' || p.is_active === true ? 'active-btn' : 'inactive-btn'}"
        onclick="togglePromo('${p.promo_id}', ${p.is_active === 'TRUE' || p.is_active === true ? 'false' : 'true'})">
        ${p.is_active === 'TRUE' || p.is_active === true ? 'Active' : 'Inactive'}
      </button>
    </div>`).join('');
}

function renderPunchConfig() {
  document.getElementById('punchThresholdInput').value = State.config.punch_threshold || 10;
  document.getElementById('punchRewardInput').value = State.config.punch_reward_description || '';
}

window.togglePromo = async function(promoId, isActive) {
  try {
    await API.call('updatePromo', { promo_id: promoId, is_active: isActive ? 'TRUE' : 'FALSE' });
    loadPromotions();
  } catch (e) { alert('Error: ' + e.message); }
};

// Create discount code
document.getElementById('createCodeBtn').addEventListener('click', async () => {
  const code = document.getElementById('newCodeStr').value.trim().toUpperCase();
  const type = document.querySelector('input[name="newCodeType"]:checked').value;
  const val  = parseFloat(document.getElementById('newCodeValue').value);
  const min  = parseFloat(document.getElementById('newCodeMin').value) || 0;
  const exp  = document.getElementById('newCodeExpiry').value;
  const desc = document.getElementById('newCodeDesc').value.trim();
  const err  = document.getElementById('createCodeError');

  if (!code || !val) { err.textContent = 'Code and value are required.'; err.hidden = false; return; }
  try {
    await API.call('createPromo', {
      promo: JSON.stringify({ type: 'code', code, discount_type: type, discount_value: val, min_order_value: min, valid_to: exp, description: desc }),
    });
    err.hidden = true;
    document.getElementById('newCodeStr').value = '';
    document.getElementById('newCodeValue').value = '';
    document.getElementById('newCodeDesc').value = '';
    loadPromotions();
  } catch (e) { err.textContent = e.message; err.hidden = false; }
});

// Create seasonal deal
document.getElementById('createSeasonBtn').addEventListener('click', async () => {
  const desc = document.getElementById('newSeasonDesc').value.trim();
  const type = document.querySelector('input[name="newSeasonType"]:checked').value;
  const val  = parseFloat(document.getElementById('newSeasonValue').value);
  const min  = parseFloat(document.getElementById('newSeasonMin').value) || 0;
  const from = document.getElementById('newSeasonFrom').value;
  const to   = document.getElementById('newSeasonTo').value;
  const err  = document.getElementById('createSeasonError');

  if (!desc || !val || !from || !to) { err.textContent = 'All fields are required.'; err.hidden = false; return; }
  try {
    await API.call('createPromo', {
      promo: JSON.stringify({ type: 'seasonal', discount_type: type, discount_value: val, min_order_value: min, valid_from: from, valid_to: to, description: desc }),
    });
    err.hidden = true;
    loadPromotions();
  } catch (e) { err.textContent = e.message; err.hidden = false; }
});

// Save punch config
document.getElementById('savePunchBtn').addEventListener('click', async () => {
  const threshold = document.getElementById('punchThresholdInput').value;
  const reward    = document.getElementById('punchRewardInput').value.trim();
  try {
    await API.call('updateConfig', { key: 'punch_threshold', value: threshold });
    await API.call('updateConfig', { key: 'punch_reward_description', value: reward });
    State.config.punch_threshold = threshold;
    State.config.punch_reward_description = reward;
    document.getElementById('punchSaveSuccess').hidden = false;
    setTimeout(() => document.getElementById('punchSaveSuccess').hidden = true, 3000);
  } catch (e) { alert('Error: ' + e.message); }
});

// Check customer punches
document.getElementById('checkPunchBtn').addEventListener('click', async () => {
  const phone = document.getElementById('punchPhoneInput').value.trim().replace(/\D/g, '');
  const result = document.getElementById('punchCustomerResult');
  if (!phone) return;
  try {
    const data = await API.call('searchCustomer', { phone });
    if (data.customer) {
      const c = data.customer;
      const threshold = parseInt(State.config.punch_threshold) || 10;
      const dots = Array.from({ length: threshold }, (_, i) =>
        `<span class="punch-dot ${i < c.punch_count ? 'filled' : ''}"></span>`).join('');
      result.innerHTML = `<div class="punch-result-card">
        <strong>${c.customer_name}</strong> — ${c.punch_count}/${threshold} punches
        <div class="punch-dots">${dots}</div>
      </div>`;
    } else {
      result.innerHTML = '<p class="error-msg">Customer not found.</p>';
    }
  } catch (e) { result.innerHTML = `<p class="error-msg">${e.message}</p>`; }
});

// Promo sub-tabs
document.querySelectorAll('.promo-tabs .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.promo-tabs .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    document.querySelectorAll('.promo-panel').forEach(p => { p.hidden = true; p.classList.remove('active'); });
    const panel = document.getElementById(`promo-${chip.dataset.promoTab}`);
    if (panel) { panel.hidden = false; panel.classList.add('active'); }
  });
});

/* ═══════════════════════════════════════════════
   PRICING (MANAGER)
   ═══════════════════════════════════════════════ */
function renderPricingTable() {
  const table = document.getElementById('pricingTable');
  if (State.pricing.length === 0) {
    table.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">No pricing data. Check connection.</p>';
    return;
  }
  table.innerHTML = State.pricing.map(p => `
    <div class="pricing-row" data-key="${p.service_key}">
      <span class="pricing-label">${p.service_label}</span>
      <span class="pricing-unit">${p.unit === 'per_kg' ? '/kg' : '/item'}</span>
      <span class="pricing-price" id="price-${p.service_key}">${fmt(p.base_price)}</span>
      <button class="pricing-edit-btn btn" onclick="editPrice('${p.service_key}', ${p.base_price})">Edit</button>
    </div>`).join('');
}

window.editPrice = function(key, currentPrice) {
  const row = document.querySelector(`.pricing-row[data-key="${key}"]`);
  if (!row) return;
  const priceEl = row.querySelector('.pricing-price');
  const editBtn = row.querySelector('.pricing-edit-btn');
  priceEl.innerHTML = `<div class="pricing-inline-form">
    <input class="pricing-inline-input" id="price-input-${key}" type="number" min="0" step="0.01" value="${currentPrice}">
    <button class="pricing-save-btn btn" onclick="savePrice('${key}')">Save</button>
  </div>`;
  editBtn.hidden = true;
  document.getElementById(`price-input-${key}`)?.focus();
};

window.savePrice = async function(key) {
  const input = document.getElementById(`price-input-${key}`);
  const newPrice = parseFloat(input?.value);
  if (!newPrice || newPrice <= 0) return;
  try {
    await API.call('updatePricing', { service_key: key, base_price: newPrice.toFixed(2) });
    const item = State.pricing.find(p => p.service_key === key);
    if (item) item.base_price = newPrice;
    renderPricingTable();
  } catch (e) { alert('Error: ' + e.message); }
};

document.getElementById('refreshPricingBtn').addEventListener('click', async () => {
  try {
    const data = await API.call('getPricing');
    State.pricing = data.pricing || [];
    populateServiceSelects();
    renderPricingTable();
  } catch (e) { alert('Error: ' + e.message); }
});

/* ═══════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════ */
function parseServices(json) {
  try { return JSON.parse(json) || []; } catch { return []; }
}

function getTimeAgo(isoStr) {
  if (!isoStr) return '—';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ── Offline detection ── */
window.addEventListener('online',  () => document.getElementById('offlineBar').hidden = true);
window.addEventListener('offline', () => document.getElementById('offlineBar').hidden = false);
if (!navigator.onLine) document.getElementById('offlineBar').hidden = false;

/* ═══════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════ */
(async function init() {
  // Restore from localStorage
  State.gasUrl       = LS.get('gasUrl') || '';
  State.employeeName = LS.get('employeeName') || '';
  const wasManager   = LS.get('isManager') === '1';

  // Pre-fill employee name in new order form
  document.getElementById('employeeName').value = State.employeeName;

  // Show first screen
  showScreen('new-order');

  // Load data if URL is configured
  if (State.gasUrl) {
    showStatus('', 'Connecting…');
    try {
      const data = await API.call('ping');
      showStatus('ok', `Connected — ${data.business_name || 'Laundry Manager'}`);
      if (data.business_name) document.getElementById('headerTitle').textContent = data.business_name;
      await loadInitialData();
      if (wasManager) activateManager();
    } catch (e) {
      showStatus('err', 'Could not connect — check URL in Settings');
    }
  }
})();
