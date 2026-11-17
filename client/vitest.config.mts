import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./src/server/db/test-setup.ts'],
    env: {
      APP_SECRET: 'test-secret-test-secret-test-secret-00',
      APP_URL: 'http://localhost:3300',
      SIGNUPS: 'open',
      SMTP_HOST: '',
    },
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
