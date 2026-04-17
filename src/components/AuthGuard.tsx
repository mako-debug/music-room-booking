'use client';

import { useAuth } from './AuthProvider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { MaintenanceOverlay } from './MaintenanceOverlay';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { firebaseUser, appUser, loading, maintenance } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !firebaseUser) {
      router.replace('/login');
    }
  }, [firebaseUser, loading, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">載入中...</p>
      </div>
    );
  }

  if (!firebaseUser) return null;

  // Maintenance overlay: blocks UI for non-admin when enabled (spec §4.2)
  if (maintenance.enabled && appUser?.role !== 'admin') {
    return <MaintenanceOverlay message={maintenance.message} />;
  }

  return <>{children}</>;
}
