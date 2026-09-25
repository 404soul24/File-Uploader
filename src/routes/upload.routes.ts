import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import multer from 'multer';
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { csrfSynchronisedProtection } from '../auth/csrf.js';
import { getAuthenticatedUserId, requireAuthentication } from '../auth/middleware.js';
import { buildStorageKey, moveTemporaryFile, removeFile } from '../files/storage.js';
import { createUploadMiddleware } from '../files/upload.js';
import { FolderNotFoundError, getOwnedFolder } from '../folders/service.js';
import { folderIdSchema } from '../folders/validation.js';

interface UploadRouterOptions {
  database: PrismaClient;
  maxFileSizeBytes: number;
  storageDirectory: string;
}

const originalNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (name) =>
      [...name].every((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code >= 32 && code !== 127;
      }),
    { message: 'The uploaded file name contains unsupported characters.' },
  );

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).render('error', {
      title: 'Upload limit reached',
      status: 429,
      message: 'Wait before uploading more files.',
    });
  },
});

async function cleanTemporaryFiles(request: Request) {
  if (request.file) {
    await removeFile(request.file.path).catch(() => undefined);
  }
}

function withUploadCleanup(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    void (async () => {
      try {
        await handler(request, response, next);
      } catch (error) {
        next(error);
      } finally {
        await cleanTemporaryFiles(request);
      }
    })();
  };
}

function parseFolderId(value: unknown) {
  const parsed = folderIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function createUploadRouter({
  database,
  maxFileSizeBytes,
  storageDirectory,
}: UploadRouterOptions) {
  const router = Router();
  const upload = createUploadMiddleware({ maxFileSizeBytes, storageDirectory });

  router.use(requireAuthentication);

  const handleUpload = async (request: Request, response: Response, folderId: string | null) => {
    const uploadedFile = request.file;

    if (!uploadedFile) {
      response.status(400).render('error', {
        title: 'No file selected',
        status: 400,
        message: 'Choose a file before uploading.',
      });
      return;
    }

    const parsedName = originalNameSchema.safeParse(uploadedFile.originalname);
    if (!parsedName.success) {
      response.status(400).render('error', {
        title: 'Invalid file name',
        status: 400,
        message: parsedName.error.issues[0]?.message ?? 'The uploaded file name is invalid.',
      });
      return;
    }

    const ownerId = getAuthenticatedUserId(request);
    if (folderId) {
      await getOwnedFolder(database, ownerId, folderId);
    }

    const fileId = randomUUID();
    const storageKey = buildStorageKey(ownerId, folderId, fileId);
    const destinationPath = await moveTemporaryFile(
      storageDirectory,
      uploadedFile.path,
      storageKey,
    );

    try {
      await database.file.create({
        data: {
          id: fileId,
          originalName: parsedName.data,
          storageKey,
          downloadUrl: `/files/${encodeURIComponent(fileId)}/download`,
          mimeType: uploadedFile.mimetype.toLowerCase().slice(0, 255) || 'application/octet-stream',
          byteSize: BigInt(uploadedFile.size),
          ownerId,
          folderId,
        },
      });
    } catch (error) {
      await removeFile(destinationPath);
      throw error;
    }

    response.redirect(303, folderId ? `/folders/${encodeURIComponent(folderId)}` : '/folders');
  };

  router.post(
    '/',
    uploadLimiter,
    upload.single('file'),
    csrfSynchronisedProtection,
    withUploadCleanup((request, response) => handleUpload(request, response, null)),
  );

  router.post(
    '/folders/:folderId',
    uploadLimiter,
    upload.single('file'),
    csrfSynchronisedProtection,
    withUploadCleanup((request, response) => {
      const folderId = parseFolderId(request.params.folderId);
      if (!folderId) {
        response.status(404).render('error', {
          title: 'Folder not found',
          status: 404,
          message: 'The folder does not exist or is not available to your account.',
        });
        return Promise.resolve();
      }

      return handleUpload(request, response, folderId);
    }),
  );

  router.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
    void cleanTemporaryFiles(request)
      .then(() => {
        if (error instanceof multer.MulterError) {
          const isTooLarge = error.code === 'LIMIT_FILE_SIZE';
          response.status(isTooLarge ? 413 : 400).render('error', {
            title: isTooLarge ? 'File is too large' : 'Upload rejected',
            status: isTooLarge ? 413 : 400,
            message: isTooLarge
              ? `The file exceeds the ${Math.round(maxFileSizeBytes / (1024 * 1024))} MB upload limit.`
              : 'The upload could not be processed. Choose one file and try again.',
          });
          return;
        }

        if (error instanceof FolderNotFoundError) {
          response.status(404).render('error', {
            title: 'Folder not found',
            status: 404,
            message: 'The folder does not exist or is not available to your account.',
          });
          return;
        }

        next(error);
      })
      .catch(next);
  });

  return router;
}
