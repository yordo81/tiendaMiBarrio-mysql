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

### Opción B: Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install && npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t tienda-mi-barrio .
docker run -p 3000:3000 --env-file .env.local tienda-mi-barrio
```

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
