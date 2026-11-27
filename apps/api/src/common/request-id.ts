import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { REQUEST_ID_HEADER } from '@jays/contracts';

// Accept a caller-supplied id only if it is short and plain, so it is safe to log and echo.
const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function resolveRequestId(req: IncomingMessage): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  return value && SAFE_ID.test(value) ? value : randomUUID();
}
