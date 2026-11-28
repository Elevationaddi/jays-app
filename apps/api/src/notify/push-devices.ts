import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  pushDeviceListSchema,
  pushDeviceSchema,
  registerPushDeviceRequestSchema,
  unregisterPushDeviceRequestSchema,
  type PushDeviceView,
  type RegisterPushDeviceRequest,
  type UnregisterPushDeviceRequest,
} from '@jays/contracts';
import type { Db } from '@jays/db';
import { CurrentUser, UserAuthGuard, type UserPrincipal } from '../auth/guards.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { DB } from '../common/tokens.js';
import { ApiErrors, ApiZodBody, ApiZodResponse, ZodBody } from '../common/zod.js';

/** A person keeps push on at most this many devices; registering another revokes the oldest. */
export const PUSH_DEVICES_MAX = 10;

const view = (r: {
  id: string;
  platform: PushDeviceView['platform'];
  created_at: Date;
  last_seen_at: Date;
}): PushDeviceView => ({
  id: r.id,
  platform: r.platform,
  createdAt: r.created_at.toISOString(),
  lastSeenAt: r.last_seen_at.toISOString(),
});

/** Push devices (ADR-0031). The token itself is never returned. */
@Injectable()
export class PushDevicesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(userId: string) {
    const rows = await this.db
      .selectFrom('push_devices')
      .select(['id', 'platform', 'created_at', 'last_seen_at'])
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .orderBy('last_seen_at', 'desc')
      .execute();
    return { items: rows.map(view) };
  }

  /** Idempotent. A token can belong to one account only: the latest one to register it. */
  async register(userId: string, body: RegisterPushDeviceRequest): Promise<PushDeviceView> {
    const now = this.clock.now();
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('push_devices')
        .values({ user_id: userId, token: body.token, platform: body.platform, last_seen_at: now })
        .onConflict((oc) =>
          oc.column('token').doUpdateSet({
            user_id: userId,
            platform: body.platform,
            last_seen_at: now,
            revoked_at: null,
            revoke_reason: null,
          }),
        )
        .returning(['id', 'platform', 'created_at', 'last_seen_at'])
        .executeTakeFirstOrThrow();
      const active = await trx
        .selectFrom('push_devices')
        .select('id')
        .where('user_id', '=', userId)
        .where('revoked_at', 'is', null)
        .orderBy('last_seen_at', 'desc')
        .orderBy('id', 'desc')
        .execute();
      const extra = active.slice(PUSH_DEVICES_MAX).map((d) => d.id);
      if (extra.length > 0) {
        await trx
          .updateTable('push_devices')
          .set({ revoked_at: now, revoke_reason: 'replaced' })
          .where('id', 'in', extra)
          .execute();
      }
      return view(row);
    });
  }

  /** Signing out on a device stops its push. Unknown tokens are ignored (no account probing). */
  async unregister(userId: string, body: UnregisterPushDeviceRequest) {
    await this.db
      .updateTable('push_devices')
      .set({ revoked_at: this.clock.now(), revoke_reason: 'signed_out' })
      .where('user_id', '=', userId)
      .where('token', '=', body.token)
      .where('revoked_at', 'is', null)
      .execute();
  }
}

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(UserAuthGuard)
@Controller('me/push-devices')
export class PushDevicesController {
  constructor(@Inject(PushDevicesService) private readonly devices: PushDevicesService) {}

  @Get()
  @ApiOperation({ summary: 'Devices receiving my push notifications (tokens are not shown)' })
  @ApiZodResponse(200, pushDeviceListSchema, 'Devices.')
  @ApiErrors(401)
  list(@CurrentUser() user: UserPrincipal) {
    return this.devices.list(user.userId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register this device for push (Firebase Cloud Messaging token)',
    description:
      'Idempotent. Push is sent only while push notifications are on in PATCH /me/privacy.',
  })
  @ApiZodBody(registerPushDeviceRequestSchema)
  @ApiZodResponse(200, pushDeviceSchema, 'Registered.')
  @ApiErrors(400, 401)
  register(
    @CurrentUser() user: UserPrincipal,
    @ZodBody(registerPushDeviceRequestSchema) body: RegisterPushDeviceRequest,
  ) {
    return this.devices.register(user.userId, body);
  }

  @Post('unregister')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Stop push to this device, for example when signing out' })
  @ApiZodBody(unregisterPushDeviceRequestSchema)
  @ApiErrors(400, 401)
  async unregister(
    @CurrentUser() user: UserPrincipal,
    @ZodBody(unregisterPushDeviceRequestSchema) body: UnregisterPushDeviceRequest,
  ) {
    await this.devices.unregister(user.userId, body);
  }
}
