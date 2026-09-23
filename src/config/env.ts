import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const developmentSessionSecret = 'development-only-session-secret-change-before-deploying';

const booleanFromEnvironment = z.preprocess((value) => {
  if (typeof value === 'string') {
    return ['1', 'true', 'yes'].includes(value.toLowerCase());
  }

  return value;
}, z.boolean());

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  APP_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().url().optional(),
  SESSION_SECRET: z.string().min(32),
  UPLOAD_DIR: z.string().min(1).default('./uploads'),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().positive().max(1_024).default(25),
  TRUST_PROXY: booleanFromEnvironment.default(false),
});

const environment = environmentSchema.safeParse({
  ...process.env,
  SESSION_SECRET:
    process.env.SESSION_SECRET ??
    (process.env.NODE_ENV === 'production' ? undefined : developmentSessionSecret),
});

if (!environment.success) {
  const details = environment.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = {
  ...environment.data,
  UPLOAD_DIR: path.resolve(projectRoot, environment.data.UPLOAD_DIR),
};
