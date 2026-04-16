# Music Room Booking Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-friendly music room booking system for 新米蘭音樂教室 with 7 rooms, login-gated access, day/week calendar views, and repeat booking support.

**Architecture:** Next.js 15 App Router with Firebase Auth (email/password) and Firestore for data. Client-side React app with Firestore real-time listeners for live updates. Deployed to Vercel with automatic CI/CD from GitHub.

**Tech Stack:** Next.js 15, TypeScript, Tailwind CSS 4, Firebase 11 (Auth + Firestore), Vercel

**Spec:** `docs/superpowers/specs/2026-04-16-music-room-booking-design.md`

**Note:** The spec lists `/booking` as a separate route, but the plan uses modals on `/` for a better UX — no page navigation needed for booking operations.

**GitHub:** `mako-debug/music-room-booking` (repo already created)

**Project directory:** `C:/Users/makoh/OneDrive/Mako/新米蘭/music-room-booking`

---

## File Structure

```
music-room-booking/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout: global font, Tailwind, AuthProvider wrapper
│   │   ├── page.tsx                # Home page: calendar view (protected by AuthGuard)
│   │   ├── login/
│   │   │   └── page.tsx            # Login form page
│   │   └── globals.css             # Tailwind imports + custom styles
│   ├── components/
│   │   ├── AuthGuard.tsx           # Redirects to /login if not authenticated
│   │   ├── AuthProvider.tsx        # React context providing auth state to entire app
│   │   ├── Header.tsx              # Top nav: school name, user name, view toggle, date nav, logout
│   │   ├── Calendar/
│   │   │   ├── DayView.tsx         # Day view: 7 rooms × time slots (08:00-22:00, 30min)
│   │   │   ├── WeekView.tsx        # Week view: 1 room × 7 days, room selector dropdown
│   │   │   └── TimeSlot.tsx        # Single 30-min cell: shows booking or clickable empty
│   │   ├── BookingModal.tsx        # Create booking modal: room, date, time, duration, student, repeat
│   │   └── BookingDetail.tsx       # View/cancel booking modal: shows details + cancel button
│   ├── lib/
│   │   ├── firebase.ts             # Firebase app + auth + firestore initialization
│   │   ├── auth.ts                 # signIn, signOut helper functions
│   │   ├── bookings.ts            # Firestore CRUD: create, delete, subscribe to bookings
│   │   └── seed.ts                 # One-time script: create 7 rooms in Firestore
│   └── types/
│       └── index.ts                # TypeScript interfaces: User, Room, Booking, UserRole
├── firestore.rules                 # Firestore security rules
├── firestore.indexes.json          # Composite indexes
├── public/
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.ts
├── .env.local                      # Firebase config (not committed)
├── .env.example                    # Template for .env.local
└── .gitignore
```

---

## Chunk 1: Project Setup + Auth

### Task 1: Scaffold Next.js project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `src/app/globals.css`, `src/app/layout.tsx`, `.gitignore`, `.env.example`

- [ ] **Step 1: Create Next.js project with TypeScript + Tailwind**

```bash
cd "C:/Users/makoh/OneDrive/Mako/新米蘭/music-room-booking"
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
```

Select defaults when prompted. This scaffolds the entire Next.js project with App Router.

- [ ] **Step 2: Install Firebase SDK**

```bash
npm install firebase uuid
npm install -D @types/uuid
```

- [ ] **Step 3: Create `.env.example`**

Create `C:/Users/makoh/OneDrive/Mako/新米蘭/music-room-booking/.env.example`:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

- [ ] **Step 4: Create `.env.local` with actual Firebase config**

User must provide Firebase project config from Firebase Console → Project Settings → Web App.

Create `C:/Users/makoh/OneDrive/Mako/新米蘭/music-room-booking/.env.local` with real values.

- [ ] **Step 5: Verify `.gitignore` includes `.env.local`**

Ensure `.env.local` is listed in `.gitignore` (Next.js default includes it).

- [ ] **Step 6: Run dev server to verify scaffold works**

```bash
npm run dev
```

Open http://localhost:3000 — should see Next.js default page.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js 15 + Tailwind + Firebase SDK"
```

---

### Task 2: TypeScript types

**Files:**
- Create: `src/types/index.ts`

- [ ] **Step 1: Define all TypeScript interfaces**

Create `src/types/index.ts`:

```typescript
export type UserRole = 'admin' | 'teacher' | 'student';

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}

export interface Room {
  id: string;
  name: string;
  order: number;
}

export interface Booking {
  id: string;
  roomId: string;
  date: string;           // "YYYY-MM-DD"
  startTime: string;      // "HH:mm"
  endTime: string;        // "HH:mm"
  userId: string;
  userName: string;
  studentName: string;
  purpose?: string;
  repeatGroupId?: string;
  createdAt: string;
}

