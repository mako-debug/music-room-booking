# Booking Race Condition Fix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 `createBooking` 的 race condition，以 bucketed locks + Firestore transaction 完整阻擋同時段與時間重疊的併發寫入。

**Architecture:** 新增 `booking_locks` collection，每 30 分鐘一個 bucket lock；`createBooking` 改 transaction（tx.get 所有 bucket lock → 不存在則 tx.set booking + 所有 locks）；`deleteBooking` 改簽名收 `Booking` 並以 batch 同刪 locks；一次性 admin migration route 為舊資料補建 locks。

**Tech Stack:** Next.js 16、React 19、Firebase 12（Firestore client + admin SDK）、TypeScript。

**Spec:** `docs/superpowers/specs/2026-04-17-booking-race-condition-fix-design.md`

**Testing note:** 依 spec §10 及使用者決議，本次**不引入 vitest / jest**。每個實作 task 以 `npm run build` 做型別檢查；端到端驗證走部署後的手動 smoke test（Chunk 3）。

---

## File Structure

**Modify:**
- `src/lib/bookings.ts` — 新增 helpers、改寫 `createBooking` / `deleteBooking` / `deleteRepeatBookings`、刪除 `hasConflict`
- `src/components/BookingDetail.tsx` — 更新 `deleteBooking` 呼叫（line 86）
- `firestore.rules` — 新增 `booking_locks` match block
- `src/app/admin/page.tsx` — 加「Backfill booking locks」按鈕與呼叫邏輯

**Create:**
- `src/app/api/admin/migrate-locks/route.ts` — admin-only migration API route

**無變更：** `src/types/index.ts`（不 export `BookingLock` 型別，僅為 Firestore 內部 shape）、`firestore.indexes.json`（`booking_locks` 僅以 docId 存取）

---

## Chunk 1: Core library changes

### Task 1.1: 加入 helpers 到 `bookings.ts`

**Files:**
- Modify: `src/lib/bookings.ts`（新增 helpers 與 import）

**Rationale:** 純函式先行，後續 `createBooking` / `deleteBooking` / `deleteRepeatBookings` 都依賴這三個 helper。

- [ ] **Step 1：修改 `bookings.ts` 的 imports**

把現有 imports 改成：
```ts
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  runTransaction,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { Booking, BookingInput } from '@/types';
```

（新增 `runTransaction`、`writeBatch`；`addDoc` 和 `deleteDoc` 暫留，下一個 task 會拿掉）

- [ ] **Step 2：在 `bookings.ts` 檔尾（`createBooking` 之前）新增 helpers**

```ts
const BUCKET_MINUTES = 30;

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function assertAligned(time: string): void {
  if (toMinutes(time) % BUCKET_MINUTES !== 0) {
    throw new Error('時間必須以 30 分鐘為單位');
  }
}

// 展開 booking 涵蓋的所有 30 分鐘 bucket startTime
// 例：expandBuckets("09:00", "10:30") → ["09:00", "09:30", "10:00"]
function expandBuckets(startTime: string, endTime: string): string[] {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  const buckets: string[] = [];
  for (let m = start; m < end; m += BUCKET_MINUTES) {
    buckets.push(fromMinutes(m));
  }
  return buckets;
}

function makeLockId(roomId: string, date: string, bucket: string): string {
  return `${roomId}_${date}_${bucket}`;
}
```

- [ ] **Step 3：型別檢查**

Run: `npm run build`
Expected: build succeeds（因尚未呼叫新 helpers，會有「unused」ESLint warning 是正常的；TypeScript 型別應無錯誤）

如果 ESLint 對 unused helpers 報錯中斷，先暫時在該函式上加 `// eslint-disable-next-line @typescript-eslint/no-unused-vars`，下一個 task 會移除。

- [ ] **Step 4：commit**

```bash
git add src/lib/bookings.ts
git commit -m "feat(bookings): 加入 bucket / lockId / 對齊驗證 helpers"
```

---

### Task 1.2: 改寫 `createBooking` 使用 transaction + bucketed locks

**Files:**
- Modify: `src/lib/bookings.ts:74-95`（`createBooking`）
- Modify: `src/lib/bookings.ts:46-61`（刪除 `hasConflict`——不再需要）

- [ ] **Step 1：把整個 `createBooking` 函式替換為 transaction 實作**

