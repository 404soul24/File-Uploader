import { createApp } from './app.js';
import { prisma } from './config/database.js';
import { env } from './config/env.js';

const app = createApp();
const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`File Uploader listening at ${env.APP_URL}`);
});
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`${signal} received, closing the server.`);
  const sessionStore = app.locals.sessionStore as { stopInterval?: () => void };
  sessionStore.stopInterval?.();

  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }

    void prisma.$disconnect().catch((disconnectError: unknown) => {
      console.error(disconnectError);
      process.exitCode = 1;
    });
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
