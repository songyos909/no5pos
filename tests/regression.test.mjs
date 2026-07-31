import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('HTML ids are unique and asset versions match', async () => {
  const html = await read('public/index.html');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate HTML id');
  const versions = [...html.matchAll(/(?:app\.js|firebase-client\.js|styles\.css)\?v=([^"'&]+)/g)].map(match => match[1]);
  assert.equal(versions.length, 3);
  assert.equal(new Set(versions).size, 1, 'asset cache versions differ');
});

test('all static app element references exist', async () => {
  const [html, app] = await Promise.all([read('public/index.html'), read('public/app.js')]);
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const refs = [...app.matchAll(/\$\('#([^']+)'\)/g)].map(match => match[1]);
  const missing = [...new Set(refs.filter(id => !ids.has(id) && id !== 'active-modules'))];
  assert.deepEqual(missing, []);
});

test('checkout security and reusable options exist in both backends', async () => {
  const [server, firebase] = await Promise.all([read('server.js'), read('public/firebase-client.js')]);
  for (const source of [server, firebase]) {
    assert.match(source, /manualDiscount/);
    assert.match(source, /option-groups/);
    assert.match(source, /channelPrices|channel_prices/);
    assert.match(source, /redeemFreeCup/);
  }
  assert.match(firebase, /inventoryReads/);
  assert.match(server, /\+7 hours/);
});

test('custom menu options start unselected in UI and both backends', async () => {
  const [app, server, firebase] = await Promise.all([
    read('public/app.js'),
    read('server.js'),
    read('public/firebase-client.js')
  ]);
  assert.match(app, /modifierOptions=\{custom:\{\},custom_labels:\[\]\}/);
  assert.match(app, /none\.textContent='ไม่เลือก'/);
  for (const source of [app, server, firebase]) {
    assert.doesNotMatch(source, /find\([^;\n]+\)\|\|(?:group\.)?choices\[0\]/);
  }
});

test('receipts preserve modifier detail and paid modifier prices', async () => {
  const [app, server, firebase] = await Promise.all([
    read('public/app.js'),
    read('server.js'),
    read('public/firebase-client.js')
  ]);
  assert.match(app, /receiptModifierDetails/);
  assert.match(app, /custom_details/);
  assert.match(app, /detail\.price>0/);
  assert.match(app, /unitPrice\*quantity/);
  for (const source of [server, firebase]) {
    assert.match(source, /custom_details/);
    assert.match(source, /price/);
  }
});

test('advanced reports expose common filters and ranking dashboards', async () => {
  const [html, app, server, firebase] = await Promise.all([
    read('public/index.html'),
    read('public/app.js'),
    read('server.js'),
    read('public/firebase-client.js')
  ]);
  for (const id of ['report-date-from','report-date-to','report-category','report-product','report-sales-channel','rep-top-revenue-list','rep-top-addons-list']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const source of [server, firebase]) {
    for (const field of ['dateFrom','dateTo','category','productId','salesChannel','topByQuantity','topByRevenue','topAddons']) {
      assert.match(source, new RegExp(field));
    }
  }
  assert.match(firebase, /new URL\(url,window\.location\.origin\)/);
  assert.match(app, /reportQueryString/);
});

test('Firebase migration includes options, online prices and boolean conversion', async () => {
  const html = await read('public/firebase-import.html');
  assert.match(html, /optionGroups/);
  assert.match(html, /channelPrices/);
  assert.match(html, /deduct_stock:x\.deduct_stock!==0/);
  assert.match(html, /active:x\.active!==0/);
});

test('Firebase respects deleted or disabled categories and GP channels after initial setup', async () => {
  const firebase = await read('public/firebase-client.js');
  assert.match(firebase, /effectiveFirebaseChannels/);
  assert.match(firebase, /channels\.filter\(channel=>channel\.active!==false\)/);
  assert.match(firebase, /categories\.filter\(category=>category\.active!==false\)/);
  assert.doesNotMatch(firebase, /restoreDefaultCategories|restoreDefaultChannels/);
});

test('default data is seeded once without recreating user-deleted records', async () => {
  const [server, firebase] = await Promise.all([
    read('server.js'),
    read('public/firebase-client.js')
  ]);
  for (const source of [server, firebase]) {
    for (const category of ['coffee','tea','food','dessert','bakery','other']) {
      assert.match(source, new RegExp(`['"]${category}['"]`));
    }
  }
  assert.match(firebase, /required_menu_seeded/);
  assert.match(firebase, /effectiveFirebaseCategories/);
  assert.match(server, /INSERT OR IGNORE INTO categories/);
});

test('filtered transaction reports return only matching items and matching totals', async () => {
  const [server, firebase] = await Promise.all([
    read('server.js'),
    read('public/firebase-client.js')
  ]);
  for (const source of [server, firebase]) {
    assert.match(source, /lineFiltered/);
    assert.match(source, /filteredSubtotal/);
    assert.match(source, /received:\s*lineFiltered\?null/);
  }
  assert.match(server, /LEFT JOIN products p ON p\.id=oi\.product_id/);
  assert.match(firebase, /visibleItems/);
});

test('admin form action buttons cannot submit and close their parent dialogs', async () => {
  const app = await read('public/app.js');
  for (const button of ['adjustBtn','editBtn','deleteBtn','saveBtn']) {
    assert.match(app, new RegExp(`${button}\\.type = 'button'`));
  }
  assert.match(app, /type="button" data-edit-category/);
  assert.match(app, /type="button" data-delete-category/);
});

test('online checkout does not require or store a payment method', async () => {
  const [html, app, server, firebase] = await Promise.all([
    read('public/index.html'),
    read('public/app.js'),
    read('server.js'),
    read('public/firebase-client.js')
  ]);
  assert.match(html, /id="payment-field"/);
  assert.match(app, /paymentField\.hidden = online/);
  assert.match(app, /salesChannel === 'online' \? 'online'/);
  assert.match(app, /paymentType === 'online'/);
  for (const source of [server, firebase]) {
    assert.match(source, /normalizedPaymentType|const paymentType=salesChannel==='online'\?'online'/);
    assert.match(source, /(?:requestedSalesChannel|salesChannel)==='store'&&!\['cash','qr'\]\.includes/);
  }
});

test('online orders default to LINE MAN while preserving an existing selection', async () => {
  const app = await read('public/app.js');
  assert.match(app, /DEFAULT_ONLINE_CHANNEL_KEY = 'lineman'/);
  assert.match(app, /channel\.channel_key === previous/);
  assert.match(app, /channel\.channel_key === DEFAULT_ONLINE_CHANNEL_KEY/);
});

test('menu, option group and option choice ordering persist in both backends', async () => {
  const [app, server, firebase] = await Promise.all([
    read('public/app.js'),
    read('server.js'),
    read('public/firebase-client.js')
  ]);
  assert.match(app, /admin\/products\/order/);
  assert.match(app, /admin\/option-groups\/order/);
  assert.match(app, /moveArrayItem/);
  assert.match(app, /optionGroupDraft\.choices=moveArrayItem/);
  assert.match(app, /bindPressDragSort/);
  assert.match(app, /setPointerCapture/);
  assert.match(app, /data-sort-handle/);
  assert.match(app, /แตะค้างแล้วลาก/);
  assert.match(app, /เลื่อนเมนูขึ้น/);
  assert.match(app, /เลื่อนตัวเลือกขึ้น/);
  for (const source of [server, firebase]) {
    assert.match(source, /sort_order/);
    assert.match(source, /admin\/products\/order/);
    assert.match(source, /admin\/option-groups\/order/);
    assert.match(source, /custom_options/);
  }
  assert.match(server, /ORDER BY sort_order,category,name/);
  assert.match(firebase, /sortBySavedOrder/);
});

test('category ordering persists with drag and arrow controls in both backends', async () => {
  const [app, server, firebase, css] = await Promise.all([
    read('public/app.js'),
    read('server.js'),
    read('public/firebase-client.js'),
    read('public/styles.css')
  ]);
  assert.match(app, /admin\/categories\/order/);
  assert.match(app, /persistCategoryOrder/);
  assert.match(app, /data-category-up/);
  assert.match(app, /data-category-down/);
  assert.match(app, /ลากจัดลำดับหมวดหมู่/);
  assert.match(server, /ALTER TABLE categories ADD COLUMN sort_order/);
  assert.match(server, /ORDER BY sort_order,name/);
  for (const source of [server, firebase]) {
    assert.match(source, /admin\/categories\/order/);
    assert.match(source, /ลำดับหมวดหมู่ไม่ถูกต้อง/);
  }
  assert.match(firebase, /sortBySavedOrder\(categories\.filter/);
  assert.match(css, /\.category-order-actions/);
});

test('modifier choices support separate online prices with store-price fallback', async () => {
  const [html, app, server, firebase] = await Promise.all([
    read('public/index.html'),
    read('public/app.js'),
    read('server.js'),
    read('public/firebase-client.js')
  ]);
  for (const source of [app, server, firebase]) assert.match(source, /online_price/);
  assert.match(html, /เว้นราคาออนไลน์ว่าง/);
  assert.match(app, /choice\?\.online_price \?\? choice\?\.price/);
  assert.match(app, /placeholder='ราคาออนไลน์'/);
  assert.match(server, /selectedCustomOptions\(product,raw,normalizedSalesChannel==='online'\)/);
  assert.match(firebase, /salesChannel==='online'\?\(selected\.online_price\?\?selected\.price\)/);
});

test('all-category catalog ranks best sellers by quantity in both backends', async () => {
  const [app, server, firebase, css] = await Promise.all([
    read('public/app.js'),
    read('server.js'),
    read('public/firebase-client.js'),
    read('public/styles.css')
  ]);
  assert.match(app, /state\.selectedCategory === 'all'/);
  assert.match(app, /เมนูขายดี เรียงตามจำนวนที่ขายได้/);
  assert.match(app, /bestsellerRank/);
  assert.match(app, /ขายดี #/);
  assert.match(app, /name\.before\(badge\)/);
  assert.match(server, /sum\(oi\.quantity\) qty/);
  assert.match(server, /ORDER BY qty DESC/);
  assert.match(firebase, /sellerTotals/);
  assert.match(firebase, /\.sort\(\(a,b\)=>b\.qty-a\.qty/);
  assert.match(css, /\.product \.bestseller-badge/);
  assert.doesNotMatch(css, /\.bestseller-badge \{ position:absolute/);
});

test('responsive POS has desktop, tablet and mobile cart layouts', async () => {
  const [html, app, css] = await Promise.all([
    read('public/index.html'),
    read('public/app.js'),
    read('public/styles.css')
  ]);
  assert.match(html, /id="mobile-cart-toggle"/);
  assert.match(html, /id="mobile-cart-close"/);
  assert.match(html, /id="mobile-cart-summary"/);
  assert.match(app, /setMobileCartOpen/);
  assert.match(app, /max-width:800px/);
  assert.match(app, /mobile-cart-summary/);
  assert.match(css, /min-width:801px\) and \(max-width:1180px/);
  assert.match(css, /\.cart\.mobile-open/);
  assert.match(css, /\.mobile-cart-toggle/);
  assert.match(css, /100dvh/);
  assert.match(css, /repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /#settings #admin:not\(\[hidden\]\)/);
  assert.match(css, /#settings \.admin-tab-content[\s\S]*overflow-y:auto/);
  assert.match(css, /touch-action:pan-y/);
  assert.match(css, /#tab-members \.loyalty-settings-heading[\s\S]*position:sticky/);
});

test('product editor always synchronizes category choices', async () => {
  const app = await read('public/app.js');
  assert.match(app, /function syncProductCategoryOptions/);
  assert.match(app, /syncProductCategoryOptions\(\);/);
  assert.match(app, /syncProductCategoryOptions\(product\?\.category\)/);
  assert.match(app, /select\.replaceChildren\(\.\.\.options\)/);
  assert.match(app, /state\.categories\.some\(category => String\(category\.category_key\) === String\(savedCategory\)\)/);
});

test('dialog close buttons have reliable touch targets and a shared fallback', async () => {
  const [app, css] = await Promise.all([
    read('public/app.js'),
    read('public/styles.css')
  ]);
  assert.match(css, /\.close \{[\s\S]*width: 52px/);
  assert.match(css, /\.close \{[\s\S]*touch-action: manipulation/);
  assert.match(css, /dialog:not\(#kds-dialog\) header \.close \{[\s\S]*z-index:20/);
  assert.match(app, /event\.target\.closest\?\.\('button\.close'\)/);
  assert.match(app, /dialog\.close\('cancel'\)/);
});

test('loyalty points can be configured for all, category or individual products', async () => {
  const [html, app, server, firebase] = await Promise.all([
    read('public/index.html'),
    read('public/app.js'),
    read('server.js'),
    read('public/firebase-client.js')
  ]);
  for (const mode of ['all','category','product']) assert.match(html,new RegExp(`name="loyalty-mode" value="${mode}"`));
  assert.match(html, /id="loyalty-category-list"/);
  assert.match(html, /id="loyalty-product-list"/);
  assert.match(html, /id="loyalty-reward-points"/);
  assert.match(html, /id="loyalty-reward-type"/);
  assert.match(html, /id="loyalty-reward-category-list"/);
  assert.match(html, /id="loyalty-reward-product-list"/);
  assert.match(html, /id="loyalty-earn-store"/);
  assert.match(html, /id="loyalty-earn-online"/);
  assert.match(app, /normalizeLoyaltySettings/);
  assert.match(app, /loyaltyRewardForCart/);
  assert.match(app, /admin\/loyalty-settings/);
  assert.match(server, /loyaltyProductEligible/);
  assert.match(server, /loyaltyRewardProductEligible/);
  assert.match(server, /loyalty_settings/);
  assert.match(firebase, /settings'\)\.doc\('loyalty'/);
  for (const source of [server,firebase]) {
    assert.match(source, /mode==='category'/);
    assert.match(source, /mode==='product'/);
    assert.match(source, /categoryKeys/);
    assert.match(source, /productIds/);
    assert.match(source, /rewardPoints/);
    assert.match(source, /rewardType/);
    assert.match(source, /rewardMaxPrice/);
    assert.match(source, /rewardDiscountAmount/);
    assert.match(source, /earnStore/);
    assert.match(source, /earnOnline/);
  }
});
