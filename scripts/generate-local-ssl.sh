#!/usr/bin/env bash
# Genera certificados autofirmados para HTTPS local (Next.js dev).
# Los genera en la raíz del proyecto y los excluyen de git (.gitignore).
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CERT_KEY="$ROOT_DIR/localhost.key"
CERT_CRT="$ROOT_DIR/localhost.crt"
CN="${CN:-localhost}"
DAYS="${DAYS:-365}"
KEY_BITS="${KEY_BITS:-2048}"

if [ -f "$CERT_KEY" ] && [ -f "$CERT_CRT" ]; then
  echo "Certificados locales ya existen: $CERT_KEY / $CERT_CRT"
  exit 0
fi

echo "Generando certificado autofirmado para CN=$CN (válido $DAYS días)..."

# Método 1: openssl (preferido)
if command -v openssl >/dev/null 2>&1; then
  openssl req -x509 \
    -newkey rsa:"$KEY_BITS" \
    -nodes \
    -keyout "$CERT_KEY" \
    -out "$CERT_CRT" \
    -days "$DAYS" \
    -subj "/CN=$CN" \
    -addext "subjectAltName=DNS:$CN,DNS:*.localhost,IP:127.0.0.1,IP:::1" 2>/dev/null && {
    echo "OK: $CERT_KEY / $CERT_CRT"
    exit 0
  }
fi

# Método 2: Node.js invocando openssl (para Windows/Git Bash sin openssl en PATH)
if command -v node >/dev/null 2>&1; then
  node -e "
    const { execSync } = require('child_process');
    const fs = require('fs');
    const keyFile = process.argv[1];
    const crtFile = process.argv[2];
    const cn = process.argv[3];
    const days = process.argv[4];
    const bits = process.argv[5];

    // Buscar openssl en ubicaciones comunes de Windows
    const paths = ['openssl', 'C:/Program Files/Git/usr/bin/openssl.exe', 'C:/Program Files (x86)/Git/usr/bin/openssl.exe'];
    let opensslCmd = null;
    for (const p of paths) {
      try { execSync(p + ' version', { stdio: 'ignore' }); opensslCmd = p; break; } catch {}
    }
    if (!opensslCmd) {
      console.error('ERROR: openssl no encontrado. Instala Git for Windows o agrega openssl al PATH.');
      process.exit(1);
    }
    const cmd = opensslCmd + ' req -x509 -newkey rsa:' + bits + ' -nodes' +
      ' -keyout \"' + keyFile + '\" -out \"' + crtFile + '\"' +
      ' -days ' + days + ' -subj \"/CN=' + cn + '\"' +
      ' -addext \"subjectAltName=DNS:' + cn + ',DNS:*.localhost,IP:127.0.0.1,IP:::1\"';
    execSync(cmd, { stdio: 'ignore' });
    console.log('OK: ' + keyFile + ' / ' + crtFile);
  " "$CERT_KEY" "$CERT_CRT" "$CN" "$DAYS" "$KEY_BITS"
  exit 0
fi

echo "ERROR: ni openssl ni node están disponibles." >&2
exit 1
