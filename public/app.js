/* ============================================================
   No.5 Cafe POS — app.js
   Single-barista optimized POS frontend logic
   ============================================================ */

'use strict';

// ── Global state ──────────────────────────────────────────────
let state = {
  products: [],
  cart: [],
  features: {},
  categories: [],
  inventory: [],
  channels: [],
  recipesData: [],
  selectedCategory: 'all',
  selectedStockCategory: 'all'
};
let adminPin = '';
let currentMember = null;
let checkoutPayload = null;
let currentEditRecipeItems = [];

// ── Utilities ─────────────────────────────────────────────────
const $ = s => document.querySelector(s);
const money = n => `฿${Number(n || 0).toFixed(2)}`;

function showNotice(msg, type = 'success') {
  const el = $('#notice');
  if (!el) return;
  el.textContent = msg;
  el.className = type;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.textContent = ''; el.className = ''; }, 4000);
}

async function api(url, opts = {}) {
  if (window.useFirebaseStore) return window.firebaseApi(url, opts);
  const headers = { 'Content-Type': 'application/json' };
  if (adminPin) headers['x-admin-pin'] = adminPin;
  const res = await fetch(url, { headers, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Bootstrap / Load ─────────────────────────────────────────
async function load() {
  const savedCart = state.cart;
  const savedCategory = state.selectedCategory;
  const savedStockCat = state.selectedStockCategory;

  try {
    const boot = await api('/api/bootstrap');
    state.products = boot.products || [];
    state.features = boot.features || {};
    state.categories = boot.categories || [];
    state.inventory = boot.inventory || [];
    state.channels = boot.channels || [];
    state.cart = savedCart;
    state.selectedCategory = savedCategory;
    state.selectedStockCategory = savedStockCat;

    // Fetch recipes only if feature enabled (fallback to empty on 403)
    try {
      state.recipesData = await api('/api/recipes');
    } catch {
      state.recipesData = [];
    }

    applyFeatureState();
    renderProducts();
    renderCart();

    const todayStats = await api('/api/reports/today');
    const salesEl = $('#sales');
    const ordersEl = $('#orders');
    if (salesEl) salesEl.textContent = money(todayStats.sales);
    if (ordersEl) ordersEl.textContent = todayStats.orders;

    await renderQuickBrewQueue();
  } catch (e) {
    showNotice(e.message, 'error');
  }
}

// ── Feature / layout state ────────────────────────────────────
function applyFeatureState() {
  renderTopMenu();
  // Modules strip
  let strip = $('#active-modules');
  if (!strip) {
    strip = document.createElement('div');
    strip.id = 'active-modules';
    strip.className = 'modules-strip';
    const ws = document.querySelector('.workspace');
    if (ws) ws.before(strip);
  }
  strip.replaceChildren();

  const featureLabels = { kds: '☕ คิวชง', inventory: '⚙️ ตั้งค่าร้าน', members: '👤 สมาชิก', recipes: '📖 สูตรชง', reports: '📊 รายงาน' };
  Object.entries(state.features).filter(([, on]) => on).forEach(([key]) => {
    const b = document.createElement('button');
    b.className = 'module-tab';
    b.textContent = featureLabels[key] || key;
    b.onclick = () => openModule(key);
    strip.append(b);
  });
  if (!strip.childElementCount) strip.style.display = 'none';
  else strip.style.display = '';

  // Quick brew sidebar
  const sidebar = $('#quick-brew-sidebar');
  const ws = document.querySelector('.workspace');
  if (sidebar && ws) {
    const kdsOn = !!state.features.kds;
    sidebar.style.display = 'none';
    ws.style.gridTemplateColumns = 'minmax(0,3fr) minmax(340px,2fr)';
  }

  // Reports button visibility
  const repBtn = $('#reportsBtn');
  if (repBtn) repBtn.style.display = state.features.reports ? 'flex' : 'none';

  // Members section
  const memberSec = document.querySelector('.member-section');
  if (memberSec) memberSec.style.display = state.features.members ? 'block' : 'none';
}

function renderTopMenu() {
  const list = $('#top-menu-list');
  if (!list) return;
  const items = [
    ['pos', '🛒 หน้าขาย'], ['kds', '☕ คิวชง / Kitchen View'], ['products', '🍕 จัดการเมนูและสูตร'],
    ['inventory', '📦 สต็อกและต้นทุน'], ['pricing', '💰 ราคาออนไลน์ / GP'], ['members', '👤 สมาชิก'], ['reports', '📊 รายงาน']
  ];
  list.replaceChildren(...items.filter(([key]) => key === 'pos' || state.features[key] !== false).map(([key,label]) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.onclick = () => { $('.top-menu')?.classList.remove('open'); $('#top-menu-toggle')?.setAttribute('aria-expanded','false'); openModule(key); };
    return button;
  }));
}

function openAdminWindow(tab, title) {
  document.querySelectorAll('.admin-tab-panel').forEach(panel => panel.classList.remove('active-panel'));
  const panel = $('#' + tab);
  if (panel) panel.classList.add('active-panel');
  const heading = document.querySelector('#settings header h2');
  if (heading) heading.textContent = title;
  if (window.useFirebaseStore) {
    const auth = $('#auth'); const admin = $('#admin');
    if (auth) auth.hidden = true;
    if (admin) admin.hidden = false;
    adminLoad().catch(e => showNotice(e.message, 'error'));
  }
  $('#settings')?.showModal();
}

function openModule(key) {
  if (key === 'pos') { window.scrollTo({top:0,behavior:'smooth'}); return; }
  if (key === 'reports') { const rb = $('#reportsBtn'); rb && rb.click(); return; }
  if (key === 'kds') { openKdsMode(); return; }
  if (key === 'inventory' || key === 'members' || key === 'recipes' || key === 'products' || key === 'pricing') {
    const tab = key === 'products' || key === 'recipes' ? 'tab-products' : key === 'pricing' ? 'tab-pricing' : key === 'members' ? 'tab-members' : 'tab-inventory';
    const title = key === 'products' || key === 'recipes' ? 'จัดการเมนูและสูตรชง' : key === 'pricing' ? 'ราคาออนไลน์และต้นทุน' : key === 'members' ? 'ระบบสมาชิก' : 'สต็อกวัตถุดิบ';
    openAdminWindow(tab, title);
    if (key === 'members') renderAdminMembers();
  }
}

// ── Products catalog ──────────────────────────────────────────
function getFilteredProducts() {
  const q = ($('#search')?.value || '').toLowerCase();
  const cat = state.selectedCategory;
  return state.products.filter(p =>
    (cat === 'all' || p.category === cat) && p.name.toLowerCase().includes(q)
  );
}

function renderCategoryTabs() {
  const container = $('#category-tabs');
  if (!container) return;
  const all = [{ category_key: 'all', name: '🏠 ทุกหมวด' }, ...state.categories];
  container.replaceChildren(...all.map(c => {
    const btn = document.createElement('button');
    btn.className = 'category-tab-btn' + (state.selectedCategory === c.category_key ? ' active' : '');
    btn.textContent = c.name;
    btn.type = 'button';
    btn.onclick = () => { state.selectedCategory = c.category_key; renderProducts(); };
    return btn;
  }));
}

function getStockStatus(product) {
  const recipe = state.recipesData.find(r => r.id === product.id);
  let isOut = false, isLow = false;

  if (recipe && recipe.items && recipe.items.length) {
    for (const ri of recipe.items) {
      const stock = state.inventory.find(x => x.stock_key === ri.stock_key);
      if (!stock) continue;
      if (stock.quantity <= 0) isOut = true;
      else if (stock.quantity <= stock.low_alert) isLow = true;
    }
  } else if (product.stock_key) {
    const stock = state.inventory.find(x => x.stock_key === product.stock_key);
    if (stock) {
      if (stock.quantity <= 0) isOut = true;
      else if (stock.quantity <= stock.low_alert) isLow = true;
    }
  }
  return isOut ? 'out' : isLow ? 'low' : 'ok';
}

let modifierProduct = null;
let modifierOptions = { temperature: 'iced', sweetness: 100, milk: 'fresh', toppings: [] };
function modifierExtra(options) { return (options.milk === 'oat' ? 15 : options.milk === 'soy' ? 10 : 0) + (options.toppings.includes('extraShot') ? 15 : 0) + (options.toppings.includes('whippedCream') ? 10 : 0); }
function modifierSummary(options) { const labels={hot:'ร้อน',iced:'เย็น',blended:'ปั่น',fresh:'นมสด',oat:'นมโอ๊ต',soy:'นมถั่วเหลือง',extraShot:'เพิ่มช็อต',whippedCream:'วิปครีม'}; return [labels[options.temperature],`หวาน ${options.sweetness}%`,labels[options.milk],...options.toppings.map(x=>labels[x])].join(' · '); }
function openModifierModal(product) { modifierProduct=product; modifierOptions={temperature:'iced',sweetness:100,milk:'fresh',toppings:[]}; $('#modifier-title').textContent=`${product.emoji} ${product.name}`; renderModifierModal(); $('#modifier-dialog')?.showModal(); }
function renderModifierModal() { const root=$('#modifier-options'); if(!root || !modifierProduct) return; root.replaceChildren(); const groups=[['temperature','ประเภท',[['hot','ร้อน'],['iced','เย็น'],['blended','ปั่น']]],['sweetness','ระดับความหวาน',[[0,'0%'],[50,'50%'],[100,'100%']]],['milk','ชนิดนม',[['fresh','นมสด'],['oat','นมโอ๊ต +15'],['soy','นมถั่วเหลือง +10']]]]; groups.forEach(([key,label,values])=>{const sec=document.createElement('section');sec.className='modifier-group';const h=document.createElement('h3');h.textContent=label;const row=document.createElement('div');row.className='modifier-choice-row';values.forEach(([value,text])=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.className=String(modifierOptions[key])===String(value)?'selected':'';b.onclick=()=>{modifierOptions[key]=value;renderModifierModal();};row.append(b);});sec.append(h,row);root.append(sec);});const sec=document.createElement('section');sec.className='modifier-group';const h=document.createElement('h3');h.textContent='ท็อปปิ้งเพิ่ม';const row=document.createElement('div');row.className='modifier-choice-row';[['extraShot','เพิ่มช็อต +15'],['whippedCream','วิปครีม +10']].forEach(([value,text])=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.className=modifierOptions.toppings.includes(value)?'selected':'';b.onclick=()=>{modifierOptions.toppings=modifierOptions.toppings.includes(value)?modifierOptions.toppings.filter(x=>x!==value):[...modifierOptions.toppings,value];renderModifierModal();};row.append(b);});sec.append(h,row);root.append(sec);$('#modifier-price').textContent=money(modifierProduct.price+modifierExtra(modifierOptions)); }
function confirmModifier() { if(!modifierProduct) return; addToCart(modifierProduct,{...modifierOptions,toppings:[...modifierOptions.toppings]}); $('#modifier-dialog')?.close(); }

