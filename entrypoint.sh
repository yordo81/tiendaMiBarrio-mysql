#!/bin/sh
# ============================================================
# entrypoint.sh — TiendaMiBarrio (Docker)
# ============================================================
# Se ejecuta cada vez que arranca el contenedor de la aplicación.
#
# 1. Espera a que MySQL esté disponible.
# 2. Garantiza la tabla de control `schema_migrations`.
# 3. Aplica all-migrations.sql si no se ha ejecutado aún (contiene
#    el esquema base COMPLETO + todas las migraciones 002-028).
# 4. Aplica migraciones individuales (migration-XXX-*.sql) pendientes.
# 5. Arranca la aplicación.
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
  log "Creando tabla schema_migrations..."
  mysql_cmd -e "CREATE TABLE schema_migrations (
    filename   VARCHAR(255) NOT NULL PRIMARY KEY,
    applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
  log "Tabla schema_migrations creada."
  JUST_CREATED=1
else
  JUST_CREATED=0
fi

# ── 3. Aplicar migración consolidada (all-migrations.sql) ──
CONSOLIDATED="$MIGRATIONS_DIR/all-migrations.sql"
done_count=$(mysql_cmd -N -s -e "SELECT COUNT(*) FROM schema_migrations WHERE filename = 'all-migrations.sql'")

# ── 3a. Detectar esquema completo sin marker ──
# Si el esquema base está completo pero el marker no existe,
# registramos el marker sin re-ejecutar.
if [ "$done_count" = "0" ] && [ -f "$CONSOLIDATED" ]; then
  base_tables=$(mysql_cmd -N -s -e "
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = '$DB_NAME'
      AND table_name IN ('sales','products','users','settings','expenses','locations','purchases','pos')
  ")
  # 8 tablas principales = esquema completo
  if [ "$base_tables" = "8" ]; then
    mysql_cmd -e "INSERT IGNORE INTO schema_migrations (filename) VALUES ('all-migrations.sql')"
    log "Esquema base detectado (8 tablas principales existen)."
    log "all-migrations.sql registrado como aplicado — omitiendo."
    done_count=1
  fi
fi

# ── 3b. Ejecutar consolidado si no se ha aplicado ──
if [ "$done_count" = "0" ] && [ -f "$CONSOLIDATED" ]; then
  log "Aplicando esquema base + migraciones (all-migrations.sql)..."
  if ! mysql_cmd < "$CONSOLIDATED"; then
    log "ERROR: falló all-migrations.sql."
    # Diagnóstico: ¿faltan las tablas base?
    missing=$(mysql_cmd -N -s -e "
      SELECT GROUP_CONCAT(t) FROM (
        SELECT 'sales' AS t WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='$DB_NAME' AND table_name='sales')
        UNION ALL
        SELECT 'products' WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='$DB_NAME' AND table_name='products')
        UNION ALL
        SELECT 'users' WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='$DB_NAME' AND table_name='users')
      ) x
    ")
    if [ -n "$missing" ]; then
      log "Tablas faltantes: $missing"
      log "ERROR: El esquema base no se aplicó correctamente."
      log "Verifica el archivo all-migrations.sql o el estado de la base de datos."
    fi
    exit 1
  fi
  mysql_cmd -e "INSERT IGNORE INTO schema_migrations (filename) VALUES ('all-migrations.sql')"
  log "✓ Esquema base + migraciones aplicados."
elif [ "$done_count" != "0" ]; then
  log "Sin migraciones pendientes (esquema ya aplicado)."
else
  log "Sin archivo all-migrations.sql — omitiendo."
fi

# ── 4. Aplicar migraciones individuales (migration-XXX-*.sql) ──
# Busca archivos migration-*.sql en el directorio de migraciones,
# excluye los que ya fueron aplicados.
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
    mysql_cmd -e "INSERT IGNORE INTO schema_migrations (filename) VALUES ('$mname')"
    log "✓ $mname aplicada."
  fi
done

# ── 5. Arrancar la aplicación ──
log "Arrancando la aplicación..."
exec "$@"
