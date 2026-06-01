# TiendaMiBarrio — MySQL Edition 🛒

Sistema de gestión integral para tienda retail. **Sin Supabase.** Todo corre en tu propio servidor MySQL.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | Next.js 14, React 18, TypeScript |
| Estilos | Tailwind CSS |
| Base de datos | **MySQL 8.0+** |
| Auth | iron-session (cookie cifrada) |
| Estado | Zustand |
| Gráficas | Recharts |
| Deploy | VPS / Docker / cPanel / Railway |

---

## Módulos

| Módulo | Descripción |
|--------|-------------|
| **Dashboard** | Métricas del día, ventas vs gastos, top productos |
| **Inventario** | Productos + categorías (CRUD), historial de movimientos, relación con proveedores |
| **Almacenes** | Múltiples almacenes/puntos de venta, traslados entre ubicaciones |
| **Ventas** | POS con pagos mixtos (efectivo, transferencia, crédito), detalle por venta |
| **Clientes** | Cuentas por cobrar, historial de abonos |
| **Proveedores** | CRUD + historial de precios por producto/proveedor |
| **Gastos** | Consumo interno y gastos operativos |
| **Reportes** | Ventas, rentabilidad, variación de precios, proyección de reabastecimiento, cuentas |
| **Usuarios** | Roles (Dueño, Admin, Vendedor, Bodeguero) + permisos granulares |

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
```

| Migración | Descripción |
|-----------|-------------|
| `migration-002-on-delete-set-null.sql` | Agrega `ON DELETE SET NULL` a las FK de `user_id` en tablas `sales`, `expenses`, `stock_movements`, `stock_transfers` y `location_movements`. Previene errores de foreign key al eliminar usuarios. |

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
│   ├── api/              # Todas las rutas API (MySQL directo)
│   │   ├── auth/         # login, logout, me
│   │   ├── products/     # CRUD + [id]
│   │   ├── categories/   # CRUD
│   │   ├── suppliers/    # CRUD
│   │   ├── purchase-prices/
│   │   ├── customers/    # CRUD
│   │   ├── customer-payments/
│   │   ├── sales/        # POS + [id] detalle
│   │   ├── expenses/
│   │   ├── expense-categories/
│   │   ├── users/        # CRUD + [id]
│   │   ├── reports/      # dashboard, margins, restock, debts, price_history
│   │   ├── locations/    # almacenes / puntos de venta
│   │   ├── stock-movements/
│   │   └── stock-transfers/
│   ├── auth/login/
│   └── dashboard/        # 8 módulos
├── components/
│   ├── layout/           # Sidebar, Topbar, MobileNav
│   └── ui/               # Modal, ConfirmDialog, EmptyState, StatCard, Toaster
├── hooks/
│   └── use-online.ts
├── lib/
│   ├── api-client.ts     # fetch wrapper para todas las llamadas API
│   ├── api-helpers.ts
│   ├── auth/session.ts   # iron-session
│   ├── db/mysql.ts       # pool de conexiones MySQL
│   ├── stores/auth-store.ts
│   └── utils.ts
└── types/index.ts
mysql/
└── schema.sql            # Schema completo con todas las tablas
scripts/
└── setup-db.js           # Script interactivo de configuración inicial
```

---

## Roles y permisos

| Rol | Acceso |
|-----|--------|
| **Dueño** | Todo, incluyendo usuarios y permisos |
| **Administrador** | Inventario, ventas, clientes, proveedores, gastos, reportes |
| **Vendedor** | Ventas y clientes |
| **Bodeguero** | Inventario y proveedores |

El dueño puede personalizar permisos por usuario desde el módulo Usuarios.

---

## Scripts disponibles

```bash
npm run dev          # Desarrollo
npm run build        # Build producción
npm run start        # Producción
npm run type-check   # Verificar tipos TypeScript
npm run db:setup     # Configurar BD + crear primer usuario
```
