export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { execute } from '@/lib/db/mysql';
import { handle, ok, err, forbidden } from '@/lib/api-helpers';
import { logAudit } from '@/lib/db/audit';
import { getBusinessSettings } from '@/lib/settings-server';

// ── API de Configuración del negocio ───────────────────────────────
// GET: público — nombre, logo y modo de operación (no hay datos sensibles)
// PUT: solo dueño — personaliza nombre, logotipo y modo días/turnos

export const GET = handle(async () => {
  return ok({ settings: await getBusinessSettings() });
});

export const PUT = handle(async (req: Request) => {
  const user = await requireAuth();
  if (user.role !== 'owner') return forbidden('Solo el dueño puede modificar la configuración');

  const body = await req.json();
  const businessName = String(body.business_name ?? '').trim();
  if (!businessName) return err('El nombre del negocio es obligatorio');
  if (businessName.length > 120) return err('El nombre del negocio no puede superar 120 caracteres');

  const workMode = body.work_mode === 'shifts' ? 'shifts' : 'daily';
  const logoUrl = body.logo_url ? String(body.logo_url).trim().slice(0, 255) : null;

  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await execute(
    `INSERT INTO settings (id, business_name, logo_url, work_mode, updated_by, updated_at)
     VALUES ('1', ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       business_name = VALUES(business_name),
       logo_url = VALUES(logo_url),
       work_mode = VALUES(work_mode),
       updated_by = VALUES(updated_by),
       updated_at = VALUES(updated_at)`,
    [businessName, logoUrl, workMode, user.id, ts]
  );

  // Si se cambió a modo diario, cerrar turnos abiertos sin reconciliar
  if (workMode === 'daily') {
    await execute(
      `UPDATE shifts SET status='closed', closed_at=?, notes=CONCAT(IFNULL(notes,''), ' | Cerrado automáticamente al cambiar a modo diario') WHERE status='open'`,
      [ts]
    );
  }

  await logAudit({
    user_id: user.id,
    user_name: user.name,
    action: 'update',
    entity_type: 'settings',
    entity_id: '1',
    entity_name: 'Configuración del negocio',
    details: { business_name: businessName, work_mode: workMode, logo_updated: !!logoUrl },
  });

  return ok({ settings: await getBusinessSettings() });
});
