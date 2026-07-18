let state = {
  products: [],
  cart: [],
  features: {},
  categories: [],
  inventory: [],
  recipesData: [],
  selectedCategory: 'all',
  selectedStockCategory: 'all'
};
let adminPin = '';
let currentMember = null;
let checkoutPayload = null;
let currentEditRecipeItems = []; // Stores structured recipe items during product edit

const $ = s => document.querySelector(s);
const money = n => `฿${Number(n).toFixed(2)}`;
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const note = (m, t = 'success') => {
  const n = $('#notice');
  if (n) {
    n.textContent = m;
    n.className = t;
    setTimeout(() => { n.className = '' }, 4000);
  }
};

async function api(url, opt = {}) {
  const r = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(adminPin ? { 'x-admin-pin': adminPin } : {})
    },
    ...opt
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error || 'เชื่อมต่อระบบไม่สำเร็จ');
  return d;
}

// -----------------------------------------
// WORKSPACE CATALOG & PRODUCT SELECTION
// -----------------------------------------
function filtered() {
  const q = $('#search').value.toLowerCase();
  const c = state.selectedCategory || 'all';
  return state.products.filter(p => (c === 'all' || p.category === c) && p.name.toLowerCase().includes(q));
}

function renderCategoryTabs() {
  const container = $('#category-tabs');
  if (!container) return;

  const categories = [{ category_key: 'all', name: 'ทุกหมวด' }, ...state.categories];
  container.replaceChildren(...categories.map(c => {
    const btn = document.createElement('button');
    btn.className = `category-tab-btn ${state.selectedCategory === c.category_key ? 'active' : ''}`;
    btn.textContent = c.name;
    btn.type = 'button';
    btn.onclick = () => {
      state.selectedCategory = c.category_key;
      renderCategoryTabs();
      renderProducts();
    };
    return btn;
  }));
}

function showRecipePopover(product) {
  const pop = $('#recipe-popover');
  if (!pop) return;
  
  const recipe = state.recipesData.find(x => x.id === product.id);
  $('#recipe-pop-title').textContent = `${product.emoji} สูตรชง: ${product.name}`;
  
  let itemsHtml = '';
  if (recipe && recipe.items && recipe.items.length) {
    itemsHtml = recipe.items.map(x => `
      <div style="display:flex; justify-content:space-between; margin-bottom:4px; padding-bottom:4px; border-bottom:1px solid #fcfaf8;">
        <span>• ${x.name}</span>
        <span style="font-weight:600; color:var(--primary);">${x.quantity} ${x.unit}</span>
      </div>
    `).join('');
  } else {
    itemsHtml = '<span style="color:#aaa; font-style:italic;">ไม่ได้ระบุวัตถุดิบและอุปกรณ์</span>';
  }
  
  $('#recipe-pop-items').innerHTML = itemsHtml;
  $('#recipe-pop-description').textContent = recipe && recipe.description ? recipe.description : 'ไม่ได้ระบุขั้นตอนคำอธิบาย';
  pop.showModal();
}

function renderProducts() {
  renderCategoryTabs();
  const items = filtered();
  $('#product-count').textContent = `${items.length} เมนู`;
  const root = $('#products');
  root.replaceChildren(...items.map(p => {
    const card = document.createElement('div');
    card.className = 'product-card-wrapper';
    card.style.position = 'relative';

    // Check stock level dynamically using recipe items
    let stockInfo = '';
    const recipe = state.recipesData.find(x => x.id === p.id);
    if (recipe && recipe.items && recipe.items.length) {
      let isOut = false;
      let isLow = false;
      let minLowText = '';
      
      for (const rItem of recipe.items) {
        const stock = state.inventory.find(x => x.stock_key === rItem.stock_key);
        if (stock) {
          if (stock.quantity <= 0) {
            isOut = true;
          } else if (stock.quantity <= stock.low_alert) {
            isLow = true;
            minLowText = `วัตถุดิบใกล้หมด`;
          }
        }
      }
      
      if (isOut) {
        stockInfo = '<span class="stock-badge empty">หมด</span>';
      } else if (isLow) {
        stockInfo = `<span class="stock-badge low">${minLowText}</span>`;
      }
    } else if (p.stock_key) {
      // Fallback stock key check
      const stock = state.inventory.find(x => x.stock_key === p.stock_key);
      if (stock) {
        if (stock.quantity <= 0) {
          stockInfo = '<span class="stock-badge empty">หมด</span>';
        } else if (stock.quantity <= stock.low_alert) {
          stockInfo = `<span class="stock-badge low">ใกล้หมด (${stock.quantity})</span>`;
        }
      }
    }

    const b = document.createElement('button');
    b.className = 'product';
    b.innerHTML = `<span>${p.emoji}</span><b></b><small>${money(p.price)}</small>${stockInfo}`;
    b.querySelector('b').textContent = p.name;
    b.onclick = () => add(p);
    
    // Add recipe view lookup icon
    const recipeBtn = document.createElement('button');
    recipeBtn.className = 'quick-recipe-btn';
    recipeBtn.innerHTML = '📖';
    recipeBtn.title = 'ดูสูตรชงด่วน';
    recipeBtn.onclick = (e) => {
      e.stopPropagation();
      showRecipePopover(p);
    };

    card.append(b, recipeBtn);
    return card;
  }));
}

