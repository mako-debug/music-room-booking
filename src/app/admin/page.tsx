'use client';

import { useState, useEffect } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { AuthGuard } from '@/components/AuthGuard';
import { useAuth } from '@/components/AuthProvider';
import { AppUser, UserRole } from '@/types';
import Link from 'next/link';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Use a secondary Firebase app to create users without logging out current user
function getSecondaryAuth() {
  const name = 'secondary';
  const app = getApps().find((a) => a.name === name)
    ? getApp(name)
    : initializeApp(firebaseConfig, name);
  return getAuth(app);
}

export default function AdminPage() {
  return (
    <AuthGuard>
      <AdminGuard>
        <AdminContent />
      </AdminGuard>
    </AuthGuard>
  );
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { appUser } = useAuth();

  if (appUser?.role !== 'admin') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <p className="text-gray-600 mb-4">僅限管理員存取</p>
          <Link href="/" className="text-blue-600 hover:underline">
            回到首頁
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function AdminContent() {
  const { appUser } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('teacher');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Load users
  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setUsers(snap.docs.map((d) => d.data() as AppUser));
    });
    return unsub;
  }, []);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      // Create Firebase Auth user via secondary app (won't log out current user)
      const secondaryAuth = getSecondaryAuth();
      const credential = await createUserWithEmailAndPassword(
        secondaryAuth,
        email,
        password
      );
      await firebaseSignOut(secondaryAuth);

      // Create Firestore user document
      const newUser: AppUser = {
        uid: credential.user.uid,
        email,
        displayName,
        role,
        createdAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'users', credential.user.uid), newUser);

      setMessage(`已建立帳號：${displayName}（${email}）`);
      setEmail('');
      setPassword('');
      setDisplayName('');
      setRole('teacher');
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.includes('email-already-in-use')) {
          setError('此 Email 已被使用');
        } else if (err.message.includes('weak-password')) {
          setError('密碼至少需要 6 個字元');
        } else {
          setError(err.message);
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Edit state
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('teacher');

  function startEdit(user: AppUser) {
    setEditingUid(user.uid);
    setEditName(user.displayName);
    setEditRole(user.role);
  }

  async function handleSaveEdit(uid: string) {
    try {
      await updateDoc(doc(db, 'users', uid), {
        displayName: editName,
        role: editRole,
      });
      setMessage(`已更新帳號資料`);
      setEditingUid(null);
    } catch {
      setError('更新失敗');
    }
  }

  async function handleDeleteUser(user: AppUser) {
    if (user.uid === appUser?.uid) {
      alert('無法刪除自己的帳號');
      return;
    }
    if (!confirm(`確定要刪除 ${user.displayName}（${user.email}）嗎？`)) return;

    try {
      await deleteDoc(doc(db, 'users', user.uid));
      setMessage(`已刪除 ${user.displayName} 的 Firestore 資料`);
    } catch {
      setError('刪除失敗');
    }
  }

  const roleLabel: Record<UserRole, string> = {
    admin: '管理員',
    teacher: '老師',
    student: '學生',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">帳號管理</h1>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          回到日曆
        </Link>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-6">
        {/* Create user form */}
        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="text-base font-bold text-gray-900 mb-4">新增帳號</h2>
          <form onSubmit={handleCreateUser} className="space-y-3">
            <div>
              <label className="block text-sm text-gray-700 mb-1">姓名 *</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                className="w-full border rounded px-3 py-2 text-sm text-gray-900"
                placeholder="王老師"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full border rounded px-3 py-2 text-sm text-gray-900"
                placeholder="teacher@music.com"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">密碼 *（至少 6 字元）</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full border rounded px-3 py-2 text-sm text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">角色</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="w-full border rounded px-3 py-2 text-sm text-gray-900"
              >
                <option value="teacher">老師（可預約）</option>
                <option value="student">學生（僅查看）</option>
              </select>
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}
            {message && <p className="text-green-600 text-sm">{message}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 text-white py-2 rounded font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? '建立中...' : '建立帳號'}
            </button>
          </form>
        </div>

        {/* User list */}
        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="text-base font-bold text-gray-900 mb-4">
            帳號列表（{users.length}）
          </h2>
          <div className="space-y-3">
            {users.map((user) => (
              <div key={user.uid} className="border rounded p-3">
                {editingUid === user.uid ? (
                  <div className="space-y-2">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">姓名</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full border rounded px-2 py-1 text-sm text-gray-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">角色</label>
                      <select
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value as UserRole)}
                        className="w-full border rounded px-2 py-1 text-sm text-gray-900"
                      >
                        <option value="admin">管理員</option>
                        <option value="teacher">老師</option>
                        <option value="student">學生</option>
                      </select>
                    </div>
                    <p className="text-xs text-gray-500">{user.email}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSaveEdit(user.uid)}
                        className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
                      >
                        儲存
                      </button>
                      <button
                        onClick={() => setEditingUid(null)}
                        className="text-xs border px-3 py-1 rounded text-gray-900 hover:bg-gray-50"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {user.displayName}
                        <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          {roleLabel[user.role]}
                        </span>
                      </p>
                      <p className="text-xs text-gray-500">{user.email}</p>
                    </div>
                    <div className="flex gap-4">
                      <button
                        onClick={() => startEdit(user)}
                        className="text-xs text-blue-600 hover:underline px-2 py-1"
                      >
                        修改
                      </button>
                      {user.uid !== appUser?.uid && (
                        <button
                          onClick={() => handleDeleteUser(user)}
                          className="text-xs text-red-500 hover:underline px-2 py-1"
                        >
                          刪除
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
