import type { CookieOptions } from 'express';
import session, { type Store } from 'express-session';
import { PrismaSessionStore } from '@quixo3/prisma-session-store';
import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

export const sessionMaxAge = 7 * 24 * 60 * 60 * 1_000;
export const sessionCookieName =
  env.NODE_ENV === 'production' ? '__Host-file-uploader.sid' : 'file-uploader.sid';

export const sessionCookieOptions: CookieOptions = {
  httpOnly: true,
  maxAge: sessionMaxAge,
  path: '/',
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
};

export const sessionCookieClearOptions: CookieOptions = {
  httpOnly: true,
  path: '/',
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
};

export function createPrismaSessionStore(database: PrismaClient) {
  return new PrismaSessionStore(database, {
    checkPeriod: 2 * 60 * 60 * 1_000,
    dbRecordIdFunction: undefined,
    dbRecordIdIsSessionId: true,
    sessionModelName: 'session',
    ttl: sessionMaxAge,
  });
}

export function createSessionMiddleware(store: Store) {
  return session({
    cookie: sessionCookieOptions,
    name: sessionCookieName,
    proxy: env.TRUST_PROXY,
    resave: false,
    rolling: false,
    saveUninitialized: false,
    secret: env.SESSION_SECRET,
    store,
    unset: 'destroy',
  });
}
