# TiendaMiBarrio — MySQL Edition 🛒

Sistema de gestión integral para tienda retail. **Sin Supabase.** Todo corre en tu propio servidor MySQL.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | Next.js 16, React 19, TypeScript |
| Estilos | Tailwind CSS 4 |
| Base de datos | **MySQL 8.0+** |
| Auth | iron-session (cookie cifrada) |
| Estado | Zustand |
| Gráficas | Recharts |
| Exportación | ExcelJS, jsPDF + AutoTable |
| Validación | Zod |
| Iconos | Lucide React |
| Deploy | VPS / Docker / cPanel / Railway / Cloudflare |

---

## Módulos

| Módulo | Descripción |
|--------|-------------|
| **Dashboard** | Métricas del día/semana/mes, ventas vs gastos, top productos, reloj en zona horaria, accesos rápidos, widget de reservaciones pendientes |
| **Inventario** | Productos + categorías (CRUD), alertas de stock mínimo, historial de movimientos, subida de imágenes, relación con proveedores |
| **Compras** 📦 | Histórico de compras a proveedores con filtros por producto, proveedor y rango de fechas. Tarjetas de resumen con costos totales |
| **Almacenes** | Múltiples almacenes/puntos de venta, stock por ubicación, traslados entre ubicaciones |
| **Movimientos** 🔄 | Vista unificada de todos los movimientos de stock (entradas, salidas, ventas, ajustes, gastos) con filtros por tipo, almacén, producto y fecha |
| **Ventas** | POS con pagos mixtos (efectivo, transferencia, crédito), cancelaciones, detalle por venta, filtro de fechas, abonos vinculados |
| **Clientes** | Cuentas por cobrar, historial de abonos vinculados a ventas específicas |
| **Proveedores** | CRUD + historial de precios por producto/proveedor |
| **Gastos** | Consumo interno, gastos operativos con método de pago (efectivo/transferencia), categorías personalizables |
| **Reservaciones** 📋 | Gestión de pedidos de clientes (pendiente/confirmada/cancelada), edición inline de cantidad y notas, estadísticas por estado |
| **Contabilidad** 💰 | Libro de caja completo: saldos en efectivo y transferencia, flujo del día, aportes de capital, ajustes manuales, gráfico de evolución histórica, filtro por periodo (todo/semana/mes/90 días/personalizado) |
| **Reportes** | Ventas, rentabilidad, variación de precios, proyección de reabastecimiento, cuentas por cobrar |
| **Auditoría** 🛡️ | Registro detallado de eliminaciones y ajustes críticos: quién, qué, cuándo y detalles del cambio |
| **Usuarios** | Roles (Dueño, Admin, Vendedor, Bodeguero) + permisos granulares por módulo |

### Navegación por rol

| Rol | Módulos accesibles |
|-----|-------------------|
| **Dueño** | Todos los módulos |
| **Administrador** | Dashboard, Ventas, Reservaciones, Inventario, Compras, Movimientos, Almacenes, Clientes, Proveedores, Gastos, Contabilidad, Reportes, Auditoría |
| **Vendedor** | Dashboard, Ventas, Reservaciones, Clientes |
| **Bodeguero** | Dashboard, Inventario, Compras, Movimientos, Almacenes, Proveedores |

---

## Landing Page Pública 🌐

El proyecto incluye una **página de inicio pública** (`/inicio`) con:
- Hero section con CTA y tarjeta interactiva del dashboard
- Carrusel de características con auto-play, navegación por teclado y táctil
- Grid detallado de todos los módulos del sistema
- Sección de características destacadas
- Footer completo con enlaces
- Indicador de estado de sesión (login vs acceso público)
- Tema oscuro/claro desde la landing page

---

## Instalación paso a paso

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar variables de entorno

```bash
cp .env.local.example .env.local
```

