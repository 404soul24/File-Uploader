import { hash } from 'bcrypt';
import type { Express } from 'express';
import { MemoryStore } from 'express-session';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createTestDatabase } from './helpers/test-database.js';

const validPassword = 'correcthorse1';

async function getCsrfToken(agent: ReturnType<typeof request.agent>, path: string) {
  const response = await agent.get(path);
  expect(response.status).toBe(200);
  const token = response.text.match(/name="_csrf" value="([^"]+)"/)?.[1];

  if (!token) {
    throw new Error(`No CSRF token found at ${path}`);
  }

  return token;
}

describe('authentication', () => {
  let app: Express;
  let database: ReturnType<typeof createTestDatabase>;

  beforeAll(async () => {
    const passwordHash = await hash(validPassword, 12);
    database = createTestDatabase([
      {
        id: 'existing-user',
        email: 'existing@example.com',
        passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    app = createApp({ database: database.database, sessionStore: new MemoryStore() });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers, normalizes, and authenticates a new user', async () => {
    const agent = request.agent(app);
    const token = await getCsrfToken(agent, '/auth/register');

    const registration = await agent.post('/auth/register').type('form').send({
      _csrf: token,
      email: '  NEW@EXAMPLE.COM ',
      password: 'newpassword1',
      confirmPassword: 'newpassword1',
    });

    expect(registration.status).toBe(303);
    expect(registration.headers.location).toBe('/');
    expect(database.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'new@example.com' }),
      }),
    );

    const home = await agent.get('/');
    expect(home.status).toBe(200);
    expect(home.text).toContain('new@example.com');
    expect(home.text).toContain('Sign out');
  });

  it('rejects invalid registration input without storing a password', async () => {
    const agent = request.agent(app);
    const token = await getCsrfToken(agent, '/auth/register');

    const response = await agent.post('/auth/register').type('form').send({
      _csrf: token,
      email: 'invalid-email',
      password: 'short',
      confirmPassword: 'different',
    });

    expect(response.status).toBe(400);
    expect(response.text).toContain('Passwords do not match.');
    expect(database.create).not.toHaveBeenCalled();
  });

  it('rejects form submissions without a valid CSRF token', async () => {
    const agent = request.agent(app);
    await getCsrfToken(agent, '/auth/login');

    const response = await agent.post('/auth/login').type('form').send({
      email: 'existing@example.com',
      password: validPassword,
    });

    expect(response.status).toBe(403);
    expect(response.text).toContain('The security token is missing or invalid.');
  });

  it('authenticates an existing user and logs them out', async () => {
    const agent = request.agent(app);
    const loginToken = await getCsrfToken(agent, '/auth/login');

    const login = await agent.post('/auth/login').type('form').send({
      _csrf: loginToken,
      email: 'existing@example.com',
      password: validPassword,
    });

    expect(login.status).toBe(303);
    expect(login.headers.location).toBe('/');

    const authenticatedHome = await agent.get('/');
    expect(authenticatedHome.text).toContain('existing@example.com');

    const logoutToken = authenticatedHome.text.match(/name="_csrf" value="([^"]+)"/)?.[1];
    expect(logoutToken).toBeTruthy();

    const logout = await agent.post('/auth/logout').type('form').send({ _csrf: logoutToken });
    expect(logout.status).toBe(303);
    expect(logout.headers.location).toBe('/auth/login');

    const homeAfterLogout = await agent.get('/');
    expect(homeAfterLogout.text).toContain('Sign in');
    expect(homeAfterLogout.text).not.toContain('existing@example.com');
  });

  it('uses a generic response for invalid credentials', async () => {
    const agent = request.agent(app);
    const token = await getCsrfToken(agent, '/auth/login');

    const response = await agent.post('/auth/login').type('form').send({
      _csrf: token,
      email: 'existing@example.com',
      password: 'wrongpassword1',
    });

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/auth/login?error=invalid');

    const errorPage = await agent.get('/auth/login?error=invalid');
    expect(errorPage.text).toContain('The email or password is incorrect.');
  });

  it('redirects unauthenticated logout attempts', async () => {
    const response = await request(app).post('/auth/logout').type('form').send({});

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/auth/login');
  });
});
