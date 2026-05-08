import { NextResponse } from 'next/server';

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function unauthorized() {
  return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: 'Sin permiso' }, { status: 403 });
}

export function notFound() {
  return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
}

export function serverError(e: unknown) {
  console.error(e);
  return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
}

/** Wrap a route handler with unified error handling */
export function handle(fn: (req: Request, ctx?: { params: Record<string, string> }) => Promise<NextResponse>) {
  return async (req: Request, ctx?: { params: Record<string, string> }) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof Error && e.message === 'UNAUTHORIZED') return unauthorized();
      return serverError(e);
    }
  };
}
