# Maintenance Mode Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 實作全域維運模式開關：admin 可切換 `settings/maintenance`，非 admin 使用者立即看到全畫面 overlay 且寫入被 Firestore rules 擋下。

**Architecture:** 新增 `settings/maintenance` doc（`{ enabled, message }`）。`AuthProvider` 在 authed 狀態下 subscribe；`AuthGuard` 在 resolved 後決定 render children 還是 `<MaintenanceOverlay>`。Rules 加 `isMaintenanceActive()` guard 到 bookings / booking_locks 寫入條件；settings/maintenance 本身僅 admin 可寫。Overlay 與 rules 兩層職責清楚：overlay 是 UX、rules 是真防護。

**Tech Stack:** Next.js 16、React 19、Firebase 12（Firestore client SDK）、TypeScript。

**Spec:** `docs/superpowers/specs/2026-04-17-maintenance-mode-design.md`

**Testing note:** 依 CLAUDE.md 本專案不引入測試框架。每個實作 task 以 `npm run build` 做型別檢查；端到端驗證走部署後的手動 smoke test（Chunk 4）。

**Deploy order:** 依 CLAUDE.md「rules → code」原則，rules 先部署（Chunk 3 commit 後立即 `firebase deploy --only firestore:rules`），再 merge code 到 main 觸發部署（Chunk 4）。

---

## File Structure

**Create:**
- `src/components/MaintenanceOverlay.tsx` — 純 UI；全畫面 overlay，接 `message` prop
- `src/components/admin/MaintenanceSection.tsx` — admin 控制區塊（toggle + textarea + 套用按鈕）

**Modify:**
- `src/types/index.ts` — 新增 `MaintenanceSettings` 型別
- `src/components/AuthProvider.tsx` — 加 `unsubMaintenance` listener、擴充 context
- `src/components/AuthGuard.tsx` — resolved 後分支判斷是否 render overlay
- `src/app/admin/page.tsx` — 在 `AdminContent` 頂端引入 `<MaintenanceSection>`
- `firestore.rules` — 加 `isMaintenanceActive()` helper、`/settings/maintenance` match、bookings / booking_locks 寫入 guard

**Branch:** `feat/10-maintenance-mode`（從 main 切出）

---

## Chunk 0: 準備分支

### Task 0.1: 從 main 切 feature 分支

- [ ] **Step 1：確認乾淨工作區並拉最新**

```bash
git status                    # 應為 clean
git checkout main
git pull --ff-only origin main
```

- [ ] **Step 2：切新分支**

```bash
git checkout -b feat/10-maintenance-mode
```

Expected：`Switched to a new branch 'feat/10-maintenance-mode'`

---

## Chunk 1: 資料層與 overlay 元件

### Task 1.1: 新增 `MaintenanceSettings` 型別

**Files:**
- Modify: `src/types/index.ts`（檔尾新增）

**Rationale:** 型別先定，後續 AuthProvider / overlay / admin section 都會 import。

- [ ] **Step 1：在 `src/types/index.ts` 檔尾新增型別**

在檔案最後（`export type BookingInput ...` 那行之後）加上：

```ts
export interface MaintenanceSettings {
  enabled: boolean;
  message: string;
}
```

- [ ] **Step 2：型別檢查**

Run: `npm run build`
Expected: build succeeds（新型別沒人用到，不應有警告）

