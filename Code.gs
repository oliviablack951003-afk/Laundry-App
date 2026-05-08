/* ═══════════════════════════════════════════════
   Laundry Manager — Google Apps Script (Code.gs)
   ─────────────────────────────────────────────
   HOW TO SET UP:
   1. Go to script.google.com → New project
   2. Paste this entire file, replacing any existing code
   3. Change SHEET_ID below to your Google Sheet's ID
      (the long string in the sheet URL between /d/ and /edit)
   4. Save → Deploy → New deployment
      - Type: Web app
      - Execute as: Me
      - Who has access: Anyone
   5. Copy the Web App URL → paste into the app's Settings screen
   ═══════════════════════════════════════════════ */

// ── CONFIGURATION ─────────────────────────────
const SHEET_ID = '1xiWkSqaJRuud8IEvBP7ArP2_MCjg5pyGeD_lkFBc7yU';

// Sheet tab names
const SHEETS = {
  ORDERS:     'Orders',
  CUSTOMERS:  'Customers',
  PROMOTIONS: 'Promotions',
  PRICING:    'Pricing',
  CONFIG:     'Config',
};

// ── ENTRY POINT ───────────────────────────────
function doGet(e) {
  try {
    const action = (e.parameter && e.parameter.action) ? e.parameter.action : 'ping';
    let result;
    switch (action) {
      case 'ping':             result = ping();                       break;
      case 'getConfig':        result = getConfig();                  break;
      case 'updateConfig':     result = updateConfig(e.parameter);    break;
      case 'getPricing':       result = getPricing();                 break;
      case 'updatePricing':    result = updatePricing(e.parameter);   break;
      case 'getActivePromos':  result = getActivePromos();            break;
      case 'createPromo':      result = createPromo(e.parameter);     break;
      case 'updatePromo':      result = updatePromo(e.parameter);     break;
      case 'applyPromo':       result = applyPromo(e.parameter);      break;
      case 'createOrder':      result = createOrder(e.parameter);     break;
      case 'updateOrderStatus':result = updateOrderStatus(e.parameter); break;
      case 'collectOrder':     result = collectOrder(e.parameter);    break;
      case 'getOrders':        result = getOrders(e.parameter);       break;
      case 'getOrder':         result = getOrder(e.parameter);        break;
      case 'searchCustomer':   result = searchCustomer(e.parameter);  break;
      case 'getDashboard':     result = getDashboard(e.parameter);    break;
      default:                 result = { error: 'Unknown action: ' + action };
    }
    return respond(result);
  } catch (err) {
    return respond({ error: err.message });
  }
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── HELPER: get sheet ─────────────────────────
function getSheet(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    initSheet(sheet, name);
  }
  return sheet;
}

function initSheet(sheet, name) {
  const headers = {
    [SHEETS.ORDERS]:     ['order_id','created_at','updated_at','employee_name','customer_name','customer_phone','status','services_json','subtotal','discount_code','discount_amount','express_surcharge','total','promo_punch_count','notes','payment_method','collected_at'],
    [SHEETS.CUSTOMERS]:  ['customer_phone','customer_name','first_order_date','last_order_date','total_orders','punch_count','lifetime_spend'],
    [SHEETS.PROMOTIONS]: ['promo_id','type','code','discount_type','discount_value','min_order_value','valid_from','valid_to','punch_threshold','is_active','description','usage_count'],
    [SHEETS.PRICING]:    ['service_key','service_label','unit','base_price','express_multiplier'],
    [SHEETS.CONFIG]:     ['key','value'],
  };
  if (headers[name]) sheet.appendRow(headers[name]);
  // Seed default data
  if (name === SHEETS.CONFIG) seedConfig(sheet);
  if (name === SHEETS.PRICING) seedPricing(sheet);
}

function seedConfig(sheet) {
  const defaults = [
    ['business_name',            'My Laundry'],
    ['manager_pin',              '1234'],
    ['punch_threshold',          '10'],
    ['punch_reward_description', 'Free 3kg Wash & Fold'],
    ['currency_symbol',          '$'],
  ];
  defaults.forEach(row => sheet.appendRow(row));
}

