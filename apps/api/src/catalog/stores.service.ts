import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { PublicStore, StoreListQuery } from '@jays/contracts';
import type { Db } from '@jays/db';
import { DOWNLOAD_URL_TTL_SECONDS, type EmirateCode, type Mode } from '@jays/domain';
import { type Expression, type SqlBool } from 'kysely';
import { API_ENV, type ApiEnv } from '../config.js';
import { addSeconds, CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { afterCursor, cursorTs, decodeCursor, toPage } from '../common/pagination.js';
import { DB } from '../common/tokens.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage.js';

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
type Localized = { en: string; ar: string };

/**
 * Public storefronts. One rule everywhere (T02): a store is visible only while the business is
 * approved, its storefront has been published, and at least one mode (or the requested mode) is
 * active. Only live_* content is ever returned; drafts and pending changes never leak.
 */
@Injectable()
export class StoresService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private visible(mode?: Mode) {
    return this.db
      .selectFrom('storefronts as s')
      .innerJoin('businesses as b', 'b.id', 's.business_id')
      .where('b.status', '=', 'approved')
      .where('s.published_at', 'is not', null)
      .where(({ exists, selectFrom }) => {
        let modes = selectFrom('business_modes as m')
          .select('m.id')
          .whereRef('m.business_id', '=', 'b.id')
          .where('m.status', '=', 'active');
        if (mode) modes = modes.where('m.mode', '=', mode);
        return exists(modes);
      });
  }

  private mediaUrl(id: string | null): string | null {
    return id ? `${this.env.API_PUBLIC_URL.replace(/\/$/, '')}/media/${id}` : null;
  }

  private async toStores(
    rows: {
      id: string;
      live_name: Localized | null;
      live_description: Localized | null;
      live_logo_media_id: string | null;
      live_banner_media_id: string | null;
      address_emirate_code: string | null;
      published_at: Date | null;
    }[],
  ): Promise<Map<string, PublicStore>> {
    const modes = rows.length
      ? await this.db
          .selectFrom('business_modes')
          .select(['business_id', 'mode'])
          .where(
            'business_id',
            'in',
            rows.map((r) => r.id),
          )
          .where('status', '=', 'active')
          .orderBy('mode')
          .execute()
      : [];
    return new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          name: r.live_name as Localized,
          description: r.live_description as Localized,
          logoUrl: this.mediaUrl(r.live_logo_media_id),
          bannerUrl: this.mediaUrl(r.live_banner_media_id),
          modes: modes.filter((m) => m.business_id === r.id).map((m) => m.mode),
          emirate: r.address_emirate_code as EmirateCode | null,
          publishedAt: (r.published_at as Date).toISOString(),
        },
      ]),
    );
  }

  private readonly columns = [
    'b.id',
    's.live_name',
    's.live_description',
    's.live_logo_media_id',
    's.live_banner_media_id',
    'b.address_emirate_code',
    's.published_at',
  ] as const;

  async list(query: StoreListQuery) {
    const cursor = decodeCursor(query.cursor);
    let q = this.visible(query.mode)
      .select(this.columns)
      .select(cursorTs('s.published_at').as('cursor_ts'));
    if (query.emirate) q = q.where('b.address_emirate_code', '=', query.emirate);
    if (cursor) q = q.where(afterCursor('s.published_at', 'b.id', cursor) as Expression<SqlBool>);
    const rows = await q
      .orderBy('s.published_at')
      .orderBy('b.id')
      .limit(query.limit + 1)
      .execute();
    const stores = await this.toStores(rows);
    return toPage(rows, query.limit, (r) => stores.get(r.id) as PublicStore);
  }

  async get(id: string): Promise<PublicStore> {
    const row = await this.visible().select(this.columns).where('b.id', '=', id).executeTakeFirst();
    if (!row) throw notFound();
    return (await this.toStores([row])).get(id) as PublicStore;
  }

  /**
   * Public image URL: redirects to a short-lived signed URL, but only while the image is part of a
   * visible storefront's live content. Draft and pending images stay private.
   */
  async mediaRedirect(mediaId: string): Promise<string> {
    const row = await this.visible()
      .innerJoin('media as md', (join) =>
        join
          .onRef('md.business_id', '=', 'b.id')
          .on((eb) =>
            eb.or([
              eb('md.id', '=', eb.ref('s.live_logo_media_id')),
              eb('md.id', '=', eb.ref('s.live_banner_media_id')),
            ]),
          ),
      )
      .select(['md.object_key'])
      .where('md.id', '=', mediaId)
      .where('md.status', '=', 'ready')
      .executeTakeFirst();
    if (!row) throw notFound();
    return this.storage.signDownload(row.object_key, {
      expiresAt: addSeconds(this.clock.now(), DOWNLOAD_URL_TTL_SECONDS),
      disposition: 'inline',
    }).url;
  }
}
