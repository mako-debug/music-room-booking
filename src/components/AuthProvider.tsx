'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { AppUser } from '@/types';

interface AuthContextType {
  firebaseUser: User | null;
  appUser: AppUser | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  firebaseUser: null,
  appUser: null,
  loading: true,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);

      // Clean up previous profile listener
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (user) {
        // Real-time listen to user profile — name changes update immediately
        unsubProfile = onSnapshot(doc(db, 'users', user.uid), (snap) => {
          if (snap.exists()) {
            setAppUser(snap.data() as AppUser);
          } else {
            setAppUser(null);
          }
          setLoading(false);
        });
      } else {
        setAppUser(null);
        setLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ firebaseUser, appUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
