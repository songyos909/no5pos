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
  channelPrices: [],
  optionGroups: [],
  bestSellers: [],
  loyaltySettings: { mode:'category', categoryKeys:['coffee','tea'], productIds:[], earnStore:true, earnOnline:true, rewardPoints:10, rewardType:'free_product', rewardMode:'category', rewardCategoryKeys:['coffee','tea'], rewardProductIds:[], rewardDiscountAmount:50, rewardMaxPrice:0 },
  recipesData: [],
  selectedCategory: 'all',
  selectedStockCategory: 'all', selectedMaterialType: 'all'
};
let adminPin = '';
let currentMember = null;
let checkoutPayload = null;
let currentEditRecipeItems = [];
let uploadedProductImageData = null;
let productEditorReturnView = null;
let currentCustomOptionGroups = [];

// ── Utilities ─────────────────────────────────────────────────
const $ = s => document.querySelector(s);
const money = n => `฿${Number(n || 0).toFixed(2)}`;
const displayName = item => item?.name_th || item?.name || '';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const menuImageFor = product => {
  if (product?.image_data) return product.image_data;
  if (product?.image_path) return String(product.image_path).replace(/^\/+/, '');
  const name = displayName(product).toLowerCase();
  const matches = [
    [['เอสเพรสโซ่ร้อน', 'เอสเปรสโซ่ร้อน', 'espresso (hot)', 'hot espresso'], 'menu-images/espresso-hot.png'],
    [['เอสเพรสโซ่เย็น', 'เอสเปรสโซ่เย็น', 'iced espresso'], 'menu-images/espresso-iced.png'],
    [['อเมริกาโน่', 'americano'], 'menu-images/americano-iced.png'],
    [['คาปูชิโน่', 'cappuccino'], 'menu-images/cappuccino-hot.png'],
    [['คาราเมลมัคคิอาโต้', 'คาราเมลมัคคิอาโต', 'caramel macchiato'], 'menu-images/caramel-macchiato-iced.png'],
    [['มัทฉะ', 'matcha'], 'menu-images/matcha-latte.png'],
    [['มอคค่า', 'mocha'], 'menu-images/mocha-iced.png'],
    [['ลาเต้', 'latte'], 'menu-images/latte-iced.png'],
    [['ชาไทย', 'thai tea'], 'menu-images/thai-tea.png'],
    [['ไข่กระทะ'], 'menu-images/pan-fried-eggs.png'],
    [['ทับทิมกรอบ'], 'menu-images/tub-tim-krob.png'],
    [['ชีสเบอร์เกอร์'], 'menu-images/cheese-burger.png'],
    [['ไส้กรอก'], 'menu-images/sausage-burger.png'],
    [['เบคอน'], 'menu-images/bacon-burger.png'],
    [['แฮมเบอร์เกอร์หมู'], 'menu-images/pork-burger-set.png'],
    [['เบอร์เกอร์', 'hamburger'], 'menu-images/classic-burger.png']
  ];
  return matches.find(([keywords]) => keywords.some(keyword => name.includes(keyword)))?.[1] || '';
};

function showNotice(msg, type = 'success') {
  const el = $('#notice');
  if (!el) return;
  el.textContent = msg;
  el.className = type;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.textContent = ''; el.className = ''; }, 4000);
}

function setSystemStatus(mode, message) {
  const status = $('#system-status');
  if (!status) return;
  status.classList.remove('is-connecting', 'is-error');
  if (mode === 'connecting') status.classList.add('is-connecting');
  if (mode === 'error') status.classList.add('is-error');
  const label = status.querySelector('span');
  if (label) label.textContent = message;
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
  setSystemStatus('connecting', window.useFirebaseStore ? 'กำลังเชื่อมต่อ Firebase' : 'กำลังโหลดข้อมูล');
  const savedCart = state.cart;
  const savedCategory = state.selectedCategory;
  const savedStockCat = state.selectedStockCategory;

  try {
    const boot = await api('/api/bootstrap');
    state.products = (boot.products || []).map(item => ({ ...item, name: displayName(item) }));
    state.features = boot.features || {};
    state.categories = boot.categories || [];
    state.inventory = (boot.inventory || []).map(item => ({ ...item, name: displayName(item) }));
    state.channels = boot.channels || [];
    state.channelPrices = boot.channelPrices || [];
    state.optionGroups = normalizeCustomOptionGroups(boot.optionGroups || []);
    state.bestSellers = Array.isArray(boot.bestSellers) ? boot.bestSellers : [];
    state.loyaltySettings = normalizeLoyaltySettings(boot.loyaltySettings);
    state.cart = savedCart.flatMap(item => {
      const product=state.products.find(entry=>String(entry.id)===String(item.product?.id));
      if(!product)return [];
      const options=sanitizeCartOptions(product,item.options);
      return [{...item,product,options,key:`${product.id}:${JSON.stringify(options)}`}];
    });
    renderOnlineChannelOptions();
    state.selectedCategory = savedCategory === 'all'
      || state.categories.some(category => String(category.category_key) === String(savedCategory))
      ? savedCategory
      : 'all';
    state.selectedStockCategory = savedStockCat;
    syncProductCategoryOptions();

    // Fetch recipes only if feature enabled (fallback to empty on 403)
    try {
      state.recipesData = (await api('/api/recipes')).map(recipe => ({ ...recipe, name: displayName(recipe), items: (recipe.items || []).map(item => ({ ...item, name: displayName(item) })) }));
    } catch {
      state.recipesData = [];
    }

    applyFeatureState();
    renderProducts();
    renderCart();

    const todayStats = await api('/api/reports/today');
    const salesEl = $('#sales');
    const ordersEl = $('#orders');
    if (salesEl) salesEl.textContent = money(todayStats.storeSales ?? todayStats.sales);
    if (ordersEl) ordersEl.textContent = todayStats.storeOrders ?? todayStats.orders;
    if ($('#online-sales')) $('#online-sales').textContent = money(todayStats.onlineNet ?? todayStats.onlineSales);
    if ($('#online-orders')) $('#online-orders').textContent = `${todayStats.onlineOrders || 0} บิล`;

    await renderQuickBrewQueue();
    setSystemStatus('ready', 'พร้อมขาย');
  } catch (e) {
    setSystemStatus('error', 'เชื่อมต่อไม่สำเร็จ');
    showNotice(e.message, 'error');
  }
}

function selectedOnlineChannel() {
  const key = $('#online-channel')?.value;
  return state.channels.find(channel => channel.channel_key === key) || null;
}
function saleBasePrice(product) {
  const online=document.querySelector('input[name="sale-channel"]:checked')?.value==='online';
  const channel=online?selectedOnlineChannel():null;
  if(!channel)return Number(product?.price||0);
  const saved=state.channelPrices.find(row=>String(row.product_id)===String(product?.id)&&row.channel_key===channel.channel_key);
  return saved&&Number.isFinite(Number(saved.sale_price))?Number(saved.sale_price):Number(product?.price||0);
}
function cartUnitPrice(item){return saleBasePrice(item.product)+modifierExtra(item.options||{},item.product);}
function repriceCart(){state.cart.forEach(item=>{item.unitPrice=cartUnitPrice(item);});}

function updateOnlineChannelUI() {
  const online = document.querySelector('input[name="sale-channel"]:checked')?.value === 'online';
  const fields = $('#online-channel-fields');
  if (fields) fields.hidden = !online;
  const paymentField = $('#payment-field');
  const paymentSelect = $('#payment');
  if (paymentField) paymentField.hidden = online;
  if (paymentSelect) paymentSelect.disabled = online;
  const channel = selectedOnlineChannel();
  const summary = $('#online-gp-summary');
  if (!summary) return;
  if (!online) summary.textContent = '';
  else if (!channel || Number(channel.gp_percent) <= 0) summary.textContent = '⚠ กรุณาตั้งค่า GP จริงของร้านก่อนบันทึกขายออนไลน์';
  else summary.textContent = `GP ตามสัญญา ${Number(channel.gp_percent).toFixed(2)}% · ระบบคำนวณยอดสุทธิหลังหัก GP`;
  repriceCart();
  renderProducts();
  renderCart();
}

function renderOnlineChannelOptions() {
  const select = $('#online-channel');
  if (!select) return;
  const previous = select.value;
  select.replaceChildren(...state.channels.map(channel => {
    const option = document.createElement('option');
    option.value = channel.channel_key;
    option.textContent = `${channel.name} — GP ${Number(channel.gp_percent || 0).toFixed(2)}%`;
    return option;
  }));
  if (state.channels.some(channel => channel.channel_key === previous)) select.value = previous;
  updateOnlineChannelUI();
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
    ['inventory', '📦 สต็อกและต้นทุน'], ['pricing', '💰 ราคาออนไลน์ / GP'], ['members', '👤 สมาชิก'], ['reports', '📊 รายงาน'],
    ['settings', '⚙️ ตั้งค่าร้าน']
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
  if (key === 'settings') { openAdminWindow('tab-features', 'ตั้งค่าร้าน'); return; }
  if (key === 'inventory' || key === 'members' || key === 'recipes' || key === 'products' || key === 'pricing') {
    const tab = key === 'products' || key === 'recipes' ? 'tab-products' : key === 'pricing' ? 'tab-pricing' : key === 'members' ? 'tab-members' : 'tab-inventory';
    const title = key === 'products' || key === 'recipes' ? 'จัดการเมนูและสูตรชง' : key === 'pricing' ? 'ราคาออนไลน์และต้นทุน' : key === 'members' ? 'ระบบสมาชิก' : 'สต็อกวัตถุดิบ';
    openAdminWindow(tab, title);
    if (key === 'members') { renderLoyaltySettings(); renderAdminMembers(); }
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

function syncProductCategoryOptions(preferredCategory = '') {
  const select = $('#edit-prod-category');
  if (!select) return;

  const previousValue = String(preferredCategory || select.value || '');
  const categories = Array.isArray(state.categories) ? state.categories : [];
  const options = categories.map(category => new Option(
    displayName(category) || String(category.category_key),
    String(category.category_key)
  ));
  const hasPreviousCategory = previousValue
    && categories.some(category => String(category.category_key) === previousValue);

  if (previousValue && !hasPreviousCategory) {
    options.push(new Option(`${previousValue} (หมวดหมู่เดิม)`, previousValue));
  }
  if (!options.length) {
    options.push(new Option('ยังไม่มีหมวดหมู่ — กรุณาสร้างหมวดหมู่ก่อน', ''));
  }

  select.replaceChildren(...options);
  select.disabled = categories.length === 0 && !previousValue;
  select.value = previousValue && (hasPreviousCategory || options.some(option => option.value === previousValue))
    ? previousValue
    : String(categories[0]?.category_key || '');
}

function getStockStatus(product) {
  if (product.deduct_stock === 0 || product.deduct_stock === false || (window.useFirebaseStore && product.deduct_stock == null)) return 'ok';
  const recipe = state.recipesData.find(r => r.id === product.id);
  let isOut = false, isLow = false;

  if (recipe && recipe.items && recipe.items.length) {
    for (const ri of recipe.items) {
      const stock = state.inventory.find(x => x.stock_key === ri.stock_key);
      if (!stock) continue;
      if (stock.quantity <= 0) isOut = true;
      else if (stock.quantity <= stock.low_alert) isLow = true;
    }
  } else {
    return 'missing-recipe';
  }
  return isOut ? 'out' : isLow ? 'low' : 'ok';
}

let modifierProduct = null;
let modifierOptions = { custom: {}, custom_labels: [] };
const makeOptionId = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
function normalizeCustomOptionGroups(raw) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
    if (!Array.isArray(value)) return [];
    return value.slice(0, 12).map((group, groupIndex) => ({
      id: String(group.id || `group_${groupIndex}`),
      name: String(group.name || '').trim(),
      sort_order: Number.isFinite(Number(group.sort_order)) ? Number(group.sort_order) : groupIndex,
      choices: (Array.isArray(group.choices) ? group.choices : []).slice(0, 20).map((choice, choiceIndex) => ({
        id: String(choice.id || `choice_${groupIndex}_${choiceIndex}`),
        label: String(choice.label || '').trim(),
        price: Math.max(0, Number(choice.price) || 0),
        online_price: choice.online_price == null || choice.online_price === ''
          ? null
          : Math.max(0, Number(choice.online_price) || 0)
      })).filter(choice => choice.label)
    })).filter(group => group.name && group.choices.length);
  } catch { return []; }
}
const productOptionGroups = product => normalizeCustomOptionGroups(product?.custom_options ?? product?.custom_options_json);
function sanitizeCartOptions(product,raw={}) {
  const custom={},custom_labels=[];
  productOptionGroups(product).forEach(group=>{
    const choice=group.choices.find(item=>String(item.id)===String(raw?.custom?.[group.id]));
    if(choice){custom[group.id]=choice.id;custom_labels.push(`${group.name}: ${choice.label}`);}
  });
  return {custom,custom_labels};
}
function normalizeLoyaltySettings(raw={}) {
  const rewardPoints=Math.min(999,Math.max(1,Math.round(Number(raw?.rewardPoints)||10)));
  const rewardDiscountAmount=Math.max(1,Number(raw?.rewardDiscountAmount)||50);
  const rewardMaxPrice=Math.max(0,Number(raw?.rewardMaxPrice)||0);
  return {
    mode:['all','category','product'].includes(raw?.mode)?raw.mode:'category',
    categoryKeys:[...new Set((Array.isArray(raw?.categoryKeys)?raw.categoryKeys:['coffee','tea']).map(String))],
    productIds:[...new Set((Array.isArray(raw?.productIds)?raw.productIds:[]).map(String))],
    earnStore:raw?.earnStore!==false,
    earnOnline:raw?.earnOnline!==false,
    rewardPoints,
    rewardType:['free_product','fixed_discount'].includes(raw?.rewardType)?raw.rewardType:'free_product',
    rewardMode:['all','category','product'].includes(raw?.rewardMode)?raw.rewardMode:'category',
    rewardCategoryKeys:[...new Set((Array.isArray(raw?.rewardCategoryKeys)?raw.rewardCategoryKeys:['coffee','tea']).map(String))],
    rewardProductIds:[...new Set((Array.isArray(raw?.rewardProductIds)?raw.rewardProductIds:[]).map(String))],
    rewardDiscountAmount,
    rewardMaxPrice
  };
}
const loyaltyRewardProductEligible=(product,settings=state.loyaltySettings)=>
  settings.rewardMode==='all'
  ||(settings.rewardMode==='category'&&settings.rewardCategoryKeys.includes(String(product.category)))
  ||(settings.rewardMode==='product'&&settings.rewardProductIds.includes(String(product.id)));
