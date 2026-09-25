import { Prisma, type PrismaClient } from '@prisma/client';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createPassport } from '../auth/passport.js';
import { env } from '../config/env.js';
import { csrfSynchronisedProtection, generateCsrfToken } from '../auth/csrf.js';
import { requireAuthentication, requireGuest } from '../auth/middleware.js';
import { registerUser } from '../auth/service.js';
import {
  destroyAuthenticatedSession,
  establishAuthenticatedSession,
} from '../auth/session-actions.js';
import { sessionCookieClearOptions, sessionCookieName } from '../auth/session.js';
import { getFieldErrors, loginSchema, registerSchema } from '../auth/validation.js';

interface AuthRouterOptions {
  database: PrismaClient;
  passport: ReturnType<typeof createPassport>;
}

const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  handler: (_request, response) => {
    response.status(429).render('error', {
      title: 'Too many attempts',
      status: 429,
      message: 'Wait before trying to create another account.',
    });
  },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  handler: (_request, response) => {
    response.status(429).render('error', {
      title: 'Too many attempts',
      status: 429,
      message: 'Wait before trying to sign in again.',
    });
  },
});

function renderRegister(
  response: Response,
  values: { email: string; password: string; confirmPassword: string } = {
    email: '',
    password: '',
    confirmPassword: '',
  },
  fieldErrors: Record<string, string> = {},
  formError: string | null = null,
  status = 200,
) {
  response.status(status).render('auth/register', {
    title: 'Create account',
    values,
    fieldErrors,
    formError,
  });
}

function renderLogin(
  response: Response,
  values: { email: string; password: string } = { email: '', password: '' },
  fieldErrors: Record<string, string> = {},
  formError: string | null = null,
  status = 200,
) {
  response.status(status).render('auth/login', {
    title: 'Sign in',
    values,
    fieldErrors,
    formError,
  });
}

export function createAuthRouter({ database, passport }: AuthRouterOptions) {
  const router = Router();

  router.get('/register', requireGuest, (_request, response) => {
    renderRegister(response);
  });

  router.post(
    '/register',
    registrationLimiter,
    csrfSynchronisedProtection,
    requireGuest,
    async (request: Request, response: Response) => {
      const parsed = registerSchema.safeParse(request.body);

      if (!parsed.success) {
        const values = request.body as {
          email?: string;
          password?: string;
          confirmPassword?: string;
        };
        renderRegister(
          response,
          {
            email: values.email ?? '',
            password: '',
            confirmPassword: '',
          },
          getFieldErrors(parsed.error),
          null,
          400,
        );
        return;
      }

      try {
        const user = await registerUser(database, parsed.data);
        await establishAuthenticatedSession(request, user, generateCsrfToken);
        response.redirect(303, '/');
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          renderRegister(
            response,
            {
              email: parsed.data.email,
              password: '',
              confirmPassword: '',
            },
            { email: 'An account with this email already exists.' },
            null,
            409,
          );
          return;
        }

        throw error;
      }
    },
  );

  router.get('/login', requireGuest, (request, response) => {
    const invalidCredentials = request.query.error === 'invalid';
    renderLogin(
      response,
      { email: '', password: '' },
      {},
      invalidCredentials ? 'The email or password is incorrect.' : null,
    );
  });

  const validateLogin: RequestHandler = (request, response, next) => {
    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      const values = request.body as { email?: string; password?: string };
      renderLogin(
        response,
        { email: values.email ?? '', password: '' },
        getFieldErrors(parsed.error),
        null,
        400,
      );
      return;
    }

    next();
  };

  router.post(
    '/login',
    loginLimiter,
    csrfSynchronisedProtection,
    requireGuest,
    validateLogin,
    (request, response, next) => {
      passport.authenticate(
        'local',
        (error: unknown, user: Express.User | false | null | undefined) => {
          if (error) {
            next(error);
            return;
          }

          if (!user) {
            response.redirect(303, '/auth/login?error=invalid');
            return;
          }

          void establishAuthenticatedSession(request, user, generateCsrfToken)
            .then(() => response.redirect(303, '/'))
            .catch(next);
        },
      )(request, response, next);
    },
  );

  router.post(
    '/logout',
    requireAuthentication,
    csrfSynchronisedProtection,
    async (request, response) => {
      await destroyAuthenticatedSession(request, response);
      response.clearCookie(sessionCookieName, sessionCookieClearOptions);
      response.redirect(303, '/auth/login');
    },
  );

  return router;
}
