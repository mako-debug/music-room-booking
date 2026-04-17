// TEMPORARY — one-off migration per docs/superpowers/plans/2026-04-17-booking-race-condition-fix.md Task 3.6.
// DELETE this file (and the corresponding admin UI section) after verification.
import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

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

function expandBuckets(startTime: string, endTime: string): string[] {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  const buckets: string[] = [];
  for (let m = start; m < end; m += BUCKET_MINUTES) {
    buckets.push(fromMinutes(m));
  }
  return buckets;
}

// Helpers duplicated from src/lib/bookings.ts because this file uses admin SDK
// (not client SDK). Removed together with this file per Task 3.6.
interface BookingShape {
  roomId: string;
  date: string;
  startTime: string;
  endTime: string;
  userId: string;
}

export async function POST(request: NextRequest) {
  try {
    const { callerToken } = await request.json();
    if (!callerToken) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    // Verify admin
    const decoded = await adminAuth.verifyIdToken(callerToken);
    const db = getFirestore();
    const callerDoc = await db.collection('users').doc(decoded.uid).get();
    if (!callerDoc.exists || callerDoc.data()?.role !== 'admin') {
      return NextResponse.json({ error: '僅限管理員操作' }, { status: 403 });
    }

    const bookingsSnap = await db.collection('bookings').get();
    let migrated = 0;
    let skipped = 0;
    const errors: Array<{ bookingId: string; message: string }> = [];

    // Counters live outside the transaction callback so Firestore's internal
    // retries (on contention) don't double-count migrated/skipped bookings.
    for (const bookingDoc of bookingsSnap.docs) {
      try {
        const result = await db.runTransaction(async (tx) => {
          const freshSnap = await tx.get(bookingDoc.ref);
          if (!freshSnap.exists) return 'skip';
          const booking = freshSnap.data() as BookingShape;
          const buckets = expandBuckets(booking.startTime, booking.endTime);
          const createdAt = new Date().toISOString();
          let created = 0;
          for (const bucket of buckets) {
            const lockId = `${booking.roomId}_${booking.date}_${bucket}`;
            const lockRef = db.collection('booking_locks').doc(lockId);
            const lockSnap = await tx.get(lockRef);
            if (!lockSnap.exists) {
              tx.set(lockRef, {
                bookingId: freshSnap.id,
                userId: booking.userId,
                createdAt,
              });
              created++;
            }
          }
          return created > 0 ? 'migrated' : 'skip';
        });
        if (result === 'migrated') migrated++;
        else skipped++;
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知錯誤';
        errors.push({ bookingId: bookingDoc.id, message });
      }
    }

    return NextResponse.json({
      success: true,
      total: bookingsSnap.size,
      migrated,
      skipped,
      errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知錯誤';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
