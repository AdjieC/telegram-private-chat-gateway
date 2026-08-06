import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['worker.js', 'src/**/*.js'],
      thresholds: {
        functions: 50,
        lines: 45,
        branches: 40
      }
    }
  }
});
