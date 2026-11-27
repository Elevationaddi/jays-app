import { Controller, Get, HttpStatus, Inject, Param, Put, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { LocalObjectStorage } from './local-storage.js';
import { OBJECT_STORAGE, type ObjectStorage } from './storage.js';

const denied = () =>
  new ApiError(HttpStatus.FORBIDDEN, 'SIGNATURE_INVALID', 'This link is not valid or has expired.');

/** Reads a request body up to `max` bytes; larger bodies are refused before they are buffered. */
async function readBody(req: Request, max: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 'NaN');
  if (Number.isFinite(declared) && declared > max) {
    throw new ApiError(HttpStatus.PAYLOAD_TOO_LARGE, 'FILE_TOO_LARGE', 'The file is too large.');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) {
      throw new ApiError(HttpStatus.PAYLOAD_TOO_LARGE, 'FILE_TOO_LARGE', 'The file is too large.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Serves signed URLs for the local storage adapter only (a real provider serves its own URLs).
 * Excluded from OpenAPI: these URLs are opaque and come from upload tickets and download links.
 */
@ApiExcludeController()
@Controller('storage/objects')
export class LocalStorageController {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private claims(token: string, method: 'GET' | 'PUT') {
    if (!(this.storage instanceof LocalObjectStorage)) throw denied();
    const claims = this.storage.verify(token, this.clock.now());
    if (!claims || claims.m !== method) throw denied();
    return claims;
  }

  @Put(':token')
  async upload(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const claims = this.claims(token, 'PUT');
    const contentType = (String(req.headers['content-type'] ?? '').split(';')[0] ?? '')
      .trim()
      .toLowerCase();
    if (contentType !== claims.ct) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'CONTENT_TYPE_MISMATCH',
        'The file type does not match the upload request.',
      );
    }
    const body = await readBody(req, claims.max ?? 0);
    if (body.length === 0) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'FILE_EMPTY', 'The file is empty.');
    }
    await this.storage.put(claims.k, body, contentType);
    res.status(HttpStatus.OK).json({ stored: true, sizeBytes: body.length });
  }

  @Get(':token')
  async download(@Param('token') token: string, @Res() res: Response) {
    const claims = this.claims(token, 'GET');
    const head = await this.storage.head(claims.k);
    if (!head) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
    const bytes = await this.storage.read(claims.k, head.size);
    const isPrivate = claims.k.startsWith('private/');
    res.setHeader('Content-Type', head.contentType);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Private documents are never cached; images may be embedded by the web portals and app.
    res.setHeader('Cache-Control', isPrivate ? 'private, no-store' : 'private, max-age=300');
    res.setHeader('Cross-Origin-Resource-Policy', isPrivate ? 'same-site' : 'cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    const disposition = claims.d ?? 'attachment';
    const name = claims.fn ? `; filename*=UTF-8''${encodeURIComponent(claims.fn)}` : '';
    res.setHeader('Content-Disposition', `${disposition}${name}`);
    res.status(HttpStatus.OK).end(bytes);
  }
}
