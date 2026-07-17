'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Toaster, toast } from '@/components/ui/toaster';
import { useAuthStore } from '@/lib/stores/auth-store';
import { UNAUTHORIZED_EVENT, type UnauthorizedEventDetail } from '@/lib/api-client';

// ── Providers globales de la aplicación ────────────────────────────
// Configura React Query y el manejador de sesión expirada

export function Providers({ children }: { children: React.ReactNode }) {
  // Cliente de React Query con configuración base
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 60000, retry: 1 } } }));

  // Escucha eventos de 401 (sesión expirada) disparados por apiFetch
  // Muestra una notificación, limpia el estado de auth y redirige
  // automáticamente al login para que el usuario pueda autenticarse de nuevo.
  // Incluye debounce para evitar múltiples toasts cuando varias
  // llamadas API paralelas fallan con 401 al mismo tiempo.
  useEffect(() => {
    let authCleared = false;

    function handleUnauthorized(e: Event) {
      const detail = (e as CustomEvent<UnauthorizedEventDetail>).detail;

      // Solo mostrar toast y redirigir una vez por oleada de expiración
      if (!authCleared) {
        authCleared = true;
        toast.warning(detail?.message ?? 'Sesión expirada. Inicia sesión de nuevo para realizar cambios.');

        // Limpiar estado de autenticación persistido
        try {
          useAuthStore.getState().setUser(null);
          localStorage.removeItem('tienda-auth');
        } catch { /* ignorar errores de storage */ }

        // Redirigir automáticamente al login después de un breve delay
        // para que el usuario alcance a ver el mensaje del toast
        setTimeout(() => {
          window.location.href = '/auth/login';
        }, 1000);

        // Re-armar después de unos segundos para reportar expiraciones posteriores
        setTimeout(() => { authCleared = false; }, 5000);
      }
    }

    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  return <QueryClientProvider client={qc}>{children}<Toaster /></QueryClientProvider>;
}
