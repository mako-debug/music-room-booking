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
        <h2 className="text-lg font-bold mb-4 text-gray-900">預約詳情</h2>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">教室</span>
            <span className="text-gray-900">{booking.roomId.replace('room-', '')}號教室</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">日期</span>
            <span className="text-gray-900">
              {dateObj.getFullYear()}/{dateObj.getMonth() + 1}/{dateObj.getDate()}（{dayOfWeek}）
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">時間</span>
            <span className="text-gray-900">
              {booking.startTime} ~ {booking.endTime}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">老師</span>
            <span className="text-gray-900">{booking.userName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">學生</span>
            <span className="text-gray-900">{booking.studentName}</span>
          </div>
          {booking.purpose && (
            <div className="flex justify-between">
              <span className="text-gray-600">用途</span>
              <span className="text-gray-900">{booking.purpose}</span>
            </div>
          )}
          {isRepeat && (
            <div className="flex justify-between">
              <span className="text-gray-600">類型</span>
              <span className="text-blue-700 font-medium">每週重複</span>
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
            className="w-full border rounded py-2 text-sm text-gray-900 hover:bg-gray-50"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