// -----------------------------------------
// CART LOGIC & CHECKOUT CONTROL
// -----------------------------------------
function add(product) {
  const recipe = state.recipesData.find(x => x.id === product.id);
  const cartItem = state.cart.find(x => x.product.id === product.id);
  const currentQty = cartItem ? cartItem.qty : 0;
  
  if (recipe && recipe.items && recipe.items.length) {
    // Multi-item recipe check
    for (const rItem of recipe.items) {
      const stock = state.inventory.find(inv => inv.stock_key === rItem.stock_key);
      if (stock && (currentQty + 1) * rItem.quantity > stock.quantity) {
        return note(`สต็อก ${stock.name} ไม่เพียงพอ`, 'error');
      }
    }
  } else if (product.stock_key) {
    // Fallback check
    const stock = state.inventory.find(x => x.stock_key === product.stock_key);
    if (stock && currentQty >= stock.quantity) {
      return note(`สต็อก ${product.name} ไม่เพียงพอ`, 'error');
    }
  }

  const x = state.cart.find(x => x.product.id === product.id);
  x ? x.qty++ : state.cart.push({ product, qty: 1 });
  renderCart();

  // Trigger pulse animation
  const badge = $('#count');
  badge.classList.remove('pulse');
  void badge.offsetWidth;
  badge.classList.add('pulse');
}

function renderCart() {
  const root = $('#cart');
  root.replaceChildren();
  let sum = 0;
  state.cart.forEach((x, i) => {
    sum += x.product.price * x.qty;
    const row = document.createElement('div');
    row.className = 'line';
    const minus = document.createElement('button');
    minus.textContent = '−';
    minus.onclick = () => { if (--x.qty === 0) state.cart.splice(i, 1); renderCart() };
    const plus = document.createElement('button');
    plus.textContent = '+';
    plus.onclick = () => {
      const recipe = state.recipesData.find(r => r.id === x.product.id);
      if (recipe && recipe.items && recipe.items.length) {
        for (const rItem of recipe.items) {
          const stock = state.inventory.find(inv => inv.stock_key === rItem.stock_key);
          if (stock && (x.qty + 1) * rItem.quantity > stock.quantity) {
            return note(`สต็อก ${stock.name} ไม่เพียงพอ`, 'error');
          }
        }
      } else if (x.product.stock_key) {
        const stock = state.inventory.find(inv => inv.stock_key === x.product.stock_key);
        if (stock && x.qty >= stock.quantity) {
          return note(`สต็อก ${x.product.name} ไม่เพียงพอ`, 'error');
        }
      }
      x.qty++;
      renderCart();
    };
    
    const infoSpan = document.createElement('span');
    infoSpan.textContent = `${x.product.name} × ${x.qty}`;
    
    row.append(infoSpan, minus, ` ${money(x.product.price * x.qty)} `, plus);
    root.append(row);
  });
  const d = Math.min(Number($('#discount').value) || 0, sum);
  $('#count').textContent = state.cart.reduce((n, x) => n + x.qty, 0);
  $('#total').textContent = money(sum - d);
}

// -----------------------------------------
// CASH REGISTER CHEKOUT & E-RECEIPT DISPLAY
// -----------------------------------------
async function executeCheckout() {
  try {
    const r = await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify(checkoutPayload)
    });
    
    state.cart = [];
    $('#discount').value = 0;
    $('#member-phone').value = '';
    searchMember();
    await load();
    checkoutPayload = null;
    
    showReceipt(r);
  } catch (e) {
    note(e.message, 'error');
  }
}

async function checkout() {
  if (!state.cart.length) return note('กรุณาเพิ่มสินค้า', 'error');

  let sum = state.cart.reduce((n, x) => n + x.product.price * x.qty, 0);
  const d = Math.min(Number($('#discount').value) || 0, sum);
  const totalBill = sum - d;

  checkoutPayload = {
    items: state.cart.map(x => ({ productId: x.product.id, quantity: x.qty })),
    discount: d,
    paymentType: $('#payment').value,
    memberPhone: currentMember ? currentMember.phone : null,
    received: totalBill,
    changeDue: 0
  };

  if ($('#payment').value === 'cash') {
    $('#calc-total-bill').textContent = money(totalBill);
    $('#calc-received-input').value = '';
    $('#calc-change-amount').textContent = money(0);
    $('#calc-change-amount').style.color = '#27ae60';
    $('#checkout-calc-dialog').showModal();
  } else {
    checkoutPayload.received = totalBill;
    checkoutPayload.changeDue = 0;
    await executeCheckout();
  }
}

function showReceipt(order) {
  $('#receipt-date').textContent = `วันที่: ${new Date(order.createdAt).toLocaleString('th-TH')}`;
  $('#receipt-tx').textContent = `บิล: ${order.id}`;
  
  const itemsContainer = $('#receipt-items');
  itemsContainer.replaceChildren();
  
  let itemsHtml = '';
  if (order.items && order.items.length) {
    itemsHtml = order.items.map(x => `
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
        <span>${x.name} x ${x.quantity}</span>
        <span>${money(x.unit_price * x.quantity)}</span>
      </div>
    `).join('');
  } else {
    itemsHtml = state.cart.map(x => `
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
        <span>${x.product.name} x ${x.qty}</span>
        <span>${money(x.product.price * x.qty)}</span>
      </div>
    `).join('');
  }
  itemsContainer.innerHTML = itemsHtml;
  
  $('#receipt-subtotal').textContent = money(order.subtotal);
  $('#receipt-discount').textContent = money(order.discount);
  $('#receipt-total').textContent = money(order.total);
  
  const isCash = order.paymentType === 'cash';
  $('#receipt-payment').textContent = isCash ? 'เงินสด' : 'สแกน QR';
  
  if (isCash) {
    $('#receipt-cash-received-row').style.display = 'flex';
    $('#receipt-cash-change-row').style.display = 'flex';
    $('#receipt-received').textContent = money(order.received);
    $('#receipt-change').textContent = money(order.changeDue);
  } else {
    $('#receipt-cash-received-row').style.display = 'none';
    $('#receipt-cash-change-row').style.display = 'none';
  }
  
  const mRow = $('#receipt-member-row');
  if (order.memberPhone) {
    mRow.style.display = 'flex';
    mRow.querySelector('span:last-child').textContent = `+${Math.floor(order.total / 10)} คะแนน (${order.memberPhone})`;
  } else {
    mRow.style.display = 'none';
  }
  
  $('#receipt-dialog').showModal();
}

