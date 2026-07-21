# No.5 Cafe POS

ระบบขายหน้าร้านร้านกาแฟภาษาไทย รองรับหน้าขาย POS, สูตรชงและต้นทุน, สต็อก, สมาชิก, Kitchen Display, ราคาขายออนไลน์ และ Menu Board สำหรับลูกค้า

## การใช้งานออนไลน์

- POS: `https://songyos909.github.io/no5pos/`
- Menu Board: `https://songyos909.github.io/no5pos/menu-board.html`

GitHub Pages ใช้ Firebase Authentication และ Cloud Firestore เป็นฐานข้อมูลออนไลน์ ผู้ดูแลต้องลงชื่อเข้าใช้บัญชี Firebase ที่ได้รับอนุญาตก่อนใช้งานหรือแก้ไขข้อมูล

## ใช้งานในเครื่อง

ต้องใช้ Node.js 20 ขึ้นไป

```powershell
npm install
Copy-Item .env.example .env
npm start
```

เปิด `http://localhost:3000` และกำหนด `ADMIN_PIN` ใน `.env` ก่อนใช้เมนูหลังบ้าน

## ข้อมูลสต็อก

ระบบใช้หน่วยมาตรฐาน: กรัม, มล., ใบ, ชิ้น, เส้น, อัน, ถุง, ขวด, กล่อง และแพ็ก ทุกเมนูที่เปิดขายต้องมีสูตรชงก่อน ระบบจึงอนุญาตให้บันทึกขายและหักสต็อกได้

SQLite ใน `data/cafe.db` ใช้สำหรับโหมด localhost ส่วน GitHub Pages ใช้ Firestore จึงไม่ซิงก์ระหว่างกันโดยอัตโนมัติ