function loyaltyRewardForCart() {
  const settings=state.loyaltySettings;
  if(settings.rewardType==='fixed_discount')return {discount:settings.rewardDiscountAmount,label:`ส่วนลด ${money(settings.rewardDiscountAmount)}`};
  const eligible=state.cart.filter(item=>loyaltyRewardProductEligible(item.product,settings));
  if(!eligible.length)return {discount:0,label:'สินค้าในรายการรางวัล'};
  const line=eligible.reduce((best,item)=>(item.unitPrice||item.product.price)<(best.unitPrice||best.product.price)?item:best,eligible[0]);
  const price=Number(line.unitPrice||line.product.price);
  return {discount:settings.rewardMaxPrice>0?Math.min(price,settings.rewardMaxPrice):price,label:`ฟรี ${displayName(line.product)}`};
}
function modifierExtra(options, product) {
  let extra = 0;
  const online = document.querySelector('input[name="sale-channel"]:checked')?.value === 'online';
  productOptionGroups(product).forEach(group => {
    const choice = group.choices.find(item => item.id === options?.custom?.[group.id]);
    extra += Number(online ? (choice?.online_price ?? choice?.price ?? 0) : (choice?.price ?? 0));
  });
  return extra;
}
function modifierSummary(options, product) {
  const custom = Array.isArray(options?.custom_labels) ? options.custom_labels : productOptionGroups(product).map(group => {
    const choice = group.choices.find(item => item.id === options?.custom?.[group.id]);
    return choice ? `${group.name}: ${choice.label}` : '';
  }).filter(Boolean);
  return custom.join(' · ');
}
function openModifierModal(product) {
  modifierProduct=product;
  modifierOptions={custom:{},custom_labels:[]};
  $('#modifier-title').textContent=`${product.emoji} ${product.name}`;
  renderModifierModal();
  $('#modifier-dialog')?.showModal();
}
function renderModifierModal() {
  const root=$('#modifier-options'); if(!root || !modifierProduct) return; root.replaceChildren();
  productOptionGroups(modifierProduct).forEach(group => {
    const sec=document.createElement('section');sec.className='modifier-group';const h=document.createElement('h3');h.textContent=group.name;const row=document.createElement('div');row.className='modifier-choice-row';
    const none=document.createElement('button');none.type='button';none.textContent='ไม่เลือก';none.className=modifierOptions.custom[group.id]?'':'selected';none.onclick=()=>{delete modifierOptions.custom[group.id];renderModifierModal();};row.append(none);
    group.choices.forEach(choice => { const button=document.createElement('button');button.type='button';const price=modifierExtra({custom:{[group.id]:choice.id}},modifierProduct);button.textContent=`${choice.label}${price ? ` +${money(price)}` : ''}`;button.className=modifierOptions.custom[group.id]===choice.id?'selected':'';button.onclick=()=>{modifierOptions.custom[group.id]=choice.id;renderModifierModal();};row.append(button); });
    sec.append(h,row);root.append(sec);
  });
  $('#modifier-price').textContent=money(saleBasePrice(modifierProduct)+modifierExtra(modifierOptions,modifierProduct));
}
function confirmModifier() {
  if(!modifierProduct) return;
  const customLabels=productOptionGroups(modifierProduct).map(group=>{const choice=group.choices.find(item=>item.id===modifierOptions.custom[group.id]);return choice?`${group.name}: ${choice.label}`:'';}).filter(Boolean);
  addToCart(modifierProduct,{custom:{...modifierOptions.custom},custom_labels:customLabels});
  $('#modifier-dialog')?.close();
}

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

  const showBestSellers = state.selectedCategory === 'all' && !($('#search')?.value || '').trim();
  const bestsellerRank = new Map(state.bestSellers.map((item,index)=>[String(item.product_id),{rank:index+1,qty:Number(item.qty)||0}]));
  const best = showBestSellers
    ? items.filter(product=>bestsellerRank.has(String(product.id))).sort((a,b)=>bestsellerRank.get(String(a.id)).rank-bestsellerRank.get(String(b.id)).rank)
    : [];
  const rest = showBestSellers ? items.filter(product=>!bestsellerRank.has(String(product.id))) : items;
  const orderedItems = [...best,...rest];
  if (showBestSellers && best.length) {
    const heading=document.createElement('div');heading.className='catalog-list-heading bestseller-heading';heading.textContent='🔥 เมนูขายดี เรียงตามจำนวนที่ขายได้';root.append(heading);
  }

  orderedItems.forEach((p,index) => {
    if (showBestSellers && rest.length && index === best.length) {
      const heading=document.createElement('div');heading.className='catalog-list-heading';heading.textContent=best.length?'เมนูอื่น ๆ':'เมนูทั้งหมด';root.append(heading);
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'product-card-wrapper';
    const status = getStockStatus(p);

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'product' + (status === 'out' || status === 'missing-recipe' ? ' product-out' : '');
    card.disabled = status === 'out' || status === 'missing-recipe';

    const imagePath = menuImageFor(p);
    const visual = imagePath ? document.createElement('img') : document.createElement('span');
    if (imagePath) {
      visual.src = new URL(imagePath, document.baseURI).href;
      visual.alt = p.name;
      visual.className = 'product-image';
      visual.loading = 'lazy';
    } else {
      visual.textContent = p.emoji;
    }
    const name = document.createElement('b');
    name.textContent = p.name;
    const price = document.createElement('small');
    price.textContent = money(saleBasePrice(p));
    card.append(visual, name, price);

    const bestseller=bestsellerRank.get(String(p.id));
    if(showBestSellers && bestseller) {
      const badge=document.createElement('span');
      badge.className='bestseller-badge';
      badge.textContent=`ขายดี #${bestseller.rank} · ${bestseller.qty} ชิ้น`;
      name.before(badge);
    }

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
    if (status === 'missing-recipe') {
      const badge = document.createElement('span'); badge.className = 'stock-badge empty'; badge.textContent = 'ยังไม่มีสูตร'; card.append(badge);
    }

    let pressTimer, longPressed = false;
    card.onclick = () => {
      if (longPressed) { longPressed = false; return; }
      if (productOptionGroups(p).length) openModifierModal(p);
      else addToCart(p, {});
    };
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
          <span>• ${escapeHtml(x.name)}</span>
          <span style="font-weight:700;color:var(--primary)">${escapeHtml(x.quantity)} ${escapeHtml(x.unit)}</span>
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
  // Menus that do not deduct stock can be sold without a recipe. Firebase
  // legacy products have no deduct_stock field, so keep them sellable too.
  const deductsStock = product.deduct_stock === true || product.deduct_stock === 1;
  if (!deductsStock) return { ok: true };

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
  } else {
    return { ok:false, msg:`เมนู "${product.name}" ยังไม่มีสูตรชง กรุณาตั้งสูตรก่อนขาย` };
  }
  return { ok: true };
}

function addToCart(product, options = {}) {
  const check = canAddToCart(product, 1);
  if (!check.ok) return showNotice(check.msg, 'error');
  const key = `${product.id}:${JSON.stringify(options)}`;
  const existing = state.cart.find(x => x.key === key);
  if (existing) existing.qty++;
  else state.cart.push({ product, options, unitPrice: saleBasePrice(product) + modifierExtra(options, product), key, qty: 1 });
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
      const optionSummary = modifierSummary(item.options || {}, item.product);
      info.textContent = `${item.product.name}${optionSummary ? ` — ${optionSummary}` : ''}`;

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
  if (useFreeCupEl && useFreeCupEl.checked && currentMember && currentMember.points >= state.loyaltySettings.rewardPoints) {
    const reward=loyaltyRewardForCart();
    memberDiscount=Math.min(subtotal,reward.discount);
    if(memberDiscount<=0) {
      useFreeCupEl.checked = false;
      showNotice('ตะกร้ายังไม่มีสินค้าที่ใช้แลกรางวัลได้', 'error');
    }
  }

  const manualDisc = Math.min(Number($('#discount')?.value) || 0, subtotal - memberDiscount);
  const disc = memberDiscount + manualDisc;
  const total = subtotal - disc;
  const totalEl = $('#total');
  if (totalEl) {
    if (memberDiscount > 0) {
      totalEl.innerHTML = `${money(total)} <small style="font-size:11px;color:#27ae60;display:block;">(รางวัลสมาชิก -${money(memberDiscount)})</small>`;
    } else {
      totalEl.textContent = money(total);
    }
  }
  const countEl = $('#count');
  const itemCount = state.cart.reduce((s, x) => s + x.qty, 0);
  if (countEl) countEl.textContent = itemCount;
  const mobileSummary = $('#mobile-cart-summary');
  if (mobileSummary) mobileSummary.textContent = `${itemCount} รายการ · ${money(total)}`;
}

function setMobileCartOpen(open) {
  const cart=$('.cart');
  const toggle=$('#mobile-cart-toggle');
  if(!cart||!toggle)return;
  const active=Boolean(open)&&window.matchMedia('(max-width:800px)').matches;
  cart.classList.toggle('mobile-open',active);
  toggle.setAttribute('aria-expanded',String(active));
  document.body.classList.toggle('mobile-cart-open',active);
  if(active)cart.scrollTop=0;
}

// ── Member lookup ─────────────────────────────────────────────
let memberSearchSequence=0;
let memberSearchTimer=null;
async function searchMember() {
  const sequence=++memberSearchSequence;
  const phone = ($('#member-phone')?.value || '').replace(/\D/g, '');
  const info = $('#member-info');
  const regBtn = $('#register-member-btn');
  const nameInput = $('#quick-member-name');
  const redeemRow = $('#member-redeem-row');
  const useFreeCupEl = $('#member-use-free-cup');
  
  currentMember = null;
  if (redeemRow) redeemRow.style.display = 'none';
  if (useFreeCupEl) useFreeCupEl.checked = false;
  
  if (phone.length < 9) {
    if (info) { info.textContent = ''; info.className = 'member-info'; }
    if (regBtn) regBtn.style.display = 'none';
    if (nameInput) nameInput.style.display = 'none';
    renderCart();
    return;
  }
  try {
    const member = await api(`/api/members/${phone}`);
    if(sequence!==memberSearchSequence)return;
    if (info) { info.textContent = `✓ ${member.name} (สะสม ${member.points} แต้ม)`; info.className = 'member-info success'; }
    if (regBtn) regBtn.style.display = 'none';
    if (nameInput) nameInput.style.display = 'none';
    currentMember = member;
    const rewardLabel=$('#member-reward-label');
    if(rewardLabel)rewardLabel.textContent=`🎁 ${state.loyaltySettings.rewardType==='fixed_discount'?`ใช้ส่วนลด ${money(state.loyaltySettings.rewardDiscountAmount)}`:'ใช้สิทธิ์รับสินค้าฟรี'} (ใช้ ${state.loyaltySettings.rewardPoints} แต้ม)`;
    if (member.points >= state.loyaltySettings.rewardPoints) {
      if (redeemRow) redeemRow.style.display = 'flex';
    }
    renderCart();
  } catch {
    if(sequence!==memberSearchSequence)return;
    if (info) { info.textContent = '❌ ไม่พบสมาชิก'; info.className = 'member-info error'; }
    if (regBtn) regBtn.style.display = 'inline-block';
    if (nameInput) nameInput.style.display = 'block';
    renderCart();
  }
}

$('#member-phone') && ($('#member-phone').oninput = () => { memberSearchSequence++;clearTimeout(memberSearchTimer);memberSearchTimer=setTimeout(searchMember,250); });
$('#member-use-free-cup') && ($('#member-use-free-cup').onchange = () => renderCart());

const regMemberBtn = $('#register-member-btn');
if (regMemberBtn) {
  regMemberBtn.onclick = async () => {
    const phone = ($('#member-phone')?.value || '').replace(/\D/g, '');
    const name = ($('#quick-member-name')?.value || '').trim();
    if (!phone || !name) return showNotice('กรอกเบอร์โทรและชื่อสมาชิกก่อนสมัคร', 'error');
    try {
      await api('/api/members', { method: 'POST', body: JSON.stringify({ phone, name }) });
      showNotice('สมัครสมาชิกด่วนสำเร็จ!');
      if ($('#quick-member-name')) $('#quick-member-name').value = '';
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
  if (useFreeCupEl && useFreeCupEl.checked && currentMember && currentMember.points >= state.loyaltySettings.rewardPoints) {
    memberDiscount=Math.min(subtotal,loyaltyRewardForCart().discount);
    if(memberDiscount<=0)return showNotice('ตะกร้ายังไม่มีสินค้าที่ใช้แลกรางวัลได้','error');
  }

  const manualDisc = Math.min(Number($('#discount')?.value) || 0, subtotal - memberDiscount);
  const disc = memberDiscount + manualDisc;
  const total = subtotal - disc;
  const salesChannel = document.querySelector('input[name="sale-channel"]:checked')?.value || 'store';
  const payType = salesChannel === 'online' ? 'online' : ($('#payment')?.value || 'cash');
  const onlineChannel = salesChannel === 'online' ? selectedOnlineChannel() : null;
  const gpPercent = onlineChannel ? Number(onlineChannel.gp_percent || 0) : 0;
  if (salesChannel === 'online' && (!onlineChannel || gpPercent <= 0)) return showNotice('กรุณาตั้งค่า GP จริงของแพลตฟอร์มก่อนขายออนไลน์', 'error');
  const redeemFreeCup = memberDiscount > 0;

  checkoutPayload = {
    items: state.cart.map(x => ({ productId: x.product.id, quantity: x.qty, options: x.options })),
    discount: disc,
    manualDiscount: manualDisc,
    totalDue: total,
    paymentType: payType,
    salesChannel,
    onlinePlatform: onlineChannel?.channel_key || null,
    gpPercent,
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
    if ($('#member-info')) { $('#member-info').textContent=''; $('#member-info').className='member-info'; }
    if ($('#quick-member-name')) { $('#quick-member-name').value=''; $('#quick-member-name').style.display='none'; }
    if ($('#register-member-btn')) $('#register-member-btn').style.display='none';
    currentMember = null;
    checkoutPayload = null;
    
    // Hide redeem free cup row
    const redeemRow = $('#member-redeem-row');
    if (redeemRow) redeemRow.style.display = 'none';
    const useFreeCupEl = $('#member-use-free-cup');
    if (useFreeCupEl) useFreeCupEl.checked = false;

    await load();
    setMobileCartOpen(false);
    showReceipt(order);
  } catch (e) {
    showNotice(e.message, 'error');
  }
}

// ── E-Receipt display ─────────────────────────────────────────
function receiptModifierDetails(item) {
  let options=item?.options;
  if(!options&&item?.options_json)try{options=typeof item.options_json==='string'?JSON.parse(item.options_json):item.options_json;}catch{}
  if(Array.isArray(options?.custom_details))return options.custom_details.map(detail=>({
    text:`${detail.group}: ${detail.label}`,
    price:Math.max(0,Number(detail.price)||0)
  }));
  return (Array.isArray(options?.custom_labels)?options.custom_labels:[]).map(text=>({text:String(text),price:0}));
}

function showReceipt(order) {
  const dlg = $('#receipt-dialog');
  if (!dlg) return;
  const paymentType=order.paymentType||order.payment_type||'cash';
  const memberPhone=order.memberPhone||order.member_phone||null;

  const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  set('#receipt-date', `วันที่: ${new Date(order.createdAt || order.created_at).toLocaleString('th-TH')}`);
  set('#receipt-tx', `บิล: ${order.id}`);

  const itemsEl = $('#receipt-items');
  if (itemsEl) {
    const items = order.items || [];
    if (items.length) {
      itemsEl.innerHTML = items.map(x => {
        const quantity=Number(x.quantity)||0,unitPrice=Number(x.unit_price)||0;
        const modifiers=receiptModifierDetails(x).map(detail=>
          `<div style="display:flex;justify-content:space-between;padding-left:12px;color:#555;font-size:10px;">
            <span>+ ${escapeHtml(detail.text)}</span>
            <span>${detail.price>0?`${money(detail.price)} / item`:''}</span>
          </div>`
        ).join('');
        return `<div style="margin-bottom:6px;">
          <div style="display:flex;justify-content:space-between;">
            <span>${escapeHtml(x.name)} ×${escapeHtml(quantity)}</span>
            <span>${money(unitPrice*quantity)}</span>
          </div>
          ${modifiers}
        </div>`;
      }).join('');
    } else {
      itemsEl.innerHTML = '<p style="margin:0;color:#888;font-size:10px;">ไม่พบรายละเอียดสินค้า</p>';
    }
  }

  set('#receipt-subtotal', money(order.subtotal));
  set('#receipt-discount', money(order.discount));
  set('#receipt-total', money(order.total));
  set('#receipt-payment', paymentType === 'online' ? 'ออนไลน์ผ่านแพลตฟอร์ม 🌐' : paymentType === 'cash' ? 'เงินสด 💵' : 'สแกน QR 📱');
  set('#receipt-tx', `บิล: ${order.id} · ${order.salesChannel === 'online' || order.sales_channel === 'online' ? 'ออนไลน์' : 'หน้าร้าน'}`);

  const cashRows = ['#receipt-cash-received-row', '#receipt-cash-change-row'];
  cashRows.forEach(s => { const el = $(s); if (el) el.style.display = paymentType === 'cash' ? 'flex' : 'none'; });
  if (paymentType === 'cash') {
    set('#receipt-received', money(order.received));
    set('#receipt-change', money(order.changeDue ?? order.change_due));
  }

  const mRow = $('#receipt-member-row');
  if (mRow) {
    if (memberPhone) {
      mRow.style.display = 'flex';
      const ptEl = mRow.querySelector('span:last-child') || $('#receipt-member-points');
      if (ptEl) ptEl.textContent = order.memberPoints==null ? `สมาชิก ${memberPhone}` : `${order.pointsEarned==null?'':`+${order.pointsEarned} แต้ม · `}สะสมรวม ${order.memberPoints} แต้ม (${memberPhone})`;
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
  const total = Number.isFinite(Number(checkoutPayload?.totalDue)) ? Number(checkoutPayload.totalDue) : subtotal - disc;
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
    const total = Number.isFinite(Number(checkoutPayload?.totalDue)) ? Number(checkoutPayload.totalDue) : subtotal - disc;
    const val = btn.getAttribute('data-value');
    const received = val === 'exact' ? total : Number(val);
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
    const total = Number.isFinite(Number(checkoutPayload?.totalDue)) ? Number(checkoutPayload.totalDue) : subtotal - disc;
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
function populateReportFilters() {
  const category=$('#report-category'),product=$('#report-product');
  if(category&&category.options.length<=1){
    state.categories.forEach(row=>category.add(new Option(displayName(row)||row.category_key,row.category_key)));
  }
  if(product&&product.options.length<=1){
    state.products.slice().sort((a,b)=>a.name.localeCompare(b.name,'th')).forEach(row=>product.add(new Option(row.name,String(row.id))));
  }
}
function reportQueryString() {
  const params=new URLSearchParams(),fields={
    dateFrom:$('#report-date-from')?.value,
    dateTo:$('#report-date-to')?.value,
    category:$('#report-category')?.value,
    productId:$('#report-product')?.value,
    salesChannel:$('#report-sales-channel')?.value
  };
  if(fields.dateFrom&&fields.dateTo&&fields.dateFrom>fields.dateTo)throw new Error('Start date must not be after end date');
  Object.entries(fields).forEach(([key,value])=>{if(value)params.set(key,value);});
  const value=params.toString();return value?`?${value}`:'';
}
function renderReportRanking(selector,rows,valueLabel) {
  const root=$(selector);if(!root)return;root.replaceChildren();
  if(!rows?.length){root.innerHTML='<p style="color:#aaa;font-size:12px;">No data</p>';return;}
  rows.forEach((row,index)=>{
    const item=document.createElement('div');item.className='report-ranking-row';
    const label=document.createElement('span');label.textContent=`${index+1}. ${row.name}`;
    const value=document.createElement('strong');value.textContent=valueLabel(row);
    item.append(label,value);root.append(item);
  });
}

const reportsBtn = $('#reportsBtn');
if (reportsBtn) {
  reportsBtn.onclick = async () => {
    if (!state.features.reports) return;
    try {
      populateReportFilters();
      const query=reportQueryString();
      const [analytics, transactions] = await Promise.all([
        api(`/api/reports/analytics${query}`),
        api(`/api/reports/transactions${query}`)
      ]);

      const storeTransactions = transactions.filter(order => (order.sales_channel || 'store') !== 'online');
      const onlineTransactions = transactions.filter(order => order.sales_channel === 'online');
      const totalSales = Number(analytics.summary?.totalSales ?? transactions.reduce((sum,order)=>sum+Number(order.total||0),0));
      const totalBills = Number(analytics.summary?.totalOrders ?? transactions.length);
      const avgBill = Number(analytics.summary?.averageBill ?? (totalBills ? totalSales / totalBills : 0));

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
                <span>${escapeHtml(catNames[x.category] || x.category)}</span>
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
        const quantityRows=analytics.topByQuantity||analytics.topSellers||[];
        if (!quantityRows.length) {
          topEl.innerHTML = '<p style="color:#aaa;font-size:12px;">ยังไม่มีข้อมูล</p>';
        } else {
          quantityRows.forEach((x, i) => {
            const item = document.createElement('div');
            item.style.cssText = 'font-size:12px;display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f9f6f3;';
            item.innerHTML = `<span>${i + 1}. <b>${escapeHtml(x.name)}</b> (${escapeHtml(x.qty)} ชิ้น)</span><span style="font-weight:700;color:var(--primary);">${money(x.revenue)}</span>`;
            topEl.append(item);
          });
        }
      }
      renderReportRanking('#rep-top-revenue-list',analytics.topByRevenue||[],row=>money(row.revenue));
      renderReportRanking('#rep-top-addons-list',analytics.topAddons||[],row=>`${row.qty} ×${Number(row.revenue)>0?` · ${money(row.revenue)}`:''}`);

      // Payment methods
      const pmEl = $('#rep-payment-methods');
      if (pmEl) {
        const cashSales = Number(analytics.breakdown?.storeCash ?? storeTransactions.filter(x => x.payment_type === 'cash').reduce((sum,x)=>sum+x.total,0));
        const qrSales = Number(analytics.breakdown?.storeQr ?? storeTransactions.filter(x => x.payment_type === 'qr').reduce((sum,x)=>sum+x.total,0));
        const onlineSales = Number(analytics.breakdown?.onlineNet ?? onlineTransactions.reduce((sum,x)=>sum+Number(x.online_net ?? (x.total * (1 - Number(x.gp_percent || 0) / 100))),0));
        pmEl.innerHTML = `
          <div style="text-align:center;flex:1;">
            <div style="font-size:11px;color:#888;">💵 เงินสด</div>
            <div style="font-size:20px;font-weight:700;color:var(--primary);margin-top:4px;">${money(cashSales)}</div>
          </div>
          <div style="border-left:1px dashed #dfcec0;"></div>
          <div style="text-align:center;flex:1;">
            <div style="font-size:11px;color:#888;">📱 สแกน QR</div>
            <div style="font-size:20px;font-weight:700;color:var(--primary);margin-top:4px;">${money(qrSales)}</div>
          </div>
          <div style="border-left:1px dashed #dfcec0;"></div>
          <div style="text-align:center;flex:1;">
            <div style="font-size:11px;color:#888;">🌐 ออนไลน์สุทธิหลัง GP</div>
            <div style="font-size:20px;font-weight:700;color:#236b8e;margin-top:4px;">${money(onlineSales)}</div>
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
            const time = new Date(tx.created_at).toLocaleString('th-TH', {
              year: '2-digit',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            });
            const itemSummary = (tx.items || []).map(x => `${x.name}×${x.quantity}`).join(', ');
            row.innerHTML = `
              <div>
                <b>${escapeHtml(tx.id)}</b> <small style="color:#aaa;">(${escapeHtml(time)})</small>
                <div style="font-size:10.5px;color:#8c7366;margin-top:2px;">${escapeHtml(itemSummary || '—')}</div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                <strong style="color:var(--primary);">${money(tx.total)}</strong>
                <span style="font-size:10px;background:${tx.sales_channel === 'online' ? '#dff2fb' : '#f1ebe5'};padding:2px 6px;border-radius:4px;">${tx.sales_channel === 'online' ? 'ออนไลน์' : `หน้าร้าน · ${tx.payment_type === 'cash' ? 'เงินสด' : 'QR'}`}</span>
              </div>`;
            row.onclick = () => { $('#reports-dialog')?.close(); showReceipt({ ...tx, items: tx.items }); };
            txEl.append(row);
          });
        }
      }

      const dialog=$('#reports-dialog');if(dialog&&!dialog.open)dialog.showModal();
    } catch (e) { showNotice(e.message, 'error'); }
  };
}
$('#report-apply-filters') && ($('#report-apply-filters').onclick=()=>reportsBtn?.click());
$('#report-reset-filters') && ($('#report-reset-filters').onclick=()=>{
  ['#report-date-from','#report-date-to','#report-category','#report-product','#report-sales-channel'].forEach(selector=>{const element=$(selector);if(element)element.value='';});
  reportsBtn?.click();
});

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
$('#stock-material-filter') && ($('#stock-material-filter').onchange=e=>{state.selectedMaterialType=e.target.value;renderInventoryList();});

// ── Inventory list rendering ──────────────────────────────────
function renderInventoryList() {
  const container = $('#inventory');
  if (!container) return;
  const cat = state.selectedStockCategory;
  const type=state.selectedMaterialType; const items = state.inventory.filter(x => (cat === 'all' || x.category === cat) && (type === 'all' || (x.material_type||'other') === type));

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
    const materialLabels={coffee_beans:'เมล็ดกาแฟ',cocoa:'โกโก้',tea:'ชา',milk:'นม',sweetness:'ความหวาน',syrup:'ไซรัป',other:'อื่น ๆ'};
    details.textContent = `${catLabel} · ${materialLabels[x.material_type||'other']} · รหัส: ${x.stock_key} · ต้นทุน: ${money(x.cost_per_unit)}/${x.unit}`;
    
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
    adjustBtn.type = 'button';
    adjustBtn.textContent = '⊕ ปรับสต็อก';
    adjustBtn.className = 'primary-btn';
    adjustBtn.style.fontSize = '11px';
    adjustBtn.onclick = () => openStockAdjustDialog(x);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = '✏️ แก้ไข';
    editBtn.style.cssText = 'font-size:11px;';
    editBtn.onclick = () => openCostInventory(x);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
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

const moveArrayItem = (items,index,direction) => {
  const target=index+direction;
  if(target<0||target>=items.length)return items;
  const next=[...items];
  [next[index],next[target]]=[next[target],next[index]];
  return next;
};
function bindPressDragSort(container,rowSelector,onDrop) {
  if(!container)return;
  container.querySelectorAll('[data-sort-handle]').forEach(handle=>{
    handle.onpointerdown=event=>{
      if(event.button!==0)return;
      const row=handle.closest(rowSelector);
      if(!row)return;
      event.preventDefault();
      let dragging=false;
      const activate=setTimeout(()=>{
        dragging=true;
        row.classList.add('press-drag-active');
        container.classList.add('press-drag-sorting');
        try{handle.setPointerCapture(event.pointerId);}catch{}
        if(navigator.vibrate)navigator.vibrate(20);
      },220);
      const move=moveEvent=>{
        if(!dragging)return;
        moveEvent.preventDefault();
        const siblings=[...container.querySelectorAll(rowSelector)].filter(item=>item!==row);
        const before=siblings.find(item=>moveEvent.clientY<item.getBoundingClientRect().top+item.getBoundingClientRect().height/2);
        if(before)container.insertBefore(row,before);else container.append(row);
      };
      const finish=async finishEvent=>{
        clearTimeout(activate);
        handle.onpointermove=null;handle.onpointerup=null;handle.onpointercancel=null;
        if(!dragging)return;
        finishEvent.preventDefault();
        row.classList.remove('press-drag-active');
        container.classList.remove('press-drag-sorting');
        const ids=[...container.querySelectorAll(rowSelector)].map(item=>item.dataset.sortId).filter(Boolean);
        try{await onDrop(ids);}catch(error){showNotice(error.message,'error');}
      };
      handle.onpointermove=move;
      handle.onpointerup=finish;
      handle.onpointercancel=finish;
    };
  });
}
async function persistProductOrder(ids) {
  await api('/api/admin/products/order',{method:'PUT',body:JSON.stringify({ids})});
  await load();
  await adminLoad();
  showNotice('บันทึกลำดับเมนูแล้ว');
}
async function saveProductOrder(products,index,direction) {
  const ordered=moveArrayItem(products,index,direction);
  if(ordered===products)return;
  await persistProductOrder(ordered.map(item=>item.id));
}
async function persistCategoryOrder(ids) {
  await api('/api/admin/categories/order',{method:'PUT',body:JSON.stringify({ids})});
  await load();
  await adminLoad();
  showNotice('บันทึกลำดับหมวดหมู่แล้ว');
}
async function saveCategoryOrder(categories,index,direction) {
  const ordered=moveArrayItem(categories,index,direction);
  if(ordered===categories)return;
  await persistCategoryOrder(ordered.map(item=>item.category_key));
}
async function persistOptionGroupOrder(ids) {
  const editingId=optionGroupEditingId;
  await api('/api/admin/option-groups/order',{method:'PUT',body:JSON.stringify({ids})});
  await load();
  resetOptionGroupEditor(editingId?state.optionGroups.find(item=>item.id===editingId):null);
  renderCustomOptionEditor();
  showNotice('บันทึกลำดับกลุ่มตัวเลือกแล้ว');
}
async function saveOptionGroupOrder(index,direction) {
  const ordered=moveArrayItem(state.optionGroups,index,direction);
  if(ordered===state.optionGroups)return;
  await persistOptionGroupOrder(ordered.map(item=>item.id));
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
  state.channelPrices = boot.channelPrices || [];
  state.optionGroups = normalizeCustomOptionGroups(boot.optionGroups || []);
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

  // ② Keep product-editor categories in sync regardless of how the editor was opened.
  syncProductCategoryOptions();

  // ③ Products list in admin
  const [allProducts, costingRows] = await Promise.all([api('/api/admin/products'), api('/api/costing')]);
  const costingByProduct = Object.fromEntries(costingRows.map(row => [row.product_id, row]));
  const adminProdsEl = $('#admin-products');
  if (adminProdsEl) {
    adminProdsEl.replaceChildren();
    allProducts.forEach((p,index) => {
      const row = document.createElement('div');
      row.dataset.sortId=String(p.id);
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 4px;border-bottom:1px solid #f5f0eb;font-size:13px;';

      const info = document.createElement('span');
      info.innerHTML = `${escapeHtml(p.emoji)} <b>${escapeHtml(p.name)}</b> — <span style="color:var(--primary);">${money(p.price)}</span> <small style="color:#aaa;">(${escapeHtml(p.category)})</small>${p.active ? '' : ' <span style="color:#c0392b;font-size:10px;font-weight:700;">[ปิดขาย]</span>'}`;

      const costing = costingByProduct[p.id];
      const costInfo = document.createElement('small');
      costInfo.style.cssText = 'display:block;color:var(--text-muted);margin-top:2px;';
      costInfo.textContent = costing ? `ต้นทุน ${money(costing.cost)} · ราคาขาย ${money(p.price)} · กำไร ${money(costing.gross_profit)}` : `ราคาขาย ${money(p.price)}`;
      info.append(costInfo);

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = '✏️ แก้ไข';
      editBtn.style.cssText = 'border:1px solid #dfcec0;background:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;font-family:inherit;transition:all 0.15s;';
      editBtn.onmouseover = () => { editBtn.style.background = 'var(--primary)'; editBtn.style.color = '#fff'; };
      editBtn.onmouseout = () => { editBtn.style.background = '#fff'; editBtn.style.color = 'var(--text-main)'; };
      editBtn.onclick = () => openProductEditor(p);

      const actions=document.createElement('span');
      actions.className='admin-order-actions';
      const handle=document.createElement('button');handle.type='button';handle.className='press-drag-handle';handle.dataset.sortHandle='';handle.textContent='⠿';handle.title='แตะค้างแล้วลากเพื่อจัดลำดับ';handle.setAttribute('aria-label','ลากจัดลำดับเมนู');
      const up=document.createElement('button');up.type='button';up.textContent='↑';up.title='เลื่อนเมนูขึ้น';up.disabled=index===0;up.onclick=()=>saveProductOrder(allProducts,index,-1).catch(error=>showNotice(error.message,'error'));
      const down=document.createElement('button');down.type='button';down.textContent='↓';down.title='เลื่อนเมนูลง';down.disabled=index===allProducts.length-1;down.onclick=()=>saveProductOrder(allProducts,index,1).catch(error=>showNotice(error.message,'error'));
      actions.append(handle,up,down,editBtn);
      row.append(info, actions);
      adminProdsEl.append(row);
    });
    bindPressDragSort(adminProdsEl,'[data-sort-id]',persistProductOrder);
  }

  // ⑤ Categories table
  renderCategoriesTable();
  renderLoyaltySettings();

  // ⑥ GP channels
  const channelsEl = $('#channels');
  if (channelsEl) {
    channelsEl.replaceChildren(...boot.channels.map(ch => {
      const gpInput = Object.assign(document.createElement('input'), { type: 'number', min: 0, max: 99.99, step: 0.01, value: ch.gp_percent });
      gpInput.style.cssText = 'width:80px;padding:6px;font-size:12px;';
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
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
        ${state.categories.map((c,index) => `
          <tr data-sort-id="${escapeHtml(c.category_key)}" style="border-bottom:1px solid #faf6f2;">
            <td style="padding:8px;font-family:Courier,monospace;font-weight:600;">${escapeHtml(c.category_key)}</td>
            <td style="padding:8px;">${escapeHtml(c.name)}</td><td class="category-order-actions" style="padding:5px;white-space:nowrap;"><button type="button" class="press-drag-handle" data-sort-handle title="แตะค้างแล้วลากจัดลำดับ" aria-label="ลากจัดลำดับหมวดหมู่">⠿</button> <button type="button" data-category-up="${escapeHtml(c.category_key)}" ${index===0?'disabled':''} title="เลื่อนขึ้น">↑</button> <button type="button" data-category-down="${escapeHtml(c.category_key)}" ${index===state.categories.length-1?'disabled':''} title="เลื่อนลง">↓</button> <button type="button" data-edit-category="${escapeHtml(c.category_key)}" aria-label="แก้ไขหมวดหมู่ ${escapeHtml(c.name)}">✏️</button> <button type="button" data-delete-category="${escapeHtml(c.category_key)}" aria-label="ลบหมวดหมู่ ${escapeHtml(c.name)}">🗑️</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  const tbody=el.querySelector('tbody');
  bindPressDragSort(tbody,'tr[data-sort-id]',persistCategoryOrder);
  el.querySelectorAll('[data-category-up]').forEach(btn=>btn.onclick=()=>{const key=btn.getAttribute('data-category-up'),index=state.categories.findIndex(item=>item.category_key===key);saveCategoryOrder(state.categories,index,-1).catch(error=>showNotice(error.message,'error'));});
  el.querySelectorAll('[data-category-down]').forEach(btn=>btn.onclick=()=>{const key=btn.getAttribute('data-category-down'),index=state.categories.findIndex(item=>item.category_key===key);saveCategoryOrder(state.categories,index,1).catch(error=>showNotice(error.message,'error'));});
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

    const entries = Object.entries(productPrices);
    if (!entries.length) {
      container.innerHTML = '<p style="color:#aaa;font-size:12px;text-align:center;padding:10px;">ยังไม่มีสินค้า</p>';
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'delivery-table-wrap';
    const table = document.createElement('table');
    table.className = 'delivery-price-table';
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr><th>เมนู</th><th>หน้าร้าน</th>${state.channels.map(ch => `<th>${escapeHtml(ch.name)}<small>GP ${Number(ch.gp_percent||0).toFixed(2)}%</small></th>`).join('')}<th>บันทึก</th></tr>`;
    const tbody = document.createElement('tbody');
    entries.forEach(([prodId, p]) => {
      const row = document.createElement('tr');
      row.innerHTML = `<th>${escapeHtml(p.name)}</th><td>${money(p.store_price)}</td>`;
      state.channels.forEach(ch => {
        const item = p.channels[ch.channel_key];
        const suggested = Number(p.store_price / (1 - ch.gp_percent / 100)).toFixed(2);
        const cell = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'number'; input.min = '0'; input.step = '0.5';
        input.placeholder = suggested;
        input.value = item?.sale_price != null ? item.sale_price : suggested;
        input.dataset.productId = prodId;
        input.dataset.channelKey = ch.channel_key;
        input.setAttribute('aria-label', `${p.name} ${ch.name}`);
        cell.append(input);
        row.append(cell);
      });
      const action = document.createElement('td');
      const save = document.createElement('button');
      save.type = 'button'; save.className = 'primary-btn'; save.textContent = 'บันทึก';
      save.onclick = async () => {
        save.disabled = true;
        try {
          for (const input of row.querySelectorAll('input')) {
            await api('/api/admin/channel-prices', { method:'PUT', body:JSON.stringify({ productId:input.dataset.productId, channelKey:input.dataset.channelKey, salePrice:Number(input.value) }) });
            const saved=state.channelPrices.find(item=>String(item.product_id)===String(input.dataset.productId)&&item.channel_key===input.dataset.channelKey);
            if(saved)saved.sale_price=Number(input.value);
            else state.channelPrices.push({product_id:input.dataset.productId,channel_key:input.dataset.channelKey,sale_price:Number(input.value)});
          }
          repriceCart();renderProducts();renderCart();
          showNotice(`บันทึกราคา ${p.name} สำเร็จ`);
        } catch (error) { showNotice(error.message, 'error'); }
        finally { save.disabled = false; }
      };
      action.append(save); row.append(action); tbody.append(row);
    });
    table.append(thead, tbody); wrap.append(table); container.replaceChildren(wrap);
  } catch (e) {
    container.innerHTML = `<p style="color:#c0392b;font-size:12px;">${escapeHtml(e.message)}</p>`;
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

function renderCustomOptionEditor() {
  const root = $('#custom-option-groups-editor');
  if (!root) return;
  root.replaceChildren();
  if (!state.optionGroups.length) {
    root.innerHTML = '<div class="custom-option-empty">ยังไม่มีตัวเลือกในคลัง กด “จัดการคลังตัวเลือก” เพื่อสร้างประเภท ขนาด ซอส หรือท็อปปิ้งก่อน</div>';
    return;
  }
  root.className='product-option-picker';
  state.optionGroups.forEach(group => {
    const label=document.createElement('label');label.className='product-option-pick';
    const check=document.createElement('input');check.type='checkbox';check.checked=currentCustomOptionGroups.some(item=>item.id===group.id);
    const info=document.createElement('span');const title=document.createElement('strong');title.textContent=group.name;
    const summary=document.createElement('small');summary.textContent=group.choices.map(choice=>{const store=Number(choice.price)||0;const online=choice.online_price==null?store:Number(choice.online_price)||0;const prices=online===store?(store?` (+${money(store)})`:''):` (หน้าร้าน +${money(store)} / ออนไลน์ +${money(online)})`;return `${choice.label}${prices}`;}).join(' · ');
    info.append(title,summary);label.append(check,info);
    check.onchange=()=>{
      if(check.checked) currentCustomOptionGroups.push(structuredClone(group));
      else currentCustomOptionGroups=currentCustomOptionGroups.filter(item=>item.id!==group.id);
      renderCustomOptionEditor();
    };
    root.append(label);
  });
}

let optionGroupEditingId=null;
let optionGroupDraft={id:'',name:'',choices:[]};
function resetOptionGroupEditor(group=null){
  optionGroupEditingId=group?.id||null;
  optionGroupDraft=group?structuredClone(group):{id:makeOptionId('group'),name:'',choices:[{id:makeOptionId('choice'),label:'',price:0,online_price:null}]};
  if($('#option-group-name'))$('#option-group-name').value=optionGroupDraft.name;
  if($('#option-library-editor-title'))$('#option-library-editor-title').textContent=group?'แก้ไขกลุ่มตัวเลือก':'สร้างกลุ่มตัวเลือก';
  if($('#btn-delete-option-group'))$('#btn-delete-option-group').hidden=!group;
  renderOptionGroupChoices();renderOptionLibraryList();
}
function renderOptionGroupChoices(){
  const root=$('#option-group-choice-editor');if(!root)return;root.replaceChildren();
  optionGroupDraft.choices.forEach((choice,index)=>{
    const row=document.createElement('div');row.className='custom-choice-row';
    row.dataset.sortId=String(choice.id);
    const name=document.createElement('input');name.placeholder='ชื่อตัวเลือก เช่น เย็น';name.value=choice.label;name.oninput=()=>{choice.label=name.value;};
    const price=document.createElement('input');price.type='number';price.min='0';price.step='.5';price.placeholder='ราคาหน้าร้าน';price.value=choice.price;price.oninput=()=>{choice.price=Math.max(0,Number(price.value)||0);};
    const onlinePrice=document.createElement('input');onlinePrice.type='number';onlinePrice.min='0';onlinePrice.step='.5';onlinePrice.placeholder='ราคาออนไลน์';onlinePrice.value=choice.online_price??'';onlinePrice.title='เว้นว่างเพื่อใช้ราคาหน้าร้าน';onlinePrice.oninput=()=>{choice.online_price=onlinePrice.value===''?null:Math.max(0,Number(onlinePrice.value)||0);};
    const remove=document.createElement('button');remove.type='button';remove.className='secondary-btn';remove.textContent='×';remove.onclick=()=>{optionGroupDraft.choices=optionGroupDraft.choices.filter(item=>item!==choice);renderOptionGroupChoices();};
    const order=document.createElement('span');order.className='choice-order-actions';
    const handle=document.createElement('button');handle.type='button';handle.className='press-drag-handle';handle.dataset.sortHandle='';handle.textContent='⠿';handle.title='แตะค้างแล้วลากเพื่อจัดลำดับ';handle.setAttribute('aria-label','ลากจัดลำดับตัวเลือก');
    const up=document.createElement('button');up.type='button';up.textContent='↑';up.title='เลื่อนตัวเลือกขึ้น';up.disabled=index===0;up.onclick=()=>{optionGroupDraft.choices=moveArrayItem(optionGroupDraft.choices,index,-1);renderOptionGroupChoices();};
    const down=document.createElement('button');down.type='button';down.textContent='↓';down.title='เลื่อนตัวเลือกลง';down.disabled=index===optionGroupDraft.choices.length-1;down.onclick=()=>{optionGroupDraft.choices=moveArrayItem(optionGroupDraft.choices,index,1);renderOptionGroupChoices();};
    order.append(handle,up,down);
    row.append(name,price,onlinePrice,order,remove);root.append(row);
  });
  bindPressDragSort(root,'.custom-choice-row',ids=>{
    const positions=new Map(ids.map((id,index)=>[id,index]));
    optionGroupDraft.choices.sort((a,b)=>(positions.get(String(a.id))??0)-(positions.get(String(b.id))??0));
    renderOptionGroupChoices();
  });
}
function renderOptionLibraryList(){
  const root=$('#option-library-list');if(!root)return;root.replaceChildren();
  if(!state.optionGroups.length){root.innerHTML='<div class="custom-option-empty">ยังไม่มีตัวเลือกเพิ่มเติม</div>';return;}
  state.optionGroups.forEach((group,index)=>{const row=document.createElement('div');row.className='option-library-order-row';row.dataset.sortId=String(group.id);const button=document.createElement('button');button.type='button';button.className=`option-library-item${group.id===optionGroupEditingId?' selected':''}`;const text=document.createElement('span');const name=document.createElement('strong');name.textContent=group.name;const choices=document.createElement('small');choices.textContent=group.choices.map(item=>item.label).join(' · ');text.append(name,choices);button.append(text);button.onclick=()=>resetOptionGroupEditor(group);const controls=document.createElement('span');controls.className='choice-order-actions';const handle=document.createElement('button');handle.type='button';handle.className='press-drag-handle';handle.dataset.sortHandle='';handle.textContent='⠿';handle.title='แตะค้างแล้วลากเพื่อจัดลำดับ';handle.setAttribute('aria-label','ลากจัดลำดับกลุ่มตัวเลือก');const up=document.createElement('button');up.type='button';up.textContent='↑';up.title='เลื่อนกลุ่มขึ้น';up.disabled=index===0;up.onclick=()=>saveOptionGroupOrder(index,-1).catch(error=>showNotice(error.message,'error'));const down=document.createElement('button');down.type='button';down.textContent='↓';down.title='เลื่อนกลุ่มลง';down.disabled=index===state.optionGroups.length-1;down.onclick=()=>saveOptionGroupOrder(index,1).catch(error=>showNotice(error.message,'error'));controls.append(handle,up,down);row.append(button,controls);root.append(row);});
  bindPressDragSort(root,'.option-library-order-row',persistOptionGroupOrder);
}
function openOptionLibrary(){
  resetOptionGroupEditor();
  $('#option-library-dialog')?.showModal();
}
$('#btn-open-option-library') && ($('#btn-open-option-library').onclick=openOptionLibrary);
$('#btn-manage-options-from-product') && ($('#btn-manage-options-from-product').onclick=openOptionLibrary);
$('#btn-new-option-group') && ($('#btn-new-option-group').onclick=()=>resetOptionGroupEditor());
$('#btn-add-option-choice') && ($('#btn-add-option-choice').onclick=()=>{optionGroupDraft.choices.push({id:makeOptionId('choice'),label:'',price:0,online_price:null});renderOptionGroupChoices();});
$('#btn-save-option-group') && ($('#btn-save-option-group').onclick=async()=>{
  optionGroupDraft.name=($('#option-group-name')?.value||'').trim();
  const normalized=normalizeCustomOptionGroups([optionGroupDraft])[0];
  if(!normalized)return showNotice('กรอกชื่อกลุ่มและตัวเลือกอย่างน้อย 1 รายการ','error');
  try{
    if(optionGroupEditingId)await api(`/api/admin/option-groups/${encodeURIComponent(optionGroupEditingId)}`,{method:'PUT',body:JSON.stringify(normalized)});
    else await api('/api/admin/option-groups',{method:'POST',body:JSON.stringify(normalized)});
    currentCustomOptionGroups=currentCustomOptionGroups.map(group=>group.id===normalized.id?structuredClone(normalized):group);
    await load();resetOptionGroupEditor(normalized);renderCustomOptionEditor();showNotice('บันทึกคลังตัวเลือกแล้ว');
  }catch(error){showNotice(error.message,'error');}
});
$('#btn-delete-option-group') && ($('#btn-delete-option-group').onclick=async()=>{
  if(!optionGroupEditingId||!confirm('ลบกลุ่มตัวเลือกนี้ออกจากทุกเมนูใช่หรือไม่?'))return;
  try{await api(`/api/admin/option-groups/${encodeURIComponent(optionGroupEditingId)}`,{method:'DELETE'});currentCustomOptionGroups=currentCustomOptionGroups.filter(item=>item.id!==optionGroupEditingId);await load();resetOptionGroupEditor();renderCustomOptionEditor();showNotice('ลบกลุ่มตัวเลือกแล้ว');}catch(error){showNotice(error.message,'error');}
});

async function openProductEditor(product) {
  // Close settings → bounce to home register screen, then show editor overlay
  const settingsDialog = $('#settings');
  productEditorReturnView = settingsDialog?.open ? {
    tab: document.querySelector('.admin-tab-panel.active-panel')?.id || 'tab-products',
    title: document.querySelector('#settings header h2')?.textContent || 'จัดการเมนูและสูตรชง'
  } : null;
  $('#settings')?.close();
  uploadedProductImageData = product?.image_data || null;
  syncProductCategoryOptions(product?.category);
  if ($('#edit-prod-image-upload')) $('#edit-prod-image-upload').value = '';
  if ($('#edit-prod-image-upload-status')) $('#edit-prod-image-upload-status').textContent = uploadedProductImageData ? '✓ ใช้รูปที่อัปโหลดไว้' : 'รองรับ JPG, PNG และ WebP ระบบจะย่อรูปให้อัตโนมัติ';

  if (product) {
    currentCustomOptionGroups = productOptionGroups(product);
    // Edit mode
    if ($('#edit-prod-id')) $('#edit-prod-id').value = product.id;
    if ($('#edit-prod-name')) $('#edit-prod-name').value = product.name;
    if ($('#edit-prod-price')) $('#edit-prod-price').value = product.price;
    if ($('#edit-prod-margin')) $('#edit-prod-margin').value = Math.round((product.target_margin ?? .65) * 100);
    if ($('#edit-prod-emoji')) $('#edit-prod-emoji').value = product.emoji;
    if ($('#edit-prod-image')) $('#edit-prod-image').value = product.image_path || '';
    if ($('#edit-prod-category')) $('#edit-prod-category').value = product.category;
    if ($('#edit-prod-active')) $('#edit-prod-active').checked = !!product.active;
    if ($('#edit-prod-deduct-stock')) $('#edit-prod-deduct-stock').checked = window.useFirebaseStore&&product.deduct_stock==null ? false : product.deduct_stock !== 0&&product.deduct_stock!==false;
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
    currentCustomOptionGroups = [];
    // Add mode
    if ($('#edit-prod-id')) $('#edit-prod-id').value = '';
    if ($('#edit-prod-name')) $('#edit-prod-name').value = '';
    if ($('#edit-prod-price')) $('#edit-prod-price').value = '';
    if ($('#edit-prod-margin')) $('#edit-prod-margin').value = 65;
    if ($('#edit-prod-emoji')) $('#edit-prod-emoji').value = '☕';
    if ($('#edit-prod-image')) $('#edit-prod-image').value = '';
    if ($('#edit-prod-category')) $('#edit-prod-category').value = state.categories[0]?.category_key || 'coffee';
    if ($('#edit-prod-active')) $('#edit-prod-active').checked = true;
    if ($('#edit-prod-deduct-stock')) $('#edit-prod-deduct-stock').checked = true;
    if ($('#edit-recipe-description')) $('#edit-recipe-description').value = '';
    if ($('#edit-prod-title')) $('#edit-prod-title').textContent = '➕ เพิ่มสินค้าใหม่';
    const delBtn = $('#btn-delete-product');
    if (delBtn) delBtn.style.display = 'none';
    currentEditRecipeItems = [];
  }

  renderEditRecipeItems();
  renderCustomOptionEditor();
  updateProductImagePreview();
  $('#product-edit-dialog')?.showModal();
}

function closeProductEditorAndReturn() {
  $('#product-edit-dialog')?.close();
  const target = productEditorReturnView;
  productEditorReturnView = null;
  if (target) setTimeout(() => openAdminWindow(target.tab, target.title), 0);
}

function updateProductImagePreview() {
  const preview = $('#edit-prod-image-preview');
  const imagePath = uploadedProductImageData || $('#edit-prod-image')?.value;
  if (!preview) return;
  preview.hidden = !imagePath;
  if (imagePath) preview.src = String(imagePath).startsWith('data:') ? imagePath : new URL(String(imagePath).replace(/^\/+/, ''), document.baseURI).href;
}

async function resizeProductImage(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('กรุณาเลือกไฟล์รูปภาพ');
  if (file.size > 12 * 1024 * 1024) throw new Error('ไฟล์รูปต้องมีขนาดไม่เกิน 12 MB');
  const source = await createImageBitmap(file);
  const maxSide = 800;
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();
  let quality=.82,result='';
  do { result=canvas.toDataURL('image/jpeg',quality);quality-=.08; } while(result.length>700*1024&&quality>=.42);
  if(result.length>700*1024)throw new Error('รูปมีรายละเอียดสูงเกินไป กรุณาเลือกรูปที่เล็กลง');
  return result;
}

$('#edit-prod-image-upload') && ($('#edit-prod-image-upload').onchange = async event => {
  const status = $('#edit-prod-image-upload-status');
  try {
    if (status) status.textContent = 'กำลังย่อและเตรียมรูป…';
    uploadedProductImageData = await resizeProductImage(event.target.files?.[0]);
    if ($('#edit-prod-image')) $('#edit-prod-image').value = '';
    updateProductImagePreview();
    if (status) status.textContent = '✓ พร้อมบันทึกรูปที่อัปโหลด';
  } catch (error) {
    uploadedProductImageData = null;
    if (status) status.textContent = error.message;
    showNotice(error.message, 'error');
  }
});

$('#edit-prod-image') && ($('#edit-prod-image').onchange = () => {
  uploadedProductImageData = null;
  updateProductImagePreview();
});

// "Add new product" button
const triggerAddBtn = $('#btn-trigger-add-product');
if (triggerAddBtn) triggerAddBtn.onclick = () => openProductEditor(null);

// Close product editor
document.querySelectorAll('#product-edit-dialog .close').forEach(b => { b.onclick = closeProductEditorAndReturn; });

let recipeSelectorDraft = [];
function setRecipeSelectorItem(stockKey, quantity) { const idx=recipeSelectorDraft.findIndex(x=>x.stock_key===stockKey); if(quantity>0){if(idx>=0)recipeSelectorDraft[idx].quantity=quantity;else recipeSelectorDraft.push({stock_key:stockKey,quantity});}else if(idx>=0)recipeSelectorDraft.splice(idx,1); }

function renderRecipeSelected() {
  const root = $('#recipe-selected-list'), count = $('#recipe-selector-count'), total = $('#recipe-selected-cost');
  if (!root) return;
  root.replaceChildren();
  const selected = recipeSelectorDraft.map(item => ({ ...item, stock: state.inventory.find(stock => stock.stock_key === item.stock_key) })).filter(item => item.stock);
  const directCost = selected.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.stock.cost_per_unit || 0), 0);
  if (count) count.textContent = `${selected.length} รายการ`;
  if (total) total.textContent = money(directCost);
  if (!selected.length) { root.innerHTML = '<div class="recipe-selected-empty"><strong>ยังไม่ได้เลือกรายการ</strong><span>เลือกรายการจากด้านซ้าย แล้วปรับปริมาณที่ใช้ต่อแก้วได้ที่นี่</span></div>'; return; }
  selected.forEach(({ stock, quantity }) => {
    const row = document.createElement('article'); row.className = 'recipe-selected-row';
    const info = document.createElement('div'); info.className = 'recipe-selected-info';
    info.innerHTML = `<strong>${escapeHtml(displayName(stock))}</strong><small>${money(stock.cost_per_unit || 0)}/${escapeHtml(stock.unit)} · ต้นทุน ${money(Number(quantity) * Number(stock.cost_per_unit || 0))}</small>`;
    const controls = document.createElement('div'); controls.className = 'recipe-quantity-controls';
    const minus = document.createElement('button'); minus.type = 'button'; minus.textContent = '−';
    const input = document.createElement('input'); input.type = 'number'; input.min = '0.01'; input.step = '0.01'; input.value = quantity;
    const unit = document.createElement('span'); unit.textContent = stock.unit;
    const plus = document.createElement('button'); plus.type = 'button'; plus.textContent = '+';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'recipe-remove-item'; remove.textContent = '×';
    const update = value => { setRecipeSelectorItem(stock.stock_key, Math.max(0.01, Number(value) || 0.01)); renderRecipeSelector(); };
    minus.onclick = () => update(Math.max(0.01, Number(input.value) - 1)); plus.onclick = () => update(Number(input.value) + 1);
    input.onchange = () => update(input.value); remove.onclick = () => { setRecipeSelectorItem(stock.stock_key, 0); renderRecipeSelector(); };
    controls.append(minus, input, unit, plus, remove); row.append(info, controls); root.append(row);
  });
}

function renderRecipeSelector() {
  const root = $('#recipe-selector-list'); if (!root) return; root.replaceChildren();
  const filter = $('#recipe-material-filter')?.value || 'all';
  const query = ($('#recipe-stock-search')?.value || '').trim().toLowerCase();
  const labels = { coffee_beans:'เมล็ดกาแฟ', cocoa:'โกโก้', tea:'ชา', milk:'นม', sweetness:'ความหวาน', syrup:'ไซรัป', other:'อื่น ๆ', equipment:'อุปกรณ์ / บรรจุภัณฑ์' };
  Object.entries(labels).filter(([type]) => filter === 'all' || filter === type).forEach(([type, title]) => {
    const items = state.inventory.filter(stock => (type === 'equipment' ? stock.category === 'equipment' : stock.category !== 'equipment' && (stock.material_type || 'other') === type) && (!query || `${displayName(stock)} ${stock.stock_key}`.toLowerCase().includes(query)));
    if (!items.length) return;
    const group = document.createElement('section'); group.className = 'recipe-selector-group'; group.innerHTML = `<h3>${escapeHtml(title)}</h3>`;
    items.forEach(stock => {
      const selected = recipeSelectorDraft.some(item => item.stock_key === stock.stock_key);
      const row = document.createElement('button'); row.type = 'button'; row.className = `recipe-selector-row${selected ? ' is-selected' : ''}`;
      row.innerHTML = `<span class="recipe-selector-icon">${selected ? '✓' : '+'}</span><span><strong>${escapeHtml(displayName(stock))}</strong><small>${escapeHtml(stock.stock_key)} · ${money(stock.cost_per_unit || 0)}/${escapeHtml(stock.unit)}</small></span><em>${selected ? 'เลือกแล้ว' : 'เลือก'}</em>`;
      row.onclick = () => { setRecipeSelectorItem(stock.stock_key, selected ? 0 : 1); renderRecipeSelector(); }; group.append(row);
    }); root.append(group);
  });
  if (!root.children.length) root.innerHTML = '<div class="recipe-library-empty">ไม่พบรายการที่ตรงกับการค้นหา</div>';
  renderRecipeSelected();
}

$('#btn-open-recipe-selector') && ($('#btn-open-recipe-selector').onclick = () => { recipeSelectorDraft = currentEditRecipeItems.map(item => ({ stock_key:item.stock_key, quantity:Number(item.quantity) })); renderRecipeSelector(); $('#recipe-selector-dialog')?.showModal(); });
$('#recipe-material-filter') && ($('#recipe-material-filter').onchange = renderRecipeSelector);
$('#recipe-stock-search') && ($('#recipe-stock-search').oninput = renderRecipeSelector);
$('#recipe-selector-apply') && ($('#recipe-selector-apply').onclick = () => { currentEditRecipeItems = recipeSelectorDraft.flatMap(item => { const stock = state.inventory.find(entry => entry.stock_key === item.stock_key); return stock ? [{ stock_key:stock.stock_key, quantity:Number(item.quantity), name:displayName(stock), unit:stock.unit, cost_per_unit:stock.cost_per_unit }] : []; }); $('#recipe-selector-dialog')?.close(); renderEditRecipeItems(); });

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
    const imagePath = $('#edit-prod-image')?.value || null;
    const imageData = uploadedProductImageData || null;
    const active = !!$('#edit-prod-active')?.checked;
    const deductStock = !!$('#edit-prod-deduct-stock')?.checked;
    const description = ($('#edit-recipe-description')?.value || '').trim();
    const customOptions = normalizeCustomOptionGroups(currentCustomOptionGroups);

    if (!name || isNaN(price) || price < 0) return alert('กรอกชื่อสินค้าและราคาให้ถูกต้อง');
    if (deductStock && !currentEditRecipeItems.length) return showNotice('เมนูที่ตัด stock ต้องเลือกวัตถุดิบหรือบรรจุภัณฑ์อย่างน้อย 1 รายการ หรือปิด “ตัด stock”', 'error');

    try {
      let productId;
      if (id) {
        await api(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify({ name, price, category, emoji, active, deductStock, imagePath, imageData, customOptions }) });
        await api(`/api/admin/products/${id}/costing`, { method: 'PUT', body: JSON.stringify({ price, targetMargin }) });
        productId = Number(id);
        showNotice('บันทึกข้อมูลสินค้าสำเร็จ!');
      } else {
        const res = await api('/api/admin/products', { method: 'POST', body: JSON.stringify({ name, price, category, emoji, deductStock, imagePath, imageData, customOptions }) });
        productId = res.id;
        await api(`/api/admin/products/${productId}/costing`, { method: 'PUT', body: JSON.stringify({ price, targetMargin }) });
        showNotice('เพิ่มสินค้าใหม่สำเร็จ!');
      }
      // Save structured recipe
      await api(`/api/admin/products/${productId}/recipe`, {
        method: 'PUT',
        body: JSON.stringify({ items: currentEditRecipeItems, description })
      });

      closeProductEditorAndReturn();
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
      closeProductEditorAndReturn();
      await load();
      await adminLoad();
    } catch (e) { showNotice(e.message, 'error'); }
  };
}

// ── Main event bindings ───────────────────────────────────────
const searchEl = $('#search');
if (searchEl) searchEl.oninput = renderProducts;

const quickAddProductBtn = $('#quick-add-product-btn');
if (quickAddProductBtn) quickAddProductBtn.onclick = async () => {
  if (!window.useFirebaseStore && !adminPin) {
    $('#settings')?.showModal();
    $('#pin')?.focus();
    showNotice('กรอก Admin PIN ก่อนสร้างเมนู', 'error');
    return;
  }
  try {
    if (!state.categories.length) await load();
    await openProductEditor(null);
  } catch (e) {
    showNotice(`เปิดหน้าสร้างเมนูไม่สำเร็จ: ${e.message}`, 'error');
  }
};

const quickAddCategoryBtn = $('#quick-add-category-btn');
if (quickAddCategoryBtn) quickAddCategoryBtn.onclick = () => {
  openAdminWindow('tab-products', 'จัดการหมวดหมู่สินค้า');
  setTimeout(() => $('#new-category-name')?.focus(), 0);
};

const discountEl = $('#discount');
if (discountEl) discountEl.oninput = renderCart;
document.querySelectorAll('input[name="sale-channel"]').forEach(input => { input.onchange = updateOnlineChannelUI; });
$('#online-channel') && ($('#online-channel').onchange = updateOnlineChannelUI);

const checkoutBtn = $('#checkout');
if (checkoutBtn) checkoutBtn.onclick = checkout;
$('#mobile-cart-toggle') && ($('#mobile-cart-toggle').onclick=()=>setMobileCartOpen(true));
$('#mobile-cart-close') && ($('#mobile-cart-close').onclick=()=>setMobileCartOpen(false));
window.matchMedia('(min-width:801px)').addEventListener?.('change',event=>{if(event.matches)setMobileCartOpen(false);});

$('#edit-prod-price') && ($('#edit-prod-price').oninput = renderEditRecipeItems);
$('#edit-prod-margin') && ($('#edit-prod-margin').oninput = renderEditRecipeItems);
$('#edit-prod-image') && ($('#edit-prod-image').onchange = () => { uploadedProductImageData = null; updateProductImagePreview(); });

function refreshUnitCostPreview() {
  const qty=Number($('#cost-inv-purchase-qty')?.value)||0, total=Number($('#cost-inv-purchase-total')?.value)||0;
  const out=$('#cost-inv-unit-price'); if(out) out.textContent=qty>0?money(total/qty):money(0);
}
['#cost-inv-purchase-qty','#cost-inv-purchase-total'].forEach(selector => { const el=$(selector); if(el) el.oninput=refreshUnitCostPreview; });
const newInventoryKey=()=>`item_${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`;
$('#cost-inv-save') && ($('#cost-inv-save').onclick=async()=>{ const button=$('#cost-inv-save'),stockKey=($('#cost-inv-key')?.value||'').trim(),name=($('#cost-inv-name')?.value||'').trim(),unit=($('#cost-inv-unit')?.value||'').trim(),category=$('#cost-inv-category')?.value,materialType=$('#cost-inv-material-type')?.value||'other',quantity=Number($('#cost-inv-quantity')?.value),lowAlert=Number($('#cost-inv-low')?.value),purchaseQuantity=Number($('#cost-inv-purchase-qty')?.value),purchaseTotal=Number($('#cost-inv-purchase-total')?.value); if(!stockKey||!name||!unit||purchaseQuantity<=0||purchaseTotal<0)return showNotice('กรอกชื่อ หน่วย ปริมาณซื้อ และราคาซื้อให้ครบ','error'); if(!Number.isFinite(quantity)||quantity<0||!Number.isFinite(lowAlert)||lowAlert<0)return showNotice('จำนวนคงเหลือและจุดแจ้งเตือนต้องเป็นเลขศูนย์หรือมากกว่า','error'); try{if(button){button.disabled=true;button.textContent='กำลังบันทึก…';}await api(costInventoryEditingKey?`/api/admin/cost-inventory/${costInventoryEditingKey}`:'/api/admin/cost-inventory',{method:costInventoryEditingKey?'PUT':'POST',body:JSON.stringify({stockKey,name,unit,category,materialType,quantity,lowAlert,purchaseQuantity,purchaseTotal})});$('#cost-inventory-dialog')?.close();showNotice('บันทึกราคาซื้อและต้นทุนต่อหน่วยแล้ว');await load();await adminLoad();}catch(e){showNotice(`บันทึกไม่สำเร็จ: ${e.message}`,'error');}finally{if(button){button.disabled=false;button.textContent='บันทึกวัตถุดิบ';}} });

const topMenuToggle = $('#top-menu-toggle');
if (topMenuToggle) topMenuToggle.onclick = () => {
  const menu = $('.top-menu'); const open = menu?.classList.toggle('open');
  topMenuToggle.setAttribute('aria-expanded', String(!!open));
};
document.addEventListener('click', event => { if (!event.target.closest('.top-menu')) { $('.top-menu')?.classList.remove('open'); topMenuToggle?.setAttribute('aria-expanded','false'); } });

// Touch-friendly fallback for every dialog close button. Dedicated handlers
// run first, so flows such as returning from product editing remain unchanged.
document.addEventListener('click', event => {
  const closeButton = event.target.closest?.('button.close');
  if (!closeButton) return;
  const dialog = closeButton.closest('dialog');
  if (!dialog?.open) return;
  event.preventDefault();
  dialog.close('cancel');
  if (dialog.id === 'checkout-calc-dialog') checkoutPayload = null;
  if (dialog.id === 'kds-dialog') clearInterval(kdsTimer);
});

let costInventoryEditingKey = null;
function openCostInventory(item = null) {
  costInventoryEditingKey = item?.stock_key || null;
  const set=(id,value)=>{const el=$(id);if(el)el.value=value ?? '';};
  const units={g:'กรัม',gram:'กรัม',grams:'กรัม','กรับ':'กรัม',ml:'มล.','มล':'มล.',pcs:'ชิ้น',pc:'ชิ้น'};
  const unit=units[String(item?.unit||'').trim().toLowerCase()] || item?.unit || 'กรัม';
  set('#cost-inv-key', item?.stock_key || newInventoryKey()); set('#cost-inv-name', item?.name || ''); set('#cost-inv-unit', unit);
  set('#cost-inv-category', item?.category || 'ingredient'); set('#cost-inv-quantity', item?.quantity || 0); set('#cost-inv-low', item?.low_alert || 0);
  set('#cost-inv-material-type', item?.material_type || 'other');
  set('#cost-inv-purchase-qty', item?.purchase_quantity || 1); set('#cost-inv-purchase-total', item?.purchase_total || item?.cost_per_unit || 0);
  const key=$('#cost-inv-key'); if(key) key.readOnly=true;
  const title=document.querySelector('#cost-inventory-dialog h2'); if(title) title.textContent=item?'แก้ไขราคาซื้อและต้นทุน':'เพิ่มวัตถุดิบ / บรรจุภัณฑ์';
  const save=$('#cost-inv-save'); if(save) save.textContent=item?'บันทึกการแก้ไข':'บันทึกวัตถุดิบ';
  refreshUnitCostPreview(); $('#cost-inventory-dialog')?.showModal();
}
let loyaltySettingsDraft=null;
function updateLoyaltySummary() {
  const out=$('#loyalty-settings-summary');if(!out||!loyaltySettingsDraft)return;
  const earn=loyaltySettingsDraft.mode==='all'?'ทุกเมนู':loyaltySettingsDraft.mode==='category'?`${loyaltySettingsDraft.categoryKeys.length} หมวดหมู่`:`${loyaltySettingsDraft.productIds.length} เมนู`;
  const channels=[loyaltySettingsDraft.earnStore?'หน้าร้าน':'',loyaltySettingsDraft.earnOnline?'ออนไลน์':''].filter(Boolean).join(' และ ');
  const reward=loyaltySettingsDraft.rewardType==='fixed_discount'?`ส่วนลด ${money(loyaltySettingsDraft.rewardDiscountAmount)}`:'สินค้าฟรี 1 รายการ';
  out.textContent=`สะสมจาก ${earn} (${channels||'ยังไม่เลือกช่องทาง'}) · ใช้ ${loyaltySettingsDraft.rewardPoints} แต้ม แลก${reward}`;
}
function renderLoyaltyProductChoices() {
  const root=$('#loyalty-product-list');if(!root||!loyaltySettingsDraft)return;root.replaceChildren();
  const query=($('#loyalty-product-search')?.value||'').trim().toLowerCase();
  state.products.filter(product=>!query||product.name.toLowerCase().includes(query)).forEach(product=>{
    const label=document.createElement('label');
    const input=document.createElement('input');input.type='checkbox';input.value=String(product.id);input.checked=loyaltySettingsDraft.productIds.includes(String(product.id));
    const text=document.createElement('span');text.textContent=`${product.emoji||'🍽️'} ${product.name}`;
    input.onchange=()=>{loyaltySettingsDraft.productIds=input.checked?[...new Set([...loyaltySettingsDraft.productIds,String(product.id)])]:loyaltySettingsDraft.productIds.filter(id=>id!==String(product.id));updateLoyaltySummary();};
    label.append(input,text);root.append(label);
  });
}
function renderLoyaltyRewardProductChoices() {
  const root=$('#loyalty-reward-product-list');if(!root||!loyaltySettingsDraft)return;root.replaceChildren();
  const query=($('#loyalty-reward-product-search')?.value||'').trim().toLowerCase();
  state.products.filter(product=>!query||product.name.toLowerCase().includes(query)).forEach(product=>{
    const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');
    input.type='checkbox';input.value=String(product.id);input.checked=loyaltySettingsDraft.rewardProductIds.includes(String(product.id));
    text.textContent=`${product.emoji||'🍽️'} ${product.name}`;
    input.onchange=()=>{loyaltySettingsDraft.rewardProductIds=input.checked?[...new Set([...loyaltySettingsDraft.rewardProductIds,String(product.id)])]:loyaltySettingsDraft.rewardProductIds.filter(id=>id!==String(product.id));updateLoyaltySummary();};
    label.append(input,text);root.append(label);
  });
}
function renderLoyaltySettingsPickers() {
  const mode=loyaltySettingsDraft?.mode||'all';
  const rewardMode=loyaltySettingsDraft?.rewardMode||'category';
  const freeProduct=loyaltySettingsDraft?.rewardType==='free_product';
  if($('#loyalty-category-picker'))$('#loyalty-category-picker').hidden=mode!=='category';
  if($('#loyalty-product-picker'))$('#loyalty-product-picker').hidden=mode!=='product';
  if($('#loyalty-reward-product-config'))$('#loyalty-reward-product-config').hidden=!freeProduct;
  if($('#loyalty-reward-category-picker'))$('#loyalty-reward-category-picker').hidden=!freeProduct||rewardMode!=='category';
  if($('#loyalty-reward-product-picker'))$('#loyalty-reward-product-picker').hidden=!freeProduct||rewardMode!=='product';
  if($('#loyalty-discount-amount-wrap'))$('#loyalty-discount-amount-wrap').hidden=freeProduct;
  if($('#loyalty-max-price-wrap'))$('#loyalty-max-price-wrap').hidden=!freeProduct;
  updateLoyaltySummary();
}
function renderLoyaltySettings() {
  const card=$('.loyalty-settings-card');if(!card)return;
  loyaltySettingsDraft=normalizeLoyaltySettings(state.loyaltySettings);
  document.querySelectorAll('input[name="loyalty-mode"]').forEach(input=>{
    input.checked=input.value===loyaltySettingsDraft.mode;
    input.onchange=()=>{if(input.checked){loyaltySettingsDraft.mode=input.value;renderLoyaltySettingsPickers();}};
  });
  const categoryRoot=$('#loyalty-category-list');
  if(categoryRoot){categoryRoot.replaceChildren();state.categories.forEach(category=>{const label=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.value=String(category.category_key);input.checked=loyaltySettingsDraft.categoryKeys.includes(String(category.category_key));const text=document.createElement('span');text.textContent=category.name;input.onchange=()=>{loyaltySettingsDraft.categoryKeys=input.checked?[...new Set([...loyaltySettingsDraft.categoryKeys,String(category.category_key)])]:loyaltySettingsDraft.categoryKeys.filter(key=>key!==String(category.category_key));updateLoyaltySummary();};label.append(input,text);categoryRoot.append(label);});}
  const search=$('#loyalty-product-search');if(search){search.value='';search.oninput=renderLoyaltyProductChoices;}
  document.querySelectorAll('input[name="loyalty-reward-mode"]').forEach(input=>{input.checked=input.value===loyaltySettingsDraft.rewardMode;input.onchange=()=>{if(input.checked){loyaltySettingsDraft.rewardMode=input.value;renderLoyaltySettingsPickers();}};});
  const rewardCategoryRoot=$('#loyalty-reward-category-list');
  if(rewardCategoryRoot){rewardCategoryRoot.replaceChildren();state.categories.forEach(category=>{const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');input.type='checkbox';input.value=String(category.category_key);input.checked=loyaltySettingsDraft.rewardCategoryKeys.includes(String(category.category_key));text.textContent=category.name;input.onchange=()=>{loyaltySettingsDraft.rewardCategoryKeys=input.checked?[...new Set([...loyaltySettingsDraft.rewardCategoryKeys,String(category.category_key)])]:loyaltySettingsDraft.rewardCategoryKeys.filter(key=>key!==String(category.category_key));updateLoyaltySummary();};label.append(input,text);rewardCategoryRoot.append(label);});}
  const rewardSearch=$('#loyalty-reward-product-search');if(rewardSearch){rewardSearch.value='';rewardSearch.oninput=renderLoyaltyRewardProductChoices;}
  const bindValue=(selector,value,parse)=>{const el=$(selector);if(!el)return;el.value=value;el.onchange=()=>{loyaltySettingsDraft[parse.key]=parse.value(el.value);renderLoyaltySettingsPickers();};};
  bindValue('#loyalty-reward-points',loyaltySettingsDraft.rewardPoints,{key:'rewardPoints',value:value=>Math.min(999,Math.max(1,Math.round(Number(value)||10)))});
  bindValue('#loyalty-reward-type',loyaltySettingsDraft.rewardType,{key:'rewardType',value:value=>value});
  bindValue('#loyalty-discount-amount',loyaltySettingsDraft.rewardDiscountAmount,{key:'rewardDiscountAmount',value:value=>Math.max(1,Number(value)||1)});
  bindValue('#loyalty-reward-max-price',loyaltySettingsDraft.rewardMaxPrice,{key:'rewardMaxPrice',value:value=>Math.max(0,Number(value)||0)});
  const earnStore=$('#loyalty-earn-store');if(earnStore){earnStore.checked=loyaltySettingsDraft.earnStore;earnStore.onchange=()=>{loyaltySettingsDraft.earnStore=earnStore.checked;updateLoyaltySummary();};}
  const earnOnline=$('#loyalty-earn-online');if(earnOnline){earnOnline.checked=loyaltySettingsDraft.earnOnline;earnOnline.onchange=()=>{loyaltySettingsDraft.earnOnline=earnOnline.checked;updateLoyaltySummary();};}
  renderLoyaltyProductChoices();
  renderLoyaltyRewardProductChoices();
  renderLoyaltySettingsPickers();
}
$('#btn-save-loyalty-settings') && ($('#btn-save-loyalty-settings').onclick=async()=>{
  if(!loyaltySettingsDraft)return;
  if(loyaltySettingsDraft.mode==='category'&&!loyaltySettingsDraft.categoryKeys.length)return showNotice('เลือกหมวดหมู่ที่ให้แต้มอย่างน้อย 1 หมวด','error');
  if(loyaltySettingsDraft.mode==='product'&&!loyaltySettingsDraft.productIds.length)return showNotice('เลือกเมนูที่ให้แต้มอย่างน้อย 1 รายการ','error');
  if(!loyaltySettingsDraft.earnStore&&!loyaltySettingsDraft.earnOnline)return showNotice('เลือกช่องทางสะสมแต้มอย่างน้อย 1 ช่องทาง','error');
  if(loyaltySettingsDraft.rewardType==='free_product'&&loyaltySettingsDraft.rewardMode==='category'&&!loyaltySettingsDraft.rewardCategoryKeys.length)return showNotice('เลือกหมวดหมู่รางวัลอย่างน้อย 1 หมวด','error');
  if(loyaltySettingsDraft.rewardType==='free_product'&&loyaltySettingsDraft.rewardMode==='product'&&!loyaltySettingsDraft.rewardProductIds.length)return showNotice('เลือกเมนูรางวัลอย่างน้อย 1 รายการ','error');
  try{
    const result=await api('/api/admin/loyalty-settings',{method:'PUT',body:JSON.stringify(loyaltySettingsDraft)});
    state.loyaltySettings=normalizeLoyaltySettings(result.loyaltySettings||loyaltySettingsDraft);
    renderLoyaltySettings();showNotice('บันทึกเงื่อนไขสะสมแต้มแล้ว');
  }catch(error){showNotice(error.message,'error');}
});

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
      phoneSpan.textContent = `เบอร์โทร: ${m.phone} · สะสม ${m.points} แต้ม`;
      
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
    container.innerHTML = `<p style="color:#b42318;text-align:center;">โหลดสมาชิกไม่สำเร็จ: ${escapeHtml(e.message)}</p>`;
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
function optionText(raw) { try { const x=typeof raw==='string'?JSON.parse(raw):raw; return modifierSummary({custom_labels:x?.custom_labels||[]}); } catch { return ''; } }
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