function seedPricing(sheet) {
  const prices = [
    ['wash_fold',           'Wash & Fold',         'per_kg',   8.00,  1.5],
    ['dry_clean_shirt',     'Shirt (Dry Clean)',    'per_item', 12.00, 1.5],
    ['dry_clean_suit',      'Suit (Dry Clean)',     'per_item', 25.00, 1.5],
    ['dry_clean_dress',     'Dress (Dry Clean)',    'per_item', 20.00, 1.5],
    ['dry_clean_jacket',    'Jacket (Dry Clean)',   'per_item', 18.00, 1.5],
    ['dry_clean_trousers',  'Trousers (Dry Clean)', 'per_item', 12.00, 1.5],
    ['ironing_shirt',       'Shirt (Ironing)',      'per_item',  2.50, 1.5],
    ['ironing_trousers',    'Trousers (Ironing)',   'per_item',  3.00, 1.5],
    ['ironing_dress',       'Dress (Ironing)',      'per_item',  4.00, 1.5],
    ['ironing_jacket',      'Jacket (Ironing)',     'per_item',  4.00, 1.5],
    ['ironing_bedsheet',    'Bed Sheet (Ironing)',  'per_item',  5.00, 1.5],
  ];
  prices.forEach(row => sheet.appendRow(row));
}

// ── HELPER: rows to objects ───────────────────
function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row =>
    Object.fromEntries(headers.map((h, i) => [h, row[i]]))
  );
}

// ── Generate unique order ID ──────────────────
function generateOrderId() {
  const now  = new Date();
  const date = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd');
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `ORD-${date}-${rand}`;
}

// ── Generate unique promo ID ──────────────────
function generatePromoId() {
  return 'PRO-' + Date.now().toString(36).toUpperCase();
}

// ══════════════════════════════════════════════
// ACTIONS
// ══════════════════════════════════════════════

function ping() {
  const config = getConfig().config;
  return { ok: true, business_name: config.business_name || 'Laundry Manager' };
}

// ── Config ─────────────────────────────────────
function getConfig() {
  const sheet = getSheet(SHEETS.CONFIG);
  const rows  = sheetToObjects(sheet);
  const config = {};
  rows.forEach(r => { config[r.key] = r.value; });
  return { config };
}

function updateConfig(params) {
  const sheet = getSheet(SHEETS.CONFIG);
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === params.key) {
      sheet.getRange(i + 1, 2).setValue(params.value);
      return { ok: true };
    }
  }
  // Not found — append
  sheet.appendRow([params.key, params.value]);
  return { ok: true };
}

// ── Pricing ────────────────────────────────────
function getPricing() {
  const sheet   = getSheet(SHEETS.PRICING);
  const pricing = sheetToObjects(sheet);
  return { pricing };
}

function updatePricing(params) {
  const sheet = getSheet(SHEETS.PRICING);
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === params.service_key) {
      sheet.getRange(i + 1, 4).setValue(parseFloat(params.base_price));
      return { ok: true };
    }
  }
  return { error: 'Service key not found: ' + params.service_key };
}

// ── Promotions ─────────────────────────────────
function getActivePromos() {
  const sheet  = getSheet(SHEETS.PROMOTIONS);
  const promos = sheetToObjects(sheet);
  return { promos };
}

function createPromo(params) {
  const sheet = getSheet(SHEETS.PROMOTIONS);
  const p     = JSON.parse(params.promo);
  const id    = generatePromoId();
  const now   = new Date().toISOString();
  sheet.appendRow([
    id, p.type || 'code', p.code || '', p.discount_type, p.discount_value,
    p.min_order_value || 0, p.valid_from || '', p.valid_to || '',
    p.punch_threshold || '', 'TRUE', p.description || '', 0,
  ]);
  return { ok: true, promo_id: id };
}

