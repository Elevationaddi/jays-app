import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { API_ENV, type ApiEnv, SERVICE_NAME, SERVICE_VERSION } from '../config.js';
import { DEPENDENCY_PROBES, type DependencyProbe, probe } from './dependencies.js';
import { LivenessDto, ReadinessDto } from './health.dto.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DEPENDENCY_PROBES) private readonly probes: DependencyProbe[],
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** Liveness: the process is up. Does not touch dependencies. */
  @Get()
  @ApiOkResponse({ type: LivenessDto, description: 'The API process is running.' })
  live(): LivenessDto {
    return { status: 'ok', service: SERVICE_NAME, version: SERVICE_VERSION };
  }

  /** Readiness: the process can reach PostgreSQL (and Redis when it is used). 503 otherwise. */
  @Get('ready')
  @ApiOkResponse({ type: ReadinessDto, description: 'PostgreSQL and Redis are reachable.' })
  @ApiServiceUnavailableResponse({
    type: ReadinessDto,
    description: 'At least one dependency is unreachable.',
  })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessDto> {
    // A dependency without a probe counts as down, so a wiring mistake can never report ready.
    const redisUsed = this.env.RATE_LIMIT_STORE === 'redis';
    const checks: ReadinessDto['checks'] = {
      database: 'down',
      redis: redisUsed ? 'down' : 'not_used',
    };
    await Promise.all(
      this.probes.map(async (dep) => {
        if (dep.name === 'redis' && !redisUsed) return;
        checks[dep.name] = (await probe(dep)) ? 'up' : 'down';
      }),
    );
    const ready = checks.database === 'up' && (!redisUsed || checks.redis === 'up');
    if (!ready) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ready ? 'ready' : 'not_ready', checks };
  }
}
