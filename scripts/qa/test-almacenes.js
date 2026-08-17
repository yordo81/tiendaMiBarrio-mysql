// ── QA: flujos de Almacenes — Traslados y Gastos con producto ──
// Autónomo: crea sus propios usuarios/productos/ubicaciones temporales,
// los prueba vía API y los elimina al final. No requiere setup-qa.js.
// Uso: node scripts/qa/test-almacenes.js   (QA_BASE=http://localhost:3011)
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

  // ── Usuario owner temporal (se elimina al final) ──
  const ownerId = 'qalmac-0000-0000-0000-000000000001';
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const hash = bcrypt.hashSync(PASSWORD, 10);
  await conn.execute(
    `INSERT INTO users (id, name, email, password_hash, role, permissions, active, created_at, updated_at)
     VALUES (?,?,?,?,?,?,1,?,?)`,
    [ownerId, 'QA Almacenes', 'qa.almacenes@test.local', hash, 'owner', '[]', now, now]
  );
  await client.login('qa.almacenes@test.local');

  const created = {
    products: [], locations: [], transfers: [],
    stockMovIds: [], locMovIds: [], expenses: [],
  };

  try {
    // ── Setup: 1 producto, 2 ubicaciones ──
    const prod = await client.req('POST', '/api/products', {
      name: 'QA Prod Almacen ' + Date.now(), sale_price: 100, cost: 50, stock: 50, min_stock: 0, active: true,
    });
    check('Producto creado', prod.status === 201 || prod.status === 200, `status=${prod.status}`);
    const pid = prod.data.id ?? prod.data.product?.id;
    created.products.push(pid);

    const locA = await client.req('POST', '/api/locations', { name: 'QA Almacen A ' + Date.now(), type: 'warehouse', active: true });
    const locB = await client.req('POST', '/api/locations', { name: 'QA Almacen B ' + Date.now(), type: 'warehouse', active: true });
    const la = locA.data.id ?? locA.data.location?.id;
    const lb = locB.data.id ?? locB.data.location?.id;
    created.locations.push(la, lb);
    check('Ubicaciones creadas', !!la && !!lb, `${la} / ${lb}`);

    // ── ENTRADA al almacén A (stock global 50 + 10 = 60) ──
    const ent = await client.req('POST', '/api/location-movements', {
      location_id: la, product_id: pid, type: 'entrada', quantity: 10, notes: 'QA entrada A',
    });
    check('Entrada a almacén A OK', ent.status === 201, `status=${ent.status}`);
    const [[{ ga }]] = await conn.execute('SELECT stock AS ga FROM products WHERE id=?', [pid]);
    check('Stock global tras entrada = 60', Number(ga) === 60, `global=${ga}`);

    // ── TRASLADO A → B ──
    // A quedó en 10 tras la entrada. Traslado de 25 (> 10) → debe rechazarse
    const tr2 = await client.req('POST', '/api/stock-transfers', {
      from_location_id: la, to_location_id: lb, items: [{ product_id: pid, quantity: 25 }], notes: 'QA traslado invalido',
    });
    check('Traslado con stock insuficiente en origen es rechazado', tr2.status >= 400 && tr2.status < 500,
      `status=${tr2.status} ${JSON.stringify(tr2.data)}`);
    const [[{ stA2 }]] = await conn.execute('SELECT quantity AS stA2 FROM location_stock WHERE location_id=? AND product_id=?', [la, pid]);
    check('Origen intacto tras rechazo (sigue en 10)', Number(stA2) === 10, `stA2=${stA2}`);

    // Traslado válido de 4 unidades: A 10→6, B 0→4, global sigue 60
    const tr3 = await client.req('POST', '/api/stock-transfers', {
      from_location_id: la, to_location_id: lb, items: [{ product_id: pid, quantity: 4 }], notes: 'QA traslado 2',
    });
    check('Traslado válido registrado', tr3.status === 201, `status=${tr3.status}`);
    const [[{ sA3 }]] = await conn.execute('SELECT quantity AS sA3 FROM location_stock WHERE location_id=? AND product_id=?', [la, pid]);
    const [[{ sB3 }]] = await conn.execute('SELECT quantity AS sB3 FROM location_stock WHERE location_id=? AND product_id=?', [lb, pid]);
    const [[{ g3 }]] = await conn.execute('SELECT stock AS g3 FROM products WHERE id=?', [pid]);
    check('A = 6 (10-4)', Number(sA3) === 6, `A=${sA3}`);
    check('B = 4 (0+4)', Number(sB3) === 4, `B=${sB3}`);
    check('Stock global NO cambia con el traslado (60)', Number(g3) === 60, `global=${g3}`);

    // Movimientos de almacén registrados
    const movs = await client.req('GET', `/api/location-movements?location_id=${la}&product_id=${pid}`);
    const typesOut = (movs.data ?? []).map(x => String(x.type));
    const movsB = await client.req('GET', `/api/location-movements?location_id=${lb}&product_id=${pid}`);
    const typesIn = (movsB.data ?? []).map(x => String(x.type));
    check('Movimiento traslado_out en origen', typesOut.includes('traslado_out'), `tipos=${JSON.stringify(typesOut)}`);
    check('Movimiento traslado_in en destino', typesIn.includes('traslado_in'), `tipos=${JSON.stringify(typesIn)}`);

    // ── GASTO con producto ──
    // A tiene 6 → gasto de 2 del almacén A: global 60→58, A 6→4
    const exp = await client.req('POST', '/api/expenses', {
      description: 'QA Gasto producto test', amount: 100, payment_method: 'cash',
      product_id: pid, product_quantity: 2, location_id: la, notes: 'QA',
    });
    check('Gasto con producto registrado', exp.status === 201, `status=${exp.status} ${JSON.stringify(exp.data)}`);
    const expId = exp.data?.id;
    created.expenses.push(expId);

    const [[{ gExp }]] = await conn.execute('SELECT stock AS gExp FROM products WHERE id=?', [pid]);
    const [[{ sAExp }]] = await conn.execute('SELECT quantity AS sAExp FROM location_stock WHERE location_id=? AND product_id=?', [la, pid]);
    check('Gasto: stock global 60→58', Number(gExp) === 58, `global=${gExp}`);
    check('Gasto: almacén A 6→4', Number(sAExp) === 4, `A=${sAExp}`);

    const sm = await client.req('GET', `/api/reports?type=stock_movements&product_id=${pid}`);
    const lastExp = (Array.isArray(sm.data) ? sm.data : sm.data?.movements ?? []).find(x => String(x.type) === 'expense');
    check('Movimiento global tipo "expense" registrado', !!lastExp, `tipo=${lastExp?.type}`);
    const lm = await client.req('GET', `/api/location-movements?location_id=${la}&product_id=${pid}`);
    const gastoMov = (lm.data ?? []).find(x => String(x.type) === 'gasto');
    check('Movimiento de almacén tipo "gasto" registrado', !!gastoMov, `tipo=${gastoMov?.type}`);

    // Gasto con stock insuficiente en el almacén → rechazado (todo revierte)
    const expBad = await client.req('POST', '/api/expenses', {
      description: 'QA Gasto sin stock', amount: 100, payment_method: 'cash',
      product_id: pid, product_quantity: 999, location_id: la,
    });
    check('Gasto con stock insuficiente en almacén es rechazado', expBad.status >= 400 && expBad.status < 500,
      `status=${expBad.status} ${JSON.stringify(expBad.data)}`);
    const [[{ gBad }]] = await conn.execute('SELECT stock AS gBad FROM products WHERE id=?', [pid]);
    check('Stock global intacto tras gasto rechazado (58)', Number(gBad) === 58, `global=${gBad}`);

    // ── ELIMINAR gasto → revierte stock ──
    const del = await client.req('DELETE', '/api/expenses', { id: expId });
    check('Gasto eliminado', del.status === 200, `status=${del.status} ${JSON.stringify(del.data)}`);
    const [[{ gDel }]] = await conn.execute('SELECT stock AS gDel FROM products WHERE id=?', [pid]);
    const [[{ sADel }]] = await conn.execute('SELECT quantity AS sADel FROM location_stock WHERE location_id=? AND product_id=?', [la, pid]);
    check('Al borrar el gasto: stock global vuelve a 60', Number(gDel) === 60, `global=${gDel}`);
    check('Al borrar el gasto: almacén A vuelve a 6', Number(sADel) === 6, `A=${sADel}`);
    const lmAfter = await client.req('GET', `/api/location-movements?location_id=${la}&product_id=${pid}`);
    check('Movimiento tipo "gasto" eliminado del historial', !(lmAfter.data ?? []).some(x => String(x.type) === 'gasto'),
      `tipos=${JSON.stringify((lmAfter.data ?? []).map(x => String(x.type)))}`);

    // ── Filtro de fechas (regresión): expenses.date se guarda en UTC. Un
    // gasto creado ahora (en Cuba: noche local = día siguiente en UTC) debe
    // aparecer en el filtro del día local actual ──
    const localDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    const exp2 = await client.req('POST', '/api/expenses', {
      description: 'QA Gasto filtro fecha', amount: 50, payment_method: 'cash',
      product_id: pid, product_quantity: 1, location_id: la,
    });
    const exp2Id = exp2.data?.id;
    created.expenses.push(exp2Id);
    const list = await client.req('GET', `/api/expenses?from=${localDay}&to=${localDay}`);
    const included = (list.data ?? []).some(e => String(e.id) === String(exp2Id));
    check(`Gasto creado ahora aparece en el filtro del día local (${localDay})`, included,
      `guardado=${exp2.data?.date ?? '?'}, from/to=${localDay}; ${included ? 'sí aparece' : 'NO aparece (filtraba contra UTC)'}`);
  } finally {
    // ── Cleanup: borrar solo lo creado por este test ──
    await conn.beginTransaction();
    try {
      const lidList = created.locations;
      const ph = lidList.map(() => '?').join(',');
      // Hijos primero (FK): movimientos, traslados, gastos
      if (lidList.length) {
        await conn.execute(`DELETE FROM location_movements WHERE location_id IN (${ph})`, lidList);
        await conn.execute(`DELETE FROM stock_transfers WHERE from_location_id IN (${ph}) OR to_location_id IN (${ph})`, [...lidList, ...lidList]);
      }
      for (const pid of created.products) {
        await conn.execute('DELETE FROM location_movements WHERE product_id=?', [pid]);
        await conn.execute('DELETE FROM stock_movements WHERE product_id=?', [pid]);
      }
      for (const eid of created.expenses) await conn.execute('DELETE FROM expenses WHERE id=?', [eid]);
      for (const pid of created.products) await conn.execute('DELETE FROM products WHERE id=?', [pid]);
      for (const lid of lidList) await conn.execute('DELETE FROM locations WHERE id=?', [lid]);
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
  console.log(`\n════════ RESUMEN ALMACENES ════════`);
  console.log(`PASS: ${pass}  FAIL: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(2); });
