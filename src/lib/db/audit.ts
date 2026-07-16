import { execute } from './mysql';

// ── Logger de auditoría ──────────────────────────────────────────
// Registra automáticamente acciones críticas (eliminaciones, ajustes)
// en la tabla audit_logs para trazabilidad.

interface AuditEntry {
  user_id: string;       // ID del usuario que realizó la acción
  user_name: string;     // Nombre del usuario (para consultas rápidas)
  action: string;        // Tipo de acción: delete | cancel | adjust | adjust_increase | adjust_decrease
  entity_type: string;   // Tipo de entidad: expense | product | sale | customer | supplier | stock_movement
  entity_id: string;     // ID del registro afectado
  entity_name?: string | null;  // Nombre descriptivo de la entidad
  details?: Record<string, unknown> | null;  // Detalles adicionales en JSON
}

/**
 * Registra una entrada de auditoría en la base de datos.
 * Se usa en todas las operaciones de eliminación y ajustes críticos
 * para mantener un historial de quién hizo qué y cuándo.
 */
export async function logAudit(entry: AuditEntry) {
  const id = crypto.randomUUID();
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await execute(
    'INSERT INTO audit_logs (id, user_id, user_name, action, entity_type, entity_id, entity_name, details, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [
      id,
      entry.user_id,
      entry.user_name,
      entry.action,
      entry.entity_type,
      entry.entity_id,
      entry.entity_name ?? null,
      entry.details ? JSON.stringify(entry.details) : null,
      ts,
    ]
  );
}