Edita `.env.local`:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu_password
DB_NAME=tienda_mi_barrio
SESSION_SECRET=genera_con_openssl_rand_base64_32
```

Genera un SESSION_SECRET seguro:
```bash
openssl rand -base64 32
```

### 3. Configurar la base de datos

```bash
npm run db:setup
```

El script interactivo te pedirá:
- Credenciales de MySQL
- Nombre y email del usuario dueño
- Contraseña del dueño

O si prefieres hacerlo manualmente:
```bash
mysql -u root -p < mysql/schema.sql
```

Luego crea el usuario dueño manualmente:
```sql
INSERT INTO users (id,name,email,password_hash,role,permissions,active,created_at,updated_at)
VALUES (UUID(), 'Admin', 'admin@tienda.com', '$2a$12$HASH_AQUI', 'owner', '[]', 1, NOW(), NOW());
```

Para generar el hash de la contraseña:
```js
const bcrypt = require('bcryptjs');
console.log(bcrypt.hashSync('tu_contraseña', 12));
```

### Migraciones

Si ya tienes la base de datos creada con una versión anterior del schema, ejecuta las migraciones en orden numérico:

```bash
mysql -u root -p < mysql/migration-002-on-delete-set-null.sql
mysql -u root -p < mysql/migration-003-customer-payments-sale-link.sql
mysql -u root -p < mysql/migration-004-purchases-table.sql
mysql -u root -p < mysql/migration-005-audit-logs.sql
mysql -u root -p < mysql/migration-006-accounting-module.sql
mysql -u root -p < mysql/migration-007-capital-management.sql
mysql -u root -p < mysql/migration-007-reservations.sql
```

| Migración | Descripción |
|-----------|-------------|
| `migration-002-on-delete-set-null.sql` | Agrega `ON DELETE SET NULL` a las FK de `user_id` en tablas `sales`, `expenses`, `stock_movements`, `stock_transfers` y `location_movements`. Previene errores de foreign key al eliminar usuarios. |
| `migration-003-customer-payments-sale-link.sql` | Agrega columna `sale_id` a `customer_payments` para vincular abonos con ventas específicas. |
| `migration-004-purchases-table.sql` | Crea la tabla `purchases` para el histórico de compras a proveedores con producto, cantidad, precio, ubicación y usuario. |
| `migration-005-audit-logs.sql` | Crea la tabla `audit_logs` para registrar auditoría de eliminaciones y acciones críticas con detalles en JSON. |
| `migration-006-accounting-module.sql` | Agrega `payment_method` a `expenses` y crea la tabla `cash_register` para saldo inicial y ajustes de caja. |
| `migration-007-capital-management.sql` | Amplía `cash_register.type` para soportar `purchase` (compra de inventario como reinversión) y `capital` (aporte de capital del dueño). |
| `migration-007-reservations.sql` | Crea la tabla `reservations` para gestionar pedidos de clientes con estados pendiente/confirmado/cancelado. |

> **Nota:** Si usaste `npm run db:setup` en una instalación nueva, las migraciones ya se aplican automáticamente. Solo necesitas ejecutarlas manualmente si actualizas una BD existente.

### 4. Correr en desarrollo

```bash
npm run dev
```

Abre: http://localhost:3000

---

## Deploy en producción

### Opción A: VPS (Ubuntu)

```bash
# Build
npm run build

# Con PM2
npm install -g pm2
pm2 start npm --name tienda -- start
pm2 save && pm2 startup
```

### Opción B: Docker (recomendada)

El proyecto incluye `Dockerfile` y `docker-compose.yml` para levantar la aplicación completa con MySQL incluido.

#### Requisitos

- [Docker](https://docs.docker.com/get-docker/) 24+
- [Docker Compose](https://docs.docker.com/compose/install/) (incluido con Docker Desktop)

#### 1. Configurar variables de entorno

```bash
cp .env.example .env
# Editar .env con tus valores, o dejar los defaults para desarrollo local
```

Variables disponibles:

| Variable | Default | Descripción |
|----------|---------|-------------|
| `DB_PASSWORD` | `rootpassword` | Contraseña del usuario root de MySQL |
| `DB_NAME` | `tienda_mi_barrio` | Nombre de la base de datos |
| `DB_PORT_EXTERNAL` | `3307` | Puerto MySQL hacia el host (evita conflicto con MySQL local) |
| `APP_PORT` | `3000` | Puerto de la aplicación web |
| `SESSION_SECRET` | — | Secreto para cifrar sesiones (mín. 32 caracteres) |

Genera un `SESSION_SECRET` seguro:
```bash
openssl rand -base64 32
```

#### 2. Iniciar todos los servicios

```bash
docker compose up -d
```

Esto levanta dos contenedores:
- **`tienda_mb_db`** — MySQL 8.0 con el schema y datos semilla aplicados automáticamente
- **`tienda_mb_app`** — Next.js en modo producción en `http://localhost:3000`

La primera vez que se ejecuta, Docker:
1. Construye la imagen de la aplicación (puede tomar 1-2 minutos)
2. Inicializa el contenedor MySQL creando la base de datos y ejecutando `mysql/init/01-schema.sql`
3. Espera a que MySQL esté saludable antes de arrancar la app

#### 3. Ver logs

```bash
docker compose logs -f          # Todos los servicios
docker compose logs -f app      # Solo la app
docker compose logs -f db       # Solo la BD
```

#### 4. Crear el primer usuario (dueño)

Una vez que la app esté corriendo, conecta a MySQL y crea el usuario administrador:

```bash
# Conectar a MySQL dentro del contenedor
docker exec -it tienda_mb_db mysql -u root -p"${DB_PASSWORD:-rootpassword}" tienda_mi_barrio
```