function renderProducts() {
  renderCategoryTabs();
  const items = getFilteredProducts();
  const countEl = $('#product-count');
  if (countEl) countEl.textContent = `${items.length} เมนู`;
  const root = $('#products');
  if (!root) return;
  root.replaceChildren();

  if (items.length === 0) {
    root.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">ไม่พบสินค้าในหมวดหมู่นี้</div>';
    return;
  }

  items.forEach(p => {
    const wrapper = document.createElement('div');
    wrapper.className = 'product-card-wrapper';
    const status = getStockStatus(p);

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'product' + (status === 'out' ? ' product-out' : '');
    card.disabled = status === 'out';

    const emoji = document.createElement('span');
    emoji.textContent = p.emoji;
    const name = document.createElement('b');
    name.textContent = p.name;
    const price = document.createElement('small');
    price.textContent = money(p.price);
    card.append(emoji, name, price);

    if (status === 'low') {
      const badge = document.createElement('span');
      badge.className = 'stock-badge low';
      badge.textContent = 'ใกล้หมด';
      card.append(badge);
    }
    if (status === 'out') {
      const badge = document.createElement('span');
      badge.className = 'stock-badge empty';
      badge.textContent = 'หมด';
      card.append(badge);
    }

    let pressTimer, longPressed = false;
    card.onclick = () => { if (longPressed) { longPressed = false; return; } openModifierModal(p); };
    card.onpointerdown = () => { longPressed = false; pressTimer = setTimeout(() => { pressTimer = null; longPressed = true; showRecipePopover(p); }, 600); };
    ['pointerup','pointerleave','pointercancel'].forEach(event => card.addEventListener(event, () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; }));

    const recipeBtn = document.createElement('button');
    recipeBtn.type = 'button';
    recipeBtn.className = 'quick-recipe-btn';
    recipeBtn.title = 'ดูสูตรชง';
    recipeBtn.textContent = '📖';
    recipeBtn.onclick = e => { e.stopPropagation(); showRecipePopover(p); };

    wrapper.append(card, recipeBtn);
    root.append(wrapper);
  });
}

// ── Recipe popover ────────────────────────────────────────────
function showRecipePopover(product) {
  const pop = $('#recipe-popover');
  if (!pop) return;
  const recipe = state.recipesData.find(r => r.id === product.id);
  const titleEl = $('#recipe-pop-title');
  const itemsEl = $('#recipe-pop-items');
  const descEl = $('#recipe-pop-description');
  if (titleEl) titleEl.textContent = `${product.emoji} สูตรชง: ${product.name}`;

  if (itemsEl) {
    if (recipe && recipe.items && recipe.items.length) {
      itemsEl.innerHTML = recipe.items.map(x =>
        `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f1ebe5;">
          <span>• ${x.name}</span>
          <span style="font-weight:700;color:var(--primary)">${x.quantity} ${x.unit}</span>
        </div>`
      ).join('');
    } else {
      itemsEl.innerHTML = '<span style="color:#aaa;font-style:italic;">ยังไม่ได้ตั้งวัตถุดิบในสูตรชง</span>';
    }
  }
  if (descEl) {
    descEl.textContent = recipe?.description || 'ยังไม่ได้ระบุขั้นตอนการชง';
  }
  pop.showModal();
}

// ── Cart ───────────────────────────────────────────────────────
function canAddToCart(product, deltaQty = 1) {
  const recipe = state.recipesData.find(r => r.id === product.id);
  const currentQty = state.cart.filter(x => x.product.id === product.id).reduce((sum, x) => sum + x.qty, 0);
  const newQty = currentQty + deltaQty;

  if (recipe && recipe.items && recipe.items.length) {
    for (const ri of recipe.items) {
      const stock = state.inventory.find(s => s.stock_key === ri.stock_key);
      if (stock && newQty * ri.quantity > stock.quantity) {
        return { ok: false, msg: `สต็อก "${stock.name}" ไม่เพียงพอ (มี ${stock.quantity} ${stock.unit})` };
      }
    }
  } else if (product.stock_key) {
    const stock = state.inventory.find(s => s.stock_key === product.stock_key);
    if (stock && newQty > stock.quantity) {
      return { ok: false, msg: `สต็อก "${stock.name}" ไม่เพียงพอ` };
    }
  }
  return { ok: true };
}

function addToCart(product, options = { temperature:'iced', sweetness:100, milk:'fresh', toppings:[] }) {
  const check = canAddToCart(product, 1);
  if (!check.ok) return showNotice(check.msg, 'error');
  const key = `${product.id}:${JSON.stringify(options)}`;
  const existing = state.cart.find(x => x.key === key);
  if (existing) existing.qty++;
  else state.cart.push({ product, options, unitPrice: product.price + modifierExtra(options), key, qty: 1 });
  renderCart();
  const badge = $('#count');
  if (badge) { badge.classList.remove('pulse'); void badge.offsetWidth; badge.classList.add('pulse'); }
}

function renderCart() {
  const root = $('#cart');
  if (!root) return;
  root.replaceChildren();

  if (state.cart.length === 0) {
    root.innerHTML = '<div class="empty-state">เลือกรายการจากเมนูด้านซ้าย</div>';
  } else {
    state.cart.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'line';

      const info = document.createElement('span');
      info.textContent = `${item.product.name} — ${modifierSummary(item.options || {temperature:'iced',sweetness:100,milk:'fresh',toppings:[]})}`;

      const minus = document.createElement('button');
      minus.textContent = '−';
      minus.onclick = () => {
        if (--item.qty <= 0) state.cart.splice(idx, 1);
        renderCart();
      };

      const qtySpan = document.createElement('span');
      qtySpan.style.cssText = 'min-width:48px;text-align:center;font-weight:700;';
      qtySpan.textContent = `×${item.qty}`;

      const plus = document.createElement('button');
      plus.textContent = '+';
      plus.onclick = () => {
        const check = canAddToCart(item.product, 1);
        if (!check.ok) return showNotice(check.msg, 'error');
        item.qty++;
        renderCart();
      };

      const priceSpan = document.createElement('span');
      priceSpan.style.cssText = 'min-width:64px;text-align:right;font-weight:600;color:var(--primary);';
      priceSpan.textContent = money((item.unitPrice || item.product.price) * item.qty);

      row.append(info, minus, qtySpan, plus, priceSpan);
      root.append(row);
    });
  }

  // Update total
  const subtotal = state.cart.reduce((s, x) => s + (x.unitPrice || x.product.price) * x.qty, 0);
  
  let memberDiscount = 0;
  const useFreeCupEl = $('#member-use-free-cup');
  if (useFreeCupEl && useFreeCupEl.checked && currentMember && currentMember.points >= 10) {
    const beverages = state.cart.filter(x => x.product.category !== 'bakery');
    if (beverages.length > 0) {
      const cheapest = beverages.reduce((min, x) => (x.unitPrice || x.product.price) < (min.unitPrice || min.product.price) ? x : min, beverages[0]);
      memberDiscount = cheapest.unitPrice || cheapest.product.price;
    } else {
      useFreeCupEl.checked = false;
      showNotice('ต้องมีเครื่องดื่มในตะกร้าอย่างน้อย 1 แก้ว เพื่อใช้สิทธิ์', 'error');
    }
  }

  const manualDisc = Math.min(Number($('#discount')?.value) || 0, subtotal - memberDiscount);
  const disc = memberDiscount + manualDisc;
  const total = subtotal - disc;
  const totalEl = $('#total');
  if (totalEl) {
    if (memberDiscount > 0) {
      totalEl.innerHTML = `${money(total)} <small style="font-size:11px;color:#27ae60;display:block;">(รวมส่วนลดแลกฟรี -${money(memberDiscount)})</small>`;
    } else {
      totalEl.textContent = money(total);
    }
  }
  const countEl = $('#count');
  if (countEl) countEl.textContent = state.cart.reduce((s, x) => s + x.qty, 0);
}

// ── Member lookup ─────────────────────────────────────────────
async function searchMember() {
  const phone = ($('#member-phone')?.value || '').replace(/\D/g, '');
  const info = $('#member-info');
  const regBtn = $('#register-member-btn');
  const redeemRow = $('#member-redeem-row');
  const useFreeCupEl = $('#member-use-free-cup');
  
  currentMember = null;
  if (redeemRow) redeemRow.style.display = 'none';
  if (useFreeCupEl) useFreeCupEl.checked = false;
  
  if (phone.length < 9) {
    if (info) { info.textContent = ''; info.className = 'member-info'; }
    if (regBtn) regBtn.style.display = 'none';
    renderCart();
    return;
  }
  try {
    const member = await api(`/api/members/${phone}`);
    if (info) { info.textContent = `✓ ${member.name} (สะสม ${member.points} แก้ว)`; info.className = 'member-info success'; }
    if (regBtn) regBtn.style.display = 'none';
    currentMember = member;
    if (member.points >= 10) {
      if (redeemRow) redeemRow.style.display = 'flex';
    }
    renderCart();
  } catch {
    if (info) { info.textContent = '❌ ไม่พบสมาชิก'; info.className = 'member-info error'; }
    if (regBtn) regBtn.style.display = 'inline-block';
    renderCart();
  }
}

