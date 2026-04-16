# 新米蘭音樂教室 — 琴房預約系統設計文件

## 概述

為新米蘭音樂教室打造的琴房預約系統。使用者掃 QR Code 進入網站，登入後可查看 7 間琴房的預約狀況。老師/管理員可預約教室，學生僅能查看。

## 業務規則

| 項目 | 規格 |
|------|------|
| 營業時段 | 08:00 ~ 22:00 |
| 最小預約單位 | 30 分鐘 |
| 教室數量 | 7 間（1號~7號） |
| 登入方式 | Email + 密碼 |
| 預約範圍 | 未來 1 個月 |
| 取消預約 | 可以（本人或管理員） |
| 重複排課 | 支援每週重複（2~4 週） |
| 存取控制 | 所有頁面需登入（`/login` 除外） |
| 時區 | Asia/Taipei（UTC+8），所有日期時間皆為台灣時間 |

## 系統架構

```
使用者（手機/電腦）掃 QR Code
        ↓
Next.js App (Vercel)
  ├── /login    登入頁
  ├── /         首頁日曆檢視
  └── /booking  預約操作（Modal）
        ↓
Firebase
  ├── Auth（Email/Password 認證）
  ├── Firestore（預約資料）
  └── （部署走 Vercel，不用 Firebase Hosting）
```

## 路由規劃

| 路由 | 用途 | 需登入 |
|------|------|--------|
| `/login` | 登入頁 | 否 |
| `/` | 首頁日曆檢視 | 是 |
| `/booking` | 預約操作 | 是 |

未登入一律跳轉至 `/login`。

## Firestore 資料結構

### `users` collection

```json
{
  "uid": "firebase-auth-uid",
  "email": "teacher@example.com",
  "displayName": "王老師",
  "role": "admin | teacher | student",
  "createdAt": "2026-04-16T..."
}
```

### `rooms` collection

```json
{
  "id": "room-1",
  "name": "1號教室",
  "order": 1
}
```

初始化 7 筆（1號~7號）。

### `bookings` collection

```json
{
  "id": "auto-generated",
  "roomId": "room-1",
  "date": "2026-04-20",
  "startTime": "09:00",
  "endTime": "10:00",
  "userId": "firebase-uid",
  "userName": "王老師",
  "studentName": "小明",
  "purpose": "鋼琴課",
  "repeatGroupId": "rg-xxx | null",
  "createdAt": "2026-04-16T..."
}
```

**查詢策略：**

- 日檢視：`where("date", "==", "2026-04-20")` 取回當天全部教室預約
- 週檢視：`where("date", ">=", startDate).where("date", "<=", endDate).where("roomId", "==", "room-1")`

**重複排課：** 一次建立 N 筆 booking，共用 `repeatGroupId`。取消時可選「只取消這次」或「取消此週之後全部」（client-side batch delete，每筆各自通過 Security Rules 驗證）。

**衝突防護：** 建立預約時使用 Firestore Transaction：先查詢目標教室+時段是否已有預約，無衝突才寫入。避免兩人同時預約同一時段的 race condition。

**必要 Composite Index：**

| Collection | Fields | 用途 |
|------------|--------|------|
| `bookings` | `date` ASC, `roomId` ASC | 週檢視查詢 |
| `bookings` | `repeatGroupId` ASC, `date` ASC | 批次取消重複排課 |

## 頁面設計

### 登入頁 `/login`

- 頂部「新米蘭音樂教室」標題
- Email + 密碼表單 + 登入按鈕
- 初期不做註冊功能，由管理員在 Firebase Console 手動建帳號（同時在 Firestore `users` collection 建立對應文件並設定 `role`）

### 首頁日曆 `/`

兩種檢視模式，右上角可切換：

**日檢視（手機預設）：**

- 橫軸 = 7 間教室，縱軸 = 08:00~22:00（每格 30 分鐘）
- 已預約格子顯示色塊 + 老師名 + 學生名
- 空白格可點擊 → 彈出預約表單
- 手機上教室欄可左右滑動，時間欄固定
- 頂部日期選擇器（< 4/20 >）

**週檢視（電腦預設）：**

- 橫軸 = 週一~週日，縱軸 = 08:00~22:00
- 上方下拉選單切換教室
- 頂部週選擇器（< 4/14~4/20 >）

### 預約表單（Modal 彈窗）

點空白格子後彈出，欄位：

