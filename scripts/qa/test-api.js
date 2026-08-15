// ── QA: pruebas API — Punto 5 (zona horaria móvil) y Punto 7 (entrada de stock) ──
// Uso: node scripts/qa/test-api.js   (requiere setup-qa.js ejecutado antes)
const fs = require('fs');
const path = require('path');
const m = require('mysql2/promise');

const BASE = 'http://localhost:3011';
const env = fs.readFileSync('.env.local', 'utf8');
const DB = {
  host: 'localhost', port: 3306, user: 'root',
  password: env.match(/DB_PASSWORD=(\S+)/)[1], database: 'tienda_mi_barrio',
};
const snap = JSON.parse(fs.readFileSync(path.join(__dirname, 'snapshot.json'), 'utf8'));
const PASSWORD = 'QaTest123!';

// ── Cookie jar minimal ──
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
      return r;
    },
  };
}

// ── Helpers ──
let pass = 0, fail = 0;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? '\n       → ' + detail : ''}`);
}
function assert(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); }

async function db() { return m.createConnection(DB); }

// Fecha/hora actual en la zona horaria del negocio (TIMEZONE default America/Havana)
const TZ = process.env.TIMEZONE ?? 'America/Havana';
function nowLocalStr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date()).replace(', ', ' ');
}
function nowUtcStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

async function main() {
  const conn = await db();
  const client = makeClient();

  console.log('═══ PUNTO 7: BUG DE ENTRADA DE STOCK ═══════════════════════\n');
  {
    const login = await client.login('qa.owner@test.local');
    assert(login.status === 200, 'login owner');

    // 1) Crear producto de prueba con stock inicial 5
    const prodName = 'QA Producto Entrada ' + Date.now();
    const prod = await client.req('POST', '/api/products', {
      name: prodName, sale_price: 100, cost: 50, stock: 5, min_stock: 0, active: true,
    });
    assert(prod.status === 201 || prod.status === 200, 'crear producto: ' + JSON.stringify(prod.data));
    const productId = prod.data.id ?? prod.data.product?.id;
    assert(productId, 'productId obtenido');
    console.log(`Producto QA: ${prodName} (${productId}), stock inicial = 5`);

    // 2) Crear ubicación de prueba
    const loc = await client.req('POST', '/api/locations', { name: 'QA Almacén Test', type: 'warehouse', active: true });
    assert(loc.status === 201 || loc.status === 200, 'crear ubicación: ' + JSON.stringify(loc.data));
    const locationId = loc.data.id ?? loc.data.location?.id;
    assert(locationId, 'locationId obtenido');

    // 3) ENTRADA de 10 unidades
    const before = await client.req('GET', `/api/locations/stock?location_id=${locationId}`);
    const ent = await client.req('POST', '/api/location-movements', {
      location_id: locationId, product_id: productId, type: 'entrada', quantity: 10, notes: 'QA entrada test',
    });
    check('Entrada registrada (HTTP 201)', ent.status === 201, `status=${ent.status} ${JSON.stringify(ent.data)}`);

    // 4) Verificar stock de la ubicación → debe ser 10
    const after = await client.req('GET', `/api/locations/stock?location_id=${locationId}`);
    const locRow = (after.data ?? []).find(r => String(r.product_id) === String(productId));
    check('Stock del ALMACÉN sube a 10 tras entrada', Number(locRow?.quantity) === 10,
      `location_stock = ${locRow?.quantity ?? 'sin fila'} (esperado 10)`);

    // 5) Verificar stock GLOBAL del producto → debe ser 15 (5 + 10)
    const prods = await client.req('GET', '/api/products');
    const pRow = (prods.data ?? []).find(p => String(p.id) === String(productId));
    check('Stock GLOBAL sube a 15 tras entrada (esperado 5+10)',
      Number(pRow?.stock) === 15,
      `products.stock = ${pRow?.stock ?? '?'} (esperado 15). Si bajó, el código resta en lugar de sumar — BUG`);

    // 6) Verificar el movimiento de stock global (debe ser tipo 'in')
    const movs = await client.req('GET', `/api/reports?type=stock_movements&product_id=${productId}`);
    const lastIn = (Array.isArray(movs.data) ? movs.data : movs.data?.movements ?? [])
      .filter(x => String(x.product_id) === String(productId))[0];
    check('Movimiento de stock registrado como tipo "in" (entrada)',
      lastIn && String(lastIn.type) === 'in',
      `tipo = ${lastIn?.type ?? '?'} (esperado 'in'), razón = "${lastIn?.reason ?? '?'}"`);

    // 7) Verificar el movimiento de almacén (debe ser 'entrada')
    const locMovs = await client.req('GET', `/api/location-movements?location_id=${locationId}&product_id=${productId}`);
    const lm = (locMovs.data ?? []).find(x => String(x.product_id) === String(productId));
    check('Movimiento de ALMACÉN registrado como "entrada"', lm && String(lm.type) === 'entrada',
      `tipo = ${lm?.type ?? '?'}`);

    // 8) CONTROL: salida de 2 unidades
    await client.req('POST', '/api/location-movements', {
      location_id: locationId, product_id: productId, type: 'salida', quantity: 2, notes: 'QA salida test',
    });
    const afterOut = await client.req('GET', `/api/locations/stock?location_id=${locationId}`);
    const locOutRow = (afterOut.data ?? []).find(r => String(r.product_id) === String(productId));
    check('CONTROL salida: stock del almacén baja a 8', Number(locOutRow?.quantity) === 8,
      `location_stock = ${locOutRow?.quantity ?? '?'} (esperado 8)`);

    // 9) CONTROL: ajuste a 25
    await client.req('POST', '/api/location-movements', {
      location_id: locationId, product_id: productId, type: 'ajuste', quantity: 25, notes: 'QA ajuste test',
    });
    const afterAdj = await client.req('GET', `/api/locations/stock?location_id=${locationId}`);
    const locAdjRow = (afterAdj.data ?? []).find(r => String(r.product_id) === String(productId));
    const prods2 = await client.req('GET', '/api/products');
    const pRow2 = (prods2.data ?? []).find(p => String(p.id) === String(productId));
    check('CONTROL ajuste: stock del almacén = 25', Number(locAdjRow?.quantity) === 25,
      `location_stock = ${locAdjRow?.quantity ?? '?'} (esperado 25)`);
    console.log(`       (stock global tras ajuste: ${pRow2?.stock ?? '?'})`);

    // 10) Validación negativa: salida sin stock
    const neg = await client.req('POST', '/api/location-movements', {
      location_id: locationId, product_id: productId, type: 'salida', quantity: 999, notes: 'QA negativo',
    });
    check('Salida mayor al stock es rechazada', neg.status === 400 || neg.status === 500,
      `status=${neg.status} ${JSON.stringify(neg.data)}`);
  }

  console.log('\n═══ PUNTO 5: ZONA HORARIA MÓVIL ════════════════════════════\n');
  {
    const nowLocal = nowLocalStr();
    const nowUtc = nowUtcStr();
    console.log(`Hora actual — negocio (${TZ}): ${nowLocal}`);
    console.log(`Hora actual — UTC:               ${nowUtc}`);

    // Las ventas las registra el VENDEDOR (el POS táctil usa /api/sales).
    // Los productos los crea el dueño (el vendedor no tiene permiso de crear).
    const sellerApi = makeClient();
    await sellerApi.login('qa.seller@test.local');

    // Venta vía WEB (/api/sales) — la que usa el POS táctil
    const prodNameW = 'QA Prod Web ' + Date.now();
    const prodW = await client.req('POST', '/api/products', { name: prodNameW, sale_price: 250, cost: 150, stock: 100, min_stock: 0, active: true });
    const pidW = prodW.data.id ?? prodW.data.product?.id;
    assert(pidW, 'pidW: ' + JSON.stringify(prodW.data));
    const saleW = await sellerApi.req('POST', '/api/sales', {
      items: [{ product_id: pidW, quantity: 1, unit_price: 250, cost: 150 }],
      payment: { method: 'cash', amount_cash: 250, amount_transfer: 0 },
      location_id: null, customer_id: null, pos_id: null, notes: 'QA web sale',
    });
    assert(saleW.status === 201, 'venta web: ' + JSON.stringify(saleW.data));
    const [[{ wd }]] = await conn.execute("SELECT DATE_FORMAT(date, '%Y-%m-%d %H:%i:%s') AS wd FROM sales WHERE id = ?", [saleW.data.id]);
    const webDate = wd;

    // Venta vía MÓVIL (/api/mobile/sales) — la que usa la app Flutter
    const prodNameM = 'QA Prod Movil ' + Date.now();
    const prodM = await client.req('POST', '/api/products', { name: prodNameM, sale_price: 250, cost: 150, stock: 100, min_stock: 0, active: true });
    const pidM = prodM.data.id ?? prodM.data.product?.id;
    assert(pidM, 'pidM: ' + JSON.stringify(prodM.data));
    const saleM = await sellerApi.req('POST', '/api/mobile/sales', {
      items: [{ product_id: pidM, quantity: 1, unit_price: 250, cost: 150 }],
      payment: { method: 'cash', amount_cash: 250, amount_transfer: 0 },
      location_id: null, customer_id: null, pos_id: null, notes: 'QA mobile sale',
    });
    assert(saleM.status === 201, 'venta móvil: ' + JSON.stringify(saleM.data));
    const [[{ md }]] = await conn.execute("SELECT DATE_FORMAT(date, '%Y-%m-%d %H:%i:%s') AS md FROM sales WHERE id = ?", [saleM.data.id]);
    const mobileDate = md;

    console.log(`Venta WEB  → sales.date guardado = ${webDate}`);
    console.log(`Venta MÓVIL → sales.date guardado = ${mobileDate}`);

    // Criterio: la fecha debe guardarse en HORA LOCAL DEL NEGOCIO
    // (tolerancia de ±3s entre el cálculo de `nowLocal` y el INSERT)
    const near = (a, b, tolS = 3) => {
      const t = (s) => new Date(s.replace(' ', 'T') + 'Z').getTime();
      return Math.abs(t(a) - t(b)) <= tolS * 1000;
    };
    check('Venta WEB guarda fecha en hora local del negocio',
      near(webDate, nowLocal), `guardado=${webDate}, local=${nowLocal}`);
    check('Venta MÓVIL guarda fecha en hora local del negocio',
      near(mobileDate, nowLocal),
      `guardado=${mobileDate}, local=${nowLocal} → coincide con UTC (${nowUtc}); se ve ${Math.round((t(mobileDate) - t(nowLocal)) / 60000)} min adelantada`);
    function t(s) { return new Date(s.replace(' ', 'T') + 'Z').getTime(); }

    const localDay = nowLocal.slice(0, 10);
    const utcDay = nowUtc.slice(0, 10);
    check('Fecha del día coinciden local/UTC (si no, la venta móvil se pierde del filtro "hoy")',
      localDay === utcDay, `local hoy=${localDay}, UTC hoy=${utcDay}`);
    check('La venta MÓVIL queda DENTRO del filtro "ventas de hoy" (s.date entre hoy local)',
      mobileDate.slice(0, 10) === localDay,
      `venta móvil guardada el día ${mobileDate.slice(0, 10)} vs "hoy" local ${localDay} — quedará FUERA del historial del vendedor`);

    // Filtro real del vendedor: GET /api/sales?user_id=…&from=hoy&to=hoy
    const todaySales = await sellerApi.req('GET', `/api/sales?user_id=${snap.users.sellerId}&from=${localDay}&to=${localDay}&limit=200`);
    const ids = (todaySales.data ?? []).map(s => String(s.id));
    check('El vendedor VE la venta WEB en su historial de hoy', ids.includes(String(saleW.data.id)),
      `ids=${ids.length}`);
    check('El vendedor VE la venta MÓVIL en su historial de hoy', ids.includes(String(saleM.data.id)),
      `la venta móvil ${saleM.data.id} ${ids.includes(String(saleM.data.id)) ? 'sí' : 'NO'} aparece en "ventas de hoy"`);

    // ── Caso límite (corregido): con el fix, una venta móvil de las 22:00
    // local se guarda como hora local (2026-08-15 22:00:00) y SÍ debe
    // aparecer en el filtro "ventas de hoy" del vendedor. Reescribimos la
    // fecha como la guardaría la API corregida y verificamos el filtro.
    const simLocal = `${localDay} 22:00:00`;
    await conn.execute('UPDATE sales SET date = ? WHERE id = ?', [simLocal, saleM.data.id]);
    const boundarySales = await sellerApi.req('GET', `/api/sales?user_id=${snap.users.sellerId}&from=${localDay}&to=${localDay}&limit=200`);
    const bIds = (boundarySales.data ?? []).map(s => String(s.id));
    check('Venta móvil de las 22:00 local aparece en "ventas de hoy" del vendedor',
      bIds.includes(String(saleM.data.id)),
      `guardada como ${simLocal} (hora local); ${bIds.includes(String(saleM.data.id)) ? 'sí aparece' : 'NO aparece en ' + localDay} — antes del fix se guardaba 02:00 UTC del día siguiente y se perdía`);
    await conn.execute('UPDATE sales SET date = ? WHERE id = ?', [mobileDate, saleM.data.id]);
    const restored = await conn.execute("SELECT DATE_FORMAT(date, '%Y-%m-%d %H:%i:%s') AS md FROM sales WHERE id = ?", [saleM.data.id]);
    console.log('       (fecha de venta móvil restaurada a', restored[0][0].md + ')');
  }

  await conn.end();
  console.log(`\n════════ RESUMEN API ════════`);
  console.log(`PASS: ${pass}  FAIL: ${fail}`);
  console.log(JSON.stringify(results, null, 2));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(2); });
