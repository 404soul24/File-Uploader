import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupOrphanedStorage } from '../src/files/cleanup.js';
import { createTestDatabase, type TestFile } from './helpers/test-database.js';

const referencedFile: TestFile = {
  id: 'file-1',
  originalName: 'kept.txt',
  storageKey: 'owner/folder/kept.txt',
  downloadUrl: '/files/file-1/download',
  mimeType: 'text/plain',
  byteSize: 4n,
  uploadedAt: new Date(),
  ownerId: 'owner',
  folderId: 'folder',
};

describe('storage reconciliation', () => {
  let storageDirectory: string;

  beforeEach(async () => {
    storageDirectory = await mkdtemp(path.join(tmpdir(), 'file-uploader-cleanup-'));
    await mkdir(path.join(storageDirectory, 'owner', 'folder'), { recursive: true });
    await mkdir(path.join(storageDirectory, '.tmp'), { recursive: true });
    await writeFile(path.join(storageDirectory, 'owner', 'folder', 'kept.txt'), 'kept');
    await writeFile(path.join(storageDirectory, 'owner', 'orphan.txt'), 'orphan');
    await writeFile(path.join(storageDirectory, '.tmp', 'stale.upload'), 'stale');
    await writeFile(path.join(storageDirectory, '.tmp', 'fresh.upload'), 'fresh');

    const oldTime = new Date(Date.now() - 120 * 60 * 1_000);
    await utimes(path.join(storageDirectory, '.tmp', 'stale.upload'), oldTime, oldTime);
  });

  afterEach(async () => {
    await rm(storageDirectory, { recursive: true, force: true });
  });

  it('reports cleanup candidates without deleting in dry-run mode', async () => {
    const { database } = createTestDatabase([], [], [referencedFile]);
    const result = await cleanupOrphanedStorage({
      database,
      dryRun: true,
      now: new Date(),
      storageDirectory,
      temporaryFileTtlMinutes: 60,
    });

    expect(result).toMatchObject({
      dryRun: true,
      orphanedFilesRemoved: 1,
      staleTemporaryFilesRemoved: 1,
    });
    await expect(
      readFile(path.join(storageDirectory, 'owner', 'orphan.txt'), 'utf8'),
    ).resolves.toBe('orphan');
  });

  it('removes orphaned and stale files while preserving referenced and recent files', async () => {
    const { database } = createTestDatabase([], [], [referencedFile]);
    const result = await cleanupOrphanedStorage({
      database,
      now: new Date(),
      storageDirectory,
      temporaryFileTtlMinutes: 60,
    });

    expect(result.orphanedFilesRemoved).toBe(1);
    expect(result.staleTemporaryFilesRemoved).toBe(1);
    await expect(
      readFile(path.join(storageDirectory, 'owner', 'folder', 'kept.txt'), 'utf8'),
    ).resolves.toBe('kept');
    await expect(
      readFile(path.join(storageDirectory, 'owner', 'orphan.txt'), 'utf8'),
    ).rejects.toThrow();
    await expect(
      readFile(path.join(storageDirectory, '.tmp', 'stale.upload'), 'utf8'),
    ).rejects.toThrow();
    await expect(
      readFile(path.join(storageDirectory, '.tmp', 'fresh.upload'), 'utf8'),
    ).resolves.toBe('fresh');
    await expect(stat(path.join(storageDirectory, '.tmp'))).resolves.toBeDefined();
  });

  it('does not touch storage when the database inventory cannot be read', async () => {
    const unreliableDatabase = {
      file: {
        findMany: vi.fn(async () => {
          throw new Error('Database unavailable');
        }),
      },
    } as unknown as PrismaClient;

    await expect(
      cleanupOrphanedStorage({
        database: unreliableDatabase,
        storageDirectory,
        temporaryFileTtlMinutes: 60,
      }),
    ).rejects.toThrow('Database unavailable');
    await expect(
      readFile(path.join(storageDirectory, 'owner', 'orphan.txt'), 'utf8'),
    ).resolves.toBe('orphan');
  });
});
