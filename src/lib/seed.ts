import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

const rooms = [
  { id: 'room-1', name: '1號教室', order: 1 },
  { id: 'room-2', name: '2號教室', order: 2 },
  { id: 'room-3', name: '3號教室', order: 3 },
  { id: 'room-4', name: '4號教室', order: 4 },
  { id: 'room-5', name: '5號教室', order: 5 },
  { id: 'room-6', name: '6號教室', order: 6 },
  { id: 'room-7', name: '7號教室', order: 7 },
];

export async function seedRooms() {
  for (const room of rooms) {
    await setDoc(doc(db, 'rooms', room.id), room);
  }
  console.log('Seeded 7 rooms');
}
