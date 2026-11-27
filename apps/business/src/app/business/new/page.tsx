import { ErrorAlert } from '../../../components/ErrorAlert';
import { TopBar } from '../../../components/TopBar';
import { translator } from '../../../lib/i18n';
import { createBusiness } from '../actions';

type Search = Promise<Record<string, string | undefined>>;

export default async function NewBusinessPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  return (
    <>
      <TopBar locale={locale} returnTo="/business/new" signedIn />
      <main className="page narrow">
        <h1>{tr('business.new.title')}</h1>
        <div className="alert info">{tr('business.new.note')}</div>
        <ErrorAlert locale={locale} code={params['error']} />
        <form action={createBusiness}>
          <div className="field">
            <label htmlFor="nameEn">{tr('business.new.nameEn')}</label>
            <input
              id="nameEn"
              name="nameEn"
              type="text"
              lang="en"
              dir="ltr"
              required
              minLength={2}
              maxLength={120}
            />
          </div>
          <div className="field">
            <label htmlFor="nameAr">{tr('business.new.nameAr')}</label>
            <input
              id="nameAr"
              name="nameAr"
              type="text"
              lang="ar"
              dir="rtl"
              required
              minLength={2}
              maxLength={120}
            />
          </div>
          <fieldset>
            <legend>{tr('business.new.modes')}</legend>
            <label className="check">
              <input type="checkbox" name="mode-shop" defaultChecked />
              <span>{tr('business.mode.shop')}</span>
            </label>
            <label className="check">
              <input type="checkbox" name="mode-services" />
              <span>{tr('business.mode.services')}</span>
            </label>
          </fieldset>
          <button className="btn block" type="submit">
            {tr('business.new.submit')}
          </button>
        </form>
      </main>
    </>
  );
}