```ts
// Create a booking with atomic conflict check via bucketed locks
export async function createBooking(input: BookingInput): Promise<void> {
  if (!isWithinOneMonth(input.date)) {
    throw new Error('只能預約未來 1 個月內的時段');
  }
  assertAligned(input.startTime);
  assertAligned(input.endTime);
  if (toMinutes(input.endTime) <= toMinutes(input.startTime)) {
    throw new Error('結束時間必須晚於開始時間');
  }

  const createdAt = new Date().toISOString();
  const buckets = expandBuckets(input.startTime, input.endTime);
  const lockRefs = buckets.map((b) =>
    doc(db, 'booking_locks', makeLockId(input.roomId, input.date, b))
  );

  await runTransaction(db, async (tx) => {
    const lockSnaps = await Promise.all(lockRefs.map((ref) => tx.get(ref)));
    if (lockSnaps.some((snap) => snap.exists())) {
      throw new Error('此時段已有預約');
    }
    const bookingRef = doc(collection(db, 'bookings'));
    tx.set(bookingRef, { ...input, createdAt });
    for (const lockRef of lockRefs) {
      tx.set(lockRef, {
        bookingId: bookingRef.id,
        userId: input.userId,
        createdAt,
      });
    }
  });
}
```

- [ ] **Step 2：刪除 `hasConflict` 函式**

把 `bookings.ts` 內 `// Check if a time slot conflicts with existing bookings` 到該函式結束的 block（原 line 46-61）整段刪除——新的 tx 邏輯不再需要。

- [ ] **Step 3：清掉不再使用的 `addDoc` import**

把 imports 中的 `addDoc,` 移除。

如果前一個 task 有留 `eslint-disable` 註解（helpers unused 警告），此時可移除，因為 helpers 都被呼叫了。

- [ ] **Step 4：型別檢查**

Run: `npm run build`
Expected: build succeeds 無警告

- [ ] **Step 5：commit**

```bash
git add src/lib/bookings.ts
git commit -m "fix(bookings): createBooking 改用 transaction + bucketed locks 解 race condition (#7)"
```

---

### Task 1.3: 改寫 `deleteBooking` 簽名與實作

**Files:**
- Modify: `src/lib/bookings.ts:128-130`（`deleteBooking`）
- Modify: `src/components/BookingDetail.tsx:86`（呼叫端）

- [ ] **Step 1：把 `deleteBooking` 替換為收 `Booking` 物件 + batch 刪除**

```ts
// Delete a single booking and its bucket locks atomically
export async function deleteBooking(booking: Booking): Promise<void> {
  const buckets = expandBuckets(booking.startTime, booking.endTime);
  const batch = writeBatch(db);
  batch.delete(doc(db, 'bookings', booking.id));
  for (const b of buckets) {
    batch.delete(
      doc(db, 'booking_locks', makeLockId(booking.roomId, booking.date, b))
    );
  }
  await batch.commit();
}
```

- [ ] **Step 2：更新呼叫端 `BookingDetail.tsx:86`**

把：
```ts
await deleteBooking(booking.id);
```
改成：
```ts
await deleteBooking(booking);
```

- [ ] **Step 3：型別檢查**

Run: `npm run build`
Expected: build succeeds

- [ ] **Step 4：commit**

```bash
git add src/lib/bookings.ts src/components/BookingDetail.tsx
git commit -m "fix(bookings): deleteBooking 改收 Booking 物件並 batch 刪對應 locks"
```

---

### Task 1.4: 改寫 `deleteRepeatBookings` 為單一 batch

**Files:**
- Modify: `src/lib/bookings.ts:133-149`（`deleteRepeatBookings`）

- [ ] **Step 1：替換 `deleteRepeatBookings` 實作**

```ts
// Delete all bookings in a repeat group from a given date onward,
// along with all their bucket locks, in one atomic batch
export async function deleteRepeatBookings(
  repeatGroupId: string,
  fromDate: string
): Promise<number> {
  const q = query(
    collection(db, 'bookings'),
    where('repeatGroupId', '==', repeatGroupId),
    where('date', '>=', fromDate)
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) return 0;

  const batch = writeBatch(db);
  for (const d of snapshot.docs) {
    const b = { id: d.id, ...d.data() } as Booking;
    batch.delete(d.ref);
    for (const bucket of expandBuckets(b.startTime, b.endTime)) {
      batch.delete(
        doc(db, 'booking_locks', makeLockId(b.roomId, b.date, bucket))
      );
    }
  }
  await batch.commit();
  return snapshot.size;
}
```

- [ ] **Step 2：清掉不再使用的 `deleteDoc` import**

把 imports 中的 `deleteDoc,` 移除（`deleteBooking` 與此處都已改用 `writeBatch`）。

- [ ] **Step 3：型別檢查**

Run: `npm run build`
Expected: build succeeds 無警告

- [ ] **Step 4：commit**

