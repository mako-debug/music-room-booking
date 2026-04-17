import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  runTransaction,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  writeBatch,
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

const BUCKET_MINUTES = 30;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function fromMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function assertAligned(time: string): void {
  if (toMinutes(time) % BUCKET_MINUTES !== 0) {
    throw new Error('時間必須以 30 分鐘為單位');
  }
}

// 展開 booking 涵蓋的所有 30 分鐘 bucket startTime
// 例：expandBuckets("09:00", "10:30") → ["09:00", "09:30", "10:00"]
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function expandBuckets(startTime: string, endTime: string): string[] {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  const buckets: string[] = [];
  for (let m = start; m < end; m += BUCKET_MINUTES) {
    buckets.push(fromMinutes(m));
  }
  return buckets;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function makeLockId(roomId: string, date: string, bucket: string): string {
  return `${roomId}_${date}_${bucket}`;
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

// Update a booking's student name and purpose
export async function updateBooking(
  bookingId: string,
  data: { studentName: string; purpose?: string }
): Promise<void> {
  const updates: Record<string, string> = { studentName: data.studentName };
  if (data.purpose !== undefined) {
    updates.purpose = data.purpose;
  }
  await updateDoc(doc(db, 'bookings', bookingId), updates);
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