// Used when creating a new booking (id and createdAt are auto-generated)
export type BookingInput = Omit<Booking, 'id' | 'createdAt'>;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add TypeScript type definitions"
```

---

### Task 3: Firebase initialization

**Files:**
- Create: `src/lib/firebase.ts`

- [ ] **Step 1: Create Firebase init module**

Create `src/lib/firebase.ts`:

```typescript
import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export const db = getFirestore(app);
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/firebase.ts
git commit -m "feat: add Firebase initialization"
```

---

### Task 4: Auth helpers + AuthProvider + AuthGuard

**Files:**
- Create: `src/lib/auth.ts`, `src/components/AuthProvider.tsx`, `src/components/AuthGuard.tsx`

- [ ] **Step 1: Create auth helper functions**

Create `src/lib/auth.ts`:

```typescript
import { signInWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { AppUser } from '@/types';

export async function signIn(email: string, password: string) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

export async function signOut() {
  await firebaseSignOut(auth);
}

export async function fetchUserProfile(uid: string): Promise<AppUser | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  return snap.data() as AppUser;
}
```

- [ ] **Step 2: Create AuthProvider context**

Create `src/components/AuthProvider.tsx`:

```typescript
'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { fetchUserProfile } from '@/lib/auth';
import { AppUser } from '@/types';

