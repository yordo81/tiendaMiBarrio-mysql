import { NextResponse } from 'next/server';
import { EnumValidationError } from '@/lib/validate';

// ---- Response helpers ----

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function unauthorized(message = 'No autorizado') {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = 'Sin permiso') {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function notFound(message = 'No encontrado') {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function serverError(e: unknown) {
  console.error(e);
  return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
}

// ---- Route handler wrapper ----

export type RouteHandler = (
  req: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<NextResponse>;

/**
 * Envuelve un handler de ruta con manejo centralizado de errores.
 * Elimina la necesidad de try/catch en cada ruta.
 *
 * Errores conocidos manejados automáticamente:
 *  - `new Error('UNAUTHORIZED')` → 401
 *  - `EnumValidationError`      → 400 con mensaje descriptivo
 *  - `'Stock insuficiente...'`  → 400
 *  - `'Este producto...'`       → 400
 *  - Cualquier otro error       → 500 con console.error
 */
export function handle(fn: RouteHandler): RouteHandler {
  return async (req, context) => {
    try {
      return await fn(req, context);
    } catch (e) {
      if (e instanceof EnumValidationError) return err(e.message, 400);
      if (e instanceof Error && e.message === 'UNAUTHORIZED') return unauthorized();
      if (e instanceof Error && e.message.startsWith('Stock insuficiente')) return err(e.message, 400);
      if (e instanceof Error && e.message.startsWith('Este producto')) return err(e.message, 400);
      return serverError(e);
    }
  };
}
