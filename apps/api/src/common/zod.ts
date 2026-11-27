import { applyDecorators, Body, HttpStatus, type PipeTransform, Query } from '@nestjs/common';
import { ApiBody, ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiError } from './error.filter.js';

/** Converts a Zod schema into an OpenAPI 3.1 (JSON Schema 2020-12) schema object. */
export function toOpenApi(schema: z.ZodType, io: 'input' | 'output'): SchemaObject {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', io, unrepresentable: 'any' });
  delete (json as Record<string, unknown>)['$schema'];
  return json as SchemaObject;
}

/** Maps Zod issues to `fieldErrors` keyed by dotted path. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '(root)';
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_FAILED',
      'The request is not valid.',
      fieldErrorsOf(result.error),
    );
  }
}

/** Validated request body; the same schema documents the body in OpenAPI. */
export const ZodBody = (schema: z.ZodType) => Body(new ZodPipe(schema));
export const ZodQuery = (schema: z.ZodType) => Query(new ZodPipe(schema));

export function ApiZodBody(schema: z.ZodType) {
  return ApiBody({ schema: toOpenApi(schema, 'input') });
}

export function ApiZodQuery(schema: z.ZodObject) {
  const json = toOpenApi(schema, 'input') as {
    properties?: Record<string, SchemaObject>;
    required?: string[];
  };
  return applyDecorators(
    ...Object.entries(json.properties ?? {}).map(([name, property]) =>
      ApiQuery({ name, required: json.required?.includes(name) ?? false, schema: property }),
    ),
  );
}

export function ApiZodResponse(status: number, schema: z.ZodType, description: string) {
  return ApiResponse({ status, description, schema: toOpenApi(schema, 'output') });
}

/** Documents error responses with the shared envelope. */
export function ApiErrors(...statuses: number[]) {
  const descriptions: Record<number, string> = {
    400: 'Validation failed (VALIDATION_FAILED) or a code is invalid or expired.',
    401: 'Not authenticated, or credentials are invalid.',
    403: 'Authenticated but not allowed.',
    404: 'Absent, or hidden from this caller.',
    409: 'Conflicts with the current state.',
    422: 'Refused by policy.',
    429: 'Rate limited. See the Retry-After header.',
    503: 'A dependency is unavailable.',
  };
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: descriptions[status] ?? 'Error',
        schema: { $ref: '#/components/schemas/ErrorEnvelopeDto' },
      }),
    ),
  );
}
