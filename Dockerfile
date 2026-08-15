# ============================================================
# Dockerfile — TiendaMiBarrio (Next.js + MySQL)
# ============================================================
# Build: docker build -t tienda-mi-barrio .
# Run:   docker compose up
# ============================================================

# ============================================================
# Dockerfile — TiendaMiBarrio (Next.js + MySQL)
# ============================================================
# Build: docker build -t tienda-mi-barrio .
# Run:   docker compose up
# ============================================================

# --------------- Stage 1: Dependencias y Build ---------------
FROM node:24-alpine AS builder

WORKDIR /app

# Copiar solo package files primero para cachear capa de npm install
COPY package*.json ./
RUN npm ci

# Copiar el resto del código
COPY . .

# Build de producción (usa output: 'standalone' de next.config.ts)
RUN npm run build

# --------------- Stage 2: Producción ---------------
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=America/Havana
# tzdata: zona horaria del negocio · mariadb-client + mariadb-connector-c: aplicar migraciones
# (mariadb-connector-c aporta el plugin caching_sha2_password para MySQL 8)
RUN apk add --no-cache tzdata mariadb-client mariadb-connector-c

# Crear usuario no-root para seguridad
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copiar standalone desde builder
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Migraciones SQL que aplica el entrypoint al arrancar
COPY --from=builder --chown=nextjs:nodejs /app/mysql ./mysql

# Entrypoint: espera MySQL, aplica migraciones pendientes y arranca la app
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Pasar a usuario no-root
USER nextjs

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
