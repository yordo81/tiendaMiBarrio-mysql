# Guía de instalación — TiendaMiBarrio MySQL

## Requisitos previos

- **Node.js** v18 o superior → https://nodejs.org
- **MySQL** 8.0 o superior → https://dev.mysql.com/downloads/
- **npm** v9 o superior (viene con Node.js)

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
npm run dev          # Servidor de desarrollo (hot reload)
npm run build        # Compilar para producción
npm start            # Iniciar en modo producción
npm run type-check   # Verificar tipos TypeScript
node scripts/setup-db.js  # Configurar BD y crear primer usuario
```
