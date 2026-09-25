import type { PrismaClient } from '@prisma/client';
import { Router, type Response } from 'express';
import { getAuthenticatedUserId, requireAuthentication } from '../auth/middleware.js';
import { formatBytes } from '../files/format.js';
import { FileNotFoundError, getOwnedFile } from '../files/service.js';
import {
  getStoredFileStats,
  InvalidStorageKeyError,
  resolveStoragePath,
  StoredFileMissingError,
} from '../files/storage.js';
import { fileIdSchema } from '../files/validation.js';
import { getFolderBreadcrumbs, getOwnedFolder } from '../folders/service.js';

interface FileRouterOptions {
  database: PrismaClient;
  storageDirectory: string;
}

function parseFileId(value: unknown) {
  const parsed = fileIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function renderFileError(response: Response, error: unknown) {
  if (error instanceof FileNotFoundError) {
    response.status(404).render('error', {
      title: 'File not found',
      status: 404,
      message: 'The file does not exist or is not available to your account.',
    });
    return true;
  }

  if (error instanceof InvalidStorageKeyError || error instanceof StoredFileMissingError) {
    response.status(404).render('error', {
      title: 'File unavailable',
      status: 404,
      message: 'The stored file is no longer available for download.',
    });
    return true;
  }

  return false;
}

function sendDownload(response: Response, filePath: string, originalName: string) {
  return new Promise<void>((resolve, reject) => {
    response.download(
      filePath,
      originalName,
      {
        dotfiles: 'deny',
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      },
      (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      },
    );
  });
}

export function createFileRouter({ database, storageDirectory }: FileRouterOptions) {
  const router = Router();

  router.use(requireAuthentication);

  router.get('/:fileId', async (request, response) => {
    const fileId = parseFileId(request.params.fileId);
    if (!fileId) {
      response.status(404).render('error', {
        title: 'File not found',
        status: 404,
        message: 'The file does not exist or is not available to your account.',
      });
      return;
    }

    try {
      const ownerId = getAuthenticatedUserId(request);
      const file = await getOwnedFile(database, ownerId, fileId);
      const folder = file.folderId ? await getOwnedFolder(database, ownerId, file.folderId) : null;
      const breadcrumbs = folder ? await getFolderBreadcrumbs(database, ownerId, folder) : [];

      response.render('files/details', {
        title: file.originalName,
        file,
        folder,
        breadcrumbs,
        sizeLabel: formatBytes(file.byteSize),
      });
    } catch (error) {
      if (!renderFileError(response, error)) {
        throw error;
      }
    }
  });

  router.get('/:fileId/download', async (request, response) => {
    const fileId = parseFileId(request.params.fileId);
    if (!fileId) {
      response.status(404).render('error', {
        title: 'File not found',
        status: 404,
        message: 'The file does not exist or is not available to your account.',
      });
      return;
    }

    try {
      const file = await getOwnedFile(database, getAuthenticatedUserId(request), fileId);
      await getStoredFileStats(storageDirectory, file.storageKey);
      await sendDownload(
        response,
        resolveStoragePath(storageDirectory, file.storageKey),
        file.originalName,
      );
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }

      if (!renderFileError(response, error)) {
        throw error;
      }
    }
  });

  return router;
}
