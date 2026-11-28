import Link from 'next/link';
import { ErrorAlert } from '../../../components/ErrorAlert';
import { Shell } from '../../../components/Shell';
import { requireAdmin } from '../../../lib/admin';
import { translator } from '../../../lib/i18n';
import { moderateReview } from '../aftercare-actions';

type Search = Promise<Record<string, string | undefined>>;
const FILTERS = ['reported', 'hidden', 'all'] as const;

/** Review moderation (T10): hide, restore or dismiss a report, always with a reason (audited). */
export default async function ReviewsPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/reviews');
  if (!admin.capabilities.includes('reviews.moderate')) {
    return (
      <Shell locale={locale} admin={admin} current="reviews">
        <div className="alert error">{tr('admin.forbidden')}</div>
      </Shell>
    );
  }
  const filter = (FILTERS as readonly string[]).includes(params['filter'] ?? '')
    ? (params['filter'] as (typeof FILTERS)[number])
    : 'reported';
  const page = await api.adminReviews({
    filter,
    limit: 30,
    ...(params['cursor'] ? { cursor: params['cursor'] } : {}),
  });
  const back = `/admin/reviews?filter=${filter}`;
  const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeZone: 'Asia/Dubai',
  });
  return (
    <Shell locale={locale} admin={admin} current="reviews">
      <h1>{tr('admin.reviews.title')}</h1>
      <p className="muted">{tr('admin.reviews.intro')}</p>
      <ErrorAlert locale={locale} code={params['error']} />
      {params['saved'] ? (
        <div className="alert info" role="status">
          {tr('admin.reviews.saved')}
        </div>
      ) : null}
      <nav className="tabs filters" aria-label={tr('admin.reviews.filter')}>
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/reviews?filter=${f}`}
            aria-current={filter === f ? 'page' : undefined}
          >
            {tr(`admin.reviews.${f}`)}
          </Link>
        ))}
      </nav>
      {page.items.length === 0 ? <p className="muted">{tr('admin.reviews.empty')}</p> : null}
      <div className="stack">
        {page.items.map((r) => (
          <section key={r.id} className="card">
            <p className="meta">
              <strong aria-label={tr('reviews.stars', { n: r.rating })}>
                {'★'.repeat(r.rating)}
                {'☆'.repeat(5 - r.rating)}
              </strong>
              <Link href={`/admin/businesses/${r.business.id}`}>{r.business.name[locale]}</Link>
              <span>{r.subject[locale]}</span>
              <span className="muted">
                {r.author ?? tr('reviews.anonymous')} · {date.format(new Date(r.createdAt))}
              </span>
              {r.status === 'hidden' ? (
                <span className="badge canceled">{tr('reviews.hidden')}</span>
              ) : null}
            </p>
            {r.body ? <p>{r.body}</p> : null}
            {r.replies.length ? (
              <p className="muted">
                {tr('admin.reviews.merchantReply')}: {r.replies[r.replies.length - 1]?.body}
              </p>
            ) : null}
            {r.report && !r.report.resolvedAt ? (
              <div className="alert warning">
                {tr('admin.reviews.reportedBecause')}: {r.report.reason}
              </div>
            ) : null}
            {r.hiddenReason ? (
              <p className="muted">
                {tr('admin.reviews.hiddenBecause')}: {r.hiddenReason}
              </p>
            ) : null}
            <form action={moderateReview} className="inline-form">
              <input type="hidden" name="reviewId" value={r.id} />
              <input type="hidden" name="back" value={back} />
              <label className="sr-only" htmlFor={`reason-${r.id}`}>
                {tr('admin.reviews.reason')}
              </label>
              <input
                id={`reason-${r.id}`}
                name="reason"
                required
                minLength={3}
                maxLength={1000}
                placeholder={tr('admin.reviews.reason')}
              />
              {r.status === 'published' ? (
                <button className="btn danger" name="action" value="hide">
                  {tr('admin.reviews.hide')}
                </button>
              ) : (
                <button className="btn" name="action" value="restore">
                  {tr('admin.reviews.restore')}
                </button>
              )}
              {r.reported ? (
                <button className="btn secondary" name="action" value="dismiss_report">
                  {tr('admin.reviews.dismiss')}
                </button>
              ) : null}
            </form>
          </section>
        ))}
      </div>
      {page.nextCursor ? (
        <p>
          <Link href={`${back}&cursor=${encodeURIComponent(page.nextCursor)}`}>
            {tr('common.more')}
          </Link>
        </p>
      ) : null}
    </Shell>
  );
}