interface AuthContextType {
  firebaseUser: User | null;
  appUser: AppUser | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  firebaseUser: null,
  appUser: null,
  loading: true,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        const profile = await fetchUserProfile(user.uid);
        setAppUser(profile);
      } else {
        setAppUser(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ firebaseUser, appUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
```

- [ ] **Step 3: Create AuthGuard component**

Create `src/components/AuthGuard.tsx`:

```typescript
'use client';

import { useAuth } from './AuthProvider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { firebaseUser, loading } = useAuth();
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

  return <>{children}</>;
}
```

- [ ] **Step 4: Wire AuthProvider into root layout**

Replace `src/app/layout.tsx`:

```typescript
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: '新米蘭音樂教室 — 琴房預約',
  description: '琴房預約系統',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className={inter.className}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth.ts src/components/AuthProvider.tsx src/components/AuthGuard.tsx src/app/layout.tsx
git commit -m "feat: add auth helpers, AuthProvider context, and AuthGuard"
```

---

### Task 5: Login page

**Files:**
- Create: `src/app/login/page.tsx`

- [ ] **Step 1: Create login page**

Create `src/app/login/page.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from '@/lib/auth';
import { useAuth } from '@/components/AuthProvider';
import { useEffect } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const { firebaseUser, loading } = useAuth();

  useEffect(() => {
    if (!loading && firebaseUser) {
      router.replace('/');
    }
  }, [firebaseUser, loading, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await signIn(email, password);
      router.push('/');
    } catch {
      setError('帳號或密碼錯誤');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">載入中...</p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-lg shadow p-6">
        <h1 className="text-xl font-bold text-center mb-6">新米蘭音樂教室</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="email@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密碼</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 text-white py-2 rounded font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? '登入中...' : '登入'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update home page to use AuthGuard (placeholder)**

Replace `src/app/page.tsx`:

```typescript
'use client';

import { AuthGuard } from '@/components/AuthGuard';
import { useAuth } from '@/components/AuthProvider';
import { signOut } from '@/lib/auth';

export default function HomePage() {
  return (
    <AuthGuard>
      <HomeContent />
    </AuthGuard>
  );
}

function HomeContent() {
  const { appUser } = useAuth();

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-lg font-bold">新米蘭音樂教室</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">{appUser?.displayName}</span>
          <button
            onClick={() => signOut()}
            className="text-sm text-red-500 hover:underline"
          >
            登出
          </button>
        </div>
      </div>
      <p className="text-gray-500">日曆將在下一步實作...</p>
    </div>
  );
}
```

- [ ] **Step 3: Run dev server and test login flow**

```bash
npm run dev
```

1. Open http://localhost:3000 → should redirect to `/login`
2. Login with test credentials (requires Firebase account to exist)
3. After login → redirect to `/` → see placeholder + user name + logout

- [ ] **Step 4: Commit**

```bash
git add src/app/login/page.tsx src/app/page.tsx
git commit -m "feat: add login page and auth-guarded home page"
```

---

### Task 6: Seed rooms data + Firestore rules

**Files:**
- Create: `src/lib/seed.ts`, `firestore.rules`, `firestore.indexes.json`

- [ ] **Step 1: Create seed script**

Create `src/lib/seed.ts`:

```typescript
import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

const rooms = [
  { id: 'room-1', name: '1號教室', order: 1 },
  { id: 'room-2', name: '2號教室', order: 2 },
  { id: 'room-3', name: '3號教室', order: 3 },
  { id: 'room-4', name: '4號教室', order: 4 },
  { id: 'room-5', name: '5號教室', order: 5 },
  { id: 'room-6', name: '6號教室', order: 6 },
  { id: 'room-7', name: '7號教室', order: 7 },
];

export async function seedRooms() {
  for (const room of rooms) {
    await setDoc(doc(db, 'rooms', room.id), room);
  }
  console.log('Seeded 7 rooms');
}
```

This will be called once from the browser console or a temporary button.

- [ ] **Step 2: Create Firestore security rules file**

Create `firestore.rules`:

```
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
    }
  }
}
```

- [ ] **Step 3: Create composite indexes file**

Create `firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "bookings",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "roomId", "order": "ASCENDING" },
        { "fieldPath": "date", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "bookings",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "repeatGroupId", "order": "ASCENDING" },
        { "fieldPath": "date", "order": "ASCENDING" }
      ]
    }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/seed.ts firestore.rules firestore.indexes.json
git commit -m "feat: add room seed data, Firestore rules, and composite indexes"
```

---

## Chunk 2: Bookings CRUD + Calendar Views

### Task 7: Bookings Firestore CRUD

**Files:**
- Create: `src/lib/bookings.ts`

- [ ] **Step 1: Create bookings module with all CRUD operations**

Create `src/lib/bookings.ts`:

```typescript
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  getDocs,
} from 'firebase/firestore';
import { db } from './firebase';
import { Booking, BookingInput } from '@/types';

// Subscribe to bookings for a single date (day view)
export function subscribeToDateBookings(
  date: string,
  callback: (bookings: Booking[]) => void
) {
  const q = query(collection(db, 'bookings'), where('date', '==', date));
  return onSnapshot(q, (snapshot) => {
    const bookings = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Booking));
    callback(bookings);
  });
}

// Subscribe to bookings for a date range + specific room (week view)
export function subscribeToWeekBookings(
  startDate: string,
  endDate: string,
  roomId: string,
  callback: (bookings: Booking[]) => void
) {
  const q = query(
    collection(db, 'bookings'),
    where('roomId', '==', roomId),
    where('date', '>=', startDate),
    where('date', '<=', endDate)
  );
  return onSnapshot(q, (snapshot) => {
    const bookings = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Booking));
    callback(bookings);
  });
}

// Check if a time slot conflicts with existing bookings
function hasConflict(
  existingBookings: Booking[],
  roomId: string,
  date: string,
  startTime: string,
  endTime: string
): boolean {
  return existingBookings.some(
    (b) =>
      b.roomId === roomId &&
      b.date === date &&
      b.startTime < endTime &&
      b.endTime > startTime
  );
}

// Validate booking date is within 1 month from today
function isWithinOneMonth(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const bookingDate = new Date(dateStr);
  const oneMonthLater = new Date(today);
  oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);
  return bookingDate >= today && bookingDate <= oneMonthLater;
}

// Create a booking with conflict check
// Note: Firestore client-side transactions cannot use queries, so we
// use a read-then-write approach with getDocs. For this low-concurrency
// scenario (single music school), this is sufficient.
export async function createBooking(input: BookingInput): Promise<void> {
  if (!isWithinOneMonth(input.date)) {
    throw new Error('只能預約未來 1 個月內的時段');
  }

  // Check for conflicts
  const q = query(
    collection(db, 'bookings'),
    where('roomId', '==', input.roomId),
    where('date', '==', input.date)
  );
  const snapshot = await getDocs(q);
  const existing = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Booking));

  if (hasConflict(existing, input.roomId, input.date, input.startTime, input.endTime)) {
    throw new Error('此時段已有預約');
  }

  await addDoc(collection(db, 'bookings'), {
    ...input,
    createdAt: new Date().toISOString(),
  });
}

// Create multiple bookings for repeat scheduling
export async function createRepeatBookings(
  inputs: BookingInput[]
): Promise<{ success: string[]; conflicts: string[] }> {
  const results = { success: [] as string[], conflicts: [] as string[] };

  for (const input of inputs) {
    try {
      await createBooking(input);
      results.success.push(input.date);
    } catch {
      results.conflicts.push(input.date);
    }
  }

  return results;
}

// Delete a single booking
export async function deleteBooking(bookingId: string): Promise<void> {
  await deleteDoc(doc(db, 'bookings', bookingId));
}

// Delete all bookings in a repeat group from a given date onward
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
  let count = 0;
  for (const d of snapshot.docs) {
    await deleteDoc(d.ref);
    count++;
  }
  return count;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/bookings.ts
git commit -m "feat: add bookings Firestore CRUD with conflict detection"
```

---

### Task 8: Header component

**Files:**
- Create: `src/components/Header.tsx`

- [ ] **Step 1: Create Header component**

Create `src/components/Header.tsx`:

```typescript
'use client';

import { useAuth } from './AuthProvider';
import { signOut } from '@/lib/auth';

interface HeaderProps {
  viewMode: 'day' | 'week';
  onViewModeChange: (mode: 'day' | 'week') => void;
  // Day view
  currentDate: string;
  onDateChange: (date: string) => void;
  // Week view
  selectedRoomId: string;
  onRoomChange: (roomId: string) => void;
  rooms: { id: string; name: string }[];
}

export function Header({
  viewMode,
  onViewModeChange,
  currentDate,
  onDateChange,
  selectedRoomId,
  onRoomChange,
  rooms,
}: HeaderProps) {
  const { appUser } = useAuth();

  function shiftDate(days: number) {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + days);
    onDateChange(d.toISOString().split('T')[0]);
  }

  function shiftWeek(weeks: number) {
    shiftDate(weeks * 7);
  }

  const dateObj = new Date(currentDate);
  const weekStart = new Date(dateObj);
  weekStart.setDate(dateObj.getDate() - dateObj.getDay() + 1); // Monday
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const formatDate = (d: Date) =>
    `${d.getMonth() + 1}/${d.getDate()}`;

  const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][dateObj.getDay()];

  return (
    <header className="bg-white border-b px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-lg font-bold">新米蘭音樂教室</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">{appUser?.displayName}</span>
          <button
            onClick={() => signOut()}
            className="text-sm text-red-500 hover:underline"
          >
            登出
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <select
            value={viewMode}
            onChange={(e) => onViewModeChange(e.target.value as 'day' | 'week')}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="day">日</option>
            <option value="week">週</option>
          </select>

          {viewMode === 'week' && (
            <select
              value={selectedRoomId}
              onChange={(e) => onRoomChange(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            >
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => (viewMode === 'day' ? shiftDate(-1) : shiftWeek(-1))}
            className="px-2 py-1 text-sm border rounded hover:bg-gray-100"
          >
            &lt;
          </button>
          <span className="text-sm font-medium min-w-[120px] text-center">
            {viewMode === 'day'
              ? `${dateObj.getMonth() + 1}/${dateObj.getDate()}（${dayOfWeek}）`
              : `${formatDate(weekStart)} ~ ${formatDate(weekEnd)}`}
          </span>
          <button
            onClick={() => (viewMode === 'day' ? shiftDate(1) : shiftWeek(1))}
            className="px-2 py-1 text-sm border rounded hover:bg-gray-100"
          >
            &gt;
          </button>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Header.tsx
git commit -m "feat: add Header component with view toggle and date navigation"
```

---

### Task 9: TimeSlot component

**Files:**
- Create: `src/components/Calendar/TimeSlot.tsx`

- [ ] **Step 1: Create TimeSlot component**

Create `src/components/Calendar/TimeSlot.tsx`:

```typescript
'use client';

import { Booking } from '@/types';

interface TimeSlotProps {
  booking?: Booking;
  onClick: () => void;
  canBook: boolean;
}

export function TimeSlot({ booking, onClick, canBook }: TimeSlotProps) {
  if (booking) {
    return (
      <div
        onClick={onClick}
        className="bg-blue-100 border border-blue-300 rounded px-1 py-0.5 cursor-pointer hover:bg-blue-200 h-full flex flex-col justify-center"
      >
        <p className="text-xs font-medium text-blue-800 truncate">
          {booking.userName}
        </p>
        <p className="text-xs text-blue-600 truncate">{booking.studentName}</p>
      </div>
    );
  }

  if (!canBook) {
    return <div className="h-full" />;
  }

  return (
    <div
      onClick={onClick}
      className="h-full cursor-pointer hover:bg-green-50 rounded"
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Calendar/TimeSlot.tsx
git commit -m "feat: add TimeSlot component"
```

---

### Task 10: DayView component

**Files:**
- Create: `src/components/Calendar/DayView.tsx`

- [ ] **Step 1: Create DayView component**

Create `src/components/Calendar/DayView.tsx`:

```typescript
'use client';

import { Booking, Room } from '@/types';
import { TimeSlot } from './TimeSlot';

interface DayViewProps {
  date: string;
  rooms: Room[];
  bookings: Booking[];
  canBook: boolean;
  onEmptySlotClick: (roomId: string, time: string) => void;
  onBookingClick: (booking: Booking) => void;
}

// Generate time slots from 08:00 to 21:30 (30-min intervals)
function generateTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 8; h < 22; h++) {
    slots.push(`${h.toString().padStart(2, '0')}:00`);
    slots.push(`${h.toString().padStart(2, '0')}:30`);
  }
  return slots;
}

export function DayView({
  date,
  rooms,
  bookings,
  canBook,
  onEmptySlotClick,
  onBookingClick,
}: DayViewProps) {
  const timeSlots = generateTimeSlots();

  function getBookingAt(roomId: string, time: string): Booking | undefined {
    return bookings.find(
      (b) =>
        b.roomId === roomId &&
        b.date === date &&
        b.startTime <= time &&
        b.endTime > time
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse min-w-[600px]">
        <thead>
          <tr className="bg-gray-50">
            <th className="sticky left-0 bg-gray-50 border px-2 py-1 text-xs font-medium text-gray-500 w-16">
              時間
            </th>
            {rooms.map((room) => (
              <th
                key={room.id}
                className="border px-2 py-1 text-xs font-medium text-gray-700"
              >
                {room.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {timeSlots.map((time) => (
            <tr key={time}>
              <td className="sticky left-0 bg-white border px-2 py-1 text-xs text-gray-500 w-16">
                {time}
              </td>
              {rooms.map((room) => {
                const booking = getBookingAt(room.id, time);
                return (
                  <td key={room.id} className="border p-0.5 h-10">
                    <TimeSlot
                      booking={booking}
                      canBook={canBook}
                      onClick={() =>
                        booking
                          ? onBookingClick(booking)
                          : onEmptySlotClick(room.id, time)
                      }
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Calendar/DayView.tsx
git commit -m "feat: add DayView calendar component"
```

---

### Task 11: WeekView component

**Files:**
- Create: `src/components/Calendar/WeekView.tsx`

- [ ] **Step 1: Create WeekView component**

Create `src/components/Calendar/WeekView.tsx`:

```typescript
'use client';

import { Booking } from '@/types';
import { TimeSlot } from './TimeSlot';

interface WeekViewProps {
  weekStartDate: string; // Monday of the week, "YYYY-MM-DD"
  roomId: string;
  bookings: Booking[];
  canBook: boolean;
  onEmptySlotClick: (roomId: string, date: string, time: string) => void;
  onBookingClick: (booking: Booking) => void;
}

const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

function generateTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 8; h < 22; h++) {
    slots.push(`${h.toString().padStart(2, '0')}:00`);
    slots.push(`${h.toString().padStart(2, '0')}:30`);
  }
  return slots;
}

function getWeekDates(mondayStr: string): string[] {
  const dates: string[] = [];
  const monday = new Date(mondayStr);
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

export function WeekView({
  weekStartDate,
  roomId,
  bookings,
  canBook,
  onEmptySlotClick,
  onBookingClick,
}: WeekViewProps) {
  const timeSlots = generateTimeSlots();
  const weekDates = getWeekDates(weekStartDate);

  function getBookingAt(date: string, time: string): Booking | undefined {
    return bookings.find(
      (b) =>
        b.roomId === roomId &&
        b.date === date &&
        b.startTime <= time &&
        b.endTime > time
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="sticky left-0 bg-gray-50 border px-2 py-1 text-xs font-medium text-gray-500 w-16">
              時間
            </th>
            {weekDates.map((date, i) => {
              const d = new Date(date);
              return (
                <th
                  key={date}
                  className="border px-2 py-1 text-xs font-medium text-gray-700"
                >
                  <div>{DAY_LABELS[i]}</div>
                  <div className="text-gray-400">
                    {d.getMonth() + 1}/{d.getDate()}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {timeSlots.map((time) => (
            <tr key={time}>
              <td className="sticky left-0 bg-white border px-2 py-1 text-xs text-gray-500 w-16">
                {time}
              </td>
              {weekDates.map((date) => {
                const booking = getBookingAt(date, time);
                return (
                  <td key={date} className="border p-0.5 h-10">
                    <TimeSlot
                      booking={booking}
                      canBook={canBook}
                      onClick={() =>
                        booking
                          ? onBookingClick(booking)
                          : onEmptySlotClick(roomId, date, time)
                      }
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Calendar/WeekView.tsx
git commit -m "feat: add WeekView calendar component"
```

---

## Chunk 3: Booking Modals + Main Page Integration

### Task 12: BookingModal (create booking)

**Files:**
- Create: `src/components/BookingModal.tsx`

- [ ] **Step 1: Create BookingModal component**

Create `src/components/BookingModal.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useAuth } from './AuthProvider';
import { createBooking, createRepeatBookings } from '@/lib/bookings';
import { BookingInput } from '@/types';
import { v4 as uuidv4 } from 'uuid';

interface BookingModalProps {
  roomId: string;
  roomName: string;
  date: string;
  startTime: string;
  onClose: () => void;
  onSuccess: () => void;
}

const DURATION_OPTIONS = [
  { label: '30 分鐘', minutes: 30 },
  { label: '1 小時', minutes: 60 },
  { label: '1.5 小時', minutes: 90 },
  { label: '2 小時', minutes: 120 },
];

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const totalMinutes = h * 60 + m + minutes;
  const newH = Math.floor(totalMinutes / 60);
  const newM = totalMinutes % 60;
  return `${newH.toString().padStart(2, '0')}:${newM.toString().padStart(2, '0')}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export function BookingModal({
  roomId,
  roomName,
  date,
  startTime,
  onClose,
  onSuccess,
}: BookingModalProps) {
  const { appUser } = useAuth();
  const [duration, setDuration] = useState(60);
  const [studentName, setStudentName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [repeatWeeks, setRepeatWeeks] = useState(4);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const endTime = addMinutes(startTime, duration);
  const endTimeExceeds = endTime > '22:00';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!appUser) return;
    if (endTimeExceeds) {
      setError('結束時間超過 22:00');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const baseInput: BookingInput = {
        roomId,
        date,
        startTime,
        endTime,
        userId: appUser.uid,
        userName: appUser.displayName,
        studentName,
        purpose: purpose || undefined,
        repeatGroupId: repeat ? uuidv4() : undefined,
      };

      if (repeat) {
        const inputs: BookingInput[] = [];
        for (let w = 0; w < repeatWeeks; w++) {
          inputs.push({
            ...baseInput,
            date: addDays(date, w * 7),
          });
        }
        const result = await createRepeatBookings(inputs);
        if (result.conflicts.length > 0) {
          setError(
            `已預約 ${result.success.length} 週，以下日期有衝突：${result.conflicts.join(', ')}`
          );
          if (result.success.length > 0) {
            onSuccess();
          }
          return;
        }
      } else {
        await createBooking(baseInput);
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '預約失敗');
    } finally {
      setSubmitting(false);
    }
  }

  const dateObj = new Date(date);
  const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][dateObj.getDay()];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-sm p-5">
        <h2 className="text-lg font-bold mb-4">新增預約</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">教室</span>
              <p className="font-medium">{roomName}</p>
            </div>
            <div>
              <span className="text-gray-500">日期</span>
              <p className="font-medium">
                {dateObj.getMonth() + 1}/{dateObj.getDate()}（{dayOfWeek}）
              </p>
            </div>
            <div>
              <span className="text-gray-500">開始</span>
              <p className="font-medium">{startTime}</p>
            </div>
            <div>
              <span className="text-gray-500">老師</span>
              <p className="font-medium">{appUser?.displayName}</p>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-500 mb-1">時長</label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              {DURATION_OPTIONS.map((opt) => (
                <option key={opt.minutes} value={opt.minutes}>
                  {opt.label}（到 {addMinutes(startTime, opt.minutes)}）
                </option>
              ))}
            </select>
            {endTimeExceeds && (
              <p className="text-red-500 text-xs mt-1">結束時間超過 22:00</p>
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-500 mb-1">學生姓名 *</label>
            <input
              type="text"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              required
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="學生姓名"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-500 mb-1">用途</label>
            <input
              type="text"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="鋼琴課、小提琴課..."
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="repeat"
              checked={repeat}
              onChange={(e) => setRepeat(e.target.checked)}
            />
            <label htmlFor="repeat" className="text-sm">
              每週重複
            </label>
            {repeat && (
              <select
                value={repeatWeeks}
                onChange={(e) => setRepeatWeeks(Number(e.target.value))}
                className="border rounded px-2 py-1 text-sm"
              >
                <option value={2}>2 週</option>
                <option value={3}>3 週</option>
                <option value={4}>4 週</option>
              </select>
            )}
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border rounded py-2 text-sm hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting || endTimeExceeds}
              className="flex-1 bg-blue-600 text-white rounded py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? '預約中...' : '確認預約'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles** (uuid already installed in Task 1)

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/BookingModal.tsx
git commit -m "feat: add BookingModal with duration, student name, and repeat booking"
```

---

### Task 13: BookingDetail (view/cancel)

**Files:**
- Create: `src/components/BookingDetail.tsx`

- [ ] **Step 1: Create BookingDetail component**

Create `src/components/BookingDetail.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useAuth } from './AuthProvider';
import { deleteBooking, deleteRepeatBookings } from '@/lib/bookings';
import { Booking } from '@/types';

