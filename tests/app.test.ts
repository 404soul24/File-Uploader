import { MemoryStore } from 'express-session';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createTestDatabase } from './helpers/test-database.js';

describe('application foundation', () => {
  const { database } = createTestDatabase();
  const app = createApp({ database, sessionStore: new MemoryStore() });

  it('renders the home page', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.text).toContain('File Uploader');
  });

  it('reports its health', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns a 404 page', async () => {
    const response = await request(app).get('/missing-page');

    expect(response.status).toBe(404);
    expect(response.text).toContain('Page not found');
  });
});
