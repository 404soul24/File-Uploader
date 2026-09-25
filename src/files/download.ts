import type { Response } from 'express';

export function sendFileDownload(response: Response, filePath: string, originalName: string) {
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
