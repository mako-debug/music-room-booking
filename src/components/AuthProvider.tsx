'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { AppUser, MaintenanceSettings } from '@/types';

interface AuthContextType {
  firebaseUser: User | null;
  appUser: AppUser | null;
  loading: boolean;
  maintenance: MaintenanceSettings;
}

const DEFAULT_MAINTENANCE: MaintenanceSettings = { enabled: false, message: '' };

const AuthContext = createContext<AuthContextType>({
  firebaseUser: null,
  appUser: null,
  loading: true,
  maintenance: DEFAULT_MAINTENANCE,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceSettings>(DEFAULT_MAINTENANCE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    let unsubMaintenance: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);

      // Tear down previous listeners on user change / logout
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }
      if (unsubMaintenance) {
        unsubMaintenance();
        unsubMaintenance = null;
      }

      if (user) {
        // Two independent resolved flags; loading clears only when BOTH first snapshots arrive.
        // Prevents non-admin seeing real UI for a few hundred ms during maintenance (spec §4.2 / §9.7).
        let profileResolved = false;
        let maintenanceResolved = false;
        const tryClearLoading = () => {
          if (profileResolved && maintenanceResolved) setLoading(false);
        };

        unsubProfile = onSnapshot(doc(db, 'users', user.uid), (snap) => {
          setAppUser(snap.exists() ? (snap.data() as AppUser) : null);
          profileResolved = true;
          tryClearLoading();
        });

        unsubMaintenance = onSnapshot(
          doc(db, 'settings', 'maintenance'),
          (snap) => {
            if (snap.exists()) {
              setMaintenance(snap.data() as MaintenanceSettings);
            } else {
              setMaintenance(DEFAULT_MAINTENANCE);
            }
            maintenanceResolved = true;
            tryClearLoading();
          },
          // Fail open: keep maintenance disabled on listener error (spec §6.1).
          // Real protection is rules; overlay is UX only.
          () => {
            setMaintenance(DEFAULT_MAINTENANCE);
            maintenanceResolved = true;
            tryClearLoading();
          }
        );
      } else {
        setAppUser(null);
        setMaintenance(DEFAULT_MAINTENANCE);
        setLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
      if (unsubMaintenance) unsubMaintenance();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ firebaseUser, appUser, loading, maintenance }}>
      {children}
    </AuthContext.Provider>
  );
}
