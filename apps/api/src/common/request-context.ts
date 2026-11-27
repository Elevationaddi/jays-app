import type { Request } from 'express';

export interface RequestMeta {
  requestId: string | null;
  ip: string;
  userAgent: string | null;
}

export function requestMeta(req: Request & { id?: unknown }): RequestMeta {
  const agent = req.headers['user-agent'];
  return {
    requestId: req.id === undefined ? null : String(req.id),
    ip: req.ip ?? req.socket.remoteAddress ?? 'unknown',
    userAgent: typeof agent === 'string' ? agent.slice(0, 512) : null,
  };
}
