import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

export async function POST(request: NextRequest) {
  try {
    const { targetUid, newPassword, callerToken } = await request.json();

    if (!targetUid || !newPassword || !callerToken) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: '密碼至少 6 個字元' }, { status: 400 });
    }

    // Verify the caller is an admin
    const decoded = await adminAuth.verifyIdToken(callerToken);
    const db = getFirestore();
    const callerDoc = await db.collection('users').doc(decoded.uid).get();

    if (!callerDoc.exists || callerDoc.data()?.role !== 'admin') {
      return NextResponse.json({ error: '僅限管理員操作' }, { status: 403 });
    }

    // Update the target user's password
    await adminAuth.updateUser(targetUid, { password: newPassword });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知錯誤';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
