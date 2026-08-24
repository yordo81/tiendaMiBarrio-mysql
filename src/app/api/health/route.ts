export const dynamic = 'force-dynamic';
import { pool } from '@/lib/db/mysql';
import { valkey } from '@/lib/valkey';
import { NextResponse } from 'next/server';

// ── Healthcheck endpoint ──────────────────────────────────────────
// Verifica la salud de los servicios dependientes: MySQL y Valkey.
// Diseñado para:
//  - Docker Compose healthcheck (el container app depende de db + valkey)
//  - Monitoreo externo (Uptime Kuma, Grafana, etc.)
//  - Debug rápido en producción
//
// Respuesta:
//  200 → todos los servicios OK (o parcialmente OK)
//  503 → al menos un servicio crítico caído
//
// No requiere autenticación: es un endpoint público para healthchecks.

interface ServiceStatus {
  status: 'ok' | 'error' | 'disabled';
  latency_ms: number;
  message?: string;
}

async function checkMySQL(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    await pool.execute('SELECT 1 AS ping');
    return {
      status: 'ok',
      latency_ms: Date.now() - start,
    };
  } catch (e) {
    return {
      status: 'error',
      latency_ms: Date.now() - start,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkValkey(): Promise<ServiceStatus> {
  // Si VALKEY_URL no está configurado, Valkey es opcional
  if (!valkey) {
    return {
      status: 'disabled',
      latency_ms: 0,
      message: 'VALKEY_URL no configurado — caché in-memory activo',
    };
  }

  const start = Date.now();
  try {
    const pong = await valkey.ping();
    return {
      status: pong === 'PONG' ? 'ok' : 'error',
      latency_ms: Date.now() - start,
      message: pong === 'PONG' ? undefined : `Respuesta inesperada: ${pong}`,
    };
  } catch (e) {
    return {
      status: 'error',
      latency_ms: Date.now() - start,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function GET() {
  const [mysql, valkeyStatus] = await Promise.all([
    checkMySQL(),
    checkValkey(),
  ]);

  const allOk = mysql.status === 'ok' &&
    (valkeyStatus.status === 'ok' || valkeyStatus.status === 'disabled');

  return NextResponse.json(
    {
      status: allOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        mysql,
        valkey: valkeyStatus,
      },
    },
    { status: allOk ? 200 : 503 },
  );
}
