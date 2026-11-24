import { defineConfig } from 'vitest/config';

// Coverage is enforced as a floor, not as a target: any change that lowers a
// number below its floor fails `npm run test:coverage`.
//
// The gate is scoped to the layers the unit suite owns (utils, services, hooks
// and the server handlers under `api/_lib`). The presentational layer
// (`src/components`, `App.jsx`) is exercised by the Playwright suite instead,
// so a global-number gate would measure the split between two suites rather
// than the health of either one.
//
// Raise a floor when a change raises the real number; never lower one to make a
// build pass.
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.js', 'src/**/*.test.jsx'],
    setupFiles: ['./src/test-setup.js'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/', 'src/test-setup.js', '**/*.config.*'],
      thresholds: {
        'src/utils/**': { lines: 70, functions: 72, branches: 72, statements: 70 },
        'src/services/**': { lines: 58, functions: 56, branches: 60, statements: 58 },
        'src/hooks/**': { lines: 54, functions: 44, branches: 56, statements: 54 },
        'api/_lib/**': { lines: 54, functions: 60, branches: 55, statements: 54 },
      },
    },
  },
});
