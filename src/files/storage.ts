import { stat } from 'node:fs/promises';
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