interface BookingDetailProps {
  booking: Booking;
  onClose: () => void;
  onDeleted: () => void;
}

export function BookingDetail({ booking, onClose, onDeleted }: BookingDetailProps) {
  const { appUser } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [showRepeatOptions, setShowRepeatOptions] = useState(false);

  const canDelete =
    appUser?.role === 'admin' || appUser?.uid === booking.userId;

  const isRepeat = !!booking.repeatGroupId;

  const dateObj = new Date(booking.date);
  const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][dateObj.getDay()];

  async function handleDeleteSingle() {
    setDeleting(true);
    try {
      await deleteBooking(booking.id);
      onDeleted();
      onClose();
    } catch {
      alert('取消失敗');
    } finally {
      setDeleting(false);
    }
  }

  async function handleDeleteRepeatFromDate() {
    if (!booking.repeatGroupId) return;
    setDeleting(true);
    try {
      const count = await deleteRepeatBookings(booking.repeatGroupId, booking.date);
      alert(`已取消 ${count} 筆預約`);
      onDeleted();
      onClose();
    } catch {
      alert('取消失敗');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-sm p-5">
        <h2 className="text-lg font-bold mb-4">預約詳情</h2>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">教室</span>
            <span>{booking.roomId.replace('room-', '')}號教室</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">日期</span>
            <span>
              {dateObj.getMonth() + 1}/{dateObj.getDate()}（{dayOfWeek}）
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">時間</span>
            <span>
              {booking.startTime} ~ {booking.endTime}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">老師</span>
            <span>{booking.userName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">學生</span>
            <span>{booking.studentName}</span>
          </div>
          {booking.purpose && (
            <div className="flex justify-between">
              <span className="text-gray-500">用途</span>
              <span>{booking.purpose}</span>
            </div>
          )}
          {isRepeat && (
            <div className="flex justify-between">
              <span className="text-gray-500">類型</span>
              <span className="text-blue-600">每週重複</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 mt-5">
          {canDelete && !showRepeatOptions && (
            <button
              onClick={() => (isRepeat ? setShowRepeatOptions(true) : handleDeleteSingle())}
              disabled={deleting}
              className="w-full border border-red-300 text-red-600 rounded py-2 text-sm hover:bg-red-50 disabled:opacity-50"
            >
              {deleting ? '取消中...' : '取消預約'}
            </button>
          )}

          {canDelete && showRepeatOptions && (
            <>
              <button
                onClick={handleDeleteSingle}
                disabled={deleting}
                className="w-full border border-red-300 text-red-600 rounded py-2 text-sm hover:bg-red-50 disabled:opacity-50"
              >
                只取消這次
              </button>
              <button
                onClick={handleDeleteRepeatFromDate}
                disabled={deleting}
                className="w-full border border-red-300 text-red-600 rounded py-2 text-sm hover:bg-red-50 disabled:opacity-50"
              >
                取消此週之後全部
              </button>
            </>
          )}

          <button
            onClick={onClose}
            className="w-full border rounded py-2 text-sm hover:bg-gray-50"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/BookingDetail.tsx
git commit -m "feat: add BookingDetail modal with single/repeat cancel options"
```

---

### Task 14: Main page — wire everything together

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Rewrite home page with full calendar integration**

Replace `src/app/page.tsx` with the full implementation that:
- Loads rooms from Firestore
- Subscribes to bookings (real-time) based on current view mode
- Renders Header + DayView/WeekView
- Opens BookingModal on empty slot click
- Opens BookingDetail on booking click
- Auto-detects mobile vs desktop for default view mode

```typescript
'use client';

import { useEffect, useState, useCallback } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  subscribeToDateBookings,
  subscribeToWeekBookings,
} from '@/lib/bookings';
import { AuthGuard } from '@/components/AuthGuard';
import { useAuth } from '@/components/AuthProvider';
import { Header } from '@/components/Header';
import { DayView } from '@/components/Calendar/DayView';
import { WeekView } from '@/components/Calendar/WeekView';
import { BookingModal } from '@/components/BookingModal';
import { BookingDetail } from '@/components/BookingDetail';
import { Room, Booking } from '@/types';

function getToday(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

function getMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export default function HomePage() {
  return (
    <AuthGuard>
      <HomeContent />
    </AuthGuard>
  );
}

function HomeContent() {
  const { appUser } = useAuth();
  const canBook = appUser?.role === 'admin' || appUser?.role === 'teacher';

  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [currentDate, setCurrentDate] = useState(getToday());
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  const [selectedRoomId, setSelectedRoomId] = useState('room-1');

  // Modal state
  const [modalState, setModalState] = useState<
    | { type: 'none' }
    | { type: 'create'; roomId: string; date: string; startTime: string }
    | { type: 'detail'; booking: Booking }
  >({ type: 'none' });

  // Detect mobile on mount
  useEffect(() => {
    if (window.innerWidth >= 768) {
      setViewMode('week');
    }
  }, []);

  // Load rooms
  useEffect(() => {
    const q = query(collection(db, 'rooms'), orderBy('order'));
    const unsub = onSnapshot(q, (snap) => {
      setRooms(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Room)));
    });
    return unsub;
  }, []);

  // Subscribe to bookings based on view mode
  useEffect(() => {
    if (viewMode === 'day') {
      return subscribeToDateBookings(currentDate, setBookings);
    } else {
      const monday = getMonday(currentDate);
      const sunday = addDays(monday, 6);
      return subscribeToWeekBookings(monday, sunday, selectedRoomId, setBookings);
    }
  }, [viewMode, currentDate, selectedRoomId]);

  const handleEmptySlotClick = useCallback(
    (roomId: string, dateOrTime: string, time?: string) => {
      if (!canBook) return;
      // DayView passes (roomId, time), WeekView passes (roomId, date, time)
      if (time) {
        setModalState({ type: 'create', roomId, date: dateOrTime, startTime: time });
      } else {
        setModalState({ type: 'create', roomId, date: currentDate, startTime: dateOrTime });
      }
    },
    [canBook, currentDate]
  );

  const handleBookingClick = useCallback((booking: Booking) => {
    setModalState({ type: 'detail', booking });
  }, []);

  const roomName =
    rooms.find((r) => r.id === (modalState.type === 'create' ? modalState.roomId : ''))
      ?.name || '';

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        currentDate={currentDate}
        onDateChange={setCurrentDate}
        selectedRoomId={selectedRoomId}
        onRoomChange={setSelectedRoomId}
        rooms={rooms}
      />

      <main className="p-2">
        {viewMode === 'day' ? (
          <DayView
            date={currentDate}
            rooms={rooms}
            bookings={bookings}
            canBook={!!canBook}
            onEmptySlotClick={(roomId, time) => handleEmptySlotClick(roomId, time)}
            onBookingClick={handleBookingClick}
          />
        ) : (
          <WeekView
            weekStartDate={getMonday(currentDate)}
            roomId={selectedRoomId}
            bookings={bookings}
            canBook={!!canBook}
            onEmptySlotClick={handleEmptySlotClick}
            onBookingClick={handleBookingClick}
          />
        )}
      </main>

      {modalState.type === 'create' && (
        <BookingModal
          roomId={modalState.roomId}
          roomName={
            rooms.find((r) => r.id === modalState.roomId)?.name || modalState.roomId
          }
          date={modalState.date}
          startTime={modalState.startTime}
          onClose={() => setModalState({ type: 'none' })}
          onSuccess={() => setModalState({ type: 'none' })}
        />
      )}

      {modalState.type === 'detail' && (
        <BookingDetail
          booking={modalState.booking}
          onClose={() => setModalState({ type: 'none' })}
          onDeleted={() => {}}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run dev server and test full flow**

```bash
npm run dev
```

1. Login → see calendar with 7 rooms
2. Toggle day/week view
3. Click empty slot → BookingModal opens
4. Fill student name → submit → booking appears
5. Click booking → BookingDetail shows → cancel works

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: integrate calendar views, booking modals, and real-time updates"
```

---

## Chunk 4: Deploy + QR Code

### Task 15: Deploy to Vercel

- [ ] **Step 1: Push all code to GitHub**

```bash
cd "C:/Users/makoh/OneDrive/Mako/新米蘭/music-room-booking"
git push origin main
```

- [ ] **Step 2: Connect Vercel to GitHub repo**

1. Go to https://vercel.com and sign in with GitHub (`mako-debug`)
2. Import `mako-debug/music-room-booking`
3. Framework: Next.js (auto-detected)
4. Add Environment Variables (from `.env.local`):
   - `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
   - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
   - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
   - `NEXT_PUBLIC_FIREBASE_APP_ID`
5. Deploy

- [ ] **Step 3: Verify deployed site works**

Open the Vercel URL → login → see calendar → create booking.

- [ ] **Step 4: Set up Firebase**

1. In Firebase Console → Firestore → Rules → paste `firestore.rules` content → Publish
2. In Firebase Console → Firestore → Indexes → create the 2 composite indexes from `firestore.indexes.json`
3. In Firebase Console → Authentication → create a test admin account
4. In Firebase Console → Firestore → create `users` doc with matching UID, set `role: "admin"`
5. In Firebase Console → Firestore → create 7 `rooms` docs (or use seed function)

### Task 16: Generate QR Code

- [ ] **Step 1: Generate QR Code from deployed URL**

Use any QR code generator (e.g., https://www.qr-code-generator.com/) with the Vercel URL.

Save the QR Code image and print it for the music school.

- [ ] **Step 2: Final commit with any remaining changes**

```bash
git add -A
git commit -m "chore: final adjustments for deployment"
git push origin main
```
