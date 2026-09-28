/**
 * semantic-release — versionado automático desde Conventional Commits
 *
 *   fix:                     → parche  (2.0.1)
 *   feat:                    → minor   (2.1.0)
 *   feat!: / BREAKING CHANGE: → major  (3.0.0)
 *   perf:                    → parche
 *   resto (docs, chore, refactor, test, ci, style, config…) → sin release
 *
 * Preset "angular" (integrado en semantic-release, sin dependencias extra).
 * El flujo completo (analizar → tag v{x.y.z} → CHANGELOG.md → commit de
 * release → GitHub Release → imagen Docker versionada) se ejecuta en
 * .github/workflows/release.yml en cada push a main.
 *
 * Ver: https://semantic-release.gitbook.io/semantic-release/
 */

module.exports = {
  branches: ['main'],
  tagFormat: 'v${version}',
  plugins: [
    // 1. Determina el tipo de release (patch/minor/major) a partir de los commits
    ['@semantic-release/commit-analyzer', { preset: 'angular' }],

    // 2. Genera las notas de la release agrupadas por tipo de cambio
    ['@semantic-release/release-notes-generator', { preset: 'angular' }],

    // 3. Mantiene CHANGELOG.md actualizado con el historial de versiones
    [
      '@semantic-release/changelog',
      {
        changelogFile: 'CHANGELOG.md',
        changelogTitle:
          '# Changelog\n\nTodos los cambios notables de este proyecto se documentan en este archivo.\n\nBasado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [Semantic Versioning](https://semver.org/lang/es/).\n',
      },
    ],

    // 4. Sincroniza la versión en package.json (no publica en npm: repo privado)
    ['@semantic-release/npm', { npmPublish: false }],

    // 5. Commitea CHANGELOG.md y package.json con el mensaje de release
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json'],
        message:
          'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],

    // 6. Crea el tag vX.Y.Z en GitHub y publica el Release con las notas.
    //    El tag dispara el workflow "Docker Image CI" que publica la imagen
    //    yordo81/tienda_mb_app con tags {major}.{minor}.{patch}, {major}.{minor} y latest.
    '@semantic-release/github',
  ],
};
