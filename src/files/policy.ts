import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromFile } from 'file-type';
import { env } from '../config/env.js';

const allowedMimeTypes = new Set(
  env.ALLOWED_MIME_TYPES.split(',')
    .map((mimeType) => mimeType.trim().toLowerCase())
    .filter(Boolean),
);

const extensionMimeTypes: Readonly<Record<string, ReadonlySet<string>>> = {
  '.7z': new Set(['application/x-7z-compressed']),
  '.aac': new Set(['audio/aac']),
  '.avi': new Set(['video/x-msvideo']),
  '.avif': new Set(['image/avif']),
  '.bmp': new Set(['image/bmp']),
  '.csv': new Set(['text/plain']),
  '.docx': new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  '.flac': new Set(['audio/flac']),
  '.gif': new Set(['image/gif']),
  '.gz': new Set(['application/gzip']),
  '.heic': new Set(['image/heic']),
  '.heif': new Set(['image/heif']),
  '.jpeg': new Set(['image/jpeg']),
  '.jpg': new Set(['image/jpeg']),
  '.json': new Set(['text/plain']),
  '.log': new Set(['text/plain']),
  '.m4a': new Set(['audio/mp4']),
  '.markdown': new Set(['text/plain']),
  '.md': new Set(['text/plain']),
  '.mkv': new Set(['video/x-matroska']),
  '.mov': new Set(['video/quicktime']),
  '.mp3': new Set(['audio/mpeg']),
  '.mp4': new Set(['video/mp4', 'audio/mp4']),
  '.mpg4': new Set(['video/mp4', 'audio/mp4']),
  '.ods': new Set(['application/vnd.oasis.opendocument.spreadsheet']),
  '.odt': new Set(['application/vnd.oasis.opendocument.text']),
  '.odp': new Set(['application/vnd.oasis.opendocument.presentation']),
  '.ogg': new Set(['audio/ogg', 'application/ogg']),
  '.pdf': new Set(['application/pdf']),
  '.png': new Set(['image/png']),
  '.pptx': new Set(['application/vnd.openxmlformats-officedocument.presentationml.presentation']),
  '.rar': new Set(['application/vnd.rar']),
  '.rtf': new Set(['application/rtf']),
  '.tar': new Set(['application/x-tar']),
  '.tgz': new Set(['application/gzip']),
  '.tif': new Set(['image/tiff']),
  '.tiff': new Set(['image/tiff']),
  '.txt': new Set(['text/plain']),
  '.wav': new Set(['audio/wav', 'audio/x-wav']),
  '.webm': new Set(['video/webm', 'audio/webm']),
  '.webp': new Set(['image/webp']),
  '.xlsx': new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  '.yaml': new Set(['text/plain']),
  '.yml': new Set(['text/plain']),
  '.zip': new Set(['application/zip']),
};

export type FileValidationReason = 'empty' | 'extension' | 'mismatch' | 'unsupported';

export class FileValidationError extends Error {
  constructor(
    readonly reason: FileValidationReason,
    message: string,
  ) {
    super(message);
    this.name = 'FileValidationError';
  }
}

async function isSafeTextFile(filePath: string) {
  const handle = await open(filePath, 'r');

  try {
    const sample = Buffer.alloc(8_192);
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
    const buffer = sample.subarray(0, bytesRead);

    if (buffer.includes(0)) {
      return false;
    }

    const text = new TextDecoder('utf-8', { fatal: true })
      .decode(buffer)
      .replace(/^\uFEFF/, '')
      .trimStart();
    return !/^<(?:!doctype\s+html|html|svg|script|xml|\?xml)/i.test(text);
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}

export async function validateUploadedFile(filePath: string, originalName: string) {
  const fileStats = await stat(filePath);
  if (fileStats.size === 0) {
    throw new FileValidationError('empty', 'Empty files cannot be uploaded.');
  }

  const extension = path.extname(originalName).toLowerCase();
  const extensionTypes = extensionMimeTypes[extension];

  if (!extensionTypes) {
    throw new FileValidationError('extension', 'This file extension is not allowed.');
  }

  let detectedType: Awaited<ReturnType<typeof fileTypeFromFile>>;

  try {
    detectedType = await fileTypeFromFile(filePath);
  } catch {
    throw new FileValidationError('unsupported', 'The file contents could not be verified.');
  }

  if (detectedType) {
    if (!allowedMimeTypes.has(detectedType.mime)) {
      throw new FileValidationError('unsupported', 'This file type is not allowed.');
    }

    if (!extensionTypes.has(detectedType.mime)) {
      throw new FileValidationError(
        'mismatch',
        'The file contents do not match the file extension.',
      );
    }

    return detectedType.mime;
  }

  if (extensionTypes.has('text/plain') && allowedMimeTypes.has('text/plain')) {
    if (await isSafeTextFile(filePath)) {
      return 'text/plain';
    }

    throw new FileValidationError('unsupported', 'This text file is not allowed.');
  }

  throw new FileValidationError('unsupported', 'The file contents could not be verified.');
}
