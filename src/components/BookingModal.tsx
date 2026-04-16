'use client';

import { useState } from 'react';
import { useAuth } from './AuthProvider';
import { createBooking, createRepeatBookings } from '@/lib/bookings';
import { AppUser, BookingInput } from '@/types';
import { v4 as uuidv4 } from 'uuid';
import { VoiceInput } from './VoiceInput';

interface BookingModalProps {
  roomId: string;
  roomName: string;
  date: string;
  startTime: string;
  onClose: () => void;
  onSuccess: () => void;
  teachers?: AppUser[];
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
  teachers,
}: BookingModalProps) {
  const { appUser } = useAuth();
  const isAdmin = appUser?.role === 'admin';
  const [selectedTeacherId, setSelectedTeacherId] = useState(appUser?.uid || '');
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
      const selectedTeacher = isAdmin && teachers
        ? teachers.find((t) => t.uid === selectedTeacherId)
        : null;
      const bookingUserId = selectedTeacher?.uid || appUser.uid;
      const bookingUserName = selectedTeacher?.displayName || appUser.displayName;

      const baseInput: BookingInput = {
        roomId,
        date,
        startTime,
        endTime,
        userId: bookingUserId,
        userName: bookingUserName,
        studentName,
        ...(purpose ? { purpose } : {}),
        ...(repeat ? { repeatGroupId: uuidv4() } : {}),
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
        <h2 className="text-lg font-bold mb-4 text-gray-900">新增預約</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-600">教室</span>
              <p className="font-medium text-gray-900">{roomName}</p>
            </div>
            <div>
              <span className="text-gray-600">日期</span>
              <p className="font-medium text-gray-900">
                {dateObj.getFullYear()}/{dateObj.getMonth() + 1}/{dateObj.getDate()}（{dayOfWeek}）
              </p>
            </div>
            <div>
              <span className="text-gray-600">開始</span>
              <p className="font-medium text-gray-900">{startTime}</p>
            </div>
            <div>
              <span className="text-gray-600">老師</span>
              {isAdmin && teachers && teachers.length > 0 ? (
                <select
                  value={selectedTeacherId}
                  onChange={(e) => setSelectedTeacherId(e.target.value)}
                  className="w-full border rounded px-1 py-0.5 text-sm text-gray-900 font-medium"
                >
                  {teachers.map((t) => (
                    <option key={t.uid} value={t.uid}>
                      {t.displayName}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="font-medium text-gray-900">{appUser?.displayName}</p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">時長</label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full border rounded px-3 py-2 text-sm text-gray-900"
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
            <label className="block text-sm text-gray-700 mb-1">學生姓名 *</label>
            <div className="flex items-center">
              <input
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                required
                className="flex-1 border rounded px-3 py-2 text-sm text-gray-900"
                placeholder="學生姓名"
              />
              <VoiceInput onResult={(text) => setStudentName(text)} />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">用途</label>
            <div className="flex items-center">
              <input
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="flex-1 border rounded px-3 py-2 text-sm text-gray-900"
                placeholder="鋼琴課、小提琴課..."
              />
              <VoiceInput onResult={(text) => setPurpose(text)} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="repeat"
              checked={repeat}
              onChange={(e) => setRepeat(e.target.checked)}
            />
            <label htmlFor="repeat" className="text-sm text-gray-900">
              每週重複
            </label>
            {repeat && (
              <select
                value={repeatWeeks}
                onChange={(e) => setRepeatWeeks(Number(e.target.value))}
                className="border rounded px-2 py-1 text-sm text-gray-900"
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
              className="flex-1 border rounded py-2 text-sm text-gray-900 hover:bg-gray-50"
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
