import type { PrismaClient } from '@prisma/client';
import { Router, type Response } from 'express';
import { csrfSynchronisedProtection } from '../auth/csrf.js';
import { getAuthenticatedUserId, requireAuthentication } from '../auth/middleware.js';
import { sendFileDownload } from '../files/download.js';
import { formatBytes } from '../files/format.js';
import { deleteOwnedFile, FileNotFoundError, getOwnedFile } from '../files/service.js';
import {
  getStoredFileStats,
  InvalidStorageKeyError,
  removeStoredFiles,
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

export function createFileRouter({ database, storageDirectory }: FileRouterOptions) {
  const router = Router();

  router.use(requireAuthentication);

  router.get('/:fileId/delete', async (request, response) => {
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
      response.render('files/confirm-delete', {
        title: `Delete ${file.originalName}`,
        file,
      });
    } catch (error) {
      if (!renderFileError(response, error)) {
        throw error;
      }
    }
  });

  router.post('/:fileId/delete', csrfSynchronisedProtection, async (request, response) => {
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
      const file = await deleteOwnedFile(database, getAuthenticatedUserId(request), fileId);
      const removal = await removeStoredFiles(storageDirectory, [file.storageKey]);

      if (removal.failedKeys.length > 0) {
        console.error('Storage cleanup failed for deleted file records.', removal.failedKeys);
      }

      response.redirect(
        303,
        file.folderId ? `/folders/${encodeURIComponent(file.folderId)}` : '/folders',
      );
    } catch (error) {
      if (!renderFileError(response, error)) {
        throw error;
      }
    }
  });

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

      if (!renderFileError(response, error)) {
        throw error;
      }
    }
  });

  return router;
}
