import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

export async function POST(request: NextRequest) {
  try {
    const { targetUid, newPassword, newEmail, disabled, callerToken } = await request.json();

    if (!targetUid || !callerToken) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    if (newPassword && newPassword.length < 6) {
      return NextResponse.json({ error: '密碼至少 6 個字元' }, { status: 400 });
    }

    // Verify the caller is an admin
    const decoded = await adminAuth.verifyIdToken(callerToken);
    const db = getFirestore();
    const callerDoc = await db.collection('users').doc(decoded.uid).get();

    if (!callerDoc.exists || callerDoc.data()?.role !== 'admin') {
      return NextResponse.json({ error: '僅限管理員操作' }, { status: 403 });
    }

    // Build update object
    const updates: { password?: string; email?: string; disabled?: boolean } = {};
    if (newPassword) updates.password = newPassword;
    if (newEmail) updates.email = newEmail;
    if (disabled !== undefined) updates.disabled = disabled;

    // Only call updateUser if there's something to update
    if (Object.keys(updates).length > 0) {
      await adminAuth.updateUser(targetUid, updates);
    }

    // Sync Firestore
    const firestoreUpdates: Record<string, unknown> = {};
    if (newEmail) firestoreUpdates.email = newEmail;
    if (disabled !== undefined) firestoreUpdates.active = !disabled;

    if (Object.keys(firestoreUpdates).length > 0) {
      await db.collection('users').doc(targetUid).update(firestoreUpdates);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知錯誤';
    if (message.includes('email-already-exists')) {
      return NextResponse.json({ error: '此 Email 已被其他帳號使用' }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
