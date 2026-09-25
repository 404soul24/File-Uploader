import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { ensureStorageDirectories, getTemporaryUploadDirectory } from './storage.js';

interface UploadMiddlewareOptions {
  maxFileSizeBytes: number;
  storageDirectory: string;
}

export function createUploadMiddleware({
  maxFileSizeBytes,
  storageDirectory,
}: UploadMiddlewareOptions) {
  ensureStorageDirectories(storageDirectory);

  return multer({
    dest: getTemporaryUploadDirectory(storageDirectory),
    limits: {
      fieldNameSize: 100,
      fields: 3,
      fieldSize: 2_048,
      fileSize: maxFileSizeBytes,
      files: 1,
      parts: 4,
    },
    storage: multer.diskStorage({
      destination: (_request, _file, done) => {
        try {
          ensureStorageDirectories(storageDirectory);
          done(null, getTemporaryUploadDirectory(storageDirectory));
        } catch (error) {
          done(error as Error, '');
        }
      },
      filename: (_request, _file, done) => {
        done(null, `${randomUUID()}.upload`);
      },
    }),
  });
}
