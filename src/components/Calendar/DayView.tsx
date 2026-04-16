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
  userColorMap?: Record<string, number>;
}

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
  userColorMap,
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
          <tr className="bg-amber-50">
            <th className="sticky left-0 bg-amber-50 border px-2 py-1 text-xs font-bold text-amber-800 w-16">
              時間
            </th>
            {rooms.map((room) => (
              <th
                key={room.id}
                className="border px-2 py-1 text-xs font-bold text-amber-800 bg-amber-50"
              >
                {room.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {timeSlots.map((time) => (
            <tr key={time}>
              <td className="sticky left-0 bg-amber-50/60 border px-2 py-1 text-xs font-medium text-amber-800 w-16">
                {time}
              </td>
              {rooms.map((room) => {
                const booking = getBookingAt(room.id, time);
                return (
                  <td key={room.id} className="border p-0.5 h-10">
                    <TimeSlot
                      booking={booking}
                      canBook={canBook}
                      userColorMap={userColorMap}
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
