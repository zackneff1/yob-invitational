import compression from 'compression';
import express from 'express';
import fs from 'fs';
import helmet from 'helmet';
import path from 'path';
import pinoHttp from 'pino-http';
import { logger } from './logger';
import { apiNotFound, errorHandler } from './middleware/error';
import { apiRouter } from './routes';

export function createApp(): express.Express {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          // Vite injects hashed asset URLs; keep defaults strict otherwise.
          'script-src': ["'self'"],
          'connect-src': ["'self'"],
        },
      },
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );

  app.use('/api', apiRouter);
  app.use('/api', apiNotFound);

  // Serve the built client with an SPA fallback.
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(
      express.static(clientDist, {
        setHeaders(res, filePath) {
          // Hashed assets are immutable; index.html and sw.js must revalidate.
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    app.get('*', (req, res) => {
      // A request for something with a file extension that express.static
      // didn't find is genuinely missing — usually a stale build's hashed
      // asset. It must 404. Answering with index.html gives a 200 of
      // text/html, which the browser then refuses to use as a stylesheet or
      // script (silently, so the page just renders unstyled) and which a
      // service worker will happily cache under that URL forever.
      if (path.extname(req.path)) {
        res.status(404).type('text/plain').send('Not found');
        return;
      }
      // Real SPA route — hand over the app shell.
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } else {
    logger.warn({ clientDist }, 'client build not found — API-only mode (run `npm run build`)');
  }

  app.use(errorHandler);
  return app;
}