```bash
git add src/lib/bookings.ts
git commit -m "fix(bookings): deleteRepeatBookings 改用單一 writeBatch 同刪 bookings 與 locks"
```

---

## Chunk 2: Firestore rules + Migration

### Task 2.1: 新增 `booking_locks` rules

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1：在 `firestore.rules` 中，`match /bookings/{bookingId}` block 之後、`match /users/{userId}` 之前，加入新 match block**

```
match /booking_locks/{lockId} {
  allow read: if request.auth != null;

  // 建立：teacher/admin 可建；lock 的 userId 必須是自己（admin 可代建）
  allow create: if request.auth != null
    && getUserRole() in ['admin', 'teacher']
    && (request.resource.data.userId == request.auth.uid
        || getUserRole() == 'admin');

  // lock 一旦建立不該修改
  allow update: if false;

  // 擁有者或 admin 可刪（同 bookings delete 邏輯）
  allow delete: if request.auth != null
    && (resource.data.userId == request.auth.uid
        || getUserRole() == 'admin');
}
```

- [ ] **Step 2：commit**

```bash
git add firestore.rules
git commit -m "fix(rules): 新增 booking_locks 規則"
```

> **注意：** 此 commit 只改 rules 檔案，實際部署在 Chunk 3。本地 dev 不會受影響；尚未 deploy 前，本機 `npm run dev` 連真實 Firestore 執行 `createBooking` 會被舊 rules 擋（因為會寫新的 `booking_locks` doc）。若需要在 Chunk 3 前先本地驗證，請先手動 `firebase deploy --only firestore:rules`。

---

### Task 2.2: 建立 migration API route

**Files:**
- Create: `src/app/api/admin/migrate-locks/route.ts`

**Rationale:** 為現有 bookings 補建 locks，採 tx-per-booking 並 re-read booking 防孤兒 lock（spec §7.2）。
admin SDK 繞過 client rules，所以 rules 未 deploy 也能跑；但**實務上要等 rules + code 都部署後才按按鈕**（spec §9）。

