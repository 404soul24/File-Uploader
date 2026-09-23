import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      SESSION_SECRET: 'test-session-secret-with-at-least-32-characters',
    },
    include: ['tests/**/*.test.ts'],
  },
});
