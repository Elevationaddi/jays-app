import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule, type AppModuleOptions } from './app.module.js';
import { ErrorEnvelopeFilter } from './common/error.filter.js';
import { ErrorEnvelopeDto } from './health/health.dto.js';

export const API_PREFIX = 'v1';

/** Builds a fully configured app. Shared by main.ts, tests and the OpenAPI generator. */
export async function createApp(options: AppModuleOptions): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(options), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(helmet());
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
        'Generated from code: run `pnpm openapi`.',
    )
    .setOpenAPIVersion('3.1.0')
    .setVersion('0.0.0')
    .build();
  return SwaggerModule.createDocument(app, config, { extraModels: [ErrorEnvelopeDto] });
}
