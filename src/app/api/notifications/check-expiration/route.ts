export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, execute } from '@/lib/db/mysql';
import { handle, ok } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

// ── Check Expiration + Low Stock Notifications ────────────────────
// Verifica:
//   1. Productos perecederos próximos a vencer (5, 15, 30 días)
//   2. Productos ya vencidos (expired)
//   3. Productos con stock bajo (low_stock)
//   4. Productos próximos a vencer Y con stock bajo (severity elevada)
// Se llama desde el frontend al cargar el dashboard (polling cada 2 min).

async function createNotification(
  type: string, productId: string | null, title: string,
  message: string, severity: 'critical' | 'warning' | 'info' | 'success', ts: string
) {
  const existing = await query<{ id: string }>(
    'SELECT id FROM notification_logs WHERE type = ? AND product_id <=> ? AND dismissed = 0 LIMIT 1',
    [type, productId]
  );
  if (existing.length > 0) return null; // Ya notificado

  const id = randomUUID();
  await execute(
    `INSERT INTO notification_logs (id, type, product_id, title, message, severity, dismissed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    [id, type, productId, title, message, severity, ts]
  );
  return { id, type, product_id: productId, title, message, severity, created_at: ts };
}

export const GET = handle(async () => {
  await requireAuth();
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const newNotifications: { id: string; type: string; product_id: string | null; title: string; message: string; severity: string; created_at: string }[] = [];

  // ═══════════════════════════════════════════════════════════════
  // 1. Productos perecederos PRÓXIMOS A VENCER (5, 15, 30 días)
  // ═══════════════════════════════════════════════════════════════
  const thresholds = [
    { days: 5,  type: 'expiration_5d',  severity: 'critical' as const },
    { days: 15, type: 'expiration_15d', severity: 'warning'  as const },
    { days: 30, type: 'expiration_30d', severity: 'info'     as const },
  ];

  for (const threshold of thresholds) {
    const products = await query<{
      id: string; name: string; expiration_date: string;
      stock: number; min_stock: number; unit: string; category_name: string | null;
      days_left: number;
    }>(`
      SELECT p.id, p.name, p.expiration_date,
        COALESCE((SELECT SUM(quantity) FROM location_stock WHERE product_id = p.id), p.stock) AS stock,
        p.min_stock, p.unit, c.name AS category_name,
        DATEDIFF(p.expiration_date, CURDATE()) AS days_left
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.active = 1
        AND p.is_perishable = 1
        AND p.expiration_date IS NOT NULL
        AND DATEDIFF(p.expiration_date, CURDATE()) BETWEEN 0 AND ?
      ORDER BY p.expiration_date ASC
    `, [threshold.days]);

    for (const product of products) {
      const daysLeft = Number(product.days_left);
      const stock = Number(product.stock);
      const minStock = Number(product.min_stock);
      const isLowStock = minStock > 0 && stock <= minStock;
      const isOutOfStock = stock <= 0;

      // Determinar si está en el rango de este umbral
      let matchesThreshold = false;
      if (threshold.days === 30 && daysLeft > 15 && daysLeft <= 30) matchesThreshold = true;
      else if (threshold.days === 15 && daysLeft > 5 && daysLeft <= 15) matchesThreshold = true;
      else if (threshold.days === 5 && daysLeft <= 5) matchesThreshold = true;
      if (!matchesThreshold) continue;

      // Elevar severidad si además tiene stock bajo o está sin stock
      let severity = threshold.severity;
      const effectiveType = isLowStock || isOutOfStock ? `${threshold.type}_lowstock` : threshold.type;
      if (isOutOfStock) severity = 'critical';
      else if (isLowStock && threshold.severity === 'info') severity = 'warning';

      const stockInfo = `${stock} ${product.unit ?? 'unidad(es)'}`;
      const catInfo = product.category_name ? ` (${product.category_name})` : '';
      const stockWarning = isOutOfStock ? ' ¡SIN STOCK!' : isLowStock ? ' (stock bajo)' : '';

      let title: string;
      let message: string;

      if (threshold.days === 5 || isOutOfStock) {
        title = `⚠️ ${product.name} está por vencer${stockWarning}`;
        message = `Quedan ${daysLeft} día(s). Vence: ${String(product.expiration_date).split('-').reverse().join('/')}. Stock: ${stockInfo}.${catInfo}`;
      } else {
        title = `📅 ${product.name} vencerá pronto${stockWarning}`;
        message = `Vence el ${String(product.expiration_date).split('-').reverse().join('/')} (${daysLeft} días). Stock: ${stockInfo}.${catInfo}`;
      }

      const notif = await createNotification(effectiveType, product.id, title, message, severity, ts);
      if (notif) newNotifications.push(notif);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. Productos perecederos YA VENCIDOS (expired)
  // ═══════════════════════════════════════════════════════════════
  const expiredProducts = await query<{
    id: string; name: string; expiration_date: string;
    stock: number; unit: string; category_name: string | null;
    days_since_expired: number;
  }>(`
    SELECT p.id, p.name, p.expiration_date,
      COALESCE((SELECT SUM(quantity) FROM location_stock WHERE product_id = p.id), p.stock) AS stock,
      p.unit, c.name AS category_name,
      ABS(DATEDIFF(p.expiration_date, CURDATE())) AS days_since_expired
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1
      AND p.is_perishable = 1
      AND p.expiration_date IS NOT NULL
      AND p.expiration_date < CURDATE()
    ORDER BY p.expiration_date ASC
  `);

  for (const product of expiredProducts) {
    const stock = Number(product.stock);
    const isInStock = stock > 0;

    // Clasificar por antigüedad del vencimiento
    let type: string;
    let severity: 'critical' | 'warning';

    if (stock > 0) {
      // Producto vencido pero aún en stock — lo más crítico
      type = 'expired_instock';
      severity = 'critical';
    } else {
      type = 'expired';
      severity = 'warning';
    }

    const stockInfo = `${stock} ${product.unit ?? 'unidad(es)'}`;
    const catInfo = product.category_name ? ` (${product.category_name})` : '';
    const daysSince = Number(product.days_since_expired);

    const title = stock > 0
      ? `🔴 ${product.name} está VENCIDO y tiene stock`
      : `🔴 ${product.name} está vencido`;
    const message = `Venció hace ${daysSince} día(s). Vencía: ${String(product.expiration_date).split('-').reverse().join('/')}. Stock: ${stockInfo}.${catInfo}`;

    const notif = await createNotification(type, product.id, title, message, severity, ts);
    if (notif) newNotifications.push(notif);
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. Productos con STOCK BAJO (low_stock)
  // ═══════════════════════════════════════════════════════════════
  // Solo para productos NO perecederos o perecederos sin fecha,
  // porque los perecederos con fecha ya quedan cubiertos arriba.
  const lowStockProducts = await query<{
    id: string; name: string; stock: number; min_stock: number;
    unit: string; category_name: string | null;
  }>(`
    SELECT p.id, p.name,
      COALESCE((SELECT SUM(quantity) FROM location_stock WHERE product_id = p.id), p.stock) AS stock,
      p.min_stock, p.unit, c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1
      AND p.min_stock > 0
      AND (
        (p.is_perishable = 1 AND p.expiration_date IS NULL AND COALESCE((SELECT SUM(quantity) FROM location_stock WHERE product_id = p.id), p.stock) <= p.min_stock)
        OR
        (p.is_perishable = 0 AND COALESCE((SELECT SUM(quantity) FROM location_stock WHERE product_id = p.id), p.stock) <= p.min_stock)
      )
    ORDER BY (COALESCE((SELECT SUM(quantity) FROM location_stock WHERE product_id = p.id), p.stock) * 1.0 / p.min_stock) ASC
  `);

  for (const product of lowStockProducts) {
    const stock = Number(product.stock);
    const minStock = Number(product.min_stock);
    const isOutOfStock = stock <= 0;

    const type = isOutOfStock ? 'out_of_stock' : 'low_stock';
    const severity = isOutOfStock ? 'critical' as const : 'warning' as const;

    const fillPct = minStock > 0 ? Math.round((stock / minStock) * 100) : 0;
    const stockInfo = `${stock} / ${minStock} ${product.unit ?? 'unidad(es)'}`;
    const catInfo = product.category_name ? ` (${product.category_name})` : '';

    const title = isOutOfStock
      ? `🔴 ${product.name} está AGOTADO`
      : `⚠️ ${product.name} tiene stock bajo`;
    const message = isOutOfStock
      ? `Stock: ${stockInfo}.${catInfo}`
      : `Stock: ${stockInfo} (${fillPct}% del mínimo).${catInfo}`;

    const notif = await createNotification(type, product.id, title, message, severity, ts);
    if (notif) newNotifications.push(notif);
  }

  // ═══════════════════════════════════════════════════════════════
  // Obtener todas las notificaciones activas
  // ═══════════════════════════════════════════════════════════════
  const activeNotifications = await query<{
    id: string; type: string; title: string; message: string;
    severity: string; product_id: string | null;
    created_at: string; read_at: string | null;
  }>(
    `SELECT id, type, title, message, severity, product_id, created_at, read_at
     FROM notification_logs
     WHERE dismissed = 0
     ORDER BY
       FIELD(severity, 'critical', 'warning', 'info', 'success'),
       created_at DESC
     LIMIT 50`
  );

  return ok({
    new: newNotifications.length,
    total_active: activeNotifications.length,
    notifications: activeNotifications.map(n => ({
      ...n,
      severity: n.severity,
    })),
  });
});
