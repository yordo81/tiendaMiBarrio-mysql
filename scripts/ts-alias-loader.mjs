// Loader de Node para resolver el alias de tsconfig `@/…` → `src/…`
// (Next lo resuelve en runtime; fuera de Next hace falta este hook).
// Se registra desde scripts/test-sale-ticket.mjs con node:module register().
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = path.join(ROOT, 'src', specifier.slice(2));
    for (const f of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        return nextResolve(pathToFileURL(f).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