- [ ] **Step 3：commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): 新增 MaintenanceSettings 型別 (#10)"
```

---

### Task 1.2: 擴充 `AuthProvider` 以 subscribe `settings/maintenance`

**Files:**
- Modify: `src/components/AuthProvider.tsx`（整份改寫）

**Rationale:** 新 listener 必須與現有 `users/{uid}` listener 同生命週期——兩者都要 authed 才能讀，且 user 切換 / logout 時一起 teardown。`loading` 需等兩個 snapshot 首次都回來才置 false，避免 overlay flicker race（spec §4.2、§6.3、§9.7）。

- [ ] **Step 1：替換整份 `AuthProvider.tsx`**

```tsx
'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { AppUser, MaintenanceSettings } from '@/types';

interface AuthContextType {
  firebaseUser: User | null;
  appUser: AppUser | null;
  loading: boolean;
  maintenance: MaintenanceSettings;
}

const DEFAULT_MAINTENANCE: MaintenanceSettings = { enabled: false, message: '' };

const AuthContext = createContext<AuthContextType>({
  firebaseUser: null,
  appUser: null,
  loading: true,
  maintenance: DEFAULT_MAINTENANCE,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceSettings>(DEFAULT_MAINTENANCE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    let unsubMaintenance: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);

      // Tear down previous listeners on user change / logout
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }
      if (unsubMaintenance) {
        unsubMaintenance();
        unsubMaintenance = null;
      }

      if (user) {
        // Two independent resolved flags; loading clears only when BOTH first snapshots arrive.
        // Prevents non-admin seeing real UI for a few hundred ms during maintenance (spec §4.2 / §9.7).
        let profileResolved = false;
        let maintenanceResolved = false;
        const tryClearLoading = () => {
          if (profileResolved && maintenanceResolved) setLoading(false);
        };

        unsubProfile = onSnapshot(doc(db, 'users', user.uid), (snap) => {
          setAppUser(snap.exists() ? (snap.data() as AppUser) : null);
          profileResolved = true;
          tryClearLoading();
        });

        unsubMaintenance = onSnapshot(
          doc(db, 'settings', 'maintenance'),
          (snap) => {
            if (snap.exists()) {
              setMaintenance(snap.data() as MaintenanceSettings);
            } else {
              setMaintenance(DEFAULT_MAINTENANCE);
            }
            maintenanceResolved = true;
            tryClearLoading();
          },
          // Fail open: keep maintenance disabled on listener error (spec §6.1).
          // Real protection is rules; overlay is UX only.
          () => {
            setMaintenance(DEFAULT_MAINTENANCE);
            maintenanceResolved = true;
            tryClearLoading();
          }
        );
      } else {
        setAppUser(null);
        setMaintenance(DEFAULT_MAINTENANCE);
        setLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
      if (unsubMaintenance) unsubMaintenance();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ firebaseUser, appUser, loading, maintenance }}>
      {children}
    </AuthContext.Provider>
  );
}
```

- [ ] **Step 2：型別檢查**

Run: `npm run build`
Expected: build succeeds

若 `MaintenanceSettings` import 解析不到，確認 Task 1.1 已 commit。

- [ ] **Step 3：commit**

```bash
git add src/components/AuthProvider.tsx
git commit -m "feat(auth): AuthProvider 擴充 maintenance listener 與 context (#10)"
```

---

### Task 1.3: 新增 `MaintenanceOverlay` 元件

**Files:**
- Create: `src/components/MaintenanceOverlay.tsx`

**Rationale:** 純展示元件，不讀 context、不做副作用；由 AuthGuard 以 props 餵 `message`。Spec §4.1 刻意不含登出按鈕。

- [ ] **Step 1：建立檔案 `src/components/MaintenanceOverlay.tsx`**

```tsx
'use client';

const DEFAULT_MESSAGE = '系統維護中，請稍後再試';

