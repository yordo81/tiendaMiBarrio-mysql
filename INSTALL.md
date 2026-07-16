# Guía de instalación — TiendaMiBarrio MySQL

> Sistema de gestión integral para tienda retail. **Sin Supabase.** Todo corre en tu propio servidor MySQL.

## Requisitos previos

- **Node.js** v24 o superior → https://nodejs.org
- **MySQL** 8.0 o superior → https://dev.mysql.com/downloads/
- **npm** v10 o superior (viene con Node.js)
- **Docker** 24+ (opcional, para deploy con Docker Compose)

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

## Módulos del sistema

| Módulo | Descripción |
|--------|-------------|
| **Dashboard** | Métricas del día/semana/mes, ventas vs gastos, top productos, widget de reservaciones pendientes |
| **Inventario** | Productos + categorías (CRUD), alertas de stock mínimo, subida de imágenes |
| **Compras** | Histórico de compras a proveedores con filtros por producto, proveedor y fechas |
| **Almacenes** | Múltiples almacenes/puntos de venta, traslados entre ubicaciones |
| **Movimientos** | Vista unificada de movimientos de stock con filtros por tipo, ubicación, producto y fecha |
| **Ventas** | POS con pagos mixtos (efectivo, transferencia, crédito), cancelaciones, abonos vinculados |
| **Clientes** | Cuentas por cobrar, historial de abonos vinculados a ventas |
| **Proveedores** | CRUD + historial de precios por producto/proveedor |
| **Gastos** | Gastos operativos con método de pago (efectivo/transferencia), categorías personalizables |
| **Reservaciones** | Gestión de pedidos de clientes (pendiente/confirmada/cancelada) |
| **Contabilidad** | Libro de caja: saldos efectivo/transferencia, aportes de capital, ajustes, gráfico de evolución, filtro por periodo |
| **Reportes** | Ventas, rentabilidad, variación de precios, proyección de reabastecimiento, cuentas |
| **Auditoría** | Registro de eliminaciones y ajustes críticos con detalles de quién, qué y cuándo |
| **Usuarios** | Roles (Dueño, Admin, Vendedor, Bodeguero) + permisos granulares |

## Pasos de instalación

### 1. Descomprime el proyecto

```bash
unzip tiendaMiBarrio-mysql.zip
cd tiendaMiBarrio-mysql
```

### 2. Instala las dependencias

```bash
npm install
```

> Si ves un error de `ENOTEMPTY`, ejecuta `npm install` una segunda vez.
> En Mac/Linux, también puedes usar: `rm -rf node_modules && npm install`

### 3. Configura las variables de entorno

```bash
cp .env.local.example .env.local
```

Edita `.env.local` con tus datos:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu_contraseña_mysql
DB_NAME=tienda_mi_barrio
SESSION_SECRET=genera_con_el_comando_de_abajo
```

Genera un SESSION_SECRET seguro:
```bash
# En Mac/Linux:
openssl rand -base64 32

# En Windows (PowerShell):
[Convert]::ToBase64String((1..32 | ForEach { [byte](Get-Random -Max 256) }))
```

### 4. Configura la base de datos

```bash
node scripts/setup-db.js
```

El script interactivo:
- Crea la base de datos si no existe
- Crea todas las tablas
- Te pide crear el usuario **dueño** (owner)

Alternativamente, puedes crear la BD manualmente:
```bash
mysql -u root -p < mysql/schema.sql
```

Y luego crear el usuario dueño:
```sql
-- Ejecuta en tu cliente MySQL:
USE tienda_mi_barrio;
INSERT INTO users (id, name, email, password_hash, role, permissions, active, created_at, updated_at)
VALUES (
  UUID(),
  'Administrador',
  'admin@tutienda.com',
  '$2a$12$REEMPLAZA_CON_HASH_BCRYPT',  -- usa bcrypt para generar
  'owner',
  '[]',
  1,
  NOW(),
  NOW()
);
```

### Migraciones

Si ya tienes la BD creada con una versión anterior del schema, ejecuta las migraciones **en orden numérico**:

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
| `migration-002-on-delete-set-null.sql` | Agrega `ON DELETE SET NULL` a las FK de `user_id` en tablas `sales`, `expenses`, `stock_movements`, `stock_transfers` y `location_movements`. |
| `migration-003-customer-payments-sale-link.sql` | Agrega columna `sale_id` a `customer_payments` para vincular abonos con ventas. |
| `migration-004-purchases-table.sql` | Crea la tabla `purchases` para el histórico de compras a proveedores. |
| `migration-005-audit-logs.sql` | Crea la tabla `audit_logs` para auditoría de eliminaciones y acciones críticas. |
| `migration-006-accounting-module.sql` | Agrega `payment_method` a `expenses` y crea la tabla `cash_register`. |
| `migration-007-capital-management.sql` | Amplía `cash_register.type` para soportar `purchase` (reinversión) y `capital` (aporte de capital). |
| `migration-007-reservations.sql` | Crea la tabla `reservations` para gestionar pedidos de clientes. |

> **Nota:** Si usaste `node scripts/setup-db.js` en una instalación nueva, las migraciones ya se aplican automáticamente. Solo ejecútalas manualmente si actualizas una BD existente.

Para generar el hash bcrypt de tu contraseña:
```bash
node -e "const b=require('bcryptjs'); console.log(b.hashSync('tu_contraseña', 12))"
```

### 5. Inicia la aplicación

```bash
# Desarrollo
npm run dev

