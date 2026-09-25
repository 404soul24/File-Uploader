import { hash } from 'bcrypt';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import { MemoryStore } from 'express-session';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createTestDatabase, type TestFolder, type TestUser } from './helpers/test-database.js';

const validPassword = 'correcthorse1';
const ownerId = 'owner-user';
const otherUserId = 'other-user';

async function getCsrfToken(agent: ReturnType<typeof request.agent>, path: string) {
  const response = await agent.get(path);
  expect(response.status).toBe(200);
  const token = response.text.match(/name="_csrf" value="([^"]+)"/)?.[1];

  if (!token) {
    throw new Error(`No CSRF token found at ${path}`);
  }

  return token;
}

function expectRedirect(location: string | undefined) {
  expect(location).toBeDefined();
  return location ?? '';
}

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

function createOtherUsersFolder(): TestFolder {
  return {
    id: 'other-folder',
    name: 'Private',
    ownerId: otherUserId,
    parentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('folders', () => {
  let app: Express;
  let passwordHash: string;
  let storageDirectory: string;
  let testDatabase: ReturnType<typeof createTestDatabase>;

  beforeAll(async () => {
    passwordHash = await hash(validPassword, 12);
  });

  beforeEach(async () => {
    storageDirectory = await mkdtemp(path.join(tmpdir(), 'file-uploader-folders-'));
    testDatabase = createTestDatabase(createUsers(passwordHash), [createOtherUsersFolder()]);
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

  it('requires authentication', async () => {
    const response = await request(app).get('/folders');

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/auth/login');
  });

  it('creates and opens a root folder', async () => {
    const agent = await signIn();
    const token = await getCsrfToken(agent, '/folders');

    const created = await agent.post('/folders').type('form').send({
      _csrf: token,
      name: '  Travel photos  ',
      parentId: '',
    });

    expect(created.status).toBe(303);
    expect(created.headers.location).toBe('/folders/folder-1');
    const createdPath = expectRedirect(created.headers.location);

    const folder = await agent.get(createdPath);
    expect(folder.status).toBe(200);
    expect(folder.text).toContain('Travel photos');
    expect(testDatabase.folders).toHaveLength(2);
  });

  it('creates nested folders and renders breadcrumbs', async () => {
    const agent = await signIn();
    const rootToken = await getCsrfToken(agent, '/folders');
    await agent.post('/folders').type('form').send({
      _csrf: rootToken,
      name: 'Projects',
      parentId: '',
    });
    const childToken = await getCsrfToken(agent, '/folders/folder-1');
    const child = await agent
      .post('/folders')
      .type('form')
      .send({ _csrf: childToken, name: 'Launch', parentId: 'folder-1' });

    expect(child.status).toBe(303);
    expect(child.headers.location).toBe('/folders/folder-2');

    const folder = await agent.get('/folders/folder-2');
    expect(folder.text).toContain('Projects');
    expect(folder.text).toContain('Launch');
    expect(folder.text).toContain('href="/folders/folder-1"');
  });

  it('renames an owned folder', async () => {
    const agent = await signIn();
    const rootToken = await getCsrfToken(agent, '/folders');
    await agent
      .post('/folders')
      .type('form')
      .send({ _csrf: rootToken, name: 'Draft', parentId: '' });
    const folderToken = await getCsrfToken(agent, '/folders/folder-1');

    const renamed = await agent
      .post('/folders/folder-1/rename')
      .type('form')
      .send({ _csrf: folderToken, name: 'Final' });

    expect(renamed.status).toBe(303);
    expect(testDatabase.folders[1]?.name).toBe('Final');
  });

  it('rejects duplicate names case-insensitively at the same level', async () => {
    const agent = await signIn();
    const token = await getCsrfToken(agent, '/folders');
    await agent
      .post('/folders')
      .type('form')
      .send({ _csrf: token, name: 'Documents', parentId: '' });

    const duplicate = await agent
      .post('/folders')
      .type('form')
      .send({ _csrf: token, name: 'documents', parentId: '' });

    expect(duplicate.status).toBe(409);
    expect(duplicate.text).toContain('A folder with this name already exists here.');
  });

  it('allows the same name at different folder levels', async () => {
    const agent = await signIn();
    const rootToken = await getCsrfToken(agent, '/folders');
    await agent
      .post('/folders')
      .type('form')
      .send({ _csrf: rootToken, name: 'Shared', parentId: '' });
    const childToken = await getCsrfToken(agent, '/folders/folder-1');
    const child = await agent
      .post('/folders')
      .type('form')
      .send({ _csrf: childToken, name: 'Shared', parentId: 'folder-1' });

    expect(child.status).toBe(303);
  });

  it('hides folders owned by another account', async () => {
    const agent = await signIn();
    const read = await agent.get('/folders/other-folder');
    const token = await getCsrfToken(agent, '/folders');
    const deleted = await agent
      .post('/folders/other-folder/delete')
      .type('form')
      .send({ _csrf: token });

    expect(read.status).toBe(404);
    expect(deleted.status).toBe(404);
    expect(testDatabase.folders.some((folder) => folder.id === 'other-folder')).toBe(true);
  });

  it('recursively deletes descendants while preserving other owners', async () => {
    const agent = await signIn();
    const rootToken = await getCsrfToken(agent, '/folders');
    await agent
      .post('/folders')
      .type('form')
      .send({ _csrf: rootToken, name: 'Archive', parentId: '' });
    const childToken = await getCsrfToken(agent, '/folders/folder-1');
    await agent
      .post('/folders')
      .type('form')
      .send({ _csrf: childToken, name: '2025', parentId: 'folder-1' });
    const grandchildToken = await getCsrfToken(agent, '/folders/folder-2');
    await agent
      .post('/folders')
      .type('form')
      .send({ _csrf: grandchildToken, name: 'Logs', parentId: 'folder-2' });

    const rootFilePath = path.join(storageDirectory, 'owner-user', 'folder-1', 'root.txt');
    const nestedFilePath = path.join(storageDirectory, 'owner-user', 'folder-2', 'nested.txt');
    await mkdir(path.dirname(rootFilePath), { recursive: true });
    await mkdir(path.dirname(nestedFilePath), { recursive: true });
    await writeFile(rootFilePath, 'root');
    await writeFile(nestedFilePath, 'nested');
    await testDatabase.createFile({
      data: {
        id: 'file-1',
        originalName: 'root.txt',
        storageKey: 'owner-user/folder-1/root.txt',
        downloadUrl: '/files/file-1/download',
        mimeType: 'text/plain',
        byteSize: 4n,
        ownerId,
        folderId: 'folder-1',
      },
    });
    await testDatabase.createFile({
      data: {
        id: 'file-2',
        originalName: 'nested.txt',
        storageKey: 'owner-user/folder-2/nested.txt',
        downloadUrl: '/files/file-2/download',
        mimeType: 'text/plain',
        byteSize: 6n,
        ownerId,
        folderId: 'folder-2',
      },
    });

    const confirmation = await agent.get('/folders/folder-1/delete');
    expect(confirmation.text).toContain('nested folders');

    const token = await getCsrfToken(agent, '/folders');
    const deleted = await agent
      .post('/folders/folder-1/delete')
      .type('form')
      .send({ _csrf: token });

    expect(deleted.status).toBe(303);
    expect(testDatabase.folders.map((folder) => folder.id)).toEqual(['other-folder']);
    expect(testDatabase.files).toHaveLength(0);
    await expect(readFile(rootFilePath, 'utf8')).rejects.toThrow();
    await expect(readFile(nestedFilePath, 'utf8')).rejects.toThrow();
  });

  it('rejects unsupported names and missing CSRF tokens', async () => {
    const agent = await signIn();
    const token = await getCsrfToken(agent, '/folders');
    const invalidName = await agent
      .post('/folders')
      .type('form')
      .send({ _csrf: token, name: 'bad/name', parentId: '' });
    const missingToken = await agent
      .post('/folders')
      .type('form')
      .send({ name: 'Unsafe', parentId: '' });

    expect(invalidName.status).toBe(400);
    expect(missingToken.status).toBe(403);
  });
});
