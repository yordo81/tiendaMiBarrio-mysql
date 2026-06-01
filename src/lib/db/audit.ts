import { execute } from './mysql';

interface AuditEntry {
  user_id: string;
  user_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  entity_name?: string | null;
  details?: Record<string, unknown> | null;
}

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