# Producción
npm run build && npm start
```

Abre tu navegador en: **http://localhost:3000**

### 6. Primer inicio de sesión

1. Ve a **http://localhost:3000/auth/login**
2. Ingresa con el email y contraseña del usuario dueño que creaste
3. Accederás al Dashboard con todos los módulos disponibles

---

## Deploy con Docker (Recomendado para producción)

El proyecto incluye `Dockerfile` y `docker-compose.yml` para levantar la aplicación completa con MySQL incluido.

### 1. Configurar variables de entorno

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

### 2. Iniciar todos los servicios

```bash
docker compose up -d
```

Esto levanta dos contenedores:
- **`tienda_mb_db`** — MySQL 8.0 con el schema aplicado automáticamente
- **`tienda_mb_app`** — Next.js en modo producción en `http://localhost:3000`

### 3. Crear el primer usuario (dueño)

```bash
# Conectar a MySQL dentro del contenedor
docker exec -it tienda_mb_db mysql -u root -p"${DB_PASSWORD:-rootpassword}" tienda_mi_barrio
```

```sql
INSERT INTO users (id, name, email, password_hash, role, permissions, active, created_at, updated_at)
VALUES (UUID(), 'Admin', 'admin@tienda.com', '$2a$12$HASH_AQUI', 'owner', '[]', 1, NOW(), NOW());
```

### 4. Comandos útiles de Docker

```bash
docker compose logs -f              # Ver logs de todos los servicios
docker compose stop                 # Detener servicios (sin borrar datos)
docker compose down                 # Detener y eliminar contenedores
docker compose down -v              # Detener todo y borrar la BD (¡cuidado!)
docker compose build --no-cache app # Reconstruir la imagen de la app
```

---

## Resolución de problemas

### Error: ENOTEMPTY al hacer npm install
```bash
rm -rf node_modules package-lock.json
npm install
```

### Error: Cannot connect to MySQL
- Verifica que MySQL esté corriendo: `mysql -u root -p`
- Comprueba que las credenciales en `.env.local` sean correctas

### Error: SESSION_SECRET not set
- El archivo `.env.local` debe existir con un SESSION_SECRET de al menos 32 caracteres

### La app redirige siempre a /auth/login
- Verifica que la cookie `tienda_session` se está creando
- Asegúrate que NODE_ENV y SESSION_SECRET estén bien configurados

## Scripts disponibles

```bash
npm run dev              # Servidor de desarrollo (hot reload)
npm run build            # Compilar para producción
npm start                # Iniciar en modo producción
npm run lint             # Ejecutar linter
npm run type-check       # Verificar tipos TypeScript
node scripts/setup-db.js     # Configurar BD y crear primer usuario
node scripts/analisis-inventario.js     # Análisis de inventario
node scripts/recalcular-stock.js        # Recalcular stock
node scripts/debug-accounting.js        # Depuración de contabilidad
node scripts/test-fk-fix.js             # Prueba de foreign keys
node scripts/ventas-por-producto.js     # Análisis de ventas por producto
```