function updatePromo(params) {
  const sheet = getSheet(SHEETS.PROMOTIONS);
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === params.promo_id) {
      sheet.getRange(i + 1, 10).setValue(params.is_active);
      return { ok: true };
    }
  }
  return { error: 'Promo not found' };
}

function applyPromo(params) {
  const code     = (params.code || '').toUpperCase().trim();
  const subtotal = parseFloat(params.subtotal) || 0;
  const phone    = params.customer_phone || '';
  const now      = new Date();

  const sheet  = getSheet(SHEETS.PROMOTIONS);
  const promos = sheetToObjects(sheet);

  // 1. Discount code
  const promo = promos.find(p =>
    p.type === 'code' &&
    String(p.code).toUpperCase() === code &&
    (p.is_active === 'TRUE' || p.is_active === true)
  );

  if (promo) {
    if (subtotal < parseFloat(promo.min_order_value || 0)) {
      return { valid: false, message: `Minimum order ${promo.min_order_value} required.` };
    }
    if (promo.valid_to && new Date(promo.valid_to) < now) {
      return { valid: false, message: 'This code has expired.' };
    }
    const discount = promo.discount_type === 'percent'
      ? subtotal * (parseFloat(promo.discount_value) / 100)
      : parseFloat(promo.discount_value);
    return { valid: true, discount_amount: discount.toFixed(2), message: `${promo.description || promo.code} applied!` };
  }

  // 2. Seasonal (auto-apply)
  const seasonal = promos.find(p =>
    p.type === 'seasonal' &&
    (p.is_active === 'TRUE' || p.is_active === true) &&
    (!p.valid_from || new Date(p.valid_from) <= now) &&
    (!p.valid_to   || new Date(p.valid_to)   >= now)
  );
  if (seasonal && !code) {
    const discount = seasonal.discount_type === 'percent'
      ? subtotal * (parseFloat(seasonal.discount_value) / 100)
      : parseFloat(seasonal.discount_value);
    return { valid: true, discount_amount: discount.toFixed(2), message: `${seasonal.description} deal applied!` };
  }

  return { valid: false, message: 'Code not found or inactive.' };
}

// ── Orders ─────────────────────────────────────
function createOrder(params) {
  const sheet = getSheet(SHEETS.ORDERS);
  const o     = JSON.parse(params.order);
  const id    = generateOrderId();
  const now   = new Date().toISOString();

  sheet.appendRow([
    id, now, now,
    o.employee_name, o.customer_name, o.customer_phone,
    'received', o.services_json,
    parseFloat(o.subtotal || 0),
    o.discount_code || '',
    parseFloat(o.discount_amount || 0),
    parseFloat(o.express_surcharge || 0),
    parseFloat(o.total || 0),
    parseInt(o.promo_punch_count || 0),
    o.notes || '',
    'pending', '',
  ]);

  // Upsert customer record
  upsertCustomer(o.customer_phone, o.customer_name, parseFloat(o.total || 0), parseInt(o.promo_punch_count || 0));

  return { ok: true, order_id: id };
}

function upsertCustomer(phone, name, total, punchEarned) {
  const sheet = getSheet(SHEETS.CUSTOMERS);
  const data  = sheet.getDataRange().getValues();
  const now   = new Date().toISOString();
  const config = getConfig().config;
  const threshold = parseInt(config.punch_threshold) || 10;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(phone)) {
      // Update existing
      let punch = parseInt(data[i][5]) + (punchEarned ? 1 : 0);
      if (punch >= threshold) punch = 0; // reset after reward
      sheet.getRange(i + 1, 2).setValue(name);
      sheet.getRange(i + 1, 4).setValue(now);
      sheet.getRange(i + 1, 5).setValue(parseInt(data[i][4]) + 1);
      sheet.getRange(i + 1, 6).setValue(punch);
      sheet.getRange(i + 1, 7).setValue(parseFloat(data[i][6]) + total);
      return;
    }
  }
  // New customer
  sheet.appendRow([phone, name, now, now, 1, punchEarned ? 1 : 0, total]);
}

