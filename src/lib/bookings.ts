import {
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  doc,
  getDocs,
  runTransaction,
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

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function assertAligned(time: string): void {
  if (toMinutes(time) % BUCKET_MINUTES !== 0) {
    throw new Error('時間必須以 30 分鐘為單位');
  }
}

// 展開 booking 涵蓋的所有 30 分鐘 bucket startTime
// 例：expandBuckets("09:00", "10:30") → ["09:00", "09:30", "10:00"]
function expandBuckets(startTime: string, endTime: string): string[] {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  const buckets: string[] = [];
  for (let m = start; m < end; m += BUCKET_MINUTES) {
    buckets.push(fromMinutes(m));
  }
  return buckets;
}

function makeLockId(roomId: string, date: string, bucket: string): string {
  return `${roomId}_${date}_${bucket}`;
}

// Create a booking with atomic conflict check via bucketed locks
export async function createBooking(input: BookingInput): Promise<void> {
  if (!isWithinOneMonth(input.date)) {
    throw new Error('只能預約未來 1 個月內的時段');
  }
  assertAligned(input.startTime);
  assertAligned(input.endTime);
  if (toMinutes(input.endTime) <= toMinutes(input.startTime)) {
    throw new Error('結束時間必須晚於開始時間');
  }

  const createdAt = new Date().toISOString();
  const buckets = expandBuckets(input.startTime, input.endTime);
  const lockRefs = buckets.map((b) =>
    doc(db, 'booking_locks', makeLockId(input.roomId, input.date, b))
  );

  await runTransaction(db, async (tx) => {
    const lockSnaps = await Promise.all(lockRefs.map((ref) => tx.get(ref)));
    if (lockSnaps.some((snap) => snap.exists())) {
      throw new Error('此時段已有預約');
    }
    const bookingRef = doc(collection(db, 'bookings'));
    tx.set(bookingRef, { ...input, createdAt });
    for (const lockRef of lockRefs) {
      tx.set(lockRef, {
        bookingId: bookingRef.id,
        userId: input.userId,
        createdAt,
      });
    }
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

// Delete a single booking and its bucket locks atomically
export async function deleteBooking(booking: Booking): Promise<void> {
  const buckets = expandBuckets(booking.startTime, booking.endTime);
  const batch = writeBatch(db);
  batch.delete(doc(db, 'bookings', booking.id));
  for (const b of buckets) {
    batch.delete(
      doc(db, 'booking_locks', makeLockId(booking.roomId, booking.date, b))
    );
  }
  await batch.commit();
}

// Delete all bookings in a repeat group from a given date onward,
// along with all their bucket locks, in one atomic batch
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
  if (snapshot.empty) return 0;

  const batch = writeBatch(db);
  for (const d of snapshot.docs) {
    const b = { id: d.id, ...d.data() } as Booking;
    batch.delete(d.ref);
    for (const bucket of expandBuckets(b.startTime, b.endTime)) {
      batch.delete(
        doc(db, 'booking_locks', makeLockId(b.roomId, b.date, bucket))
      );
    }
  }
  await batch.commit();
  return snapshot.size;
}