export function MaintenanceOverlay({ message }: { message: string }) {
  const body = message.trim() === '' ? DEFAULT_MESSAGE : message;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/80 p-6">
      <div className="max-w-md rounded-lg bg-white p-8 text-center shadow-xl">
        <h1 className="mb-4 text-2xl font-bold text-gray-900">系統維護中</h1>
        <p className="whitespace-pre-wrap text-gray-700">{body}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2：型別檢查**

Run: `npm run build`
Expected: build succeeds（新檔案未被使用，無警告）

- [ ] **Step 3：commit**

```bash
git add src/components/MaintenanceOverlay.tsx
git commit -m "feat(ui): 新增 MaintenanceOverlay 全畫面維護提示元件 (#10)"
```

---

## Chunk 2: 整合層 — AuthGuard 分支 + Admin 控制區塊

### Task 2.1: 新增 `MaintenanceSection` admin 控制元件

**Files:**
- Create: `src/components/admin/MaintenanceSection.tsx`

**Rationale:** 切成獨立元件避免 `/admin/page.tsx` 再肥（既有檔案已 > 400 行）。元件自行管理表單 state、呼叫 `setDoc` 寫 `settings/maintenance`。Admin 身分不在元件內再檢查——外層 `AdminGuard` 已擋住非 admin。

- [ ] **Step 1：建立資料夾 + 檔案 `src/components/admin/MaintenanceSection.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/AuthProvider';

const MAX_MESSAGE_LEN = 200;

export function MaintenanceSection() {
  const { maintenance } = useAuth();
  const [draftMessage, setDraftMessage] = useState(maintenance.message);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function setEnabled(enabled: boolean) {
    setError('');
    setSaving(true);
    try {
      // setDoc with merge to tolerate doc-doesn't-exist (first toggle creates it)
      await setDoc(
        doc(db, 'settings', 'maintenance'),
        { enabled, message: draftMessage.trim() },
        { merge: true }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '寫入失敗');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-5">
      <h2 className="text-base font-bold text-gray-900 mb-4">系統維護模式</h2>

      <div className="mb-3 text-sm">
        目前狀態：
        {maintenance.enabled ? (
          <span className="ml-1 font-semibold text-red-600">啟用中</span>
        ) : (
          <span className="ml-1 font-semibold text-gray-700">關閉</span>
        )}
      </div>

      <label className="block text-sm text-gray-700 mb-1">
        維護訊息（顯示給非 admin 使用者看；最多 {MAX_MESSAGE_LEN} 字，空白則顯示預設）
      </label>
      <textarea
        value={draftMessage}
        onChange={(e) => setDraftMessage(e.target.value.slice(0, MAX_MESSAGE_LEN))}
        rows={3}
        className="w-full border rounded px-3 py-2 text-sm text-gray-900"
        placeholder="例：系統升級中，預計 30 分鐘"
      />
      <div className="text-xs text-gray-500 mb-3">
        {draftMessage.length} / {MAX_MESSAGE_LEN}
      </div>

      {error && (
        <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        {maintenance.enabled ? (
          <button
            type="button"
            onClick={() => setEnabled(false)}
            disabled={saving}
            className="rounded bg-gray-700 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {saving ? '處理中…' : '關閉維運'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEnabled(true)}
            disabled={saving}
            className="rounded bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {saving ? '處理中…' : '開啟維運'}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2：型別檢查**

Run: `npm run build`
Expected: build succeeds（新元件尚未被使用，無警告）

- [ ] **Step 3：commit**

```bash
git add src/components/admin/MaintenanceSection.tsx
git commit -m "feat(admin): 新增 MaintenanceSection 控制元件 (#10)"
```

---

### Task 2.2: 在 `/admin` 頁面引入 `MaintenanceSection`

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1：加 import**

在 `src/app/admin/page.tsx` 現有 import 區塊（約 line 27，`import Link from 'next/link';` 之後）加一行：

```tsx
import { MaintenanceSection } from '@/components/admin/MaintenanceSection';
```

- [ ] **Step 2：把 `<MaintenanceSection />` 插入 `<main>` 的第一個子元素**

找到 `<main className="max-w-lg mx-auto p-4 space-y-6">`（約 line 332）。
在此 `<main>` 標籤**之後**、`{/* Create user form */}` comment **之前**，加一行：

```tsx
        <MaintenanceSection />
```

使成為 `<main>` 內第一個 block，排在「新增帳號」之上。

- [ ] **Step 3：型別檢查**

Run: `npm run build`
Expected: build succeeds

- [ ] **Step 4：commit**

```bash
git add src/app/admin/page.tsx
git commit -m "feat(admin): /admin 頁面引入 MaintenanceSection (#10)"
```

---

### Task 2.3: 更新 `AuthGuard` 以 render overlay

**Files:**
- Modify: `src/components/AuthGuard.tsx`（整份改寫）

**Rationale:** AuthGuard 現在負責兩個分支：未登入 → redirect `/login`；已登入且維運中且非 admin → render overlay。`loading` spinner 保持原狀（AuthProvider 已處理兩個 snapshot 的聚合）。

- [ ] **Step 1：替換整份 `AuthGuard.tsx`**

```tsx
'use client';

import { useAuth } from './AuthProvider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { MaintenanceOverlay } from './MaintenanceOverlay';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { firebaseUser, appUser, loading, maintenance } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !firebaseUser) {
      router.replace('/login');
    }
  }, [firebaseUser, loading, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">載入中...</p>
      </div>
    );
  }

  if (!firebaseUser) return null;

  // Maintenance overlay: blocks UI for non-admin when enabled (spec §4.2)
  if (maintenance.enabled && appUser?.role !== 'admin') {
    return <MaintenanceOverlay message={maintenance.message} />;
  }

  return <>{children}</>;
}
```

- [ ] **Step 2：型別檢查**

Run: `npm run build`
Expected: build succeeds

- [ ] **Step 3：commit**

```bash
git add src/components/AuthGuard.tsx
git commit -m "feat(auth): AuthGuard 加 maintenance overlay 分支 (#10)"
```

---

## Chunk 3: Firestore rules 變更

**部署前提**：此 chunk 的 commit 必須在 code merge 到 main **之前**先行 `firebase deploy --only firestore:rules` 到 production（依 CLAUDE.md 與 spec §8 的 rules → code 原則）。在本 chunk 內只做 rules 檔案修改與本地語法驗證；實際部署到 production 在 Chunk 4。

### Task 3.1: 新增 `isMaintenanceActive()` helper 到 `firestore.rules`

**Files:**
- Modify: `firestore.rules`

**Rationale:** Helper 先加，後面多個 collection 的 guard 都會呼叫。獨立 commit 讓 diff 乾淨。

- [ ] **Step 1：在 `getUserRole()` 下方新增 helper**

打開 `firestore.rules`，在現有 `getUserRole()` 函式 block（line 4-6）**之後**、`match /rooms/{roomId}` **之前**，加上：

```
    function isMaintenanceActive() {
      return exists(/databases/$(database)/documents/settings/maintenance)
        && get(/databases/$(database)/documents/settings/maintenance).data.enabled == true;
    }