// -----------------------------------------
// CASH CHANGE CALCULATOR LOGIC
// -----------------------------------------
function updateCalcChange() {
  let sum = state.cart.reduce((n, x) => n + x.product.price * x.qty, 0);
  const d = Math.min(Number($('#discount').value) || 0, sum);
  const totalBill = sum - d;
  
  const received = Number($('#calc-received-input').value) || 0;
  const change = received - totalBill;
  const changeLabel = $('#calc-change-amount');
  
  if (received === 0) {
    changeLabel.textContent = money(0);
    changeLabel.style.color = '#27ae60';
  } else if (change < 0) {
    changeLabel.textContent = 'ยอดเงินไม่พอ';
    changeLabel.style.color = '#c0392b';
  } else {
    changeLabel.textContent = money(change);
    changeLabel.style.color = '#27ae60';
  }
}

$('#calc-received-input').oninput = updateCalcChange;

document.querySelectorAll('.quick-cash-btn').forEach(btn => {
  btn.onclick = async () => {
    let sum = state.cart.reduce((n, x) => n + x.product.price * x.qty, 0);
    const d = Math.min(Number($('#discount').value) || 0, sum);
    const totalBill = sum - d;
    
    const val = btn.getAttribute('data-value');
    let received = 0;
    if (val === 'exact') {
      received = Math.ceil(totalBill);
    } else {
      received = Number(val);
    }
    
    $('#calc-received-input').value = received;
    updateCalcChange();
    
    if (received >= totalBill) {
      checkoutPayload.received = received;
      checkoutPayload.changeDue = received - totalBill;
      $('#checkout-calc-dialog').close();
      await executeCheckout();
    }
  };
});

$('#calc-submit-btn').onclick = async () => {
  let sum = state.cart.reduce((n, x) => n + x.product.price * x.qty, 0);
  const d = Math.min(Number($('#discount').value) || 0, sum);
  const totalBill = sum - d;
  
  const received = Number($('#calc-received-input').value) || 0;
  if (received < totalBill) {
    alert('กรุณารับยอดเงินให้เพียงพอกับค่าสินค้า');
    return;
  }
  
  checkoutPayload.received = received;
  checkoutPayload.changeDue = received - totalBill;
  
  $('#checkout-calc-dialog').close();
  await executeCheckout();
};

$('#checkout-calc-dialog').querySelector('.close').onclick = () => {
  $('#checkout-calc-dialog').close();
  checkoutPayload = null;
};

