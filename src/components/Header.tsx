'use client';

import { useState } from 'react';
import { doc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from './AuthProvider';
import { signOut } from '@/lib/auth';
import Link from 'next/link';

interface HeaderProps {
  viewMode: 'day' | 'week';
  onViewModeChange: (mode: 'day' | 'week') => void;
  currentDate: string;
  onDateChange: (date: string) => void;
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
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  function startEditName() {
    setNewName(appUser?.displayName || '');
    setEditingName(true);
  }

  async function handleSaveName() {
    if (!appUser || !newName.trim()) return;
    setSaving(true);
    try {
      const trimmed = newName.trim();
      await updateDoc(doc(db, 'users', appUser.uid), { displayName: trimmed });

      // 同步更新所有預約的 userName
      if (trimmed !== appUser.displayName) {
        const q = query(collection(db, 'bookings'), where('userId', '==', appUser.uid));
        const snap = await getDocs(q);
        for (const d of snap.docs) {
          await updateDoc(d.ref, { userName: trimmed });
        }
      }
      setEditingName(false);
    } catch {
      alert('更新失敗');
    } finally {
      setSaving(false);
    }
  }

  function shiftDate(days: number) {
    const d = new Date(currentDate + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    onDateChange(`${y}-${m}-${dd}`);
  }

  function shiftWeek(weeks: number) {
    shiftDate(weeks * 7);
  }

  const dateObj = new Date(currentDate + 'T00:00:00');
  const weekStart = new Date(currentDate + 'T00:00:00');
  weekStart.setDate(dateObj.getDate() - dateObj.getDay() + 1);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const formatDate = (d: Date) =>
    `${d.getMonth() + 1}/${d.getDate()}`;

  const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][dateObj.getDay()];

  return (
    <header className="bg-white border-b px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <h1
          className="text-xl font-bold"
          style={{ fontFamily: "'Baloo 2', 'Noto Sans TC', cursive", color: '#e67e22' }}
        >
          🎵 新米蘭音樂教室
        </h1>
        <div className="flex items-center gap-3">
          {editingName ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="border rounded px-2 py-0.5 text-sm text-gray-900 w-24"
                autoFocus
              />
              <button
                onClick={handleSaveName}
                disabled={saving || !newName.trim()}
                className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? '...' : '存'}
              </button>
              <button
                onClick={() => setEditingName(false)}
                className="text-xs border px-2 py-1 rounded text-gray-900 hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          ) : (
            <span
              className="text-sm text-gray-600 cursor-pointer hover:underline"
              onClick={startEditName}
              title="點擊修改姓名"
            >
              👤 {appUser?.displayName} ✏️
            </span>
          )}
          {appUser?.role === 'admin' && (
            <Link href="/admin" className="text-sm text-blue-600 hover:underline">
              帳號管理
            </Link>
          )}
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
            className="border rounded px-2 py-1 text-sm text-gray-900"
          >
            <option value="day">日</option>
            <option value="week">週</option>
          </select>

          {viewMode === 'week' && (
            <select
              value={selectedRoomId}
              onChange={(e) => onRoomChange(e.target.value)}
              className="border rounded px-2 py-1 text-sm text-gray-900"
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
            className="px-2 py-1 text-sm border rounded hover:bg-gray-100 text-gray-900"
          >
            &lt;
          </button>
          <span className="text-sm font-medium min-w-[120px] text-center text-gray-900">
            {viewMode === 'day'
              ? `${dateObj.getMonth() + 1}/${dateObj.getDate()}（${dayOfWeek}）`
              : `${formatDate(weekStart)} ~ ${formatDate(weekEnd)}`}
          </span>
          <button
            onClick={() => (viewMode === 'day' ? shiftDate(1) : shiftWeek(1))}
            className="px-2 py-1 text-sm border rounded hover:bg-gray-100 text-gray-900"
          >
            &gt;
          </button>
        </div>
      </div>
    </header>
  );
}