```sql
INSERT INTO users (id, name, email, password_hash, role, permissions, active, created_at, updated_at)
VALUES (UUID(), 'Admin', 'admin@tienda.com', '$2a$12$HASH_AQUI', 'owner', '[]', 1, NOW(), NOW());
```

Para generar el hash de la contraseña (necesitas bcryptjs, se instala con `npm install`):
```bash
node -e "const b=require('bcryptjs'); console.log(b.hashSync('tu_contraseña', 12))"
```

#### 5. Comandos útiles

```bash
# Detener servicios (sin borrar datos)
docker compose stop

# Detener y eliminar contenedores (los datos persisten)
docker compose down

# Detener todo y borrar la base de datos (¡cuidado!)
docker compose down -v

# Reconstruir la imagen de la app sin cache
docker compose build --no-cache app

# Acceder a la terminal del contenedor app
docker exec -it tienda_mb_app sh

# Acceder a MySQL
docker exec -it tienda_mb_db mysql -u root -p"${DB_PASSWORD:-rootpassword}" tienda_mi_barrio
```

#### Puertos por defecto

| Servicio | Puerto interno | Puerto host (default) |
|----------|---------------|----------------------|
| App web | `3000` | `3000` (configurable con `APP_PORT`) |
| MySQL | `3306` | `3307` (configurable con `DB_PORT_EXTERNAL`) |

> El puerto de MySQL se mapea al `3307` por defecto para evitar conflictos si ya tienes MySQL corriendo localmente en el puerto `3306`.

### Opción C: Railway / Render

1. Conecta tu repositorio
2. Agrega las variables de entorno en el panel
3. El deploy es automático

---

## Estructura del proyecto

```
src/
├── app/
│   ├── api/                    # Todas las rutas API (MySQL directo)
│   │   ├── auth/               # login, logout, me
│   │   ├── products/           # CRUD + [id]
│   │   ├── categories/         # CRUD
│   │   ├── suppliers/          # CRUD
│   │   ├── purchase-prices/    # Histórico de precios
│   │   ├── customers/          # CRUD
│   │   ├── customer-payments/  # Abonos
│   │   ├── sales/              # POS + [id] + cancel + pay
│   │   ├── expenses/           # CRUD
│   │   ├── expense-categories/ # Categorías de gastos
│   │   ├── users/              # CRUD + [id]
│   │   ├── reports/            # dashboard, margins, restock, debts, price_history
│   │   ├── locations/          # Almacenes + stock + stock-summary
│   │   ├── location-movements/ # Movimientos por ubicación
│   │   ├── stock-movements/    # Movimientos de stock
│   │   ├── stock-transfers/    # Traslados entre almacenes
│   │   ├── purchases/          # 📦 Histórico de compras
│   │   ├── accounting/         # 💰 Contabilidad / libro de caja
│   │   ├── cash-register/      # Caja (saldo inicial, ajustes, capital)
│   │   ├── audit-logs/         # 🛡️ Auditoría de eliminaciones
│   │   ├── reservations/       # 📋 Reservaciones + products
│   │   └── upload/             # Subida de imágenes
│   ├── inicio/                 # 🌐 Landing page pública
│   ├── auth/login/             # Página de inicio de sesión
│   └── dashboard/              # 13 módulos de gestión
│       ├── page.tsx            # Dashboard principal
│       ├── ventas/             # Punto de venta
│       ├── inventario/         # Productos y categorías
│       ├── compras/            # Compras a proveedores
│       ├── almacenes/          # Múltiples ubicaciones
│       ├── movimientos/        # Todos los movimientos de stock
│       ├── clientes/           # Cartera de clientes
│       ├── proveedores/        # Gestión de proveedores
│       ├── gastos/             # Gastos operativos
│       ├── contabilidad/       # Libro de caja
│       ├── reservaciones/      # Pedidos de clientes
│       ├── reportes/           # Reportes y análisis
│       ├── auditoria/          # Registro de cambios
│       └── usuarios/           # Roles y permisos
├── components/
│   ├── layout/                 # Sidebar, Topbar, MobileNav
│   ├── ui/                     # Modal, ConfirmDialog, EmptyState, StatCard,
│   │                           # Pagination, Toaster, ThemeToggle, Tooltip
│   └── providers.tsx           # Providers globales
├── hooks/
│   └── use-online.ts           # Hook de estado de conexión
├── lib/
│   ├── api-client.ts           # fetch wrapper tipado con manejo de 401
│   ├── api-helpers.ts          # Utilidades para APIs
│   ├── auth/session.ts         # iron-session
│   ├── db/
│   │   ├── mysql.ts            # Pool de conexiones MySQL
│   │   └── audit.ts            # Logger de auditoría
│   ├── stores/auth-store.ts    # Zustand store de autenticación
│   ├── export.ts               # Exportación a Excel y PDF
│   ├── utils.ts                # Utilidades generales
│   └── validate.ts             # Validación con Zod
├── styles/
│   └── globals.css             # Estilos globales y variables CSS
└── types/
    └── index.ts                # Tipos de TypeScript compartidos
mysql/
├── schema.sql                  # Schema completo con todas las tablas
├── init/
│   └── 01-schema.sql           # Schema para inicialización Docker
└── migration-*.sql             # Migraciones incrementales
scripts/
├── setup-db.js                 # Script interactivo de configuración inicial
├── analisis-inventario.js      # Análisis de inventario
├── recalcular-stock.js         # Recalcular stock
├── debug-accounting.js         # Depuración de contabilidad
├── test-fk-fix.js              # Prueba de foreign keys
└── ventas-por-producto.js      # Análisis de ventas por producto
```

