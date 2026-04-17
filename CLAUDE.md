@AGENTS.md

## Sharp edges（從 Issue #7 race condition fix 學到的）

### Firestore transactions：讀必須全部在寫之前
`tx.get` 出現在 `tx.set` 之後會噴「transactions require all reads to be executed before all writes.」多個 doc 時，一律先 `Promise.all(refs.map(tx.get))` 讀完，再進迴圈 `tx.set`。**不要在 for-loop 裡 get/set 交錯。**
參考：`src/lib/bookings.ts` 的 `createBooking`。

### Rules 跨 doc 驗證同 tx：用 `getAfter()`，不是 `exists()`
當 rule 要驗證「同一個 tx 正在建立的另一個 doc」，必須用 `getAfter()`（post-tx 狀態）。`exists()` / `get()` 看 pre-tx 狀態，會擋掉 happy path。
參考：`firestore.rules` 的 `/booking_locks/ allow create` block。

### Rules 先部署、code 後部署
若新 code 會寫新 collection，**先** `firebase deploy --only firestore:rules`、再 merge PR。順序反過來的話新 tx 會被舊 rules 擋。
全域部署順序：rules → code → migration（分鐘級緊接，避免空窗期）。

### 沒有自動化測試
專案沒裝 vitest / jest / playwright。型別靠 `npm run build`；行為靠部署後手動 smoke test。**未經使用者同意不要擅自導入測試框架**（spec §10 討論過、使用者選擇不導入）。

### Admin API route pattern
路徑 `src/app/api/admin/*`，結構：
```ts
const { callerToken, ...params } = await request.json();
const decoded = await adminAuth.verifyIdToken(callerToken);
const callerDoc = await getFirestore().collection('users').doc(decoded.uid).get();
if (callerDoc.data()?.role !== 'admin') return 403;
```
Token 放在 JSON body 的 `callerToken` 欄位。參考：`src/app/api/admin/update-user/route.ts`。

### 預約時間固定 30 分鐘對齊
UI grid 只有 `HH:00` / `HH:30`；duration 選項 30/60/90/120。後端 `createBooking` 會 `assertAligned()`。這是 bucketed locks 能成立的前提——**若未來開放非對齊時段，lock 模型會崩**。

### Bucketed-lock 不變量（#7）
每筆 `bookings/{id}` 對應 N 個 `booking_locks/{roomId}_{date}_{bucket}` doc（每 30 分鐘一個 bucket）。
- create：同 tx 一起寫（`runTransaction`）
- delete / repeat-delete：同 batch 一起刪（`writeBatch`）
- Lock 的 `userId` = `booking.userId`（擁有老師的 uid），**不是**呼叫端的 uid。Admin 代老師建預約時，lock 仍寫老師 uid，這樣老師才能自己刪除。

完整設計：`docs/superpowers/specs/2026-04-17-booking-race-condition-fix-design.md`

### Admin 可代 teacher 建預約
`BookingModal` 有 `isAdmin && teachers` 流程，`input.userId` 會是被選中的老師 uid。任何 rules / route / lock 邏輯都要支援「寫入的 userId != auth.uid」的 admin 情境。

### 併發測試的 cost
Firestore 端到端併發驗證在本機很難重現；race 觸發窗口常在毫秒內。寫新 rules / tx 邏輯時，靠 code inspection + 部署後 smoke test，不要指望 local repro。
