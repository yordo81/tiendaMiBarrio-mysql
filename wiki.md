# Manual de usuario — TiendaMiBarrio (MySQL Edition)

Sistema de gestión para tiendas de barrio: punto de venta, inventario multi-almacén,
compras, clientes con crédito, gastos, contabilidad, turnos de caja, reportes y
auditoría. Funciona en el navegador (escritorio, tableta y móvil) y soporta
**múltiples monedas** con tasas de referencia en dólares.

> Guía de instalación y despliegue: ver [`INSTALL.md`](INSTALL.md).

---

## Índice

1. [Acceso y roles](#1-acceso-y-roles)
2. [Navegación general](#2-navegación-general)
3. [Panel de control (Dashboard)](#3-panel-de-control-dashboard)
4. [Punto de venta (POS)](#4-punto-de-venta-pos)
5. [Cobro parcial multi-moneda](#5-cobro-parcial-multi-moneda)
6. [Redondeo a 0.05](#6-redondeo-a-005)
7. [Tickets e impresión](#7-tickets-e-impresión)
8. [Historial de ventas](#8-historial-de-ventas)
9. [Reservaciones](#9-reservaciones)
10. [Clientes y abonos](#10-clientes-y-abonos)
11. [Inventario y productos](#11-inventario-y-productos)
12. [Compras](#12-compras)
13. [Movimientos de stock](#13-movimientos-de-stock)
14. [Almacenes y cajas](#14-almacenes-y-cajas)
15. [Proveedores](#15-proveedores)
16. [Gastos](#16-gastos)
17. [Contabilidad](#17-contabilidad)
18. [Turnos y arqueo de caja](#18-turnos-y-arqueo-de-caja)
19. [Reportes](#19-reportes)
20. [Auditoría](#20-auditoría)
21. [Notificaciones](#21-notificaciones)
22. [Usuarios y permisos](#22-usuarios-y-permisos)
23. [Configuración](#23-configuración)
24. [Monedas y tasas de cambio](#24-monedas-y-tasas-de-cambio)
25. [Preguntas frecuentes](#25-preguntas-frecuentes)
26. [Glosario](#26-glosario)

---

## 1. Acceso y roles

### Iniciar sesión
1. Abre la dirección del sistema en el navegador (por defecto `http://localhost:3001`
   en desarrollo; en Docker suele ser el puerto `80`).
2. Introduce tu **correo** y **contraseña** y pulsa **Entrar**.
3. Si la sesión caduca verás un aviso *«Sesión expirada»* y volverás al login.

El primer usuario (Dueño) se crea durante la instalación (ver `INSTALL.md`).

### Roles del sistema

| Rol | Nombre | Alcance |
|-----|--------|---------|
| `owner` | **Dueño** | Acceso total, incluida **Configuración**. |
| `admin` | **Administrador** | Todo excepto Configuración. Puede vender a crédito. |
| `seller` | **Vendedor** | Punto de venta, reservaciones y clientes. |
| `warehouse` | **Bodeguero** | Inventario, compras, movimientos, almacenes y proveedores. |

Además de los roles, cada usuario puede tener **permisos granulares** por módulo y
acción (ver [Usuarios](#22-usuarios-y-permisos)).

> **Nota:** el rol *Vendedor* no ve el Dashboard: al iniciar sesión entra directamente
> al **Punto de venta táctil** (si está activado) o a la página de Ventas.

---

## 2. Navegación general

El menú lateral (escritorio) y la barra inferior (móvil) se organizan en grupos
desplegables; solo se muestran las secciones permitidas para tu rol:

- **Ventas y clientes:** Ventas · Reservaciones · Clientes
- **Inventario:** Inventario · Compras · Movimientos · Almacenes · Proveedores
- **Finanzas:** Gastos · Contabilidad · Turnos *(solo en modo por turnos)*
- **Administración:** Reportes · Auditoría · Notificaciones · Usuarios · Configuración

Arriba aparecen: el **estado de conexión** (En línea / Sin conexión), el **nombre y
logo del negocio** y, en modo por turnos, un indicador del turno abierto.

Los módulos **Reservaciones** y **Contabilidad** se pueden ocultar desde
Configuración; el grupo correspondiente desaparece del menú.

---

## 3. Panel de control (Dashboard)

Pantalla inicial de Dueño, Administrador y Bodeguero. Muestra:

- **Fecha y hora** del sistema según la zona horaria configurada.
- Filtro de período: **Hoy · Esta semana · Este mes**.
- Tarjetas: **Ventas**, **Ganancia neta** y **Gastos** del período.
- **Por cobrar** (deuda total de clientes) y **Stock bajo** (productos bajo mínimo).
- Gráfico de **Ventas (últimos 30 días)** y **Top de productos** más vendidos.
- **Reservaciones pendientes** (si el módulo está activo).
- Accesos rápidos: **Nueva venta**, **Registrar compra**, **Ver productos**, **Ver clientes**.

Avisos:

- **Modo por turnos activo sin turno abierto** → aparece un aviso amarillo con acceso
  directo a **Abrir turno**. Hasta que no haya un turno abierto no se pueden registrar ventas.

---

## 4. Punto de venta (POS)

Existen dos modos de venta:

- **POS táctil** (`Ventas → Punto de venta táctil` o `/dashboard/ventas/touch`):
  pensado para pantallas táctiles/tabletas. Es el que usa el vendedor por defecto.
- **Ventas con modal** (`/dashboard/ventas`, botón **Nueva venta**): facturación
  rápida en escritorio.

### 4.1 Registrar una venta (POS táctil)

1. **Elige la moneda de venta** (arriba). Si eliges una moneda distinta de la base,
   los precios se convierten automáticamente y verás la tasa aplicada. Si la tasa
   lleva mucho sin actualizarse aparece un aviso *«Tasa sin actualizar»*.
2. **Toca los productos** para agregarlos al carrito; ajusta cantidades con **+/−**.
   Puedes **buscar** por nombre y filtrar por categoría.
3. Pulsa **Cobrar** para abrir el modal de cobro (3 pasos):
   - **Paso 1 — Método de pago:** Efectivo, Transferencia, Mixto o Crédito
     (Crédito solo para Dueño/Administrador).
   - **Paso 2 — Datos del cobro:** según el método, efectivo recibido y **cambio**,
     monto por transferencia, teléfono del cliente, moneda y **Cobro parcial**.
   - **Paso 3 — Resumen:** revisa el detalle, la fecha (el Dueño/Administrador puede
     cambiarla) y pulsa **Confirmar venta**.
4. Al confirmar se abre la pantalla de éxito con **Imprimir ticket** y **Nueva venta**.

> El **Total a cobrar** se muestra a partir del paso 2, para dejar el paso 1 limpio
> y centrado en elegir el método de pago.

### 4.2 Métodos de pago

| Método | Descripción |
|--------|-------------|
| **Efectivo** | Se ingresa el efectivo recibido y el sistema calcula el **cambio**. |
| **Transferencia** | Pago bancario. Se puede anotar el teléfono del cliente. |
| **Mixto** | Parte en efectivo y parte por transferencia en una sola venta. |
| **Crédito** | La venta queda **pendiente** y suma deuda al cliente. Solo Dueño/Admin. |

- El **teléfono del cliente es opcional** en las transferencias, pero si se escribe
  debe tener un formato válido.
- La venta a **crédito exige seleccionar un cliente**.

### 4.3 Venta con modal (escritorio)

Muy similar al POS, con soporte de **pago dividido** (`payParts`) entre varias
monedas y métodos. Útil para facturación rápida desde el listado de Ventas.

---

## 5. Cobro parcial multi-moneda

Permite **repartir el total entre varias monedas** y emite **un comprobante por
moneda**, marcado como **COBRO PARCIAL**.

**Disponible cuando** hay más de una moneda activa y el método **no es Crédito**.

1. En el **paso 2** del cobro, activa **«Cobro parcial (varias monedas y
   comprobantes)»**.
2. Se crean dos partes por defecto. Para cada **Parte**:
   - **Moneda** (deja vacío para la moneda base).
   - **Método**: Efectivo o Transferencia (independiente en cada parte).
   - **Monto**: pulsa **Resto** para cubrir automáticamente lo que falta en esa moneda
     (siempre redondeado al múltiplo de 0.05).
3. Pulsa **+ Agregar otra moneda** para añadir más partes (hasta el número de monedas
   activas, máximo 6).
4. El sistema valida en tiempo real:
   - ✅ **«Cubre el total»** → puedes avanzar y confirmar.
   - ⚠️ **«Falta cubrir …»** → no se puede avanzar hasta completar el total.
5. Al confirmar se crea **una fila de pago por cada parte** (con su moneda y su tasa
   congelada) y se generan **un ticket completo por moneda**. Todos los tickets
   incluyen la lista de productos, cantidades, el TOTAL y el **desglose completo de
   todos los pagos**, con una línea *«Corresponde a: <monto>»* que identifica la parte
   de ese comprobante.

> Si eliges **Crédito**, el cobro parcial se desactiva y la venta se registra en la
> moneda base.

---

## 6. Redondeo a 0.05

No existen monedas de 1 centavo. **Todos los precios convertidos se redondean hacia
arriba** al múltiplo de **0.05** más cercano (`roundToNickel`, paso 0.05).

- El redondeo se aplica **siempre** que haya conversión de moneda: en el POS, en el
  modal de ventas y al registrar la venta en el servidor.
- Es **acumulativo y hacia arriba**: nunca se redondea a la baja.
- Ejemplos: `10.01 → 10.05`, `10.05 → 10.05`, `10.06 → 10.10`, `10.00 → 10.00`.
- El **«Resto»** del cobro parcial también respeta este redondeo.

---

## 7. Tickets e impresión

El comprobante del cliente se configura en **Configuración → Impresión**:

- **Ancho del papel:** `57 mm` (angosto) o `80 mm` (estándar).
- **Método de impresión:**
  - **Navegador:** abre el diálogo de impresión del navegador.
  - **USB (WebUSB):** impresión directa a impresora térmica ESC/POS compatible.
- **Autoimprimir:** imprime el ticket automáticamente al confirmar la venta.

Contenido del ticket: datos del negocio (nombre y logo), número de venta, fecha,
detalle de productos y cantidades, total, desglose de pagos por moneda y, cuando
aplica, la etiqueta **COBRO PARCIAL**.

---

## 8. Historial de ventas

`Ventas` lista todas las ventas con filtros por fecha y búsqueda. Desde el detalle
puedes:

- Ver el **desglose de pagos** (método `·` moneda y monto).
- **Reimprimir** el ticket del cliente.
- Consultar el estado (completada / pendiente por crédito).

---

## 9. Reservaciones

Pedidos anticipados de clientes (catálogo público en la página de entrada).
- Crear una reservación con cliente, producto y cantidad.
- Estados: **pendiente**, **entregada** (se convierte en venta) y **cancelada**.
- Las reservaciones pendientes aparecen en el Dashboard.

> Módulo ocultable desde **Configuración → Operación → Módulos del sistema**.

---

## 10. Clientes y abonos

- **Alta de clientes** con nombre, teléfono y notas.
- Ver el **saldo** de cada cliente (deuda pendiente).
- **Registrar abono:** monto + método (Efectivo, Transferencia, Mixto).
  - Se puede **vincular a una venta** concreta o dejar como **abono general**.
  - El abono reduce el saldo y queda en el historial.
- Los abonos afectan el **efectivo esperado del turno** y el **libro de caja**.

---

## 11. Inventario y productos

- Listado con **stock global** y **por almacén**, búsqueda, filtros y ordenamiento.
- **Crear/editar productos:** nombre, descripción, categoría, costo, precio de venta,
  unidad, stock mínimo y moneda de venta.
- **Alertas de stock bajo** (productos bajo el mínimo).
- **Historial de movimientos** por producto.
- **Exportar a CSV/Excel** (con opciones de ordenamiento por categoría o proveedor).
- **Eliminar producto:** el sistema borra primero sus **movimientos de almacén**
  para evitar errores de clave foránea. ⚠️ Esta acción **elimina el historial de
  movimientos** de ese producto; no se puede deshacer.

---

## 12. Compras

Registro de entradas de mercancía al inventario.
- Selecciona **proveedor**, **almacén** y los productos con **cantidad y costo**.
- Actualiza el stock y (si corresponde) el costo del producto.
- Puedes registrar compras también con el botón **Registrar compra** del Dashboard.
- Constructor de precios de compra disponible por producto.

---

## 13. Movimientos de stock

Registro histórico de entradas, salidas, ajustes y **transferencias entre almacenes**.
Sirve para auditar de dónde viene y a dónde va cada unidad.

---

## 14. Almacenes y cajas

- **Almacenes** con tipo (por ejemplo *Punto de venta*), nombre y dirección.
- **Cajas** asociadas a un almacén tipo *Punto de venta*. Es obligatorio tener al
  menos un almacén de este tipo para crear cajas.
- El POS trabaja contra la caja/almacén seleccionado; las ventas descuentan stock de él.

---

## 15. Proveedores

Directorio de proveedores (nombre, contacto, datos). Se usan al registrar **compras**.

---

## 16. Gastos

Registro de gastos operativos por **categoría**, con monto, fecha y notas.
Los gastos alimentan la **ganancia neta** del Dashboard y el **libro de caja**.
Las categorías de gasto se administran desde este módulo.

---

## 17. Contabilidad

> Módulo ocultable desde **Configuración → Operación → Módulos del sistema**.

**Libro de caja** de efectivo y transferencias:

- **Saldo inicial** (efectivo y transferencia disponibles al empezar).
- **Aportes de capital**.
- Movimientos generados por **ventas**, **abonos de clientes**, **gastos** y
  **compras de inventario**.
- Tarjetas de **saldo** (calculado desde el primer registro) y **evolución
  acumulada día a día** (el valor final coincide con el saldo mostrado).
- **Movimientos recientes** con tipo (entrada/salida).

---

## 18. Turnos y arqueo de caja

> Visible solo cuando el modo de operación es **Por turnos**
> (Configuración → Operación → Jornada de caja).

- **Abrir turno:** selecciona la **caja/punto de venta** e indica el **fondo/efectivo
  de apertura**. Sin turno abierto no se pueden registrar ventas.
- **Cerrar turno (arqueo de caja):**
  1. Cuenta el efectivo y regístralo en **«Efectivo contado en caja»**.
  2. El sistema calcula el **Efectivo esperado** a partir de:
     fondo de apertura + ventas en efectivo + abonos en efectivo − gastos, con las
     conversiones a la moneda base.
  3. Si hay varias monedas activas, verás la ayuda **«Efectivo esperado por moneda»**
     (cuánto se espera de cada moneda además del total en moneda base).
  4. Al cerrar se registra la **diferencia** (contado − esperado) en el historial.
- **Reporte de turno:** desglose de ventas, pagos, **efectivo esperado por moneda** y
  diferencia, con exportación a **PDF**.

> ℹ️ **Sobre el redondeo y el vuelto:** el cambio entregado no se registra como salida.
> Si al cerrar caja ingresas el efectivo físico real (ya sin el vuelto entregado), el
> «esperado» podría verse inflado. Cuenta el efectivo real y usa la diferencia como
> referencia del descuadre.

---

## 19. Reportes

`Reportes` con selector de rango (**7 / 30 / 90 días o personalizado**) y pestañas:

| Pestaña | Contenido |
|---------|-----------|
| **Ventas** | Totales, cantidad, promedio, gastos y utilidad; listado y exportación. |
| **Rentabilidad** | Márgenes: ventas, costo, utilidad bruta, gastos, utilidad neta y margen %. |
| **Transferencias** | Ventas por transferencia. Incluye **columna de moneda** y **filtro por moneda** («Todas las monedas» o una en concreto). |
| **Variación Precios** | Historial de cambios de precio por producto. |
| **Reabastecimiento** | Pronóstico de reposición según consumo. |
| **Vencimientos** | Productos próximos a vencer / vencidos. |
| **Cuentas** | Deudas de clientes y antigüedad de saldos. |

- Filtro por **almacén** donde aplica.
- Exportación a **CSV** y **PDF** (encabezado incluye la moneda cuando se filtra por ella).

---

## 20. Auditoría

Bitácora de acciones del sistema (quién hizo qué y cuándo): creación/edición/eliminación
de registros, cambios de configuración, operaciones sensibles. Útil para rastrear
incidentes y dar trazabilidad.

---

## 21. Notificaciones

Avisos internos: **stock bajo**, **reservaciones pendientes**, **vencimientos** y
novedades del sistema. Accesible para todos los roles.

---

## 22. Usuarios y permisos

Solo para **Dueño** y **Administrador**.

- **Crear usuario:** nombre, correo, contraseña, rol y estado activo.
- **Roles:** Dueño, Administrador, Vendedor, Bodeguero.
- **Permisos granulares:** por cada módulo se pueden conceder acciones específicas
  (ver, crear, editar, eliminar…). El **Dueño** siempre tiene acceso total.
- **Activar/desactivar** usuarios y **cambiar contraseña**.

---

## 23. Configuración

Solo el **Dueño** puede acceder. Pestañas:

### Negocio
- **Nombre del negocio** (aparece en menú, tickets y página pública).
- **Logotipo**.

### Operación — Jornada de caja
- **Modo Diario:** operación sin turnos.
- **Modo Por turnos:** habilita el módulo **Turnos** con apertura/cierre y arqueo.

### Operación — Módulos del sistema
- **Reservaciones:** muestra el catálogo público y el módulo en el menú.
- **Punto de venta táctil:** muestra el POS táctil (para el rol Vendedor).
- **Contabilidad:** muestra el módulo de Contabilidad.

### Impresión
- **Ancho del papel** (57 / 80 mm), **método** (Navegador / USB) y **autoimprimir**
  (ver [Tickets e impresión](#7-tickets-e-impresión)). También se gestionan las
  **impresoras** registradas.

### Monedas
- Ver y administrar monedas y tasas (ver sección siguiente).

---

## 24. Monedas y tasas de cambio

### Conceptos clave
- **Moneda base:** la moneda de operación principal de la tienda. Es configurable.
  En toda la aplicación, una moneda **vacía/NULL** significa *moneda base*.
- **Tasas de referencia en USD:** las tasas se guardan **solo** como filas de
  referencia del **dólar**:

  > `1 USD = X <moneda>`

  Es decir, cada moneda define cuántas unidades equivalen a **1 dólar (USD)**.

### Administrar monedas (Configuración → Monedas)
- **Crear/editar moneda:** **Código ISO** (ej. `USD`, `MLC`, `EUR`, `CUP`),
  **nombre completo** y **símbolo**.
- **Definir la moneda base.**
- **Actualizar la tasa USD** de cada moneda. Mantener las tasas al día evita avisos
  de *«tasa sin actualizar»* en el POS y precios incorrectos.
- Marca una moneda como **referencia (dólar)** cuando corresponda.

### Cómo se usan las tasas
- Al **vender en una moneda distinta a la base**, el sistema convierte usando las
  tasas USD y aplica el **redondeo a 0.05**.
- Al registrar la venta, la **tasa se congela** en cada pago (`usd_rate`), de modo
  que los reportes y el arqueo conservan el valor histórico aunque luego cambie la tasa.
- Los **reportes** convierten importes multi-moneda a la moneda base para totalizar.
- El **arqueo** suma el efectivo esperado por moneda y muestra el total en moneda base.

> **Recomendación:** actualiza las tasas antes de abrir caja cada día.

---

## 25. Preguntas frecuentes

**No puedo registrar ventas y veo «Modo por turnos activo».**
Abre un turno en `Turnos` para la caja correspondiente.

**El precio mostrado en otra moneda no es exacto.**
Es el redondeo obligatorio a múltiplos de 0.05 (no hay centavos de 1). Es hacia arriba
y no se puede desactivar.

**Aparece «Tasa de X sin actualizar».**
La moneda lleva mucho sin actualizar su tasa USD. Pídele al Dueño que la revise en
Configuración → Monedas.

**¿Por qué la venta a crédito no admite cobro parcial?**
El crédito se registra en moneda base; el cobro parcial es solo para efectivo/
transferencia.

**El cierre de caja muestra una diferencia.**
Revisa el efectivo contado (incluye el vuelto entregado) y que las tasas estén al día.
El sistema calcula el esperado con las conversiones a moneda base.

**Quiero ocultar Reservaciones / Contabilidad / POS táctil.**
Configuración → Operación → Módulos del sistema.

**Eliminé un producto y perdí su historial de movimientos.**
Al eliminar un producto se borran sus movimientos de almacén para evitar errores de
integridad. Es irreversible.

---

## 26. Glosario

| Término | Significado |
|---------|-------------|
| **Moneda base** | Moneda principal de operación. Moneda vacía/NULL = base. |
| **Tasa USD** | Cuántas unidades de una moneda equivalen a 1 USD. |
| **Redondeo a 0.05** | Ajuste hacia arriba al múltiplo de 0.05 más cercano. |
| **Cobro parcial** | Pago repartido en varias monedas; un comprobante por moneda. |
| **Arqueo** | Cierre de turno comparando efectivo contado vs. esperado. |
| **Efectivo esperado** | Efectivo que debería haber en caja según los movimientos. |
| **Tasa congelada** | Tasa USD guardada en el pago al momento de la venta. |
| **POS táctil** | Punto de venta optimizado para pantallas táctiles. |
| **Turno** | Jornada de caja con apertura y cierre controlados. |
