#!/bin/sh
# ============================================================
# entrypoint.sh — TiendaMiBarrio (Docker)
# ============================================================
# Se ejecuta cada vez que arranca el contenedor de la aplicación.
#
# 1. Espera a que MySQL esté disponible.
# 2. Garantiza la tabla de control `schema_migrations` (no se muestra
#    en la interfaz web), que registra qué migraciones se han ejecutado.
# 3. Aplica en orden las migraciones de $MIGRATIONS_DIR que falten en la
#    tabla y las registra. Si una falla, aborta el arranque (exit 1).
#
# Sobre el esquema inicial (mysql/init/01-schema.sql): la primera vez que
# arranca MySQL lo crea ya completo, incluida la tabla schema_migrations
# con las migraciones 002-022 declaradas como incluidas (su efecto está
# integrado en el esquema). Por eso en un despliegue nuevo solo se
# aplican las migraciones NUEVAS (las que no estén declaradas ahí ni
# registradas en la tabla).
#
# 4. Arranca la aplicación con los argumentos recibidos (CMD del Dockerfile).
#
# Variables: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME (las define
# docker-compose). Fuera de Docker, si no vienen en el entorno, se leen del
# archivo ENV_FILE (por defecto /app/.env.local). MIGRATIONS_DIR apunta a la
# carpeta con los .sql.
# ============================================================
set -e

# ── Entorno ──
ENV_FILE="${ENV_FILE:-/app/.env.local}"
if [ -z "${DB_HOST:-}" ] && [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:-rootpassword}"
DB_NAME="${DB_NAME:-tienda_mi_barrio}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/app/mysql}"

# Cliente MySQL (con o sin contraseña, sin prompts interactivos).
# --skip-ssl: el cliente MariaDB rechaza el certificado autofirmado de MySQL 8;
# la conexión viaja por la red interna del contenedor, no necesita TLS.
mysql_cmd() {
  if [ -n "$DB_PASSWORD" ]; then
    mysql --skip-ssl -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" "$@"
  else
    mysql --skip-ssl -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" "$@"
  fi
}

log() { echo "[entrypoint] $*"; }

# ── 1. Esperar a MySQL ──
ping_ok() {
  if [ -n "$DB_PASSWORD" ]; then
    mysqladmin --skip-ssl ping -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" --silent >/dev/null 2>&1
  else
    mysqladmin --skip-ssl ping -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" --silent >/dev/null 2>&1
  fi
}

log "Esperando a MySQL en ${DB_HOST}:${DB_PORT}..."
attempt=0
until ping_ok; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    log "ERROR: MySQL no respondió tras 60 intentos (~120s)."
    exit 1
  fi
  sleep 2
done
log "MySQL disponible."

# ── 2. Tabla de control de migraciones ──
# En un despliegue nuevo la crea 01-schema.sql (junto con la declaración
# de migraciones ya incluidas en el esquema).
table_exists=$(mysql_cmd -N -s -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$DB_NAME' AND table_name = 'schema_migrations'")

if [ "$table_exists" = "0" ]; then
  mysql_cmd -e "CREATE TABLE schema_migrations (
    filename   VARCHAR(255) NOT NULL PRIMARY KEY,
    applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
  log "Tabla schema_migrations creada."
  JUST_CREATED=1
else
  JUST_CREATED=0
fi

# ── 2b. Volumen antiguo sin control de migraciones ──
# Si la tabla acaba de crearse, la instalación es anterior al control de
# migraciones. Se detecta con un marcador de la migración más reciente
# integrada en el esquema (024: sale_items.product_id nullable). Si el
# esquema ya está completo, se registran las migraciones SIN re-ejecutarlas
# (igual que hacía el baseline antiguo); si está incompleto, se dejan
# pendientes para que se apliquen abajo.
if [ "$JUST_CREATED" = "1" ]; then
  product_nullable=$(mysql_cmd -N -s -e "SELECT IS_NULLABLE FROM information_schema.columns WHERE table_schema = '$DB_NAME' AND table_name = 'sale_items' AND column_name = 'product_id'")
  if [ "$product_nullable" = "YES" ]; then
    total=0
    for f in "$MIGRATIONS_DIR"/migration-*.sql; do
      [ -e "$f" ] || continue
      name=$(basename "$f")
      mysql_cmd -e "INSERT IGNORE INTO schema_migrations (filename) VALUES ('$name')"
      total=$((total + 1))
    done
    log "Volumen heredado: esquema ya completo ($total migración(es) registradas sin re-ejecutar)."
  else
    log "Volumen heredado: esquema incompleto, se aplicarán las migraciones pendientes."
  fi
fi

# ── 3. Aplicar migraciones pendientes ──
applied=0
for f in "$MIGRATIONS_DIR"/migration-*.sql; do
  [ -e "$f" ] || continue
  name=$(basename "$f")
  done_count=$(mysql_cmd -N -s -e "SELECT COUNT(*) FROM schema_migrations WHERE filename = '$name'")
  if [ "$done_count" = "0" ]; then
    log "Aplicando migración: $name"
    if ! mysql_cmd < "$f"; then
      log "ERROR: falló la migración $name. Corrige el SQL o la BD y reinicia el contenedor."
      exit 1
    fi
    mysql_cmd -e "INSERT INTO schema_migrations (filename) VALUES ('$name')"
    log "✓ $name aplicada."
    applied=$((applied + 1))
  fi
done
if [ "$applied" -gt 0 ]; then
  log "$applied migración(es) aplicada(s)."
else
  log "Sin migraciones pendientes."
fi

# ── 4. Arrancar la aplicación ──
log "Arrancando la aplicación..."
exec "$@"