```

縮排與現有 `getUserRole()` 相同（4 格 spaces）。

- [ ] **Step 2：編輯器檢查**

打開 `firestore.rules`，用肉眼確認：
- 新增的 helper 縮排與既有 `getUserRole()` 相同（4 格）
- `function isMaintenanceActive() { ... }` 的 `{}` 配對
- 無尾逗號或語法紅線

正式語法驗證靠 Task 3.5 的 emulator 啟動；最終 production 驗證在 Chunk 4 `firebase deploy` 時 server-side 編譯。

- [ ] **Step 3：commit**

```bash
git add firestore.rules
git commit -m "feat(rules): 新增 isMaintenanceActive helper (#10)"
```

---

### Task 3.2: 新增 `/settings/maintenance` match block

**Files:**
- Modify: `firestore.rules`

**Rationale:** 用精準 path `/settings/maintenance` 而非 wildcard `/settings/{docId}`，避免未來 settings 下新增的敏感 doc 預設可被所有登入者讀取（spec §7.2）。

- [ ] **Step 1：在 `match /rooms/{roomId}` 之前新增 match block**

在 `isMaintenanceActive()` helper 之後、`match /rooms/{roomId}` 之前，加上：

```
    // 只鎖 maintenance 這一份；未來 settings/* 下若有敏感 doc，各自顯式宣告 rules
    match /settings/maintenance {
      allow read: if request.auth != null;
      allow write: if request.auth != null && getUserRole() == 'admin';
    }
