import { hash } from 'bcrypt';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import { MemoryStore } from 'express-session';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { resolveStoragePath } from '../src/files/storage.js';
import { createTestDatabase, type TestFolder, type TestUser } from './helpers/test-database.js';

const validPassword = 'correcthorse1';
const maxUploadSizeBytes = 1024 * 1024;
const ownerId = 'owner-user';
const onePixelPng = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
);

function createUsers(passwordHash: string): TestUser[] {
  return [
    {
      id: ownerId,
      email: 'owner@example.com',
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
      name: 'Documents',
      ownerId: ownerId,
      parentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'other-folder',
      name: 'Private',
      ownerId: 'other-user',
      parentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
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

describe('file uploads', () => {
  let app: Express;
  let passwordHash: string;
  let storageDirectory: string;
  let testDatabase: ReturnType<typeof createTestDatabase>;

  beforeAll(async () => {
    passwordHash = await hash(validPassword, 12);
  });

  beforeEach(async () => {
    storageDirectory = await mkdtemp(path.join(tmpdir(), 'file-uploader-uploads-'));
    testDatabase = createTestDatabase(createUsers(passwordHash), createFolders());
    app = createApp({
      database: testDatabase.database,
      maxUploadSizeBytes,
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

  it('uploads a file to the root directory', async () => {
    const agent = await signIn();
    const token = await getCsrfToken(agent, '/folders');

    const response = await agent
      .post('/uploads')
      .field('_csrf', token)
      .attach('file', Buffer.from('hello'), { filename: 'hello.txt', contentType: 'text/plain' });

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/folders');
    expect(testDatabase.files).toHaveLength(1);

    const file = testDatabase.files[0];
    expect(file?.originalName).toBe('hello.txt');
    expect(file?.folderId).toBeNull();
    expect(file?.storageKey).toMatch(/^owner-user\/root\/[0-9a-f-]{36}$/);
    expect(file?.byteSize).toBe(5n);
    await expect(
      readFile(resolveStoragePath(storageDirectory, file?.storageKey ?? ''), 'utf8'),
    ).resolves.toBe('hello');
  });

  it('uploads a file into an owned folder', async () => {
    const agent = await signIn();
    const token = await getCsrfToken(agent, '/folders/folder-1');

    const response = await agent
      .post('/uploads/folders/folder-1')
      .field('_csrf', token)
      .attach('file', Buffer.from('folder'), { filename: 'note.txt', contentType: 'text/plain' });

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/folders/folder-1');
    expect(testDatabase.files[0]?.folderId).toBe('folder-1');
    expect(testDatabase.files[0]?.storageKey).toMatch(/^owner-user\/folder-1\//);
  });

  it('rejects an upload with no file', async () => {
    const agent = await signIn();
    const token = await getCsrfToken(agent, '/folders');

    const response = await agent.post('/uploads').field('_csrf', token);

    expect(response.status).toBe(400);
    expect(response.text).toContain('Choose a file before uploading.');
    expect(testDatabase.files).toHaveLength(0);
  });

  it('rejects files over the configured size limit and clears temp storage', async () => {
    const agent = await signIn();
    const token = await getCsrfToken(agent, '/folders');

    const response = await agent
      .post('/uploads')
      .field('_csrf', token)
      .attach('file', Buffer.alloc(maxUploadSizeBytes + 1, 'a'), {
        filename: 'large.txt',
        contentType: 'text/plain',
      });

    expect(response.status).toBe(413);
    expect(testDatabase.files).toHaveLength(0);
    await expect(readdir(path.join(storageDirectory, '.tmp'))).resolves.toEqual([]);
  });

  it('rejects uploads without a CSRF token and clears temp storage', async () => {
    const agent = await signIn();
    await getCsrfToken(agent, '/folders');

    const response = await agent
      .post('/uploads')
      .attach('file', Buffer.from('hello'), { filename: 'hello.txt', contentType: 'text/plain' });

    expect(response.status).toBe(403);
    expect(testDatabase.files).toHaveLength(0);
    await expect(readdir(path.join(storageDirectory, '.tmp'))).resolves.toEqual([]);
  });

  it('does not upload into a folder owned by another account', async () => {
    const agent = await signIn();
    const token = await getCsrfToken(agent, '/folders');

    const response = await agent
      .post('/uploads/folders/other-folder')
      .field('_csrf', token)
      .attach('file', Buffer.from('hello'), { filename: 'hello.txt', contentType: 'text/plain' });

    expect(response.status).toBe(404);
    expect(testDatabase.files).toHaveLength(0);
    await expect(readdir(path.join(storageDirectory, '.tmp'))).resolves.toEqual([]);
  });

  it('requires authentication before receiving a file', async () => {
    const response = await request(app)
      .post('/uploads')
      .attach('file', Buffer.from('hello'), { filename: 'hello.txt', contentType: 'text/plain' });

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/auth/login');
    expect(testDatabase.files).toHaveLength(0);
  });

  it('stores the detected MIME type instead of trusting the client', async () => {
    const agent = await signIn();
    const token = await getCsrfToken(agent, '/folders');
    const response = await agent
      .post('/uploads')
      .field('_csrf', token)
      .attach('file', onePixelPng, { filename: 'pixel.png', contentType: 'text/plain' });

    expect(response.status).toBe(303);
    expect(testDatabase.files[0]?.mimeType).toBe('image/png');
  });

  it('accepts an allowed PDF and verifies its signature', async () => {
    const agent = await signIn();
    const token = await getCsrfToken(agent, '/folders');

    const response = await agent
      .post('/uploads')
      .field('_csrf', token)
      .attach('file', Buffer.from('%PDF-1.7\n1 0 obj\n'), {
        filename: 'document.pdf',
        contentType: 'application/octet-stream',
      });

    expect(response.status).toBe(303);
    expect(testDatabase.files[0]?.mimeType).toBe('application/pdf');
  });

  it('rejects an executable disguised with a text extension', async () => {
    const agent = await signIn();
    const token = await getCsrfToken(agent, '/folders');
    const executable = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

    const response = await agent
      .post('/uploads')
      .field('_csrf', token)
      .attach('file', executable, { filename: 'notes.txt', contentType: 'text/plain' });

    expect(response.status).toBe(415);
    expect(response.text).toContain('This file type is not allowed.');
    expect(testDatabase.files).toHaveLength(0);
    await expect(readdir(path.join(storageDirectory, '.tmp'))).resolves.toEqual([]);
  });

  it('rejects image content that does not match a text extension', async () => {
    const agent = await signIn();
    const token = await getCsrfToken(agent, '/folders');
    const response = await agent
      .post('/uploads')
      .field('_csrf', token)
      .attach('file', onePixelPng, { filename: 'notes.txt', contentType: 'text/plain' });

    expect(response.status).toBe(415);
    expect(response.text).toContain('The file contents do not match the file extension.');
  });

  it('rejects markup disguised as plain text', async () => {
    const agent = await signIn();
    const token = await getCsrfToken(agent, '/folders');

    const response = await agent
      .post('/uploads')
      .field('_csrf', token)
      .attach('file', Buffer.from('<!doctype html><html><body>hello</body></html>'), {
        filename: 'page.txt',
        contentType: 'text/plain',
      });

    expect(response.status).toBe(415);
    expect(response.text).toContain('This text file is not allowed.');
  });

  it('rejects blocked extensions and empty files', async () => {
    const agent = await signIn();
    const token = await getCsrfToken(agent, '/folders');

    const blockedExtension = await agent
      .post('/uploads')
      .field('_csrf', token)
      .attach('file', Buffer.from('hello'), { filename: 'program.exe', contentType: 'text/plain' });
    const empty = await agent
      .post('/uploads')
      .field('_csrf', token)
      .attach('file', Buffer.alloc(0), { filename: 'empty.txt', contentType: 'text/plain' });

    expect(blockedExtension.status).toBe(415);
    expect(blockedExtension.text).toContain('This file extension is not allowed.');
    expect(empty.status).toBe(400);
    expect(empty.text).toContain('Empty files cannot be uploaded.');
    expect(testDatabase.files).toHaveLength(0);
  });
});
