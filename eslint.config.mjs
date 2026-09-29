// ── ESLint (flat config) ──────────────────────────────────────────
// Next 16 eliminó el comando `next lint`, así que el linter se ejecuta
// directamente con ESLint (ver el script "lint" en package.json).
// `eslint-config-next` ya publica una configuración plana con React, Hooks,
// jsx-a11y, imports, las reglas de Next y el soporte de TypeScript; e incluye
// los ignores de `.next/`, `out/`, `build/` y `next-env.d.ts`.
import nextVitals from 'eslint-config-next/core-web-vitals';

export default [
  ...nextVitals,
  {
    // Reglas nuevas de React Hooks v7 (orientadas al React Compiler) que Next 16
    // trae activadas como error. El código es anterior a ellas: se dejan como
    // aviso para no romper `npm run lint` mientras se migran los patrones
    // afectados (setState síncrono dentro de un efecto, componentes anidados,
    // impurezas en render).
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
];
