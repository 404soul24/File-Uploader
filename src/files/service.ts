import type { PrismaClient } from '@prisma/client';

export class FileNotFoundError extends Error {
  constructor() {
    super('File not found.');
    this.name = 'FileNotFoundError';
  }
}

export async function getOwnedFile(database: PrismaClient, ownerId: string, fileId: string) {
  const file = await database.file.findFirst({
    where: { id: fileId, ownerId },
  });

  if (!file) {
    throw new FileNotFoundError();
  }

  return file;
}

export function listFolderFiles(database: PrismaClient, ownerId: string, folderId: string | null) {
  return database.file.findMany({
    where: { ownerId, folderId },
    orderBy: { uploadedAt: 'desc' },
  });
}

export async function deleteOwnedFile(database: PrismaClient, ownerId: string, fileId: string) {
  await getOwnedFile(database, ownerId, fileId);
  return database.file.delete({ where: { id: fileId } });
}
