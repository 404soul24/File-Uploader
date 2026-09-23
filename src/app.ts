import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(sourceDirectory, '..');

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(sourceDirectory, 'views'));
  app.locals.currentYear = new Date().getFullYear();

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

  app.get('/', (request, response) => {
    response.render('home', { title: 'File Uploader' });
  });

  app.get('/health', (request, response) => {
    response.json({ status: 'ok' });
  });

  app.use((request, response) => {
    response.status(404).render('error', {
      title: 'Page not found',
      status: 404,
      message: 'The requested page does not exist.',
    });
  });

  const errorHandler: ErrorRequestHandler = (error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    console.error(error);
    response.status(500).render('error', {
      title: 'Something went wrong',
      status: 500,
      message: 'The server could not complete that request.',
    });
  };

  app.use(errorHandler);

  return app;
}
