import type { PrismaClient } from '@prisma/client';
import { Router, type Response } from 'express';
import { csrfSynchronisedProtection } from '../auth/csrf.js';
import { getAuthenticatedUserId, requireAuthentication } from '../auth/middleware.js';
import { removeStoredFiles } from '../files/storage.js';
import { formatBytes } from '../files/format.js';
import { listFolderFiles } from '../files/service.js';
import {
  createFolder,
  deleteFolderRecursively,
  FolderHierarchyError,
  FolderNameConflictError,
  FolderNotFoundError,
  getFolderBreadcrumbs,
  getFolderDeletePreview,
  getOwnedFolder,
  listChildFolders,
  renameFolder,
} from '../folders/service.js';
import { createFolderSchema, folderIdSchema, renameFolderSchema } from '../folders/validation.js';

interface FolderRouterOptions {
  database: PrismaClient;
  storageDirectory: string;
}

function renderFolderError(response: Response, error: unknown) {
  if (error instanceof FolderNotFoundError) {
    response.status(404).render('error', {
      title: 'Folder not found',
      status: 404,
      message: 'The folder does not exist or is not available to your account.',
    });
    return true;
  }

  if (error instanceof FolderNameConflictError) {
    response.status(409).render('error', {
      title: 'Folder name unavailable',
      status: 409,
      message: error.message,
    });
    return true;
  }

  if (error instanceof FolderHierarchyError) {
    response.status(409).render('error', {
      title: 'Folder cannot be changed',
      status: 409,
      message: error.message,
    });
    return true;
  }

  return false;
}

function parseFolderId(value: unknown) {
  const parsed = folderIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function createFolderRouter({ database, storageDirectory }: FolderRouterOptions) {
  const router = Router();

  router.use(requireAuthentication);

  const renderBrowsePage = async (response: Response, ownerId: string, folderId: string | null) => {
    const folder = folderId ? await getOwnedFolder(database, ownerId, folderId) : null;
    const breadcrumbs = folder ? await getFolderBreadcrumbs(database, ownerId, folder) : [];
    const childFolders = await listChildFolders(database, ownerId, folder?.id ?? null);
    const files = (await listFolderFiles(database, ownerId, folder?.id ?? null)).map((file) => ({
      ...file,
      sizeLabel: formatBytes(file.byteSize),
    }));

    response.render('folders/browse', {
      title: folder ? folder.name : 'Your folders',
      folder,
      breadcrumbs,
      childFolders,
      files,
    });
  };

  router.get('/', async (request, response) => {
    await renderBrowsePage(response, getAuthenticatedUserId(request), null);
  });

  router.post('/', csrfSynchronisedProtection, async (request, response) => {
    const parsed = createFolderSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).render('error', {
        title: 'Invalid folder name',
        status: 400,
        message: parsed.error.issues[0]?.message ?? 'Enter a valid folder name.',
      });
      return;
    }

    try {
      const folder = await createFolder(
        database,
        getAuthenticatedUserId(request),
        parsed.data.name,
        parsed.data.parentId,
      );
      response.redirect(303, `/folders/${encodeURIComponent(folder.id)}`);
    } catch (error) {
      if (!renderFolderError(response, error)) {
        throw error;
      }
    }
  });

  router.get('/:folderId', async (request, response) => {
    const folderId = parseFolderId(request.params.folderId);
    if (!folderId) {
      response.status(404).render('error', {
        title: 'Folder not found',
        status: 404,
        message: 'The folder does not exist or is not available to your account.',
      });
      return;
    }

    try {
      await renderBrowsePage(response, getAuthenticatedUserId(request), folderId);
    } catch (error) {
      if (!renderFolderError(response, error)) {
        throw error;
      }
    }
  });

  router.post('/:folderId/rename', csrfSynchronisedProtection, async (request, response) => {
    const folderId = parseFolderId(request.params.folderId);
    const parsed = renameFolderSchema.safeParse(request.body);

    if (!folderId) {
      response.status(404).render('error', {
        title: 'Folder not found',
        status: 404,
        message: 'The folder does not exist or is not available to your account.',
      });
      return;
    }

    if (!parsed.success) {
      response.status(400).render('error', {
        title: 'Folder cannot be renamed',
        status: 400,
        message: parsed.error.issues[0]?.message ?? 'Enter a valid folder name.',
      });
      return;
    }

    try {
      await renameFolder(database, getAuthenticatedUserId(request), folderId, parsed.data.name);
      response.redirect(303, `/folders/${encodeURIComponent(folderId)}`);
    } catch (error) {
      if (!renderFolderError(response, error)) {
        throw error;
      }
    }
  });

  router.get('/:folderId/delete', async (request, response) => {
    const folderId = parseFolderId(request.params.folderId);
    if (!folderId) {
      response.status(404).render('error', {
        title: 'Folder not found',
        status: 404,
        message: 'The folder does not exist or is not available to your account.',
      });
      return;
    }

    try {
      const preview = await getFolderDeletePreview(
        database,
        getAuthenticatedUserId(request),
        folderId,
      );
      response.render('folders/confirm-delete', {
        title: `Delete ${preview.folder.name}`,
        folder: preview.folder,
        descendantCount: preview.descendantCount,
      });
    } catch (error) {
      if (!renderFolderError(response, error)) {
        throw error;
      }
    }
  });

  router.post('/:folderId/delete', csrfSynchronisedProtection, async (request, response) => {
    const folderId = parseFolderId(request.params.folderId);
    if (!folderId) {
      response.status(404).render('error', {
        title: 'Folder not found',
        status: 404,
        message: 'The folder does not exist or is not available to your account.',
      });
      return;
    }

    try {
      const result = await deleteFolderRecursively(
        database,
        getAuthenticatedUserId(request),
        folderId,
      );
      const removal = await removeStoredFiles(storageDirectory, result.storageKeys);

      if (removal.failedKeys.length > 0) {
        console.error('Storage cleanup failed for deleted folders.', removal.failedKeys);
      }

      response.redirect(303, '/folders');
    } catch (error) {
      if (!renderFolderError(response, error)) {
        throw error;
      }
    }
  });

  return router;
}
