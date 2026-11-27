import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerParams } from './common/logging.js';
import { API_ENV, type ApiEnv } from './config.js';
import { DEPENDENCY_PROBES, type DependencyProbe } from './health/dependencies.js';
import { HealthController } from './health/health.controller.js';
import { Infrastructure } from './health/infrastructure.js';

export interface AppModuleOptions {
  env: ApiEnv;
  /** Test seam: replace real dependency probes. */
  probes?: DependencyProbe[];
}

@Module({})
export class AppModule {
  static forRoot({ env, probes }: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [LoggerModule.forRoot(loggerParams(env))],
      controllers: [HealthController],
      providers: [
        { provide: API_ENV, useValue: env },
        ...(probes
          ? [{ provide: DEPENDENCY_PROBES, useValue: probes }]
          : [
              Infrastructure,
              {
                provide: DEPENDENCY_PROBES,
                useFactory: (infra: Infrastructure) => infra.probes(),
                inject: [Infrastructure],
              },
            ]),
      ],
    };
  }
}
