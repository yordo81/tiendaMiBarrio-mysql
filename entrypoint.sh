#!/bin/sh
# ============================================================
# entrypoint.sh — TiendaMiBarrio (Docker)
# ============================================================
# Se ejecuta cada vez que arranca el contenedor de la aplicación.
#
# 1. Espera a que MySQL esté disponible.
# 2. Garantiza la tabla de control `schema_migrations`.
# 3. Aplica all-migrations.sql si no se ha ejecutado aún (contiene
#    todas las migraciones 002-027 en un solo archivo).
# 3b. Aplica migraciones individuales (migration-XXX-*.sql) pendientes.
# 4. Arranca la aplicación.
#
# Variables: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
# (las define docker-compose).
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

# Cliente MySQL (sin prompts interactivos, sin TLS en red interna).
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
  JUST_CREATED=1
else
  JUST_CREATED=0
fi

# ── 2b. Volumen antiguo: detectar instalación pre-consolidación ──
# Si la tabla schema_migrations no tiene 'all-migrations.sql' pero
# tiene los archivos individuales (migration-002..025), significa que
# la BD ya fue migrada antes de la consolidación. Solo registramos
# el consolidado como aplicado sin volver a ejecutar nada.
if [ "$JUST_CREATED" = "1" ]; then
  has_consolidated=$(mysql_cmd -N -s -e "SELECT COUNT(*) FROM schema_migrations WHERE filename = 'all-migrations.sql'")
  if [ "$has_consolidated" = "0" ]; then
    has_old=$(mysql_cmd -N -s -e "SELECT COUNT(*) FROM schema_migrations WHERE filename LIKE 'migration-%'")
    if [ "$has_old" != "0" ]; then
      mysql_cmd -e "INSERT IGNORE INTO schema_migrations (filename) VALUES ('all-migrations.sql')"
      log "Volumen heredado: migraciones individuales detectadas, consolidado registrado."
    fi
  fi
fi

# ── 3. Aplicar migración consolidada (all-migrations.sql) ──
CONSOLIDATED="$MIGRATIONS_DIR/all-migrations.sql"
done_count=$(mysql_cmd -N -s -e "SELECT COUNT(*) FROM schema_migrations WHERE filename = 'all-migrations.sql'")

if [ "$done_count" = "0" ] && [ -f "$CONSOLIDATED" ]; then
  log "Aplicando migraciones consolidadas (all-migrations.sql)..."
  if ! mysql_cmd < "$CONSOLIDATED"; then
    log "ERROR: falló all-migrations.sql. Corrige el SQL o la BD y reinicia el contenedor."
    exit 1
  fi
  mysql_cmd -e "INSERT INTO schema_migrations (filename) VALUES ('all-migrations.sql')"
  log "✓ all-migrations.sql aplicada."
elif [ "$done_count" != "0" ]; then
  log "Sin migraciones pendientes (consolidado ya aplicado)."
else
  log "Sin archivo all-migrations.sql — omitiendo."
fi

# ── 3b. Aplicar migraciones individuales (migration-XXX-*.sql) ──
# Busca archivos migration-*.sql en el directorio de migraciones,
# excluye all-migrations.sql y los que ya fueron aplicados.
for mfile in "$MIGRATIONS_DIR"/migration-*.sql; do
  [ -f "$mfile" ] || continue  # sin glob: saltar
  mname=$(basename "$mfile")
  mcount=$(mysql_cmd -N -s -e "SELECT COUNT(*) FROM schema_migrations WHERE filename = '$mname'")
  if [ "$mcount" = "0" ]; then
    log "Aplicando migración individual: $mname ..."
    if ! mysql_cmd < "$mfile"; then
      log "ERROR: falló $mname. Corrige el SQL o la BD y reinicia el contenedor."
      exit 1
    fi
    mysql_cmd -e "INSERT INTO schema_migrations (filename) VALUES ('$mname')"
    log "✓ $mname aplicada."
  fi
done

# ── 4. Arrancar la aplicación ──
log "Arrancando la aplicación..."
exec "$@"
