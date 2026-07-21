# No.5 Cafe POS

ระบบ POS ร้านกาแฟแบบ full-stack: Express + SQLite + Vanilla JavaScript โดยไม่มี AI หรือ Gemini API Key

## ฟังก์ชัน

- บันทึกการขายและตัดสต็อกแบบ transaction
- เก็บข้อมูลถาวรใน SQLite
- ตั้งค่าเปิด/ปิดโมดูล KDS, สต็อก, สมาชิก, สูตร และรายงานด้วย Admin PIN
- เพิ่มหมวดสินค้าเองได้จากหน้าตั้งค่า
- ตั้งค่า GP และราคาขายออนไลน์รายเมนูสำหรับ LINE MAN, GrabFood และ ShopeeFood โดยระบบเสนอราคาที่ชดเชย GP
- ตรวจสอบราคาสินค้า, จำนวนสินค้า, ส่วนลด และสต็อกที่ backend
- UI ภาษาไทย รองรับมือถือ

## เริ่มใช้งาน

ติดตั้ง Node.js 20+ แล้วรัน (แนะนำ Node.js 22 LTS; Node 24 ใช้ได้กับ dependency เวอร์ชันนี้):

```bash
npm install
copy .env.example .env
npm start
```

เปิด `http://localhost:3000` และเปลี่ยน `ADMIN_PIN` ใน `.env` ก่อนใช้งานจริง

## Deploy

GitHub Pages ใช้ได้เฉพาะ static site จึงไม่เหมาะกับแอปนี้ที่มี backend/SQLite. ให้ push โปรเจกต์นี้ขึ้น GitHub แล้วเชื่อม repository กับ Render, Railway หรือ Fly.io โดยใช้คำสั่ง Build: `npm install` และ Start: `npm start`.

มี `render.yaml` สำหรับเชื่อม GitHub กับ Render ได้ทันที โดย Render จะสร้าง Admin PIN และ persistent disk ให้. สำหรับโดเมนส่วนตัว ให้ตั้ง Custom Domain ที่ผู้ให้บริการ hosting และเพิ่ม DNS record ตามค่าที่ผู้ให้บริการแสดง. ก่อนเปิดใช้งานจริงต้องกำหนด `ADMIN_PIN` ที่รัดกุม และใช้ persistent disk/managed database เพราะ SQLite ต้องมีพื้นที่เก็บข้อมูลถาวร.
