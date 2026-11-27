import { z } from 'zod';

export const REQUEST_ID_HEADER = 'x-request-id';

export const livenessSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
});

export const dependencyStatusSchema = z.enum(['up', 'down']);

export const readinessSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    database: dependencyStatusSchema,
    redis: dependencyStatusSchema,
  }),
});

export type Liveness = z.infer<typeof livenessSchema>;
export type Readiness = z.infer<typeof readinessSchema>;
