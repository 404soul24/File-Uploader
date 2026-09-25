import { z } from 'zod';

export const shareDurationSchema = z.coerce
  .number()
  .int()
  .refine((days) => [1, 7, 10, 30].includes(days), {
    message: 'Choose a supported share duration.',
  });

export const createShareSchema = z.object({
  folderId: z.string().trim().min(1).max(64),
  durationDays: shareDurationSchema,
});

export const shareTokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{43}$/);

export const shareIdSchema = z.string().trim().min(1).max(64);
export const fileIdSchema = z.string().trim().min(1).max(64);
export const folderIdSchema = z.string().trim().min(1).max(64);
