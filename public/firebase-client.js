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
  const defaults = { features:{kds:true,inventory:true,members:true,recipes:true,reports:true}, categories:[['coffee','กาแฟ'],['tea','ชาและนม'],['food','อาหาร'],['dessert','ของหวาน'],['bakery','เบเกอรี่'],['other','อื่น ๆ']], channels:[['lineman','LINE MAN',0],['grab','GrabFood',0],['shopee','ShopeeFood',0]] };
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
  const requiredMenuProducts = [
    {id:'no5_hamburger',name:'แฮมเบอร์เกอร์',price:89,category:'food',emoji:'🍔',image_path:'menu-images/classic-burger.png',deduct_stock:false,active:true},
    {id:'no5_pan_fried_eggs',name:'ไข่กระทะ',price:69,category:'food',emoji:'🍳',image_path:'menu-images/pan-fried-eggs.png',deduct_stock:false,active:true},
    {id:'no5_tub_tim_krob',name:'ทับทิมกรอบ',price:59,category:'dessert',emoji:'🍧',image_path:'menu-images/tub-tim-krob.png',deduct_stock:false,active:true}
  ];
  const defaultInventory = [
    {id:'cup_cold',name:'แก้วเย็น 16oz',unit:'ใบ',quantity:0,low_alert:100,category:'equipment',purchase_quantity:1,purchase_total:0,cost_per_unit:0},
    {id:'lid_cold',name:'ฝาแก้วเย็น 16oz',unit:'ใบ',quantity:0,low_alert:100,category:'equipment',purchase_quantity:1,purchase_total:0,cost_per_unit:0},
    {id:'straw',name:'หลอดพลาสติก',unit:'เส้น',quantity:0,low_alert:200,category:'equipment',purchase_quantity:1,purchase_total:0,cost_per_unit:0},
    {id:'ice',name:'น้ำแข็ง',unit:'กรัม',quantity:0,low_alert:3000,category:'ingredient',purchase_quantity:1,purchase_total:0,cost_per_unit:0},
    {id:'cup_hot',name:'แก้วร้อน 8oz',unit:'ใบ',quantity:0,low_alert:100,category:'equipment',purchase_quantity:1,purchase_total:0,cost_per_unit:0},
    {id:'lid_hot',name:'ฝาแก้วร้อน 8oz',unit:'ใบ',quantity:0,low_alert:100,category:'equipment',purchase_quantity:1,purchase_total:0,cost_per_unit:0},
    {id:'stirrer',name:'ไม้คนกาแฟ',unit:'อัน',quantity:0,low_alert:100,category:'equipment',purchase_quantity:1,purchase_total:0,cost_per_unit:0}
  ];
  const thaiProductNames = { 'Espresso (Hot)':'เอสเปรสโซ่ร้อน', 'Iced Espresso':'เอสเปรสโซ่เย็น', Americano:'อเมริกาโน่เย็น', Latte:'ลาเต้เย็น', Cappuccino:'คาปูชิโน่เย็น', Mocha:'มอคค่าเย็น', 'Caramel Macchiato':'คาราเมลมัคคิอาโต', 'Matcha Latte':'มัทฉะลาเต้', 'Pure Matcha':'มัทฉะแท้ 100%' };
  const localized = item => ({ ...item, name: item.name_th || thaiProductNames[item.name] || item.name });
  const canonicalUnit = value => ({g:'กรัม',gram:'กรัม',grams:'กรัม','กรับ':'กรัม',ml:'มล.','มล':'มล.',pcs:'ชิ้น',pc:'ชิ้น'}[String(value||'').trim().toLowerCase()] || value);
  const materialTypeByKey = {coffee_beans:'coffee_beans',coffee_nan:'coffee_beans',coffee_ethiopia:'coffee_beans',cocoa:'cocoa',cocoa_powder:'cocoa',tea_leaves:'tea',milk:'milk',milk01:'milk',condensed_milk:'milk',evaporated_milk:'milk',caramel_syrup:'syrup'};
  let readyResolve;
  window.firebaseReady = new Promise(resolve => { readyResolve = resolve; });
  async function activate(user) {
    if (!user || user.email !== 'songyos909@gmail.com') return;
    const settings = db.collection('settings').doc('features');
    const settingsSnap = await settings.get();
    const resetCompleted = settingsSnap.data()?.store_reset === true;
    if (!settingsSnap.exists) {
      const batch=db.batch(); batch.set(settings,defaults.features);
      defaults.categories.forEach(([id,name])=>batch.set(db.collection('categories').doc(id),{name,active:true}));
      defaults.channels.forEach(([id,name,gp_percent])=>batch.set(db.collection('channels').doc(id),{name,gp_percent,active:true}));
      await batch.commit();
    }
    const optionLibrarySetup=db.collection('settings').doc('optionLibrary');
    if(!(await optionLibrarySetup.get()).exists){
      const batch=db.batch();
      batch.set(db.collection('optionGroups').doc('type'),{id:'type',name:'ประเภท',choices:[{id:'hot',label:'ร้อน',price:0},{id:'iced',label:'เย็น',price:0},{id:'blended',label:'ปั่น',price:10}]});
      batch.set(optionLibrarySetup,{initialized:true});
      await batch.commit();
    }
    // เติมเมนูตัวอย่างเฉพาะร้านใหม่; ร้านที่กดรีเซ็ตต้องเริ่มจากข้อมูลว่างจริง ๆ
    if (!resetCompleted) {
    const currentProducts = await db.collection('products').get();
    const translated = currentProducts.docs.filter(doc => !doc.data().name_th && thaiProductNames[doc.data().name]);
    if (translated.length) { const batch=db.batch(); translated.forEach(doc => batch.set(doc.ref,{name_th:thaiProductNames[doc.data().name]},{merge:true})); await batch.commit(); }
    const existingProductIds = new Set(currentProducts.docs.map(d => d.id));
    const missingProducts = defaultProducts.filter(p => !existingProductIds.has(p.id));
    if (missingProducts.length) { const batch=db.batch(); missingProducts.forEach(p=>batch.set(db.collection('products').doc(p.id),p)); await batch.commit(); }
    const currentInventory = await db.collection('inventory').get();
    const cleanup=currentInventory.docs.filter(doc=>canonicalUnit(doc.data().unit)!==doc.data().unit || (!doc.data().material_type && materialTypeByKey[doc.id]));
    if(cleanup.length){const batch=db.batch();cleanup.forEach(doc=>batch.set(doc.ref,{unit:canonicalUnit(doc.data().unit),material_type:doc.data().category==='equipment'?'equipment':(doc.data().material_type||materialTypeByKey[doc.id]||'other')},{merge:true}));await batch.commit();}
    const existingInventoryIds = new Set(currentInventory.docs.map(d => d.id));
    const missingInventory = defaultInventory.filter(item => !existingInventoryIds.has(item.id));
    if (missingInventory.length) { const batch=db.batch(); missingInventory.forEach(item=>{const {id,...data}=item;batch.set(db.collection('inventory').doc(id),data);}); await batch.commit(); }
    }
    const requiredSnapshot = await db.collection('products').get();
    const requiredIds = new Set(requiredSnapshot.docs.map(doc => doc.id));
    const missingRequired = requiredMenuProducts.filter(product => !requiredIds.has(product.id));
    if (missingRequired.length) {
      const batch = db.batch();
      missingRequired.forEach(product => batch.set(db.collection('products').doc(product.id), product));
      await batch.commit();
    }
    document.querySelector('#firebase-login-dialog')?.close();
    readyResolve();
  }
  auth.onAuthStateChanged(activate);
  const loginButton=document.querySelector('#firebase-login-btn');
  if(loginButton) loginButton.onclick=async()=>{const email=document.querySelector('#firebase-email')?.value||'',password=document.querySelector('#firebase-password')?.value||'',error=document.querySelector('#firebase-login-error');try{await auth.signInWithEmailAndPassword(email,password);if(error)error.textContent='';}catch(e){if(error)error.textContent=e.message;}};
  if (!auth.currentUser) document.querySelector('#firebase-login-dialog')?.showModal();
  const docs = async name => (await db.collection(name).get()).docs.map(d=>({id:d.id,...d.data()}));
  const sortBySavedOrder = rows => [...rows].sort((a,b) =>
    Number(a.sort_order ?? 0)-Number(b.sort_order ?? 0)
    || String(a.name||'').localeCompare(String(b.name||''),'th')
  );
  const defaultChannelKeys = new Set(defaults.channels.map(([id])=>id));
  const defaultCategoryKeys = new Set(defaults.categories.map(([id])=>id));
  const restoreDefaultCategories = async () => {
    const snapshot=await db.collection('categories').get(),byId=new Map(snapshot.docs.map(doc=>[doc.id,doc]));
    const batch=db.batch();let changes=0;
    defaults.categories.forEach(([id,name])=>{
      const existing=byId.get(id);
      if(!existing){batch.set(db.collection('categories').doc(id),{name,active:true,sort_order:defaults.categories.findIndex(item=>item[0]===id)});changes++;return;}
      if(existing.data().active===false){batch.set(existing.ref,{active:true},{merge:true});changes++;}
    });
    if(changes)await batch.commit();
  };
  const effectiveFirebaseCategories = categories => {
    const byId=new Map(defaults.categories.map(([id,name],index)=>[id,{id,name,active:true,sort_order:index}]));
    categories.forEach(category=>{
      const current=byId.get(category.id)||{};
      byId.set(category.id,{...current,...category,active:defaultCategoryKeys.has(category.id)?true:category.active!==false});
    });
    return sortBySavedOrder([...byId.values()].filter(category=>category.active!==false));
  };
  const restoreDefaultChannels = async () => {
    const snapshot=await db.collection('channels').get(),byId=new Map(snapshot.docs.map(doc=>[doc.id,doc]));
    const batch=db.batch();let changes=0;
    defaults.channels.forEach(([id,name,gp_percent])=>{
      const existing=byId.get(id);
      if(!existing){batch.set(db.collection('channels').doc(id),{name,gp_percent,active:true});changes++;return;}
      if(existing.data().active===false){batch.set(existing.ref,{active:true},{merge:true});changes++;}
    });
    if(changes)await batch.commit();
  };
  const effectiveFirebaseChannels = channels => {
    const byId=new Map(defaults.channels.map(([id,name,gp_percent])=>[id,{id,name,gp_percent,active:true}]));
    channels.forEach(channel=>{
      const current=byId.get(channel.id)||{};
      byId.set(channel.id,{...current,...channel,active:defaultChannelKeys.has(channel.id)?true:channel.active!==false});
    });
    return [...byId.values()].filter(channel=>channel.active!==false);
  };
  const syncFirebaseOptionGroup = async (groupId,replacement=null) => {
    const products=await docs('products'),batch=db.batch();let changes=0;
    products.forEach(product=>{const groups=Array.isArray(product.custom_options)?product.custom_options:[];if(!groups.some(group=>group.id===groupId))return;const next=replacement?groups.map(group=>group.id===groupId?replacement:group):groups.filter(group=>group.id!==groupId);batch.set(db.collection('products').doc(String(product.id)),{custom_options:next},{merge:true});changes++;});
    if(changes)await batch.commit();
  };
  const body = opts => typeof opts?.body === 'string' ? JSON.parse(opts.body) : (opts?.body || {});
  const err = (message,status=400) => { const e=new Error(message);e.status=status;throw e; };
  const uid = () => `TX-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2,6).toUpperCase()}`;
  const thaiDay = value => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
  const firebaseReportFilters = query => ({
    dateFrom:/^\d{4}-\d{2}-\d{2}$/.test(query.get('dateFrom')||'')?query.get('dateFrom'):null,
    dateTo:/^\d{4}-\d{2}-\d{2}$/.test(query.get('dateTo')||'')?query.get('dateTo'):null,
    category:query.get('category')||null,
    productId:query.get('productId')||null,
    salesChannel:['store','online'].includes(query.get('salesChannel'))?query.get('salesChannel'):null
  });
  const firebaseOrderMatches = (order,filters) => {
    const createdAt=order.createdAt||order.created_at;if(!createdAt)return false;const day=thaiDay(createdAt);
    const channel=order.salesChannel||order.sales_channel||'store';
    return (!filters.dateFrom||day>=filters.dateFrom)&&(!filters.dateTo||day<=filters.dateTo)&&(!filters.salesChannel||channel===filters.salesChannel);
  };
  const firebaseOptionDetails = raw => {
    let options={};try{options=typeof raw==='string'?JSON.parse(raw||'{}'):(raw||{});}catch{}
    return Array.isArray(options.custom_details)
      ? options.custom_details.map(x=>({name:`${x.group}: ${x.label}`,price:Math.max(0,Number(x.price)||0)}))
      : (Array.isArray(options.custom_labels)?options.custom_labels:[]).map(name=>({name:String(name),price:0}));
  };
  window.firebaseApi = async (url,opts={}) => {
    await window.firebaseReady;
    const parsedUrl=new URL(url,window.location.origin);const path=parsedUrl.pathname.replace(/^\/api\//,'').replace(/^\//,'');const query=parsedUrl.searchParams; const method=(opts.method||'GET').toUpperCase(); const data=body(opts);
    if(path==='bootstrap' && method==='GET') { await Promise.all([restoreDefaultCategories(),restoreDefaultChannels()]);const [products,inventory,categories,channels,channelPrices,optionGroups,orderItems,settings,loyalty]=await Promise.all([docs('products'),docs('inventory'),docs('categories'),docs('channels'),docs('channelPrices'),docs('optionGroups'),docs('orderItems'),db.collection('settings').doc('features').get(),db.collection('settings').doc('loyalty').get()]); const categoryRows=effectiveFirebaseCategories(categories).map(x=>({category_key:x.id,...x}));const channelRows=effectiveFirebaseChannels(channels).map(x=>({channel_key:x.id,...x}));const features=Object.fromEntries(Object.entries(settings.data()||defaults.features).filter(([key])=>Object.hasOwn(defaults.features,key)));const activeIds=new Set(products.filter(x=>x.active!==false).map(x=>String(x.id))),sellerTotals={};orderItems.forEach(item=>{const id=String(item.product_id??'');if(activeIds.has(id))sellerTotals[id]=(sellerTotals[id]||0)+Number(item.quantity||0);});const bestSellers=Object.entries(sellerTotals).map(([product_id,qty])=>({product_id,qty})).sort((a,b)=>b.qty-a.qty||String(a.product_id).localeCompare(String(b.product_id))).slice(0,10),rawLoyalty=loyalty.data()||{},loyaltySettings={mode:['all','category','product'].includes(rawLoyalty.mode)?rawLoyalty.mode:'category',categoryKeys:Array.isArray(rawLoyalty.categoryKeys)?rawLoyalty.categoryKeys.map(String):['coffee','tea'],productIds:Array.isArray(rawLoyalty.productIds)?rawLoyalty.productIds.map(String):[]};return {products:sortBySavedOrder(products.filter(x=>x.active!==false)).map(x=>({id:Number(x.id)||x.id,...localized(x)})),inventory:inventory.map(x=>({stock_key:x.id,...localized(x)})),categories:categoryRows,channels:channelRows,channelPrices,optionGroups:sortBySavedOrder(optionGroups),bestSellers,loyaltySettings,features,membersEnabled:true}; }
    if(path==='recipes' && method==='GET') { const [products,items,recipes,inventory]=await Promise.all([docs('products'),docs('recipeItems'),docs('recipes'),docs('inventory')]); const inv=Object.fromEntries(inventory.map(x=>[x.id,localized(x)])); const recipeMap=Object.fromEntries(recipes.map(x=>[x.id,x])); return products.filter(x=>x.active!==false).map(p=>({id:p.id,name:localized(p).name,emoji:p.emoji,description:recipeMap[p.id]?.description||'',items:items.filter(x=>x.product_id==p.id).map(x=>({stock_key:x.stock_key,quantity:x.quantity,name:inv[x.stock_key]?.name||x.stock_key,unit:inv[x.stock_key]?.unit||''}))})); }
    if(path==='reports/today' && method==='GET') { const orders=await docs('orders');const thaiDay=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));const day=thaiDay(Date.now());const today=orders.filter(x=>x.createdAt&&thaiDay(x.createdAt)===day),store=today.filter(x=>(x.salesChannel||'store')!=='online'),online=today.filter(x=>x.salesChannel==='online');return {orders:store.length,sales:store.reduce((n,x)=>n+Number(x.total||0),0),storeOrders:store.length,storeSales:store.reduce((n,x)=>n+Number(x.total||0),0),onlineOrders:online.length,onlineSales:online.reduce((n,x)=>n+Number(x.total||0),0),onlineNet:online.reduce((n,x)=>n+Number(x.onlineNet??(Number(x.total||0)*(1-Number(x.gpPercent||0)/100))),0)}; }
    if(path==='reports/transactions' && method==='GET') { const [orders,items,products]=await Promise.all([docs('orders'),docs('orderItems'),docs('products')]),filters=firebaseReportFilters(query),byId=Object.fromEntries(products.map(p=>[String(p.id),p]));const itemMatches=x=>(!filters.productId||String(x.product_id)===filters.productId)&&(!filters.category||(byId[String(x.product_id)]?.category||'other')===filters.category);const eligible=orders.filter(o=>firebaseOrderMatches(o,filters)&&(!filters.productId&&!filters.category||items.some(x=>x.order_id===o.id&&itemMatches(x))));return eligible.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,200).map(o=>({id:o.id,created_at:o.createdAt||o.created_at,subtotal:Number(o.subtotal||0),discount:Number(o.discount||0),total:Number(o.total||0),payment_type:o.paymentType||o.payment_type||'cash',sales_channel:o.salesChannel||o.sales_channel||'store',online_platform:o.onlinePlatform||null,gp_percent:Number(o.gpPercent||0),online_net:Number(o.onlineNet??o.total??0),member_phone:o.memberPhone||null,received:Number(o.received||0),change_due:Number(o.changeDue||0),items:items.filter(x=>x.order_id===o.id).map(x=>({name:x.name,product_id:x.product_id||null,unit_price:Number(x.unit_price||0),quantity:Number(x.quantity||0),options_json:x.options_json||'{}'}))})); }
    if(path==='reports/analytics' && method==='GET') { const [orders,items,products]=await Promise.all([docs('orders'),docs('orderItems'),docs('products')]),filters=firebaseReportFilters(query),byId=Object.fromEntries(products.map(p=>[String(p.id),p])),baseOrders=orders.filter(o=>firebaseOrderMatches(o,filters)),orderIds=new Set(baseOrders.map(o=>o.id));const filteredItems=items.filter(x=>orderIds.has(x.order_id)&&(!filters.productId||String(x.product_id)===filters.productId)&&(!filters.category||(byId[String(x.product_id)]?.category||'other')===filters.category)),matchingOrders=new Set(filteredItems.map(x=>x.order_id)),eligibleOrders=baseOrders.filter(o=>!filters.productId&&!filters.category||matchingOrders.has(o.id)),categoryMap={},sellerMap={},paymentMap={},addonMap={},itemSalesByOrder={};filteredItems.forEach(x=>{const quantity=Number(x.quantity||0),revenue=Number(x.unit_price||0)*quantity,product=byId[String(x.product_id)],category=product?.category||'other',key=String(x.product_id||x.name);itemSalesByOrder[x.order_id]=(itemSalesByOrder[x.order_id]||0)+revenue;categoryMap[category]=(categoryMap[category]||0)+revenue;const seller=sellerMap[key]||{product_id:x.product_id||null,name:x.name,qty:0,revenue:0};seller.qty+=quantity;seller.revenue+=revenue;sellerMap[key]=seller;firebaseOptionDetails(x.options_json).forEach(detail=>{const addon=addonMap[detail.name]||{name:detail.name,qty:0,revenue:0};addon.qty+=quantity;addon.revenue+=detail.price*quantity;addonMap[detail.name]=addon;});});const lineFiltered=!!(filters.productId||filters.category),breakdown={storeCash:0,storeQr:0,onlineGross:0,onlineNet:0};eligibleOrders.forEach(o=>{const key=o.paymentType||o.payment_type||'cash',amount=lineFiltered?Number(itemSalesByOrder[o.id]||0):Number(o.total||0),channel=o.salesChannel||o.sales_channel||'store';paymentMap[key]=(paymentMap[key]||0)+amount;if(channel==='online'){breakdown.onlineGross+=amount;breakdown.onlineNet+=lineFiltered?amount*(1-Number(o.gpPercent||0)/100):Number(o.onlineNet??o.total??0);}else if(key==='cash')breakdown.storeCash+=amount;else breakdown.storeQr+=amount;});const rows=Object.values(sellerMap),topByQuantity=[...rows].sort((a,b)=>b.qty-a.qty||b.revenue-a.revenue).slice(0,10),topByRevenue=[...rows].sort((a,b)=>b.revenue-a.revenue||b.qty-a.qty).slice(0,10),totalSales=Object.values(paymentMap).reduce((sum,value)=>sum+value,0);return {summary:{totalSales,totalOrders:eligibleOrders.length,averageBill:eligibleOrders.length?totalSales/eligibleOrders.length:0},categorySales:Object.entries(categoryMap).map(([category,sales])=>({category,sales})),paymentSales:Object.entries(paymentMap).map(([payment_type,sales])=>({payment_type,sales})),breakdown,topSellers:topByQuantity,topByQuantity,topByRevenue,topAddons:Object.values(addonMap).sort((a,b)=>b.qty-a.qty||b.revenue-a.revenue).slice(0,10)}; }
    if(path==='kds' && method==='GET') { const thaiDay=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));const day=thaiDay(Date.now());return (await docs('orderItems')).filter(x=>x.created_at&&thaiDay(x.created_at)===day).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,100); }
    if(path.startsWith('kds/items/') && path.endsWith('/status') && method==='PUT') { if(!['pending','cooking','completed'].includes(data.status))return err('สถานะคิวไม่ถูกต้อง');await db.collection('orderItems').doc(path.split('/')[2]).update({status:data.status});return {ok:true}; }
    if(path==='kds/completed' && method==='DELETE') { const completed=(await db.collection('orderItems').where('status','==','completed').get()).docs; const batch=db.batch(); completed.forEach(d=>batch.delete(d.ref));await batch.commit();return {ok:true,cleared:completed.length}; }
    if(path.startsWith('members/') && method==='GET') { const d=await db.collection('members').doc(path.split('/')[1]).get();if(!d.exists)return err('ไม่พบสมาชิก',404);return {phone:d.id,...d.data()}; }
    if(path==='members' && method==='POST') { const phone=String(data.phone||'').replace(/\D/g,''),name=String(data.name||'').trim();if(phone.length<9||!name)return err('กรอกชื่อและเบอร์โทรให้ถูกต้อง');const ref=db.collection('members').doc(phone),snap=await ref.get();await ref.set(snap.exists?{name}:{name,points:0},{merge:true});return {ok:true}; }
    if(path==='orders' && method==='POST') {
      const salesChannel=data.salesChannel==='online'?'online':'store';
      const paymentType=salesChannel==='online'?'online':data.paymentType;
      if(!Array.isArray(data.items)||!data.items.length||(salesChannel==='store'&&!['cash','qr'].includes(paymentType)))return err('ข้อมูลการชำระเงินไม่ถูกต้อง');
      const [allProducts,recipeItems,channels,channelPrices]=await Promise.all([docs('products'),docs('recipeItems'),docs('channels'),docs('channelPrices')]);
      const products=Object.fromEntries(allProducts.map(p=>[String(p.id),p]));
      const channel=salesChannel==='online'?channels.find(item=>item.id===String(data.onlinePlatform||'')&&item.active!==false):null;
      if(salesChannel==='online'&&(!channel||Number(channel.gp_percent)<=0||Number(channel.gp_percent)>=100))return err('กรุณาตั้งค่า GP จริงของแพลตฟอร์ม');
      const onlinePlatform=channel?.id||null,gpPercent=channel?Number(channel.gp_percent):0;
      const lines=(data.items||[]).map(i=>{
        const p=products[String(i.productId)];
        const quantity=Number(i.quantity);
        if(!p||p.active===false||!Number.isInteger(quantity)||quantity<1||quantity>99)return err('รายการสินค้าไม่ถูกต้อง');
        const groups=Array.isArray(p.custom_options)?p.custom_options:[];
        const custom={},custom_labels=[],custom_details=[];let customExtra=0;
        groups.forEach(group=>{
          const choices=Array.isArray(group.choices)?group.choices:[];
          const selected=choices.find(choice=>String(choice.id)===String(i.options?.custom?.[group.id]));
          if(selected){const price=Math.max(0,Number(salesChannel==='online'?(selected.online_price??selected.price):selected.price)||0);custom[group.id]=selected.id;custom_labels.push(`${group.name}: ${selected.label}`);custom_details.push({group:String(group.name||''),label:String(selected.label||''),price});customExtra+=price;}
        });
        const o={custom,custom_labels,custom_details};
        const saved=channelPrices.find(row=>String(row.product_id)===String(p.id)&&row.channel_key===onlinePlatform);
        return {product:p,quantity,options:o,unit_price:Number(saved?.sale_price??p.price)+customExtra};
      });
      const stockLines=lines.filter(line=>line.product.deduct_stock===true||Number(line.product.deduct_stock)===1);
      const missing=stockLines.find(line=>!recipeItems.some(r=>String(r.product_id)===String(line.product.id)));
      if(missing)return err(`เมนู ${localized(missing.product).name} ยังไม่มีสูตรชง หรือเลือก “ไม่ตัด stock” ในหน้าจัดการเมนู`);
      const used={};
      stockLines.forEach(line=>recipeItems.filter(r=>String(r.product_id)===String(line.product.id)).forEach(r=>used[r.stock_key]=(used[r.stock_key]||0)+Number(r.quantity)*line.quantity));
      const beverageCups=lines.filter(line=>['coffee','tea'].includes(line.product.category)).reduce((sum,line)=>sum+line.quantity,0);
      if(data.redeemFreeCup&&beverageCups<1)return err('ต้องมีเครื่องดื่มอย่างน้อย 1 แก้วเพื่อใช้สิทธิ์');
      const rewardDiscount=data.redeemFreeCup?Math.min(...lines.filter(line=>['coffee','tea'].includes(line.product.category)).map(line=>line.unit_price)):0;
      const requestedDiscount=Number(data.manualDiscount??data.discount??0);
      if(!Number.isFinite(requestedDiscount)||requestedDiscount<0)return err('ส่วนลดไม่ถูกต้อง');
      const effectiveManual=data.manualDiscount==null&&data.redeemFreeCup?Math.max(0,requestedDiscount-rewardDiscount):requestedDiscount;
      const subtotal=lines.reduce((n,x)=>n+x.quantity*x.unit_price,0),discount=Math.min(effectiveManual+rewardDiscount,subtotal),total=subtotal-discount,id=uid(),createdAt=new Date().toISOString(),onlineNet=salesChannel==='online'?Number((total*(1-gpPercent/100)).toFixed(2)):total;
      const received=paymentType==='cash'?Number(data.received):total;
      if(!Number.isFinite(received)||received<total)return err('ยอดเงินที่รับไม่เพียงพอ');
      const changeDue=paymentType==='cash'?Number((received-total).toFixed(2)):0;
      let memberPoints=0,pointsEarned=0;
      await db.runTransaction(async tx=>{
        const [inventoryReads,loyaltySnap]=await Promise.all([Promise.all(Object.entries(used).map(async([key,amount])=>{const ref=db.collection('inventory').doc(key),snap=await tx.get(ref);return {key,amount,ref,snap};})),tx.get(db.collection('settings').doc('loyalty'))]);
        const memberRef=data.memberPhone?db.collection('members').doc(String(data.memberPhone)):null;
        const memberSnap=memberRef?await tx.get(memberRef):null;
        inventoryReads.forEach(({key,amount,snap})=>{if(!snap.exists||Number(snap.data().quantity||0)<amount)err(`สต็อกไม่พอ: ${snap.data()?.name||key}`);});
        if(data.redeemFreeCup&&(!memberSnap?.exists||Number(memberSnap.data().points||0)<10))err('คะแนนสะสมไม่เพียงพอสำหรับแลกฟรี');
        inventoryReads.forEach(({amount,ref,snap})=>tx.update(ref,{quantity:Number(snap.data().quantity)-amount}));
        tx.set(db.collection('orders').doc(id),{id,subtotal,discount,total,paymentType,salesChannel,onlinePlatform,gpPercent,onlineNet,memberPhone:data.memberPhone||null,received,changeDue,createdAt});
        lines.forEach(x=>tx.set(db.collection('orderItems').doc(),{order_id:id,product_id:String(x.product.id),name:localized(x.product).name,quantity:x.quantity,unit_price:x.unit_price,options_json:JSON.stringify(x.options),status:'pending',created_at:createdAt,createdAt}));
        if(memberSnap?.exists){const loyalty=loyaltySnap.data()||{mode:'category',categoryKeys:['coffee','tea']},eligible=line=>loyalty.mode==='all'||(loyalty.mode==='category'&&(loyalty.categoryKeys||[]).map(String).includes(String(line.product.category)))||(loyalty.mode==='product'&&(loyalty.productIds||[]).map(String).includes(String(line.product.id))),earnedBefore=lines.filter(eligible).reduce((sum,line)=>sum+line.quantity,0),rewardLine=lines.filter(line=>['coffee','tea'].includes(line.product.category)).sort((a,b)=>a.unit_price-b.unit_price)[0],redeemedEligible=data.redeemFreeCup&&rewardLine&&eligible(rewardLine)?1:0,oldPoints=Number(memberSnap.data().points||0),earned=Math.max(0,earnedBefore-redeemedEligible);pointsEarned=earned;memberPoints=oldPoints-(data.redeemFreeCup?10:0)+earned;tx.update(memberRef,{points:memberPoints});}
      });
      return {id,subtotal,discount,total,paymentType,salesChannel,onlinePlatform,gpPercent,onlineNet,memberPhone:data.memberPhone,memberPoints,pointsEarned,received,changeDue,createdAt,items:lines.map(x=>({name:localized(x.product).name,quantity:x.quantity,unit_price:x.unit_price,options:x.options}))};
    }
    if(path==='admin/settings' && method==='GET') { const s=await db.collection('settings').doc('features').get();return {features:Object.entries(s.data()||defaults.features).filter(([key])=>Object.hasOwn(defaults.features,key)).map(([feature_key,enabled])=>({feature_key,enabled:!!enabled}))}; }
    if(path==='admin/loyalty-settings' && method==='PUT') { const mode=['all','category','product'].includes(data.mode)?data.mode:'all',categoryKeys=[...new Set((Array.isArray(data.categoryKeys)?data.categoryKeys:[]).map(String))],productIds=[...new Set((Array.isArray(data.productIds)?data.productIds:[]).map(String))];if(mode==='category'&&!categoryKeys.length)return err('เลือกหมวดหมู่ที่ให้แต้มอย่างน้อย 1 หมวด');if(mode==='product'&&!productIds.length)return err('เลือกเมนูที่ให้แต้มอย่างน้อย 1 รายการ');await db.collection('settings').doc('loyalty').set({mode,categoryKeys,productIds},{merge:false});return {ok:true,loyaltySettings:{mode,categoryKeys,productIds}}; }
    if(path.startsWith('admin/settings/') && method==='PUT') { await db.collection('settings').doc('features').set({[path.split('/')[2]]:!!data.enabled},{merge:true});return {ok:true}; }
    if(path==='admin/products' && method==='GET') return sortBySavedOrder(await docs('products')).map(x=>({id:x.id,...localized(x)}));
    if(path==='admin/products/order' && method==='PUT') { const ids=Array.isArray(data.ids)?data.ids.map(String):[],products=await docs('products'),existing=products.map(x=>String(x.id));if(ids.length!==existing.length||new Set(ids).size!==ids.length||existing.some(id=>!ids.includes(id)))return err('ลำดับเมนูไม่ถูกต้อง');const batch=db.batch();ids.forEach((id,index)=>batch.set(db.collection('products').doc(id),{sort_order:index},{merge:true}));await batch.commit();return {ok:true}; }
    if(path==='admin/option-groups' && method==='POST') { const id=String(data.id||Date.now()),groups=await docs('optionGroups'),nextOrder=groups.reduce((max,item)=>Math.max(max,Number(item.sort_order)||0),-1)+1;const group={id,name:String(data.name||'').trim(),choices:Array.isArray(data.choices)?data.choices:[],sort_order:nextOrder};if(!group.name||!group.choices.length)return err('ข้อมูลตัวเลือกไม่ถูกต้อง');await db.collection('optionGroups').doc(id).set(group);return group; }
    if(path==='admin/option-groups/order' && method==='PUT') { const ids=Array.isArray(data.ids)?data.ids.map(String):[],groups=(await docs('optionGroups')).filter(x=>x.active!==false),existing=groups.map(x=>String(x.id));if(ids.length!==existing.length||new Set(ids).size!==ids.length||existing.some(id=>!ids.includes(id)))return err('ลำดับกลุ่มตัวเลือกไม่ถูกต้อง');const products=await docs('products'),positions=new Map(ids.map((id,index)=>[id,index])),batch=db.batch();ids.forEach((id,index)=>batch.set(db.collection('optionGroups').doc(id),{sort_order:index},{merge:true}));products.forEach(product=>{const custom=Array.isArray(product.custom_options)?[...product.custom_options]:[];if(!custom.length)return;custom.sort((a,b)=>(positions.get(String(a.id))??Number.MAX_SAFE_INTEGER)-(positions.get(String(b.id))??Number.MAX_SAFE_INTEGER));batch.set(db.collection('products').doc(String(product.id)),{custom_options:custom},{merge:true});});await batch.commit();return {ok:true}; }
    if(path.match(/^admin\/option-groups\/[^/]+$/) && method==='PUT') { const id=decodeURIComponent(path.split('/')[2]),group={id,name:String(data.name||'').trim(),choices:Array.isArray(data.choices)?data.choices:[]};if(!group.name||!group.choices.length)return err('ข้อมูลตัวเลือกไม่ถูกต้อง');await db.collection('optionGroups').doc(id).set(group,{merge:true});const saved=await db.collection('optionGroups').doc(id).get(),replacement={...group,sort_order:Number(saved.data()?.sort_order)||0};await syncFirebaseOptionGroup(id,replacement);return replacement; }
    if(path.match(/^admin\/option-groups\/[^/]+$/) && method==='DELETE') { const id=decodeURIComponent(path.split('/')[2]);await db.collection('optionGroups').doc(id).delete();await syncFirebaseOptionGroup(id);return {ok:true}; }
    if(path==='admin/products' && method==='POST') { const name=String(data.name||'').trim(),price=Number(data.price);if(!name||!Number.isFinite(price)||price<0)return err('ข้อมูลเมนูไม่ถูกต้อง');const id=`prod_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`,products=await docs('products'),sortOrder=products.reduce((max,item)=>Math.max(max,Number(item.sort_order)||0),-1)+1;await db.collection('products').doc(id).set({id,name,price,category:data.category||'other',emoji:data.emoji||'☕',image_path:data.imagePath||null,image_data:data.imageData||null,custom_options:Array.isArray(data.customOptions)?data.customOptions:[],deduct_stock:data.deductStock!==false,active:true,target_margin:.65,sort_order:sortOrder});return {id}; }
    if(path.match(/^admin\/products\/[^/]+$/) && method==='PUT') { const id=path.split('/')[2],name=String(data.name||'').trim(),price=Number(data.price);if(!name||!Number.isFinite(price)||price<0)return err('ข้อมูลเมนูไม่ถูกต้อง');await db.collection('products').doc(id).set({name,price,category:data.category||'other',emoji:data.emoji||'☕',image_path:data.imagePath||null,image_data:data.imageData||null,custom_options:Array.isArray(data.customOptions)?data.customOptions:[],deduct_stock:data.deductStock!==false,active:!!data.active},{merge:true});return {ok:true}; }
    if(path.match(/^admin\/products\/[^/]+$/) && method==='DELETE') { const id=path.split('/')[2],[recipeItems,prices]=await Promise.all([docs('recipeItems'),docs('channelPrices')]),batch=db.batch();batch.delete(db.collection('products').doc(id));batch.delete(db.collection('recipes').doc(id));recipeItems.filter(x=>String(x.product_id)===id).forEach(x=>batch.delete(db.collection('recipeItems').doc(x.id)));prices.filter(x=>String(x.product_id)===id).forEach(x=>batch.delete(db.collection('channelPrices').doc(x.id)));await batch.commit();return {ok:true}; }
    if(path.match(/^admin\/products\/[^/]+\/costing$/) && method==='PUT') { const price=Number(data.price),margin=Number(data.targetMargin);if(!Number.isFinite(price)||price<0||!Number.isFinite(margin)||margin<0||margin>=1)return err('ราคาหรือเป้ากำไรไม่ถูกต้อง');await db.collection('products').doc(path.split('/')[2]).set({price,target_margin:margin},{merge:true});return {ok:true}; }
    if(path.match(/^admin\/products\/[^/]+\/recipe$/) && method==='GET') { const id=path.split('/')[2], [r,all,inventory]=await Promise.all([db.collection('recipes').doc(id).get(),docs('recipeItems'),docs('inventory')]);const inv=Object.fromEntries(inventory.map(x=>[x.id,x]));return {description:r.data()?.description||'',items:all.filter(x=>String(x.product_id)===id).map(x=>({stock_key:x.stock_key,quantity:x.quantity,name:inv[x.stock_key]?.name||x.stock_key,unit:inv[x.stock_key]?.unit||'',cost_per_unit:inv[x.stock_key]?.cost_per_unit||0}))}; }
    if(path.match(/^admin\/products\/[^/]+\/recipe$/) && method==='PUT') { const id=path.split('/')[2],items=Array.isArray(data.items)?data.items:[];if(items.some(x=>!x.stock_key||!Number.isFinite(Number(x.quantity))||Number(x.quantity)<=0))return err('ข้อมูลสูตรไม่ถูกต้อง');const old=(await docs('recipeItems')).filter(x=>String(x.product_id)===id),batch=db.batch();old.forEach(x=>batch.delete(db.collection('recipeItems').doc(x.id)));items.forEach((x,n)=>batch.set(db.collection('recipeItems').doc(`${id}_${x.stock_key}_${n}`),{product_id:id,stock_key:x.stock_key,quantity:Number(x.quantity)}));batch.set(db.collection('recipes').doc(id),{description:String(data.description||'').slice(0,2000)},{merge:true});await batch.commit();return {ok:true}; }
    if(path==='costing' && method==='GET') { const [products,items,inventory,channels]=await Promise.all([docs('products'),docs('recipeItems'),docs('inventory'),docs('channels')]);const effectiveChannels=effectiveFirebaseChannels(channels);const inv=Object.fromEntries(inventory.map(x=>[x.id,localized(x)]));return products.filter(x=>x.active!==false).map(p=>{const ingredients=items.filter(x=>String(x.product_id)===String(p.id)).map(x=>({...x,name:inv[x.stock_key]?.name||x.stock_key,unit:inv[x.stock_key]?.unit||'',cost_per_unit:Number(inv[x.stock_key]?.cost_per_unit||0),line_cost:Number((Number(x.quantity)*Number(inv[x.stock_key]?.cost_per_unit||0)).toFixed(2))}));const cost=ingredients.reduce((n,x)=>n+x.line_cost,0),target_margin=Number(p.target_margin??.65),recommended_store_price=cost/(1-target_margin);return {product_id:p.id,name:localized(p).name,store_price:Number(p.price),target_margin,cost,food_cost_percent:p.price?Number((cost/p.price*100).toFixed(1)):0,gross_profit:Number(p.price)-cost,recommended_store_price,ingredients,online:effectiveChannels.map(c=>({channel_key:c.id,name:c.name,gp_percent:c.gp_percent,suggested_price:recommended_store_price/(1-Number(c.gp_percent)/100)}))};}); }
    if(path==='pricing' && method==='GET') { const [products,channels,prices]=await Promise.all([docs('products'),docs('channels'),docs('channelPrices')]);const effectiveChannels=effectiveFirebaseChannels(channels);return products.filter(p=>p.active!==false).flatMap(p=>effectiveChannels.map(c=>{const saved=prices.find(x=>String(x.product_id)===String(p.id)&&x.channel_key===c.id);return {product_id:p.id,name:localized(p).name,store_price:Number(p.price),channel_key:c.id,channel_name:c.name,gp_percent:Number(c.gp_percent),sale_price:saved?.sale_price??null,suggested_price:Number((Number(p.price)/(1-Number(c.gp_percent)/100)).toFixed(2))};})); }
    if(path==='admin/recipe-groups' && method==='GET') return (await docs('recipeGroups')).map(x=>({id:x.id,name:x.name,items:x.items||[]})).sort((a,b)=>a.name.localeCompare(b.name));
    if(path==='admin/recipe-groups' && method==='POST') { const name=String(data.name||'').trim(),items=Array.isArray(data.items)?data.items.filter(x=>x.stock_key&&Number(x.quantity)>0):[];if(!name||!items.length)return err('ข้อมูลกลุ่มไม่ถูกต้อง');const ref=db.collection('recipeGroups').doc();await ref.set({name,items,createdAt:new Date().toISOString()});return {id:ref.id}; }
    if(path.match(/^admin\/recipe-groups\/[^/]+$/) && method==='DELETE') { await db.collection('recipeGroups').doc(path.split('/')[2]).delete();return {ok:true}; }
    if(path==='admin/cost-inventory/batch' && method==='POST') { const items=Array.isArray(data.items)?data.items:[],batch=db.batch();let added=0,existing=0;for(const raw of items){const key=String(raw.stockKey||'').trim();if(!key||!raw.name||!raw.unit)continue;const ref=db.collection('inventory').doc(key);if((await ref.get()).exists){existing++;continue;}const purchaseQuantity=Math.max(.01,Number(raw.purchaseQuantity)||1),purchaseTotal=Math.max(0,Number(raw.purchaseTotal)||0);batch.set(ref,{name:raw.name,unit:raw.unit,quantity:Math.max(0,Number(raw.quantity)||0),low_alert:Math.max(0,Number(raw.lowAlert)||0),category:raw.category==='equipment'?'equipment':'ingredient',purchase_quantity:purchaseQuantity,purchase_total:purchaseTotal,cost_per_unit:purchaseTotal/purchaseQuantity});added++;}if(added)await batch.commit();return {ok:true,added,existing}; }
    if(path==='admin/cost-inventory' && method==='POST') { const key=String(data.stockKey||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'');if(!key||!data.name||!data.unit)return err('กรอกข้อมูลวัตถุดิบให้ครบ');const purchaseQuantity=Number(data.purchaseQuantity),purchaseTotal=Number(data.purchaseTotal);if(!Number.isFinite(purchaseQuantity)||purchaseQuantity<=0||!Number.isFinite(purchaseTotal)||purchaseTotal<0)return err('ข้อมูลราคาซื้อไม่ถูกต้อง');const ref=db.collection('inventory').doc(key);if((await ref.get()).exists)return err('รหัสสต็อกซ้ำ',409);await ref.set({name:data.name,unit:data.unit,quantity:Math.max(0,Number(data.quantity)||0),low_alert:Math.max(0,Number(data.lowAlert)||0),category:data.category==='equipment'?'equipment':'ingredient',material_type:data.materialType||'other',purchase_quantity:purchaseQuantity,purchase_total:purchaseTotal,cost_per_unit:purchaseTotal/purchaseQuantity});return {ok:true}; }
    if(path.match(/^admin\/cost-inventory\/[^/]+$/) && method==='PUT') { const key=path.split('/')[2],name=String(data.name||'').trim(),unit=String(data.unit||'').trim(),quantity=Number(data.quantity),lowAlert=Number(data.lowAlert),purchaseQuantity=Number(data.purchaseQuantity),purchaseTotal=Number(data.purchaseTotal);if(!name||!unit||![quantity,lowAlert,purchaseQuantity,purchaseTotal].every(Number.isFinite)||quantity<0||lowAlert<0||purchaseQuantity<=0||purchaseTotal<0)return err('ข้อมูลวัตถุดิบหรือราคาซื้อไม่ถูกต้อง');await db.collection('inventory').doc(key).set({name,unit,quantity,low_alert:lowAlert,category:data.category==='equipment'?'equipment':'ingredient',material_type:data.materialType||'other',purchase_quantity:purchaseQuantity,purchase_total:purchaseTotal,cost_per_unit:purchaseTotal/purchaseQuantity},{merge:true});return {ok:true}; }
    if(path.match(/^admin\/inventory\/[^/]+\/adjust$/) && method==='POST') { const ref=db.collection('inventory').doc(path.split('/')[2]),amount=Number(data.amount);if(!Number.isFinite(amount)||amount===0)return err('จำนวนปรับสต็อกไม่ถูกต้อง');await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(!snap.exists||Number(snap.data().quantity||0)+amount<0)err('สต็อกไม่พอหรือไม่พบรายการ');tx.update(ref,{quantity:Number(snap.data().quantity||0)+amount});});return {ok:true}; }
    if(path.match(/^admin\/inventory\/[^/]+$/) && method==='DELETE') { const key=path.split('/')[2],used=(await docs('recipeItems')).some(x=>x.stock_key===key);if(used)return err('ลบไม่ได้ เพราะวัตถุดิบยังถูกใช้อยู่ในสูตรชง',409);await db.collection('inventory').doc(key).delete();return {ok:true}; }
    if(path==='admin/members' && method==='GET') return (await docs('members')).map(x=>({phone:x.id,...x})).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
    if(path.match(/^admin\/members\/[^/]+$/) && method==='PUT') { const name=String(data.name||'').trim(),points=Number(data.points);if(!name||!Number.isInteger(points)||points<0)return err('ข้อมูลสมาชิกไม่ถูกต้อง');await db.collection('members').doc(path.split('/')[2]).set({name,points},{merge:true});return {ok:true}; }
    if(path.match(/^admin\/members\/[^/]+$/) && method==='DELETE') { await db.collection('members').doc(path.split('/')[2]).delete();return {ok:true}; }
    if(path==='admin/categories' && method==='POST') { const key=String(data.key||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,''),name=String(data.name||'').trim();if(!key||!name)return err('กรอกหมวดหมู่ให้ครบ');if((await db.collection('categories').doc(key).get()).exists)return err('รหัสหมวดหมู่ซ้ำ',409);const categories=await docs('categories'),nextOrder=categories.reduce((max,item)=>Math.max(max,Number(item.sort_order)||0),-1)+1;await db.collection('categories').doc(key).set({name,active:true,sort_order:nextOrder});return {ok:true}; }
    if(path==='admin/categories/order' && method==='PUT') { const ids=Array.isArray(data.ids)?data.ids.map(String):[],categories=(await docs('categories')).filter(x=>x.active!==false),existing=categories.map(x=>String(x.id));if(ids.length!==existing.length||new Set(ids).size!==ids.length||existing.some(id=>!ids.includes(id)))return err('ลำดับหมวดหมู่ไม่ถูกต้อง');const batch=db.batch();ids.forEach((id,index)=>batch.set(db.collection('categories').doc(id),{sort_order:index},{merge:true}));await batch.commit();return {ok:true}; }
    if(path.match(/^admin\/categories\/[^/]+$/) && method==='PUT') { const name=String(data.name||'').trim();if(!name)return err('กรอกชื่อหมวดหมู่');await db.collection('categories').doc(path.split('/')[2]).set({name},{merge:true});return {ok:true}; }
    if(path.match(/^admin\/categories\/[^/]+$/) && method==='DELETE') { const key=path.split('/')[2],used=(await docs('products')).some(x=>x.category===key);if(used)return err('ลบไม่ได้ เพราะยังมีสินค้าในหมวดนี้',409);await db.collection('categories').doc(key).delete();return {ok:true}; }
    if(path.match(/^admin\/channels\/[^/]+$/) && method==='PUT') { const gp=Number(data.gpPercent);if(!Number.isFinite(gp)||gp<0||gp>=100)return err('GP ต้องอยู่ระหว่าง 0 ถึงน้อยกว่า 100');await db.collection('channels').doc(path.split('/')[2]).set({gp_percent:gp,active:data.active!==false},{merge:true});return {ok:true}; }
    if(path==='admin/channel-prices' && method==='PUT') { const price=Number(data.salePrice);if(!data.productId||!data.channelKey||!Number.isFinite(price)||price<0)return err('ข้อมูลราคาไม่ถูกต้อง');const id=`${data.productId}_${data.channelKey}`;await db.collection('channelPrices').doc(id).set({product_id:data.productId,channel_key:data.channelKey,sale_price:price},{merge:true});return {ok:true}; }
    return err(`Firebase API ยังไม่รองรับ ${path}`,404);
  };
})();
