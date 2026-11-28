import type { IncomingMessage, ServerResponse } from 'node:http';
import { apiEnvSchema, parseEnv } from '@jays/config';
import type { INestApplication } from '@nestjs/common';
import { createApp } from './bootstrap.js';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * The API as one Vercel function (ADR-0033). The Nest application is created once per function
 * instance and reused across requests (Fluid compute). Configuration is validated on the first
 * request, exactly as in `main.ts`; if start-up fails, the next request tries again rather than
 * serving from a half-built app.
 */
export function createVercelHandler(source: NodeJS.ProcessEnv = process.env) {
  let ready: Promise<Handler> | undefined;
  let app: INestApplication | undefined;
  const build = async (): Promise<Handler> => {
    const env = parseEnv(apiEnvSchema, source);
    app = await createApp({ env });
    await app.init();
    return app.getHttpAdapter().getInstance() as Handler;
  };
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    ready ??= build().catch((error: unknown) => {
      ready = undefined;
      // Names and messages only: configuration errors list variable names, never their values.
      console.error('api start-up failed:', error instanceof Error ? error.message : 'unknown');
      throw error;
    });
    let handle: Handler;
    try {
      handle = await ready;
    } catch {
      // Never echo configuration errors to a client; they are in the function logs.
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Please try again shortly.' },
        }),
      );
      return;
    }
    handle(req, res);
  };
  /** Closes the application (tests; Vercel freezes and discards instances itself). */
  const close = async () => {
    await app?.close();
    app = undefined;
    ready = undefined;
  };
  return Object.assign(handler, { close });
}

export default createVercelHandler();