- [ ] **Step 1：建立 `src/app/api/admin/migrate-locks/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const BUCKET_MINUTES = 30;

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function expandBuckets(startTime: string, endTime: string): string[] {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  const buckets: string[] = [];
  for (let m = start; m < end; m += BUCKET_MINUTES) {
    buckets.push(fromMinutes(m));
  }
  return buckets;
}

interface BookingShape {
  roomId: string;
  date: string;
  startTime: string;
  endTime: string;
  userId: string;
}

export async function POST(request: NextRequest) {
  try {
    const { callerToken } = await request.json();
    if (!callerToken) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    // Verify admin
    const decoded = await adminAuth.verifyIdToken(callerToken);
    const db = getFirestore();
    const callerDoc = await db.collection('users').doc(decoded.uid).get();
    if (!callerDoc.exists || callerDoc.data()?.role !== 'admin') {
      return NextResponse.json({ error: '僅限管理員操作' }, { status: 403 });
    }

    const bookingsSnap = await db.collection('bookings').get();
    let migrated = 0;
    let skipped = 0;
    const errors: Array<{ bookingId: string; message: string }> = [];

    for (const bookingDoc of bookingsSnap.docs) {
      try {
        const result = await db.runTransaction(async (tx) => {
          const freshSnap = await tx.get(bookingDoc.ref);
          if (!freshSnap.exists) return 'skip';
          const booking = freshSnap.data() as BookingShape;
          const buckets = expandBuckets(booking.startTime, booking.endTime);
          const createdAt = new Date().toISOString();
          let created = 0;
          for (const bucket of buckets) {
            const lockId = `${booking.roomId}_${booking.date}_${bucket}`;
            const lockRef = db.collection('booking_locks').doc(lockId);
            const lockSnap = await tx.get(lockRef);
            if (!lockSnap.exists) {
              tx.set(lockRef, {
                bookingId: freshSnap.id,
                userId: booking.userId,
                createdAt,
              });
              created++;
            }
          }
          return created > 0 ? 'migrated' : 'skip';
        });
        if (result === 'migrated') migrated++;
        else skipped++;
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知錯誤';
        errors.push({ bookingId: bookingDoc.id, message });
      }
    }

    return NextResponse.json({
      success: true,
      total: bookingsSnap.size,
      migrated,
      skipped,
      errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知錯誤';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2：型別檢查**

Run: `npm run build`
Expected: build succeeds

- [ ] **Step 3：commit**

```bash
git add src/app/api/admin/migrate-locks/route.ts
git commit -m "feat(admin): 新增 migrate-locks API route 為舊資料補建 bucket locks"
```

---

### Task 2.3: admin 頁加「Backfill booking locks」按鈕

**Files:**
- Modify: `src/app/admin/page.tsx`（`AdminContent` 內加按鈕與 handler）

- [ ] **Step 1：在 `AdminContent` 內加 state 與 handler**

在 `AdminContent` 中現有 `useState` 宣告區（約 line 78-96）之後，新增：
```ts
const [migrateStatus, setMigrateStatus] = useState<string>('');
const [migrating, setMigrating] = useState(false);
```

在 handler 區域（例如 `handleToggleActive` 之後）新增：
```ts
async function handleMigrateLocks() {
  if (!confirm('將為所有現有預約補建 booking_locks，跑第二次會跳過已建立的 lock。繼續？')) return;
  setMigrating(true);
  setMigrateStatus('');
  try {
    const token = await auth.currentUser?.getIdToken();
    const res = await fetch('/api/admin/migrate-locks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callerToken: token }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || '未知錯誤');
    }
    setMigrateStatus(
      `完成：total=${data.total}、migrated=${data.migrated}、skipped=${data.skipped}、errors=${data.errors.length}`
    );
    if (data.errors.length > 0) {
      console.error('Migration errors:', data.errors);
    }
  } catch (err) {
    setMigrateStatus(`失敗：${err instanceof Error ? err.message : '未知錯誤'}`);
  } finally {
    setMigrating(false);
  }
}
```

- [ ] **Step 2：在 `AdminContent` 的 JSX 回傳內加入維運區塊**

在 `return (` 的主要內容區內（約 line 323 之後），選一個明顯位置（建議最上方 `<h1>` 管理頁標題之後），新增：
```tsx
<section className="border border-yellow-400 bg-yellow-50 rounded p-4 mb-4">
  <h2 className="text-sm font-semibold text-yellow-900 mb-2">維運工具（用完請刪）</h2>
  <button
    onClick={handleMigrateLocks}
    disabled={migrating}
    className="bg-yellow-600 text-white rounded px-3 py-1.5 text-sm font-medium hover:bg-yellow-700 disabled:opacity-50"
  >
    {migrating ? '執行中...' : 'Backfill booking locks'}
  </button>
  {migrateStatus && <p className="text-sm text-gray-900 mt-2">{migrateStatus}</p>}
</section>
```

> 精確位置依現有 JSX 結構可微調；重點是顯示在 admin 看得到的地方、樣式能看出是「暫時工具」。

- [ ] **Step 3：型別檢查**

Run: `npm run build`
Expected: build succeeds

- [ ] **Step 4：commit**

```bash
git add src/app/admin/page.tsx
git commit -m "feat(admin): 加 Backfill booking locks 按鈕（一次性，後續會拆）"
```

---

## Chunk 3: Deploy、Migration、Smoke test

此 chunk **不寫 code**，為部署與驗證操作步驟。由實際操作者（通常是 admin 使用者本人）執行。按順序進行，順序關乎正確性（spec §9）。

### Task 3.1: 推分支 + 開 PR

- [ ] **Step 1：推分支**

```bash
git push -u origin fix/7-booking-race-condition
```

- [ ] **Step 2：開 PR**

用 `gh pr create`，PR description 包含：
- 連結 Issue #7
- 連結 spec: `docs/superpowers/specs/2026-04-17-booking-race-condition-fix-design.md`
- 附 Chunk 3 的部署步驟作為 reviewer 與 merger 檢查清單
- 附 §10 的 smoke test 項目作為 checklist

---

### Task 3.2: 部署 rules（**必須先於 code deploy**）

**Why first:** 新 code 的 `createBooking` tx 會寫 `booking_locks` doc；舊 rules 沒有該 collection 的 allow，寫入會被擋 → tx 失敗 → 使用者無法新增預約。

- [ ] **Step 1：部署 rules**

```bash
firebase deploy --only firestore:rules
```

Expected: `✔ Deploy complete!`

- [ ] **Step 2：在 Firebase Console 確認 rules 已生效**

至 Firebase Console → Firestore → Rules → 確認 `booking_locks` block 已在目前生效版本中。

---

### Task 3.3: 部署 code（merge PR 或 push 到 main）

- [ ] **Step 1：merge PR**

PR reviewer 檢視過後 merge 到 main（或直接 push，依專案 flow）。

- [ ] **Step 2：等待 deploy 完成**

若使用 Vercel 自動部署，等 build 綠燈。

---

### Task 3.4: 立即執行 migration（勿拖延）

**Why now:** rules + code 部署完到 migration 跑完之間，新 booking 邏輯「看不到舊 booking 的 lock」，有漏洞。分鐘級內完成。

- [ ] **Step 1：admin 登入網站**

以 admin 身分登入 production URL。

- [ ] **Step 2：前往 `/admin`**

確認頁面頂部有「維運工具（用完請刪）」區塊與「Backfill booking locks」按鈕。

- [ ] **Step 3：按下按鈕、確認 confirm 對話框**

執行中會 disable 按鈕。完成後顯示 `total=N、migrated=M、skipped=K、errors=E`。

- [ ] **Step 4：驗證結果**

- `total` 應等於現有 bookings 總筆數
- `errors` 應為 `0`
- `migrated + skipped` 應等於 `total`
- 第一次執行：`migrated` 通常等於 `total`（除非某些 booking 已有部分 lock）
- 前往 Firebase Console → Firestore → `booking_locks` collection → 確認文件數量符合預期（每個 booking ~2–4 個 lock）

---

### Task 3.5: 驗證（最小 smoke test，spec §10）

- [ ] **Step 1：新增單筆預約成功**

選一個空時段建立預約 → 預約出現於日曆 → Firestore `bookings` 新增一筆、`booking_locks` 新增對應 bucket locks。

- [ ] **Step 2：同時段第二筆被擋**

對剛剛那筆預約的**同 room、同 date、同 startTime** 再建一次 → 彈出「此時段已有預約」。

- [ ] **Step 3：刪除後可再預約**

從 BookingDetail 刪掉剛剛那筆 → 確認 `bookings` 與對應 `booking_locks` 一起消失 → 再預約同時段 → 成功。

- [ ] **Step 4：重複預約建立與刪除**

建一組 4 週的重複預約 → 成功 → 從 BookingDetail 選「取消此週之後」→ 確認 bookings 與 locks 一起被清掉。

- [ ] **Step 5：Migration 冪等**

再次到 `/admin` 按「Backfill booking locks」→ 預期 `migrated=0, skipped=total, errors=0`。

- [ ] **Step 6：admin 代建 + teacher 自刪**

以 admin 身分新增預約、老師欄位選一位 teacher → 登出 → 以該 teacher 身分登入 → 刪該筆預約 → 應成功（驗證 lock 的 `userId` 寫的是 teacher uid，rules 判斷通過）。

---

### Task 3.6: 另開 PR 拆除 migration 工具

完成 smoke test 且無問題後，**另開一個 PR**（不要跟本次合併）拆掉：
- `src/app/api/admin/migrate-locks/route.ts`（整個檔案）
- `src/app/admin/page.tsx` 內 `migrateStatus` state、`handleMigrateLocks` handler、維運工具 JSX 區塊

- [ ] **Step 1：開新分支 `chore/10-remove-migrate-locks`（或類似名稱）**

```bash
git checkout main && git pull
git checkout -b chore/remove-migrate-locks
```

- [ ] **Step 2：刪檔 + 改 admin page**

```bash
rm src/app/api/admin/migrate-locks/route.ts
```
手動編輯 `src/app/admin/page.tsx` 移除相關 state / handler / JSX。

- [ ] **Step 3：型別檢查**

```bash
npm run build
```

- [ ] **Step 4：commit + PR**

```bash
git add -A
git commit -m "chore: 移除 one-off migrate-locks 工具"
git push -u origin chore/remove-migrate-locks
gh pr create --title "chore: 移除 migrate-locks 一次性工具" --body "Issue #7 的 migration 已完成，拆除工具。"
```

---

## 回滾計畫（若出事）

**若 deploy code 後發現問題（migration 前）：**
- 使用者能讀取既有預約（rules 只加不改）
- 但無法新增預約（新 code 會寫 lock，若出錯會 throw）
- **處置：** Vercel 或 hosting 平台 rollback 到前一個版本；rules 無需 rollback（booking_locks rules 對舊 code 無影響）

**若 migration 跑一半噴錯：**
- Migration 冪等，安全重跑
- 檢查 `errors` 陣列中的 bookingId 個別處理

**若 smoke test 失敗：**
- Rollback code（Vercel）
- Rules 暫留無妨（`booking_locks` collection 可直接從 Firebase Console 清空後再試）

---

## Definition of Done

- [x] 所有 Chunk 1 commits 在 branch 上
- [x] 所有 Chunk 2 commits 在 branch 上
- [ ] PR merged、code 已部署
- [ ] Rules 已部署
- [ ] Migration 執行成功（`errors: []`）
- [ ] Smoke test 6 項全綠
- [ ] Migration 工具拆除 PR 已合併
- [ ] Issue #7 關閉