```

- [ ] **Step 2：編輯器檢查括號配對**

確認 `service` / `match /databases/{database}/documents` / 新增的 `match /settings/maintenance` / 既有的 `match /rooms` 等 block 的 `{}` 都對齊。

- [ ] **Step 3：commit**

```bash
git add firestore.rules
git commit -m "feat(rules): 新增 settings/maintenance match block (#10)"
```

---

### Task 3.3: `/bookings/{bookingId}` 寫入條件加 maintenance guard

**Files:**
- Modify: `firestore.rules`

**Rationale:** `create` / `update` / `delete` 三個 allow 各追加同一條件 `(!isMaintenanceActive() || getUserRole() == 'admin')`。保留既有 userId ownership 檢查。

- [ ] **Step 1：修改 `match /bookings/{bookingId}` 內的三個 allow 條件**

找到既有：
```
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
```

改成：
```
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
```

- [ ] **Step 2：commit**

```bash
git add firestore.rules
git commit -m "feat(rules): bookings 寫入加 maintenance guard (#10)"
```

---

### Task 3.4: `/booking_locks/{lockId}` 寫入條件加 maintenance guard

**Files:**
- Modify: `firestore.rules`

**Rationale:** `create` / `delete` 兩個 allow 各追加 maintenance guard。**保留** `getAfter()` 跨 doc 驗證（#7 防 lock-squatting 的核心，不要動）與既有註解。`update: if false` 維持。

- [ ] **Step 1：修改 `match /booking_locks/{lockId}` 內的 create 與 delete**

找到既有：
```
      // 建立：teacher/admin 可建；lock 的 userId 必須是自己（admin 可代建）；
      // 且 lock 必須指到同 tx 建立（或既存）的 booking，且 userId 一致，
      // 防止直接建 lock 卡時段而不建 booking 的 DoS（#7 後續硬化）
      allow create: if request.auth != null
        && getUserRole() in ['admin', 'teacher']
        && (request.resource.data.userId == request.auth.uid
            || getUserRole() == 'admin')
        && getAfter(/databases/$(database)/documents/bookings/$(request.resource.data.bookingId))
            .data.userId == request.resource.data.userId;

      // lock 一旦建立不該修改
      allow update: if false;

      // 擁有者或 admin 可刪（同 bookings delete 邏輯）
      allow delete: if request.auth != null
        && (resource.data.userId == request.auth.uid
            || getUserRole() == 'admin');
```

改成（保留原註解、僅追加 maintenance 條件）：
```
      // 建立：teacher/admin 可建；lock 的 userId 必須是自己（admin 可代建）；
      // 且 lock 必須指到同 tx 建立（或既存）的 booking，且 userId 一致，
      // 防止直接建 lock 卡時段而不建 booking 的 DoS（#7 後續硬化）
      allow create: if request.auth != null
        && getUserRole() in ['admin', 'teacher']
        && (request.resource.data.userId == request.auth.uid
            || getUserRole() == 'admin')
        && getAfter(/databases/$(database)/documents/bookings/$(request.resource.data.bookingId))
            .data.userId == request.resource.data.userId
        && (!isMaintenanceActive() || getUserRole() == 'admin');

      // lock 一旦建立不該修改
      allow update: if false;

      // 擁有者或 admin 可刪（同 bookings delete 邏輯）
      allow delete: if request.auth != null
        && (resource.data.userId == request.auth.uid
            || getUserRole() == 'admin')
        && (!isMaintenanceActive() || getUserRole() == 'admin');
