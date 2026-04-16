'use client';

import { Booking } from '@/types';
import { getTeacherColor } from '@/lib/colors';

interface TimeSlotProps {
  booking?: Booking;
  onClick: () => void;
  canBook: boolean;
  userColorMap?: Record<string, number>;
}

export function TimeSlot({ booking, onClick, canBook, userColorMap }: TimeSlotProps) {
  if (booking) {
    const color = getTeacherColor(booking.userId, userColorMap?.[booking.userId]);
    return (
      <div
        onClick={onClick}
        className={`${color.bg} border ${color.border} rounded px-1 py-0.5 cursor-pointer hover:opacity-80 h-full flex flex-col justify-center`}
      >
        <p className={`text-xs font-medium ${color.name} truncate`}>
          {booking.userName}
        </p>
        <p className={`text-xs ${color.student} truncate`}>{booking.studentName}</p>
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
