import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { mkdirSync as createDirectory } from 'node:fs';
import path from 'node:path';

export class InvalidStorageKeyError extends Error {
  constructor() {
    super('The stored file path is invalid.');
    this.name = 'InvalidStorageKeyError';
  }
}

export class StoredFileMissingError extends Error {
  constructor() {
    super('The stored file is unavailable.');
    this.name = 'StoredFileMissingError';
  }
}

export function resolveStoragePath(storageDirectory: string, storageKey: string) {
  if (
    storageKey.includes('\\') ||
    storageKey.includes('\0') ||
    storageKey.includes(':') ||
    path.isAbsolute(storageKey)
  ) {
    throw new InvalidStorageKeyError();
  }

  const segments = storageKey.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new InvalidStorageKeyError();
  }

  const baseDirectory = path.resolve(storageDirectory);
  const resolvedPath = path.resolve(baseDirectory, ...segments);
  const relativePath = path.relative(baseDirectory, resolvedPath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new InvalidStorageKeyError();
  }

  return resolvedPath;
}

export function getTemporaryUploadDirectory(storageDirectory: string) {
  return path.join(path.resolve(storageDirectory), '.tmp');
}

export function ensureStorageDirectories(storageDirectory: string) {
  createDirectory(path.resolve(storageDirectory), { recursive: true, mode: 0o700 });
  createDirectory(getTemporaryUploadDirectory(storageDirectory), { recursive: true, mode: 0o700 });
}

export function buildStorageKey(ownerId: string, folderId: string | null, fileId: string) {
  return `${ownerId}/${folderId ?? 'root'}/${fileId}`;
}

export async function moveTemporaryFile(
  storageDirectory: string,
  temporaryPath: string,
  storageKey: string,
) {
  const destinationPath = resolveStoragePath(storageDirectory, storageKey);
  await mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
  await rename(temporaryPath, destinationPath);
  return destinationPath;
}

export async function removeFile(filePath: string) {
  await rm(filePath, { force: true });
}

export async function getStoredFileStats(storageDirectory: string, storageKey: string) {
  let stats;

  try {
    stats = await stat(resolveStoragePath(storageDirectory, storageKey));
  } catch (error) {
    if (error instanceof InvalidStorageKeyError) {
      throw error;
    }

    throw new StoredFileMissingError();
  }

  if (!stats.isFile()) {
    throw new StoredFileMissingError();
  }

  return stats;
}