// -----------------------------------------
// SOLO QUICK BREW QUEUE
// -----------------------------------------
async function renderQuickBrewQueue() {
  const container = $('#quick-brew-list');
  if (!container) return;
  
  try {
    const rows = await api('/api/kds');
    const activeBrews = rows.filter(x => x.status !== 'completed');
    
    if (activeBrews.length === 0) {
      container.innerHTML = '<div class="empty-state">ไม่มีรายการค้างชง</div>';
      return;
    }
    
    container.replaceChildren(...activeBrews.map(x => {
      const card = document.createElement('div');
      card.className = 'brew-card';
      
      const isCooking = x.status === 'cooking';
      card.style.cssText = `border-left: 4px solid ${isCooking ? '#3498db' : '#f39c12'}; background:#fff; padding:10px; border-radius:8px; border:1px solid #f1e7de; border-left-width:5px; margin-bottom:8px; display:flex; flex-direction:column; gap:4px; font-size:12px;`;
      
      const titleSpan = document.createElement('span');
      titleSpan.style.cssText = 'font-weight:700; font-size:13px; color:var(--text-main);';
      titleSpan.textContent = `${x.name} × ${x.quantity}`;
      
      const orderSpan = document.createElement('span');
      orderSpan.style.cssText = 'color:#888; font-size:10px;';
      orderSpan.textContent = `บิล: ${x.order_id} | ${new Date(x.created_at).toLocaleTimeString('th-TH')}`;
      
      const recipeLink = document.createElement('span');
      recipeLink.style.cssText = 'color:var(--accent); text-decoration:underline; cursor:pointer; font-size:10.5px; width:fit-content;';
      recipeLink.textContent = 'ดูสูตรชง';
      recipeLink.onclick = () => {
        const prod = state.products.find(p => p.name === x.name);
        if (prod) showRecipePopover(prod);
      };

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex; justify-content:flex-end; margin-top:4px;';
      
      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.style.cssText = `border:0; color:#fff; background:${isCooking ? '#27ae60' : '#8c6d58'}; border-radius:4px; padding:4px 10px; font-family:inherit; font-size:10px; font-weight:600; cursor:pointer;`;
      actionBtn.textContent = isCooking ? 'เสร็จสิ้น' : 'เริ่มชง';
      
      actionBtn.onclick = async () => {
        const nextStatus = isCooking ? 'completed' : 'cooking';
        try {
          await api(`/api/kds/items/${x.id}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status: nextStatus })
          });
          await renderQuickBrewQueue();
          await load();
        } catch (e) {
          note(e.message, 'error');
        }
      };
      
      btnRow.append(actionBtn);
      card.append(titleSpan, orderSpan, recipeLink, btnRow);
      return card;
    }));
  } catch (e) {
    container.textContent = 'คิวชงไม่พร้อมใช้งาน';
  }
}

// -----------------------------------------
// EXPRESS MEMBER REGISTRATION
// -----------------------------------------
async function searchMember() {
  const phone = $('#member-phone').value.replace(/\D/g, '');
  const info = $('#member-info');
  const regBtn = $('#register-member-btn');

  if (phone.length < 9) {
    info.textContent = '';
    info.className = 'member-info';
    regBtn.style.display = 'none';
    currentMember = null;
    return;
  }

  try {
    const member = await api(`/api/members/${phone}`);
    info.textContent = `✓ ${member.name} (${member.points} แต้ม)`;
    info.className = 'member-info success';
    regBtn.style.display = 'none';
    currentMember = member;
  } catch (e) {
    info.textContent = '❌ ไม่พบข้อมูล';
    info.className = 'member-info error';
    regBtn.style.display = 'inline-block';
    currentMember = null;
  }
}

$('#member-phone').oninput = searchMember;

$('#register-member-btn').onclick = async () => {
  const phone = $('#member-phone').value.replace(/\D/g, '');
  if (!phone) return;
  const defaultName = `ลูกค้าทั่วไป (${phone.slice(-4)})`;
  try {
    await api('/api/members', {
      method: 'POST',
      body: JSON.stringify({ phone, name: defaultName })
    });
    note('ลงทะเบียนสมาชิกด่วนสำเร็จ');
    await searchMember();
  } catch (e) {
    note(e.message, 'error');
  }
};

// -----------------------------------------
// PORTAL & ACTIVE FEATURES SYSTEM
// -----------------------------------------
const featureNames = { kds: 'คิวชง', inventory: 'ตั้งค่าร้าน', members: 'สมาชิก', recipes: 'สูตรชง', reports: 'รายงาน' };

function applyFeatureState() {
  let strip = $('#active-modules');
  if (!strip) {
    strip = document.createElement('div');
    strip.id = 'active-modules';
    strip.className = 'modules-strip';
    document.querySelector('.workspace').before(strip);
  }
  strip.replaceChildren();
  Object.entries(state.features).filter(([, on]) => on).forEach(([key]) => {
    const displayName = key === 'inventory' ? 'ตั้งค่าร้าน' : (featureNames[key] || key);
    const b = document.createElement('button');
    b.className = 'module-tab';
    b.textContent = displayName;
    b.onclick = () => openModule(key);
    strip.append(b);
  });
  if (!strip.childElementCount) strip.textContent = 'ยังไม่ได้เปิดฟังก์ชันเสริม';

  const sidebar = $('#quick-brew-sidebar');
  if (sidebar) {
    sidebar.style.display = state.features.kds ? 'block' : 'none';
    const ws = $('.workspace');
    if (state.features.kds) {
      ws.style.gridTemplateColumns = 'minmax(0, 1fr) 350px 280px';
    } else {
      ws.style.gridTemplateColumns = 'minmax(0, 1fr) 370px';
    }
  }

  const repBtn = $('#reportsBtn');
  if (repBtn) repBtn.style.display = state.features.reports ? 'flex' : 'none';

  const memberSection = $('.member-section');
  if (memberSection) memberSection.style.display = state.features.members ? 'block' : 'none';
}

async function openModule(key) {
  if (key === 'reports') {
    $('#reportsBtn').click();
    return;
  }
  if (key === 'inventory') {
    $('#settingsBtn').click();
    const stockTab = document.querySelector('.admin-tab-btn[data-tab="tab-inventory"]');
    if (stockTab) stockTab.click();
    return;
  }
}

async function load() {
  const cart = state.cart;
  state = await api('/api/bootstrap');
  state.cart = cart;
  
  state.recipesData = await api('/api/recipes');
  
  applyFeatureState();
  renderProducts();
  renderCart();
  await renderQuickBrewQueue();
  
  const r = await api('/api/reports/today');
  $('#sales').textContent = money(r.sales);
  $('#orders').textContent = r.orders;
}

// -----------------------------------------
// SALES REPORTS & TRANSACTIONS LOG
// -----------------------------------------
$('#reportsBtn').onclick = async () => {
  if (!state.features.reports) return;
  
  try {
    const analytics = await api('/api/reports/analytics');
    const transactions = await api('/api/reports/transactions');
    
    const sumTotalSales = transactions.reduce((n, o) => n + o.total, 0);
    const totalBills = transactions.length;
    const avgBill = totalBills ? sumTotalSales / totalBills : 0;
    
    $('#rep-total-sales').textContent = money(sumTotalSales);
    $('#rep-total-orders').textContent = `${totalBills} บิล`;
    $('#rep-avg-bill').textContent = money(avgBill);
    
    const catContainer = $('#rep-category-sales-list');
    catContainer.replaceChildren();
    if (analytics.categorySales.length === 0) {
      catContainer.innerHTML = '<p style="font-size:12px; color:#888;">ไม่มีข้อมูลยอดขาย</p>';
    } else {
      const highestSales = Math.max(...analytics.categorySales.map(x => x.sales), 1);
      analytics.categorySales.forEach(x => {
        const item = document.createElement('div');
        item.style.cssText = 'font-size:12px; margin-bottom:6px;';
        const pct = (x.sales / highestSales) * 100;
        const groupNames = { coffee: '☕ กาแฟ', tea: '🧋 ชาและนม', bakery: '🥐 เบเกอรี่', other: '☕ อื่น ๆ' };
        const label = groupNames[x.category] || x.category;
        
        item.innerHTML = `
          <div style="display:flex; justify-content:space-between; font-weight:600; margin-bottom:2px;">
            <span>${label}</span>
            <span>${money(x.sales)}</span>
          </div>
          <div style="background:#f1ebe5; border-radius:4px; height:8px; overflow:hidden;">
            <div style="background:#8c6d58; height:100%; width:${pct}%;"></div>
          </div>
        `;
        catContainer.append(item);
      });
    }
    
    const topContainer = $('#rep-top-sellers-list');
    topContainer.replaceChildren();
    if (analytics.topSellers.length === 0) {
      topContainer.innerHTML = '<p style="font-size:12px; color:#888;">ไม่มีข้อมูลยอดขาย</p>';
    } else {
      analytics.topSellers.forEach((x, idx) => {
        const item = document.createElement('div');
        item.style.cssText = 'font-size:12px; display:flex; justify-content:space-between; border-bottom:1px solid #f9f6f3; padding:4px 0;';
        item.innerHTML = `
          <span>${idx + 1}. <b>${x.name}</b> (${x.qty} ชิ้น)</span>
          <span style="font-weight:600; color:#8c5d43;">${money(x.revenue)}</span>
        `;
        topContainer.append(item);
      });
    }
    
    const pmContainer = $('#rep-payment-methods');
    const cashSales = analytics.paymentSales.find(x => x.payment_type === 'cash')?.sales || 0;
    const qrSales = analytics.paymentSales.find(x => x.payment_type === 'qr')?.sales || 0;
    pmContainer.innerHTML = `
      <div style="text-align:center; flex:1;">
        <span style="font-size:11px; color:#888;">💵 เงินสด</span>
        <div style="font-size:16px; font-weight:700; color:var(--primary); margin-top:2px;">${money(cashSales)}</div>
      </div>
      <div style="border-left:1px dashed #dfcec0;"></div>
      <div style="text-align:center; flex:1;">
        <span style="font-size:11px; color:#888;">📱 สแกน QR</span>
        <div style="font-size:16px; font-weight:700; color:var(--primary); margin-top:2px;">${money(qrSales)}</div>
      </div>
    `;
    
    const txContainer = $('#rep-transactions-list');
    txContainer.replaceChildren();
    if (transactions.length === 0) {
      txContainer.innerHTML = '<p style="font-size:12px; color:#888; text-align:center; padding:10px;">ไม่มีรายการบิล</p>';
    } else {
      transactions.forEach(tx => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; font-size:12px; padding:8px; border:1px solid #f1e7de; border-radius:8px; background:#fff; cursor:pointer; transition:all 0.15s;';
        row.onmouseover = () => row.style.borderColor = 'var(--accent)';
        row.onmouseout = () => row.style.borderColor = '#f1e7de';
        
        const timeStr = new Date(tx.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
        
        row.innerHTML = `
          <div>
            <b>${tx.id}</b> <small style="color:#888;">(${timeStr})</small>
            <div style="font-size:10.5px; color:#8c7366; margin-top:2px;">${tx.items.map(x => `${x.name} x${x.quantity}`).join(', ')}</div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <strong style="color:var(--primary);">${money(tx.total)}</strong>
            <span style="font-size:10px; background:#f1ebe5; padding:2px 6px; border-radius:4px;">${tx.payment_type === 'cash' ? 'เงินสด' : 'QR'}</span>
          </div>
        `;
        
        row.onclick = () => {
          $('#reports-dialog').close();
          showReceipt(tx);
        };
        txContainer.append(row);
      });
    }
    
    $('#reports-dialog').showModal();
  } catch (e) {
    note(e.message, 'error');
  }
};

// -----------------------------------------
// SETTINGS MULTI-TAB & STOCK NAVIGATION
// -----------------------------------------
document.querySelectorAll('.admin-tab-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.admin-tab-panel').forEach(p => p.classList.remove('active-panel'));

    btn.classList.add('active');
    const tabId = btn.getAttribute('data-tab');
    $('#' + tabId).classList.add('active-panel');
  };
});

document.querySelectorAll('.stock-tab-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.stock-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.selectedStockCategory = btn.getAttribute('data-stock-cat');
    renderInventoryList();
  };
});

function renderInventoryList() {
  const container = $('#inventory');
  if (!container) return;

  const stockFilter = state.selectedStockCategory || 'all';
  const filteredInventory = stockFilter === 'all'
    ? state.inventory
    : state.inventory.filter(x => x.category === stockFilter);

  container.replaceChildren();
  if (filteredInventory.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:#888; padding:10px 0;">ไม่มีรายการวัตถุดิบในหมวดหมู่นี้</p>';
    return;
  }

  filteredInventory.forEach(x => {
    const row = document.createElement('div');
    row.className = 'stock';
    
    const catLabel = x.category === 'ingredient' ? 'วัตถุดิบ' : 'อุปกรณ์';
    row.append(`${x.name} (${catLabel}): ${x.quantity} ${x.unit}`);

    const adj = document.createElement('button');
    adj.className = 'primary-btn';
    adj.style.fontSize = '11px';
    adj.textContent = 'ปรับสต็อก';
    adj.onclick = () => openStockAdjustDialog(x);
    row.append(adj);
    container.append(row);
  });
}

function openStockAdjustDialog(item) {
  $('#adjust-stock-key').value = item.stock_key;
  $('#adjust-stock-name').textContent = item.name;
  $('#adjust-stock-current').textContent = item.quantity;
  $('#adjust-stock-unit').textContent = item.unit;
  $('#adjust-amount').value = '';
  $('#adjust-action').value = 'in';
  $('#adjust-reason').value = 'stock_in';
  $('#stock-adjust-dialog').showModal();
}

$('#adjust-action').onchange = () => {
  const act = $('#adjust-action').value;
  $('#adjust-reason').value = act === 'in' ? 'stock_in' : 'wastage';
};

$('#submit-stock-adjust').onclick = async () => {
  const key = $('#adjust-stock-key').value;
  const act = $('#adjust-action').value;
  const amt = Number($('#adjust-amount').value);
  const reason = $('#adjust-reason').value;

  if (isNaN(amt) || amt <= 0) {
    alert('กรุณากรอกจำนวนให้ถูกต้อง');
    return;
  }

  const finalAmount = act === 'in' ? amt : -amt;

  try {
    await api('/api/admin/inventory/' + key + '/adjust', {
      method: 'POST',
      body: JSON.stringify({ amount: finalAmount, reason })
    });
    $('#stock-adjust-dialog').close();
    note('ปรับปรุงสต็อกสำเร็จ');
    await adminLoad();
    await load();
  } catch (e) {
    note(e.message, 'error');
  }
};

$('#stock-adjust-dialog').querySelector('.close').onclick = () => {
  $('#stock-adjust-dialog').close();
};

function settingRow(label, content) {
  const row = document.createElement('div');
  row.className = 'feature';
  row.append(label, content);
  return row;
}

// -----------------------------------------
// UNIFIED PRODUCT EDITOR OVERLAY (HOME SCREEN)
// -----------------------------------------
function renderEditRecipeList() {
  const container = $('#edit-recipe-items-list');
  if (!container) return;
  container.replaceChildren();
  
  if (currentEditRecipeItems.length === 0) {
    container.innerHTML = '<div style="font-size:12px; color:#888; font-style:italic; padding:6px 0;">ยังไม่มีการผูกสต็อกวัตถุดิบ/อุปกรณ์</div>';
    return;
  }
  
  currentEditRecipeItems.forEach((x, idx) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background:#faf8f5; border:1px solid #f1e7de; border-radius:6px; padding:6px 10px; font-size:12.5px;';
    
    row.innerHTML = `
      <span>📦 <b>${x.name}</b></span>
      <div style="display:flex; align-items:center; gap:8px;">
        <strong style="color:var(--primary);">${x.quantity} ${x.unit}</strong>
        <button type="button" class="secondary-btn" style="background:#fff0f2; color:#b12323; border:1px solid #f9d5d8; padding:2px 8px; border-radius:4px; font-size:10px; cursor:pointer;" id="del-recipe-idx-${idx}">ลบออก</button>
      </div>
    `;
    
    row.querySelector(`#del-recipe-idx-${idx}`).onclick = () => {
      currentEditRecipeItems.splice(idx, 1);
      renderEditRecipeList();
    };
    
    container.append(row);
  });
}

async function editProduct(p) {
  // Solo Operator UX Optimization:
  // When clicking edit, close settings panel (bounces/exits to Home screen register)
  // and display the unified editor dialog modal on top of Home!
  $('#settings').close();
  
  // Set basic info fields
  $('#edit-prod-id').value = p.id;
  $('#edit-prod-name').value = p.name;
  $('#edit-prod-price').value = p.price;
  $('#edit-prod-category').value = p.category;
  $('#edit-prod-emoji').value = p.emoji;
  $('#edit-prod-active').checked = p.active === 1;

  // Show Delete button for existing products
  $('#btn-delete-product').style.display = 'inline-block';
  $('#edit-prod-title').textContent = `แก้ไขสินค้า: ${p.name}`;

  try {
    // Fetch recipe items and description
    const res = await api(`/api/admin/products/${p.id}/recipe`);
    currentEditRecipeItems = res.items;
    $('#edit-recipe-description').value = res.description;
    
    renderEditRecipeList();
    
    // Open editor popover dialog modal
    $('#product-edit-dialog').showModal();
  } catch (e) {
    note(e.message, 'error');
  }
}

// Open Editor in "Add New Product" mode
$('#btn-trigger-add-product').onclick = () => {
  // Close settings panel (exits back to Home register screen)
  $('#settings').close();
  
  // Clear editor form fields
  $('#edit-prod-id').value = '';
  $('#edit-prod-name').value = '';
  $('#edit-prod-price').value = '';
  $('#edit-prod-category').value = state.categories[0]?.category_key || 'coffee';
  $('#edit-prod-emoji').value = '☕';
  $('#edit-prod-active').checked = true;
  $('#edit-recipe-description').value = '';
  currentEditRecipeItems = [];
  
  renderEditRecipeList();
  
  // Hide Delete button in Add mode
  $('#btn-delete-product').style.display = 'none';
  $('#edit-prod-title').textContent = 'เพิ่มสินค้าใหม่';
  
  // Open editor popover dialog modal
  $('#product-edit-dialog').showModal();
};

// Add recipe item row logic in editor modal
$('#btn-add-recipe-item').onclick = () => {
  const stockKey = $('#add-recipe-stock-key').value;
  const qty = Number($('#add-recipe-quantity').value);
  
  if (!stockKey || isNaN(qty) || qty <= 0) {
    alert('กรุณากรอกจำนวนวัตถุดิบ/อุปกรณ์ที่ใช้ให้ถูกต้อง');
    return;
  }
  
  const stockItem = state.inventory.find(x => x.stock_key === stockKey);
  if (!stockItem) return;
  
  // Check if item already exists in recipe items list
  const existing = currentEditRecipeItems.find(x => x.stock_key === stockKey);
  if (existing) {
    existing.quantity = qty;
  } else {
    currentEditRecipeItems.push({
      stock_key: stockKey,
      quantity: qty,
      name: stockItem.name,
      unit: stockItem.unit
    });
  }
  
  $('#add-recipe-quantity').value = '';
  renderEditRecipeList();
};

// Save Product & Recipe Action
$('#btn-save-product-edit').onclick = async () => {
  const id = $('#edit-prod-id').value;
  const name = $('#edit-prod-name').value.trim();
  const price = Number($('#edit-prod-price').value);
  const category = $('#edit-prod-category').value;
  const emoji = $('#edit-prod-emoji').value.trim() || '☕';
  const active = $('#edit-prod-active').checked;
  const description = $('#edit-recipe-description').value.trim();

  if (!name || isNaN(price) || price < 0 || !category) {
    alert('กรุณากรอกชื่อและราคาให้ถูกต้อง');
    return;
  }

  const payload = { name, price, category, emoji, active };

  try {
    let productId = Number(id);
    if (id) {
      // Edit mode product update
      await api(`/api/admin/products/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      note('บันทึกการแก้ไขสินค้าสำเร็จ');
    } else {
      // Add mode product creation
      const res = await api('/api/admin/products', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      productId = res.id;
      note('เพิ่มสินค้าใหม่สำเร็จ');
    }

    // Save recipe items & instruction description
    await api(`/api/admin/products/${productId}/recipe`, {
      method: 'PUT',
      body: JSON.stringify({
        items: currentEditRecipeItems,
        description
      })
    });

    $('#product-edit-dialog').close();
    await load();
    await adminLoad();
  } catch (e) {
    note(e.message, 'error');
  }
};

// Delete Product Action
$('#btn-delete-product').onclick = async () => {
  const id = $('#edit-prod-id').value;
  if (!id) return;
  
  if (!confirm('🗑️ ยืนยันว่าต้องการลบสินค้านี้ออกจากระบบร้านค้าโดยเด็ดขาด?')) return;
  
  try {
    await api(`/api/admin/products/${id}`, { method: 'DELETE' });
    note('ลบสินค้าเรียบร้อยแล้ว');
    $('#product-edit-dialog').close();
    await load();
    await adminLoad();
  } catch (e) {
    note(e.message, 'error');
  }
};

$('#product-edit-dialog').querySelector('.close').onclick = () => {
  $('#product-edit-dialog').close();
};

// -----------------------------------------
// PRODUCT-CENTRIC ONLINE CHANNEL GP PRICING
// -----------------------------------------
async function renderChannelPricingGrid() {
  const pricingContainer = $('#channel-pricing-grid');
  if (!pricingContainer) return;
  
  try {
    const bootstrap = await api('/api/bootstrap');
    const pricing = await api('/api/pricing');
    
    const productPrices = {};
    pricing.forEach(x => {
      if (!productPrices[x.product_id]) {
        productPrices[x.product_id] = {
          name: x.name,
          store_price: x.store_price,
          channels: {}
        };
      }
      productPrices[x.product_id].channels[x.channel_key] = {
        channel_name: x.channel_name,
        gp_percent: x.gp_percent,
        sale_price: x.sale_price,
        suggested_price: x.suggested_price
      };
    });
    
    pricingContainer.innerHTML = '';
    
    Object.entries(productPrices).forEach(([prodId, p]) => {
      const row = document.createElement('div');
      row.className = 'price-grid-row';
      row.style.cssText = 'border:1px solid #f1e7de; border-radius:12px; padding:12px; margin-bottom:12px; background:#faf8f5;';
      
      let html = `
        <div style="font-weight:700; font-size:13.5px; margin-bottom:10px; color:var(--primary); display:flex; justify-content:space-between;">
          <span>☕ ${p.name}</span>
          <span style="color:#8c5d43;">หน้าร้าน: ${money(p.store_price)}</span>
        </div>
        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:10px;" class="channels-grid-inputs">
      `;
      
      bootstrap.channels.forEach(ch => {
        const item = p.channels[ch.channel_key] || { gp_percent: ch.gp_percent, sale_price: null, suggested_price: p.store_price / (1 - ch.gp_percent / 100) };
        const val = item.sale_price !== null ? item.sale_price : '';
        const suggested = Number(p.store_price / (1 - ch.gp_percent / 100)).toFixed(2);
        
        html += `
          <div class="channel-price-input-box" style="display:flex; flex-direction:column; gap:4px; font-size:11.5px;">
            <label style="font-weight:600; color:var(--text-muted);">${ch.name} (แนะนำ ฿${suggested})</label>
            <input type="number" step="0.5" class="online-price-field" data-product-id="${prodId}" data-channel-key="${ch.channel_key}" value="${val}" placeholder="฿${suggested}" style="padding:6px; font-size:12px;">
          </div>
        `;
      });
      
      html += `
        </div>
        <div style="display:flex; justify-content:flex-end; margin-top:8px;">
          <button type="button" class="primary-btn save-all-channels-btn" style="font-size:11px; padding:6px 12px;">บันทึกราคาออนไลน์</button>
        </div>
      `;
      row.innerHTML = html;
      
      row.querySelector('.save-all-channels-btn').onclick = async () => {
        const inputs = row.querySelectorAll('.online-price-field');
        try {
          for (const input of inputs) {
            const salePrice = Number(input.value);
            if (input.value.trim() !== '') {
              await api('/api/admin/channel-prices', {
                method: 'PUT',
                body: JSON.stringify({
                  productId: Number(input.getAttribute('data-product-id')),
                  channelKey: input.getAttribute('data-channel-key'),
                  salePrice
                })
              });
            }
          }
          note('บันทึกราคาทุกแอพสำเร็จ');
          await adminLoad();
        } catch (e) {
          note(e.message, 'error');
        }
      };
      
      pricingContainer.append(row);
    });
  } catch (e) {
    pricingContainer.textContent = 'โหลดกริดแก้ไขราคาไม่สำเร็จ';
  }
}

// -----------------------------------------
// CATEGORY MANAGEMENT VISUAL TABLE
// -----------------------------------------
function renderCategoriesTable() {
  const container = $('#categories-table-container');
  if (!container) return;
  
  if (state.categories.length === 0) {
    container.innerHTML = '<p style="padding:10px; color:#888; text-align:center;">ยังไม่มีหมวดหมู่</p>';
    return;
  }
  
  let html = `
    <table style="width:100%; border-collapse:collapse; font-size:12.5px; text-align:left;">
      <thead>
        <tr style="background:#fdf6ee; border-bottom:1px solid #f1e7de; color:var(--primary); font-weight:700;">
          <th style="padding:8px;">รหัสคีย์</th>
          <th style="padding:8px;">ชื่อภาษาไทย</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  html += state.categories.map(x => `
    <tr style="border-bottom:1px solid #faf6f2;">
      <td style="padding:8px; font-weight:600; font-family:Courier, monospace;">${x.category_key}</td>
      <td style="padding:8px;">${x.name}</td>
    </tr>
  `).join('');
  
  html += '</tbody></table>';
  container.innerHTML = html;
}

async function adminLoad() {
  const d = await api('/api/admin/settings');
  $('#auth').hidden = true;
  $('#admin').hidden = false;

  // 1. Feature toggles
  const f = $('#features');
  f.replaceChildren(...d.features.map(x => {
    const c = Object.assign(document.createElement('input'), { type: 'checkbox', checked: x.enabled });
    c.onchange = async () => {
      await api('/api/admin/settings/' + x.feature_key, { method: 'PUT', body: JSON.stringify({ enabled: c.checked }) });
      await load();
    };
    return settingRow(x.feature_key, c);
  }));

  const b = await api('/api/bootstrap');
  
  // Populate category list in dropdowns
  const catSelect = $('#prod-category');
  catSelect.replaceChildren();
  b.categories.forEach(x => catSelect.append(new Option(x.name, x.category_key)));
  
  const editCatSelect = $('#edit-prod-category');
  editCatSelect.replaceChildren();
  b.categories.forEach(x => editCatSelect.append(new Option(x.name, x.category_key)));

  // Populate inventory items selector dropdown for recipe builder
  const recipeStockSelect = $('#add-recipe-stock-key');
  recipeStockSelect.replaceChildren();
  b.inventory.forEach(x => recipeStockSelect.append(new Option(`${x.name} (${x.unit})`, x.stock_key)));

  // Store lists to global state
  state.categories = b.categories;
  state.inventory = b.inventory;
  state.products = b.products;

  // 2. Admin products management list
  const adminProducts = await api('/api/admin/products');
  const prodContainer = $('#admin-products');
  prodContainer.replaceChildren();

  adminProducts.forEach(p => {
    const row = document.createElement('div');
    row.className = 'feature';
    row.style.borderBottom = '1px solid #f2ebe5';
    row.style.padding = '8px 0';
    row.style.fontSize = '13px';
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';

    const infoSpan = document.createElement('span');
    const recipe = state.recipesData.find(r => r.id === p.id);
    const hasRecipe = recipe && (recipe.items?.length > 0 || recipe.description);
    const rBadge = hasRecipe 
      ? '<span style="color:#27ae60; font-size:10px; font-weight:700; margin-left:4px;">[มีสูตรชง]</span>' 
      : '<span style="color:#e67e22; font-size:10px; font-weight:700; margin-left:4px;">[ไม่มีสูตร]</span>';
      
    infoSpan.innerHTML = `${p.emoji} <b>${p.name}</b> — ${money(p.price)} <small style="color:#a87c5e">(${p.category})</small> ${rBadge} ${p.active ? '' : '<span style="color:#b12323; font-weight:700; font-size:10px; margin-left:4px;">[ปิดขาย]</span>'}`;

    const editBtn = document.createElement('button');
    editBtn.textContent = 'แก้ไข';
    editBtn.className = 'edit-btn';
    editBtn.style.cssText = 'border:1px solid #dfcec0; background:#fff; border-radius:6px; padding:4px 8px; cursor:pointer; font-size:11px;';
    editBtn.onclick = () => editProduct(p);

    row.append(infoSpan, editBtn);
    prodContainer.append(row);
  });

  // 3. Online Sales Channels GP
  const ch = $('#channels');
  ch.replaceChildren(...b.channels.map(x => {
    const gp = Object.assign(document.createElement('input'), { type: 'number', min: 0, max: 99.99, step: .01, value: x.gp_percent });
    const save = document.createElement('button');
    save.textContent = 'บันทึก';
    save.onclick = async () => {
      try {
        await api('/api/admin/channels/' + x.channel_key, { method: 'PUT', body: JSON.stringify({ gpPercent: Number(gp.value), active: true }) });
        await adminLoad();
      } catch (e) {
        note(e.message, 'error');
      }
    };
    const box = document.createElement('span');
    box.append(gp, save);
    return settingRow(`${x.name} GP (%)`, box);
  }));

  // 4. Product Centric Pricing Grid
  await renderChannelPricingGrid();

  // 5. Visual categories table
  renderCategoriesTable();

  // 6. Grouped Inventory Stock List
  renderInventoryList();
}

// Category Add Actions
$('#add-category').onclick = async () => {
  try {
    await api('/api/admin/categories', { method: 'POST', body: JSON.stringify({ key: $('#new-category-key').value, name: $('#new-category-name').value }) });
    $('#new-category-key').value = '';
    $('#new-category-name').value = '';
    await adminLoad(); await load();
  } catch (e) { note(e.message, 'error'); }
};

$('#search').oninput = renderProducts;
$('#discount').oninput = renderCart;
$('#checkout').onclick = checkout;
$('#settingsBtn').onclick = () => {
  const featureTabBtn = document.querySelector('.admin-tab-btn[data-tab="tab-features"]');
  if (featureTabBtn) featureTabBtn.click();
  $('#settings').showModal();
};

$('#login').onclick = async () => {
  adminPin = $('#pin').value;
  try {
    await adminLoad();
  } catch (e) {
    adminPin = '';
    note(e.message, 'error');
  }
};

$('#refresh').onclick = adminLoad;

// Start initialization
load().catch(e => note(e.message, 'error'));
