export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, execute } from '@/lib/db/mysql';
import { validateUserRole } from '@/lib/validate';
import { handle, ok, err, forbidden } from '@/lib/api-helpers';
import { logAudit } from '@/lib/db/audit';
import * as bcrypt from 'bcryptjs';

export const PUT = handle(async (req: Request, ctx) => {
  const { id } = await ctx!.params;
  const me = await requireAuth();
  const body = await req.json();

  // ── Permisos por rol ─────────────────────────────────────────────
  // Dueño: puede actualizar cualquier campo de cualquier usuario.
  // Admin: solo puede CAMBIAR CONTRASEÑAS de vendedores y bodegueros
  //        (no de otros admins, ni del dueño, ni editar otros campos).
  const targetRole = me.role === 'admin'
    ? (await query<{ role: string }>('SELECT role FROM users WHERE id=?', [id]))[0]?.role
    : undefined;
  if (me.role !== 'owner') {
    if (me.role !== 'admin') return forbidden('Sin permiso');
    const isPasswordOnly = Object.keys(body).length === 1 && body.password !== undefined;
    if (!isPasswordOnly) return forbidden('El administrador solo puede cambiar contraseñas');
    if (targetRole !== 'seller' && targetRole !== 'warehouse') {
      return forbidden('El administrador solo puede cambiar contraseñas de vendedores y bodegueros');
    }
  }

  const ts = new Date().toISOString().slice(0,19).replace('T',' ');
  const fields: string[] = []; const values: unknown[] = [];
  if (body.name !== undefined)        { fields.push('name=?');        values.push(body.name); }
  if (body.role !== undefined)        { fields.push('role=?');        values.push(validateUserRole(body.role)); }
  if (body.active !== undefined)      { fields.push('active=?');      values.push(body.active?1:0); }
  if (body.permissions !== undefined) { fields.push('permissions=?'); values.push(JSON.stringify(body.permissions)); }
  if (body.pos_id !== undefined) {
    // Asociar (o desvincular) la caja del usuario; solo dueño (el admin no llega aquí)
    const posId = String(body.pos_id ?? '').trim();
    if (posId) {
      const pos = await query('SELECT id FROM pos WHERE id = ? AND active = 1', [posId]);
      if (!pos.length) return err('La caja seleccionada no existe o está desactivada');
    }
    fields.push('pos_id=?'); values.push(posId || null);
  }
  if (body.password) { if (String(body.password).length < 6) return err('La contraseña debe tener al menos 6 caracteres'); fields.push('password_hash=?'); values.push(await bcrypt.hash(body.password,12)); }
  if (!fields.length) return err('Nada que actualizar');
  fields.push('updated_at=?'); values.push(ts); values.push(id);
  await execute(`UPDATE users SET ${fields.join(',')} WHERE id=?`, values);

  // Auditoría: cuando el dueño o admin cambia la contraseña de otro usuario
  if (body.password) {
    const target = await query<{ id: string; name: string }>('SELECT id,name FROM users WHERE id=?', [id]);
    const targetName = target[0]?.name ?? body.name ?? id;
    await logAudit({
      user_id: me.id,
      user_name: me.name,
      action: 'password_change',
      entity_type: 'user',
      entity_id: id,
      entity_name: targetName,
      details: { changed_by: me.id === id ? 'self' : me.role },
    });
  }

  const rows = await query<Record<string,unknown>>(
    `SELECT u.id,u.name,u.email,u.role,u.permissions,u.active,u.pos_id,p.name AS pos_name,u.created_at,u.updated_at
     FROM users u LEFT JOIN pos p ON p.id = u.pos_id WHERE u.id=?`,
    [id]
  );
  const r = rows[0];
  return ok({ ...r, active: Boolean(r.active), permissions: typeof r.permissions==='string'?JSON.parse(r.permissions as string):(r.permissions??[]) });
});
