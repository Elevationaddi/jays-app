import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { defaultCodeForStatus, type ErrorEnvelope } from '@jays/contracts';

/** An HttpException that carries a specific error code from docs/07-api.md. */
export class ApiError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message, status);
  }
}

/**
 * Turns every error into `{ error: { code, message, fieldErrors?, requestId } }`.
 * Unexpected errors are logged with their stack and returned as a generic 500 so internals never
 * reach the client.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();
    const requestId = String(req.id ?? 'unknown');

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorEnvelope['error'] = {
      code: 'INTERNAL',
      message: 'Something went wrong. Please try again.',
      requestId,
    };

    if (exception instanceof ApiError) {
      status = exception.getStatus();
      body = { code: exception.code, message: exception.message, requestId };
      if (exception.fieldErrors) body.fieldErrors = exception.fieldErrors;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : typeof response === 'object' && response && 'message' in response
            ? String((response as { message: unknown }).message)
            : exception.message;
      body = { code: defaultCodeForStatus(status), message, requestId };
    } else {
      this.logger.error({ err: exception, requestId }, 'Unhandled error');
    }

    res.status(status).json({ error: body } satisfies ErrorEnvelope);
  }
}
