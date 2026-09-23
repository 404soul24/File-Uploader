import type { Request, Response } from 'express';

export async function establishAuthenticatedSession(
  request: Request,
  user: Express.User,
  generateCsrfToken: (request: Request, overwrite?: boolean) => string,
) {
  await new Promise<void>((resolve, reject) => {
    request.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  await new Promise<void>((resolve, reject) => {
    request.logIn(user, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  generateCsrfToken(request, true);
}

export async function destroyAuthenticatedSession(request: Request, response: Response) {
  await new Promise<void>((resolve, reject) => {
    request.logOut((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  await new Promise<void>((resolve, reject) => {
    request.session.destroy((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  response.locals.currentUser = null;
}
