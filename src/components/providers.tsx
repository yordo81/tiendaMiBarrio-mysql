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
  // En lugar de forzar un redirect al login, muestra una notificación
  // para que el usuario decida cuándo volver a iniciar sesión.
  // Incluye debounce para evitar múltiples toasts cuando varias
  // llamadas API paralelas fallan con 401 al mismo tiempo.
  useEffect(() => {
    let authCleared = false;

    function handleUnauthorized(e: Event) {
      const detail = (e as CustomEvent<UnauthorizedEventDetail>).detail;

      // Solo mostrar toast y limpiar auth una vez por oleada de expiración
      if (!authCleared) {
        authCleared = true;
        toast.warning(detail?.message ?? 'Sesión expirada. Inicia sesión de nuevo para realizar cambios.');

        // Limpiar estado de autenticación persistido para que la UI refleje
        // el estado real sin forzar un redirect de página
        try {
          useAuthStore.getState().setUser(null);
          localStorage.removeItem('tienda-auth');
        } catch { /* ignorar errores de storage */ }

        // Re-armar después de unos segundos para reportar expiraciones posteriores
        setTimeout(() => { authCleared = false; }, 5000);
      }
    }

    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  return <QueryClientProvider client={qc}>{children}<Toaster /></QueryClientProvider>;
}
