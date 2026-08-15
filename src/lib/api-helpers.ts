import { NextResponse } from 'next/server';
import { EnumValidationError } from '@/lib/validate';
import { requireAuth } from '@/lib/auth/session';
import type { AppUser } from '@/types';

// ---- Helpers de respuesta HTTP ----
// Funciones para generar respuestas JSON estandarizadas

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// ---- Autorización por rol (RBAC) ----
// requireRole verifica autenticación Y rol antes de permitir la operación.
// Se usa en las rutas API para que el control de acceso no dependa solo del
// sidebar: un vendedor no puede llamar endpoints de finanzas/inventario
// directamente aunque los oculte la UI.

export class ForbiddenError extends Error {
  constructor(message = 'Sin permiso') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export async function requireRole(...roles: AppUser['role'][]) {
  const user = await requireAuth();
  if (!roles.includes(user.role)) {
    throw new ForbiddenError('No autorizado para esta acción');
  }
  return user;
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

// ---- Wrapper para handlers de rutas API ----
// Centraliza el manejo de errores y evita try/catch repetitivos en cada ruta

export type RouteHandler = (
  req: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<NextResponse>;

/**
 * Envuelve un handler de ruta con manejo centralizado de errores.
 * Elimina la necesidad de try/catch en cada ruta.
 *
 * Errores conocidos manejados automáticamente:
 *  - `new Error('UNAUTHORIZED')`  → 401 (no autorizado)
 *  - `EnumValidationError`       → 400 (dato inválido)
 *  - `'Stock insuficiente...'`   → 400 (sin stock)
 *  - `'Este producto...'`        → 400 (producto ya existe)
 *  - Cualquier otro error        → 500 con console.error
 */
export function handle(fn: RouteHandler): RouteHandler {
  return async (req, context) => {
    try {
      return await fn(req, context);
    } catch (e) {
      if (e instanceof EnumValidationError) return err(e.message, 400);
      if (e instanceof ForbiddenError) return forbidden(e.message);
      if (e instanceof Error && e.message === 'UNAUTHORIZED') return unauthorized();
      if (e instanceof Error && e.message.startsWith('Stock insuficiente')) return err(e.message, 400);
      if (e instanceof Error && e.message.startsWith('Este producto')) return err(e.message, 400);
      return serverError(e);
    }
  };
}
