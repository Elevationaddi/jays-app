import { ErrorAlert } from '../../../components/ErrorAlert';
import { Shell } from '../../../components/Shell';
import { requireAdmin } from '../../../lib/admin';
import { translator } from '../../../lib/i18n';
import { saveTemplate } from '../aftercare-actions';

type Search = Promise<Record<string, string | undefined>>;

/** Notification templates (versioned per event and language) and outbox health (T12). */
export default async function NotificationsPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/notifications');
  if (!admin.capabilities.includes('notifications.manage')) {
    return (
      <Shell locale={locale} admin={admin} current="notifications">
        <div className="alert error">{tr('admin.forbidden')}</div>
      </Shell>
    );
  }
  const [templates, health] = await Promise.all([
    api.adminNotificationTemplates(),
    api.adminOutboxHealth(),
  ]);
  const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeZone: 'Asia/Dubai',
  });
  return (
    <Shell locale={locale} admin={admin} current="notifications">
      <h1>{tr('admin.notifications.title')}</h1>
      <p className="muted">{tr('admin.notifications.intro')}</p>
      <ErrorAlert locale={locale} code={params['error']} />
      {params['saved'] ? (
        <div className="alert info" role="status">
          {tr('admin.notifications.saved')}
        </div>
      ) : null}
      <div className="stats">
        <div className="card stat">
          <span className="muted">{tr('admin.notifications.pending')}</span>
          <strong>{health.pending}</strong>
        </div>
        <div className="card stat">
          <span className="muted">{tr('admin.notifications.retrying')}</span>
          <strong>{health.retrying}</strong>
        </div>
        <div className={`card stat${health.failed ? ' attention' : ''}`}>
          <span className="muted">{tr('admin.notifications.failed')}</span>
          <strong>{health.failed}</strong>
        </div>
        <div className="card stat">
          <span className="muted">{tr('admin.notifications.oldest')}</span>
          <strong>
            {health.oldestPendingSeconds === null
              ? '—'
              : tr('admin.notifications.seconds', { n: health.oldestPendingSeconds })}
          </strong>
        </div>
      </div>
      <div className="stack">
        {templates.map((t) => (
          <details key={`${t.eventType}-${t.locale}`} className="card">
            <summary>
              <strong className="ltr">{t.eventType}</strong> · {t.locale.toUpperCase()} · v
              {t.version}
              <span className="muted"> · {t.title}</span>
            </summary>
            <form action={saveTemplate} className="stack" dir={t.locale === 'ar' ? 'rtl' : 'ltr'}>
              <input type="hidden" name="eventType" value={t.eventType} />
              <input type="hidden" name="locale" value={t.locale} />
              <div className="field">
                <label htmlFor={`title-${t.eventType}-${t.locale}`}>
                  {tr('admin.notifications.templateTitle')}
                </label>
                <input
                  id={`title-${t.eventType}-${t.locale}`}
                  name="title"
                  defaultValue={t.title}
                  required
                  maxLength={200}
                />
              </div>
              <div className="field">
                <label htmlFor={`body-${t.eventType}-${t.locale}`}>
                  {tr('admin.notifications.templateBody')}
                </label>
                <textarea
                  id={`body-${t.eventType}-${t.locale}`}
                  name="body"
                  defaultValue={t.body}
                  required
                  maxLength={2000}
                  rows={3}
                />
              </div>
              <p className="muted">
                {tr('admin.notifications.placeholders')}:{' '}
                <span className="ltr">{t.placeholders.map((p) => `{${p}}`).join(' ')}</span>
                {' · '}
                {t.updatedBy ? `${t.updatedBy.name}, ` : ''}
                {date.format(new Date(t.updatedAt))}
              </p>
              <button className="btn">{tr('admin.notifications.publish')}</button>
            </form>
          </details>
        ))}
      </div>
    </Shell>
  );
}
