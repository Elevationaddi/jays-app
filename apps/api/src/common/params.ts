import { HttpStatus, Param, type PipeTransform } from '@nestjs/common';
import { ApiError } from './error.filter.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A malformed id cannot exist, so it answers 404 like any other absent resource. */
export class UuidOr404Pipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
    return value.toLowerCase();
  }
}

export const UuidParam = (name: string) => Param(name, new UuidOr404Pipe());
