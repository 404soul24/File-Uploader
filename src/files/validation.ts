import { z } from 'zod';

export const fileIdSchema = z.string().trim().min(1).max(64);