| 欄位 | 來源 | 必填 |
|------|------|------|
| 教室 | 自動帶入（從點擊位置） | 是 |
| 日期 | 自動帶入 | 是 |
| 開始時間 | 自動帶入 | 是 |
| 時長 | 下拉選單：30分/1小時/1.5小時/2小時 | 是 |
| 老師 | 自動帶入（登入者名稱） | 是 |
| 學生姓名 | 手動輸入 | 是 |
| 用途 | 手動輸入 | 否 |
| 每週重複 | 勾選 + 選週數（2~4 週） | 否 |

時段衝突即時提示紅字。

### 預約詳情 / 取消

點已預約色塊 → 顯示詳情（教室、時間、老師、學生、用途）→ 「取消預約」按鈕。

若為重複排課：選擇「只取消這次」或「取消此週之後全部」。

## 權限設計

### 角色權限矩陣

| 功能 | admin | teacher | student |
|------|:-----:|:-------:|:-------:|
| 查看日曆 | ✅ | ✅ | ✅ |
| 新增預約 | ✅ | ✅ | ❌ |
| 取消自己的預約 | ✅ | ✅ | ❌ |
| 取消任何人的預約 | ✅ | ❌ | ❌ |
| 管理帳號（未來） | ✅ | ❌ | ❌ |

### Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function getUserRole() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role;
    }

    match /rooms/{roomId} {
      allow read: if request.auth != null;
    }

    match /bookings/{bookingId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
        && getUserRole() in ['admin', 'teacher'];
      allow update: if request.auth != null
        && (resource.data.userId == request.auth.uid
            || getUserRole() == 'admin');
      allow delete: if request.auth != null
        && (resource.data.userId == request.auth.uid
            || getUserRole() == 'admin');
    }

    match /users/{userId} {
      allow read: if request.auth != null;
      // users doc 由管理員透過 Firebase Console 或 Admin SDK 建立
      // client-side 不開放 write，避免使用者自行修改角色
    }
  }
}
```

## 技術棧

| 層面 | 技術 | 版本 |
|------|------|------|
| 框架 | Next.js (App Router) | 15.x |
| 語言 | TypeScript | 5.x |
| 樣式 | Tailwind CSS | 4.x |
| 認證 | Firebase Auth | 11.x |
| 資料庫 | Firebase Firestore | 11.x |
| 部署 | Vercel | Free Plan |
| 套件管理 | npm | — |

## 專案結構

```
music-room-booking/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # 全域 layout
│   │   ├── page.tsx            # 首頁（日曆檢視）
│   │   ├── login/
│   │   │   └── page.tsx        # 登入頁
│   │   └── globals.css
│   ├── components/
│   │   ├── Calendar/
│   │   │   ├── DayView.tsx     # 日檢視
│   │   │   ├── WeekView.tsx    # 週檢視
│   │   │   └── TimeSlot.tsx    # 單格時段元件
│   │   ├── BookingModal.tsx    # 預約表單彈窗
│   │   ├── BookingDetail.tsx   # 預約詳情/取消
│   │   ├── Header.tsx          # 頂部導覽列
│   │   └── AuthGuard.tsx       # 未登入跳轉 /login
│   ├── lib/
│   │   ├── firebase.ts         # Firebase 初始化
│   │   ├── auth.ts             # 登入/登出/auth state 監聽
│   │   └── bookings.ts         # Firestore CRUD
│   └── types/
│       └── index.ts            # TypeScript 型別定義
├── public/
│   └── qrcode.png              # QR Code（部署後產生）
├── package.json
├── tailwind.config.ts
├── next.config.ts
└── .env.local                  # Firebase config（不進版控）
```

## 部署流程

1. GitHub repo `mako-debug/music-room-booking` 連接 Vercel
2. Push `main` branch → Vercel 自動部署
3. Firebase config 透過 Vercel 環境變數設定
4. 部署完成後用網址產生 QR Code 張貼於教室

## 費用

| 服務 | 方案 | 月費 | 限制 |
|------|------|------|------|
| Firebase Auth | Spark (Free) | $0 | 50,000 MAU（音樂教室綽綽有餘） |
| Firestore | Spark (Free) | $0 | 1GB 儲存 / 5萬次讀取/日 |
| Vercel | Hobby (Free) | $0 | 100GB 流量/月 |
| **總計** | | **$0** | |

音樂教室的使用量完全在免費額度內。
