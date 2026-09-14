#!/usr/bin/env node
/**
 * Genera certificados autofirmados para HTTPS local usando openssl.
 * Alternativa pura a generate-local-ssl.sh para entornos donde bash no
 * está disponible (ej: scripts npm en Windows).
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const certKey = resolve(rootDir, 'localhost.key');
const certCrt = resolve(rootDir, 'localhost.crt');

const cn = process.env.CN ?? 'localhost';
const days = process.env.DAYS ?? '365';
const keyBits = process.env.KEY_BITS ?? '2048';

if (existsSync(certKey) && existsSync(certCrt)) {
  console.log(`Certificados locales ya existen: ${certKey} / ${certCrt}`);
  process.exit(0);
}

// Buscar openssl en ubicaciones comunes de Windows
const opensslPaths = [
  'openssl',
  'C:/Program Files/Git/usr/bin/openssl.exe',
  'C:/Program Files (x86)/Git/usr/bin/openssl.exe',
];

let opensslCmd = null;
for (const p of opensslPaths) {
  try {
    execSync(`${p} version`, { stdio: 'ignore' });
    opensslCmd = p;
    break;
  } catch {
    // intentar siguiente
  }
}

if (!opensslCmd) {
  console.error(
    'ERROR: openssl no encontrado.\n' +
    'Instala Git for Windows (https://git-scm.com) o agrega openssl al PATH.',
  );
  process.exit(1);
}

console.log(`Generando certificado autofirmado para CN=${cn} (válido ${days} días)...`);

const cmd = [
  opensslCmd,
  'req -x509',
  `-newkey rsa:${keyBits}`,
  '-nodes',
  `-keyout "${certKey}"`,
  `-out "${certCrt}"`,
  `-days ${days}`,
  `-subj "/CN=${cn}"`,
  `-addext "subjectAltName=DNS:${cn},DNS:*.localhost,IP:127.0.0.1,IP:::1"`,
].join(' ');

try {
  execSync(cmd, { stdio: 'ignore' });
  console.log(`OK: ${certKey} / ${certCrt}`);
} catch (e) {
  console.error('ERROR: openssl falló al generar el certificado.', e.message);
  process.exit(1);
}

// Nota: el navegador mostrará un aviso de certificado desconocido la primera
// vez que abras APP_ORIGIN (ej: https://localhost:3000) con HTTPS_ENABLED=true.
// Acepta ese aviso para usar la app local en HTTPS con este certificado.
