import express from 'express';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// โหลดค่า environment จาก .env โดยไม่ต้องเพิ่ม dependency
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'cafe.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price REAL NOT NULL CHECK(price >= 0), category TEXT NOT NULL, emoji TEXT NOT NULL DEFAULT '☕', active INTEGER NOT NULL DEFAULT 1, stock_key TEXT, deduct_stock INTEGER NOT NULL DEFAULT 1, image_path TEXT, image_data TEXT, custom_options_json TEXT NOT NULL DEFAULT '[]', sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS inventory (stock_key TEXT PRIMARY KEY, name TEXT NOT NULL, unit TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 0, low_alert REAL NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'raw');
CREATE TABLE IF NOT EXISTS recipes (product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE, ingredients TEXT NOT NULL, steps TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members (phone TEXT PRIMARY KEY, name TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS feature_settings (feature_key TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, subtotal REAL NOT NULL, discount REAL NOT NULL, total REAL NOT NULL, payment_type TEXT NOT NULL, sales_channel TEXT NOT NULL DEFAULT 'store', online_platform TEXT, gp_percent REAL NOT NULL DEFAULT 0, online_net REAL, member_phone TEXT REFERENCES members(phone));
CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), product_id INTEGER, name TEXT NOT NULL, unit_price REAL NOT NULL, quantity INTEGER NOT NULL, options_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS stock_movements (id INTEGER PRIMARY KEY, stock_key TEXT NOT NULL REFERENCES inventory(stock_key), quantity REAL NOT NULL, reason TEXT NOT NULL, order_id TEXT REFERENCES orders(id), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categories (category_key TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS option_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, choices_json TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sales_channels (channel_key TEXT PRIMARY KEY, name TEXT NOT NULL, gp_percent REAL NOT NULL DEFAULT 0 CHECK(gp_percent >= 0 AND gp_percent < 100), active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS channel_prices (product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, channel_key TEXT NOT NULL REFERENCES sales_channels(channel_key) ON DELETE CASCADE, sale_price REAL NOT NULL CHECK(sale_price >= 0), PRIMARY KEY(product_id, channel_key));
`);

// Migration: Add status column to order_items if it doesn't exist
try {
  db.prepare("SELECT status FROM order_items LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE order_items ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'");
}

// Migration: Add received and change_due columns to orders if they don't exist
try {
  db.prepare("SELECT received FROM orders LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE orders ADD COLUMN received REAL DEFAULT 0");
  db.exec("ALTER TABLE orders ADD COLUMN change_due REAL DEFAULT 0");
}

// Migration: Add description column to recipes if it doesn't exist
try {
  db.prepare("SELECT description FROM recipes LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE recipes ADD COLUMN description TEXT DEFAULT ''");
}

// Migration: Create structured recipe_items table
db.exec(`
CREATE TABLE IF NOT EXISTS recipe_items (
  product_id INTEGER,
  stock_key TEXT,
  quantity REAL,
  PRIMARY KEY (product_id, stock_key),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (stock_key) REFERENCES inventory(stock_key) ON DELETE CASCADE
)
`);
db.exec(`CREATE TABLE IF NOT EXISTS recipe_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, items_json TEXT NOT NULL, created_at TEXT NOT NULL)`);
try { db.exec('ALTER TABLE products ADD COLUMN deduct_stock INTEGER NOT NULL DEFAULT 1'); } catch {}
try { db.exec('ALTER TABLE products ADD COLUMN image_path TEXT'); } catch {}
try { db.exec('ALTER TABLE products ADD COLUMN image_data TEXT'); } catch {}
try { db.exec("ALTER TABLE products ADD COLUMN custom_options_json TEXT NOT NULL DEFAULT '[]'"); } catch {}
try { db.exec("ALTER TABLE products ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE option_groups ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE orders ADD COLUMN sales_channel TEXT NOT NULL DEFAULT 'store'"); } catch {}
try { db.exec("ALTER TABLE orders ADD COLUMN online_platform TEXT"); } catch {}
try { db.exec("ALTER TABLE orders ADD COLUMN gp_percent REAL NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE orders ADD COLUMN online_net REAL"); } catch {}
db.prepare("UPDATE products SET image_path='menu-images/matcha-latte.png' WHERE image_path IS NULL AND lower(name) LIKE '%matcha%'").run();
db.prepare("UPDATE products SET image_path='menu-images/thai-tea.png' WHERE image_path IS NULL AND (name LIKE '%ชาไทย%' OR lower(name) LIKE '%thai tea%')").run();
db.prepare("UPDATE products SET image_path='menu-images/espresso-hot.png' WHERE image_path IS NULL AND (name LIKE '%เอสเพรสโซ่ร้อน%' OR lower(name) LIKE '%espresso%hot%')").run();
db.prepare("UPDATE products SET image_path='menu-images/espresso-iced.png' WHERE image_path IS NULL AND (name LIKE '%เอสเพรสโซ่เย็น%' OR lower(name) LIKE '%iced espresso%')").run();
db.prepare("UPDATE products SET image_path='menu-images/americano-iced.png' WHERE image_path IS NULL AND (name LIKE '%อเมริกาโน่%' OR lower(name) LIKE '%americano%')").run();
db.prepare("UPDATE products SET image_path='menu-images/latte-iced.png' WHERE image_path IS NULL AND lower(name) LIKE '%latte%' AND lower(name) NOT LIKE '%matcha%'").run();
db.prepare("UPDATE products SET image_path='menu-images/cappuccino-hot.png' WHERE image_path IS NULL AND (name LIKE '%คาปูชิโน่%' OR lower(name) LIKE '%cappuccino%')").run();
db.prepare("UPDATE products SET image_path='menu-images/mocha-iced.png' WHERE image_path IS NULL AND (name LIKE '%มอคค่า%' OR lower(name) LIKE '%mocha%')").run();
db.prepare("UPDATE products SET image_path='menu-images/caramel-macchiato-iced.png' WHERE image_path IS NULL AND (name LIKE '%คาราเมลมัคคิอาโต้%' OR lower(name) LIKE '%caramel macchiato%')").run();

// Migration: Update category column to use ingredient / equipment
try {
  db.prepare("SELECT category FROM inventory LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE inventory ADD COLUMN category TEXT NOT NULL DEFAULT 'ingredient'");
}

try {
  db.prepare("SELECT cost_per_unit FROM inventory LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE inventory ADD COLUMN cost_per_unit REAL NOT NULL DEFAULT 0");
}
try { db.prepare("SELECT purchase_quantity FROM inventory LIMIT 1").get(); }
catch { db.exec("ALTER TABLE inventory ADD COLUMN purchase_quantity REAL NOT NULL DEFAULT 0; ALTER TABLE inventory ADD COLUMN purchase_total REAL NOT NULL DEFAULT 0"); }
try { db.prepare("SELECT material_type FROM inventory LIMIT 1").get(); }
catch { db.exec("ALTER TABLE inventory ADD COLUMN material_type TEXT NOT NULL DEFAULT 'other'"); }
try { db.prepare("SELECT name_th FROM inventory LIMIT 1").get(); }
catch { db.exec("ALTER TABLE inventory ADD COLUMN name_th TEXT"); }
try { db.prepare("SELECT name_th FROM products LIMIT 1").get(); }
catch { db.exec("ALTER TABLE products ADD COLUMN name_th TEXT"); }
db.exec("UPDATE inventory SET material_type='coffee_beans' WHERE stock_key='coffee_beans'; UPDATE inventory SET material_type='cocoa' WHERE stock_key='cocoa_powder'; UPDATE inventory SET material_type='tea' WHERE stock_key='tea_leaves'; UPDATE inventory SET material_type='milk' WHERE stock_key IN ('milk','condensed_milk','evaporated_milk'); UPDATE inventory SET material_type='syrup' WHERE stock_key LIKE '%syrup%';");
const thaiInventoryNames = { coffee_beans:'เมล็ดกาแฟ', condensed_milk:'นมข้นหวาน', evaporated_milk:'นมข้นจืด', cocoa_powder:'ผงโกโก้', caramel_syrup:'ไซรัปคาราเมล', ice:'น้ำแข็ง', milk:'นมสด', tea_leaves:'ใบชา', croissant:'ครัวซองต์', cup_hot:'แก้วร้อน 8 ออนซ์', cup_cold:'แก้วเย็น 16 ออนซ์', straw:'หลอดพลาสติก' };
const thaiProductNames = { 'Espresso (Hot)':'เอสเปรสโซ่ร้อน', 'Iced Espresso':'เอสเปรสโซ่เย็น', Americano:'อเมริกาโน่เย็น', Latte:'ลาเต้เย็น', Cappuccino:'คาปูชิโน่เย็น', Mocha:'มอคค่าเย็น', 'Caramel Macchiato':'คาราเมลมัคคิอาโต', 'Matcha Latte':'มัทฉะลาเต้', 'Pure Matcha':'มัทฉะแท้ 100%' };
const setThaiInventory = db.prepare("UPDATE inventory SET name_th=? WHERE stock_key=? AND (name_th IS NULL OR name_th='')");
Object.entries(thaiInventoryNames).forEach(([key,name]) => setThaiInventory.run(name,key));
const setThaiProduct = db.prepare("UPDATE products SET name_th=? WHERE name=? AND (name_th IS NULL OR name_th='')");
Object.entries(thaiProductNames).forEach(([name,thai]) => setThaiProduct.run(thai,name));
// Data-quality migration: identifiers and historical order rows are never changed.
const canonicalUnits = { g:'กรัม', gram:'กรัม', grams:'กรัม', 'กรับ':'กรัม', ml:'มล.', 'มล':'มล.', pcs:'ชิ้น', pc:'ชิ้น', piece:'ชิ้น', pieces:'ชิ้น' };
const normalizeUnit = db.prepare('UPDATE inventory SET unit=? WHERE lower(trim(unit))=?');
Object.entries(canonicalUnits).forEach(([from,to]) => normalizeUnit.run(to,from));
db.exec("UPDATE inventory SET name=trim(replace(replace(replace(replace(replace(name,' (กรัม)',''),' (มล.)',''),' (ใบ)',''),' (เส้น)',''),' (ชิ้น)',''));");
db.exec("UPDATE inventory SET material_type='coffee_beans' WHERE stock_key IN ('coffee_nan','coffee_ethiopia'); UPDATE inventory SET material_type='cocoa' WHERE stock_key='cocoa'; UPDATE inventory SET material_type='milk' WHERE stock_key='milk01'; UPDATE inventory SET material_type='equipment' WHERE category='equipment';");
db.exec("UPDATE inventory SET name_th='เมล็ดกาแฟน่าน' WHERE stock_key='coffee_nan' AND name_th IS NULL; UPDATE inventory SET name_th='เมล็ดกาแฟเอธิโอเปีย' WHERE stock_key='coffee_ethiopia' AND name_th IS NULL; UPDATE inventory SET name_th='ผงโกโก้' WHERE stock_key='cocoa' AND name_th IS NULL; UPDATE inventory SET name_th='นมข้นหวาน' WHERE stock_key='milk01' AND name_th IS NULL; UPDATE inventory SET name_th='ฝาแก้วเย็น 16 ออนซ์' WHERE stock_key='002' AND name_th IS NULL;");
try { db.prepare("SELECT target_margin FROM products LIMIT 1").get(); }
catch { db.exec("ALTER TABLE products ADD COLUMN target_margin REAL NOT NULL DEFAULT 0.65"); }

// Ensure database seeded items use either 'ingredient' or 'equipment'
db.exec(`
  UPDATE inventory SET category = 'ingredient' WHERE category IN ('raw', 'liquid', 'bakery');
  UPDATE inventory SET category = 'equipment' WHERE category = 'packaging';
`);

// Seed default inventory items
const storeWasReset = db.prepare("SELECT enabled FROM feature_settings WHERE feature_key='store_reset'").get()?.enabled === 1;
if (!storeWasReset) {
const insertInv = db.prepare("INSERT OR IGNORE INTO inventory (stock_key, name, unit, quantity, low_alert, category) VALUES (?, ?, ?, ?, ?, ?)");
insertInv.run('condensed_milk', 'Sweetened condensed milk', 'ml', 5000, 800, 'ingredient');
insertInv.run('evaporated_milk', 'Evaporated milk', 'ml', 5000, 800, 'ingredient');
insertInv.run('cocoa_powder', 'Cocoa powder', 'g', 2000, 300, 'ingredient');
insertInv.run('caramel_syrup', 'Caramel syrup', 'ml', 1500, 250, 'ingredient');
insertInv.run('ice', 'Ice', 'g', 20000, 3000, 'ingredient');
insertInv.run('coffee_beans', 'เมล็ดกาแฟ', 'กรัม', 5000, 1000, 'ingredient');
insertInv.run('milk', 'นมสด', 'มล.', 10000, 2000, 'ingredient');
insertInv.run('tea_leaves', 'ใบชา', 'กรัม', 3000, 500, 'ingredient');
insertInv.run('croissant', 'ครัวซองต์', 'ชิ้น', 30, 10, 'ingredient');
insertInv.run('cup_hot', 'แก้วร้อน 8oz', 'ใบ', 500, 100, 'equipment');
insertInv.run('cup_cold', 'แก้วเย็น 16oz', 'ใบ', 1000, 200, 'equipment');
insertInv.run('straw', 'หลอดพลาสติก', 'เส้น', 1500, 300, 'equipment');

const setUnitCost = db.prepare('UPDATE inventory SET cost_per_unit=? WHERE stock_key=?');
[[0.65,'coffee_beans'],[0.065,'milk'],[0.0737,'condensed_milk'],[0.0543,'evaporated_milk'],[0.22,'cocoa_powder'],[0.28,'tea_leaves'],[0.4072,'caramel_syrup'],[0.00175,'ice']].forEach(x => setUnitCost.run(...x));

const requiredCategories=[['coffee','กาแฟ'],['tea','ชาและนม'],['food','อาหาร'],['dessert','ของหวาน'],['bakery','เบเกอรี่'],['other','อื่น ๆ']];
const insertRequiredCategory=db.prepare('INSERT OR IGNORE INTO categories(category_key,name,active) VALUES (?,?,1)');
const activateRequiredCategory=db.prepare('UPDATE categories SET active=1 WHERE category_key=?');
requiredCategories.forEach(([key,name])=>{insertRequiredCategory.run(key,name);activateRequiredCategory.run(key);});
if (db.prepare('SELECT count(*) AS n FROM sales_channels').get().n === 0) {
  [['lineman','LINE MAN',0],['grab','GrabFood',0],['shopee','ShopeeFood',0]].forEach(x => db.prepare('INSERT INTO sales_channels(channel_key,name,gp_percent) VALUES (?,?,?)').run(...x));
}

if (db.prepare('SELECT count(*) AS n FROM products').get().n === 0) {
  const seed = db.transaction(() => {
    [['เอสเพรสโซ่ร้อน',50,'coffee','☕','coffee_beans'],['อเมริกาโน่เย็น',60,'coffee','🧊','coffee_beans'],['คาปูชิโน่เย็น',70,'coffee','☕','milk'],['ชาไทยเย็น',65,'tea','🧋','tea_leaves'],['ครัวซองต์เนยสด',85,'bakery','🥐','croissant']].forEach((x,i) => db.prepare('INSERT INTO products(name,price,category,emoji,stock_key) VALUES (?,?,?,?,?)').run(...x));
    ['kds','inventory','members','recipes','reports'].forEach(k => db.prepare('INSERT INTO feature_settings VALUES (?,1)').run(k));
  }); seed();
}
const ensureFeature=db.prepare('INSERT OR IGNORE INTO feature_settings(feature_key,enabled) VALUES (?,1)');
['kds','inventory','members','recipes','reports'].forEach(key=>ensureFeature.run(key));

const app = express();
// Keep the No.5 Cafe menu board complete even when an older local database already exists.
const ensureMenu = db.prepare('INSERT INTO products(name,price,category,emoji,stock_key) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM products WHERE name=?)');
[['Espresso (Hot)',45,'coffee','☕','coffee_beans'],['Iced Espresso',55,'coffee','🧊','coffee_beans'],['Americano',50,'coffee','☕','coffee_beans'],['Latte',60,'coffee','☕','milk'],['Cappuccino',60,'coffee','☕','milk'],['Mocha',70,'coffee','☕','coffee_beans'],['Caramel Macchiato',70,'coffee','☕','coffee_beans'],['Matcha Latte',70,'tea','🍵','tea_leaves'],['Pure Matcha',70,'tea','🍵','tea_leaves']].forEach(x => ensureMenu.run(...x,x[0]));
db.prepare("UPDATE products SET name='Americano' WHERE name='Amaricano' AND NOT EXISTS (SELECT 1 FROM products WHERE name='Americano')").run();
db.prepare("UPDATE products SET active=0 WHERE name='Amaricano' AND EXISTS (SELECT 1 FROM products WHERE name='Americano')").run();
// Starter recipes from the supplied 16 oz menu sheet. They remain editable in Product & Recipe settings.
if (db.prepare('SELECT count(*) AS n FROM recipe_items').get().n === 0) {
  const productIds=db.prepare('SELECT id FROM products ORDER BY id LIMIT 5').all().map(x=>x.id);
  const recipeLines=[
    [['coffee_beans',20]],
    [['coffee_beans',20],['condensed_milk',30],['evaporated_milk',20],['milk',40],['ice',180]],
    [['coffee_beans',20],['ice',180]],
    [['coffee_beans',20],['condensed_milk',20],['milk',140],['ice',180]],
    [['coffee_beans',20],['condensed_milk',20],['milk',120],['ice',180]]
  ];
  const add=db.prepare('INSERT OR IGNORE INTO recipe_items(product_id,stock_key,quantity) VALUES (?,?,?)');
  productIds.forEach((productId,index)=>(recipeLines[index]||[]).forEach(([stockKey,quantity])=>add.run(productId,stockKey,quantity)));
}
// Complete editable starter recipes for the standard menu. Existing recipes are preserved.
const starterRecipes = {
  'Espresso (Hot)':[ ['coffee_beans',20],['cup_hot',1] ],
  'Iced Espresso':[ ['coffee_beans',20],['condensed_milk',30],['evaporated_milk',20],['milk',40],['ice',180],['cup_cold',1],['straw',1] ],
  'Americano':[ ['coffee_beans',20],['ice',180],['cup_cold',1],['straw',1] ],
  'Latte':[ ['coffee_beans',20],['condensed_milk',20],['milk',140],['ice',180],['cup_cold',1],['straw',1] ],
  'Cappuccino':[ ['coffee_beans',20],['condensed_milk',20],['milk',120],['ice',180],['cup_cold',1],['straw',1] ],
  'Mocha':[ ['coffee_beans',20],['cocoa_powder',12],['condensed_milk',20],['milk',120],['ice',180],['cup_cold',1],['straw',1] ],
  'Caramel Macchiato':[ ['coffee_beans',20],['caramel_syrup',15],['condensed_milk',15],['milk',130],['ice',180],['cup_cold',1],['straw',1] ],
  'Matcha Latte':[ ['tea_leaves',15],['condensed_milk',20],['milk',120],['ice',180],['cup_cold',1],['straw',1] ],
  'Pure Matcha':[ ['tea_leaves',20],['ice',180],['cup_cold',1],['straw',1] ]
};
const addStarterRecipe = db.prepare('INSERT OR IGNORE INTO recipe_items(product_id,stock_key,quantity) VALUES (?,?,?)');
Object.entries(starterRecipes).forEach(([name,items]) => { const product=db.prepare('SELECT id FROM products WHERE name=? AND active=1').get(name); if(product && db.prepare('SELECT 1 FROM recipe_items WHERE product_id=? LIMIT 1').get(product.id)===undefined) items.forEach(([key,qty])=>addStarterRecipe.run(product.id,key,qty)); });
}
app.disable('x-powered-by');
app.use((_, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const configuredAdminPin = String(process.env.ADMIN_PIN || '').trim();
const admin = (req,res,next) => {
  if (!configuredAdminPin) return fail(res, 'ยังไม่ได้กำหนด ADMIN_PIN บนเซิร์ฟเวอร์', 503);
  return req.get('x-admin-pin') === configuredAdminPin
    ? next()
    : res.status(401).json({error:'ต้องระบุ PIN ผู้ดูแลให้ถูกต้อง'});
};
const enabled = key => db.prepare('SELECT enabled FROM feature_settings WHERE feature_key=?').get(key)?.enabled === 1;
const id = () => `TX-${Date.now()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
const fail = (res, message, status=400) => res.status(status).json({error:message});
const normalizeLoyaltySettings = raw => {
  const mode=['all','category','product'].includes(raw?.mode)?raw.mode:'category';
  const categoryKeys=[...new Set((Array.isArray(raw?.categoryKeys)?raw.categoryKeys:['coffee','tea']).map(String).filter(Boolean))].slice(0,100);
  const productIds=[...new Set((Array.isArray(raw?.productIds)?raw.productIds:[]).map(String).filter(Boolean))].slice(0,500);
  const rewardMode=['all','category','product'].includes(raw?.rewardMode)?raw.rewardMode:'category';
  const rewardCategoryKeys=[...new Set((Array.isArray(raw?.rewardCategoryKeys)?raw.rewardCategoryKeys:['coffee','tea']).map(String).filter(Boolean))].slice(0,100);
  const rewardProductIds=[...new Set((Array.isArray(raw?.rewardProductIds)?raw.rewardProductIds:[]).map(String).filter(Boolean))].slice(0,500);
  return {mode,categoryKeys,productIds,earnStore:raw?.earnStore!==false,earnOnline:raw?.earnOnline!==false,rewardPoints:Math.min(999,Math.max(1,Math.round(Number(raw?.rewardPoints)||10))),rewardType:['free_product','fixed_discount'].includes(raw?.rewardType)?raw.rewardType:'free_product',rewardMode,rewardCategoryKeys,rewardProductIds,rewardDiscountAmount:Math.max(1,Number(raw?.rewardDiscountAmount)||50),rewardMaxPrice:Math.max(0,Number(raw?.rewardMaxPrice)||0)};
};
const getLoyaltySettings = () => {
  const row=db.prepare("SELECT value FROM app_metadata WHERE key='loyalty_settings'").get();
  try{return normalizeLoyaltySettings(JSON.parse(row?.value||'{}'));}catch{return normalizeLoyaltySettings({});}
};
const loyaltyProductEligible = (product,settings=getLoyaltySettings()) =>
  settings.mode==='all'
  || (settings.mode==='category'&&settings.categoryKeys.includes(String(product.category)))
  || (settings.mode==='product'&&settings.productIds.includes(String(product.id)));
const loyaltyRewardProductEligible = (product,settings=getLoyaltySettings()) =>
  settings.rewardMode==='all'
  || (settings.rewardMode==='category'&&settings.rewardCategoryKeys.includes(String(product.category)))
  || (settings.rewardMode==='product'&&settings.rewardProductIds.includes(String(product.id)));
const normalizeCustomOptions = raw => (Array.isArray(raw) ? raw : []).slice(0,12).map((group,index) => ({
  id:String(group?.id||`group_${index+1}`).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40)||`group_${index+1}`,
  name:String(group?.name||'').trim().slice(0,80),
  choices:(Array.isArray(group?.choices)?group.choices:[]).slice(0,30).map((choice,choiceIndex) => ({
    id:String(choice?.id||`choice_${choiceIndex+1}`).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40)||`choice_${choiceIndex+1}`,
    label:String(choice?.label||'').trim().slice(0,80),
    price:Math.max(0,Number(choice?.price)||0),
    online_price:choice?.online_price == null || choice?.online_price === ''
      ? null
      : Math.max(0,Number(choice.online_price)||0)
  })).filter(choice=>choice.label)
})).filter(group=>group.name&&group.choices.length);
const selectedCustomOptions = (product, raw={}, online=false) => {
  let groups=[];
  try { groups=normalizeCustomOptions(JSON.parse(product.custom_options_json||'[]')); } catch {}
  const custom={},custom_labels=[],custom_details=[]; let extra=0;
  for(const group of groups) {
    const requested=raw?.custom?.[group.id];
    const choice=group.choices.find(item=>String(item.id)===String(requested));
    if(choice) {
      const price=Math.max(0,Number(online?(choice.online_price??choice.price):choice.price)||0);
      custom[group.id]=choice.id;
      custom_labels.push(`${group.name}: ${choice.label}`);
      custom_details.push({group:group.name,label:choice.label,price});
      extra+=price;
    }
  }
  return {custom,custom_labels,custom_details,extra};
};
const getOptionGroups = () => db.prepare('SELECT id,name,choices_json,sort_order FROM option_groups WHERE active=1 ORDER BY sort_order,name').all().map(row=>({
  id:row.id,name:row.name,sort_order:row.sort_order,choices:normalizeCustomOptions([{id:row.id,name:row.name,choices:JSON.parse(row.choices_json||'[]')}])[0]?.choices||[]
}));
const syncProductOptionGroup = (groupId, replacement=null) => {
  const rows=db.prepare("SELECT id,custom_options_json FROM products WHERE custom_options_json<>'[]'").all();
  const update=db.prepare('UPDATE products SET custom_options_json=? WHERE id=?');
  rows.forEach(row=>{
    let groups=[];try{groups=normalizeCustomOptions(JSON.parse(row.custom_options_json||'[]'));}catch{}
    if(!groups.some(group=>group.id===groupId))return;
    const next=replacement?groups.map(group=>group.id===groupId?replacement:group):groups.filter(group=>group.id!==groupId);
    update.run(JSON.stringify(next),row.id);
  });
};
if(!db.prepare("SELECT 1 FROM app_metadata WHERE key='option_library_initialized'").get()){
  db.prepare('INSERT OR IGNORE INTO option_groups(id,name,choices_json) VALUES (?,?,?)').run('type','ประเภท',JSON.stringify([
    {id:'hot',label:'ร้อน',price:0},{id:'iced',label:'เย็น',price:0},{id:'blended',label:'ปั่น',price:10}
  ]));
  db.prepare("INSERT INTO app_metadata(key,value) VALUES ('option_library_initialized','1')").run();
}

// Helper for structured stock checks
const getRecipeItems = (productId, stockKey) => {
  const items = db.prepare('SELECT stock_key, quantity FROM recipe_items WHERE product_id=?').all(productId);
  return items;
};
const requireRecipe = product => { const items=getRecipeItems(product.id, product.stock_key); if (!items.length) throw Error(`เมนู ${product.name_th || product.name} ยังไม่มีสูตรชง กรุณาตั้งค่าสูตรก่อนขาย`); return items; };

app.get('/api/bootstrap', (_,res) => res.json({ products:db.prepare('SELECT * FROM products WHERE active=1 ORDER BY sort_order,category,name').all(), inventory:db.prepare('SELECT * FROM inventory ORDER BY name').all(), categories:db.prepare('SELECT * FROM categories WHERE active=1 ORDER BY sort_order,name').all(), channels:db.prepare('SELECT * FROM sales_channels WHERE active=1 ORDER BY name').all(), channelPrices:db.prepare('SELECT product_id,channel_key,sale_price FROM channel_prices').all(), optionGroups:getOptionGroups(), bestSellers:db.prepare('SELECT oi.product_id,sum(oi.quantity) qty FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE p.active=1 GROUP BY oi.product_id ORDER BY qty DESC,oi.product_id LIMIT 10').all(), loyaltySettings:getLoyaltySettings(), features:Object.fromEntries(db.prepare("SELECT feature_key,enabled FROM feature_settings WHERE feature_key IN ('kds','inventory','members','recipes','reports')").all().map(x=>[x.feature_key,!!x.enabled])), membersEnabled:enabled('members') }));
app.get('/api/pricing', (_,res) => res.json(db.prepare(`SELECT p.id product_id,p.name,p.price store_price,c.channel_key,c.name channel_name,c.gp_percent,cp.sale_price,round(p.price/(1-c.gp_percent/100),2) suggested_price FROM products p CROSS JOIN sales_channels c LEFT JOIN channel_prices cp ON cp.product_id=p.id AND cp.channel_key=c.channel_key WHERE p.active=1 AND c.active=1 ORDER BY p.name,c.name`).all()));
app.get('/api/costing', (_,res) => {
  const products=db.prepare('SELECT id,name,price,category,target_margin FROM products WHERE active=1 ORDER BY sort_order,category,name').all();
  const channels=db.prepare('SELECT channel_key,name,gp_percent FROM sales_channels WHERE active=1 ORDER BY name').all();
  const recipe=db.prepare('SELECT ri.quantity,i.stock_key,i.name,i.unit,i.cost_per_unit FROM recipe_items ri JOIN inventory i ON i.stock_key=ri.stock_key WHERE ri.product_id=?');
  res.json(products.map(product => {
    const ingredients=recipe.all(product.id).map(x=>({...x,line_cost:Number((x.quantity*x.cost_per_unit).toFixed(2))}));
    const cost=ingredients.reduce((sum,x)=>sum+x.line_cost,0);
    const targetMargin=Math.min(.95,Math.max(0,Number(product.target_margin ?? .65)));
    const recommendedStore=cost ? Number((cost/(1-targetMargin)).toFixed(2)) : 0;
    return {product_id:product.id,name:product.name,store_price:product.price,target_margin:targetMargin,cost:Number(cost.toFixed(2)),recommended_store_price:recommendedStore,gross_profit:Number((product.price-cost).toFixed(2)),food_cost_percent:product.price?Number((cost/product.price*100).toFixed(1)):0,ingredients,online:channels.map(c=>({channel_key:c.channel_key,name:c.name,gp_percent:c.gp_percent,suggested_price:Number((recommendedStore/(1-c.gp_percent/100)).toFixed(2))}))};
  }));
});
app.get('/api/orders', admin, (req,res) => res.json(db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100').all()));

app.get('/api/reports/today', (_,res) => res.json(db.prepare("SELECT count(CASE WHEN sales_channel!='online' THEN 1 END) storeOrders, coalesce(sum(CASE WHEN sales_channel!='online' THEN total ELSE 0 END),0) storeSales, count(CASE WHEN sales_channel='online' THEN 1 END) onlineOrders, coalesce(sum(CASE WHEN sales_channel='online' THEN total ELSE 0 END),0) onlineSales, coalesce(sum(CASE WHEN sales_channel='online' THEN coalesce(online_net,total) ELSE 0 END),0) onlineNet, count(CASE WHEN sales_channel!='online' THEN 1 END) orders, coalesce(sum(CASE WHEN sales_channel!='online' THEN total ELSE 0 END),0) sales FROM orders WHERE date(created_at,'+7 hours')=date('now','+7 hours')").get()));
app.get('/api/kds', (_,res) => { if(!enabled('kds')) return fail(res,'ยังไม่ได้เปิดฟังก์ชันคิวชง',403); res.json(db.prepare("SELECT oi.id,oi.name,oi.quantity,oi.options_json,oi.status,o.id order_id,o.created_at FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE date(o.created_at,'+7 hours')=date('now','+7 hours') ORDER BY o.created_at DESC LIMIT 100").all()); });
app.put('/api/kds/items/:id/status', (req,res) => { if(!enabled('kds')) return fail(res,'ยังไม่ได้เปิดฟังก์ชันคิวชง',403); const status=req.body?.status; if(!['pending','cooking','completed'].includes(status)) return fail(res,'สถานะไม่ถูกต้อง'); const r=db.prepare('UPDATE order_items SET status=? WHERE id=?').run(status,req.params.id); return r.changes?res.json({ok:true}):fail(res,'ไม่พบรายการคิวชง',404); });
app.delete('/api/kds/completed', (_,res) => { if(!enabled('kds')) return fail(res,'ยังไม่ได้เปิดฟังก์ชันคิวชง',403); const r=db.prepare("DELETE FROM order_items WHERE status='completed'").run(); res.json({ok:true,cleared:r.changes}); });
app.get('/api/members', (_,res) => { if(!enabled('members')) return fail(res,'ยังไม่ได้เปิดฟังก์ชันสมาชิก',403); res.json(db.prepare('SELECT phone,name,points FROM members ORDER BY points DESC,name LIMIT 100').all()); });
app.get('/api/members/:phone', (req,res) => { if(!enabled('members')) return fail(res,'ยังไม่ได้เปิดฟังก์ชันสมาชิก',403); const phone=String(req.params.phone||'').replace(/\D/g,''); const member=db.prepare('SELECT phone,name,points FROM members WHERE phone=?').get(phone); return member?res.json(member):fail(res,'ไม่พบสมาชิก',404); });
app.post('/api/members', (req,res) => { if(!enabled('members')) return fail(res,'ยังไม่ได้เปิดฟังก์ชันสมาชิก',403); const phone=String(req.body?.phone||'').replace(/\D/g,''), name=String(req.body?.name||'').trim(); if(phone.length<9||!name)return fail(res,'กรอกชื่อและเบอร์โทรให้ถูกต้อง'); db.prepare('INSERT INTO members(phone,name,points) VALUES (?,?,0) ON CONFLICT(phone) DO UPDATE SET name=excluded.name').run(phone,name);res.status(201).json({ok:true}); });

app.get('/api/recipes', (_,res) => {
  if(!enabled('recipes')) return fail(res,'ยังไม่ได้เปิดฟังก์ชันสูตรชง',403);
  const products = db.prepare('SELECT id, name, emoji FROM products WHERE active=1 ORDER BY name').all();
  const recipes = products.map(p => {
    const r = db.prepare('SELECT description FROM recipes WHERE product_id=?').get(p.id);
    const items = db.prepare('SELECT ri.stock_key, ri.quantity, i.name, i.unit FROM recipe_items ri JOIN inventory i ON i.stock_key=ri.stock_key WHERE ri.product_id=?').all(p.id);
    return {
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      description: r ? r.description : '',
      items
    };
  });
  res.json(recipes);
});

app.post('/api/orders', (req,res) => {
  const {items, discount=0, manualDiscount=null, paymentType, salesChannel='store', onlinePlatform=null, memberPhone=null, received=0, redeemFreeCup=false} = req.body || {};
  const requestedSalesChannel=salesChannel==='online'?'online':'store';
  if (!Array.isArray(items) || !items.length || (requestedSalesChannel==='store'&&!['cash','qr'].includes(paymentType))) return fail(res,'Invalid payment data');
  const requestedDiscount=Number(manualDiscount ?? discount);
  if (!Number.isFinite(requestedDiscount) || requestedDiscount<0) return fail(res,'Invalid discount');
  try {
    const order = db.transaction(() => {
      const normalizedSalesChannel=requestedSalesChannel;
      const normalizedPaymentType=normalizedSalesChannel==='online'?'online':paymentType;
      const channel=normalizedSalesChannel==='online'?db.prepare('SELECT channel_key,gp_percent FROM sales_channels WHERE channel_key=? AND active=1').get(String(onlinePlatform||'')):null;
      if(normalizedSalesChannel==='online'&&(!channel||Number(channel.gp_percent)<=0||Number(channel.gp_percent)>=100)) throw Error('กรุณาตั้งค่า GP จริงของแพลตฟอร์ม');
      const normalizedPlatform=channel?.channel_key||null, normalizedGp=channel?Number(channel.gp_percent):0;
      const findProduct=db.prepare('SELECT * FROM products WHERE id=?'); let subtotal=0; const lines=[];
      for (const row of items) {
        const product=findProduct.get(Number(row.productId)), qty=Number(row.quantity);
        if(!product || !product.active || !Number.isInteger(qty) || qty<1 || qty>99) throw Error('Invalid order item');
        const raw=row.options||{};
        const selected=selectedCustomOptions(product,raw,normalizedSalesChannel==='online');
        const options={custom:selected.custom,custom_labels:selected.custom_labels,custom_details:selected.custom_details};
        const savedPrice=channel?db.prepare('SELECT sale_price FROM channel_prices WHERE product_id=? AND channel_key=?').get(product.id,channel.channel_key):null;
        const unitPrice=Number(savedPrice?.sale_price??product.price)+selected.extra;
        subtotal+=unitPrice*qty; lines.push({product,qty,options,unitPrice});
      }
      const member=memberPhone&&enabled('members')?db.prepare('SELECT points FROM members WHERE phone=?').get(memberPhone):null;
      const loyaltySettings=getLoyaltySettings();
      const rewardLines=loyaltySettings.rewardType==='free_product'?lines.filter(line=>loyaltyRewardProductEligible(line.product,loyaltySettings)):[];
      if(redeemFreeCup&&(!member||Number(member.points)<loyaltySettings.rewardPoints)) throw Error(`คะแนนสะสมไม่เพียงพอ ต้องใช้ ${loyaltySettings.rewardPoints} แต้ม`);
      if(redeemFreeCup&&loyaltySettings.rewardType==='free_product'&&!rewardLines.length) throw Error('ตะกร้ายังไม่มีสินค้าที่ใช้แลกรางวัลได้');
      const rewardLine=redeemFreeCup&&rewardLines.length?rewardLines.reduce((best,line)=>!best||line.unitPrice<best.unitPrice?line:best,null):null;
      const freeProductDiscount=rewardLine?(loyaltySettings.rewardMaxPrice>0?Math.min(rewardLine.unitPrice,loyaltySettings.rewardMaxPrice):rewardLine.unitPrice):0;
      const rewardDiscount=redeemFreeCup?(loyaltySettings.rewardType==='fixed_discount'?loyaltySettings.rewardDiscountAmount:freeProductDiscount):0;
      const effectiveManual=manualDiscount==null&&redeemFreeCup?Math.max(0,requestedDiscount-rewardDiscount):requestedDiscount;
      const finalDiscount=Math.min(effectiveManual+rewardDiscount,subtotal), total=subtotal-finalDiscount, orderId=id(), now=new Date().toISOString();
      for(const {product,qty} of lines) if(product.deduct_stock) for(const item of requireRecipe(product)) { const stock=db.prepare('SELECT name,quantity FROM inventory WHERE stock_key=?').get(item.stock_key); if(!stock || stock.quantity<item.quantity*qty) throw Error(`Insufficient stock: ${stock?.name||item.stock_key}`); }
      const onlineNet=normalizedSalesChannel==='online'?Number((total*(1-normalizedGp/100)).toFixed(2)):total;
      const normalizedReceived=normalizedPaymentType==='cash'?Number(received):total;
      if(!Number.isFinite(normalizedReceived)||normalizedReceived<total) throw Error('ยอดเงินที่รับไม่เพียงพอ');
      const normalizedChange=normalizedPaymentType==='cash'?Number((normalizedReceived-total).toFixed(2)):0;
      db.prepare('INSERT INTO orders (id, created_at, subtotal, discount, total, payment_type, sales_channel, online_platform, gp_percent, online_net, member_phone, received, change_due) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(orderId,now,subtotal,finalDiscount,total,normalizedPaymentType,normalizedSalesChannel,normalizedPlatform,normalizedGp,onlineNet,memberPhone||null,normalizedReceived,normalizedChange);
      for(const {product,qty,options,unitPrice} of lines) { db.prepare('INSERT INTO order_items(order_id,product_id,name,unit_price,quantity,options_json) VALUES (?,?,?,?,?,?)').run(orderId,product.id,product.name_th||product.name,unitPrice,qty,JSON.stringify(options)); if(product.deduct_stock) for(const item of requireRecipe(product)) { db.prepare('UPDATE inventory SET quantity=quantity-? WHERE stock_key=?').run(item.quantity*qty,item.stock_key); db.prepare('INSERT INTO stock_movements(stock_key,quantity,reason,order_id,created_at) VALUES (?,?,?,?,?)').run(item.stock_key,-item.quantity*qty,'sale',orderId,now); } }
      
      let memberPoints = 0, pointsEarned = 0;
      if(member) {
          const channelCanEarn=normalizedSalesChannel==='online'?loyaltySettings.earnOnline:loyaltySettings.earnStore;
          let cupsEarned = channelCanEarn?lines.filter(line=>loyaltyProductEligible(line.product,loyaltySettings)).reduce((sum,line)=>sum+line.qty,0):0;
          let newPoints = member.points;
          if (redeemFreeCup) {
            newPoints -= loyaltySettings.rewardPoints;
            if(rewardLine&&loyaltyProductEligible(rewardLine.product,loyaltySettings))cupsEarned=Math.max(0,cupsEarned-1);
          }
          newPoints += cupsEarned;
          pointsEarned = cupsEarned;
          db.prepare('UPDATE members SET points=? WHERE phone=?').run(newPoints, memberPhone);
          memberPoints = newPoints;
      }
      return {id:orderId,subtotal,discount:finalDiscount,total,createdAt:now,paymentType:normalizedPaymentType,salesChannel:normalizedSalesChannel,onlinePlatform:normalizedPlatform,gpPercent:normalizedGp,onlineNet,memberPhone,received:normalizedReceived,changeDue:normalizedChange,memberPoints,pointsEarned,items:lines.map(x=>({name:x.product.name_th||x.product.name,quantity:x.qty,unit_price:x.unitPrice,options:x.options}))};
    })();
    res.status(201).json(order);
  } catch(e) { fail(res,e.message); }
});

app.post('/api/orders-legacy', (_req,res) => {
  fail(res, 'เส้นทางขายแบบเก่าถูกยกเลิก กรุณาใช้ /api/orders', 410);
});

const reportFilters = req => ({
  dateFrom:/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dateFrom||''))?String(req.query.dateFrom):null,
  dateTo:/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dateTo||''))?String(req.query.dateTo):null,
  category:String(req.query.category||'').trim().slice(0,80)||null,
  productId:String(req.query.productId||'').trim().slice(0,80)||null,
  salesChannel:['store','online'].includes(String(req.query.salesChannel||''))?String(req.query.salesChannel):null
});
const reportOrderWhere = filters => {
  const where=[],params=[];
  if(filters.dateFrom){where.push("date(o.created_at,'+7 hours')>=?");params.push(filters.dateFrom);}
  if(filters.dateTo){where.push("date(o.created_at,'+7 hours')<=?");params.push(filters.dateTo);}
  if(filters.salesChannel){where.push("coalesce(o.sales_channel,'store')=?");params.push(filters.salesChannel);}
  if(filters.category||filters.productId){
    const itemWhere=['fx.order_id=o.id'];
    if(filters.category){itemWhere.push('fp.category=?');params.push(filters.category);}
    if(filters.productId){itemWhere.push('CAST(fx.product_id AS TEXT)=?');params.push(filters.productId);}
    where.push(`EXISTS (SELECT 1 FROM order_items fx LEFT JOIN products fp ON fp.id=fx.product_id WHERE ${itemWhere.join(' AND ')})`);
  }
  return {sql:where.length?`WHERE ${where.join(' AND ')}`:'',params};
};
const reportItemWhere = filters => {
  const where=[],params=[];
  if(filters.dateFrom){where.push("date(o.created_at,'+7 hours')>=?");params.push(filters.dateFrom);}
  if(filters.dateTo){where.push("date(o.created_at,'+7 hours')<=?");params.push(filters.dateTo);}
  if(filters.salesChannel){where.push("coalesce(o.sales_channel,'store')=?");params.push(filters.salesChannel);}
  if(filters.category){where.push('p.category=?');params.push(filters.category);}
  if(filters.productId){where.push('CAST(oi.product_id AS TEXT)=?');params.push(filters.productId);}
  return {sql:where.length?`WHERE ${where.join(' AND ')}`:'',params};
};
const addonRows = items => {
  const totals=new Map();
  items.forEach(item=>{
    let options={};try{options=JSON.parse(item.options_json||'{}');}catch{}
    const details=Array.isArray(options.custom_details)
      ? options.custom_details.map(x=>({name:`${x.group}: ${x.label}`,price:Math.max(0,Number(x.price)||0)}))
      : (Array.isArray(options.custom_labels)?options.custom_labels:[]).map(name=>({name:String(name),price:0}));
    details.forEach(detail=>{
      const row=totals.get(detail.name)||{name:detail.name,qty:0,revenue:0};
      row.qty+=Number(item.quantity)||0;
      row.revenue+=detail.price*(Number(item.quantity)||0);
      totals.set(detail.name,row);
    });
  });
  return [...totals.values()].sort((a,b)=>b.qty-a.qty||b.revenue-a.revenue).slice(0,10);
};

app.get('/api/reports/analytics', (req, res) => {
  if (!enabled('reports')) return fail(res, 'ยังไม่ได้เปิดฟังก์ชันรายงาน', 403);
  try {
    const filters=reportFilters(req),itemFilter=reportItemWhere(filters),orderFilter=reportOrderWhere(filters);
    const items=db.prepare(`
      SELECT oi.order_id,oi.product_id,oi.name,oi.unit_price,oi.quantity,oi.options_json,coalesce(p.category,'other') category
      FROM order_items oi
      JOIN orders o ON o.id=oi.order_id
      LEFT JOIN products p ON p.id=oi.product_id
      ${itemFilter.sql}
    `).all(...itemFilter.params);
    const orders=db.prepare(`SELECT o.id,o.payment_type,o.total,coalesce(o.sales_channel,'store') sales_channel,o.gp_percent,o.online_net FROM orders o ${orderFilter.sql}`).all(...orderFilter.params);
    const categories=new Map(),products=new Map(),payments=new Map(),itemSalesByOrder=new Map();
    items.forEach(item=>{
      const revenue=Number(item.unit_price||0)*Number(item.quantity||0);
      itemSalesByOrder.set(item.order_id,(itemSalesByOrder.get(item.order_id)||0)+revenue);
      categories.set(item.category,(categories.get(item.category)||0)+revenue);
      const key=String(item.product_id??item.name),row=products.get(key)||{product_id:item.product_id,name:item.name,qty:0,revenue:0};
      row.qty+=Number(item.quantity)||0;row.revenue+=revenue;products.set(key,row);
    });
    const lineFiltered=!!(filters.category||filters.productId);
    const breakdown={storeCash:0,storeQr:0,onlineGross:0,onlineNet:0};
    orders.forEach(order=>{
      const amount=lineFiltered?Number(itemSalesByOrder.get(order.id)||0):Number(order.total||0);
      payments.set(order.payment_type,(payments.get(order.payment_type)||0)+amount);
      if(order.sales_channel==='online'){
        breakdown.onlineGross+=amount;
        breakdown.onlineNet+=lineFiltered?amount*(1-Number(order.gp_percent||0)/100):Number(order.online_net??order.total??0);
      }else if(order.payment_type==='cash')breakdown.storeCash+=amount;
      else breakdown.storeQr+=amount;
    });
    const productRows=[...products.values()];
    const topByQuantity=[...productRows].sort((a,b)=>b.qty-a.qty||b.revenue-a.revenue).slice(0,10);
    const topByRevenue=[...productRows].sort((a,b)=>b.revenue-a.revenue||b.qty-a.qty).slice(0,10);
    const totalSales=[...payments.values()].reduce((sum,value)=>sum+value,0);
    res.json({
      summary:{totalSales,totalOrders:orders.length,averageBill:orders.length?totalSales/orders.length:0},
      categorySales:[...categories].map(([category,sales])=>({category,sales})),
      paymentSales:[...payments].map(([payment_type,sales])=>({payment_type,sales})),
      breakdown,
      topSellers:topByQuantity,
      topByQuantity,
      topByRevenue,
      topAddons:addonRows(items)
    });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

app.get('/api/reports/transactions', (req, res) => {
  if (!enabled('reports')) return fail(res, 'ยังไม่ได้เปิดฟังก์ชันรายงาน', 403);
  try {
    const filters=reportFilters(req);
    const filter=reportOrderWhere(filters);
    const lineFiltered=!!(filters.category||filters.productId);
    const orders = db.prepare(`SELECT o.* FROM orders o ${filter.sql} ORDER BY o.created_at DESC LIMIT 200`).all(...filter.params);
    const transactions = orders.map(o => {
      const itemWhere=['oi.order_id=?'],itemParams=[o.id];
      if(filters.category){itemWhere.push("coalesce(p.category,'other')=?");itemParams.push(filters.category);}
      if(filters.productId){itemWhere.push('CAST(oi.product_id AS TEXT)=?');itemParams.push(filters.productId);}
      const items = db.prepare(`
        SELECT oi.product_id,oi.name,oi.unit_price,oi.quantity,oi.options_json
        FROM order_items oi
        LEFT JOIN products p ON p.id=oi.product_id
        WHERE ${itemWhere.join(' AND ')}
      `).all(...itemParams);
      const filteredSubtotal=items.reduce((sum,item)=>sum+Number(item.unit_price||0)*Number(item.quantity||0),0);
      const subtotal=lineFiltered?filteredSubtotal:Number(o.subtotal||0);
      const discount=lineFiltered?0:Number(o.discount||0);
      const total=lineFiltered?filteredSubtotal:Number(o.total||0);
      const gpPercent=Number(o.gp_percent||0);
      return {
        id: o.id,
        created_at: o.created_at,
        subtotal,
        discount,
        total,
        payment_type: o.payment_type,
        sales_channel: o.sales_channel || 'store',
        online_platform: o.online_platform,
        gp_percent: gpPercent,
        online_net: lineFiltered&&o.sales_channel==='online'?total*(1-gpPercent/100):(o.online_net ?? o.total),
        member_phone: o.member_phone,
        received: lineFiltered?null:o.received,
        change_due: lineFiltered?null:o.change_due,
        items
      };
    });
    res.json(transactions);
  } catch (e) {
    fail(res, e.message, 500);
  }
});

app.get('/api/admin/settings', admin, (_,res) => res.json({features:db.prepare("SELECT feature_key,enabled FROM feature_settings WHERE feature_key IN ('kds','inventory','members','recipes','reports')").all()}));
app.put('/api/admin/loyalty-settings', admin, (req,res) => {
  const settings=normalizeLoyaltySettings(req.body||{});
  if(settings.mode==='category'&&!settings.categoryKeys.length)return fail(res,'เลือกหมวดหมู่ที่ให้แต้มอย่างน้อย 1 หมวด');
  if(settings.mode==='product'&&!settings.productIds.length)return fail(res,'เลือกเมนูที่ให้แต้มอย่างน้อย 1 รายการ');
  if(!settings.earnStore&&!settings.earnOnline)return fail(res,'เลือกช่องทางสะสมแต้มอย่างน้อย 1 ช่องทาง');
  if(settings.rewardType==='free_product'&&settings.rewardMode==='category'&&!settings.rewardCategoryKeys.length)return fail(res,'เลือกหมวดหมู่รางวัลอย่างน้อย 1 หมวด');
  if(settings.rewardType==='free_product'&&settings.rewardMode==='product'&&!settings.rewardProductIds.length)return fail(res,'เลือกเมนูรางวัลอย่างน้อย 1 รายการ');
  db.prepare("INSERT INTO app_metadata(key,value) VALUES ('loyalty_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(settings));
  res.json({ok:true,loyaltySettings:settings});
});
app.get('/api/admin/recipe-groups', admin, (_,res) => res.json(db.prepare('SELECT * FROM recipe_groups ORDER BY name').all().map(x=>({id:x.id,name:x.name,items:JSON.parse(x.items_json)}))));
app.post('/api/admin/recipe-groups', admin, (req,res) => { const name=String(req.body?.name||'').trim(),items=Array.isArray(req.body?.items)?req.body.items.filter(x=>x.stock_key&&Number(x.quantity)>0):[];if(!name||!items.length)return fail(res,'ข้อมูลกลุ่มไม่ถูกต้อง');const groupId=`grp_${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`;db.prepare('INSERT INTO recipe_groups(id,name,items_json,created_at) VALUES (?,?,?,?)').run(groupId,name,JSON.stringify(items),new Date().toISOString());res.status(201).json({id:groupId}); });
app.delete('/api/admin/recipe-groups/:id', admin, (req,res) => { const r=db.prepare('DELETE FROM recipe_groups WHERE id=?').run(req.params.id);return r.changes?res.json({ok:true}):fail(res,'ไม่พบกลุ่มรายการ',404); });
app.post('/api/admin/cost-inventory/batch', admin, (req,res) => {
  const items=Array.isArray(req.body?.items)?req.body.items:[];
  if(!items.length)return fail(res,'ไม่พบรายการที่ต้องการเพิ่ม');
  const insert=db.prepare('INSERT INTO inventory(stock_key,name,unit,quantity,low_alert,category,purchase_quantity,purchase_total,cost_per_unit) VALUES (?,?,?,?,?,?,?,?,?)');
  const exists=db.prepare('SELECT 1 FROM inventory WHERE stock_key=?'); let added=0,existing=0;
  db.transaction(()=>items.forEach(raw=>{const stockKey=String(raw.stockKey||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'');if(!stockKey||!raw.name||!raw.unit)return;if(exists.get(stockKey)){existing++;return;}const purchaseQuantity=Math.max(.01,Number(raw.purchaseQuantity)||1),purchaseTotal=Math.max(0,Number(raw.purchaseTotal)||0);insert.run(stockKey,String(raw.name),String(raw.unit),Math.max(0,Number(raw.quantity)||0),Math.max(0,Number(raw.lowAlert)||0),raw.category==='equipment'?'equipment':'ingredient',purchaseQuantity,purchaseTotal,purchaseTotal/purchaseQuantity);added++;}))();
  res.status(201).json({ok:true,added,existing});
});
app.post('/api/admin/cost-inventory', admin, (req,res) => {
  const stockKey=String(req.body?.stockKey||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'');
  const name=String(req.body?.name||'').trim(),unit=String(req.body?.unit||'').trim(),quantity=Number(req.body?.quantity),lowAlert=Number(req.body?.lowAlert),purchaseQuantity=Number(req.body?.purchaseQuantity),purchaseTotal=Number(req.body?.purchaseTotal),category=req.body?.category==='equipment'?'equipment':'ingredient',materialType=['coffee_beans','cocoa','tea','milk','sweetness','syrup','equipment','other'].includes(req.body?.materialType)?req.body.materialType:'other';
  if(!stockKey||!name||!unit||![quantity,lowAlert,purchaseQuantity,purchaseTotal].every(Number.isFinite)||quantity<0||lowAlert<0||purchaseQuantity<=0||purchaseTotal<0)return fail(res,'ข้อมูลต้นทุนไม่ถูกต้อง');
  try { db.prepare('INSERT INTO inventory(stock_key,name,unit,quantity,low_alert,category,material_type,purchase_quantity,purchase_total,cost_per_unit) VALUES (?,?,?,?,?,?,?,?,?,?)').run(stockKey,name,unit,quantity,lowAlert,category,materialType,purchaseQuantity,purchaseTotal,purchaseTotal/purchaseQuantity);res.status(201).json({ok:true}); } catch { fail(res,'รหัสวัตถุดิบซ้ำ',409); }
});
app.put('/api/admin/cost-inventory/:key', admin, (req,res) => {
  const name=String(req.body?.name||'').trim(),unit=String(req.body?.unit||'').trim(),quantity=Number(req.body?.quantity),lowAlert=Number(req.body?.lowAlert),purchaseQuantity=Number(req.body?.purchaseQuantity),purchaseTotal=Number(req.body?.purchaseTotal),category=req.body?.category==='equipment'?'equipment':'ingredient',materialType=['coffee_beans','cocoa','tea','milk','sweetness','syrup','equipment','other'].includes(req.body?.materialType)?req.body.materialType:'other';
  if(!name||!unit||![quantity,lowAlert,purchaseQuantity,purchaseTotal].every(Number.isFinite)||quantity<0||lowAlert<0||purchaseQuantity<=0||purchaseTotal<0)return fail(res,'ข้อมูลต้นทุนไม่ถูกต้อง');
  const r=db.prepare('UPDATE inventory SET name=?,unit=?,quantity=?,low_alert=?,category=?,material_type=?,purchase_quantity=?,purchase_total=?,cost_per_unit=? WHERE stock_key=?').run(name,unit,quantity,lowAlert,category,materialType,purchaseQuantity,purchaseTotal,purchaseTotal/purchaseQuantity,req.params.key);return r.changes?res.json({ok:true}):fail(res,'ไม่พบวัตถุดิบ',404);
});
app.put('/api/admin/settings/:key', admin, (req,res) => { const ok=db.prepare('UPDATE feature_settings SET enabled=? WHERE feature_key=?').run(req.body?.enabled?1:0,req.params.key); return ok.changes?res.json({ok:true}):fail(res,'ไม่พบฟังก์ชัน',404); });
app.post('/api/admin/inventory/:key/adjust', admin, (req,res) => { const amount=Number(req.body?.amount); const reason=String(req.body?.reason || 'manual adjustment').trim(); if(!Number.isFinite(amount)||amount===0) return fail(res,'จำนวนไม่ถูกต้อง'); const r=db.prepare('UPDATE inventory SET quantity=quantity+? WHERE stock_key=? AND quantity+?>=0').run(amount,req.params.key,amount); if(!r.changes)return fail(res,'สต็อกไม่พอหรือไม่พบรายการ'); db.prepare('INSERT INTO stock_movements(stock_key,quantity,reason,created_at) VALUES (?,?,?,?)').run(req.params.key,amount,reason,new Date().toISOString()); res.json({ok:true}); });
app.post('/api/admin/inventory', admin, (req,res) => {
  const stockKey=String(req.body?.stockKey||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'');
  const name=String(req.body?.name||'').trim(), unit=String(req.body?.unit||'').trim(), quantity=Number(req.body?.quantity), lowAlert=Number(req.body?.lowAlert), category=req.body?.category === 'equipment' ? 'equipment' : 'ingredient';
  if(!stockKey||!name||!unit||!Number.isFinite(quantity)||quantity<0||!Number.isFinite(lowAlert)||lowAlert<0)return fail(res,'ข้อมูลสต็อกไม่ถูกต้อง');
  try { db.prepare('INSERT INTO inventory(stock_key,name,unit,quantity,low_alert,category) VALUES (?,?,?,?,?,?)').run(stockKey,name,unit,quantity,lowAlert,category); res.status(201).json({ok:true}); } catch { fail(res,'รหัสสต็อกซ้ำ',409); }
});
app.put('/api/admin/inventory/:key', admin, (req,res) => {
  const name=String(req.body?.name||'').trim(), unit=String(req.body?.unit||'').trim(), quantity=Number(req.body?.quantity), lowAlert=Number(req.body?.lowAlert), category=req.body?.category === 'equipment' ? 'equipment' : 'ingredient';
  if(!name||!unit||!Number.isFinite(quantity)||quantity<0||!Number.isFinite(lowAlert)||lowAlert<0)return fail(res,'ข้อมูลสต็อกไม่ถูกต้อง');
  const r=db.prepare('UPDATE inventory SET name=?,unit=?,quantity=?,low_alert=?,category=? WHERE stock_key=?').run(name,unit,quantity,lowAlert,category,req.params.key); return r.changes?res.json({ok:true}):fail(res,'ไม่พบรายการสต็อก',404);
});
app.delete('/api/admin/inventory/:key', admin, (req,res) => { try { const r=db.prepare('DELETE FROM inventory WHERE stock_key=?').run(req.params.key); return r.changes?res.json({ok:true}):fail(res,'ไม่พบรายการสต็อก',404); } catch { return fail(res,'ลบไม่ได้ เพราะวัตถุดิบยังถูกใช้อยู่ในสูตรชง',409); } });
app.get('/api/admin/products', admin, (_,res) => { res.json(db.prepare('SELECT * FROM products ORDER BY sort_order,category,name').all()); });
app.put('/api/admin/products/order', admin, (req,res) => {
  const ids=Array.isArray(req.body?.ids)?req.body.ids.map(Number):[];
  const existing=db.prepare('SELECT id FROM products').all().map(row=>row.id);
  if(ids.length!==existing.length||new Set(ids).size!==ids.length||existing.some(id=>!ids.includes(id)))return fail(res,'ลำดับเมนูไม่ถูกต้อง');
  const update=db.prepare('UPDATE products SET sort_order=? WHERE id=?');
  db.transaction(()=>ids.forEach((id,index)=>update.run(index,id)))();
  res.json({ok:true});
});
app.put('/api/admin/products/:id/costing', admin, (req,res) => {
  const price=Number(req.body?.price), targetMargin=Number(req.body?.targetMargin);
  if(!Number.isFinite(price)||price<0||!Number.isFinite(targetMargin)||targetMargin<0||targetMargin>=.95)return fail(res,'ราคา หรือเป้าหมายกำไรไม่ถูกต้อง');
  const r=db.prepare('UPDATE products SET price=?,target_margin=? WHERE id=?').run(price,targetMargin,req.params.id);return r.changes?res.json({ok:true}):fail(res,'ไม่พบเมนู',404);
});

app.post('/api/admin/products', admin, (req,res) => {
  const {name,price,category,emoji='☕',stockKey=null,deductStock=true,imagePath=null,imageData=null,customOptions=[]}=req.body||{};
  if(typeof name!=='string'||!name.trim()||!Number.isFinite(Number(price))||Number(price)<0)return fail(res,'ข้อมูลเมนูไม่ถูกต้อง');
  const nextOrder=Number(db.prepare('SELECT coalesce(max(sort_order),-1)+1 AS n FROM products').get().n);
  const result=db.prepare('INSERT INTO products(name,price,category,emoji,stock_key,deduct_stock,image_path,image_data,custom_options_json,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)').run(name.trim(),Number(price),category||'other',emoji.slice(0,8),stockKey,deductStock?1:0,imagePath||null,imageData||null,JSON.stringify(normalizeCustomOptions(customOptions)),nextOrder);
  res.status(201).json({id:result.lastInsertRowid});
});

app.put('/api/admin/products/:id', admin, (req,res) => {
  const {name,price,category,emoji='☕',active=true,stockKey=null,deductStock=true,imagePath=null,imageData=null,customOptions=[]}=req.body||{};
  if(typeof name!=='string'||!name.trim()||!Number.isFinite(Number(price))||Number(price)<0)return fail(res,'ข้อมูลเมนูไม่ถูกต้อง');
  const r=db.prepare('UPDATE products SET name=?,price=?,category=?,emoji=?,active=?,stock_key=?,deduct_stock=?,image_path=?,image_data=?,custom_options_json=? WHERE id=?').run(name.trim(),Number(price),category||'other',emoji.slice(0,8),active?1:0,stockKey,deductStock?1:0,imagePath||null,imageData||null,JSON.stringify(normalizeCustomOptions(customOptions)),req.params.id);
  return r.changes?res.json({ok:true}):fail(res,'ไม่พบรายการสินค้า',404);
});

app.delete('/api/admin/products/:id', admin, (req,res) => {
  const r = db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  return r.changes ? res.json({ok:true}) : fail(res, 'ไม่พบสินค้า', 404);
});

// Structured recipe endpoints
app.get('/api/admin/products/:id/recipe', admin, (req, res) => {
  const productId = Number(req.params.id);
  const items = db.prepare('SELECT ri.stock_key, ri.quantity, i.name, i.unit, i.cost_per_unit FROM recipe_items ri JOIN inventory i ON i.stock_key=ri.stock_key WHERE ri.product_id=?').all(productId);
  const recipe = db.prepare('SELECT description FROM recipes WHERE product_id=?').get(productId);
  res.json({ items, description: recipe ? recipe.description : '' });
});

app.put('/api/admin/products/:id/recipe', admin, (req, res) => {
  const productId = Number(req.params.id);
  const { items, description } = req.body || {};
  if (!Array.isArray(items) || typeof description !== 'string') return fail(res, 'ข้อมูลสูตรไม่ถูกต้อง');
  
  db.transaction(() => {
    // Save recipe description
    db.prepare("INSERT INTO recipes(product_id,description,ingredients,steps) VALUES (?,?,'','') ON CONFLICT(product_id) DO UPDATE SET description=excluded.description").run(productId, description);
    
    // Clear old recipe items mapping
    db.prepare('DELETE FROM recipe_items WHERE product_id=?').run(productId);
    
    // Insert new recipe items mapping
    const stmt = db.prepare('INSERT INTO recipe_items(product_id,stock_key,quantity) VALUES (?,?,?)');
    for (const item of items) {
      if (item.stock_key && Number(item.quantity) > 0) {
        stmt.run(productId, item.stock_key, Number(item.quantity));
      }
    }
  })();
  res.json({ ok: true });
});

app.put('/api/admin/recipes', admin, (req,res) => { const {productId,ingredients,steps}=req.body||{}; if(!productId||typeof ingredients!=='string'||typeof steps!=='string')return fail(res,'ข้อมูลสูตรไม่ถูกต้อง'); db.prepare('INSERT INTO recipes(product_id,ingredients,steps) VALUES (?,?,?) ON CONFLICT(product_id) DO UPDATE SET ingredients=excluded.ingredients,steps=excluded.steps').run(productId,ingredients,steps); res.json({ok:true}); });
app.post('/api/admin/option-groups', admin, (req,res) => {
  const group=normalizeCustomOptions([req.body])[0];if(!group)return fail(res,'กรอกชื่อกลุ่มและตัวเลือกอย่างน้อย 1 รายการ');
  const nextOrder=Number(db.prepare('SELECT coalesce(max(sort_order),-1)+1 AS n FROM option_groups').get().n);
  try{db.prepare('INSERT INTO option_groups(id,name,choices_json,sort_order) VALUES (?,?,?,?)').run(group.id,group.name,JSON.stringify(group.choices),nextOrder);res.status(201).json({...group,sort_order:nextOrder});}catch{return fail(res,'รหัสกลุ่มตัวเลือกซ้ำ',409);}
});
app.put('/api/admin/option-groups/order', admin, (req,res) => {
  const ids=Array.isArray(req.body?.ids)?req.body.ids.map(String):[];
  const existing=db.prepare('SELECT id FROM option_groups WHERE active=1').all().map(row=>row.id);
  if(ids.length!==existing.length||new Set(ids).size!==ids.length||existing.some(id=>!ids.includes(id)))return fail(res,'ลำดับกลุ่มตัวเลือกไม่ถูกต้อง');
  const update=db.prepare('UPDATE option_groups SET sort_order=? WHERE id=?');
  const updateProduct=db.prepare('UPDATE products SET custom_options_json=? WHERE id=?');
  db.transaction(()=>{
    ids.forEach((id,index)=>update.run(index,id));
    const positions=new Map(ids.map((id,index)=>[id,index]));
    db.prepare("SELECT id,custom_options_json FROM products WHERE custom_options_json<>'[]'").all().forEach(product=>{
      let groups=[];try{groups=normalizeCustomOptions(JSON.parse(product.custom_options_json||'[]'));}catch{}
      groups.sort((a,b)=>(positions.get(a.id)??Number.MAX_SAFE_INTEGER)-(positions.get(b.id)??Number.MAX_SAFE_INTEGER));
      updateProduct.run(JSON.stringify(groups),product.id);
    });
  })();
  res.json({ok:true});
});
app.put('/api/admin/option-groups/:id', admin, (req,res) => {
  const group=normalizeCustomOptions([{...req.body,id:req.params.id}])[0];if(!group)return fail(res,'ข้อมูลตัวเลือกไม่ถูกต้อง');
  const changed=db.transaction(()=>{const result=db.prepare('UPDATE option_groups SET name=?,choices_json=? WHERE id=?').run(group.name,JSON.stringify(group.choices),req.params.id);if(result.changes)syncProductOptionGroup(req.params.id,group);return result.changes;})();
  return changed?res.json(group):fail(res,'ไม่พบกลุ่มตัวเลือก',404);
});
app.delete('/api/admin/option-groups/:id', admin, (req,res) => {
  const changed=db.transaction(()=>{const result=db.prepare('DELETE FROM option_groups WHERE id=?').run(req.params.id);if(result.changes)syncProductOptionGroup(req.params.id);return result.changes;})();
  return changed?res.json({ok:true}):fail(res,'ไม่พบกลุ่มตัวเลือก',404);
});
app.post('/api/admin/categories', admin, (req,res) => { const key=String(req.body?.key||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,''); const name=String(req.body?.name||'').trim(); if(!key||!name)return fail(res,'ระบุรหัสและชื่อหมวดสินค้า'); const nextOrder=Number(db.prepare('SELECT coalesce(max(sort_order),-1)+1 AS n FROM categories').get().n); try{db.prepare('INSERT INTO categories(category_key,name,sort_order) VALUES (?,?,?)').run(key,name,nextOrder);res.status(201).json({ok:true})}catch{fail(res,'รหัสหมวดซ้ำ',409)} });
app.put('/api/admin/categories/order', admin, (req,res) => {
  const ids=Array.isArray(req.body?.ids)?req.body.ids.map(String):[];
  const existing=db.prepare('SELECT category_key FROM categories WHERE active=1').all().map(row=>row.category_key);
  if(ids.length!==existing.length||new Set(ids).size!==ids.length||existing.some(id=>!ids.includes(id)))return fail(res,'ลำดับหมวดหมู่ไม่ถูกต้อง');
  const update=db.prepare('UPDATE categories SET sort_order=? WHERE category_key=?');
  db.transaction(()=>ids.forEach((categoryKey,index)=>update.run(index,categoryKey)))();
  res.json({ok:true});
});
app.put('/api/admin/categories/:key', admin, (req,res) => { const name=String(req.body?.name||'').trim(); if(!name)return fail(res,'ระบุชื่อหมวดสินค้า'); const r=db.prepare('UPDATE categories SET name=? WHERE category_key=?').run(name,req.params.key); return r.changes?res.json({ok:true}):fail(res,'ไม่พบหมวดสินค้า',404); });
app.delete('/api/admin/categories/:key', admin, (req,res) => { const used=db.prepare('SELECT 1 FROM products WHERE category=? LIMIT 1').get(req.params.key); if(used)return fail(res,'ลบไม่ได้ เพราะยังมีสินค้าในหมวดนี้',409); const r=db.prepare('DELETE FROM categories WHERE category_key=?').run(req.params.key); return r.changes?res.json({ok:true}):fail(res,'ไม่พบหมวดสินค้า',404); });
app.put('/api/admin/channels/:key', admin, (req,res) => { const gp=Number(req.body?.gpPercent); const active=req.body?.active; if(!Number.isFinite(gp)||gp<0||gp>=100)return fail(res,'GP ต้องอยู่ระหว่าง 0 ถึงน้อยกว่า 100'); const r=db.prepare('UPDATE sales_channels SET gp_percent=?,active=? WHERE channel_key=?').run(gp,active?1:0,req.params.key);return r.changes?res.json({ok:true}):fail(res,'ไม่พบช่องทาง',404); });
app.post('/api/admin/channels', admin, (req,res) => { const key=String(req.body?.key||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,''), name=String(req.body?.name||'').trim(), gp=Number(req.body?.gpPercent||0); if(!key||!name||!Number.isFinite(gp)||gp<0||gp>=100)return fail(res,'ข้อมูลช่องทางไม่ถูกต้อง'); try{db.prepare('INSERT INTO sales_channels(channel_key,name,gp_percent,active) VALUES (?,?,?,1)').run(key,name,gp);res.status(201).json({ok:true})}catch{fail(res,'รหัสช่องทางซ้ำ',409)} });
app.delete('/api/admin/channels/:key', admin, (req,res) => { const r=db.prepare('DELETE FROM sales_channels WHERE channel_key=?').run(req.params.key); return r.changes?res.json({ok:true}):fail(res,'ไม่พบช่องทาง',404); });
app.get('/api/admin/members', admin, (_,res) => res.json(db.prepare('SELECT phone,name,points FROM members ORDER BY name').all()));
app.put('/api/admin/members/:phone', admin, (req,res) => { const name=String(req.body?.name||'').trim(), points=Number(req.body?.points); if(!name||!Number.isInteger(points)||points<0)return fail(res,'ข้อมูลสมาชิกไม่ถูกต้อง'); const r=db.prepare('UPDATE members SET name=?,points=? WHERE phone=?').run(name,points,req.params.phone); return r.changes?res.json({ok:true}):fail(res,'ไม่พบสมาชิก',404); });
app.delete('/api/admin/members/:phone', admin, (req,res) => { const r=db.prepare('DELETE FROM members WHERE phone=?').run(req.params.phone); return r.changes?res.json({ok:true}):fail(res,'ไม่พบสมาชิก',404); });
app.put('/api/admin/channel-prices', admin, (req,res) => { const productId=Number(req.body?.productId), channelKey=String(req.body?.channelKey||''), price=Number(req.body?.salePrice);if(!Number.isInteger(productId)||!channelKey||!Number.isFinite(price)||price<0)return fail(res,'ข้อมูลราคาไม่ถูกต้อง');db.prepare('INSERT INTO channel_prices(product_id,channel_key,sale_price) VALUES (?,?,?) ON CONFLICT(product_id,channel_key) DO UPDATE SET sale_price=excluded.sale_price').run(productId,channelKey,price);res.json({ok:true}); });
app.use((err,_,res,__) => { console.error(err); fail(res,'เกิดข้อผิดพลาดภายในระบบ',500); });
app.listen(process.env.PORT || 3000, () => console.log(`POS ready on http://localhost:${process.env.PORT || 3000}`));
