import { hash } from 'bcrypt';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import { MemoryStore } from 'express-session';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { resolveStoragePath } from '../src/files/storage.js';
import {
  createTestDatabase,
  type TestFile,
  type TestFolder,
  type TestUser,
} from './helpers/test-database.js';

const validPassword = 'correcthorse1';
const ownerId = 'owner-user';
const otherUserId = 'other-user';

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

function createFolder(): TestFolder {
  return {
    id: 'folder-1',
    name: 'Documents',
    ownerId: ownerId,
    parentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createFiles(): TestFile[] {
  return [
    {
      id: 'file-1',
      originalName: 'notes.txt',
      storageKey: 'owner-user/notes.txt',
      downloadUrl: '/files/file-1/download',
      mimeType: 'text/plain',
      byteSize: 5n,
      uploadedAt: new Date('2026-01-15T12:00:00.000Z'),
      ownerId: ownerId,
      folderId: 'folder-1',
    },
    {
      id: 'file-2',
      originalName: 'other.txt',
      storageKey: 'other-user/other.txt',
      downloadUrl: '/files/file-2/download',
      mimeType: 'text/plain',
      byteSize: 5n,
      uploadedAt: new Date('2026-01-15T12:00:00.000Z'),
      ownerId: otherUserId,
      folderId: null,
    },
    {
      id: 'file-3',
      originalName: 'missing.txt',
      storageKey: 'owner-user/missing.txt',
      downloadUrl: '/files/file-3/download',
      mimeType: 'text/plain',
      byteSize: 5n,
      uploadedAt: new Date('2026-01-15T12:00:00.000Z'),
      ownerId: ownerId,
      folderId: 'folder-1',
    },
    {
      id: 'file-4',
      originalName: 'unsafe.txt',
      storageKey: '../../unsafe.txt',
      downloadUrl: '/files/file-4/download',
      mimeType: 'text/plain',
      byteSize: 5n,
      uploadedAt: new Date('2026-01-15T12:00:00.000Z'),
      ownerId: ownerId,
      folderId: 'folder-1',
    },
  ];
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

describe('file details and downloads', () => {
  let app: Express;
  let passwordHash: string;
  let storageDirectory: string;
  let testDatabase: ReturnType<typeof createTestDatabase>;

  beforeAll(async () => {
    passwordHash = await hash(validPassword, 12);
  });

  beforeEach(async () => {
    storageDirectory = await mkdtemp(path.join(tmpdir(), 'file-uploader-'));
    await mkdir(path.join(storageDirectory, 'owner-user'), { recursive: true });
    await writeFile(path.join(storageDirectory, 'owner-user', 'notes.txt'), 'hello');
    testDatabase = createTestDatabase(createUsers(passwordHash), [createFolder()], createFiles());
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

  it('lists files in the correct folder', async () => {
    const agent = await signIn();
    const response = await agent.get('/folders/folder-1');

    expect(response.status).toBe(200);
    expect(response.text).toContain('notes.txt');
    expect(response.text).toContain('5 B');
    expect(response.text).toContain('href="/files/file-1"');
    expect(response.text).toContain('href="/files/file-1/download"');
    expect(response.text).not.toContain('other.txt');
  });

  it('shows file details and folder breadcrumbs', async () => {
    const agent = await signIn();
    const response = await agent.get('/files/file-1');

    expect(response.status).toBe(200);
    expect(response.text).toContain('notes.txt');
    expect(response.text).toContain('text/plain');
    expect(response.text).toContain('5 B');
    expect(response.text).toContain('Documents');
    expect(response.text).toContain('href="/files/file-1/download"');
  });

  it('downloads an owned file as an attachment', async () => {
    const agent = await signIn();
    const response = await agent.get('/files/file-1/download');

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['content-disposition']).toContain('notes.txt');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.text).toBe('hello');
  });

  it('hides files owned by another account', async () => {
    const agent = await signIn();
    const details = await agent.get('/files/file-2');
    const download = await agent.get('/files/file-2/download');

    expect(details.status).toBe(404);
    expect(download.status).toBe(404);
  });

  it('reports missing stored data without failing the request', async () => {
    const agent = await signIn();
    const response = await agent.get('/files/file-3/download');

    expect(response.status).toBe(404);
    expect(response.text).toContain('The stored file is no longer available for download.');
  });

  it('rejects storage paths that escape the upload directory', async () => {
    const agent = await signIn();
    const response = await agent.get('/files/file-4/download');

    expect(response.status).toBe(404);
  });

  it('deletes an owned file from the database and filesystem', async () => {
    const agent = await signIn();
    const confirmation = await agent.get('/files/file-1/delete');
    const token = confirmation.text.match(/name="_csrf" value="([^"]+)"/)?.[1];
    expect(token).toBeTruthy();

    const response = await agent.post('/files/file-1/delete').type('form').send({ _csrf: token });
    const storedPath = resolveStoragePath(storageDirectory, 'owner-user/notes.txt');

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/folders/folder-1');
    expect(confirmation.text).toContain('Delete notes.txt?');
    await expect(readFile(storedPath, 'utf8')).rejects.toThrow();
    expect(testDatabase.files.some((file) => file.id === 'file-1')).toBe(false);
  });
});
