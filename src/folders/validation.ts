import { z } from 'zod';

const forbiddenCharacters = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

function containsForbiddenCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return forbiddenCharacters.has(character) || code < 32 || code === 127;
  });
}

export const folderNameSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(1, 'Folder name is required.')
      .max(120, 'Folder name must be 120 characters or fewer.')
      .refine((value) => !containsForbiddenCharacter(value), {
        message: 'Folder name contains an unsupported character.',
      }),
  );

export const createFolderSchema = z.object({
  name: folderNameSchema,
  parentId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((value) => (value ? value : null)),
});

export const renameFolderSchema = z.object({
  name: folderNameSchema,
});

export const folderIdSchema = z.string().trim().min(1).max(64);
