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
