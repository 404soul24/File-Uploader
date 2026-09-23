import type { NextFunction, Request, RequestHandler, Response } from 'express';

export function loadCurrentUser(request: Request, response: Response, next: NextFunction) {
  if (request.isAuthenticated() && typeof request.user === 'object' && request.user !== null) {
    const user = request.user as { id: string; email: string };
    response.locals.currentUser = { id: user.id, email: user.email };
  } else {
    response.locals.currentUser = null;
  }

  next();
}

export const requireAuthentication: RequestHandler = (request, response, next) => {
  if (!request.isAuthenticated()) {
    response.redirect(303, '/auth/login');
    return;
  }

  next();
};

export const requireGuest: RequestHandler = (request, response, next) => {
  if (request.isAuthenticated()) {
    response.redirect(303, '/');
    return;
  }

  next();
};