```

（`users` collection 刻意不加 guard，見 spec §7.5。）

- [ ] **Step 2：commit**

```bash
git add firestore.rules
git commit -m "feat(rules): booking_locks 寫入加 maintenance guard (#10)"
```

---

### Task 3.5: 用 Firestore emulator 驗證 rules 語法

**Files:** 無檔案異動

**Rationale:** Firebase CLI 沒有 `firestore:rules --dry-run`。最實際的 pre-deploy 驗證是啟動 emulator，它會編譯 rules；若語法錯誤會立即在終端報錯。真正的 production 部署（server-side compile）留到 Chunk 4。

- [ ] **Step 1：啟動 emulator**

Run: `npx firebase emulators:start --only firestore`

Expected：輸出含 `✔  firestore: Firestore Emulator UI ...` 與 `All emulators ready!`。**無** `Error: ... in firestore.rules` 或 `failed to parse rules` 訊息。

若看到 compile error，依訊息修正（常見：括號不配對、`;` 多餘、路徑 literal 拼錯），重跑。

- [ ] **Step 2：Ctrl-C 關閉 emulator**

Rules 驗證完畢即可停；本 feature 沒有 emulator-based 測試需求。

- [ ] **Step 3：若有修正 rules，commit amendments**

```bash
git add firestore.rules
git commit -m "fix(rules): 修正 maintenance guard 語法 (#10)"
```

若 Step 1 一次通過，此 step 可略。

---

## Chunk 4: 部署與 smoke test

**這個 chunk 是真正「上線」的步驟。**前置條件：Chunk 0–3 所有 task 都完成並 commit 在 `feat/10-maintenance-mode` 分支。

部署順序依 CLAUDE.md 與 spec §8：**rules 先部署到 production，code 後 merge**。

### Task 4.1: 部署 Firestore rules 到 production

**Files:** 無檔案異動

**Rationale:** Rules 只加 guard 但 `settings/maintenance` doc 尚未存在（`exists()` 回 false），所以現有寫入路徑不受影響；但非 admin 寫 `settings/maintenance` 已被擋。先部署安全。

- [ ] **Step 1：執行部署**

Run: `npx firebase deploy --only firestore:rules`

Expected：
- 輸出含 `✔  cloud.firestore: released rules firestore.rules to cloud.firestore`
- 最後一行為 `✔  Deploy complete!`
- **若看到 compile error**：回頭 fix（最可能是 Chunk 3 本地 emulator 驗證漏掉的邊界問題），commit、重跑

- [ ] **Step 2：立即煙霧驗證舊路徑未壞**

以現有（未維運）teacher 帳號登入 `/` → 新增一筆 booking → 應成功。
若失敗，極可能是 rules 的 guard 語法擋到 happy path；**立刻 rollback**，依序執行：

```bash
git stash                                    # 或：git checkout <prior-sha> -- firestore.rules
npx firebase deploy --only firestore:rules   # 重新部署舊版 rules 到 production
git stash pop                                # 恢復工作區，待修正後重做
```

rollback 完成後，回頭檢視 Chunk 3 哪個 task 出錯（多半是 Task 3.3 / 3.4 括號或短路邏輯），修掉再重跑 Task 4.1。

---

### Task 4.2: Push 分支、建立 PR、merge 到 main

**Files:** 無檔案異動

**Rationale:** Rules 已在 production；此時 merge code 進 main 觸發前端部署。

- [ ] **Step 1：push 分支**

```bash
git push -u origin feat/10-maintenance-mode
```

- [ ] **Step 2：建立 PR**

```bash
gh pr create --title "feat: 維運模式（Maintenance Mode）實作 (#10)" --body "$(cat <<'EOF'
## Summary
- 新增 `settings/maintenance` 全域開關：admin 可切換啟用 / 訊息
- 非 admin 使用者在啟用期間看到全畫面維護 overlay
- Firestore rules 擋 bookings / booking_locks 寫入（admin 不受影響）
- 保留 #7 `booking_locks` getAfter 驗證與原註解

Spec: `docs/superpowers/specs/2026-04-17-maintenance-mode-design.md`
Plan: `docs/superpowers/plans/2026-04-17-maintenance-mode.md`

## Deploy note
Rules 已先部署（Chunk 4 Task 4.1）。此 PR merge 觸發 code 部署。

## Test plan
- [ ] 預設狀態（doc 不存在）所有使用者正常
- [ ] Admin 開啟維運 → teacher / student 看到 overlay；admin 自己不受影響
- [ ] Rules 擋 teacher 直接呼叫 `createBooking`
- [ ] Admin 關閉維運 → overlay 消失，teacher 可正常預約
- [ ] Race / loading 邊界測試（Chunk 4 Task 4.3 step 6-7）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3：merge PR**

在 GitHub UI 按 merge，或：
```bash
gh pr merge --squash --delete-branch
```

---

### Task 4.3: 生產環境手動 smoke test

**Files:** 無檔案異動

**Rationale:** Spec §9 全部 7 個情境；這是本 feature 的真實驗收。**必須在 production 跑**（本專案不引入自動化測試）。

前置：準備三個測試帳號（admin / teacher / student）。建議另開一個 incognito window 給其中一個角色，方便比對。

- [ ] **Step 1：預設狀態驗證**

確認 `settings/maintenance` doc 尚未存在（Firestore console 檢查）。
所有角色登入 `/` → 看到正常課表；無 overlay。

- [ ] **Step 2：開啟維運**

Admin 帳號登入 `/admin` → MaintenanceSection 顯示「目前狀態：關閉」。
填訊息「系統升級中，預計 30 分鐘」→ 按「開啟維運」。
Firestore console 檢查 `settings/maintenance` doc 已建立，`enabled: true`。

