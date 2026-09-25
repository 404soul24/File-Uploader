import type { PrismaClient } from '@prisma/client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type ErrorRequestHandler } from 'express';
import type { Store } from 'express-session';
import helmet from 'helmet';
import { generateCsrfToken } from './auth/csrf.js';
import { loadCurrentUser } from './auth/middleware.js';
import { createPassport } from './auth/passport.js';
import { ensureStorageDirectories } from './files/storage.js';
import { createPrismaSessionStore, createSessionMiddleware } from './auth/session.js';
import { prisma } from './config/database.js';
import { env } from './config/env.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createFileRouter } from './routes/file.routes.js';
import { createFolderRouter } from './routes/folder.routes.js';
import { createPublicShareRouter } from './routes/public-share.routes.js';
import { createShareRouter } from './routes/share.routes.js';
import { createUploadRouter } from './routes/upload.routes.js';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(sourceDirectory, '..');

interface AppOptions {
  database?: PrismaClient;
  maxUploadSizeBytes?: number;
  sessionStore?: Store;
  uploadDirectory?: string;
}

function getErrorStatus(error: unknown) {
  if (typeof error !== 'object' || error === null) {
    return 500;
  }

  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status = candidate.statusCode ?? candidate.status;

  if (typeof status === 'number' && status >= 400 && status <= 599) {
    return status;
  }

  return 500;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const database = options.database ?? prisma;
  const uploadDirectory = options.uploadDirectory ?? env.UPLOAD_DIR;
  const maxUploadSizeBytes = options.maxUploadSizeBytes ?? env.MAX_UPLOAD_SIZE_MB * 1024 * 1024;
  const sessionStore = options.sessionStore ?? createPrismaSessionStore(database);
  ensureStorageDirectories(uploadDirectory);
  const passport = createPassport(database);

  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(sourceDirectory, 'views'));
  app.locals.currentYear = new Date().getFullYear();
  app.locals.maxUploadSizeMb = maxUploadSizeBytes / (1024 * 1024);
  app.locals.sessionStore = sessionStore;

  if (env.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          formAction: ["'self'"],
        },
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(express.json({ limit: '32kb' }));
  app.use(express.static(path.join(projectRoot, 'public')));
  app.use(createSessionMiddleware(sessionStore));
  app.use(passport.initialize());
  app.use(passport.session());
  app.use((request, response, next) => {
    response.locals.csrfToken = (overwrite = false) => generateCsrfToken(request, overwrite);
    next();
  });
  app.use(loadCurrentUser);
  app.use('/auth', createAuthRouter({ database, passport }));
  app.use('/folders', createFolderRouter({ database, storageDirectory: uploadDirectory }));
  app.use(
    '/uploads',
    createUploadRouter({
      database,
      maxFileSizeBytes: maxUploadSizeBytes,
      storageDirectory: uploadDirectory,
    }),
  );
  app.use('/files', createFileRouter({ database, storageDirectory: uploadDirectory }));
  app.use('/shares', createShareRouter({ database }));
  app.use('/share', createPublicShareRouter({ database, storageDirectory: uploadDirectory }));

  app.get('/', (request, response) => {
    response.render('home', { title: 'File Uploader' });
  });

  app.get('/health', (request, response) => {
    response.json({ status: 'ok' });
  });

  app.use((_request, response) => {
    response.status(404).render('error', {
      title: 'Page not found',
      status: 404,
      message: 'The requested page does not exist.',
    });
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const status = getErrorStatus(error);
    const isClientError = status >= 400 && status < 500;
    const message =
      isClientError && error instanceof Error
        ? error.message
        : 'The server could not complete that request.';

    if (!isClientError) {
      console.error(error);
    }

    response.status(status).render('error', {
      title: status === 403 ? 'Request blocked' : 'Something went wrong',
      status,
      message,
    });
  };

  app.use(errorHandler);

  return app;
}
