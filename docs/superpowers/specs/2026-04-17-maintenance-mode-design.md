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

- **Client subscription**：每個 client session 開啟時 1 次 initial read；之後每次 admin 切換該 doc，每個 listener 多計 1 read（admin 切換極少，可忽略）
- **Rules reads per booking write**：一次 `createBooking` tx 會同時觸發 `bookings` + N 個 `booking_locks`（N = 涵蓋 bucket 數，通常 1–4）的 rules 判定。每個 match block 各呼叫一次 `isMaintenanceActive()`；假設 Firestore **不跨 match block 去重**（保守估計），單 tx 多 (1 + N) 次 doc read。以每筆預約最多 4 bucket 計算，最壞 +5 reads/write
- **Admin 切換**：1 write

以目前預約量級（數十筆/天）換算：booking 新增每天 <50 筆 × 5 = <250 reads，完全在 Spark 免額度內（50k reads/day、20k writes/day、1 GB）。

**超額監測**：本 feature 不主動加監測。若未來預約量級成長到接近免額度（>10k reads/day），再獨立評估（可能手段：custom claims 把 role 搬到 token 省 `getUserRole()` read、或升級付費方案）。

## 4. 元件與檔案異動

### 4.1 新增檔案

- **`src/components/MaintenanceOverlay.tsx`** — 純 UI。全畫面 fixed overlay；顯示「系統維護中」標題與 `message` 內文（空字串時 fallback 預設）。**不含登出按鈕**（會擋登入的方案已被排除；加登出按鈕只會把使用者丟回 login，再登入還是看到 overlay，無意義）。
- **`src/components/admin/MaintenanceSection.tsx`** — admin 控制面板區塊。包含：
  - 目前狀態顯示（啟用 / 關閉）
  - Message textarea（≤200 字）
  - 「開啟維運」/「關閉維運」按鈕（依當前狀態切換）
  - 寫入失敗時錯誤訊息

### 4.2 修改檔案

- **`src/types/index.ts`** — 新增 `MaintenanceSettings` 型別。
- **`src/components/AuthProvider.tsx`**：
  - 在現有 `onAuthStateChanged` 的 `if (user)` 分支內，與 `unsubProfile` 並列建立 `unsubMaintenance = onSnapshot(doc(db, 'settings', 'maintenance'), ...)`
  - `settings/maintenance` rules 要求 `request.auth != null`，因此 listener **必須** scoped to authed state（未登入時不建）
  - 兩個 listener 同進同退：auth logout / 切換 user 時一起 teardown
  - Context 擴充：`{ firebaseUser, appUser, loading, maintenance }`；預設值 `{ firebaseUser: null, appUser: null, loading: true, maintenance: { enabled: false, message: '' } }`
  - **`loading` 語意**：為避免 flicker race，`loading` 要等 users profile snapshot **與** maintenance snapshot 都首次回來才置 false（兩個 listener 各自有 resolved flag；兩個都 true 才 `setLoading(false)`）
- **`src/components/AuthGuard.tsx`** — `loading` 期間維持現有 spinner；resolved 後分支：
  ```
  if (maintenance.enabled && appUser?.role !== 'admin') {
    return <MaintenanceOverlay message={maintenance.message} />;
  }
  ```
  Admin 不受影響。Login 頁不經 AuthGuard，登入流程不被擋。
- **`src/app/admin/page.tsx`** — 在 `AdminContent` 最上方（第一個區塊，於使用者管理區塊之上）引入 `<MaintenanceSection>`。
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

### 6.4 Admin 自己被降級 / 單一 admin 鎖死

- Admin role 被改成 teacher → AuthGuard 切到 overlay → 自己被鎖
- 程式內**不提供**逃生艙（避免過度設計）
- 恢復路徑（依能存取的身分排序）：
  1. **另一位 admin**（建議維持 ≥ 2 位 admin 帳號作為 backup；單 admin 部署有真實的 lockout 風險）
  2. **Firebase console 的 project owner / editor IAM 成員**：Admin SDK / console 的寫入操作 bypass security rules，可直接改 `settings/maintenance` 或 `users/{uid}.role`
  3. 已知 admin 密碼但帳號被降級時：先從 Firebase console 改回 role，再登入即可

