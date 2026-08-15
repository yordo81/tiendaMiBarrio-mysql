# QA — Puntos 5, 6 y 7

Fecha: 2026-08-15 · Rama: `main` (@0ccaec5) · Zona horaria del negocio: `America/Havana` (UTC-4)

## Entorno

- **Código probado:** fuente actual (`main` @0ccaec5), servidor dev Next.js 16 (Turbopack) en `http://localhost:3011`, BD MySQL local `tienda_mi_barrio`.
- ⚠️ El contenedor Docker desplegado en el puerto 80 (`yordo81/tienda_mb_app:latest`, imagen construida el 2026-08-14 15:48Z) **no incluye los últimos 3 commits** del código fuente (historial del vendedor, RBAC en API, validación de entrada). Las pruebas se hicieron sobre el código actual; el contenedor debe reconstruirse tras corregir los bugs.
- Datos de prueba temporales (usuarios, productos, almacenes, ventas QA) creados y **eliminados al final**; la BD quedó restaurada a su estado original.

## Cómo reproducir

```bash
# 1. Levantar el dev server (puerto distinto al 3000 ocupado por Docker):
npx next dev -p 3011

# 2. Preparar usuarios QA + snapshot:
node scripts/qa/setup-qa.js

# 3. Pruebas API (puntos 5 y 7):
node scripts/qa/test-api.js        # exit 1 si hay bugs (esperado: 4 FAILs)

# 4. Pruebas de navegador con Chrome (punto 6):
node scripts/qa/test-browser.js    # exit 0 (12/12 PASS)

# 5. Limpiar y restaurar la BD:
node scripts/qa/cleanup-qa.js
# (si algo falla a medias y el snapshot quedó desincronizado:)
node scripts/qa/manual-cleanup.js
```

---

## Punto 7 — Bug de entrada de stock → ❌ FALLA (2 bugs)

`POST /api/location-movements` con `type='entrada'`, producto con stock global 5, entrada de 10 en un almacén:

| Verificación | Esperado | Real | Resultado |
|---|---|---|---|
| `location_stock` del almacén | 10 | 10 | ✅ |
| `products.stock` global | 15 (5+10) | **0** (resta 10) | ❌ |
| `stock_movements.type` | `in` | **`out`** ("Carga a almacén") | ❌ |
| `location_movements.type` | `entrada` | `entrada` | ✅ |
| Control: salida de 2 | almacén 10→8 | 8 | ✅ |
| Control: ajuste a 25 | almacén 25 | 25 | ✅ |
| Validación: salida > stock | rechazada | 400 | ✅ |

**Causa raíz** — `src/app/api/location-movements/route.ts` (rama `entrada`):

```js
// location_stock sí suma (correcto)
newQty = curQty + quantity;
// …pero al sincronizar el stock global copia el UPDATE del branch 'salida':
await conn.execute('UPDATE products SET stock=GREATEST(0,stock-?),updated_at=? WHERE id=?', [quantity, ts, product_id]);
// y registra el movimiento global como tipo 'out' (razón "Carga a almacén")
```

**Impacto:** registrar una entrada en Almacenes **disminuye** el stock total del producto (con `GREATEST(0,…)`, 5−10 deja el producto en 0). El historial de Movimientos muestra la entrada como una salida. Corrompe el inventario.

**Fix:** en la rama `entrada`, `UPDATE products SET stock=stock+?` y registrar el movimiento global como tipo `in`.

---

## Punto 5 — Zona horaria móvil → ❌ FALLA (bug confirmado)

Venta registrada a las 11:09 local (15:09 UTC):

| Venta | `sales.date` guardado | ¿Hora local? |
|---|---|---|
| Web — `/api/sales` (POS táctil) | `2026-08-15 11:09:03` | ✅ |
| Móvil — `/api/mobile/sales` (app Flutter) | `2026-08-15 15:09:03` | ❌ UTC (4 h adelantada) |

**Caso límite (simulado):** una venta móvil de las **22:00 local** se guarda como `2026-08-16 02:00` (UTC del día siguiente) → **desaparece del filtro "ventas de hoy" del vendedor** (`GET /api/sales?user_id=…&from=hoy&to=hoy`).

**Causa raíz** — `src/app/api/mobile/sales/route.ts`:

```js
const saleDate = ts; // timestamp UTC
```

mientras `/api/sales` calcula la fecha con `Intl.DateTimeFormat(…, { timeZone: TIMEZONE })` en hora local del negocio. `stock_movements.date` y `payments.date` de ventas móviles también van en UTC.

**Impactos:**
1. La venta móvil se muestra con la hora adelantada (y con fecha del día siguiente a partir de las 20:00 local).
2. El vendedor **no ve en su historial** las ventas móviles hechas de noche.
3. En modo turnos, el arqueo (`src/lib/shift-summary.ts` filtra `s.date BETWEEN opened_at_local AND nowLocal`) excluye las ventas móviles nocturnas → descuadre del corte de caja.

**Fix:** en `/api/mobile/sales` calcular `saleDate` con el mismo formato en `TIMEZONE` y usarlo para `sales.date`, `payments.date` y `stock_movements.date`.

---

## Punto 6 — POS redirect → ✅ PASA (12/12)

| TC | Caso | Resultado |
|---|---|---|
| 01 | Vendedor tras login → `/dashboard/ventas/touch` (POS táctil renderizado) | ✅ |
| 02 | Dueño tras login → `/dashboard` | ✅ |
| 03 | Dueño/admin visita `/dashboard/ventas/touch` → redirigido a `/dashboard/ventas` | ✅ |
| 04 | Vendedor en `/dashboard/ventas`: botón "Nueva venta" → POS táctil | ✅ |
| 05 | Sidebar del vendedor: enlace Ventas → `/dashboard/ventas/touch` | ✅ |
| 06 | MobileNav (viewport 390px): enlace Ventas → `/dashboard/ventas/touch` | ✅ |
| 07 | Sin sesión: `/dashboard/ventas/touch` → `/auth/login` | ✅ |
| 08 | POS desactivado (`enable_touch_pos=false`): vendedor a `/dashboard/ventas` + aviso "POS táctil desactivado" con enlace "Ir a Ventas" | ✅ |
| 09 | Sin bucles de redirección ventas ↔ touch | ✅ |

**Observación menor (hallada durante la prueba, no bloquea el punto):** en vista móvil, la barra inferior del **vendedor** muestra módulos que no le corresponden por rol — *Inventario, Movimientos, Compras, Almacenes, Caja, Reportes, Auditoría* — porque `MobileNav.tsx` solo filtra los ítems con campo `roles` (solo "Inicio" y "Config."), mientras el Sidebar sí aplica la matriz de roles. La API los protege (403 verificado para `/api/reports`, `/api/location-movements`), así que no hay fuga de datos, pero es inconsistente con la matriz de roles del README. Sugerencia: replicar en `MobileNav` el mismo filtro por rol del Sidebar.

---

## Resumen

| Punto | Resultado | Severidad |
|---|---|---|
| **5. Zona horaria móvil** | ❌ FALLA | Alta |
| **6. POS redirect** | ✅ PASA | — |
| **7. Bug de entrada de stock** | ❌ FALLA | Alta |

Totales: API **11 PASS / 4 FAIL** · Navegador **12 PASS / 0 FAIL**.
