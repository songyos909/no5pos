const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const express = require('express');
const cors = require('cors');

initializeApp();
const db = getFirestore();
const app = express();
const adminPin = defineSecret('ADMIN_PIN');
app.use(cors({ origin: true }));
app.use(express.json());
app.disable('x-powered-by');
app.use((req, _res, next) => { if (req.url === '/api' || req.url.startsWith('/api/')) req.url = req.url.slice(4) || '/'; next(); });

const fail = (res, error, status = 400) => res.status(status).json({ error });
const id = () => `TX-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2,6).toUpperCase()}`;
const active = data => data?.active !== false;
const admin = (req,res,next) => req.get('x-admin-pin') === adminPin.value() ? next() : fail(res,'ต้องระบุ PIN ผู้ดูแลให้ถูกต้อง',401);
const defaultFeatures = { kds:true, inventory:true, members:true, recipes:true, reports:true };
const defaultCategories = [{id:'coffee',name:'กาแฟ'},{id:'tea',name:'ชาและนม'},{id:'bakery',name:'เบเกอรี่'},{id:'other',name:'อื่น ๆ'}];
const defaultProducts = [
  {name:'เอสเพรสโซ่ร้อน',price:50,category:'coffee',emoji:'☕',stockKey:'coffee_beans'},
  {name:'อเมริกาโน่เย็น',price:60,category:'coffee',emoji:'🧊',stockKey:'coffee_beans'},
  {name:'คาปูชิโน่เย็น',price:70,category:'coffee',emoji:'☕',stockKey:'milk'},
  {name:'ชาไทยเย็น',price:65,category:'tea',emoji:'🧋',stockKey:'tea_leaves'},
  {name:'ครัวซองต์เนยสด',price:85,category:'bakery',emoji:'🥐',stockKey:'croissant'}
];

async function ensureSeed() {
  const settings = db.collection('settings').doc('features');
  if ((await settings.get()).exists) return;
  const batch = db.batch();
  batch.set(settings, defaultFeatures);
  defaultCategories.forEach(x => batch.set(db.collection('categories').doc(x.id), {name:x.name,active:true}));
  defaultProducts.forEach(x => batch.set(db.collection('products').doc(), {...x,active:true,createdAt:FieldValue.serverTimestamp()}));
  await batch.commit();
}
function options(raw={}) {
  const temperature=['hot','iced','blended'].includes(raw.temperature)?raw.temperature:'iced';
  const sweetness=[0,25,50,100].includes(Number(raw.sweetness))?Number(raw.sweetness):100;
  const milk=['fresh','oat','soy'].includes(raw.milk)?raw.milk:'fresh';
  const toppings=Array.isArray(raw.toppings)?raw.toppings.filter(x=>['extraShot','whippedCream'].includes(x)):[];
  return {temperature,sweetness,milk,toppings};
}
function extra(o) { return (o.milk==='oat'?15:o.milk==='soy'?10:0)+(o.toppings.includes('extraShot')?15:0)+(o.toppings.includes('whippedCream')?10:0); }
async function features() { const snap=await db.collection('settings').doc('features').get(); return {...defaultFeatures,...(snap.data()||{})}; }
function asProduct(doc) { const x=doc.data(); return {id:doc.id,name:x.name,price:x.price,category:x.category,emoji:x.emoji,stock_key:x.stockKey||'',active:active(x)}; }

app.get('/bootstrap', async (_,res) => { try { await ensureSeed(); const [p,c,i,ch,f]=await Promise.all([db.collection('products').where('active','!=',false).get(),db.collection('categories').where('active','!=',false).get(),db.collection('inventory').get(),db.collection('channels').where('active','!=',false).get(),features()]); res.json({products:p.docs.map(asProduct),categories:c.docs.map(d=>({category_key:d.id,...d.data()})),inventory:i.docs.map(d=>({stock_key:d.id,...d.data()})),channels:ch.docs.map(d=>({channel_key:d.id,...d.data()})),features:f,membersEnabled:!!f.members}); } catch(e) { fail(res,e.message,500); } });

