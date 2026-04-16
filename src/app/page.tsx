'use client';

import { useEffect, useState, useCallback } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  subscribeToDateBookings,
  subscribeToWeekBookings,
} from '@/lib/bookings';
import { AuthGuard } from '@/components/AuthGuard';
import { useAuth } from '@/components/AuthProvider';
import { Header } from '@/components/Header';
import { DayView } from '@/components/Calendar/DayView';
import { WeekView } from '@/components/Calendar/WeekView';
import { BookingModal } from '@/components/BookingModal';
import { BookingDetail } from '@/components/BookingDetail';
import { Room, Booking } from '@/types';

function getToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toLocalDate(d);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
}

export default function HomePage() {
  return (
    <AuthGuard>
      <HomeContent />
    </AuthGuard>
  );
}

function HomeContent() {
  const { appUser } = useAuth();
  const canBook = appUser?.role === 'admin' || appUser?.role === 'teacher';

  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [currentDate, setCurrentDate] = useState(getToday());
  const [viewMode, setViewMode] = useState<'day' | 'week'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('viewMode');
      if (saved === 'day' || saved === 'week') return saved;
      return window.innerWidth >= 768 ? 'week' : 'day';
    }
    return 'day';
  });
  const [selectedRoomId, setSelectedRoomId] = useState('room-1');

  const [modalState, setModalState] = useState<
    | { type: 'none' }
    | { type: 'create'; roomId: string; date: string; startTime: string }
    | { type: 'detail'; booking: Booking }
  >({ type: 'none' });

  // Save view mode preference
  function handleViewModeChange(mode: 'day' | 'week') {
    setViewMode(mode);
    localStorage.setItem('viewMode', mode);
  }

  // Load rooms
  useEffect(() => {
    const q = query(collection(db, 'rooms'), orderBy('order'));
    const unsub = onSnapshot(q, (snap) => {
      setRooms(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Room)));
    });
    return unsub;
  }, []);

  // Subscribe to bookings based on view mode
  useEffect(() => {
    if (viewMode === 'day') {
      return subscribeToDateBookings(currentDate, setBookings);
    } else {
      const monday = getMonday(currentDate);
      const sunday = addDays(monday, 6);
      return subscribeToWeekBookings(monday, sunday, selectedRoomId, setBookings);
    }
  }, [viewMode, currentDate, selectedRoomId]);

  const handleEmptySlotClick = useCallback(
    (roomId: string, dateOrTime: string, time?: string) => {
      if (!canBook) return;
      if (time) {
        setModalState({ type: 'create', roomId, date: dateOrTime, startTime: time });
      } else {
        setModalState({ type: 'create', roomId, date: currentDate, startTime: dateOrTime });
      }
    },
    [canBook, currentDate]
  );

  const handleBookingClick = useCallback((booking: Booking) => {
    setModalState({ type: 'detail', booking });
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        currentDate={currentDate}
        onDateChange={setCurrentDate}
        selectedRoomId={selectedRoomId}
        onRoomChange={setSelectedRoomId}
        rooms={rooms}
      />

      <main className="p-2">
        {viewMode === 'day' ? (
          <DayView
            date={currentDate}
            rooms={rooms}
            bookings={bookings}
            canBook={!!canBook}
            onEmptySlotClick={(roomId, time) => handleEmptySlotClick(roomId, time)}
            onBookingClick={handleBookingClick}
          />
        ) : (
          <WeekView
            weekStartDate={getMonday(currentDate)}
            roomId={selectedRoomId}
            bookings={bookings}
            canBook={!!canBook}
            onEmptySlotClick={handleEmptySlotClick}
            onBookingClick={handleBookingClick}
          />
        )}
      </main>

      {modalState.type === 'create' && (
        <BookingModal
          roomId={modalState.roomId}
          roomName={
            rooms.find((r) => r.id === modalState.roomId)?.name || modalState.roomId
          }
          date={modalState.date}
          startTime={modalState.startTime}
          onClose={() => setModalState({ type: 'none' })}
          onSuccess={() => setModalState({ type: 'none' })}
        />
      )}

      {modalState.type === 'detail' && (
        <BookingDetail
          booking={modalState.booking}
          onClose={() => setModalState({ type: 'none' })}
          onDeleted={() => {}}
        />
      )}
    </div>
  );
}
