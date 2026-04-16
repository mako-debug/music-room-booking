'use client';

import { useState } from 'react';
import { doc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
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
  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const [pwdSuccess, setPwdSuccess] = useState('');

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

  async function handleChangePassword() {
    setPwdError('');
    setPwdSuccess('');
    if (!currentPwd) { setPwdError('請輸入目前密碼'); return; }
    if (newPwd.length < 6) { setPwdError('新密碼至少 6 個字元'); return; }
    if (newPwd !== confirmPwd) { setPwdError('新密碼與確認密碼不一致'); return; }

    setPwdSaving(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) throw new Error('未登入');
      const credential = EmailAuthProvider.credential(user.email, currentPwd);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPwd);
      setPwdSuccess('密碼已更新');
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
      setTimeout(() => setChangingPassword(false), 1500);
    } catch (err) {
      if (err instanceof Error && err.message.includes('wrong-password')) {
        setPwdError('目前密碼錯誤');
      } else if (err instanceof Error && err.message.includes('invalid-credential')) {
        setPwdError('目前密碼錯誤');
      } else {
        setPwdError('更新失敗，請重新登入後再試');
      }
    } finally {
      setPwdSaving(false);
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
    <header className="bg-white border-b px-4 py-2">
      <div className="flex items-center justify-between">
        <h1
          className="text-base font-bold whitespace-nowrap"
          style={{ fontFamily: "'Baloo 2', 'Noto Sans TC', cursive", color: '#e67e22' }}
        >
          🎵 新米蘭音樂教室
        </h1>
        <div className="flex items-center gap-2 text-xs">
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
              className="text-gray-600 cursor-pointer hover:underline whitespace-nowrap"
              onClick={startEditName}
              title="點擊修改姓名"
            >
              👤 {appUser?.displayName} ✏️
            </span>
          )}
          <button
            onClick={() => {
              setChangingPassword(true);
              setPwdError('');
              setPwdSuccess('');
              setCurrentPwd('');
              setNewPwd('');
              setConfirmPwd('');
            }}
            className="text-gray-500 hover:text-gray-700"
            title="修改密碼"
          >
            🔑
          </button>
          {appUser?.role === 'admin' && (
            <Link href="/admin" className="text-blue-600 hover:underline whitespace-nowrap">
              管理
            </Link>
          )}
          <button
            onClick={() => {
              if (confirm('確定要登出嗎？')) signOut();
            }}
            className="text-red-500 hover:underline"
          >
            登出
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between mt-1">
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
      {changingPassword && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-sm p-5">
            <h2 className="text-lg font-bold mb-4 text-gray-900">修改密碼</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-700 mb-1">目前密碼</label>
                <input
                  type="password"
                  value={currentPwd}
                  onChange={(e) => setCurrentPwd(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">新密碼（至少 6 字元）</label>
                <input
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">確認新密碼</label>
                <input
                  type="password"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm text-gray-900"
                />
              </div>
              {pwdError && <p className="text-red-500 text-sm">{pwdError}</p>}
              {pwdSuccess && <p className="text-green-600 text-sm">{pwdSuccess}</p>}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setChangingPassword(false)}
                  className="flex-1 border rounded py-2 text-sm text-gray-900 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={handleChangePassword}
                  disabled={pwdSaving}
                  className="flex-1 bg-blue-600 text-white rounded py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {pwdSaving ? '更新中...' : '確認更新'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
