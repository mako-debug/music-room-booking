// 15 distinct colors for teachers
const TEACHER_COLORS = [
  { bg: 'bg-blue-100', border: 'border-blue-300', name: 'text-blue-800', student: 'text-blue-600' },
  { bg: 'bg-emerald-100', border: 'border-emerald-300', name: 'text-emerald-800', student: 'text-emerald-600' },
  { bg: 'bg-purple-100', border: 'border-purple-300', name: 'text-purple-800', student: 'text-purple-600' },
  { bg: 'bg-amber-100', border: 'border-amber-300', name: 'text-amber-800', student: 'text-amber-600' },
  { bg: 'bg-rose-100', border: 'border-rose-300', name: 'text-rose-800', student: 'text-rose-600' },
  { bg: 'bg-cyan-100', border: 'border-cyan-300', name: 'text-cyan-800', student: 'text-cyan-600' },
  { bg: 'bg-orange-100', border: 'border-orange-300', name: 'text-orange-800', student: 'text-orange-600' },
  { bg: 'bg-indigo-100', border: 'border-indigo-300', name: 'text-indigo-800', student: 'text-indigo-600' },
  { bg: 'bg-teal-100', border: 'border-teal-300', name: 'text-teal-800', student: 'text-teal-600' },
  { bg: 'bg-pink-100', border: 'border-pink-300', name: 'text-pink-800', student: 'text-pink-600' },
  { bg: 'bg-lime-100', border: 'border-lime-300', name: 'text-lime-800', student: 'text-lime-600' },
  { bg: 'bg-fuchsia-100', border: 'border-fuchsia-300', name: 'text-fuchsia-800', student: 'text-fuchsia-600' },
  { bg: 'bg-sky-100', border: 'border-sky-300', name: 'text-sky-800', student: 'text-sky-600' },
  { bg: 'bg-red-100', border: 'border-red-300', name: 'text-red-800', student: 'text-red-600' },
  { bg: 'bg-violet-100', border: 'border-violet-300', name: 'text-violet-800', student: 'text-violet-600' },
];

// Simple hash to get a stable index from userId
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getTeacherColor(userId: string) {
  const index = hashCode(userId) % TEACHER_COLORS.length;
  return TEACHER_COLORS[index];
}