---

## Roles y permisos

| Rol | Módulos |
|-----|---------|
| **Dueño** | Todos (Dashboard, Ventas, Reservaciones, Inventario, Compras, Movimientos, Almacenes, Clientes, Proveedores, Gastos, Contabilidad, Reportes, Auditoría, Usuarios) |
| **Administrador** | Dashboard, Ventas, Reservaciones, Inventario, Compras, Movimientos, Almacenes, Clientes, Proveedores, Gastos, Contabilidad, Reportes, Auditoría |
| **Vendedor** | Dashboard, Ventas, Reservaciones, Clientes |
| **Bodeguero** | Dashboard, Inventario, Compras, Movimientos, Almacenes, Proveedores |

El dueño puede personalizar permisos por usuario desde el módulo Usuarios.

---

## Características destacadas ✨

### 🔐 Autenticación segura
- Sesiones con cookie cifrada via `iron-session`
- Manejo de sesión expirada con evento `api:unauthorized`
- Detección automática de 401 con notificación al usuario

### 🌙 Tema oscuro/claro
- Toggle de tema en sidebar y landing page
- Persistencia de preferencia
- Variables CSS personalizadas para ambos temas

### 📱 Diseño responsive
- Sidebar desktop + navegación móvil inferior
- Tablas con scroll horizontal en mobile
- Cards adaptables en grid

### 📊 Contabilidad completa
- Libro de caja con efectivo y transferencia por separado
- Saldo inicial, aportes de capital y ajustes manuales
- Gráfico de evolución diaria con tooltips interactivos
- Filtro por periodo: hoy, semana, mes, 90 días, rango personalizado
- Tooltips informativos en cada métrica
- Alertas de gastos sin clasificar y saldo inicial faltante

### 📦 Compras a proveedores
- Histórico completo con producto, proveedor, cantidad, precio
- Filtros por producto, proveedor y rango de fechas
- Tarjetas de resumen con costos totales
- Vinculación con contabilidad como reinversión

### 📋 Reservaciones
- Gestión de pedidos desde la landing page pública
- Estados: pendiente, confirmada, cancelada
- Edición inline de cantidad y notas
- Widget de pendientes en el Dashboard
- Estadísticas rápidas en tarjetas

### 🛡️ Auditoría
- Registro automático de eliminaciones
- Seguimiento de ajustes de stock
- Detalles en JSON de cada operación
- Filtros por tipo de entidad y acción

### 🔄 Movimientos de stock
- Vista unificada de todos los tipos de movimiento
- Filtros por tipo (entrada/salida/venta/ajuste/gasto)
- Filtros por almacén, producto y fechas
- Resumen por tipo de movimiento en cards

### 📍 Múltiples almacenes
- Gestión de ubicaciones/puntos de venta
- Stock por ubicación con resumen consolidado
- Traslados entre almacenes

### 📄 Exportación
- Exportación a Excel (ExcelJS)
- Exportación a PDF (jsPDF + AutoTable)

### ⚡ UX mejorada
- Paginación con selector de tamaño de página (10/25/50/100/Todo)
- Indicador de conexión en tiempo real (online/offline)
- Estados vacíos con iconos y mensajes contextuales
- Confirmaciones antes de acciones destructivas
- Spinners y skeletons durante carga
- Tooltips informativos en todas las métricas
- Filtros con limpieza rápida
- Notificaciones toast con `toaster`

---

## Scripts disponibles

```bash
npm run dev          # Desarrollo (hot reload)
npm run build        # Build producción
npm run start        # Producción
npm run lint         # Linter
npm run type-check   # Verificar tipos TypeScript
npm run db:setup     # Configurar BD + crear primer usuario

# Scripts de utilidad
node scripts/analisis-inventario.js     # Análisis de inventario
node scripts/recalcular-stock.js        # Recalcular stock
node scripts/debug-accounting.js        # Depuración de contabilidad
node scripts/test-fk-fix.js             # Prueba de foreign keys
node scripts/ventas-por-producto.js     # Análisis de ventas
```

---

## Licencia

Open Source. Proyecto personal con fines educativos y de gestión comercial.
