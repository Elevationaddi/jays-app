import Link from 'next/link';
import { Shell } from '../../../components/Shell';
import { requireAdmin } from '../../../lib/admin';
import { translator } from '../../../lib/i18n';

type Search = Promise<Record<string, string | undefined>>;
const QUEUES = ['open', 'mine', 'awaiting_reply', 'resolved', 'all'] as const;

/** The support queue (docs/04-admin.md, /admin/support) with first-reply SLA due times. */
export default async function SupportPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/support');
  if (!admin.capabilities.includes('support.handle')) {
    return (
      <Shell locale={locale} admin={admin} current="support">
        <div className="alert error">{tr('admin.forbidden')}</div>
      </Shell>
    );
  }
  const queue = (QUEUES as readonly string[]).includes(params['queue'] ?? '')
    ? (params['queue'] as (typeof QUEUES)[number])
    : 'open';
  const page = await api.adminTickets({
    queue,
    limit: 50,
    ...(params['cursor'] ? { cursor: params['cursor'] } : {}),
  });
  const when = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  });
  return (
    <Shell locale={locale} admin={admin} current="support">
      <h1>{tr('admin.support.title')}</h1>
      <p className="muted">{tr('admin.support.intro')}</p>
      <nav className="tabs filters" aria-label={tr('admin.support.queue')}>
        {QUEUES.map((q) => (
          <Link
            key={q}
            href={`/admin/support?queue=${q}`}
            aria-current={queue === q ? 'page' : undefined}
          >
            {tr(`admin.support.queue.${q}`)}
          </Link>
        ))}
      </nav>
      {page.items.length === 0 ? (
        <p className="muted">{tr('admin.support.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('admin.support.subject')}</th>
                <th>{tr('admin.support.type')}</th>
                <th>{tr('admin.support.status')}</th>
                <th>{tr('admin.support.customer')}</th>
                <th>{tr('admin.support.assignee')}</th>
                <th>{tr('admin.support.due')}</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/admin/support/${t.id}`}>{t.subject}</Link>
                  </td>
                  <td>{tr(`ticketType.${t.type}`)}</td>
                  <td>
                    <span className={`badge ticket-${t.status}`}>
                      {tr(`ticketStatus.${t.status}`)}
                    </span>
                  </td>
                  <td>{t.customer.name ?? '—'}</td>
                  <td>{t.assignedTo?.name ?? '—'}</td>
                  <td>
                    {t.overdue ? (
                      <span className="badge failed">{tr('admin.support.overdue')}</span>
                    ) : null}{' '}
                    {when.format(new Date(t.slaDueAt))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor ? (
        <p>
          <Link
            href={`/admin/support?queue=${queue}&cursor=${encodeURIComponent(page.nextCursor)}`}
          >
            {tr('common.more')}
          </Link>
        </p>
      ) : null}
    </Shell>
  );
}
