# Maintenance Mode — Design

- **Issue**: [#10](https://github.com/mako-debug/music-room-booking/issues/10)
- **Date**: 2026-04-17
- **Branch**: TBD（建議 `feat/10-maintenance-mode`）

## 1. 問題陳述

未來執行大型資料遷移、需要全域一致性快照、或有非原子批次修正時，希望能統一暫停一般使用者操作、只讓 admin 可用系統。目前沒有這個機制，#7 的 booking race fix 是用細粒度 transaction 解，但並非所有維運動作都適合這樣做。

## 2. 目標與非目標

**目標**
- 一個 admin 可隨時切換的全域「維護模式」開關
- 開啟時：非 admin 使用者看到全畫面「系統維護中」overlay，寫入被 Firestore rules 擋下
- 關閉時：系統即時恢復，無需使用者重整頁面
- 完全在 Firebase Spark 免費方案內完成，不引入任何付費服務

**非目標**
- 不擋登入本身（B 方案；擋登入需 Identity Platform 或 blocking functions，屬付費）
- 不阻擋非 admin 讀取（rules 讀取不加 guard，避免所有 collection 多一次 `get()` 計費；overlay 已遮蔽 UI）
- 不導入 custom claims（使用既有 `users/{uid}.role` 機制；本 feature 不足以支撐整專案切換 claims 的成本）
- 不做 audit log（`startedBy` / `startedAt` 欄位不存；需要時看 Firestore console 的 `updateTime`）
- 不做自動化測試（沿用專案既定路線：型別 + 手動 smoke test）
- 不做排程維運 / 倒數計時 / 多訊息範本 / 多國語系等進階功能（YAGNI）

## 3. 架構

### 3.1 三個邏輯關卡

| 層級 | 職責 | 是否為真防護 |
|---|---|---|
| Client overlay | UX — 非 admin 看到維護畫面 | 否（純 UI） |
| Firestore rules | 擋非 admin 寫入 | **是（真防護）** |
| Admin 控制面板 | 切換開關 / 編輯訊息 | — |

Overlay 與 rules 各司其職：overlay 只是讓使用者知情、避免看到壞掉的 UI；rules 才是資料完整性的防線。Client 端不再做 pre-check（避免重複邏輯）。

### 3.2 `settings/maintenance` doc schema

```ts
interface MaintenanceSettings {
  enabled: boolean;
  message: string; // 空字串時，overlay 顯示預設文字
}
```

欄位故意精簡。未來若需 `startedBy` / `startedAt` / 訊息範本等，再獨立 issue 擴充。

### 3.3 成本原則

**本 feature 不引入任何付費 Firebase 服務**。以下皆明確排除：

- Cloud Functions / blocking triggers（Identity Platform）
- Custom claims 改寫
- App Check

全部邏輯用 Firestore rules + client-side onSnapshot 完成。估算：

- 每個 client session 開啟時 1 次 doc read（subscribe `settings/maintenance`），之後 realtime 不計費
- 每筆 booking 寫入 rules 多 1 次 doc read（`isMaintenanceActive()`），與既有 `getUserRole()` 規模相同
- Admin 切換 1 次 write

目前預約量級完全在 Spark 免費額度內（50k reads/day, 20k writes/day）。

## 4. 元件與檔案異動

### 4.1 新增檔案

- **`src/components/MaintenanceOverlay.tsx`** — 純 UI。全畫面 fixed overlay；顯示「系統維護中」標題、`message` 內文（空字串時 fallback 預設）、登出按鈕讓使用者可離開。
- **`src/components/admin/MaintenanceSection.tsx`** — admin 控制面板區塊。包含：
  - 目前狀態顯示（啟用 / 關閉）
  - Message textarea（≤200 字）
  - 「開啟維運」/「關閉維運」按鈕（依當前狀態切換）
  - 寫入失敗時錯誤訊息

### 4.2 修改檔案

- **`src/types/index.ts`** — 新增 `MaintenanceSettings` 型別。
- **`src/components/AuthProvider.tsx`** — 在現有 `onSnapshot(users/{uid})` 旁再 subscribe `doc(db, 'settings', 'maintenance')`。Context 多回一個 `maintenance: MaintenanceSettings`（預設 `{ enabled: false, message: '' }`）。
- **`src/components/AuthGuard.tsx`** — 在 render children 前分支：
  ```
  if (maintenance.enabled && appUser?.role !== 'admin') {
    return <MaintenanceOverlay message={maintenance.message} />;
  }
  ```
  Admin 不受影響。Login 頁不經 AuthGuard，登入流程不被擋。
- **`src/app/admin/page.tsx`** — 引入 `<MaintenanceSection>` 放在 `AdminContent` 頂端（使用者管理區塊之上）。
- **`firestore.rules`**：
  - 新增 helper：
    ```
    function isMaintenanceActive() {
      return exists(/databases/$(database)/documents/settings/maintenance)
        && get(/databases/$(database)/documents/settings/maintenance).data.enabled == true;
    }
    ```
  - 新增 `/settings/{docId}` match block：read 所有已登入使用者；write 僅 admin
  - `/bookings/{bookingId}` create/update/delete 條件加上 `(!isMaintenanceActive() || getUserRole() == 'admin')`
  - `/booking_locks/{lockId}` create/delete 條件同上加 guard

### 4.3 不動的檔案

- `src/app/login/page.tsx` — 不擋登入（B 方案）
- `/api/admin/*` — admin 專用路由；admin SDK 本來就繞過 rules
- `src/lib/bookings.ts` — 不加 client-side pre-check；rules 是唯一真防護

### 4.4 元件職責邊界

- `AuthProvider`：**資料同步層**，處理 subscribe 與 state
- `AuthGuard`：**路由守衛層**，包含既有 login redirect 與新增的 maintenance overlay 分支
- `MaintenanceOverlay`：**純展示**，不讀 context，props 接收 `message`
- `MaintenanceSection`：**admin 操作 UI**，內部自行處理寫入與錯誤

## 5. 資料流

### 5.1 開啟維運

```
Admin 在 /admin 的 MaintenanceSection 填 message → 按「開啟維運」
  → setDoc('settings/maintenance', { enabled: true, message })
  → Firestore rules 驗 admin → 寫入成功
  → 所有線上 client 的 AuthProvider onSnapshot 觸發
  → 非 admin：AuthGuard 切到 <MaintenanceOverlay>
  → admin 自己：不受影響
```

### 5.2 關閉維運

```
Admin 按「關閉維運」→ updateDoc({ enabled: false })
  → 所有 client onSnapshot 觸發
  → 非 admin overlay 消失 → 恢復正常 UI
```

### 5.3 非 admin 在維運期間嘗試寫入（繞過 overlay）

```
client 呼叫 createBooking() → runTransaction 發出
  → rules guard：isMaintenanceActive() && role != 'admin' → 拒絕
  → Firestore 回 permission-denied
  → 既有 booking 錯誤處理顯示訊息（通常使用者看不到，因為 overlay 已覆蓋）
```

### 5.4 Doc 不存在的預設狀態

- 首次部署時 `settings/maintenance` 不存在
- AuthProvider 的 onSnapshot 收到 `exists() === false`，`maintenance` state 維持預設 `{ enabled: false, message: '' }`
- Rules 的 `isMaintenanceActive()` 用 `exists(...) && get(...).data.enabled == true`，doc 不存在時回 false（安全預設）
- Admin 首次按開啟時用 `setDoc`（而非 `updateDoc`）建立文件

## 6. 錯誤處理與邊界情境

### 6.1 Listener 錯誤（fail open）

- `onSnapshot` 的 error callback 保持 `maintenance.enabled = false`
- 理由：真正的保護是 rules；client overlay 只是 UX。若 fail closed，網路 blip 會讓所有人被鎖
- 權衡：維運期間網路抖動的使用者可能短暫看到正常 UI，但寫入仍被 rules 擋下 → 可接受

### 6.2 Admin 寫 `settings/maintenance` 失敗

- `setDoc` throws → MaintenanceSection 顯示錯誤訊息；狀態不做 optimistic 更新
- Admin 可重試

### 6.3 維運開啟瞬間有人正按送出

- snapshot 還沒到，modal 還開著，使用者按送出 → runTransaction 發出
- 幾百毫秒內 rules guard 拒絕 → 跳既有錯誤訊息
- onSnapshot 接著送達 → overlay 蓋下
- UX 有瑕疵但資料一致

### 6.4 Admin 自己被降級

- Admin role 被改成 teacher → AuthGuard 切到 overlay → 自己被鎖
- 程式內**不提供**逃生艙（避免過度設計）
- 恢復路徑：Firestore console 直接改 `settings/maintenance.enabled = false` 或改回 role

### 6.5 `message` 欄位安全

- React 預設 escape，無 XSS 風險
- Admin 端 textarea 限制 200 字，避免 overlay 塞爆
- 空字串 → overlay fallback「系統維護中，請稍後再試」

## 7. Firestore rules 完整草稿

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function getUserRole() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role;
    }

    function isMaintenanceActive() {
      return exists(/databases/$(database)/documents/settings/maintenance)
        && get(/databases/$(database)/documents/settings/maintenance).data.enabled == true;
    }

    match /settings/{docId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && getUserRole() == 'admin';
    }

    match /rooms/{roomId} {
      allow read: if request.auth != null;
    }

    match /bookings/{bookingId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
        && getUserRole() in ['admin', 'teacher']
        && (!isMaintenanceActive() || getUserRole() == 'admin');
      allow update: if request.auth != null
        && (resource.data.userId == request.auth.uid
            || getUserRole() == 'admin')
        && (!isMaintenanceActive() || getUserRole() == 'admin');
      allow delete: if request.auth != null
        && (resource.data.userId == request.auth.uid
            || getUserRole() == 'admin')
        && (!isMaintenanceActive() || getUserRole() == 'admin');
    }

    match /booking_locks/{lockId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
        && getUserRole() in ['admin', 'teacher']
        && (request.resource.data.userId == request.auth.uid
            || getUserRole() == 'admin')
        && getAfter(/databases/$(database)/documents/bookings/$(request.resource.data.bookingId))
            .data.userId == request.resource.data.userId
        && (!isMaintenanceActive() || getUserRole() == 'admin');
      allow update: if false;
      allow delete: if request.auth != null
        && (resource.data.userId == request.auth.uid
            || getUserRole() == 'admin')
        && (!isMaintenanceActive() || getUserRole() == 'admin');
    }

    match /users/{userId} {
      allow read: if request.auth != null;
      allow update: if request.auth != null && getUserRole() == 'admin';
      allow update: if request.auth != null
        && request.auth.uid == userId
        && !request.resource.data.diff(resource.data).affectedKeys()
            .hasAny(['role', 'active', 'email', 'uid', 'createdAt']);
      allow create, delete: if request.auth != null && getUserRole() == 'admin';
    }
  }
}
```

備註：`users` 的寫入**不加** maintenance guard。理由：
- 本人改 displayName / colorIndex 等個資屬無害操作
- Admin 操作（升降級、啟停用）在維運期間仍需可用
- 若未來維運情境需要鎖 users 寫入，另案擴充

## 8. 部署順序

遵循 `CLAUDE.md` 已建立的 **rules → code** 原則：

1. `firebase deploy --only firestore:rules`（新增 `settings` match + booking guard）
2. Merge / deploy code（AuthProvider、AuthGuard、MaintenanceSection、types、MaintenanceOverlay）
3. 無需 migration（doc 不存在即視為關閉，首次 admin 按開啟才建立）

## 9. 驗收（手動 smoke test）

依順序執行，全部通過才視為完成：

1. **預設狀態**：`settings/maintenance` doc 不存在 → 所有使用者正常；無 overlay
2. **開啟維運**：
   - Admin 登入 `/admin` → 填「系統升級中」→ 按開啟
   - Admin 回 `/` → 仍可看課表、新增 booking
   - Teacher 登入 → 全畫面 overlay，訊息正確
   - Student 登入 → 全畫面 overlay
3. **Rules 擋寫入**：Teacher 在 DevTools 手動呼叫 `createBooking` → Firestore 回 permission-denied
4. **關閉維運**：
   - Admin 按關閉 → Teacher/Student client overlay 自動消失（不需重整）
   - Teacher 新增 booking → 成功
5. **邊界**：
   - 訊息空白 → overlay 顯示 fallback「系統維護中，請稍後再試」
   - 訊息 200 字 → textarea 不溢位；overlay 正常換行
   - 非 admin 直接寫 `settings/maintenance` → rules 拒絕

## 10. 後續可能擴充（非本次範圍）

- Audit log（startedBy / startedAt / 歷史紀錄）
- Banner 模式（read-only 瀏覽 + 提示）
- 分階段維運（只擋某些 collection）
- 排程維運 / 倒數計時
- 擋登入（需 Identity Platform，付費）

皆為獨立 issue，待需求出現時再評估。
