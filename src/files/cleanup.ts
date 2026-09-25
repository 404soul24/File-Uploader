import { readdir, rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import {
  ensureStorageDirectories,
  getTemporaryUploadDirectory,
  resolveStoragePath,
} from './storage.js';

interface CleanupStorageOptions {
  database: PrismaClient;
  dryRun?: boolean;
  now?: Date;
  storageDirectory: string;
  temporaryFileTtlMinutes: number;
}

export interface CleanupStorageResult {
  dryRun: boolean;
  orphanedFilesRemoved: number;
  staleTemporaryFilesRemoved: number;
  emptyDirectoriesRemoved: number;
}

async function collectFiles(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
    } else {
      files.push(entryPath);
    }
  }

  return files;
}

async function removeEmptyDirectories(baseDirectory: string, excludedDirectory: string) {
  const directories: string[] = [];

  async function collectDirectories(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const entryPath = path.join(directory, entry.name);
      if (entryPath === excludedDirectory) {
        continue;
      }

      directories.push(entryPath);
      await collectDirectories(entryPath);
    }
  }

  await collectDirectories(baseDirectory);
  let removedCount = 0;

  for (const directory of directories.sort((left, right) => right.length - left.length)) {
    try {
      await rmdir(directory);
      removedCount += 1;
    } catch {
      continue;
    }
  }

  return removedCount;
}

export async function cleanupOrphanedStorage({
  database,
  dryRun = false,
  now = new Date(),
  storageDirectory,
  temporaryFileTtlMinutes,
}: CleanupStorageOptions): Promise<CleanupStorageResult> {
  ensureStorageDirectories(storageDirectory);
  const referencedKeys = new Set(
    (await database.file.findMany({ select: { storageKey: true } })).map((file) => file.storageKey),
  );
  const temporaryDirectory = path.resolve(getTemporaryUploadDirectory(storageDirectory));
  const baseDirectory = path.resolve(storageDirectory);
  const temporaryFiles = await collectFiles(temporaryDirectory);
  const storedFiles = (await collectFiles(baseDirectory)).filter(
    (filePath) =>
      path.resolve(filePath) !== temporaryDirectory &&
      !path.resolve(filePath).startsWith(`${temporaryDirectory}${path.sep}`),
  );
  const temporaryCutoff = now.getTime() - temporaryFileTtlMinutes * 60 * 1_000;
  const staleTemporaryFiles: string[] = [];

  for (const filePath of temporaryFiles) {
    const fileStats = await stat(filePath);
    if (fileStats.mtimeMs < temporaryCutoff) {
      staleTemporaryFiles.push(filePath);
    }
  }

  const orphanedFiles = storedFiles.filter((filePath) => {
    const storageKey = path.relative(baseDirectory, filePath).split(path.sep).join('/');

    try {
      resolveStoragePath(storageDirectory, storageKey);
      return !referencedKeys.has(storageKey);
    } catch {
      return true;
    }
  });
  const filesToRemove = [...staleTemporaryFiles, ...orphanedFiles];

  if (!dryRun) {
    await Promise.all(filesToRemove.map((filePath) => rm(filePath, { force: true })));
  }

  const emptyDirectoriesRemoved = dryRun
    ? 0
    : await removeEmptyDirectories(baseDirectory, temporaryDirectory);

  return {
    dryRun,
    orphanedFilesRemoved: orphanedFiles.length,
    staleTemporaryFilesRemoved: staleTemporaryFiles.length,
    emptyDirectoriesRemoved,
  };
}
