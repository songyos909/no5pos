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
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price REAL NOT NULL CHECK(price >= 0), category TEXT NOT NULL, emoji TEXT NOT NULL DEFAULT '☕', active INTEGER NOT NULL DEFAULT 1, stock_key TEXT);
CREATE TABLE IF NOT EXISTS inventory (stock_key TEXT PRIMARY KEY, name TEXT NOT NULL, unit TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 0, low_alert REAL NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'raw');
CREATE TABLE IF NOT EXISTS recipes (product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE, ingredients TEXT NOT NULL, steps TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members (phone TEXT PRIMARY KEY, name TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS feature_settings (feature_key TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, subtotal REAL NOT NULL, discount REAL NOT NULL, total REAL NOT NULL, payment_type TEXT NOT NULL, member_phone TEXT REFERENCES members(phone));
CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), product_id INTEGER, name TEXT NOT NULL, unit_price REAL NOT NULL, quantity INTEGER NOT NULL, options_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS stock_movements (id INTEGER PRIMARY KEY, stock_key TEXT NOT NULL REFERENCES inventory(stock_key), quantity REAL NOT NULL, reason TEXT NOT NULL, order_id TEXT REFERENCES orders(id), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categories (category_key TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
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
try { db.prepare("SELECT target_margin FROM products LIMIT 1").get(); }
catch { db.exec("ALTER TABLE products ADD COLUMN target_margin REAL NOT NULL DEFAULT 0.65"); }

// Ensure database seeded items use either 'ingredient' or 'equipment'
db.exec(`
  UPDATE inventory SET category = 'ingredient' WHERE category IN ('raw', 'liquid', 'bakery');
  UPDATE inventory SET category = 'equipment' WHERE category = 'packaging';
`);

// Seed default inventory items
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

if (db.prepare('SELECT count(*) AS n FROM categories').get().n === 0) {
  [['coffee','กาแฟ'],['tea','ชาและนม'],['bakery','เบเกอรี่'],['other','อื่น ๆ']].forEach(x => db.prepare('INSERT INTO categories(category_key,name) VALUES (?,?)').run(...x));
}
if (db.prepare('SELECT count(*) AS n FROM sales_channels').get().n === 0) {
  [['lineman','LINE MAN',30],['grab','GrabFood',30],['shopee','ShopeeFood',30]].forEach(x => db.prepare('INSERT INTO sales_channels(channel_key,name,gp_percent) VALUES (?,?,?)').run(...x));
}

if (db.prepare('SELECT count(*) AS n FROM products').get().n === 0) {
  const seed = db.transaction(() => {
    [['เอสเพรสโซ่ร้อน',50,'coffee','☕','coffee_beans'],['อเมริกาโน่เย็น',60,'coffee','🧊','coffee_beans'],['คาปูชิโน่เย็น',70,'coffee','☕','milk'],['ชาไทยเย็น',65,'tea','🧋','tea_leaves'],['ครัวซองต์เนยสด',85,'bakery','🥐','croissant']].forEach((x,i) => db.prepare('INSERT INTO products(name,price,category,emoji,stock_key) VALUES (?,?,?,?,?)').run(...x));
    ['kds','inventory','members','recipes','reports'].forEach(k => db.prepare('INSERT INTO feature_settings VALUES (?,1)').run(k));
  }); seed();
}

const app = express();
// Extended coffee / matcha menu from the current No.5 Cafe menu board.
const ensureMenu = db.prepare('INSERT INTO products(name,price,category,emoji,stock_key) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM products WHERE name=?)');
[['Mocha',70,'coffee','☕','coffee_beans'],['Caramel Macchiato',70,'coffee','☕','coffee_beans'],['Matcha Latte',70,'tea','🍵','tea_leaves'],['Pure Matcha',70,'tea','🍵','tea_leaves']].forEach(x => ensureMenu.run(...x,x[0]));
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
app.disable('x-powered-by');
app.use((_, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '200kb' }));
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

// Helper for structured stock checks
const getRecipeItems = (productId, stockKey) => {
  const items = db.prepare('SELECT stock_key, quantity FROM recipe_items WHERE product_id=?').all(productId);
  if (items.length > 0) return items;
  // Fallback to stockKey if recipe items are empty (compatibility mode)
  if (stockKey) return [{ stock_key: stockKey, quantity: 1 }];
  return [];
};

app.get('/api/bootstrap', (_,res) => res.json({ products:db.prepare('SELECT * FROM products WHERE active=1 ORDER BY category,name').all(), inventory:db.prepare('SELECT * FROM inventory ORDER BY name').all(), categories:db.prepare('SELECT * FROM categories WHERE active=1 ORDER BY name').all(), channels:db.prepare('SELECT * FROM sales_channels WHERE active=1 ORDER BY name').all(), features:Object.fromEntries(db.prepare('SELECT feature_key,enabled FROM feature_settings').all().map(x=>[x.feature_key,!!x.enabled])), membersEnabled:enabled('members') }));
app.get('/api/pricing', (_,res) => res.json(db.prepare(`SELECT p.id product_id,p.name,p.price store_price,c.channel_key,c.name channel_name,c.gp_percent,cp.sale_price,round(p.price/(1-c.gp_percent/100),2) suggested_price FROM products p CROSS JOIN sales_channels c LEFT JOIN channel_prices cp ON cp.product_id=p.id AND cp.channel_key=c.channel_key WHERE p.active=1 AND c.active=1 ORDER BY p.name,c.name`).all()));
app.get('/api/costing', (_,res) => {
  const products=db.prepare('SELECT id,name,price,category,target_margin FROM products WHERE active=1 ORDER BY category,name').all();
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

app.get('/api/reports/today', (_,res) => res.json(db.prepare("SELECT count(*) orders, coalesce(sum(total),0) sales FROM orders WHERE date(created_at,'localtime')=date('now','localtime')").get()));
app.get('/api/kds', (_,res) => { if(!enabled('kds')) return fail(res,'ยังไม่ได้เปิดฟังก์ชันคิวชง',403); res.json(db.prepare("SELECT oi.id,oi.name,oi.quantity,oi.options_json,oi.status,o.id order_id,o.created_at FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE date(o.created_at,'localtime')=date('now','localtime') ORDER BY o.created_at DESC LIMIT 100").all()); });
app.put('/api/kds/items/:id/status', (req,res) => { if(!enabled('kds')) return fail(res,'ยังไม่ได้เปิดฟังก์ชันคิวชง',403); const status=req.body?.status; if(!['pending','cooking','completed'].includes(status)) return fail(res,'สถานะไม่ถูกต้อง'); const r=db.prepare('UPDATE order_items SET status=? WHERE id=?').run(status,req.params.id); return r.changes?res.json({ok:true}):fail(res,'ไม่พบรายการคิวชง',404); });
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
  const {items, discount=0, paymentType, memberPhone=null, received=0, changeDue=0, redeemFreeCup=false} = req.body || {};
  if (!Array.isArray(items) || !items.length || !['cash','qr'].includes(paymentType)) return fail(res,'Invalid payment data');
  if (!Number.isFinite(Number(discount)) || Number(discount)<0) return fail(res,'Invalid discount');
  try {
    const order = db.transaction(() => {
      const findProduct=db.prepare('SELECT * FROM products WHERE id=?'); let subtotal=0; const lines=[];
      for (const row of items) {
        const product=findProduct.get(Number(row.productId)), qty=Number(row.quantity);
        if(!product || !product.active || !Number.isInteger(qty) || qty<1 || qty>99) throw Error('Invalid order item');
        const raw=row.options||{};
        const options={temperature:['hot','iced','blended'].includes(raw.temperature)?raw.temperature:'iced',sweetness:[0,25,50,100].includes(Number(raw.sweetness))?Number(raw.sweetness):100,milk:['fresh','oat','soy'].includes(raw.milk)?raw.milk:'fresh',toppings:Array.isArray(raw.toppings)?raw.toppings.filter(x=>['extraShot','whippedCream'].includes(x)):[]};
        const unitPrice=Number(product.price)+(options.milk==='oat'?15:options.milk==='soy'?10:0)+(options.toppings.includes('extraShot')?15:0)+(options.toppings.includes('whippedCream')?10:0);
        subtotal+=unitPrice*qty; lines.push({product,qty,options,unitPrice});
      }
      const finalDiscount=Math.min(Number(discount),subtotal), total=subtotal-finalDiscount, orderId=id(), now=new Date().toISOString();
      for(const {product,qty} of lines) for(const item of getRecipeItems(product.id,product.stock_key)) { const stock=db.prepare('SELECT name,quantity FROM inventory WHERE stock_key=?').get(item.stock_key); if(!stock || stock.quantity<item.quantity*qty) throw Error(`Insufficient stock: ${stock?.name||item.stock_key}`); }
      db.prepare('INSERT INTO orders (id, created_at, subtotal, discount, total, payment_type, member_phone, received, change_due) VALUES (?,?,?,?,?,?,?,?,?)').run(orderId,now,subtotal,finalDiscount,total,paymentType,memberPhone||null,received,changeDue);
      for(const {product,qty,options,unitPrice} of lines) { db.prepare('INSERT INTO order_items(order_id,product_id,name,unit_price,quantity,options_json) VALUES (?,?,?,?,?,?)').run(orderId,product.id,product.name,unitPrice,qty,JSON.stringify(options)); for(const item of getRecipeItems(product.id,product.stock_key)) { db.prepare('UPDATE inventory SET quantity=quantity-? WHERE stock_key=?').run(item.quantity*qty,item.stock_key); db.prepare('INSERT INTO stock_movements(stock_key,quantity,reason,order_id,created_at) VALUES (?,?,?,?,?)').run(item.stock_key,-item.quantity*qty,'sale',orderId,now); } }
      
      let memberPoints = 0;
      if(memberPhone && enabled('members')) {
        const member = db.prepare('SELECT points FROM members WHERE phone=?').get(memberPhone);
        if (member) {
          let cupsEarned = 0;
          for (const {product, qty} of lines) {
            if (product.category !== 'bakery') {
              cupsEarned += qty;
            }
          }
          let newPoints = member.points;
          if (redeemFreeCup) {
            if (member.points < 10) throw Error('คะแนนไม่เพียงพอสำหรับแลกแก้วฟรี');
            newPoints -= 10;
            cupsEarned = Math.max(0, cupsEarned - 1);
          }
          newPoints += cupsEarned;
          db.prepare('UPDATE members SET points=? WHERE phone=?').run(newPoints, memberPhone);
          memberPoints = newPoints;
        }
      }
      return {id:orderId,subtotal,discount:finalDiscount,total,createdAt:now,paymentType,memberPhone,received,changeDue,memberPoints,items:lines.map(x=>({name:x.product.name,quantity:x.qty,unit_price:x.unitPrice,options:x.options}))};
    })();
    res.status(201).json(order);
  } catch(e) { fail(res,e.message); }
});

app.post('/api/orders-legacy', (req,res) => {
  const {items, discount=0, paymentType, memberPhone=null, received=0, changeDue=0, redeemFreeCup=false} = req.body || {};
  if (!Array.isArray(items) || !items.length || !['cash','qr'].includes(paymentType)) return fail(res,'ข้อมูลการชำระเงินไม่ถูกต้อง');
  if (!Number.isFinite(Number(discount)) || Number(discount)<0) return fail(res,'ส่วนลดไม่ถูกต้อง');
  try {
    const order = db.transaction(() => {
      const products = db.prepare(`SELECT * FROM products WHERE id=?`); let subtotal=0; const lines=[];
      for (const row of items) { const product=products.get(Number(row.productId)); const qty=Number(row.quantity); if(!product || !product.active || !Number.isInteger(qty) || qty<1 || qty>99) throw Error('รายการสินค้าไม่ถูกต้อง'); subtotal += product.price*qty; lines.push({product,qty,options:row.options||{}}); }
      
      const finalDiscount=Math.min(Number(discount),subtotal), total=subtotal-finalDiscount, orderId=id(), now=new Date().toISOString();
      
      // Stock checks (Structured Recipes verification)
      for (const {product,qty} of lines) {
        const recipeItems = getRecipeItems(product.id, product.stock_key);
        for (const item of recipeItems) {
          const stock = db.prepare('SELECT name, quantity FROM inventory WHERE stock_key=?').get(item.stock_key);
          if (!stock || stock.quantity < item.quantity * qty) {
            throw Error(`สต็อก ${stock?.name || item.stock_key} ไม่เพียงพอสำหรับเมนู ${product.name}`);
          }
        }
      }
      
      db.prepare('INSERT INTO orders (id, created_at, subtotal, discount, total, payment_type, member_phone, received, change_due) VALUES (?,?,?,?,?,?,?,?,?)').run(orderId,now,subtotal,finalDiscount,total,paymentType,memberPhone||null,received,changeDue);
      
      for (const {product,qty,options} of lines) {
        db.prepare('INSERT INTO order_items(order_id,product_id,name,unit_price,quantity,options_json) VALUES (?,?,?,?,?,?)').run(orderId,product.id,product.name,product.price,qty,JSON.stringify(options));
        
        // Multi-item inventory reductions
        const recipeItems = getRecipeItems(product.id, product.stock_key);
        for (const item of recipeItems) {
          db.prepare('UPDATE inventory SET quantity=quantity-? WHERE stock_key=?').run(item.quantity * qty, item.stock_key);
          db.prepare('INSERT INTO stock_movements(stock_key,quantity,reason,order_id,created_at) VALUES (?,?,?,?,?)').run(item.stock_key, -item.quantity * qty, 'sale', orderId, now);
        }
      }
      
      let memberPoints = 0;
      if(memberPhone && enabled('members')) {
        const member = db.prepare('SELECT points FROM members WHERE phone=?').get(memberPhone);
        if (member) {
          let cupsEarned = 0;
          for (const {product, qty} of lines) {
            if (product.category !== 'bakery') {
              cupsEarned += qty;
            }
          }
          let newPoints = member.points;
          if (redeemFreeCup) {
            if (member.points < 10) throw Error('คะแนนไม่เพียงพอสำหรับแลกแก้วฟรี');
            newPoints -= 10;
            cupsEarned = Math.max(0, cupsEarned - 1);
          }
          newPoints += cupsEarned;
          db.prepare('UPDATE members SET points=? WHERE phone=?').run(newPoints, memberPhone);
          memberPoints = newPoints;
        }
      }
      return {id:orderId,subtotal,discount:finalDiscount,total,createdAt:now,paymentType,memberPhone,received,changeDue,memberPoints};
    })(); res.status(201).json(order);
  } catch(e) { fail(res,e.message); }
});

app.get('/api/reports/analytics', (_, res) => {
  if (!enabled('reports')) return fail(res, 'ยังไม่ได้เปิดฟังก์ชันรายงาน', 403);
  try {
    const categorySales = db.prepare(`
      SELECT p.category, SUM(oi.unit_price * oi.quantity) as sales
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
      GROUP BY p.category
    `).all();

    const paymentSales = db.prepare(`
      SELECT payment_type, SUM(total) as sales
      FROM orders
      GROUP BY payment_type
    `).all();

    const topSellers = db.prepare(`
      SELECT name, SUM(quantity) as qty, SUM(unit_price * quantity) as revenue
      FROM order_items
      GROUP BY name
      ORDER BY qty DESC
      LIMIT 5
    `).all();

    res.json({ categorySales, paymentSales, topSellers });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

app.get('/api/reports/transactions', (_, res) => {
  if (!enabled('reports')) return fail(res, 'ยังไม่ได้เปิดฟังก์ชันรายงาน', 403);
  try {
    const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 50').all();
    const transactions = orders.map(o => {
      const items = db.prepare('SELECT name, unit_price, quantity, options_json FROM order_items WHERE order_id=?').all(o.id);
      return {
        id: o.id,
        created_at: o.created_at,
        subtotal: o.subtotal,
        discount: o.discount,
        total: o.total,
        payment_type: o.payment_type,
        member_phone: o.member_phone,
        received: o.received,
        change_due: o.change_due,
        items
      };
    });
    res.json(transactions);
  } catch (e) {
    fail(res, e.message, 500);
  }
});

app.get('/api/admin/settings', admin, (_,res) => res.json({features:db.prepare('SELECT feature_key,enabled FROM feature_settings').all()}));
app.post('/api/admin/cost-inventory', admin, (req,res) => {
  const stockKey=String(req.body?.stockKey||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'');
  const name=String(req.body?.name||'').trim(),unit=String(req.body?.unit||'').trim(),quantity=Number(req.body?.quantity),lowAlert=Number(req.body?.lowAlert),purchaseQuantity=Number(req.body?.purchaseQuantity),purchaseTotal=Number(req.body?.purchaseTotal),category=req.body?.category==='equipment'?'equipment':'ingredient';
  if(!stockKey||!name||!unit||![quantity,lowAlert,purchaseQuantity,purchaseTotal].every(Number.isFinite)||quantity<0||lowAlert<0||purchaseQuantity<=0||purchaseTotal<0)return fail(res,'ข้อมูลต้นทุนไม่ถูกต้อง');
  try { db.prepare('INSERT INTO inventory(stock_key,name,unit,quantity,low_alert,category,purchase_quantity,purchase_total,cost_per_unit) VALUES (?,?,?,?,?,?,?,?,?)').run(stockKey,name,unit,quantity,lowAlert,category,purchaseQuantity,purchaseTotal,purchaseTotal/purchaseQuantity);res.status(201).json({ok:true}); } catch { fail(res,'รหัสวัตถุดิบซ้ำ',409); }
});
app.put('/api/admin/cost-inventory/:key', admin, (req,res) => {
  const name=String(req.body?.name||'').trim(),unit=String(req.body?.unit||'').trim(),quantity=Number(req.body?.quantity),lowAlert=Number(req.body?.lowAlert),purchaseQuantity=Number(req.body?.purchaseQuantity),purchaseTotal=Number(req.body?.purchaseTotal),category=req.body?.category==='equipment'?'equipment':'ingredient';
  if(!name||!unit||![quantity,lowAlert,purchaseQuantity,purchaseTotal].every(Number.isFinite)||quantity<0||lowAlert<0||purchaseQuantity<=0||purchaseTotal<0)return fail(res,'ข้อมูลต้นทุนไม่ถูกต้อง');
  const r=db.prepare('UPDATE inventory SET name=?,unit=?,quantity=?,low_alert=?,category=?,purchase_quantity=?,purchase_total=?,cost_per_unit=? WHERE stock_key=?').run(name,unit,quantity,lowAlert,category,purchaseQuantity,purchaseTotal,purchaseTotal/purchaseQuantity,req.params.key);return r.changes?res.json({ok:true}):fail(res,'ไม่พบวัตถุดิบ',404);
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
app.get('/api/admin/products', admin, (_,res) => { res.json(db.prepare('SELECT * FROM products ORDER BY category,name').all()); });
app.put('/api/admin/products/:id/costing', admin, (req,res) => {
  const price=Number(req.body?.price), targetMargin=Number(req.body?.targetMargin);
  if(!Number.isFinite(price)||price<0||!Number.isFinite(targetMargin)||targetMargin<0||targetMargin>=.95)return fail(res,'ราคา หรือเป้าหมายกำไรไม่ถูกต้อง');
  const r=db.prepare('UPDATE products SET price=?,target_margin=? WHERE id=?').run(price,targetMargin,req.params.id);return r.changes?res.json({ok:true}):fail(res,'ไม่พบเมนู',404);
});

app.post('/api/admin/products', admin, (req,res) => { 
  const {name,price,category,emoji='☕',stockKey=null}=req.body||{}; 
  if(typeof name!=='string'||!name.trim()||!Number.isFinite(Number(price))||Number(price)<0)return fail(res,'ข้อมูลเมนูไม่ถูกต้อง'); 
  const result=db.prepare('INSERT INTO products(name,price,category,emoji,stock_key) VALUES (?,?,?,?,?)').run(name.trim(),Number(price),category||'other',emoji.slice(0,8),stockKey); 
  res.status(201).json({id:result.lastInsertRowid}); 
});

app.put('/api/admin/products/:id', admin, (req,res) => { 
  const {name,price,category,emoji='☕',active=true,stockKey=null}=req.body||{}; 
  if(typeof name!=='string'||!name.trim()||!Number.isFinite(Number(price))||Number(price)<0)return fail(res,'ข้อมูลเมนูไม่ถูกต้อง'); 
  const r=db.prepare('UPDATE products SET name=?,price=?,category=?,emoji=?,active=?,stock_key=? WHERE id=?').run(name.trim(),Number(price),category||'other',emoji.slice(0,8),active?1:0,stockKey,req.params.id); 
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
app.post('/api/admin/categories', admin, (req,res) => { const key=String(req.body?.key||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,''); const name=String(req.body?.name||'').trim(); if(!key||!name)return fail(res,'ระบุรหัสและชื่อหมวดสินค้า'); try{db.prepare('INSERT INTO categories(category_key,name) VALUES (?,?)').run(key,name);res.status(201).json({ok:true})}catch{fail(res,'รหัสหมวดซ้ำ',409)} });
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
