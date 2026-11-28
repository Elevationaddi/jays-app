import type { CategoryView } from '@jays/contracts';
import { MODES } from '@jays/domain';
import { ErrorAlert } from '../../../components/ErrorAlert';
import { Shell } from '../../../components/Shell';
import { requireAdmin } from '../../../lib/admin';
import { translator } from '../../../lib/i18n';
import {
  createBrand,
  createCategory,
  setBrandStatus,
  setCategoryStatus,
  setCategoryEnabled,
} from './actions';

type Search = Promise<Record<string, string | undefined>>;

/** Categories in tree order: each top-level category followed by its children. */
function treeOrder(items: CategoryView[]): CategoryView[] {
  const byOrder = (a: CategoryView, b: CategoryView) =>
    a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug);
  const roots = items.filter((c) => c.parentId === null).sort(byOrder);
  return roots.flatMap((r) => [r, ...items.filter((c) => c.parentId === r.id).sort(byOrder)]);
}

export default async function ContentPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/content');
  if (!admin.capabilities.includes('taxonomy.manage')) {
    return (
      <Shell locale={locale} admin={admin} current="content">
        <div className="alert error">{tr('admin.forbidden')}</div>
      </Shell>
    );
  }
  const [categories, brands] = await Promise.all([api.adminCategories(), api.adminBrands()]);
  const roots = categories.items.filter((c) => c.parentId === null && c.status === 'active');

  return (
    <Shell locale={locale} admin={admin} current="content">
      <h1>{tr('admin.content.title')}</h1>
      <p className="muted">{tr('admin.content.note')}</p>
      <ErrorAlert locale={locale} code={params['error']} />
      {params['saved'] ? (
        <div className="alert info" role="status">
          {tr('common.saved')}
        </div>
      ) : null}

      {MODES.map((mode) => (
        <section key={mode} aria-labelledby={`cat-${mode}`}>
          <h2 id={`cat-${mode}`}>
            {tr('admin.content.categories')} · {tr(`business.mode.${mode}`)}
          </h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{tr('admin.content.nameEn')}</th>
                  <th>{tr('admin.content.nameAr')}</th>
                  <th>{tr('admin.content.slug')}</th>
                  <th>{tr('admin.businesses.status')}</th>
                  <th>
                    <span className="sr-only">{tr('admin.business.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {treeOrder(categories.items.filter((c) => c.mode === mode)).map((c) => (
                  <tr key={c.id}>
                    <td style={{ paddingInlineStart: c.depth > 0 ? 36 : 12 }}>
                      {c.depth > 0 ? '↳ ' : ''}
                      {c.name.en}
                    </td>
                    <td dir="rtl" lang="ar">
                      {c.name.ar}
                    </td>
                    <td className="ltr-inline">{c.slug}</td>
                    <td>
                      {c.status === 'archived' ? (
                        <span className="badge rejected">{tr('admin.content.archived')}</span>
                      ) : !c.enabled ? (
                        <span className="badge pending">{tr('admin.content.off')}</span>
                      ) : (
                        <span className="badge active">✓</span>
                      )}
                    </td>
                    <td>
                      <form action={setCategoryStatus}>
                        <input type="hidden" name="id" value={c.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={c.status === 'active' ? 'archived' : 'active'}
                        />
                        <button className="btn ghost" type="submit">
                          {c.status === 'active'
                            ? tr('admin.content.archive')
                            : tr('admin.content.restore')}
                        </button>
                      </form>
                      {c.status === 'active' ? (
                        <form action={setCategoryEnabled}>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="enabled" value={c.enabled ? 'off' : 'on'} />
                          <button className="btn ghost" type="submit">
                            {c.enabled
                              ? tr('admin.content.switchOff')
                              : tr('admin.content.switchOn')}
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="card" style={{ marginTop: 24, maxWidth: 720 }} aria-labelledby="add-cat">
        <h2 id="add-cat">{tr('admin.content.addCategory')}</h2>
        <form action={createCategory}>
          <div className="grid2">
            <div className="field">
              <label htmlFor="cat-mode">{tr('admin.content.mode')}</label>
              <select id="cat-mode" name="mode" defaultValue="shop">
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {tr(`business.mode.${m}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cat-parent">{tr('admin.content.parent')}</label>
              <select id="cat-parent" name="parentId" defaultValue="">
                <option value="">{tr('admin.content.noParent')}</option>
                {roots.map((c) => (
                  <option key={c.id} value={c.id}>
                    {tr(`business.mode.${c.mode}`)} › {c.name[locale]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cat-en">{tr('admin.content.nameEn')}</label>
              <input id="cat-en" name="nameEn" type="text" dir="ltr" required maxLength={80} />
            </div>
            <div className="field">
              <label htmlFor="cat-ar">{tr('admin.content.nameAr')}</label>
              <input id="cat-ar" name="nameAr" type="text" dir="rtl" required maxLength={80} />
            </div>
            <div className="field">
              <label htmlFor="cat-slug">{tr('admin.content.slug')}</label>
              <input
                id="cat-slug"
                name="slug"
                type="text"
                dir="ltr"
                required
                maxLength={60}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
              />
            </div>
          </div>
          <button className="btn" type="submit">
            {tr('admin.content.addCategory')}
          </button>
        </form>
      </section>

      <section id="brands" aria-labelledby="brands-title">
        <h2 id="brands-title">{tr('admin.content.brands')}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('admin.content.nameEn')}</th>
                <th>{tr('admin.content.nameAr')}</th>
                <th>{tr('admin.content.slug')}</th>
                <th>
                  <span className="sr-only">{tr('admin.business.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {brands.items.map((b) => (
                <tr key={b.id}>
                  <td>
                    {b.name.en}{' '}
                    {b.status === 'archived' ? (
                      <span className="badge rejected">{tr('admin.content.archived')}</span>
                    ) : null}
                  </td>
                  <td dir="rtl" lang="ar">
                    {b.name.ar}
                  </td>
                  <td className="ltr-inline">{b.slug}</td>
                  <td>
                    <form action={setBrandStatus}>
                      <input type="hidden" name="id" value={b.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={b.status === 'active' ? 'archived' : 'active'}
                      />
                      <button className="btn ghost" type="submit">
                        {b.status === 'active'
                          ? tr('admin.content.archive')
                          : tr('admin.content.restore')}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form action={createBrand} className="card" style={{ marginTop: 16, maxWidth: 720 }}>
          <h3 style={{ margin: 0 }}>{tr('admin.content.addBrand')}</h3>
          <div className="grid2">
            <div className="field">
              <label htmlFor="brand-en">{tr('admin.content.nameEn')}</label>
              <input id="brand-en" name="nameEn" type="text" dir="ltr" required maxLength={80} />
            </div>
            <div className="field">
              <label htmlFor="brand-ar">{tr('admin.content.nameAr')}</label>
              <input id="brand-ar" name="nameAr" type="text" dir="rtl" required maxLength={80} />
            </div>
            <div className="field">
              <label htmlFor="brand-slug">{tr('admin.content.slug')}</label>
              <input
                id="brand-slug"
                name="slug"
                type="text"
                dir="ltr"
                required
                maxLength={60}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
              />
            </div>
          </div>
          <button className="btn" type="submit">
            {tr('admin.content.addBrand')}
          </button>
        </form>
      </section>
    </Shell>
  );
}
