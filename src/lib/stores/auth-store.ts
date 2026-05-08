import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppUser } from '@/types';

interface AuthState {
  user: AppUser | null;
  setUser: (user: AppUser | null) => void;
  hasPermission: (module: string, action: string) => boolean;
  isOwner: () => boolean;
  isAdmin: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      setUser: (user) => set({ user }),
      hasPermission: (module, action) => {
        const { user } = get();
        if (!user) return false;
        if (user.role === 'owner') return true;
        const perm = user.permissions.find(p => p.module === module);
        return perm ? perm.actions.includes(action as never) : false;
      },
      isOwner: () => get().user?.role === 'owner',
      isAdmin: () => ['owner', 'admin'].includes(get().user?.role ?? ''),
    }),
    {
      name: 'tienda-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ user: s.user }),
    }
  )
);
