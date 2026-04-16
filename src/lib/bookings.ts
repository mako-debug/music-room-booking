import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  getDocs,
} from 'firebase/firestore';
import { db } from './firebase';
import { Booking, BookingInput } from '@/types';

// Subscribe to bookings for a single date (day view)
export function subscribeToDateBookings(
  date: string,
  callback: (bookings: Booking[]) => void
) {
  const q = query(collection(db, 'bookings'), where('date', '==', date));
  return onSnapshot(q, (snapshot) => {
    const bookings = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Booking));
    callback(bookings);
  });
}

// Subscribe to bookings for a date range + specific room (week view)
export function subscribeToWeekBookings(
  startDate: string,
  endDate: string,
  roomId: string,
  callback: (bookings: Booking[]) => void
) {
  const q = query(
    collection(db, 'bookings'),
    where('roomId', '==', roomId),
    where('date', '>=', startDate),
    where('date', '<=', endDate)
  );
  return onSnapshot(q, (snapshot) => {
    const bookings = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Booking));
    callback(bookings);
  });
}

// Check if a time slot conflicts with existing bookings
function hasConflict(
  existingBookings: Booking[],
  roomId: string,
  date: string,
  startTime: string,
  endTime: string
): boolean {
  return existingBookings.some(
    (b) =>
      b.roomId === roomId &&
      b.date === date &&
      b.startTime < endTime &&
      b.endTime > startTime
  );
}

// Validate booking date is within 1 month from today
function isWithinOneMonth(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const bookingDate = new Date(dateStr);
  const oneMonthLater = new Date(today);
  oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);
  return bookingDate >= today && bookingDate <= oneMonthLater;
}

// Create a booking with conflict check
export async function createBooking(input: BookingInput): Promise<void> {
  if (!isWithinOneMonth(input.date)) {
    throw new Error('只能預約未來 1 個月內的時段');
  }

  const q = query(
    collection(db, 'bookings'),
    where('roomId', '==', input.roomId),
    where('date', '==', input.date)
  );
  const snapshot = await getDocs(q);
  const existing = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Booking));

  if (hasConflict(existing, input.roomId, input.date, input.startTime, input.endTime)) {
    throw new Error('此時段已有預約');
  }

  await addDoc(collection(db, 'bookings'), {
    ...input,
    createdAt: new Date().toISOString(),
  });
}

// Create multiple bookings for repeat scheduling
export async function createRepeatBookings(
  inputs: BookingInput[]
): Promise<{ success: string[]; conflicts: string[] }> {
  const results = { success: [] as string[], conflicts: [] as string[] };

  for (const input of inputs) {
    try {
      await createBooking(input);
      results.success.push(input.date);
    } catch {
      results.conflicts.push(input.date);
    }
  }

  return results;
}

// Delete a single booking
export async function deleteBooking(bookingId: string): Promise<void> {
  await deleteDoc(doc(db, 'bookings', bookingId));
}

// Delete all bookings in a repeat group from a given date onward
export async function deleteRepeatBookings(
  repeatGroupId: string,
  fromDate: string
): Promise<number> {
  const q = query(
    collection(db, 'bookings'),
    where('repeatGroupId', '==', repeatGroupId),
    where('date', '>=', fromDate)
  );
  const snapshot = await getDocs(q);
  let count = 0;
  for (const d of snapshot.docs) {
    await deleteDoc(d.ref);
    count++;
  }
  return count;
}
