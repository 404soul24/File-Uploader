import type { PrismaClient } from '@prisma/client';
import { Router, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { csrfSynchronisedProtection } from '../auth/csrf.js';
import { getAuthenticatedUserId, requireAuthentication } from '../auth/middleware.js';
import { env } from '../config/env.js';
import { FolderNotFoundError } from '../folders/service.js';
import { createFolderShare, listFolderShares, revokeFolderShare } from '../shares/service.js';
import { createShareSchema, shareIdSchema } from '../shares/validation.js';

const shareLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  handler: (_request, response) => {
    response.status(429).render('error', {
      title: 'Share limit reached',
      status: 429,
      message: 'Wait before creating more share links.',
    });
  },
});

function renderNotFound(response: Response) {
  response.status(404).render('error', {
    title: 'Folder not found',
    status: 404,
    message: 'The folder does not exist or is not available to your account.',
  });
}

export function createShareRouter({ database }: { database: PrismaClient }) {
  const router = Router();

  router.use(requireAuthentication);

  router.get('/', async (request, response) => {
    const shares = await listFolderShares(database, getAuthenticatedUserId(request));
    const now = new Date();

    response.render('shares/manage', {
      title: 'Shared folders',
      shares: shares.map((share) => ({
        ...share,
        isActive: share.revokedAt === null && share.expiresAt > now,
      })),
    });
  });

  router.post('/', shareLimiter, csrfSynchronisedProtection, async (request, response) => {
    const parsed = createShareSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).render('error', {
        title: 'Invalid share',
        status: 400,
        message: parsed.error.issues[0]?.message ?? 'Choose a valid share duration.',
      });
      return;
    }

    try {
      const result = await createFolderShare(
        database,
        getAuthenticatedUserId(request),
        parsed.data.folderId,
        parsed.data.durationDays,
      );
      response.status(201).render('shares/created', {
        title: 'Share link created',
        share: result.share,
        url: result.url,
      });
    } catch (error) {
      if (error instanceof FolderNotFoundError) {
        renderNotFound(response);
        return;
      }

      throw error;
    }
  });

  router.post('/:shareId/revoke', csrfSynchronisedProtection, async (request, response) => {
    const parsed = shareIdSchema.safeParse(request.params.shareId);

    if (!parsed.success) {
      renderNotFound(response);
      return;
    }

    const result = await revokeFolderShare(database, getAuthenticatedUserId(request), parsed.data);

    if (result.count === 0) {
      response.status(404).render('error', {
        title: 'Share not found',
        status: 404,
        message: 'The share link does not exist or is no longer active.',
      });
      return;
    }

    response.redirect(303, '/shares');
  });

  return router;
}
