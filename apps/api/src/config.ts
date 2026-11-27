import type { ApiEnv } from '@jays/config';

/** DI token for the validated environment. */
export const API_ENV = Symbol('API_ENV');
export type { ApiEnv };

export const SERVICE_NAME = 'api';
export const SERVICE_VERSION = process.env['npm_package_version'] ?? '0.0.0';
