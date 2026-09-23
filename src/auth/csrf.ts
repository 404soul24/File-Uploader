import type { Request } from 'express';
import { csrfSync } from 'csrf-sync';

const headerToken = (request: Request) => {
  const token = request.headers['x-csrf-token'];
  return Array.isArray(token) ? token[0] : token;
};

export const {
  csrfSynchronisedProtection,
  generateToken: generateCsrfToken,
  revokeToken: revokeCsrfToken,
} = csrfSync({
  getTokenFromRequest: (request) => {
    const body = request.body as Record<string, unknown> | undefined;
    return typeof body?._csrf === 'string' ? body._csrf : headerToken(request);
  },
  errorConfig: {
    statusCode: 403,
    message: 'The security token is missing or invalid.',
    code: 'EBADCSRFTOKEN',
  },
});
