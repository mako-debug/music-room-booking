'use client';

import { Booking } from '@/types';
import { TimeSlot } from './TimeSlot';

interface WeekViewProps {
  weekStartDate: string;
  roomId: string;
  bookings: Booking[];
  canBook: boolean;
  onEmptySlotClick: (roomId: string, date: string, time: string) => void;
  onBookingClick: (booking: Booking) => void;
}

const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

function generateTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 8; h < 22; h++) {
    slots.push(`${h.toString().padStart(2, '0')}:00`);
    slots.push(`${h.toString().padStart(2, '0')}:30`);
  }
  return slots;
}

function getWeekDates(mondayStr: string): string[] {
  const dates: string[] = [];
  const monday = new Date(mondayStr);
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

export function WeekView({
  weekStartDate,
  roomId,
  bookings,
  canBook,
  onEmptySlotClick,
  onBookingClick,
}: WeekViewProps) {
  const timeSlots = generateTimeSlots();
  const weekDates = getWeekDates(weekStartDate);

  function getBookingAt(date: string, time: string): Booking | undefined {
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
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="sticky left-0 bg-gray-50 border px-2 py-1 text-xs font-medium text-gray-500 w-16">
              時間
            </th>
            {weekDates.map((date, i) => {
              const d = new Date(date);
              return (
                <th
                  key={date}
                  className="border px-2 py-1 text-xs font-medium text-gray-700"
                >
                  <div>{DAY_LABELS[i]}</div>
                  <div className="text-gray-400">
                    {d.getMonth() + 1}/{d.getDate()}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {timeSlots.map((time) => (
            <tr key={time}>
              <td className="sticky left-0 bg-white border px-2 py-1 text-xs text-gray-500 w-16">
                {time}
              </td>
              {weekDates.map((date) => {
                const booking = getBookingAt(date, time);
                return (
                  <td key={date} className="border p-0.5 h-10">
                    <TimeSlot
                      booking={booking}
                      canBook={canBook}
                      onClick={() =>
                        booking
                          ? onBookingClick(booking)
                          : onEmptySlotClick(roomId, date, time)
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
