import { useState, useEffect, createContext, useContext, ReactNode, useRef, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type AppRole = 'admin' | 'teacher' | 'learner';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  roles: AppRole[];
  isAdmin: boolean;
  isTeacher: boolean;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signInWithMagicLink: (email: string) => Promise<{ error: Error | null }>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const activeRoleRequestRef = useRef(0);
  const authReadyRef = useRef(false);
  const currentUserIdRef = useRef<string | null>(null);

  const loadRoles = useCallback(async (userId: string | null) => {
    const requestId = ++activeRoleRequestRef.current;

    if (!userId) {
      setRoles([]);
      return true;
    }

    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise(r => setTimeout(r, 500 * attempt));
        }

        const { data, error } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', userId);

        if (requestId !== activeRoleRequestRef.current) return false;

        if (error) {
          console.error(`Failed to load user roles (attempt ${attempt + 1}/${MAX_RETRIES})`, error);
          if (attempt === MAX_RETRIES - 1) return false;
          continue;
        }

        setRoles((data ?? []).map((row) => row.role as AppRole));
        return true;
      } catch (error) {
        if (requestId !== activeRoleRequestRef.current) return false;
        console.error(`Unexpected role loading failure (attempt ${attempt + 1}/${MAX_RETRIES})`, error);
        if (attempt === MAX_RETRIES - 1) return false;
      }
    }
    return false;
  }, []);

  useEffect(() => {
    let isMounted = true;

    const applySession = async (nextSession: Session | null, options?: { isInitial?: boolean }) => {
      if (!isMounted) return;

      const nextUser = nextSession?.user ?? null;

      // Prevent premature navigation: set loading=true when user changes
      // so that downstream consumers (e.g. Auth redirect) wait for roles
      if (authReadyRef.current && nextUser?.id !== user?.id) {
        setLoading(true);
      }

      setSession(nextSession);
      setUser(nextUser);

      const loaded = await loadRoles(nextUser?.id ?? null);
      if (!isMounted) return;

      if ((options?.isInitial || authReadyRef.current) && loaded) {
        setLoading(false);
        authReadyRef.current = true;
      }
    };

    const initializeAuth = async () => {
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();
        await applySession(initialSession, { isInitial: true });
      } finally {
        if (isMounted && !authReadyRef.current) {
          setLoading(false);
          authReadyRef.current = true;
        }
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void applySession(nextSession);
    });

    void initializeAuth();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [loadRoles]);

  const signUp = async (email: string, password: string, fullName?: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
        },
      },
    });
    
    return { error: error as Error | null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    return { error: error as Error | null };
  };

  const signInWithMagicLink = async (email: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });
    
    return { error: error as Error | null };
  };

  const resetPassword = async (email: string) => {
    const redirectUrl = `${window.location.origin}/auth/reset-password`;
    
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl,
    });
    
    return { error: error as Error | null };
  };

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setRoles([]);
  };

  const isAdmin = roles.includes('admin');
  const isTeacher = roles.includes('teacher') || isAdmin;

  return (
    <AuthContext.Provider value={{
      user,
      session,
      loading,
      roles,
      isAdmin,
      isTeacher,
      signUp,
      signIn,
      signInWithMagicLink,
      resetPassword,
      updatePassword,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
