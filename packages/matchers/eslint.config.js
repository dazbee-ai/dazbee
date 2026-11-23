import preset from '@dazbee/config/eslint'

export default [
  ...preset,
  // The browser measurement's bundle, pieces and results (scripts/browser-measure), written by its build.
  { ignores: ['.browser-measure/'] },
]
