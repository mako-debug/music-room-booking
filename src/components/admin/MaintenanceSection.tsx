'use client';

import { useEffect, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/AuthProvider';

const MAX_MESSAGE_LEN = 200;

export function MaintenanceSection() {
  const { maintenance } = useAuth();
  const [draftMessage, setDraftMessage] = useState(maintenance.message);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Sync draft from remote only when user hasn't typed; prevents overwriting concurrent admin edits
  useEffect(() => {
    if (!dirty) setDraftMessage(maintenance.message);
  }, [maintenance.message, dirty]);

  async function setEnabled(enabled: boolean) {
    setError('');
    setSaving(true);
    try {
      // setDoc with merge to tolerate doc-doesn't-exist (first toggle creates it)
      await setDoc(
        doc(db, 'settings', 'maintenance'),
        { enabled, message: draftMessage.trim() },
        { merge: true }
      );
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '寫入失敗');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-5">
      <h2 className="text-base font-bold text-gray-900 mb-4">系統維護模式</h2>

      <div className="mb-3 text-sm">
        目前狀態：
        {maintenance.enabled ? (
          <span className="ml-1 font-semibold text-red-600">啟用中</span>
        ) : (
          <span className="ml-1 font-semibold text-gray-700">關閉</span>
        )}
      </div>

      <label className="block text-sm text-gray-700 mb-1">
        維護訊息（顯示給非 admin 使用者看；最多 {MAX_MESSAGE_LEN} 字，空白則顯示預設）
      </label>
      <textarea
        value={draftMessage}
        onChange={(e) => {
          setDraftMessage(e.target.value.slice(0, MAX_MESSAGE_LEN));
          setDirty(true);
        }}
        rows={3}
        className="w-full border rounded px-3 py-2 text-sm text-gray-900"
        placeholder="例：系統升級中，預計 30 分鐘"
      />
      <div className="text-xs text-gray-500 mb-3">
        {draftMessage.length} / {MAX_MESSAGE_LEN}
      </div>

      {error && (
        <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        {maintenance.enabled ? (
          <button
            type="button"
            onClick={() => setEnabled(false)}
            disabled={saving}
            className="rounded bg-gray-700 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {saving ? '處理中…' : '關閉維運'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEnabled(true)}
            disabled={saving}
            className="rounded bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {saving ? '處理中…' : '開啟維運'}
          </button>
        )}
      </div>
    </div>
  );
}
