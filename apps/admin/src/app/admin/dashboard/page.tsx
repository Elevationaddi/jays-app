import { Shell } from '../../../components/Shell';
import { requireAdmin } from '../../../lib/admin';
import { translator } from '../../../lib/i18n';

export default async function DashboardPage() {
  const { locale, tr } = await translator();
  const { admin } = await requireAdmin('/admin/dashboard');
  return (
    <Shell locale={locale} admin={admin} current="dashboard">
      <h1>{tr('admin.dashboard.title')}</h1>
      <div className="alert info">{tr('admin.dashboard.note')}</div>
      <section className="card" style={{ maxWidth: 520 }}>
        <h2 style={{ margin: 0 }}>{admin.displayName}</h2>
        <div className="muted ltr">{admin.email}</div>
        <div>
          <strong>{tr('admin.roles')}: </strong>
          {admin.roles.map((r) => tr(`role.${r}`)).join(locale === 'ar' ? '، ' : ', ')}
        </div>
      </section>
    </Shell>
  );
}