function updateOrderStatus(params) {
  const sheet = getSheet(SHEETS.ORDERS);
  const data  = sheet.getDataRange().getValues();
  const now   = new Date().toISOString();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === params.order_id) {
      sheet.getRange(i + 1, 7).setValue(params.status);
      sheet.getRange(i + 1, 3).setValue(now);
      return { ok: true };
    }
  }
  return { error: 'Order not found' };
}

function collectOrder(params) {
  const sheet = getSheet(SHEETS.ORDERS);
  const data  = sheet.getDataRange().getValues();
  const now   = new Date().toISOString();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === params.order_id) {
      if (data[i][6] === 'collected') return { error: 'Order already collected' };
      sheet.getRange(i + 1, 7).setValue('collected');
      sheet.getRange(i + 1, 3).setValue(now);
      sheet.getRange(i + 1, 16).setValue(params.payment_method);
      sheet.getRange(i + 1, 17).setValue(now);
      return { ok: true };
    }
  }
  return { error: 'Order not found' };
}

function getOrders(params) {
  const sheet  = getSheet(SHEETS.ORDERS);
  const all    = sheetToObjects(sheet);
  let orders   = all;

  if (params.status) {
    orders = orders.filter(o => o.status === params.status);
  }
  if (params.date) {
    orders = orders.filter(o => String(o.created_at).startsWith(params.date));
  }
  if (params.from && params.to) {
    const from = new Date(params.from);
    const to   = new Date(params.to); to.setHours(23, 59, 59);
    orders = orders.filter(o => {
      const d = new Date(o.created_at);
      return d >= from && d <= to;
    });
  }

  // Sort newest first
  orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { orders };
}

function getOrder(params) {
  const sheet  = getSheet(SHEETS.ORDERS);
  const orders = sheetToObjects(sheet);
  const order  = orders.find(o => o.order_id === params.order_id) || null;
  return { order };
}

// ── Customers ──────────────────────────────────
function searchCustomer(params) {
  const sheet     = getSheet(SHEETS.CUSTOMERS);
  const customers = sheetToObjects(sheet);
  const customer  = customers.find(c => String(c.customer_phone) === String(params.phone)) || null;

  let recent_orders = [];
  if (customer) {
    const orderSheet  = getSheet(SHEETS.ORDERS);
    const allOrders   = sheetToObjects(orderSheet);
    recent_orders = allOrders
      .filter(o => String(o.customer_phone) === String(params.phone))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10);
  }

  return { customer, recent_orders };
}

// ── Dashboard ──────────────────────────────────
function getDashboard(params) {
  const sheet   = getSheet(SHEETS.ORDERS);
  const all     = sheetToObjects(sheet);
  const from    = params.from ? new Date(params.from) : new Date();
  const to      = params.to ? new Date(params.to) : new Date();
  to.setHours(23, 59, 59);

  const orders = all.filter(o => {
    if (o.status !== 'collected') return false;
    const d = new Date(o.collected_at || o.created_at);
    return d >= from && d <= to;
  });

  const revenue     = orders.reduce((s, o) => s + parseFloat(o.total || 0), 0);
  const order_count = orders.length;

  // Service breakdown (by revenue from services_json)
  const by_service = { wash_fold: 0, dry_clean: 0, ironing: 0 };
  orders.forEach(o => {
    try {
      const items = JSON.parse(o.services_json || '[]');
      items.forEach(item => {
        const t = item.type || '';
        if (t === 'wash_fold')        by_service.wash_fold += parseFloat(item.line_total || 0);
        else if (t === 'dry_clean')   by_service.dry_clean += parseFloat(item.line_total || 0);
        else if (t === 'ironing')     by_service.ironing   += parseFloat(item.line_total || 0);
      });
    } catch {}
  });

  // Top customers
  const custMap = {};
  orders.forEach(o => {
    const key = o.customer_phone;
    if (!custMap[key]) custMap[key] = { customer_name: o.customer_name, customer_phone: key, total: 0 };
    custMap[key].total += parseFloat(o.total || 0);
  });
  const top_customers = Object.values(custMap)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return { revenue, order_count, by_service, top_customers };
}