app.get('/members/:phone', async (req,res) => { const doc=await db.collection('members').doc(String(req.params.phone).replace(/\D/g,'')).get(); return doc.exists ? res.json({phone:doc.id,...doc.data()}) : fail(res,'ไม่พบสมาชิก',404); });
app.post('/members', async (req,res) => { const phone=String(req.body?.phone||'').replace(/\D/g,''),name=String(req.body?.name||'').trim(); if(phone.length<9||!name)return fail(res,'กรอกชื่อและเบอร์โทรให้ถูกต้อง'); await db.collection('members').doc(phone).set({name,points:0},{merge:true}); res.status(201).json({ok:true}); });

app.get('/kds', async (_,res) => { const q=await db.collection('orderItems').orderBy('createdAt','desc').limit(100).get(); res.json(q.docs.map(d=>({id:d.id,...d.data()}))); });
app.put('/kds/items/:id/status', async (req,res) => { const status=req.body?.status; if(!['pending','cooking','completed'].includes(status))return fail(res,'สถานะไม่ถูกต้อง'); await db.collection('orderItems').doc(req.params.id).update({status});res.json({ok:true}); });

app.post('/orders', async (req,res) => { const {items,discount=0,paymentType,memberPhone=null,received=0,changeDue=0}=req.body||{}; if(!Array.isArray(items)||!items.length||!['cash','qr'].includes(paymentType))return fail(res,'ข้อมูลการชำระเงินไม่ถูกต้อง'); try { const result=await db.runTransaction(async tx=>{const lines=[];for(const item of items){const ref=db.collection('products').doc(String(item.productId));const snap=await tx.get(ref);if(!snap.exists||!active(snap.data()))throw Error('ไม่พบสินค้า');const product={id:snap.id,...snap.data()};const qty=Number(item.quantity);if(!Number.isInteger(qty)||qty<1||qty>99)throw Error('จำนวนสินค้าไม่ถูกต้อง');const o=options(item.options);lines.push({product,qty,options:o,unitPrice:Number(product.price)+extra(o)});}const subtotal=lines.reduce((n,x)=>n+x.unitPrice*x.qty,0), finalDiscount=Math.min(Math.max(0,Number(discount)||0),subtotal), total=subtotal-finalDiscount, orderId=id(), createdAt=new Date().toISOString();const order={id:orderId,subtotal,discount:finalDiscount,total,paymentType,memberPhone,received,changeDue,createdAt};tx.set(db.collection('orders').doc(orderId),order);lines.forEach(x=>tx.set(db.collection('orderItems').doc(),{order_id:orderId,name:x.product.name,quantity:x.qty,unit_price:x.unitPrice,options_json:JSON.stringify(x.options),status:'pending',created_at:createdAt,createdAt}));if(memberPhone)tx.set(db.collection('members').doc(memberPhone),{points:FieldValue.increment(Math.floor(total/10))},{merge:true});return {...order,items:lines.map(x=>({name:x.product.name,quantity:x.qty,unit_price:x.unitPrice,options:x.options}))};});res.status(201).json(result);}catch(e){fail(res,e.message,400);} });

app.get('/reports/today', async (_,res) => { const orders=await db.collection('orders').get(); const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'}); const rows=orders.docs.map(d=>d.data()).filter(x=>String(x.createdAt||'').slice(0,10)===today);res.json({orders:rows.length,sales:rows.reduce((n,x)=>n+Number(x.total||0),0)}); });

app.post('/admin/import-sqlite', admin, async (req,res) => {
  const data=req.body || {}; const allowed=['products','inventory','categories','channels','channelPrices','members','recipes','recipeItems','orders','orderItems','settings'];
  try {
    for (const key of allowed) {
      const rows=Array.isArray(data[key]) ? data[key] : [];
      if (!rows.length) continue;
      for (let i=0;i<rows.length;i+=400) {
        const batch=db.batch();
        rows.slice(i,i+400).forEach(row => { const copy={...row}; const docId=String(copy.id ?? copy.stock_key ?? copy.phone ?? copy.category_key ?? copy.channel_key ?? `${i}-${Math.random()}`); delete copy.id; batch.set(db.collection(key).doc(docId),copy,{merge:true}); });
        await batch.commit();
      }
    }
    res.json({ok:true});
  } catch (e) { fail(res,e.message,500); }
});

exports.api = onRequest({ region:'asia-southeast1', cors:true, timeoutSeconds:60, secrets:[adminPin] }, app);
