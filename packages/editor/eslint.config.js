import preset from '@dazbee/config/eslint'

/**
 * The editor's shell: the files only a browser can run. Every other file of the package is the
 * core's, which `tsconfig.core.json` compiles with no browser's types, or a test's.
 */
const SHELL_FILES = [
  'src/ai/arrivals.ts',
  'src/ai/layering-finish.ts',
  'src/canvas/overlay.ts',
  'src/canvas/rulers.ts',
  'src/canvas/surface.ts',
  'src/clipboard-events.ts',
  'src/editor-interface.ts',
  'src/editor-worker.ts',
  'src/editor.ts',
  'src/export/export-client.ts',
  'src/export/export-files.ts',
  'src/export/export-worker.ts',
  'src/gestures/dom-input.ts',
  'src/gestures/stage-field.ts',
  'src/gestures/test-dom-input.ts',
  'src/image-client.ts',
  'src/image-worker.ts',
  'src/index.ts',
  'src/matching/match-client.ts',
  'src/matching/match-pool.ts',
  'src/matching/match-worker.ts',
  'src/matching/matcher-files.ts',
  'src/open-tab.ts',
  'src/save-state.ts',
  'src/sync-link.ts',
  'src/tab-copy.ts',
  'src/token-source.ts',
  'src/vendor.ts',
  'src/viewer.ts',
  'src/**/*-parts.ts',
]
/**
 * The two browser types the compiler lets a core file name: CanvasKit's own declarations bring
 * them in with `@webgpu/types`, so the core's typecheck can't refuse them.
 */
const CANVAS_TYPES = ['HTMLCanvasElement', 'OffscreenCanvas']
const inCore = (name) => `${name} is the browser's: a file of the editor's core runs without one.`

export default [
  ...preset,
  {
    files: ['src/**/*.ts'],
    ignores: [...SHELL_FILES, '**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          globals: CANVAS_TYPES.map((name) => ({ name, message: inCore(name) })),
          // Reached through globalThis, self or window too.
          checkGlobalObject: true,
        },
      ],
      '@typescript-eslint/no-restricted-types': [
        'error',
        { types: Object.fromEntries(CANVAS_TYPES.map((name) => [name, inCore(name)])) },
      ],
    },
  },
]
