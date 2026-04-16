export type UserRole = 'admin' | 'teacher' | 'student';

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  colorIndex?: number;
  createdAt: string;
}

export interface Room {
  id: string;
  name: string;
  order: number;
}

export interface Booking {
  id: string;
  roomId: string;
  date: string;           // "YYYY-MM-DD"
  startTime: string;      // "HH:mm"
  endTime: string;        // "HH:mm"
  userId: string;
  userName: string;
  studentName: string;
  purpose?: string;
  repeatGroupId?: string;
  createdAt: string;
}

export type BookingInput = Omit<Booking, 'id' | 'createdAt'>;
