import type { PrismaClient } from '@prisma/client';
import { Router, type Response } from 'express';
import { sendFileDownload } from '../files/download.js';
import { formatBytes } from '../files/format.js';
import { listFolderFiles } from '../files/service.js';
import { getStoredFileStats, resolveStoragePath } from '../files/storage.js';
import { listChildFolders } from '../folders/service.js';
import { getSharedFile, getSharedFolderContext, ShareNotFoundError } from '../shares/service.js';
import { fileIdSchema, folderIdSchema, shareTokenSchema } from '../shares/validation.js';

interface PublicShareRouterOptions {
  database: PrismaClient;
  storageDirectory: string;
}

function renderShareNotFound(response: Response) {
  response.status(404).render('shares/unavailable', {
    title: 'Share unavailable',
  });
}

function parseToken(value: unknown) {
  const parsed = shareTokenSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function createPublicShareRouter({ database, storageDirectory }: PublicShareRouterOptions) {
  const router = Router();

  router.use((_request, response, next) => {
    response.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    });
    next();
  });

  const renderFolder = async (response: Response, token: string, folderId: string | null) => {
    const context = await getSharedFolderContext(database, token, folderId);
    const ownerId = context.share.folder.ownerId;
    const childFolders = await listChildFolders(database, ownerId, context.folder.id);
    const files = (await listFolderFiles(database, ownerId, context.folder.id)).map((file) => ({
      ...file,
      sizeLabel: formatBytes(file.byteSize),
    }));

    response.render('shares/browse', {
      title: context.folder.name,
      token,
      share: context.share,
      folder: context.folder,
      breadcrumbs: context.breadcrumbs,
      childFolders,
      files,
    });
  };

  router.get('/:token', async (request, response) => {
    const token = parseToken(request.params.token);
    if (!token) {
      renderShareNotFound(response);
      return;
    }

    try {
      await renderFolder(response, token, null);
    } catch (error) {
      if (error instanceof ShareNotFoundError) {
        renderShareNotFound(response);
        return;
      }

      throw error;
    }
  });

  router.get('/:token/folders/:folderId', async (request, response) => {
    const token = parseToken(request.params.token);
    const parsedFolderId = folderIdSchema.safeParse(request.params.folderId);
    if (!token || !parsedFolderId.success) {
      renderShareNotFound(response);
      return;
    }

    try {
      await renderFolder(response, token, parsedFolderId.data);
    } catch (error) {
      if (error instanceof ShareNotFoundError) {
        renderShareNotFound(response);
        return;
      }

      throw error;
    }
  });

  router.get('/:token/files/:fileId/download', async (request, response) => {
    const token = parseToken(request.params.token);
    const parsedFileId = fileIdSchema.safeParse(request.params.fileId);
    if (!token || !parsedFileId.success) {
      renderShareNotFound(response);
      return;
    }

    try {
      const { file } = await getSharedFile(database, token, parsedFileId.data);
      await getStoredFileStats(storageDirectory, file.storageKey);
      await sendFileDownload(
        response,
        resolveStoragePath(storageDirectory, file.storageKey),
        file.originalName,
      );
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }

      if (error instanceof ShareNotFoundError) {
        renderShareNotFound(response);
        return;
      }

      throw error;
    }
  });

  return router;
}
