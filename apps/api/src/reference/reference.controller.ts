import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { emirateListSchema, type Emirate } from '@jays/contracts';
import type { Db } from '@jays/db';
import { DB } from '../common/tokens.js';
import { ApiZodResponse } from '../common/zod.js';

@ApiTags('reference')
@Controller('emirates')
export class ReferenceController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  @ApiOperation({ summary: 'Emirates offered on the welcome screen and in addresses (admin-controlled)' })
  @ApiZodResponse(200, emirateListSchema, 'Enabled emirates in display order.')
  async list(): Promise<{ items: Emirate[] }> {
    const rows = await this.db
      .selectFrom('emirates')
      .select(['code', 'name'])
      .where('enabled', '=', true)
      .orderBy('sort_order')
      .execute();
    return { items: rows.map((r) => ({ code: r.code as Emirate['code'], name: r.name })) };
  }
}
