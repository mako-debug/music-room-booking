'use client';

import { useState } from 'react';
import { useAuth } from './AuthProvider';
import { deleteBooking, deleteRepeatBookings, updateBooking } from '@/lib/bookings';
import { Booking } from '@/types';
import { VoiceInput } from './VoiceInput';

interface BookingDetailProps {
  booking: Booking;
  onClose: () => void;
  onDeleted: () => void;
}

export function BookingDetail({ booking, onClose, onDeleted }: BookingDetailProps) {
  const { appUser } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [showRepeatOptions, setShowRepeatOptions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editStudentName, setEditStudentName] = useState(booking.studentName);
  const [editPurpose, setEditPurpose] = useState(booking.purpose || '');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const canEdit =
    appUser?.role === 'admin' || appUser?.uid === booking.userId;
  const canDelete = canEdit;

  const isRepeat = !!booking.repeatGroupId;

  const dateObj = new Date(booking.date);
  const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][dateObj.getDay()];

  async function handleSave() {
    if (!editStudentName.trim()) {
      setEditError('學生姓名不可為空');
      return;
    }
    setSaving(true);
    setEditError('');
    try {
      await updateBooking(booking.id, {
        studentName: editStudentName.trim(),
        purpose: editPurpose.trim() || undefined,
      });
      setEditing(false);
      onDeleted(); // trigger refresh
    } catch {
      setEditError('儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSingle() {
    if (!confirm('確定要取消這筆預約嗎？')) return;
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
    if (!confirm('確定要取消此週之後的所有重複預約嗎？')) return;
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

          {/* Student name - editable */}
          <div className="flex justify-between items-center">
            <span className="text-gray-600">學生</span>
            {editing ? (
              <div className="flex items-center">
                <input
                  type="text"
                  value={editStudentName}
                  onChange={(e) => setEditStudentName(e.target.value)}
                  className="border rounded px-2 py-1 text-sm text-gray-900 w-32 text-right"
                />
                <VoiceInput onResult={(text) => setEditStudentName(text)} />
              </div>
            ) : (
              <span className="text-gray-900">{booking.studentName}</span>
            )}
          </div>

          {/* Purpose - editable */}
          <div className="flex justify-between items-center">
            <span className="text-gray-600">用途</span>
            {editing ? (
              <div className="flex items-center">
                <input
                  type="text"
                  value={editPurpose}
                  onChange={(e) => setEditPurpose(e.target.value)}
                  className="border rounded px-2 py-1 text-sm text-gray-900 w-32 text-right"
                  placeholder="選填"
                />
                <VoiceInput onResult={(text) => setEditPurpose(text)} />
              </div>
            ) : (
              <span className="text-gray-900">{booking.purpose || '-'}</span>
            )}
          </div>

          {isRepeat && (
            <div className="flex justify-between">
              <span className="text-gray-600">類型</span>
              <span className="text-blue-700 font-medium">每週重複</span>
            </div>
          )}
        </div>

        {editError && <p className="text-red-500 text-xs mt-2">{editError}</p>}

        <div className="flex flex-col gap-2 mt-5">
          {/* Edit / Save buttons */}
          {canEdit && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="w-full border border-blue-300 text-blue-600 rounded py-2 text-sm hover:bg-blue-50"
            >
              修改
            </button>
          )}
          {editing && (
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-blue-600 text-white rounded py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? '儲存中...' : '儲存'}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setEditStudentName(booking.studentName);
                  setEditPurpose(booking.purpose || '');
                  setEditError('');
                }}
                className="flex-1 border rounded py-2 text-sm text-gray-900 hover:bg-gray-50"
              >
                取消修改
              </button>
            </div>
          )}

          {/* Delete buttons */}
          {canDelete && !editing && !showRepeatOptions && (
            <button
              onClick={() => (isRepeat ? setShowRepeatOptions(true) : handleDeleteSingle())}
              disabled={deleting}
              className="w-full border border-red-300 text-red-600 rounded py-2 text-sm hover:bg-red-50 disabled:opacity-50"
            >
              {deleting ? '取消中...' : '取消預約'}
            </button>
          )}

          {canDelete && !editing && showRepeatOptions && (
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