$('#member-phone') && ($('#member-phone').oninput = searchMember);
$('#member-use-free-cup') && ($('#member-use-free-cup').onchange = () => renderCart());

const regMemberBtn = $('#register-member-btn');
if (regMemberBtn) {
  regMemberBtn.onclick = async () => {
    const phone = ($('#member-phone')?.value || '').replace(/\D/g, '');
    if (!phone) return;
    try {
      await api('/api/members', { method: 'POST', body: JSON.stringify({ phone, name: `ลูกค้า (${phone.slice(-4)})` }) });
      showNotice('สมัครสมาชิกด่วนสำเร็จ!');
      await searchMember();
    } catch (e) { showNotice(e.message, 'error'); }
  };
}

// ── Checkout ──────────────────────────────────────────────────
async function checkout() {
  if (!state.cart.length) return showNotice('เพิ่มสินค้าในตะกร้าก่อนครับ', 'error');
  const subtotal = state.cart.reduce((s, x) => s + (x.unitPrice || x.product.price) * x.qty, 0);
  
  // Calculate member discount
  let memberDiscount = 0;
  const useFreeCupEl = $('#member-use-free-cup');
  if (useFreeCupEl && useFreeCupEl.checked && currentMember && currentMember.points >= 10) {
    const beverages = state.cart.filter(x => x.product.category !== 'bakery');
    if (beverages.length > 0) {
      const cheapest = beverages.reduce((min, x) => (x.unitPrice || x.product.price) < (min.unitPrice || min.product.price) ? x : min, beverages[0]);
      memberDiscount = cheapest.unitPrice || cheapest.product.price;
    }
  }

  const manualDisc = Math.min(Number($('#discount')?.value) || 0, subtotal - memberDiscount);
  const disc = memberDiscount + manualDisc;
  const total = subtotal - disc;
  const payType = $('#payment')?.value || 'cash';
  const redeemFreeCup = memberDiscount > 0;

  checkoutPayload = {
    items: state.cart.map(x => ({ productId: x.product.id, quantity: x.qty, options: x.options })),
    discount: disc,
    paymentType: payType,
    memberPhone: currentMember?.phone || null,
    received: total,
    changeDue: 0,
    redeemFreeCup: redeemFreeCup
  };

  if (payType === 'cash') {
    const billEl = $('#calc-total-bill');
    if (billEl) billEl.textContent = money(total);
    const inp = $('#calc-received-input');
    if (inp) inp.value = '';
    const changeEl = $('#calc-change-amount');
    if (changeEl) { changeEl.textContent = money(0); changeEl.style.color = '#27ae60'; }
    $('#checkout-calc-dialog')?.showModal();
  } else {
    await finalizeCheckout();
  }
}

async function finalizeCheckout() {
  if (!checkoutPayload) return;
  try {
    const order = await api('/api/orders', { method: 'POST', body: JSON.stringify(checkoutPayload) });
    state.cart = [];
    if ($('#discount')) $('#discount').value = 0;
    if ($('#member-phone')) $('#member-phone').value = '';
    currentMember = null;
    checkoutPayload = null;
    
    // Hide redeem free cup row
    const redeemRow = $('#member-redeem-row');
    if (redeemRow) redeemRow.style.display = 'none';
    const useFreeCupEl = $('#member-use-free-cup');
    if (useFreeCupEl) useFreeCupEl.checked = false;

    await load();
    showReceipt(order);
  } catch (e) {
    showNotice(e.message, 'error');
  }
}

// ── E-Receipt display ─────────────────────────────────────────
function showReceipt(order) {
  const dlg = $('#receipt-dialog');
  if (!dlg) return;

  const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  set('#receipt-date', `วันที่: ${new Date(order.createdAt || order.created_at).toLocaleString('th-TH')}`);
  set('#receipt-tx', `บิล: ${order.id}`);

  const itemsEl = $('#receipt-items');
  if (itemsEl) {
    const items = order.items || [];
    if (items.length) {
      itemsEl.innerHTML = items.map(x =>
        `<div style="display:flex;justify-content:space-between;margin-bottom:3px;">
          <span>${x.name} ×${x.quantity}</span>
          <span>${money(x.unit_price * x.quantity)}</span>
        </div>`
      ).join('');
    } else {
      itemsEl.innerHTML = '<p style="margin:0;color:#888;font-size:10px;">ไม่พบรายละเอียดสินค้า</p>';
    }
  }

  set('#receipt-subtotal', money(order.subtotal));
  set('#receipt-discount', money(order.discount));
  set('#receipt-total', money(order.total));
  set('#receipt-payment', order.paymentType === 'cash' ? 'เงินสด 💵' : 'สแกน QR 📱');

  const cashRows = ['#receipt-cash-received-row', '#receipt-cash-change-row'];
  cashRows.forEach(s => { const el = $(s); if (el) el.style.display = order.paymentType === 'cash' ? 'flex' : 'none'; });
  if (order.paymentType === 'cash') {
    set('#receipt-received', money(order.received));
    set('#receipt-change', money(order.changeDue ?? order.change_due));
  }

  const mRow = $('#receipt-member-row');
  if (mRow) {
    if (order.memberPhone) {
      mRow.style.display = 'flex';
      const ptEl = mRow.querySelector('span:last-child') || $('#receipt-member-points');
      if (ptEl) ptEl.textContent = `สะสม ${order.memberPoints || 0} แก้ว (${order.memberPhone})`;
    } else {
      mRow.style.display = 'none';
    }
  }

  dlg.showModal();
}

// ── Cash calculator logic ────────────────────────────────────
function updateCalcChange() {
  const subtotal = state.cart.reduce((s, x) => s + (x.unitPrice || x.product.price) * x.qty, 0);
  const disc = Math.min(Number($('#discount')?.value) || 0, subtotal);
  const total = subtotal - disc;
  const received = Number($('#calc-received-input')?.value) || 0;
  const change = received - total;
  const el = $('#calc-change-amount');
  if (!el) return;
  if (received === 0) { el.textContent = money(0); el.style.color = '#27ae60'; }
  else if (change < 0) { el.textContent = 'ยอดไม่พอ'; el.style.color = '#c0392b'; }
  else { el.textContent = money(change); el.style.color = '#27ae60'; }
}

const calcInput = $('#calc-received-input');
if (calcInput) calcInput.oninput = updateCalcChange;

document.querySelectorAll('.quick-cash-btn').forEach(btn => {
  btn.onclick = async () => {
    const subtotal = state.cart.reduce((s, x) => s + (x.unitPrice || x.product.price) * x.qty, 0);
    const disc = Math.min(Number($('#discount')?.value) || 0, subtotal);
    const total = subtotal - disc;
    const val = btn.getAttribute('data-value');
    const received = val === 'exact' ? Math.ceil(total) : Number(val);
    if ($('#calc-received-input')) $('#calc-received-input').value = received;
    updateCalcChange();
    // Selecting a denomination only previews the change. The cashier must
    // explicitly confirm before the order is saved and a receipt is shown.
  };
});

const calcSubmitBtn = $('#calc-submit-btn');
if (calcSubmitBtn) {
  calcSubmitBtn.onclick = async () => {
    const subtotal = state.cart.reduce((s, x) => s + (x.unitPrice || x.product.price) * x.qty, 0);
    const disc = Math.min(Number($('#discount')?.value) || 0, subtotal);
    const total = subtotal - disc;
    const received = Number($('#calc-received-input')?.value) || 0;
    if (received < total) return alert('ยอดเงินไม่เพียงพอ กรุณารับเงินให้ครบ');
    if (checkoutPayload) { checkoutPayload.received = received; checkoutPayload.changeDue = received - total; }
    $('#checkout-calc-dialog')?.close();
    await finalizeCheckout();
  };
}

const calcCloseBtns = document.querySelectorAll('#checkout-calc-dialog .close');
calcCloseBtns.forEach(b => { b.onclick = () => { $('#checkout-calc-dialog')?.close(); checkoutPayload = null; }; });

// ── Quick brew queue (KDS sidebar) ───────────────────────────
async function renderQuickBrewQueue() {
  const container = $('#quick-brew-list');
  if (!container) return;
  if (!state.features.kds) { container.innerHTML = '<div class="empty-state">เปิดฟังก์ชันคิวชงในตั้งค่าเพื่อใช้งาน</div>'; return; }

  try {
    const rows = await api('/api/kds');
    const pending = rows.filter(x => x.status !== 'completed');
    if (!pending.length) { container.innerHTML = '<div class="empty-state">ไม่มีรายการค้างชง ✓</div>'; return; }
    container.replaceChildren(...pending.map(x => buildBrewCard(x)));
  } catch {
    container.innerHTML = '<div class="empty-state">ไม่สามารถโหลดคิวชงได้</div>';
  }
}

