// 15 distinct colors for teachers
export const TEACHER_COLORS = [
  { label: '藍', bg: 'bg-blue-100', border: 'border-blue-300', name: 'text-blue-800', student: 'text-blue-600', preview: 'bg-blue-300' },
  { label: '翠綠', bg: 'bg-emerald-100', border: 'border-emerald-300', name: 'text-emerald-800', student: 'text-emerald-600', preview: 'bg-emerald-300' },
  { label: '紫', bg: 'bg-purple-100', border: 'border-purple-300', name: 'text-purple-800', student: 'text-purple-600', preview: 'bg-purple-300' },
  { label: '琥珀', bg: 'bg-amber-100', border: 'border-amber-300', name: 'text-amber-800', student: 'text-amber-600', preview: 'bg-amber-300' },
  { label: '玫瑰', bg: 'bg-rose-100', border: 'border-rose-300', name: 'text-rose-800', student: 'text-rose-600', preview: 'bg-rose-300' },
  { label: '青', bg: 'bg-cyan-100', border: 'border-cyan-300', name: 'text-cyan-800', student: 'text-cyan-600', preview: 'bg-cyan-300' },
  { label: '橘', bg: 'bg-orange-100', border: 'border-orange-300', name: 'text-orange-800', student: 'text-orange-600', preview: 'bg-orange-300' },
  { label: '靛藍', bg: 'bg-indigo-100', border: 'border-indigo-300', name: 'text-indigo-800', student: 'text-indigo-600', preview: 'bg-indigo-300' },
  { label: '水鴨', bg: 'bg-teal-100', border: 'border-teal-300', name: 'text-teal-800', student: 'text-teal-600', preview: 'bg-teal-300' },
  { label: '粉', bg: 'bg-pink-100', border: 'border-pink-300', name: 'text-pink-800', student: 'text-pink-600', preview: 'bg-pink-300' },
  { label: '萊姆', bg: 'bg-lime-100', border: 'border-lime-300', name: 'text-lime-800', student: 'text-lime-600', preview: 'bg-lime-300' },
  { label: '桃紅', bg: 'bg-fuchsia-100', border: 'border-fuchsia-300', name: 'text-fuchsia-800', student: 'text-fuchsia-600', preview: 'bg-fuchsia-300' },
  { label: '天空', bg: 'bg-sky-100', border: 'border-sky-300', name: 'text-sky-800', student: 'text-sky-600', preview: 'bg-sky-300' },
  { label: '紅', bg: 'bg-red-100', border: 'border-red-300', name: 'text-red-800', student: 'text-red-600', preview: 'bg-red-300' },
  { label: '紫羅蘭', bg: 'bg-violet-100', border: 'border-violet-300', name: 'text-violet-800', student: 'text-violet-600', preview: 'bg-violet-300' },
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

// colorIndex from user profile takes priority, fallback to hash
export function getTeacherColor(userId: string, colorIndex?: number) {
  if (colorIndex !== undefined && colorIndex >= 0 && colorIndex < TEACHER_COLORS.length) {
    return TEACHER_COLORS[colorIndex];
  }
  const index = hashCode(userId) % TEACHER_COLORS.length;
  return TEACHER_COLORS[index];
}
