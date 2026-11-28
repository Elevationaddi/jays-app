import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule, type AppModuleOptions } from './app.module.js';
import { ErrorEnvelopeFilter } from './common/error.filter.js';
import { ErrorEnvelopeDto } from './health/health.dto.js';
import { HttpMetrics } from './observability/http-metrics.js';

export const API_PREFIX = 'v1';

/** Builds a fully configured app. Shared by main.ts, tests and the OpenAPI generator. */
export async function createApp(options: AppModuleOptions): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(options), {
    bufferLogs: true,
    // Webhook signatures are verified over the exact bytes received.
    rawBody: true,
  });
  app.useLogger(app.get(Logger));
  app.use(app.get(HttpMetrics).middleware());
  app.use(helmet());
  // Client IPs feed the rate limiters; only trust X-Forwarded-For from configured proxies.
  app.getHttpAdapter().getInstance().set('trust proxy', options.env.TRUST_PROXY_HOPS);
  app.enableCors({
    origin: options.env.CORS_ORIGINS,
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  app.enableShutdownHooks();
  return app;
}

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('UAE marketplace API')
    .setDescription(
      'REST API v1. Errors use the envelope in components.schemas.ErrorEnvelopeDto. ' +
        'User endpoints take a user access token; /admin endpoints (except auth and invites) take an admin access token. ' +
        'Business context always comes from verified membership, never from the request. ' +
        'Generated from code: run `pnpm openapi`.',
    )
    .setOpenAPIVersion('3.1.0')
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  return SwaggerModule.createDocument(app, config, { extraModels: [ErrorEnvelopeDto] });
}