function buildBrewCard(x) {
  const isCooking = x.status === 'cooking';
  const card = document.createElement('div');
  card.className = 'brew-card';

  const title = document.createElement('div');
  title.style.cssText = 'font-weight:700;font-size:13px;margin-bottom:2px;';
  title.textContent = `${x.name} × ${x.quantity}`;

  const meta = document.createElement('div');
  meta.style.cssText = 'font-size:10px;color:#999;margin-bottom:4px;';
  meta.textContent = `บิล ${x.order_id} · ${new Date(x.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;

  const recipeLink = document.createElement('button');
  recipeLink.type = 'button';
  recipeLink.style.cssText = 'background:none;border:none;padding:0;color:var(--accent);font-size:11px;cursor:pointer;font-family:inherit;text-decoration:underline;margin-bottom:6px;';
  recipeLink.textContent = '📖 ดูสูตรชง';
  recipeLink.onclick = () => {
    const prod = state.products.find(p => p.name === x.name);
    if (prod) showRecipePopover(prod);
  };

  const actionBtn = document.createElement('button');
  actionBtn.type = 'button';
  actionBtn.style.cssText = `border:0;color:#fff;background:${isCooking ? '#27ae60' : '#8c6d58'};border-radius:6px;padding:5px 12px;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;width:100%;`;
  actionBtn.textContent = isCooking ? '✓ เสร็จสิ้น' : '▶ เริ่มชง';
  actionBtn.onclick = async () => {
    try {
      await api(`/api/kds/items/${x.id}/status`, { method: 'PUT', body: JSON.stringify({ status: isCooking ? 'completed' : 'cooking' }) });
      await renderQuickBrewQueue();
    } catch (e) { showNotice(e.message, 'error'); }
  };

  card.append(title, meta, recipeLink, actionBtn);
  return card;
}

// ── Reports dialog ────────────────────────────────────────────
const reportsBtn = $('#reportsBtn');
if (reportsBtn) {
  reportsBtn.onclick = async () => {
    if (!state.features.reports) return;
    try {
      const [analytics, transactions] = await Promise.all([
        api('/api/reports/analytics'),
        api('/api/reports/transactions')
      ]);

      const totalSales = transactions.reduce((s, o) => s + o.total, 0);
      const totalBills = transactions.length;
      const avgBill = totalBills ? totalSales / totalBills : 0;

      const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
      set('#rep-total-sales', money(totalSales));
      set('#rep-total-orders', `${totalBills} บิล`);
      set('#rep-avg-bill', money(avgBill));

      // Category bar chart
      const catEl = $('#rep-category-sales-list');
      if (catEl) {
        catEl.replaceChildren();
        if (!analytics.categorySales.length) {
          catEl.innerHTML = '<p style="color:#aaa;font-size:12px;">ยังไม่มีข้อมูล</p>';
        } else {
          const max = Math.max(...analytics.categorySales.map(x => x.sales), 1);
          const catNames = { coffee: '☕ กาแฟ', tea: '🧋 ชาและนม', bakery: '🥐 เบเกอรี่', other: '⭐ อื่นๆ' };
          analytics.categorySales.forEach(x => {
            const pct = (x.sales / max) * 100;
            const item = document.createElement('div');
            item.style.cssText = 'font-size:12px;margin-bottom:8px;';
            item.innerHTML = `
              <div style="display:flex;justify-content:space-between;font-weight:600;margin-bottom:3px;">
                <span>${catNames[x.category] || x.category}</span>
                <span>${money(x.sales)}</span>
              </div>
              <div style="background:#f1ebe5;border-radius:4px;height:8px;overflow:hidden;">
                <div style="background:var(--primary);height:100%;width:${pct}%;border-radius:4px;transition:width 0.4s;"></div>
              </div>`;
            catEl.append(item);
          });
        }
      }

      // Top sellers
      const topEl = $('#rep-top-sellers-list');
      if (topEl) {
        topEl.replaceChildren();
        if (!analytics.topSellers.length) {
          topEl.innerHTML = '<p style="color:#aaa;font-size:12px;">ยังไม่มีข้อมูล</p>';
        } else {
          analytics.topSellers.forEach((x, i) => {
            const item = document.createElement('div');
            item.style.cssText = 'font-size:12px;display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f9f6f3;';
            item.innerHTML = `<span>${i + 1}. <b>${x.name}</b> (${x.qty} ชิ้น)</span><span style="font-weight:700;color:var(--primary);">${money(x.revenue)}</span>`;
            topEl.append(item);
          });
        }
      }

      // Payment methods
      const pmEl = $('#rep-payment-methods');
      if (pmEl) {
        const cashSales = analytics.paymentSales.find(x => x.payment_type === 'cash')?.sales || 0;
        const qrSales = analytics.paymentSales.find(x => x.payment_type === 'qr')?.sales || 0;
        pmEl.innerHTML = `
          <div style="text-align:center;flex:1;">
            <div style="font-size:11px;color:#888;">💵 เงินสด</div>
            <div style="font-size:20px;font-weight:700;color:var(--primary);margin-top:4px;">${money(cashSales)}</div>
          </div>
          <div style="border-left:1px dashed #dfcec0;"></div>
          <div style="text-align:center;flex:1;">
            <div style="font-size:11px;color:#888;">📱 สแกน QR</div>
            <div style="font-size:20px;font-weight:700;color:var(--primary);margin-top:4px;">${money(qrSales)}</div>
          </div>`;
      }

      // Transactions log
      const txEl = $('#rep-transactions-list');
      if (txEl) {
        txEl.replaceChildren();
        if (!transactions.length) {
          txEl.innerHTML = '<p style="color:#aaa;font-size:12px;text-align:center;padding:20px 0;">ยังไม่มีรายการบิล</p>';
        } else {
          transactions.forEach(tx => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:8px 10px;border:1px solid #f1e7de;border-radius:8px;background:#fff;cursor:pointer;transition:border-color 0.2s;';
            row.onmouseover = () => row.style.borderColor = 'var(--accent)';
            row.onmouseout = () => row.style.borderColor = '#f1e7de';
            const time = new Date(tx.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
            const itemSummary = (tx.items || []).map(x => `${x.name}×${x.quantity}`).join(', ');
            row.innerHTML = `
              <div>
                <b>${tx.id}</b> <small style="color:#aaa;">(${time})</small>
                <div style="font-size:10.5px;color:#8c7366;margin-top:2px;">${itemSummary || '—'}</div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                <strong style="color:var(--primary);">${money(tx.total)}</strong>
                <span style="font-size:10px;background:#f1ebe5;padding:2px 6px;border-radius:4px;">${tx.payment_type === 'cash' ? 'เงินสด' : 'QR'}</span>
              </div>`;
            row.onclick = () => { $('#reports-dialog')?.close(); showReceipt({ ...tx, items: tx.items }); };
            txEl.append(row);
          });
        }
      }

      $('#reports-dialog')?.showModal();
    } catch (e) { showNotice(e.message, 'error'); }
  };
}

// ── Settings & Admin tabs ─────────────────────────────────────
document.querySelectorAll('.admin-tab-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.admin-tab-panel').forEach(p => p.classList.remove('active-panel'));
    btn.classList.add('active');
    const tabEl = $('#' + btn.getAttribute('data-tab'));
    if (tabEl) tabEl.classList.add('active-panel');
  };
});

document.querySelectorAll('.stock-tab-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.stock-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.selectedStockCategory = btn.getAttribute('data-stock-cat') || 'all';
    renderInventoryList();
  };
});

// ── Inventory list rendering ──────────────────────────────────
function renderInventoryList() {
  const container = $('#inventory');
  if (!container) return;
  const cat = state.selectedStockCategory;
  const items = cat === 'all' ? state.inventory : state.inventory.filter(x => x.category === cat);

  container.replaceChildren();
  if (!items.length) {
    container.innerHTML = '<p style="text-align:center;color:#888;padding:16px 0;font-size:13px;">ไม่มีรายการในหมวดหมู่นี้</p>';
    return;
  }
  items.forEach(x => {
    const row = document.createElement('div');
    row.className = 'stock';
    row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid #f1e7de; gap:12px;';
    
    const catLabel = x.category === 'ingredient' ? '🍏 วัตถุดิบ' : '🥤 อุปกรณ์';
    const isLow = x.quantity <= x.low_alert;
    
    const info = document.createElement('div');
    info.style.cssText = 'display:flex; flex-direction:column; gap:2px;';
    
    const name = document.createElement('span');
    name.style.cssText = 'font-weight:600; color:var(--primary);';
    name.textContent = x.name;
    
    const details = document.createElement('small');
    details.style.cssText = 'color:#888; font-size:11px;';
    details.textContent = `${catLabel} · รหัส: ${x.stock_key} · ต้นทุน: ${money(x.cost_per_unit)}/${x.unit}`;
    
    info.append(name, details);
    
    const qtyContainer = document.createElement('div');
    qtyContainer.style.cssText = 'margin-left:auto; display:flex; flex-direction:column; align-items:flex-end; gap:2px;';
    
    const qty = document.createElement('strong');
    qty.style.cssText = `font-size:14px; color:${isLow ? '#c0392b' : 'var(--primary)'};`;
    qty.textContent = `${x.quantity} ${x.unit}`;
    
    const lowLabel = document.createElement('small');
    lowLabel.style.cssText = `font-size:10px; color:${isLow ? '#c0392b' : '#aaa'};`;
    lowLabel.textContent = isLow ? '⚠️ ใกล้หมด' : `แจ้งเตือนที่: ${x.low_alert} ${x.unit}`;
    
    qtyContainer.append(qty, lowLabel);

    const actions = document.createElement('span');
    actions.style.cssText = 'display:flex; gap:4px; align-items:center;';

    const adjustBtn = document.createElement('button');
    adjustBtn.textContent = '⊕ ปรับสต็อก';
    adjustBtn.className = 'primary-btn';
    adjustBtn.style.fontSize = '11px';
    adjustBtn.onclick = () => openStockAdjustDialog(x);

    const editBtn = document.createElement('button');
    editBtn.textContent = '✏️ แก้ไข';
    editBtn.style.cssText = 'font-size:11px;';
    editBtn.onclick = () => openCostInventory(x);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '🗑️';
    deleteBtn.style.cssText = 'font-size:11px; color:#b42318; background:#f8d7da; border:1px solid #f5c6cb;';
    deleteBtn.onclick = () => deleteInventoryItem(x);

    actions.append(adjustBtn, editBtn, deleteBtn);
    row.append(info, qtyContainer, actions);
    container.append(row);
  });
}

