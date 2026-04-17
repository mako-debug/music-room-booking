'use client';

const DEFAULT_MESSAGE = '系統維護中，請稍後再試';

export function MaintenanceOverlay({ message }: { message: string }) {
  const body = message.trim() === '' ? DEFAULT_MESSAGE : message;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/80 p-6">
      <div className="max-w-md rounded-lg bg-white p-8 text-center shadow-xl">
        <h1 className="mb-4 text-2xl font-bold text-gray-900">系統維護中</h1>
        <p className="whitespace-pre-wrap text-gray-700">{body}</p>
      </div>
    </div>
  );
}
