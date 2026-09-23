import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/file_uploader_test',
      SESSION_SECRET: 'test-session-secret-with-at-least-32-characters',
    },
    include: ['tests/**/*.test.ts'],
  },
});
