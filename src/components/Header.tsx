'use client';

import { useAuth } from './AuthProvider';
import { signOut } from '@/lib/auth';

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
  weekStart.setDate(dateObj.getDate() - dateObj.getDay() + 1);
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