async function deleteInventoryItem(item) {
  if (!confirm(`ลบรายการสต็อก “${item.name}” ?`)) return;
  try { await api(`/api/admin/inventory/${item.stock_key}`, { method:'DELETE' }); showNotice('ลบรายการสต็อกแล้ว'); await load(); await adminLoad(); } catch (e) { showNotice(e.message,'error'); }
}

const addInventoryBtn = $('#btn-add-inventory');
if (addInventoryBtn) addInventoryBtn.onclick = () => openCostInventory();

function openStockAdjustDialog(item) {
  const el = id => $(id);
  if (el('#adjust-stock-key')) el('#adjust-stock-key').value = item.stock_key;
  if (el('#adjust-stock-name')) el('#adjust-stock-name').textContent = item.name;
  if (el('#adjust-stock-current')) el('#adjust-stock-current').textContent = item.quantity;
  if (el('#adjust-stock-unit')) el('#adjust-stock-unit').textContent = item.unit;
  if (el('#adjust-amount')) el('#adjust-amount').value = '';
  if (el('#adjust-action')) el('#adjust-action').value = 'in';
  if (el('#adjust-reason')) el('#adjust-reason').value = 'stock_in';
  $('#stock-adjust-dialog')?.showModal();
}

const adjustActionEl = $('#adjust-action');
if (adjustActionEl) {
  adjustActionEl.onchange = () => {
    const act = adjustActionEl.value;
    const reasonEl = $('#adjust-reason');
    if (reasonEl) reasonEl.value = act === 'in' ? 'stock_in' : 'wastage';
  };
}

const submitStockBtn = $('#submit-stock-adjust');
if (submitStockBtn) {
  submitStockBtn.onclick = async () => {
    const key = $('#adjust-stock-key')?.value;
    const act = $('#adjust-action')?.value;
    const amt = Number($('#adjust-amount')?.value);
    const reason = $('#adjust-reason')?.value || 'manual';
    if (!key || isNaN(amt) || amt <= 0) return alert('กรอกจำนวนให้ถูกต้อง');
    const finalAmt = act === 'in' ? amt : -amt;
    try {
      await api(`/api/admin/inventory/${key}/adjust`, { method: 'POST', body: JSON.stringify({ amount: finalAmt, reason }) });
      $('#stock-adjust-dialog')?.close();
      showNotice('ปรับสต็อกสำเร็จ!');
      await load();
      renderInventoryList();
    } catch (e) { showNotice(e.message, 'error'); }
  };
}

document.querySelectorAll('#stock-adjust-dialog .close').forEach(b => { b.onclick = () => $('#stock-adjust-dialog')?.close(); });

// ── Admin login & reload ──────────────────────────────────────
const loginBtn = $('#login');
if (loginBtn) {
  loginBtn.onclick = async () => {
    adminPin = $('#pin')?.value || '';
    try {
      await adminLoad();
    } catch (e) {
      adminPin = '';
      showNotice(e.message, 'error');
    }
  };
}

const refreshBtn = $('#refresh');
if (refreshBtn) refreshBtn.onclick = adminLoad;

const settingsBtn = $('#settingsBtn');
if (settingsBtn) {
  settingsBtn.onclick = () => {
    if (window.useFirebaseStore) { openAdminWindow('tab-features', 'จัดการร้าน'); return; }
    const tabBtn = document.querySelector('.admin-tab-btn[data-tab="tab-features"]');
    if (tabBtn) tabBtn.click();
    $('#settings')?.showModal();
  };
}

function settingRow(label, inputEl) {
  const row = document.createElement('div');
  row.className = 'feature';
  const lbl = document.createElement('span');
  lbl.textContent = label;
  row.append(lbl, inputEl);
  return row;
}

// ── Admin load ────────────────────────────────────────────────
async function adminLoad() {
  const boot = await api('/api/bootstrap');
  const settings = await api('/api/admin/settings');

  const authEl = $('#auth');
  const adminEl = $('#admin');
  if (authEl) authEl.hidden = true;
  if (adminEl) adminEl.hidden = false;

  // Update global state from boot
  state.categories = boot.categories || [];
  state.inventory = boot.inventory || [];
  state.channels = boot.channels || [];
  renderInventoryList();
  renderAdminMembers();

  // ① Feature toggles
  const featuresEl = $('#features');
  if (featuresEl) {
    featuresEl.replaceChildren(...(settings.features || []).map(x => {
      const chk = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!x.enabled });
      const featureLabels = { kds: '☕ คิวชง (Brewing Queue)', inventory: '📦 คลังสต็อก', members: '👤 สมาชิก', recipes: '📖 สูตรชง', reports: '📊 รายงาน' };
      chk.onchange = async () => {
        try {
          await api(`/api/admin/settings/${x.feature_key}`, { method: 'PUT', body: JSON.stringify({ enabled: chk.checked }) });
          await load();
        } catch (e) { showNotice(e.message, 'error'); }
      };
      return settingRow(featureLabels[x.feature_key] || x.feature_key, chk);
    }));
  }

  // ② Populate category select dropdowns in product editor
  const editCatSel = $('#edit-prod-category');
  if (editCatSel) {
    editCatSel.replaceChildren(...boot.categories.map(c => new Option(c.name, c.category_key)));
  }

  // ③ Populate inventory dropdown in recipe builder
  const recipeStockSel = $('#add-recipe-stock-key');
  if (recipeStockSel) {
    recipeStockSel.replaceChildren(...boot.inventory.map(x => new Option(`${x.name} (${x.unit})`, x.stock_key)));
  }

  // ④ Products list in admin
  const [allProducts, costingRows] = await Promise.all([api('/api/admin/products'), api('/api/costing')]);
  const costingByProduct = Object.fromEntries(costingRows.map(row => [row.product_id, row]));
  const adminProdsEl = $('#admin-products');
  if (adminProdsEl) {
    adminProdsEl.replaceChildren();
    allProducts.forEach(p => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 4px;border-bottom:1px solid #f5f0eb;font-size:13px;';

      const info = document.createElement('span');
      info.innerHTML = `${p.emoji} <b>${p.name}</b> — <span style="color:var(--primary);">${money(p.price)}</span> <small style="color:#aaa;">(${p.category})</small>${p.active ? '' : ' <span style="color:#c0392b;font-size:10px;font-weight:700;">[ปิดขาย]</span>'}`;

      const costing = costingByProduct[p.id];
      const costInfo = document.createElement('small');
      costInfo.style.cssText = 'display:block;color:var(--text-muted);margin-top:2px;';
      costInfo.textContent = costing ? `ต้นทุน ${money(costing.cost)} · ราคาขาย ${money(p.price)} · กำไร ${money(costing.gross_profit)}` : `ราคาขาย ${money(p.price)}`;
      info.append(costInfo);

      const editBtn = document.createElement('button');
      editBtn.textContent = '✏️ แก้ไข';
      editBtn.style.cssText = 'border:1px solid #dfcec0;background:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;font-family:inherit;transition:all 0.15s;';
      editBtn.onmouseover = () => { editBtn.style.background = 'var(--primary)'; editBtn.style.color = '#fff'; };
      editBtn.onmouseout = () => { editBtn.style.background = '#fff'; editBtn.style.color = 'var(--text-main)'; };
      editBtn.onclick = () => openProductEditor(p);

      row.append(info, editBtn);
      adminProdsEl.append(row);
    });
  }

  // ⑤ Categories table
  renderCategoriesTable();

  // ⑥ GP channels
  const channelsEl = $('#channels');
  if (channelsEl) {
    channelsEl.replaceChildren(...boot.channels.map(ch => {
      const gpInput = Object.assign(document.createElement('input'), { type: 'number', min: 0, max: 99.99, step: 0.01, value: ch.gp_percent });
      gpInput.style.cssText = 'width:80px;padding:6px;font-size:12px;';
      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'บันทึก';
      saveBtn.onclick = async () => {
        try {
          await api(`/api/admin/channels/${ch.channel_key}`, { method: 'PUT', body: JSON.stringify({ gpPercent: Number(gpInput.value), active: true }) });
          showNotice('บันทึก GP สำเร็จ');
          await adminLoad();
        } catch (e) { showNotice(e.message, 'error'); }
      };
      const wrap = document.createElement('span');
      wrap.style.cssText = 'display:flex;gap:6px;align-items:center;';
      wrap.append(gpInput, saveBtn);
      return settingRow(`${ch.name} GP (%)`, wrap);
    }));
  }

  // ⑦ Product-centric pricing grid
  await renderChannelPricingGrid();
  await renderCostingGrid();

  // ⑧ Inventory list
  renderInventoryList();
}

