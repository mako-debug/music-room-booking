# 新米蘭音樂教室 — 琴房預約系統

手機掃 QR Code 即可查看及預約琴房，專為音樂教室設計的輕量預約系統。

**線上版本：** https://music-room-booking-tau.vercel.app

## 功能概覽

- 7 間琴房的日曆檢視（日檢視 / 週檢視切換）
- 預約功能：點格子 → 選時長 → 填學生姓名 → 確認
- 每週重複排課（2~4 週一次建立）
- 取消預約（單次 / 整組重複）
- 修改預約（學生姓名、用途）
- 帳號管理（新增、修改、停用、重設密碼、改 Email）
- 老師自動分配色系（管理員可自訂，15 色）
- 管理員可代其他老師預約
- 所有使用者可自行修改姓名和密碼
- 帳號停用/啟用（停用後無法登入，課表保留）
- 語音輸入（學生姓名、用途欄位支援 🎤 語音辨識）
- 週檢視今日欄位藍色醒目標示
- 日曆表頭暖色底色，活潑字體標題
- 登出、取消預約皆有二次確認
- QR Code 入口，手機 RWD 優先設計

## 角色權限

| 功能 | 管理員 | 老師 | 學生 |
|------|:------:|:----:|:----:|
| 查看日曆 | O | O | O |
| 新增預約 | O | O | X |
| 代他人預約 | O | X | X |
| 取消自己的預約 | O | O | X |
| 取消任何人的預約 | O | X | X |
| 修改預約（學生/用途） | O | 自己的 | X |
| 帳號管理 | O | X | X |
| 停用/啟用帳號 | O | X | X |
| 重設他人密碼 | O | X | X |
| 修改自己姓名 | O | O | O |
| 修改自己密碼 | O | O | O |
| 修改他人 Email | O | X | X |
| 停用/啟用帳號 | O | X | X |
| 語音輸入預約欄位 | O | O | X |

## 技術架構

```
使用者（手機/電腦）掃 QR Code
        |
Next.js 15 App (Vercel)
  ├── /login                    登入頁
  ├── /                         日曆檢視 + 預約
  ├── /admin                    帳號管理（管理員）
  └── /api/admin/update-user    Admin SDK API（密碼重設/Email 修改/帳號停用）
        |
Firebase
  ├── Auth（Email/Password 認證）
  ├── Firestore（預約 + 使用者 + 教室資料）
  └── Admin SDK（伺服器端帳號管理）

Web Speech API（瀏覽器端語音辨識，中文）
```

| 技術 | 版本 |
|------|------|
| Next.js (App Router) | 15.x |
| TypeScript | 5.x |
| Tailwind CSS | 4.x |
| Firebase Auth + Firestore | 11.x |
| Firebase Admin SDK | 13.x |
| Vercel | Hobby (Free) |

## 本機開發

### 前置需求

- Node.js 18+
- Firebase 專案（Auth + Firestore 已啟用）

### 安裝

```bash
git clone https://github.com/mako-debug/music-room-booking.git
cd music-room-booking
npm install
```

### 環境變數

複製 `.env.example` 為 `.env.local`，填入 Firebase 設定：

```bash
cp .env.example .env.local
```

需要的值：

| 變數 | 來源 |
|------|------|
| `NEXT_PUBLIC_FIREBASE_*` | Firebase Console → 專案設定 → Web App |
| `FIREBASE_ADMIN_*` | Firebase Console → 專案設定 → 服務帳戶 → 產生私密金鑰 |

### 啟動

```bash
npm run dev
```

開啟 http://localhost:3000

## Firestore 資料結構

### `users` — 使用者

| 欄位 | 類型 | 說明 |
|------|------|------|
| uid | string | Firebase Auth UID |
| email | string | 登入 Email |
| displayName | string | 顯示姓名 |
| role | string | `admin` / `teacher` / `student` |
| colorIndex | number | 色系索引（0~14） |
| active | boolean | 帳號啟用狀態 |
| createdAt | string | 建立時間 |

### `rooms` — 教室

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | string | room-1 ~ room-7 |
| name | string | 1號教室 ~ 7號教室 |
| order | number | 排序 |

### `bookings` — 預約

| 欄位 | 類型 | 說明 |
|------|------|------|
| roomId | string | 教室 ID |
| date | string | 日期 YYYY-MM-DD |
| startTime | string | 開始時間 HH:mm |
| endTime | string | 結束時間 HH:mm |
| userId | string | 預約者 UID |
| userName | string | 預約者姓名 |
| studentName | string | 學生姓名 |
| purpose | string | 用途（選填） |
| repeatGroupId | string | 重複排課群組 ID（選填） |
| createdAt | string | 建立時間 |

### Firestore 複合索引

| Fields | 用途 |
|--------|------|
| `roomId` ASC + `date` ASC | 週檢視查詢 |
| `repeatGroupId` ASC + `date` ASC | 批次取消重複排課 |

## 部署

### Vercel

1. GitHub repo 連接 Vercel
2. 設定 Environment Variables（同 `.env.local`）
3. Push `main` 自動部署

### Firebase 設定

首次設定：

1. **Authentication** → 啟用「電子郵件/密碼」
2. **Firestore** → 首次建立資料庫

後續 rules 與 indexes 更新透過 CLI 部署：

```bash
# 首次使用需登入
npx firebase-tools login

# 部署 Firestore 規則
npx firebase-tools deploy --only firestore:rules

# 部署 Firestore 索引
npx firebase-tools deploy --only firestore:indexes

# 一次部署兩者
npx firebase-tools deploy --only firestore
```

專案設定（`.firebaserc`、`firebase.json`）已納入版控，無須重新 `firebase init`。

## 費用

全部免費：

| 服務 | 方案 | 月費 |
|------|------|------|
| Firebase Auth | Spark | $0（50,000 MAU） |
| Firestore | Spark | $0（1GB 儲存 / 5 萬讀取/天） |
| Vercel | Hobby | $0（100GB 流量/月） |

音樂教室規模完全在免費額度內。