### 6.5 `message` 欄位安全

- React 預設 escape，無 XSS 風險
- Admin 端 textarea 限制 200 字，避免 overlay 塞爆
- 空字串 → overlay fallback「系統維護中，請稍後再試」

## 7. Firestore rules 變更

**實作方式**：`firestore.rules` 以 **in-place edit** 進行，**保留**既有註解（包含 #7 lock-squatting 防護的說明），只加新邏輯。下方片段只呈現異動部分，不是整份取代。

### 7.1 新增 helper（`getUserRole()` 下方）

```
function isMaintenanceActive() {
  return exists(/databases/$(database)/documents/settings/maintenance)
    && get(/databases/$(database)/documents/settings/maintenance).data.enabled == true;
}
```

### 7.2 新增 `settings/maintenance` match（不要用 `settings/{docId}` wildcard）

```
// 只鎖 maintenance 這一份；未來 settings/* 下若有敏感 doc，各自顯式宣告 rules
match /settings/maintenance {
  allow read: if request.auth != null;
  allow write: if request.auth != null && getUserRole() == 'admin';
}
```

理由：用 wildcard `settings/{docId}` 會讓未來新增的 `settings/pricing` 等 doc 預設可被所有登入者讀取，造成意外曝露。

### 7.3 `/bookings/{bookingId}` 加 maintenance guard

`create` / `update` / `delete` 三個 allow 條件各自追加：

```
&& (!isMaintenanceActive() || getUserRole() == 'admin')
```

例如 create：
```
allow create: if request.auth != null
  && getUserRole() in ['admin', 'teacher']
  && (!isMaintenanceActive() || getUserRole() == 'admin');
```

### 7.4 `/booking_locks/{lockId}` 加 maintenance guard

`create` / `delete` 條件追加同一行。`update` 維持 `false`。
`create` 的 `getAfter()` 交叉驗證保留（#7 防 DoS 的核心，不要動）。

### 7.5 `/users/{userId}` **不加** maintenance guard（刻意）

理由：
- 本人改 displayName / colorIndex 等個資屬無害
- Admin 操作（升降級、啟停用、$6.4 的逃生路徑 1）在維運期間必須可用
- 若未來維運情境需要鎖 users 寫入（例如 migrate user schema），再獨立 issue 擴充

### 7.6 一致性模型提醒

- Client 的 `maintenance` state 來自 onSnapshot，rules 的 `isMaintenanceActive()` 來自 rules 執行當下 `get()`
- 兩者 **eventually consistent**，不是 strongly consistent；切換瞬間存在 ~100ms 窗口（client 仍顯示正常 UI 但 rules 已 deny，或反之）
- §6.3 的「開啟瞬間有人正按送出」即此窗口的實際表現
- 此 feature 接受此行為；資料一致性由 rules 保證，UI 暫時不一致可接受

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
6. **切換瞬間 race（§6.3 情境）**：
   - Teacher 先開啟 BookingModal 並停留
   - Admin 同時開啟維運
   - Teacher 按送出 → 應看到 permission-denied 錯誤，隨後 overlay 覆蓋整個畫面
7. **Snapshot loading race**（避免 §4.2 提到的 flicker）：
   - Teacher 關閉分頁、重新整理時，維運已開啟
   - 期望：看到 `載入中…` 直到兩個 listener 都 resolved，接著直接進入 overlay（**不應**短暫看到正常課表）

## 10. 後續可能擴充（非本次範圍）

- Audit log（startedBy / startedAt / 歷史紀錄）
- Banner 模式（read-only 瀏覽 + 提示）
- 分階段維運（只擋某些 collection）；目前 `users` 寫入刻意不擋（§7.5），屬已知 gap
- 排程維運 / 倒數計時
- 擋登入（需 Identity Platform，付費）
- 超額監測 / 告警（目前靠 Firebase console 手動查）

皆為獨立 issue，待需求出現時再評估。
