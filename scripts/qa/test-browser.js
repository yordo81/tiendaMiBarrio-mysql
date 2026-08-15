// ── QA: pruebas de navegador — Punto 6 (POS redirect) ────────────────
// Uso: node scripts/qa/test-browser.js  (requiere dev server en :3011 y setup-qa.js)
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.QA_BASE ?? 'http://localhost:3011';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const snap = JSON.parse(fs.readFileSync(path.join(__dirname, 'snapshot.json'), 'utf8'));
const OWNER = { email: 'qa.owner@test.local', pass: 'QaTest123!' };
const SELLER = { email: 'qa.seller@test.local', pass: 'QaTest123!' };

let pass = 0, fail = 0;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? '\n       → ' + detail : ''}`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Cada prueba usa un contexto incógnito aislado (cookies independientes)
async function newPage(browser) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  return { ctx, page };
}

// Espera a que la URL llegue a la ruta esperada (los redirects del cliente
// se disparan al cargar settings/auth, así que hay que esperarlos).
async function waitForPath(page, fragment, timeout = 20000) {
  try {
    await page.waitForFunction((f) => window.location.pathname.includes(f), { timeout }, fragment);
  } catch { /* timeout: se devuelve la URL actual igualmente */ }
  await sleep(1500);
  return page.url();
}

async function login(page, { email, pass }, expectPath = null) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('input[type=email]', { timeout: 30000 });
  await page.type('input[type=email]', email);
  await page.type('input[type=password]', pass);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }).catch(() => {}),
    page.click('button[type=submit]'),
  ]);
  await sleep(1500);
  if (expectPath) return waitForPath(page, expectPath);
  return page.url();
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,900'] });

  console.log('═══ PUNTO 6: POS REDIRECT ═══════════════════════════════════\n');

  // TC-01: El vendedor tras iniciar sesión cae directo en el POS táctil
  {
    const { ctx, page } = await newPage(browser);
    const url = await login(page, SELLER, '/dashboard/ventas');
    check('TC-01 Vendedor aterriza en /dashboard/ventas/touch tras login',
      url.startsWith(`${BASE}/dashboard/ventas/touch`), `URL final: ${url}`);
    const hasSearch = await page.$('#pos-search');
    check('TC-01b Se renderiza el POS táctil (campo de escaneo visible)', !!hasSearch, '');
    await ctx.close();
  }

  // TC-02: El dueño/admin tras login cae en /dashboard (no en el POS)
  {
    const { ctx, page } = await newPage(browser);
    const url = await login(page, OWNER, '/dashboard');
    check('TC-02 Dueño aterriza en /dashboard tras login', url.startsWith(`${BASE}/dashboard`),
      `URL final: ${url}`);
    await ctx.close();
  }

  // TC-03: Dueño/admin que visita /dashboard/ventas/touch es redirigido a /dashboard/ventas
  {
    const { ctx, page } = await newPage(browser);
    await login(page, OWNER);
    await page.goto(`${BASE}/dashboard/ventas/touch`, { waitUntil: 'networkidle0', timeout: 60000 });
    await sleep(3000);
    const url = page.url();
    check('TC-03 Dueño accede al POS táctil → redirigido a /dashboard/ventas',
      url.startsWith(`${BASE}/dashboard/ventas`) && !url.includes('/touch'),
      `URL final: ${url}`);
    await ctx.close();
  }

  // TC-04: Vendedor en /dashboard/ventas → botón "Nueva venta" → POS táctil
  {
    const { ctx, page } = await newPage(browser);
    await login(page, SELLER);
    await page.goto(`${BASE}/dashboard/ventas`, { waitUntil: 'networkidle0', timeout: 60000 });
    await sleep(2000);
    // El historial del vendedor (página modal) debe cargar; buscar el botón Nueva venta
    const hasBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => b.textContent.includes('Nueva venta'));
    });
    check('TC-04a Vendedor puede abrir /dashboard/ventas (historial) sin bucle', hasBtn,
      `botón Nueva venta presente: ${hasBtn}`);
    if (hasBtn) {
      await Promise.all([
        page.waitForFunction(() => location.pathname.includes('/touch'), { timeout: 20000 }).catch(() => {}),
        page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          btns.find(b => b.textContent.includes('Nueva venta'))?.click();
        }),
      ]);
      await sleep(2500);
      const url = page.url();
      check('TC-04b "Nueva venta" del vendedor redirige al POS táctil',
        url.includes('/dashboard/ventas/touch'), `URL final: ${url}`);
    }
    await ctx.close();
  }

  // TC-05: Sidebar del vendedor → enlace Ventas apunta al POS táctil
  // (Se inspecciona desde /dashboard/ventas: en el POS táctil el sidebar se oculta)
  {
    const { ctx, page } = await newPage(browser);
    await login(page, SELLER);
    await page.goto(`${BASE}/dashboard/ventas`, { waitUntil: 'networkidle0', timeout: 60000 });
    await sleep(2000);
    const links = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a[href]'));
      return a.map(x => x.getAttribute('href')).filter(h => h && h.includes('/dashboard/ventas'));
    });
    check('TC-05 Enlaces "Ventas" del vendedor apuntan al POS táctil',
      links.length > 0 && links.every(h => h.includes('/touch')),
      `hrefs: ${JSON.stringify(links)}`);
    await ctx.close();
  }

  // TC-06: Vista móvil — MobileNav del vendedor: enlace Ventas → POS táctil
  {
    const { ctx, page } = await newPage(browser);
    await page.setViewport({ width: 390, height: 844 });
    await login(page, SELLER);
    await page.goto(`${BASE}/dashboard/ventas`, { waitUntil: 'networkidle0', timeout: 60000 });
    await sleep(2000);
    const links = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a[href]'));
      return a.map(x => x.getAttribute('href')).filter(h => h && h.includes('/dashboard/ventas'));
    });
    check('TC-06 MobileNav: enlace Ventas del vendedor → POS táctil',
      links.some(h => h.includes('/touch')),
      `hrefs móviles: ${JSON.stringify(links)}`);
    // Información: ¿qué módulos ve el vendedor en la barra móvil? (RBAC)
    const labels = await page.evaluate(() => {
      const nav = document.querySelector('nav.md\\:hidden');
      if (!nav) return null;
      return Array.from(nav.querySelectorAll('a')).map(a => a.textContent.trim());
    });
    console.log('       (módulos visibles en MobileNav del vendedor:', JSON.stringify(labels), ')');
    await ctx.close();
  }

  // TC-07: Usuario NO autenticado visita /dashboard/ventas/touch → termina en login
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(`${BASE}/dashboard/ventas/touch`, { waitUntil: 'networkidle0', timeout: 60000 });
    await sleep(3500);
    const url = page.url();
    check('TC-07 Sin sesión: /dashboard/ventas/touch termina en /auth/login',
      url.includes('/auth/login'), `URL final: ${url}`);
    await ctx.close();
  }

  // TC-08: Vendedor con POS táctil DESACTIVADO (enable_touch_pos=false)
  // Se desactiva vía API como dueño y se restaura al final.
  {
    // Login owner vía API + payload completo de settings (PUT exige todos los campos)
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: OWNER.email, password: OWNER.pass }),
    });
    const cookie = loginRes.headers.get('set-cookie').split(';')[0];
    const getSettings = async () => {
      const r = await fetch(`${BASE}/api/settings`, { headers: { Cookie: cookie } });
      return (await r.json()).settings;
    };
    const putSettings = async (patch) => {
      const s = await getSettings();
      await fetch(`${BASE}/api/settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          business_name: s.business_name, logo_url: s.logo_url, work_mode: s.work_mode,
          receipt_printer_width: s.receipt_printer_width, receipt_print_method: s.receipt_print_method,
          receipt_auto_print: s.receipt_auto_print, show_reservations: s.show_reservations,
          ...patch,
        }),
      });
    };
    const original = await getSettings();
    await putSettings({ enable_touch_pos: false });
    await sleep(800);

    const { ctx, page } = await newPage(browser);
    const url = await login(page, SELLER, '/dashboard/ventas');
    check('TC-08a POS desactivado: vendedor aterriza en /dashboard/ventas (no touch)',
      url.startsWith(`${BASE}/dashboard/ventas`) && !url.includes('/touch'), `URL final: ${url}`);

    // Visitar el POS táctil a mano → pantalla "desactivado" con enlace a Ventas
    await page.goto(`${BASE}/dashboard/ventas/touch`, { waitUntil: 'networkidle0', timeout: 60000 });
    await sleep(3000);
    const disabledText = await page.evaluate(() => document.body.innerText.includes('POS táctil desactivado'));
    const ventasLink = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a'));
      return a.some(x => x.textContent.includes('Ir a Ventas'));
    });
    check('TC-08b POS desactivado: muestra aviso y enlace "Ir a Ventas"',
      disabledText && ventasLink, `aviso=${disabledText}, enlace=${ventasLink}`);

    // Restaurar el POS táctil al valor original
    await putSettings({ enable_touch_pos: original.enable_touch_pos });
    await ctx.close();
  }

  // TC-09: Bucle de redirección — vendedor no debe quedar atrapado
  {
    const { ctx, page } = await newPage(browser);
    await login(page, SELLER);
    // Navegar a varias rutas de ventas y volver al POS
    for (const r of ['/dashboard/ventas', '/dashboard/ventas/touch']) {
      await page.goto(`${BASE}${r}`, { waitUntil: 'networkidle0', timeout: 60000 });
      await sleep(2500);
    }
    const finalUrl = page.url();
    check('TC-09 Sin bucles de redirección (ventas ↔ touch)',
      finalUrl.includes('/dashboard/ventas'), `URL final: ${finalUrl}`);
    await ctx.close();
  }

  await browser.close();
  console.log(`\n════════ RESUMEN BROWSER ════════`);
  console.log(`PASS: ${pass}  FAIL: ${fail}`);
  console.log(JSON.stringify(results, null, 2));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(2); });
