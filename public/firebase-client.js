/* Firebase Spark adapter: used on GitHub Pages, while localhost keeps Express/SQLite. */
(function () {
  const config = { apiKey:'AIzaSyCApl7oIpLBMQAsRgw_W1-TQ2KAbTJG5bk', authDomain:'no5cafepos.firebaseapp.com', projectId:'no5cafepos', storageBucket:'no5cafepos.firebasestorage.app', messagingSenderId:'559330080095', appId:'1:559330080095:web:d37f17b84a8c1d92b472ea' };
  const useFirebase = location.hostname === 'songyos909.github.io' || location.hostname.endsWith('.web.app') || location.pathname.endsWith('/firebase-import.html');
  window.useFirebaseStore = useFirebase;
  if (!useFirebase) return;
  firebase.initializeApp(config);
  const db = firebase.firestore();
  window.firebaseDb = db;
  const auth = firebase.auth();
  const defaults = { features:{kds:true,inventory:true,members:true,recipes:true,reports:true}, categories:[['coffee','กาแฟ'],['tea','ชาและนม'],['bakery','เบเกอรี่'],['other','อื่น ๆ']], channels:[['lineman','LINE MAN',30],['grab','GrabFood',30],['shopee','ShopeeFood',30]] };
  const defaultProducts = [
    {id:'espresso_hot',name:'Espresso (Hot)',price:45,category:'coffee',emoji:'☕',active:true},
    {id:'iced_espresso',name:'Iced Espresso',price:55,category:'coffee',emoji:'🧊',active:true},
    {id:'americano',name:'Americano',price:50,category:'coffee',emoji:'☕',active:true},
    {id:'latte',name:'Latte',price:60,category:'coffee',emoji:'☕',active:true},
    {id:'cappuccino',name:'Cappuccino',price:60,category:'coffee',emoji:'☕',active:true},
    {id:'mocha',name:'Mocha',price:70,category:'coffee',emoji:'☕',active:true},
    {id:'caramel_macchiato',name:'Caramel Macchiato',price:70,category:'coffee',emoji:'☕',active:true},
    {id:'matcha_latte',name:'Matcha Latte',price:70,category:'tea',emoji:'🍵',active:true},
    {id:'pure_matcha',name:'Pure Matcha',price:70,category:'tea',emoji:'🍵',active:true}
  ];
  let readyResolve;
  window.firebaseReady = new Promise(resolve => { readyResolve = resolve; });
  async function activate(user) {
    if (!user || user.email !== 'songyos909@gmail.com') return;
    const settings = db.collection('settings').doc('features');
    if (!(await settings.get()).exists) {
      const batch=db.batch(); batch.set(settings,defaults.features);
      defaults.categories.forEach(([id,name])=>batch.set(db.collection('categories').doc(id),{name,active:true}));
      defaults.channels.forEach(([id,name,gp_percent])=>batch.set(db.collection('channels').doc(id),{name,gp_percent,active:true}));
      await batch.commit();
    }
    if ((await db.collection('products').limit(1).get()).empty) {
      const batch=db.batch(); defaultProducts.forEach(p=>batch.set(db.collection('products').doc(p.id),p)); await batch.commit();
    }
    document.querySelector('#firebase-login-dialog')?.close();
    readyResolve();
  }
  auth.onAuthStateChanged(activate);
  const loginButton=document.querySelector('#firebase-login-btn');
  if(loginButton) loginButton.onclick=async()=>{const email=document.querySelector('#firebase-email')?.value||'',password=document.querySelector('#firebase-password')?.value||'',error=document.querySelector('#firebase-login-error');try{await auth.signInWithEmailAndPassword(email,password);if(error)error.textContent='';}catch(e){if(error)error.textContent=e.message;}};
  if (!auth.currentUser) document.querySelector('#firebase-login-dialog')?.showModal();
  const docs = async name => (await db.collection(name).get()).docs.map(d=>({id:d.id,...d.data()}));
  const body = opts => typeof opts?.body === 'string' ? JSON.parse(opts.body) : (opts?.body || {});
  const err = (message,status=400) => { const e=new Error(message);e.status=status;throw e; };
  const uid = () => `TX-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2,6).toUpperCase()}`;
  window.firebaseApi = async (url,opts={}) => {
    await window.firebaseReady;
    const path=url.replace(/^\/api\//,'').replace(/^\//,''); const method=(opts.method||'GET').toUpperCase(); const data=body(opts);
    if(path==='bootstrap' && method==='GET') { const [products,inventory,categories,channels,settings]=await Promise.all([docs('products'),docs('inventory'),docs('categories'),docs('channels'),db.collection('settings').doc('features').get()]); return {products:products.filter(x=>x.active!==false).map(x=>({id:Number(x.id)||x.id,...x})),inventory:inventory.map(x=>({stock_key:x.id,...x})),categories:categories.filter(x=>x.active!==false).map(x=>({category_key:x.id,...x})),channels:channels.filter(x=>x.active!==false).map(x=>({channel_key:x.id,...x})),features:settings.data()||defaults.features,membersEnabled:true}; }
    if(path==='recipes' && method==='GET') { const [products,items,recipes,inventory]=await Promise.all([docs('products'),docs('recipeItems'),docs('recipes'),docs('inventory')]); const inv=Object.fromEntries(inventory.map(x=>[x.id,x])); const recipeMap=Object.fromEntries(recipes.map(x=>[x.id,x])); return products.filter(x=>x.active!==false).map(p=>({id:p.id,name:p.name,emoji:p.emoji,description:recipeMap[p.id]?.description||'',items:items.filter(x=>x.product_id==p.id).map(x=>({stock_key:x.stock_key,quantity:x.quantity,name:inv[x.stock_key]?.name||x.stock_key,unit:inv[x.stock_key]?.unit||''}))})); }
    if(path==='reports/today' && method==='GET') { const orders=await docs('orders');const day=new Date().toISOString().slice(0,10);const today=orders.filter(x=>String(x.createdAt||'').slice(0,10)===day);return {orders:today.length,sales:today.reduce((n,x)=>n+Number(x.total||0),0)}; }
    if(path==='kds' && method==='GET') return (await docs('orderItems')).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,100);
    if(path.startsWith('kds/items/') && path.endsWith('/status') && method==='PUT') { await db.collection('orderItems').doc(path.split('/')[2]).update({status:data.status});return {ok:true}; }
    if(path.startsWith('members/') && method==='GET') { const d=await db.collection('members').doc(path.split('/')[1]).get();if(!d.exists)return err('ไม่พบสมาชิก',404);return {phone:d.id,...d.data()}; }
    if(path==='members' && method==='POST') { const phone=String(data.phone||'').replace(/\D/g,'');if(phone.length<9)return err('เบอร์โทรไม่ถูกต้อง');await db.collection('members').doc(phone).set({name:data.name||`ลูกค้า (${phone.slice(-4)})`,points:0},{merge:true});return {ok:true}; }
    if(path==='orders' && method==='POST') { const products=Object.fromEntries((await docs('products')).map(p=>[String(p.id),p]));const lines=(data.items||[]).map(i=>{const p=products[String(i.productId)];if(!p)return err('ไม่พบสินค้า');const o=i.options||{};const plus=(o.milk==='oat'?15:o.milk==='soy'?10:0)+(o.toppings?.includes('extraShot')?15:0)+(o.toppings?.includes('whippedCream')?10:0);return {product:p,quantity:Number(i.quantity),options:o,unit_price:Number(p.price)+plus};});if(!lines.length)return err('ไม่มีสินค้า');const subtotal=lines.reduce((n,x)=>n+x.quantity*x.unit_price,0),discount=Math.min(Number(data.discount)||0,subtotal),total=subtotal-discount,id=uid(),createdAt=new Date().toISOString();const batch=db.batch();batch.set(db.collection('orders').doc(id),{id,subtotal,discount,total,paymentType:data.paymentType,memberPhone:data.memberPhone||null,received:data.received||0,changeDue:data.changeDue||0,createdAt});lines.forEach(x=>batch.set(db.collection('orderItems').doc(),{order_id:id,name:x.product.name,quantity:x.quantity,unit_price:x.unit_price,options_json:JSON.stringify(x.options),status:'pending',created_at:createdAt,createdAt}));await batch.commit();return {id,subtotal,discount,total,paymentType:data.paymentType,memberPhone:data.memberPhone,received:data.received||0,changeDue:data.changeDue||0,createdAt,items:lines.map(x=>({name:x.product.name,quantity:x.quantity,unit_price:x.unit_price,options:x.options}))}; }
    if(path==='admin/settings' && method==='GET') { const s=await db.collection('settings').doc('features').get();return {features:Object.entries(s.data()||defaults.features).map(([feature_key,enabled])=>({feature_key,enabled:!!enabled}))}; }
    if(path.startsWith('admin/settings/') && method==='PUT') { await db.collection('settings').doc('features').set({[path.split('/')[2]]:!!data.enabled},{merge:true});return {ok:true}; }
    if(path==='admin/products' && method==='GET') return (await docs('products')).map(x=>({id:x.id,...x}));
    if(path==='admin/products' && method==='POST') { const id=String(Date.now());await db.collection('products').doc(id).set({id,name:data.name,price:Number(data.price),category:data.category||'other',emoji:data.emoji||'☕',active:true,target_margin:.65});return {id}; }
    if(path.match(/^admin\/products\/[^/]+$/) && method==='PUT') { const id=path.split('/')[2];await db.collection('products').doc(id).set({name:data.name,price:Number(data.price),category:data.category||'other',emoji:data.emoji||'☕',active:!!data.active},{merge:true});return {ok:true}; }
    if(path.match(/^admin\/products\/[^/]+$/) && method==='DELETE') { await db.collection('products').doc(path.split('/')[2]).delete();return {ok:true}; }
    if(path.match(/^admin\/products\/[^/]+\/costing$/) && method==='PUT') { await db.collection('products').doc(path.split('/')[2]).set({price:Number(data.price),target_margin:Number(data.targetMargin)},{merge:true});return {ok:true}; }
    if(path.match(/^admin\/products\/[^/]+\/recipe$/) && method==='GET') { const id=path.split('/')[2], [r,all,inventory]=await Promise.all([db.collection('recipes').doc(id).get(),docs('recipeItems'),docs('inventory')]);const inv=Object.fromEntries(inventory.map(x=>[x.id,x]));return {description:r.data()?.description||'',items:all.filter(x=>String(x.product_id)===id).map(x=>({stock_key:x.stock_key,quantity:x.quantity,name:inv[x.stock_key]?.name||x.stock_key,unit:inv[x.stock_key]?.unit||'',cost_per_unit:inv[x.stock_key]?.cost_per_unit||0}))}; }
    if(path.match(/^admin\/products\/[^/]+\/recipe$/) && method==='PUT') { const id=path.split('/')[2],old=(await docs('recipeItems')).filter(x=>String(x.product_id)===id);const batch=db.batch();old.forEach(x=>batch.delete(db.collection('recipeItems').doc(x.id)));(data.items||[]).forEach((x,n)=>batch.set(db.collection('recipeItems').doc(`${id}_${x.stock_key}_${n}`),{product_id:id,stock_key:x.stock_key,quantity:Number(x.quantity)}));batch.set(db.collection('recipes').doc(id),{description:data.description||''},{merge:true});await batch.commit();return {ok:true}; }
    if(path==='costing' && method==='GET') { const [products,items,inventory,channels]=await Promise.all([docs('products'),docs('recipeItems'),docs('inventory'),docs('channels')]);const inv=Object.fromEntries(inventory.map(x=>[x.id,x]));return products.filter(x=>x.active!==false).map(p=>{const ingredients=items.filter(x=>String(x.product_id)===String(p.id)).map(x=>({...x,name:inv[x.stock_key]?.name||x.stock_key,unit:inv[x.stock_key]?.unit||'',cost_per_unit:Number(inv[x.stock_key]?.cost_per_unit||0),line_cost:Number((Number(x.quantity)*Number(inv[x.stock_key]?.cost_per_unit||0)).toFixed(2))}));const cost=ingredients.reduce((n,x)=>n+x.line_cost,0),target_margin=Number(p.target_margin??.65),recommended_store_price=cost/(1-target_margin);return {product_id:p.id,name:p.name,store_price:Number(p.price),target_margin,cost,food_cost_percent:p.price?Number((cost/p.price*100).toFixed(1)):0,gross_profit:Number(p.price)-cost,recommended_store_price,ingredients,online:channels.filter(x=>x.active!==false).map(c=>({channel_key:c.id,name:c.name,gp_percent:c.gp_percent,suggested_price:recommended_store_price/(1-Number(c.gp_percent)/100)}))};}); }
    return err(`Firebase API ยังไม่รองรับ ${path}`,404);
  };
})();
