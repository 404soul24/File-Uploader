import { createApp } from './app.js';
import { env } from './config/env.js';

const server = createApp().listen(env.PORT, () => {
  console.log(`File Uploader listening at ${env.APP_URL}`);
});

function shutdown(signal: NodeJS.Signals) {
  console.log(`${signal} received, closing the server.`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
