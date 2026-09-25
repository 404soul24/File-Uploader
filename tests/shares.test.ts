import { hash } from 'bcrypt';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import { MemoryStore } from 'express-session';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { getSharedFolderContext, hashShareToken } from '../src/shares/service.js';
import {
  createTestDatabase,
  type TestFile,
  type TestFolder,
  type TestFolderShare,
  type TestUser,
} from './helpers/test-database.js';

const validPassword = 'correcthorse1';
const ownerId = 'owner-user';
const otherUserId = 'other-user';
const activeToken = 'a'.repeat(43);
const expiredToken = 'b'.repeat(43);
const revokedToken = 'c'.repeat(43);
const childShareToken = 'd'.repeat(43);

function createUsers(passwordHash: string): TestUser[] {
  return [
    {
      id: ownerId,
      email: 'owner@example.com',
      passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: otherUserId,
      email: 'other@example.com',
      passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
}

function createFolders(): TestFolder[] {
  return [
    {
      id: 'folder-1',
      name: 'Shared',
      ownerId,
      parentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'folder-2',
      name: 'Nested',
      ownerId,
      parentId: 'folder-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'folder-3',
      name: 'Outside',
      ownerId,
      parentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'other-folder',
      name: 'Private',
      ownerId: otherUserId,
      parentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
}

function createFiles(): TestFile[] {
  return [
    {
      id: 'file-1',
      originalName: 'root.txt',
      storageKey: 'owner-user/folder-1/root.txt',
      downloadUrl: '/files/file-1/download',
      mimeType: 'text/plain',
      byteSize: 4n,
      uploadedAt: new Date(),
      ownerId,
      folderId: 'folder-1',
    },
    {
      id: 'file-2',
      originalName: 'nested.txt',
      storageKey: 'owner-user/folder-2/nested.txt',
      downloadUrl: '/files/file-2/download',
      mimeType: 'text/plain',
      byteSize: 6n,
      uploadedAt: new Date(),
      ownerId,
      folderId: 'folder-2',
    },
    {
      id: 'file-3',
      originalName: 'outside.txt',
      storageKey: 'owner-user/folder-3/outside.txt',
      downloadUrl: '/files/file-3/download',
      mimeType: 'text/plain',
      byteSize: 7n,
      uploadedAt: new Date(),
      ownerId,
      folderId: 'folder-3',
    },
  ];
}

function createShare(
  id: string,
  token: string,
  folderId: string,
  expiresAt: Date,
  revokedAt: Date | null = null,
): TestFolderShare {
  const now = new Date();
  return {
    id,
    tokenHash: hashShareToken(token),
    durationDays: 7,
    expiresAt,
    revokedAt,
    createdAt: now,
    updatedAt: now,
    folderId,
    createdById: ownerId,
  };
}

async function getCsrfToken(agent: ReturnType<typeof request.agent>, path: string) {
  const response = await agent.get(path);
  expect(response.status).toBe(200);
  const token = response.text.match(/name="_csrf" value="([^"]+)"/)?.[1];
  if (!token) {
    throw new Error(`No CSRF token found at ${path}`);
  }
  return token;
}

describe('folder shares', () => {
  let app: Express;
  let passwordHash: string;
  let storageDirectory: string;
  let testDatabase: ReturnType<typeof createTestDatabase>;

  beforeAll(async () => {
    passwordHash = await hash(validPassword, 12);
  });

  beforeEach(async () => {
    storageDirectory = await mkdtemp(path.join(tmpdir(), 'file-uploader-shares-'));
    for (const directory of ['folder-1', 'folder-2', 'folder-3']) {
      await mkdir(path.join(storageDirectory, 'owner-user', directory), { recursive: true });
    }
    await writeFile(path.join(storageDirectory, 'owner-user', 'folder-1', 'root.txt'), 'root');
    await writeFile(path.join(storageDirectory, 'owner-user', 'folder-2', 'nested.txt'), 'nested');
    await writeFile(
      path.join(storageDirectory, 'owner-user', 'folder-3', 'outside.txt'),
      'outside',
    );

    const now = new Date();
    testDatabase = createTestDatabase(createUsers(passwordHash), createFolders(), createFiles(), [
      createShare('share-active', activeToken, 'folder-1', new Date(now.getTime() + 86_400_000)),
      createShare('share-expired', expiredToken, 'folder-1', new Date(now.getTime() - 1_000)),
      createShare(
        'share-revoked',
        revokedToken,
        'folder-1',
        new Date(now.getTime() + 86_400_000),
        now,
      ),
      createShare('share-child', childShareToken, 'folder-2', new Date(now.getTime() + 86_400_000)),
    ]);
    app = createApp({
      database: testDatabase.database,
      sessionStore: new MemoryStore(),
      uploadDirectory: storageDirectory,
    });
  });

  afterEach(async () => {
    await rm(storageDirectory, { recursive: true, force: true });
  });

  async function signIn() {
    const agent = request.agent(app);
    const token = await getCsrfToken(agent, '/auth/login');
    const response = await agent.post('/auth/login').type('form').send({
      _csrf: token,
      email: 'owner@example.com',
      password: validPassword,
    });
    expect(response.status).toBe(303);
    return agent;
  }

  it('browses a shared folder without authentication', async () => {
    const response = await request(app).get(`/share/${activeToken}`);

    expect(response.status).toBe(200);
    expect(response.text).toContain('Shared');
    expect(response.text).toContain('root.txt');
    expect(response.text).toContain('Nested');
    expect(response.text).not.toContain('owner@example.com');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
  });

  it('browses and downloads files from nested descendants', async () => {
    const context = await getSharedFolderContext(testDatabase.database, activeToken, 'folder-2');
    expect(context.folder.id).toBe('folder-2');
    const folder = await request(app).get(`/share/${activeToken}/folders/folder-2`);
    const download = await request(app).get(`/share/${activeToken}/files/file-2/download`);

    expect(folder.status).toBe(200);
    expect(folder.text).toContain('nested.txt');
    expect(download.status).toBe(200);
    expect(download.headers['content-disposition']).toContain('nested.txt');
    expect(download.text).toBe('nested');
  });

  it('rejects files and folders outside the shared subtree', async () => {
    const outsideFile = await request(app).get(`/share/${activeToken}/files/file-3/download`);
    const parentFolder = await request(app).get(`/share/${childShareToken}/folders/folder-1`);
    const parentFile = await request(app).get(`/share/${childShareToken}/files/file-1/download`);

    expect(outsideFile.status).toBe(404);
    expect(parentFolder.status).toBe(404);
    expect(parentFile.status).toBe(404);
  });

  it('rejects invalid, expired, and revoked tokens', async () => {
    const invalid = await request(app).get(`/share/${'z'.repeat(43)}`);
    const expired = await request(app).get(`/share/${expiredToken}`);
    const revoked = await request(app).get(`/share/${revokedToken}`);

    expect(invalid.status).toBe(404);
    expect(expired.status).toBe(404);
    expect(revoked.status).toBe(404);
    expect(expired.text).toContain('Share unavailable');
  });

  it('creates a one-time token URL for an owned folder', async () => {
    const agent = await signIn();
    const token = await getCsrfToken(agent, '/folders/folder-1');

    const created = await agent.post('/shares').type('form').send({
      _csrf: token,
      folderId: 'folder-1',
      durationDays: 10,
    });

    expect(created.status).toBe(201);
    const rawToken = created.text.match(/\/share\/([A-Za-z0-9_-]{43})/)?.[1];
    expect(rawToken).toBeTruthy();
    const storedShare = testDatabase.shares[4];
    expect(storedShare?.durationDays).toBe(10);
    expect(storedShare?.tokenHash).toBe(hashShareToken(rawToken ?? ''));
    expect(storedShare?.tokenHash).not.toBe(rawToken);

    const publicPage = await request(app).get(`/share/${rawToken}`);
    expect(publicPage.status).toBe(200);
    expect(publicPage.text).toContain('Shared');
  });

  it('rejects invalid durations and folders owned by another account', async () => {
    const agent = await signIn();
    const token = await getCsrfToken(agent, '/folders/folder-1');
    const invalidDuration = await agent
      .post('/shares')
      .type('form')
      .send({ _csrf: token, folderId: 'folder-1', durationDays: 5 });
    const otherFolder = await agent
      .post('/shares')
      .type('form')
      .send({ _csrf: token, folderId: 'other-folder', durationDays: 7 });

    expect(invalidDuration.status).toBe(400);
    expect(otherFolder.status).toBe(404);
  });

  it('revokes an active link and blocks it immediately', async () => {
    const agent = await signIn();
    const token = await getCsrfToken(agent, '/shares');
    const revoked = await agent
      .post('/shares/share-active/revoke')
      .type('form')
      .send({ _csrf: token });

    expect(revoked.status).toBe(303);
    expect(revoked.headers.location).toBe('/shares');

    const publicPage = await request(app).get(`/share/${activeToken}`);
    expect(publicPage.status).toBe(404);
  });

  it('requires authentication to manage shares', async () => {
    const page = await request(app).get('/shares');
    const revoke = await request(app).post('/shares/share-active/revoke');

    expect(page.status).toBe(303);
    expect(revoke.status).toBe(303);
    expect(revoke.headers.location).toBe('/auth/login');
  });
});
