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
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  UPLOAD_DIR: z.string().min(1).default('./uploads'),
  TEMP_UPLOAD_TTL_MINUTES: z.coerce.number().int().positive().max(10_080).default(60),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().positive().max(1_024).default(25),
  ALLOWED_MIME_TYPES: z
    .string()
    .min(1)
    .default(
      'image/jpeg,image/png,image/gif,image/webp,image/avif,image/bmp,image/tiff,image/heic,image/heif,application/pdf,application/rtf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.oasis.opendocument.text,application/vnd.oasis.opendocument.spreadsheet,application/vnd.oasis.opendocument.presentation,application/zip,application/gzip,application/x-tar,application/x-7z-compressed,application/vnd.rar,audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/flac,audio/ogg,application/ogg,audio/aac,audio/webm,video/mp4,video/webm,video/quicktime,video/x-msvideo,video/x-matroska,text/plain',
    ),
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
