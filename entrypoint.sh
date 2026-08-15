#!/bin/sh
# ============================================================
# entrypoint.sh — TiendaMiBarrio (Docker)
# ============================================================
# Se ejecuta cada vez que arranca el contenedor de la aplicación.
#
# 1. Espera a que MySQL esté disponible.
# 2. Crea la tabla de control `schema_migrations` (no se muestra en la
#    interfaz web) que registra qué migraciones se han ejecutado.
# 3. Baseline: la primera vez (cuando la tabla no existía) registra todas
#    las migraciones existentes como aplicadas, porque el esquema de la BD
#    ya incluye su efecto (el contenedor MySQL lo crea completo con
#    mysql/init/01-schema.sql, o la instalación se migró manualmente).
#    Así solo se ejecutan las migraciones NUEVAS que se agreguen después.
# 4. Aplica en orden las migraciones de $MIGRATIONS_DIR que falten en la
#    tabla y las registra. Si una falla, aborta el arranque (exit 1).
# 5. Arranca la aplicación con los argumentos recibidos (CMD del Dockerfile).
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
table_exists=$(mysql_cmd -N -s -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$DB_NAME' AND table_name = 'schema_migrations'")

if [ "$table_exists" = "0" ]; then
  mysql_cmd -e "CREATE TABLE schema_migrations (
    filename   VARCHAR(255) NOT NULL PRIMARY KEY,
    applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
  log "Tabla schema_migrations creada."
  BASELINE=1
else
  BASELINE=0
fi

# ── 3. Baseline (solo la primera vez) ──
if [ "$BASELINE" = "1" ]; then
  total=0
  for f in "$MIGRATIONS_DIR"/migration-*.sql; do
    [ -e "$f" ] || continue
    name=$(basename "$f")
    mysql_cmd -e "INSERT INTO schema_migrations (filename) VALUES ('$name')"
    total=$((total + 1))
  done
  log "Baseline: $total migración(es) registrada(s) como aplicadas (el esquema ya está completo)."
fi

# ── 4. Aplicar migraciones pendientes ──
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

# ── 5. Arrancar la aplicación ──
log "Arrancando la aplicación..."
exec "$@"
