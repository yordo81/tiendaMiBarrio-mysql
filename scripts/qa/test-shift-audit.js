// ── QA: Auditoría del cierre de turno — desglose por método de pago ──
// Autónomo: crea usuario/producto/punto de venta/caja temporales, abre un
// turno, registra ventas en efectivo/transferencia/mixto, cierra el turno y
// verifica que el registro de auditoría incluya el desglose por método.
// Uso: node scripts/qa/test-shift-audit.js   (QA_BASE=http://localhost:3011)
const fs = require('fs');
const m = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const BASE = process.env.QA_BASE ?? 'http://localhost:3011';
const env = fs.readFileSync('.env.local', 'utf8');
const DB = {
  host: 'localhost', port: 3306, user: 'root',
  password: env.match(/DB_PASSWORD=(\S+)/)[1], database: 'tienda_mi_barrio',
};
const PASSWORD = 'QaTest123!';

function makeClient() {
  let cookie = '';
  return {
    async req(method, url, body) {
      const res = await fetch(BASE + url, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      let data = null;
      try { data = await res.json(); } catch {}
      return { status: res.status, data };
    },
    async login(email) {
      const r = await this.req('POST', '/api/auth/login', { email, password: PASSWORD });
      if (r.status !== 200) throw new Error('login falló: ' + JSON.stringify(r.data));
      return r;
    },
  };
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? '\n       → ' + detail : ''}`);
  if (ok) pass++; else fail++;
}

async function main() {
  const conn = await m.createConnection(DB);
  const client = makeClient();

  const ownerId = 'qturno-0000-0000-0000-000000000001';
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const hash = bcrypt.hashSync(PASSWORD, 10);
  await conn.execute(
    `INSERT INTO users (id, name, email, password_hash, role, permissions, active, created_at, updated_at)
     VALUES (?,?,?,?,?,?,1,?,?)`,
    [ownerId, 'QA Turno', 'qa.turno@test.local', hash, 'owner', '[]', now, now]
  );
  await client.login('qa.turno@test.local');

  // Guardar y forzar modo por turnos (se restaura al final)
  const [[before]] = await conn.execute("SELECT work_mode FROM settings WHERE id='1'");
  const prevWorkMode = before?.work_mode;
  await conn.execute("UPDATE settings SET work_mode='shifts' WHERE id='1'");

  const ids = { pos: null, loc: null, prod: null, shift: null, sales: [] };

  try {
    // ── Setup: punto de venta (store) + caja + producto con stock ──
    const loc = await client.req('POST', '/api/locations', { name: 'QA Tienda Turno ' + Date.now(), type: 'store', active: true });
    ids.loc = loc.data.id ?? loc.data.location?.id;
    check('Punto de venta creado', !!ids.loc, ids.loc);

    const pos = await client.req('POST', '/api/pos', { name: 'QA Caja Turno', location_id: ids.loc, active: true });
    ids.pos = pos.data?.id;
    check('Caja (POS) creada', !!ids.pos, `status=${pos.status} ${JSON.stringify(pos.data)}`);

    const prod = await client.req('POST', '/api/products', {
      name: 'QA Prod Turno ' + Date.now(), sale_price: 100, cost: 50, stock: 100, min_stock: 0, active: true,
    });
    ids.prod = prod.data.id ?? prod.data.product?.id;
    await conn.execute(
      'INSERT INTO location_stock (id, location_id, product_id, quantity, updated_at) VALUES (?,?,?,100,?)',
      ['qstock-0000-0000-0000-000000000001', ids.loc, ids.prod, now]
    );

    // ── Abrir turno con fondo 100 ──
    const open = await client.req('POST', '/api/shifts', { pos_id: ids.pos, opening_cash: 100, notes: 'QA turno' });
    check('Turno abierto', open.status === 201, `status=${open.status} ${JSON.stringify(open.data)}`);
    ids.shift = open.data?.shift?.id;

    // ── Ventas: 1 efectivo (100), 1 transferencia (100), 1 mixto (50/50) ──
    const cashSale = await client.req('POST', '/api/sales', {
      items: [{ product_id: ids.prod, quantity: 1 }],
      payment: { method: 'cash', amount_cash: 100, amount_transfer: 0 },
      pos_id: ids.pos, location_id: ids.loc, customer_id: null, notes: 'QA cash',
    });
    ids.sales.push(cashSale.data?.id);
    check('Venta en efectivo registrada', cashSale.status === 201, `status=${cashSale.status}`);

    const trfSale = await client.req('POST', '/api/sales', {
      items: [{ product_id: ids.prod, quantity: 1 }],
      payment: { method: 'transfer', amount_cash: 0, amount_transfer: 100 },
      pos_id: ids.pos, location_id: ids.loc, customer_id: null, notes: 'QA transfer',
    });
    ids.sales.push(trfSale.data?.id);
    check('Venta por transferencia registrada', trfSale.status === 201, `status=${trfSale.status}`);

    const mixSale = await client.req('POST', '/api/sales', {
      items: [{ product_id: ids.prod, quantity: 1 }],
      payment: { method: 'mixed', amount_cash: 50, amount_transfer: 50 },
      pos_id: ids.pos, location_id: ids.loc, customer_id: null, notes: 'QA mixed',
    });
    ids.sales.push(mixSale.data?.id);
    check('Venta mixta registrada', mixSale.status === 201, `status=${mixSale.status}`);

    // ── Cerrar turno (contado = 100 fondo + 100 efectivo + 50 mixto = 250) ──
    const close = await client.req('POST', `/api/shifts/${ids.shift}/close`, { closing_cash: 250, notes: 'QA cierre' });
    check('Turno cerrado', close.status === 200, `status=${close.status} ${JSON.stringify(close.data)}`);

    // ── Auditoría: buscar el cierre y validar el desglose ──
    const logs = await client.req('GET', `/api/audit-logs?entity_type=shift&action=close&limit=500`);
    const row = (logs.data ?? []).find(l => String(l.entity_id) === String(ids.shift));
    check('Registro de auditoría del cierre existe', !!row, `status=${logs.status}`);
    // El driver devuelve la columna JSON ya parseada como objeto (o como
    // string según la versión): se manejan ambos casos, igual que la UI.
    let details = null;
    try {
      details = typeof row?.details === 'string' ? JSON.parse(row.details) : (row?.details ?? null);
    } catch { details = null; }
    check('details del cierre presentes', !!details, JSON.stringify(details));

    const pb = details?.payment_breakdown;
    check('Desglose por método presente', !!pb && typeof pb === 'object', JSON.stringify(pb));
    check('Efectivo: 1 venta · $100 (todo en cash)',
      Number(pb?.cash?.count) === 1 && Number(pb?.cash?.total) === 100 && Number(pb?.cash?.cash) === 100,
      JSON.stringify(pb?.cash));
    check('Transferencia: 1 venta · $100 (todo por transferencia)',
      Number(pb?.transfer?.count) === 1 && Number(pb?.transfer?.total) === 100 && Number(pb?.transfer?.transfer) === 100,
      JSON.stringify(pb?.transfer));
    check('Mixto: 1 venta · $100 (50 cash + 50 transferencia)',
      Number(pb?.mixed?.count) === 1 && Number(pb?.mixed?.total) === 100 &&
      Number(pb?.mixed?.cash) === 50 && Number(pb?.mixed?.transfer) === 50,
      JSON.stringify(pb?.mixed));
    const sumTotal = ['cash','transfer','mixed'].reduce((a, k) => a + Number(pb?.[k]?.total ?? 0), 0);
    check('Suma del desglose = $300 (3 ventas × $100)', sumTotal === 300, `suma=${sumTotal}`);
    // El arqueo suma además abonos sueltos y movimientos de caja preexistentes
    // de la BD ("cuentan en todos" por diseño), así que el invariante real es
    // que la auditoría refleje EXACTAMENTE el arqueo del cierre.
    check('expected_cash de la auditoría = arqueo del cierre',
      Number(details?.expected_cash) === Number(close.data?.expected_cash),
      `audit=${details?.expected_cash}, close=${close.data?.expected_cash}`);

    // ── Reporte del turno (modal/PDF): debe incluir el mismo desglose ──
    const rep = await client.req('GET', `/api/shifts/${ids.shift}/report`);
    check('Reporte del turno disponible', rep.status === 200, `status=${rep.status}`);
    const rpb = rep.data?.payment_breakdown;
    check('Reporte: desglose por método presente', !!rpb && typeof rpb === 'object', JSON.stringify(rpb));
    check('Reporte: efectivo · 1 venta · $100',
      Number(rpb?.cash?.count) === 1 && Number(rpb?.cash?.total) === 100 && Number(rpb?.cash?.cash) === 100,
      JSON.stringify(rpb?.cash));
    check('Reporte: transferencia · 1 venta · $100',
      Number(rpb?.transfer?.count) === 1 && Number(rpb?.transfer?.total) === 100 && Number(rpb?.transfer?.transfer) === 100,
      JSON.stringify(rpb?.transfer));
    check('Reporte: mixto · 1 venta · $100 (50/50)',
      Number(rpb?.mixed?.count) === 1 && Number(rpb?.mixed?.total) === 100 &&
      Number(rpb?.mixed?.cash) === 50 && Number(rpb?.mixed?.transfer) === 50,
      JSON.stringify(rpb?.mixed));
  } finally {
    // ── Cleanup ──
    await conn.beginTransaction();
    try {
      const pids = ids.prod ? [ids.prod] : [];
      const lids = ids.loc ? [ids.loc] : [];
      const phP = pids.map(() => '?').join(',');
      const phL = lids.map(() => '?').join(',');
      if (lids.length) {
        await conn.execute(`DELETE FROM location_movements WHERE location_id IN (${phL})`, lids);
        await conn.execute(`DELETE FROM stock_transfers WHERE from_location_id IN (${phL}) OR to_location_id IN (${phL})`, [...lids, ...lids]);
      }
      for (const pid of pids) {
        await conn.execute('DELETE FROM location_movements WHERE product_id=?', [pid]);
        await conn.execute('DELETE FROM stock_movements WHERE product_id=?', [pid]);
        await conn.execute('DELETE FROM location_stock WHERE product_id=?', [pid]);
      }
      for (const sid of ids.sales) {
        if (!sid) continue;
        await conn.execute('DELETE FROM sale_items WHERE sale_id=?', [sid]);
        await conn.execute('DELETE FROM payments WHERE sale_id=?', [sid]);
        await conn.execute('DELETE FROM customer_payments WHERE sale_id=?', [sid]);
        await conn.execute('DELETE FROM sales WHERE id=?', [sid]);
      }
      if (ids.shift) {
        await conn.execute('DELETE FROM cash_register WHERE shift_id=?', [ids.shift]);
        await conn.execute('DELETE FROM shifts WHERE id=?', [ids.shift]);
      }
      if (ids.pos) await conn.execute('DELETE FROM pos WHERE id=?', [ids.pos]);
      for (const pid of pids) await conn.execute('DELETE FROM products WHERE id=?', [pid]);
      for (const lid of lids) await conn.execute('DELETE FROM locations WHERE id=?', [lid]);
      await conn.execute("UPDATE settings SET work_mode=? WHERE id='1'", [prevWorkMode]);
      await conn.execute('DELETE FROM users WHERE id=?', [ownerId]);
      await conn.execute('DELETE FROM audit_logs WHERE user_id=?', [ownerId]);
      await conn.commit();
      console.log('🧹 Cleanup OK');
    } catch (e) {
      await conn.rollback();
      console.error('🧹 Cleanup falló:', e.message);
    }
  }

  await conn.end();
  console.log(`\n════════ RESUMEN SHIFT AUDIT ════════`);
  console.log(`PASS: ${pass}  FAIL: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(2); });
