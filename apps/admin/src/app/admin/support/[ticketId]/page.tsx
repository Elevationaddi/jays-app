import { ApiClientError } from '@jays/api-client';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ErrorAlert } from '../../../../components/ErrorAlert';
import { Shell } from '../../../../components/Shell';
import { requireAdmin } from '../../../../lib/admin';
import { translator } from '../../../../lib/i18n';
import {
  ticketAction,
  ticketAttachment,
  ticketEscalate,
  ticketMessage,
  ticketPriority,
} from '../../aftercare-actions';

/** One ticket: the conversation with internal notes, reply, note, assign and resolve. */
export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticketId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ticketId } = await params;
  const query = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin(`/admin/support/${ticketId}`);
  if (!admin.capabilities.includes('support.handle')) {
    return (
      <Shell locale={locale} admin={admin} current="support">
        <div className="alert error">{tr('admin.forbidden')}</div>
      </Shell>
    );
  }
  let t;
  try {
    t = await api.adminTicket(ticketId);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  }
  const when = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  });
  const resolved = t.status === 'resolved';
  return (
    <Shell locale={locale} admin={admin} current="support">
      <p className="meta">
        <Link href="/admin/support">{tr('admin.support.back')}</Link>
        <span className={`badge ticket-${t.status}`}>{tr(`ticketStatus.${t.status}`)}</span>
        {t.overdue ? <span className="badge failed">{tr('admin.support.overdue')}</span> : null}
        <span className={`badge priority-${t.priority}`}>{tr(`ticketPriority.${t.priority}`)}</span>
        {t.escalation ? (
          <span className="badge failed">{tr(`ticketEscalation.${t.escalation}`)}</span>
        ) : null}
      </p>
      <h1>{t.subject}</h1>
      <ErrorAlert locale={locale} code={query['error']} />
      <div className="split">
        <section className="card">
          <ol className="conversation">
            {t.messages.map((m) => (
              <li key={m.id} className={m.internal ? 'internal' : m.author}>
                <div className="muted">
                  <strong>{m.authorName ?? tr(`admin.support.author.${m.author}`)}</strong>
                  {m.internal ? ` · ${tr('admin.support.internal')}` : ''} ·{' '}
                  {when.format(new Date(m.createdAt))}
                </div>
                <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{m.body}</p>
              </li>
            ))}
          </ol>
          {t.attachments.length ? (
            <>
              <h2>{tr('admin.support.attachments')}</h2>
              <ul className="list">
                {t.attachments.map((a) => (
                  <li key={a.id}>
                    <form action={ticketAttachment}>
                      <input type="hidden" name="ticketId" value={t.id} />
                      <input type="hidden" name="attachmentId" value={a.id} />
                      <button className="btn ghost" type="submit">
                        {a.fileName}
                      </button>{' '}
                      <span className="muted">
                        {Math.ceil(a.sizeBytes / 1024)} KB · {when.format(new Date(a.createdAt))}
                      </span>
                    </form>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <form action={ticketMessage} className="stack">
            <input type="hidden" name="ticketId" value={t.id} />
            <div className="field">
              <label htmlFor="body">{tr('admin.support.message')}</label>
              <textarea id="body" name="body" required maxLength={5000} rows={4} />
            </div>
            <label className="check">
              <input type="checkbox" name="internal" defaultChecked={resolved} />
              {tr('admin.support.asNote')}
            </label>
            <button className="btn">{tr('admin.support.send')}</button>
            {resolved ? <p className="muted">{tr('admin.support.resolvedHint')}</p> : null}
          </form>
        </section>
        <aside className="card">
          <dl className="totals">
            <dt>{tr('admin.support.customer')}</dt>
            <dd>
              {t.customer.name ?? '—'}
              <div className="muted ltr">{t.customer.contact}</div>
            </dd>
            <dt>{tr('admin.support.type')}</dt>
            <dd>{tr(`ticketType.${t.type}`)}</dd>
            {t.orderId ? (
              <>
                <dt>{tr('admin.orders.order')}</dt>
                <dd className="ltr">#{t.orderId.slice(0, 8).toUpperCase()}</dd>
              </>
            ) : null}
            <dt>{tr('admin.support.assignee')}</dt>
            <dd>{t.assignedTo?.name ?? '—'}</dd>
            <dt>{tr('admin.support.due')}</dt>
            <dd>{when.format(new Date(t.slaDueAt))}</dd>
            <dt>{tr('admin.support.firstResponse')}</dt>
            <dd>{t.firstResponseAt ? when.format(new Date(t.firstResponseAt)) : '—'}</dd>
          </dl>
          {!resolved ? (
            <div className="stack">
              {t.assignedTo?.id !== admin.id ? (
                <form action={ticketAction}>
                  <input type="hidden" name="ticketId" value={t.id} />
                  <button className="btn secondary" name="action" value="assign_to_me">
                    {tr('admin.support.assignToMe')}
                  </button>
                </form>
              ) : (
                <form action={ticketAction}>
                  <input type="hidden" name="ticketId" value={t.id} />
                  <button className="btn secondary" name="action" value="unassign">
                    {tr('admin.support.unassign')}
                  </button>
                </form>
              )}
              <form action={ticketAction}>
                <input type="hidden" name="ticketId" value={t.id} />
                <button className="btn" name="action" value="resolve">
                  {tr('admin.support.resolve')}
                </button>
              </form>
              <form action={ticketPriority} className="stack">
                <input type="hidden" name="ticketId" value={t.id} />
                <div className="field">
                  <label htmlFor="priority">{tr('admin.support.priority')}</label>
                  <select id="priority" name="priority" defaultValue={t.priority}>
                    {(['low', 'normal', 'high', 'urgent'] as const).map((p) => (
                      <option key={p} value={p}>
                        {tr(`ticketPriority.${p}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <button className="btn secondary">{tr('admin.support.setPriority')}</button>
              </form>
              <form action={ticketEscalate} className="stack">
                <input type="hidden" name="ticketId" value={t.id} />
                <div className="field">
                  <label htmlFor="escalation">{tr('admin.support.escalate')}</label>
                  <select id="escalation" name="escalation" defaultValue="payment">
                    {(['payment', 'security', 'operations'] as const).map((e) => (
                      <option key={e} value={e}>
                        {tr(`ticketEscalation.${e}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="reason">{tr('admin.support.escalateReason')}</label>
                  <textarea
                    id="reason"
                    name="reason"
                    required
                    minLength={3}
                    maxLength={1000}
                    rows={2}
                  />
                </div>
                <p className="muted">{tr('admin.support.escalateHint')}</p>
                <button className="btn secondary">{tr('admin.support.escalate')}</button>
              </form>
            </div>
          ) : null}
        </aside>
      </div>
    </Shell>
  );
}
