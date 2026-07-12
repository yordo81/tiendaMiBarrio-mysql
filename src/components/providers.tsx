'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Toaster, toast } from '@/components/ui/toaster';
import { useAuthStore } from '@/lib/stores/auth-store';
import { UNAUTHORIZED_EVENT, type UnauthorizedEventDetail } from '@/lib/api-client';

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 60000, retry: 1 } } }));

  // Listen for unauthorized events dispatched by apiFetch
  // Instead of forcing a redirect, show a notification so the user
  // can choose to re-login at their own pace.
  // Debounce to avoid showing multiple toasts when parallel API calls all fail with 401.
  useEffect(() => {
    let authCleared = false;

    function handleUnauthorized(e: Event) {
      const detail = (e as CustomEvent<UnauthorizedEventDetail>).detail;

      // Only show the toast and clear auth once per session-expiry wave
      if (!authCleared) {
        authCleared = true;
        toast.warning(detail?.message ?? 'Sesión expirada. Inicia sesión de nuevo para realizar cambios.');

        // Clear persisted auth state so the UI reflects the real auth status
        // without forcing a page redirect
        try {
          useAuthStore.getState().setUser(null);
          localStorage.removeItem('tienda-auth');
        } catch { /* ignore */ }

        // Re-arm after a few seconds so a later session expiry is also reported
        setTimeout(() => { authCleared = false; }, 5000);
      }
    }

    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  return <QueryClientProvider client={qc}>{children}<Toaster /></QueryClientProvider>;
}
