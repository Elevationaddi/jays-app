import Link from 'next/link';
import { Workspace, loadBusiness } from '../../../../components/Workspace';
import { serverApi } from '../../../../lib/api';
import { translator } from '../../../../lib/i18n';
import { replyToReview, reportReview } from '../aftercare-actions';

type Search = Promise<Record<string, string | undefined>>;

/**
 * Reviews (docs/03-business.md; T10): reply publicly (a new reply supersedes the last, history is
 * kept) or report a review to moderation. Merchants can never hide or edit a review.
 */
export default async function ReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Search;
}) {
  const { businessId } = await params;
  const query = await searchParams;
  const { locale, tr } = await translator();
  const business = await loadBusiness(businessId);
  const path = `/business/${businessId}/reviews`;
  const frame = { locale, business, tab: 'reviews' as const, path, title: tr('reviews.title') };
  if (!business.myCapabilities.includes('reviews.respond')) {
    return (
      <Workspace {...frame}>
        <div className="alert info">{tr('business.team.noAccess')}</div>
      </Workspace>
    );
  }
  const page = await (
    await serverApi()
  ).businessReviews(businessId, {
    limit: 30,
    ...(query['cursor'] ? { cursor: query['cursor'] } : {}),
  });
  const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeZone: 'Asia/Dubai',
  });
  return (
    <Workspace
      {...frame}
      intro={tr('reviews.intro')}
      error={query['error']}
      notice={query['saved'] ? tr('reviews.saved') : undefined}
    >
      {page.items.length === 0 ? <p className="muted">{tr('reviews.empty')}</p> : null}
      <div className="stack">
        {page.items.map((r) => (
          <section key={r.id} className="card">
            <p className="meta">
              <strong aria-label={tr('reviews.stars', { n: r.rating })}>
                {'★'.repeat(r.rating)}
                {'☆'.repeat(5 - r.rating)}
              </strong>
              <span>{r.subject[locale]}</span>
              <span className="muted">
                {r.author ?? tr('reviews.anonymous')} · {date.format(new Date(r.createdAt))}
              </span>
              {r.status === 'hidden' ? (
                <span className="badge canceled">{tr('reviews.hidden')}</span>
              ) : null}
              {r.reported ? (
                <span className="badge pending_approval">{tr('reviews.reported')}</span>
              ) : null}
            </p>
            {r.body ? <p>{r.body}</p> : null}
            {r.replies.length > 0 ? (
              <div className="alert info">
                <strong>{tr('reviews.yourReply')}:</strong> {r.replies[r.replies.length - 1]?.body}
                {r.replies.length > 1 ? (
                  <details>
                    <summary>{tr('reviews.history', { n: r.replies.length - 1 })}</summary>
                    <ul>
                      {r.replies.slice(0, -1).map((p, i) => (
                        <li key={i}>
                          <span className="muted">{date.format(new Date(p.at))}</span> {p.body}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : null}
            <form action={replyToReview} className="inline-form">
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="reviewId" value={r.id} />
              <label className="sr-only" htmlFor={`reply-${r.id}`}>
                {tr('reviews.reply')}
              </label>
              <input
                id={`reply-${r.id}`}
                name="body"
                required
                maxLength={2000}
                placeholder={tr('reviews.replyPlaceholder')}
              />
              <button className="btn">{tr('reviews.reply')}</button>
            </form>
            {!r.reported ? (
              <details>
                <summary>{tr('reviews.report')}</summary>
                <form action={reportReview} className="inline-form">
                  <input type="hidden" name="businessId" value={businessId} />
                  <input type="hidden" name="reviewId" value={r.id} />
                  <label className="sr-only" htmlFor={`report-${r.id}`}>
                    {tr('reviews.reportReason')}
                  </label>
                  <input
                    id={`report-${r.id}`}
                    name="reason"
                    required
                    minLength={3}
                    maxLength={1000}
                    placeholder={tr('reviews.reportReason')}
                  />
                  <button className="btn secondary">{tr('reviews.sendReport')}</button>
                </form>
              </details>
            ) : null}
          </section>
        ))}
      </div>
      {page.nextCursor ? (
        <p>
          <Link href={`${path}?cursor=${encodeURIComponent(page.nextCursor)}`}>
            {tr('common.more')}
          </Link>
        </p>
      ) : null}
    </Workspace>
  );
}
