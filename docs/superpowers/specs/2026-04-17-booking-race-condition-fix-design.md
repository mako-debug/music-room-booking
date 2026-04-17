# Booking Race Condition Fix — Design

- **Issue**: [#7](https://github.com/mako-debug/music-room-booking/issues/7)
- **Related**: [#10](https://github.com/mako-debug/music-room-booking/issues/10)（Maintenance Mode future feature）
- **Date**: 2026-04-17
- **Branch**: `fix/7-booking-race-condition`

## 1. 問題陳述

`src/lib/bookings.ts:74-95` 的 `createBooking` 採「先 `getDocs` 查衝突 → 再 `addDoc` 建立」的兩步驟流程，非原子操作。兩個客戶端同時預約同一教室同一時段時，雙方 `getDocs` 都會在對方 `addDoc` 完成前回傳「無衝突」，導致兩筆預約皆寫入成功，產生時段重疊。

## 2. 目標與非目標

**目標**
- 完整阻擋「完全相同時段」與「時間重疊」兩種併發衝突
- 原子化刪除流程（booking 與其鎖同進同退）
- 現有資料向前相容（提供一次性 backfill migration）

**非目標**
- 不支援修改預約時間（`updateBooking` 目前僅改 `studentName` / `purpose`，本次不擴充）
- 不導入自動化測試框架（本次維持手動 smoke test；另列為 backlog）
- 不做維運模式 / 登入鎖（已拆到 Issue #10 獨立追蹤）
- 不跨日預約（startTime/endTime 皆同 `date` 內）

## 3. 架構：Bucketed Locks

### 3.1 核心策略

每 30 分鐘為一個 bucket。一筆 booking 鎖住它所涵蓋的**所有 bucket**。例：

- 09:00–10:00 的預約 → 鎖 `09:00`、`09:30` 兩個 bucket
- 09:30–10:30 的預約 → 鎖 `09:30`、`10:00` 兩個 bucket
- 兩者併發 → 都競爭 `09:30` → Firestore transaction 只放行一個

### 3.2 可行性前提

- 所有 bookings 的 `startTime` / `endTime` 必須對齊 30 分鐘邊界
- 現有 UI 已強制此條件：
  - `BookingModal` 的 `DURATION_OPTIONS` 皆為 30 的倍數（30 / 60 / 90 / 120）
  - `DayView` / `WeekView` 的 grid slots 僅 `HH:00` / `HH:30`
  - `startTime` 一律由點擊 grid 產生
- 後端 `createBooking` 仍加 assert 防禦：不對齊 → throw

### 3.3 為何不走 pre-check query + single lock

- Firestore transaction 不允許 tx 內 `query`，只能 `tx.get(docRef)`
- 「完全相同 startTime」可用 single lock，但「不同 startTime 但時間重疊」無法擋
- pre-check query 放在 tx 外本身就不原子（即本 bug）
- Bucketed locks 以空間換原子性，完整覆蓋所有併發情境

## 4. 資料模型

新 collection：`booking_locks`

```ts
// docId: `${roomId}_${date}_${bucketStartTime}`
// 例： "room1_2026-04-20_09:00"
interface BookingLock {
  bookingId: string;   // 對應 bookings doc id
  userId: string;      // = 對應 booking.userId（擁有該預約的老師 uid），
                       // 並非「建立 lock 的人」。Admin 代 teacher 建立時，
                       // 仍寫 teacher 的 uid，rules 才能讓 teacher 自行刪除
  createdAt: string;   // ISO string，與對應 booking.createdAt 共用同一時間
}
```

不儲存 `roomId` / `date` / `bucketTime`——可由 docId 解析，節省空間。

**不需新 Firestore index**：`booking_locks` 僅以 docId 存取，無 query 操作。

## 5. API 變更（`src/lib/bookings.ts`）

### 5.1 新增 helper

```ts
// 展開 booking 覆蓋的所有 30 分鐘 bucket
function expandBuckets(startTime: string, endTime: string): string[]
// expandBuckets("09:00", "10:30") → ["09:00", "09:30", "10:00"]

// 組 lock docId
function makeLockId(roomId: string, date: string, bucket: string): string
// → `${roomId}_${date}_${bucket}`

// 驗證時間對齊 30 分鐘
function assertAligned(time: string): void
// 不對齊則 throw
```

### 5.2 `createBooking`（改寫）

- 驗證 `isWithinOneMonth(date)`
- `assertAligned(startTime)` / `assertAligned(endTime)`
- 在 tx 外先計算 `const createdAt = new Date().toISOString()`，booking 與所有 lock 共用同一時間（便於 audit / debug）
- `runTransaction`：
  1. 展開所有 bucket，組 lockRefs
  2. `tx.get` 所有 lockRef
  3. 任一 exists → throw `'此時段已有預約'`
  4. 產生 newBookingRef（`doc(collection(db, 'bookings'))`）
  5. `tx.set(newBookingRef, { ...input, createdAt })`
  6. 每個 bucket：`tx.set(lockRef, { bookingId: newBookingRef.id, userId: input.userId, createdAt })`
- 刪除 `hasConflict` 輔助函式（不再需要）

### 5.3 `deleteBooking`（改簽名）

```ts
async function deleteBooking(booking: Booking): Promise<void>
```

- `writeBatch`：
  - `batch.delete(doc(db, 'bookings', booking.id))`
  - 展開 buckets，逐一 `batch.delete(lockRef)`
- 單一 commit 原子完成

### 5.4 `deleteRepeatBookings`（改為 batch）

- **簽名不變**：`async function deleteRepeatBookings(repeatGroupId: string, fromDate: string): Promise<number>`，仍回傳已刪除筆數
- `query` 取所有 bookings
- 單一 `writeBatch`：每筆 booking + 每筆的所有 bucket locks
- batch 上限 500 ops；目前 repeat 上限 4 週 × 最多 4 bucket/週 + 4 bookings = 20 ops，遠低於上限

### 5.5 `updateBooking`

不變（僅改 studentName / purpose，不動時間也不動 locks）

### 5.6 呼叫端變更

- `BookingModal.tsx`：無變更
- `BookingDetail.tsx:86`：`deleteBooking(booking.id)` → `deleteBooking(booking)`
- 已 grep 確認 `deleteBooking` 在 `src/` 內僅此一處呼叫（`src/lib/bookings.ts` 為定義端，無其他呼叫點）

## 6. Firestore Rules

新增 `booking_locks` match block：

```
match /booking_locks/{lockId} {
  allow read: if request.auth != null;

  allow create: if request.auth != null
    && getUserRole() in ['admin', 'teacher']
    && (request.resource.data.userId == request.auth.uid
        || getUserRole() == 'admin');

  allow update: if false;

  allow delete: if request.auth != null
    && (resource.data.userId == request.auth.uid
        || getUserRole() == 'admin');
}
```

設計要點：
- 建立時檢查 `userId == auth.uid 或 admin`——支援 admin 代 teacher 建立預約的情境（`BookingModal` 有此流程）
- `update` 一律禁止：lock 一旦建立不應修改
- `delete` 同 bookings：擁有者或 admin

## 7. Migration

### 7.1 Route：`POST /api/admin/migrate-locks`

比照現有 `/api/admin/update-user` / `/api/admin/reset-password` pattern：

- **Auth**：`verifyIdToken` → 讀 `users/{uid}.role` → 非 admin 回 403
- **流程**：
  1. admin SDK `getFirestore().collection('bookings').get()` 全撈
  2. 每筆 booking 跑一次 `runTransaction`：
     ```
     bookingSnap = tx.get(bookingRef)
     if (!bookingSnap.exists) return 'skip'
     buckets = expandBuckets(...)
     for each bucket:
       lockSnap = tx.get(lockRef)
       if (!lockSnap.exists) tx.set(lockRef, { bookingId, userId, createdAt: now })
     ```
  3. 累計並回傳 JSON：
     ```ts
     {
       success: true,
       total: number,       // 掃過的 bookings 筆數
       migrated: number,    // 實際新建 lock 的 bookings 數
       skipped: number,     // booking 已有完整 locks 或已被刪
       errors: Array<{ bookingId: string; message: string }>
     }
     ```
     失敗 / 未授權則回 `{ success: false, error: string }` + 對應 HTTP status（比照 `/api/admin/update-user`）

### 7.2 為何 tx-per-booking 而非 batch

- 若在 migration 跑的當下有使用者刪除某筆 booking，batch 可能把 lock 建成孤兒
- tx 內 `tx.get(bookingRef)` 重讀——不存在就 skip，race window 歸零
- 效能代價可接受（現有預約數量極少）

### 7.3 冪等性

- lock 已存在 → skip
- 可重跑任意次數
- 不覆蓋既有 `createdAt`

### 7.4 前端

- `/admin` 頁加一顆「Backfill booking locks」按鈕（admin 才看得見）
- 點擊 → 帶 ID token 打 route → 顯示 `{ total, migrated, skipped, errors }` 結果
- 驗證完成後另開 PR 拆掉 route + 按鈕

## 8. Edge Cases 與錯誤處理

1. **時間不對齊**：`createBooking` 入口 assert，不對齊直接 throw
2. **Tx 自動 retry**：Firestore `runTransaction` 遇併行衝突自動重試（最多 5 次），第二輪會看到對手 lock 後正確 throw
3. **`createRepeatBookings` 部分成功**：維持每週一個獨立 tx；衝突週不阻擋其他週；回傳 `{ success, conflicts }` 簽名不變
4. **Pre-migration 舊資料**：部署完成後必須立刻跑 migration，否則新 booking 會看到「lock 不存在」誤以為空時段
5. **孤兒 lock 處理**：本次不做自動清理；若偶發可手動從 Firebase Console 刪除；未來若需要可開 `/api/admin/cleanup-orphan-locks` route（非本次 scope）
6. **計費**：文件數增加約 2–4× 原 booking 數，實際用量遠低於免費額度

## 9. Rollout 順序

1. Deploy 含新 code 與 migration route 的版本
2. Admin 登入點「Backfill booking locks」→ 驗證 result
3. 確認 `booking_locks` 數量與預期相符
4. 做最小 smoke test（見 §10）
5. 另開 PR 拆除 migration route 與按鈕

**注意**：第 1 步完成後、第 2 步完成前，新 booking 邏輯**保護不完整**（看不到舊 booking 的 lock），所以兩步要**在分鐘級內緊接完成**（admin 部署完立刻打開 `/admin` 頁面按按鈕，不要拖到隔天）。若用量尚低，可選擇低流量時段執行。

**Rules 部署**：`firestore.rules` 的修改透過 Firebase CLI 部署：
```bash
firebase deploy --only firestore:rules
```
（專案已於 commit `e192608` 設好 CLI，不需額外配置）

## 10. 驗證（手動 smoke test）

最小覆蓋範圍——實作正確即可上線，不強制每項實測：

1. 新增單筆預約成功
2. 同時段第二筆被擋（「此時段已有預約」）
3. 刪除單筆預約後可再次預約同時段
4. 重複預約建立 & 刪除正常
5. Migration 跑一次無錯、重跑為 no-op
6. Admin 以 teacher 身分代建預約後，該 teacher 可自行刪除（驗證 lock 的 `userId` 寫入正確）

併發 / rules / 邊界情境：實作邏輯正確即視為完成，不強制實測。

## 11. Limitations / 未涵蓋

- 不自動化測試——沒有 CI 保護，未來 regression 只能靠 code review + 手動複測
- 不支援修改預約時間；若未來 `updateBooking` 開放改時間，需同步刪舊 locks + 建新 locks（另案）
- 維運模式 / 登入鎖：另開 #10 追蹤
- 跨日預約：現行模型與 lock 皆以單日為範圍，本次不處理

## 12. 參考

- Issue #7 原始 bug report
- `src/lib/bookings.ts` 現有實作
- `src/components/BookingModal.tsx`、`BookingDetail.tsx` 呼叫端
- `firestore.rules` 現有規則
- `src/app/api/admin/update-user/route.ts`（migration route 可複用的 pattern）