- [ ] **Step 3：驗證 admin 不受影響**

Admin 回 `/` → 仍看到完整課表，可新增 / 刪除 booking。

- [ ] **Step 4：驗證非 admin 被擋**

Teacher 帳號在另一 window（不需 refresh）→ 應在 1 秒內看到全畫面 overlay，訊息為「系統升級中，預計 30 分鐘」。
Student 帳號同步測試 → 同樣看到 overlay。

- [ ] **Step 5：驗證 rules 擋寫入（best-effort）**

Next.js production bundle 裡 `firebase/firestore` 沒有全域暴露，直接從 DevTools console 呼叫很難（bare-specifier 無法 resolve）。實務上最可靠的驗證方式是**下一步的切換瞬間 race**——它就包含「送出寫入 → permission-denied」的觀察。此步驟列出但可跳過；rules 的真正驗證仰賴 Chunk 3 emulator + Task 4.1 成功部署 + Step 6 的行為確認。

若開發者熟悉 React DevTools 或專案有額外 debug hook 可直接呼叫 `createBooking`，鼓勵實地驗證 `FirebaseError: ... permission-denied` 有正確觸發。

- [ ] **Step 6：切換瞬間 race（spec §6.3 / §9.6）**

1. Admin 先**關掉**維運（回到正常狀態）
2. Teacher 打開新增 booking modal、填好資料但**還沒按送出**
3. Admin 另一個 window 按「開啟維運」
4. Teacher 按送出 → **期望**：跳 permission-denied 錯誤訊息，然後 overlay 覆蓋整個畫面

- [ ] **Step 7：Snapshot loading race（spec §9.7）**

維持維運開啟狀態。
Teacher 關閉分頁，重新打開 `/`。
**期望**：看到「載入中…」直到兩個 snapshot 都 resolved，接著直接進入 overlay。**不應**短暫看到正常課表。

- [ ] **Step 8：關閉維運**

Admin 按「關閉維運」→ 所有 teacher / student window 的 overlay 在幾秒內自動消失（不需 refresh）。
Teacher 新增 booking → 成功。

- [ ] **Step 9：邊界 — 訊息空白**

Admin 把 message 清空 → 開啟 → teacher 看到 overlay 的 fallback「系統維護中，請稍後再試」。

- [ ] **Step 10：邊界 — 訊息長度上限**

Admin 試貼 250 字訊息 → textarea 只接受前 200 字；計數器顯示 `200 / 200`。開啟後 overlay 正常換行不溢位。

- [ ] **Step 11：邊界 — 非 admin 直接寫 `settings/maintenance`**

與 Step 5 同樣的限制：Next.js production bundle 沒有全域暴露 `firebase/firestore`，DevTools console 難以 bare-specifier import。此 step 列出但可跳過；rules 的讀寫分層已由 Task 3.2 的 emulator 驗證 + Task 4.1 的 production 部署成功保證。

若專案有 debug hook 或開發者熟悉 React DevTools 能取得既有 `db` binding，可嘗試：
```js
// 偽代碼：從 React DevTools 拿到 db 後
setDoc(doc(db, 'settings', 'maintenance'), { enabled: true, message: 'hack' })
  .catch(err => console.error(err));
// Expected：FirebaseError: Missing or insufficient permissions.
```

- [ ] **Step 12：最後清乾淨**

Admin 確認把維運關閉（`enabled: false`），結束驗收。

---

### Task 4.4: 關閉 Issue #10

**Files:** 無檔案異動

- [ ] **Step 1：於 GitHub 手動關閉或加留言**

```bash
gh issue comment 10 --body "已實作並上線，詳見 PR（merge 後自動連結）與 spec/plan。驗收通過。"
gh issue close 10
```

---

## 收尾檢核

- [ ] Spec（`docs/superpowers/specs/2026-04-17-maintenance-mode-design.md`）反映最終實作
- [ ] Plan（本文件）所有 checkbox 打勾
- [ ] PR merged，branch 刪除
- [ ] Rules deployed，code deployed
- [ ] Smoke test §9 所有情境通過
- [ ] Issue #10 closed