function renderCategoriesTable() {
  const el = $('#categories-table-container');
  if (!el) return;
  if (!state.categories.length) {
    el.innerHTML = '<p style="padding:10px;color:#888;text-align:center;font-size:12px;">ยังไม่มีหมวดหมู่</p>';
    return;
  }
  el.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
      <thead>
        <tr style="background:#fdf6ee;border-bottom:1px solid #eadfd5;color:var(--primary);">
          <th style="padding:8px;text-align:left;font-weight:700;">รหัส</th>
          <th style="padding:8px;text-align:left;font-weight:700;">ชื่อหมวดหมู่</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${state.categories.map(c => `
          <tr style="border-bottom:1px solid #faf6f2;">
            <td style="padding:8px;font-family:Courier,monospace;font-weight:600;">${c.category_key}</td>
            <td style="padding:8px;">${c.name}</td><td style="padding:5px;white-space:nowrap;"><button data-edit-category="${c.category_key}">✏️</button> <button data-delete-category="${c.category_key}">🗑️</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('[data-edit-category]').forEach(btn => btn.onclick = async () => {
    const key = btn.getAttribute('data-edit-category'); const item = state.categories.find(x => x.category_key === key); const name = prompt('ชื่อหมวดหมู่', item?.name || ''); if (!name) return;
    try { await api(`/api/admin/categories/${key}`, {method:'PUT',body:JSON.stringify({name})}); await adminLoad(); await load(); } catch (e) { showNotice(e.message,'error'); }
  });
  el.querySelectorAll('[data-delete-category]').forEach(btn => btn.onclick = async () => {
    const key = btn.getAttribute('data-delete-category'); if (!confirm(`ลบหมวดหมู่ ${key} ?`)) return;
    try { await api(`/api/admin/categories/${key}`, {method:'DELETE'}); await adminLoad(); await load(); } catch (e) { showNotice(e.message,'error'); }
  });
}

// ── Category add ──────────────────────────────────────────────
const addCatBtn = $('#add-category');
if (addCatBtn) {
  addCatBtn.onclick = async () => {
    const keyEl = $('#new-category-key');
    const nameEl = $('#new-category-name');
    try {
      await api('/api/admin/categories', { method: 'POST', body: JSON.stringify({ key: keyEl?.value, name: nameEl?.value }) });
      if (keyEl) keyEl.value = '';
      if (nameEl) nameEl.value = '';
      showNotice('เพิ่มหมวดหมู่สำเร็จ');
      await adminLoad();
      await load();
    } catch (e) { showNotice(e.message, 'error'); }
  };
}

// ── Online pricing grid ───────────────────────────────────────
async function renderCostingGrid() {
  const container = $('#costing-grid');
  if (!container) return;
  container.innerHTML = '<p class="hint">กำลังคำนวณต้นทุน…</p>';
  try {
    const rows = await api('/api/costing');
    container.replaceChildren();
    rows.forEach(row => {
      const card = document.createElement('article');
      card.className = 'cost-card';
      const title = document.createElement('h4');
      title.textContent = row.name;
      const metrics = document.createElement('div');
      metrics.className = 'cost-metrics';
      [['ต้นทุน/แก้ว', money(row.cost)], ['ขายหน้าร้าน', money(row.store_price)], ['แนะนำที่ Margin ' + Math.round(row.target_margin * 100) + '%', money(row.recommended_store_price)], ['กำไรจริง', money(row.gross_profit)], ['Food cost', `${row.food_cost_percent}%`]].forEach(([label,value]) => { const item=document.createElement('div'); item.innerHTML=`<small>${label}</small><b>${value}</b>`; metrics.append(item); });
      const formula = document.createElement('p');
      formula.className = 'cost-formula';
      formula.textContent = row.ingredients.length ? row.ingredients.map(x => `${x.name} ${x.quantity}${x.unit} (${money(x.line_cost)})`).join(' • ') : 'ยังไม่ได้ใส่สูตร — เปิด “จัดการเมนู” เพื่อเพิ่มวัตถุดิบ';
      const online = document.createElement('p');
      online.className = 'cost-online';
      online.textContent = row.online.map(x => `${x.name} GP ${x.gp_percent}%: ราคาแนะนำ ${money(x.suggested_price)}`).join(' | ');
      card.append(title, metrics, formula, online);
      container.append(card);
    });
  } catch (e) { container.textContent = e.message; }
}

async function renderChannelPricingGrid() {
  const container = $('#channel-pricing-grid');
  if (!container) return;
  container.innerHTML = '<p style="color:#888;font-size:12px;text-align:center;padding:10px;">กำลังโหลดราคาออนไลน์...</p>';
  try {
    const pricing = await api('/api/pricing');
    const productPrices = {};
    pricing.forEach(x => {
      if (!productPrices[x.product_id]) {
        productPrices[x.product_id] = { name: x.name, store_price: x.store_price, channels: {} };
      }
      productPrices[x.product_id].channels[x.channel_key] = x;
    });

    container.innerHTML = '';
    Object.entries(productPrices).forEach(([prodId, p]) => {
      const card = document.createElement('div');
      card.style.cssText = 'border:1px solid #f1e7de;border-radius:12px;padding:14px;margin-bottom:12px;background:#faf8f5;';
      const header = document.createElement('div');
      header.style.cssText = 'font-weight:700;font-size:13.5px;color:var(--primary);display:flex;justify-content:space-between;margin-bottom:10px;';
      header.innerHTML = `<span>${p.name}</span><span style="color:var(--text-muted);font-weight:500;">หน้าร้าน ${money(p.store_price)}</span>`;

      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px;';

      state.channels.forEach(ch => {
        const item = p.channels[ch.channel_key];
        const suggested = Number(p.store_price / (1 - ch.gp_percent / 100)).toFixed(2);
        const box = document.createElement('div');
        box.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
        box.innerHTML = `<label style="font-size:10.5px;font-weight:600;color:var(--text-muted);">${ch.name} (แนะนำ ฿${suggested})</label>`;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = '0.5';
        inp.placeholder = `฿${suggested}`;
        inp.value = item?.sale_price != null ? item.sale_price : '';
        inp.setAttribute('data-product-id', prodId);
        inp.setAttribute('data-channel-key', ch.channel_key);
        inp.style.cssText = 'padding:6px;font-size:12px;border:1px solid #dfcec0;border-radius:6px;outline:none;';
        box.append(inp);
        grid.append(box);
      });

      const saveRow = document.createElement('div');
      saveRow.style.cssText = 'display:flex;justify-content:flex-end;';
      const saveBtn = document.createElement('button');
      saveBtn.textContent = '💾 บันทึกราคาออนไลน์';
      saveBtn.className = 'primary-btn';
      saveBtn.style.cssText = 'font-size:11px;padding:6px 14px;';
      saveBtn.onclick = async () => {
        try {
          for (const inp of card.querySelectorAll('input[data-product-id]')) {
            const val = inp.value.trim();
            if (val !== '') {
              await api('/api/admin/channel-prices', { method: 'PUT', body: JSON.stringify({ productId: Number(inp.getAttribute('data-product-id')), channelKey: inp.getAttribute('data-channel-key'), salePrice: Number(val) }) });
            }
          }
          showNotice('บันทึกราคาออนไลน์สำเร็จ');
        } catch (e) { showNotice(e.message, 'error'); }
      };
      saveRow.append(saveBtn);
      card.append(header, grid, saveRow);
      container.append(card);
    });
    if (!container.childElementCount) container.innerHTML = '<p style="color:#aaa;font-size:12px;text-align:center;padding:10px;">ยังไม่มีสินค้า</p>';
  } catch (e) {
    container.innerHTML = `<p style="color:#c0392b;font-size:12px;">${e.message}</p>`;
  }
}

// ── Product Editor Overlay ────────────────────────────────────
function renderEditRecipeItems() {
  const container = $('#edit-recipe-items-list');
  const summary = $('#edit-recipe-cost-summary');
  if (!container) return;
  container.replaceChildren();
  if (!currentEditRecipeItems.length) {
    container.innerHTML = '<p style="color:#aaa;font-size:12px;font-style:italic;padding:4px 0;">ยังไม่ได้ผูกวัตถุดิบ/อุปกรณ์ในสูตรชง</p>';
    if (summary) summary.textContent = 'ต้นทุนสูตร: ฿0.00';
    return;
  }
  currentEditRecipeItems.forEach((x, idx) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;background:#faf8f5;border:1px solid #f1e7de;border-radius:8px;padding:8px 12px;font-size:12.5px;gap:8px;';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = `📦 ${x.name}`;
    const meta = document.createElement('div');
    meta.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const qtySpan = document.createElement('strong');
    qtySpan.style.color = 'var(--primary)';
    const unitCost = Number(x.cost_per_unit ?? state.inventory.find(item => item.stock_key === x.stock_key)?.cost_per_unit ?? 0);
    const lineCost = Number(x.quantity) * unitCost;
    qtySpan.textContent = `${x.quantity} ${x.unit} · ${money(lineCost)}`;
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = '✕ ลบ';
    delBtn.style.cssText = 'border:1px solid #f5c6cb;background:#f8d7da;color:#721c24;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer;';
    delBtn.onclick = () => { currentEditRecipeItems.splice(idx, 1); renderEditRecipeItems(); };
    meta.append(qtySpan, delBtn);
    row.append(nameSpan, meta);
    container.append(row);
  });
  const total = currentEditRecipeItems.reduce((sum, x) => sum + Number(x.quantity) * Number(x.cost_per_unit ?? state.inventory.find(item => item.stock_key === x.stock_key)?.cost_per_unit ?? 0), 0);
  const price = Number($('#edit-prod-price')?.value) || 0;
  const margin = Math.min(94, Math.max(1, Number($('#edit-prod-margin')?.value) || 65));
  const recommended = total ? total / (1 - margin / 100) : 0;
  if (summary) {
    summary.replaceChildren();
    const cost=document.createElement('b'); cost.textContent=`ต้นทุนรวมต่อแก้ว ${money(total)}`;
    const sale=document.createElement('span'); sale.textContent=`ราคาขาย ${money(price)} · กำไรขั้นต้น ${money(price-total)}`;
    const rec=document.createElement('span'); rec.textContent=`ราคาแนะนำที่กำไร ${margin}%: ${money(recommended)}`;
    const apply=document.createElement('button'); apply.type='button'; apply.textContent='ใช้ราคาแนะนำ'; apply.className='recipe-price-apply'; apply.onclick=()=>{const input=$('#edit-prod-price');if(input){input.value=Math.ceil(recommended / 5) * 5;renderEditRecipeItems();}};
    summary.append(cost,sale,rec,apply);
  }
}

async function openProductEditor(product) {
  // Close settings → bounce to home register screen, then show editor overlay
  $('#settings')?.close();

  if (product) {
    // Edit mode
    if ($('#edit-prod-id')) $('#edit-prod-id').value = product.id;
    if ($('#edit-prod-name')) $('#edit-prod-name').value = product.name;
    if ($('#edit-prod-price')) $('#edit-prod-price').value = product.price;
    if ($('#edit-prod-margin')) $('#edit-prod-margin').value = Math.round((product.target_margin ?? .65) * 100);
    if ($('#edit-prod-emoji')) $('#edit-prod-emoji').value = product.emoji;
    if ($('#edit-prod-category')) $('#edit-prod-category').value = product.category;
    if ($('#edit-prod-active')) $('#edit-prod-active').checked = !!product.active;
    if ($('#edit-prod-title')) $('#edit-prod-title').textContent = `✏️ แก้ไข: ${product.name}`;
    const delBtn = $('#btn-delete-product');
    if (delBtn) delBtn.style.display = 'inline-block';

    try {
      const recipe = await api(`/api/admin/products/${product.id}/recipe`);
      currentEditRecipeItems = recipe.items || [];
      if ($('#edit-recipe-description')) $('#edit-recipe-description').value = recipe.description || '';
    } catch {
      currentEditRecipeItems = [];
      if ($('#edit-recipe-description')) $('#edit-recipe-description').value = '';
    }
  } else {
    // Add mode
    if ($('#edit-prod-id')) $('#edit-prod-id').value = '';
    if ($('#edit-prod-name')) $('#edit-prod-name').value = '';
    if ($('#edit-prod-price')) $('#edit-prod-price').value = '';
    if ($('#edit-prod-margin')) $('#edit-prod-margin').value = 65;
    if ($('#edit-prod-emoji')) $('#edit-prod-emoji').value = '☕';
    if ($('#edit-prod-category')) $('#edit-prod-category').value = state.categories[0]?.category_key || 'coffee';
    if ($('#edit-prod-active')) $('#edit-prod-active').checked = true;
    if ($('#edit-recipe-description')) $('#edit-recipe-description').value = '';
    if ($('#edit-prod-title')) $('#edit-prod-title').textContent = '➕ เพิ่มสินค้าใหม่';
    const delBtn = $('#btn-delete-product');
    if (delBtn) delBtn.style.display = 'none';
    currentEditRecipeItems = [];
  }

  renderEditRecipeItems();
  $('#product-edit-dialog')?.showModal();
}

// "Add new product" button
const triggerAddBtn = $('#btn-trigger-add-product');
if (triggerAddBtn) triggerAddBtn.onclick = () => openProductEditor(null);

// Close product editor
document.querySelectorAll('#product-edit-dialog .close').forEach(b => { b.onclick = () => $('#product-edit-dialog')?.close(); });

// Add recipe item button
const addRecipeItemBtn = $('#btn-add-recipe-item');
if (addRecipeItemBtn) {
  addRecipeItemBtn.onclick = () => {
    const key = $('#add-recipe-stock-key')?.value;
    const qty = Number($('#add-recipe-quantity')?.value);
    if (!key || isNaN(qty) || qty <= 0) return alert('กรอกวัตถุดิบและปริมาณให้ถูกต้อง');
    const stockItem = state.inventory.find(x => x.stock_key === key);
    if (!stockItem) return;
    const existing = currentEditRecipeItems.find(x => x.stock_key === key);
    if (existing) { existing.quantity = qty; }
    else { currentEditRecipeItems.push({ stock_key: key, quantity: qty, name: stockItem.name, unit: stockItem.unit, cost_per_unit: stockItem.cost_per_unit }); }
    if ($('#add-recipe-quantity')) $('#add-recipe-quantity').value = '';
    renderEditRecipeItems();
  };
}

// Save product & recipe button
const saveProductBtn = $('#btn-save-product-edit');
if (saveProductBtn) {
  saveProductBtn.onclick = async () => {
    const id = $('#edit-prod-id')?.value;
    const name = ($('#edit-prod-name')?.value || '').trim();
    const price = Number($('#edit-prod-price')?.value);
    const targetMargin = Number($('#edit-prod-margin')?.value) / 100;
    const category = $('#edit-prod-category')?.value || 'other';
    const emoji = ($('#edit-prod-emoji')?.value || '☕').slice(0, 8);
    const active = !!$('#edit-prod-active')?.checked;
    const description = ($('#edit-recipe-description')?.value || '').trim();

    if (!name || isNaN(price) || price < 0) return alert('กรอกชื่อสินค้าและราคาให้ถูกต้อง');

    try {
      let productId;
      if (id) {
        await api(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify({ name, price, category, emoji, active }) });
        await api(`/api/admin/products/${id}/costing`, { method: 'PUT', body: JSON.stringify({ price, targetMargin }) });
        productId = Number(id);
        showNotice('บันทึกข้อมูลสินค้าสำเร็จ!');
      } else {
        const res = await api('/api/admin/products', { method: 'POST', body: JSON.stringify({ name, price, category, emoji }) });
        productId = res.id;
        await api(`/api/admin/products/${productId}/costing`, { method: 'PUT', body: JSON.stringify({ price, targetMargin }) });
        showNotice('เพิ่มสินค้าใหม่สำเร็จ!');
      }
      // Save structured recipe
      await api(`/api/admin/products/${productId}/recipe`, {
        method: 'PUT',
        body: JSON.stringify({ items: currentEditRecipeItems, description })
      });

      $('#product-edit-dialog')?.close();
      await load();
      await adminLoad();
    } catch (e) { showNotice(e.message, 'error'); }
  };
}

// Delete product button
const deleteProductBtn = $('#btn-delete-product');
if (deleteProductBtn) {
  deleteProductBtn.onclick = async () => {
    const id = $('#edit-prod-id')?.value;
    if (!id) return;
    if (!confirm('🗑️ ยืนยันลบสินค้านี้ออกจากร้าน? ไม่สามารถกู้คืนได้')) return;
    try {
      await api(`/api/admin/products/${id}`, { method: 'DELETE' });
      showNotice('ลบสินค้าแล้ว');
      $('#product-edit-dialog')?.close();
      await load();
      await adminLoad();
    } catch (e) { showNotice(e.message, 'error'); }
  };
}

// ── Main event bindings ───────────────────────────────────────
const searchEl = $('#search');
if (searchEl) searchEl.oninput = renderProducts;

const discountEl = $('#discount');
if (discountEl) discountEl.oninput = renderCart;

const checkoutBtn = $('#checkout');
if (checkoutBtn) checkoutBtn.onclick = checkout;

$('#edit-prod-price') && ($('#edit-prod-price').oninput = renderEditRecipeItems);
$('#edit-prod-margin') && ($('#edit-prod-margin').oninput = renderEditRecipeItems);

function refreshUnitCostPreview() {
  const qty=Number($('#cost-inv-purchase-qty')?.value)||0, total=Number($('#cost-inv-purchase-total')?.value)||0;
  const out=$('#cost-inv-unit-price'); if(out) out.textContent=qty>0?money(total/qty):money(0);
}
['#cost-inv-purchase-qty','#cost-inv-purchase-total'].forEach(selector => { const el=$(selector); if(el) el.oninput=refreshUnitCostPreview; });
$('#btn-cost-inventory') && ($('#btn-cost-inventory').onclick=()=>{ ['#cost-inv-key','#cost-inv-name','#cost-inv-unit','#cost-inv-purchase-qty','#cost-inv-purchase-total'].forEach(s=>{const el=$(s);if(el)el.value='';}); if($('#cost-inv-quantity'))$('#cost-inv-quantity').value=0;if($('#cost-inv-low'))$('#cost-inv-low').value=0;refreshUnitCostPreview();$('#cost-inventory-dialog')?.showModal(); });
$('#cost-inv-save') && ($('#cost-inv-save').onclick=async()=>{ const stockKey=($('#cost-inv-key')?.value||'').trim(),name=($('#cost-inv-name')?.value||'').trim(),unit=($('#cost-inv-unit')?.value||'').trim(),category=$('#cost-inv-category')?.value,quantity=Number($('#cost-inv-quantity')?.value),lowAlert=Number($('#cost-inv-low')?.value),purchaseQuantity=Number($('#cost-inv-purchase-qty')?.value),purchaseTotal=Number($('#cost-inv-purchase-total')?.value); if(!stockKey||!name||!unit||purchaseQuantity<=0||purchaseTotal<0)return showNotice('กรอกข้อมูลราคาซื้อและปริมาณให้ครบ','error');try{await api('/api/admin/cost-inventory',{method:'POST',body:JSON.stringify({stockKey,name,unit,category,quantity,lowAlert,purchaseQuantity,purchaseTotal})});$('#cost-inventory-dialog')?.close();showNotice('บันทึกต้นทุนต่อหน่วยแล้ว');await load();await adminLoad();}catch(e){showNotice(e.message,'error');} });

const topMenuToggle = $('#top-menu-toggle');
if (topMenuToggle) topMenuToggle.onclick = () => {
  const menu = $('.top-menu'); const open = menu?.classList.toggle('open');
  topMenuToggle.setAttribute('aria-expanded', String(!!open));
};
document.addEventListener('click', event => { if (!event.target.closest('.top-menu')) { $('.top-menu')?.classList.remove('open'); topMenuToggle?.setAttribute('aria-expanded','false'); } });

let costInventoryEditingKey = null;
function openCostInventory(item = null) {
  costInventoryEditingKey = item?.stock_key || null;
  const set=(id,value)=>{const el=$(id);if(el)el.value=value ?? '';};
  set('#cost-inv-key', item?.stock_key || ''); set('#cost-inv-name', item?.name || ''); set('#cost-inv-unit', item?.unit || '');
  set('#cost-inv-category', item?.category || 'ingredient'); set('#cost-inv-quantity', item?.quantity || 0); set('#cost-inv-low', item?.low_alert || 0);
  set('#cost-inv-purchase-qty', item?.purchase_quantity || 1); set('#cost-inv-purchase-total', item?.purchase_total || item?.cost_per_unit || 0);
  const key=$('#cost-inv-key'); if(key) key.readOnly=!!item;
  const title=document.querySelector('#cost-inventory-dialog h2'); if(title) title.textContent=item?'แก้ไขราคาซื้อและต้นทุน':'เพิ่มวัตถุดิบ / บรรจุภัณฑ์';
  refreshUnitCostPreview(); $('#cost-inventory-dialog')?.showModal();
}
let memberEditingPhone = null;
async function renderAdminMembers() {
  const container = $('#admin-members-list');
  if (!container) return;
  try {
    const list = await api('/api/admin/members');
    container.replaceChildren();
    if (!list.length) {
      container.innerHTML = '<p style="text-align:center;color:#888;padding:16px 0;font-size:13px;">ยังไม่มีสมาชิกในระบบ</p>';
      return;
    }
    list.forEach(m => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #f1e7de; gap:12px;';
      
      const info = document.createElement('div');
      info.style.cssText = 'display:flex; flex-direction:column; gap:2px;';
      
      const name = document.createElement('b');
      name.style.cssText = 'color:var(--primary);';
      name.textContent = m.name;
      
      const phoneSpan = document.createElement('small');
      phoneSpan.style.cssText = 'color:#888; font-size:11px;';
      phoneSpan.textContent = `เบอร์โทร: ${m.phone} · สะสม ${m.points} แก้ว`;
      
      info.append(name, phoneSpan);
      
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = '✏️ แก้ไข';
      editBtn.style.cssText = 'font-size:11px; padding:6px 12px;';
      editBtn.className = 'secondary-btn';
      editBtn.onclick = () => openMemberEditDialog(m);
      
      row.append(info, editBtn);
      container.append(row);
    });
  } catch (e) {
    container.innerHTML = `<p style="color:#b42318;text-align:center;">โหลดสมาชิกไม่สำเร็จ: ${e.message}</p>`;
  }
}

function openMemberEditDialog(member = null) {
  memberEditingPhone = member ? member.phone : null;
  const phoneInput = $('#edit-member-phone');
  const nameInput = $('#edit-member-name');
  const pointsInput = $('#edit-member-points');
  const title = $('#member-edit-title');
  const deleteBtn = $('#btn-delete-member');
  
  if (phoneInput) {
    phoneInput.value = member ? member.phone : '';
    phoneInput.readOnly = !!member;
  }
  if (nameInput) nameInput.value = member ? member.name : '';
  if (pointsInput) pointsInput.value = member ? member.points : 0;
  
  if (title) title.textContent = member ? 'แก้ไขข้อมูลสมาชิก' : 'เพิ่มสมาชิกใหม่';
  if (deleteBtn) deleteBtn.style.display = member ? 'inline-block' : 'none';
  
  $('#member-edit-dialog')?.showModal();
}

// Member CRUD event bindings
$('#btn-add-member') && ($('#btn-add-member').onclick = () => openMemberEditDialog());
$('#btn-save-member') && ($('#btn-save-member').onclick = async () => {
  const phone = ($('#edit-member-phone')?.value || '').trim();
  const name = ($('#edit-member-name')?.value || '').trim();
  const points = Number($('#edit-member-points')?.value || 0);
  if (!phone || !name || isNaN(points) || points < 0) return showNotice('กรอกข้อมูลสมาชิกให้ครบและถูกต้อง', 'error');
  try {
    if (memberEditingPhone) {
      await api(`/api/admin/members/${memberEditingPhone}`, {
        method: 'PUT',
        body: JSON.stringify({ name, points })
      });
      showNotice('แก้ไขสมาชิกสำเร็จ');
    } else {
      await api('/api/members', {
        method: 'POST',
        body: JSON.stringify({ phone, name })
      });
      if (points > 0) {
        await api(`/api/admin/members/${phone}`, {
          method: 'PUT',
          body: JSON.stringify({ name, points })
        });
      }
      showNotice('เพิ่มสมาชิกใหม่สำเร็จ');
    }
    $('#member-edit-dialog')?.close();
    await renderAdminMembers();
  } catch (e) { showNotice(e.message, 'error'); }
});
$('#btn-delete-member') && ($('#btn-delete-member').onclick = async () => {
  if (!memberEditingPhone) return;
  if (!confirm(`ยืนยันลบสมาชิกเบอร์ ${memberEditingPhone}?`)) return;
  try {
    await api(`/api/admin/members/${memberEditingPhone}`, { method: 'DELETE' });
    showNotice('ลบสมาชิกสำเร็จ');
    $('#member-edit-dialog')?.close();
    await renderAdminMembers();
  } catch (e) { showNotice(e.message, 'error'); }
});

$('#modifier-confirm-btn') && ($('#modifier-confirm-btn').onclick = confirmModifier);

let kdsTimer = null;
function optionText(raw) { try { const x=typeof raw==='string'?JSON.parse(raw):raw; return modifierSummary({temperature:x?.temperature||'iced',sweetness:x?.sweetness??100,milk:x?.milk||'fresh',toppings:x?.toppings||[]}); } catch { return ''; } }
function kdsWait(createdAt) { const m=Math.max(0,Math.floor((Date.now()-new Date(createdAt).getTime())/60000)); return m ? `${m} นาที` : 'เพิ่งเข้าคิว'; }
async function renderKdsGrid() { const root=$('#kds-grid'); if(!root) return; try { const rows=await api('/api/kds'); root.replaceChildren(); if(!rows.length) { root.innerHTML='<div class="empty-state">ยังไม่มีคิวชง</div>'; return; } rows.forEach(x=>{ const card=document.createElement('article');card.className=`kds-card ${x.status}`; const queue=document.createElement('strong');queue.className='kds-queue';queue.textContent=`#${String(x.order_id).slice(-5)}`; const name=document.createElement('h3');name.textContent=`${x.name} × ${x.quantity}`; const opts=document.createElement('p');opts.className='kds-options';opts.textContent=optionText(x.options_json); const wait=document.createElement('p');wait.className='kds-wait';wait.textContent=`รอ ${kdsWait(x.created_at)}`; const action=document.createElement('button');action.type='button';const next=x.status==='pending'?'cooking':x.status==='cooking'?'completed':null;action.textContent=x.status==='pending'?'เริ่มชง':x.status==='cooking'?'พร้อมเสิร์ฟ':'พร้อมเสิร์ฟแล้ว';action.disabled=!next;action.onclick=async()=>{try{await api(`/api/kds/items/${x.id}/status`,{method:'PUT',body:JSON.stringify({status:next})});await renderKdsGrid();}catch(e){showNotice(e.message,'error');}};card.append(queue,name,opts,wait,action);root.append(card); }); } catch(e) { root.innerHTML='<div class="empty-state">โหลดคิวชงไม่สำเร็จ</div>'; } }
function openKdsMode() { if(!state.features.kds) return showNotice('กรุณาเปิดฟังก์ชันคิวชงในการตั้งค่า','error'); $('#kds-dialog')?.showModal(); renderKdsGrid(); clearInterval(kdsTimer); kdsTimer=setInterval(renderKdsGrid,10000); }
$('#kds-mode-btn') && ($('#kds-mode-btn').onclick=openKdsMode);
$('#kds-close-btn') && ($('#kds-close-btn').onclick=()=>{ $('#kds-dialog')?.close(); clearInterval(kdsTimer); });
$('#kds-clear-completed-btn') && ($('#kds-clear-completed-btn').onclick=async()=>{ if(!confirm('ล้างเฉพาะคิวที่เสิร์ฟเสร็จแล้ว? คิวที่รอและกำลังชงจะไม่ถูกลบ')) return; try { const r=await api('/api/kds/completed',{method:'DELETE'}); showNotice(`ล้างคิวเสิร์ฟแล้ว ${r.cleared||0} รายการ`); await renderKdsGrid(); await renderQuickBrewQueue(); } catch(e) { showNotice(e.message,'error'); } });
$('#kds-dialog')?.addEventListener('close',()=>clearInterval(kdsTimer));

let numpadTarget=null, numpadValue='';
function openNumpad(target,title) { numpadTarget=target;numpadValue=target.value||'';$('#numpad-title').textContent=title;renderNumpad();$('#numpad-dialog')?.showModal(); }
function renderNumpad() { $('#numpad-value').textContent=numpadValue||'0';const root=$('#numpad-keys');root.replaceChildren();['1','2','3','4','5','6','7','8','9','.','0','←'].forEach(key=>{const b=document.createElement('button');b.type='button';b.textContent=key;b.onclick=()=>{if(key==='←')numpadValue=numpadValue.slice(0,-1);else if(key==='.'&&numpadTarget?.id==='member-phone')return;else if(key==='.'&&numpadValue.includes('.'))return;else numpadValue+=key;renderNumpad();};root.append(b);}); }
$('#numpad-clear-btn') && ($('#numpad-clear-btn').onclick=()=>{numpadValue='';renderNumpad();});
$('#numpad-confirm-btn') && ($('#numpad-confirm-btn').onclick=()=>{if(!numpadTarget)return;numpadTarget.value=numpadValue;numpadTarget.dispatchEvent(new Event('input',{bubbles:true}));$('#numpad-dialog')?.close();});
['discount','member-phone'].forEach(id=>{const el=$('#'+id);if(el){el.readOnly=true;el.inputMode='none';el.onclick=()=>openNumpad(el,id==='discount'?'ส่วนลด (บาท)':'เบอร์โทรสมาชิก');}});

// ── Bootstrap application ─────────────────────────────────────
load().catch(e => showNotice(e.message, 'error'));
