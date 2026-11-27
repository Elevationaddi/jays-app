import type { Branch, CategoryView, Emirate, Service } from '@jays/contracts';
import { t, type Locale, type MessageKey } from '@jays/i18n';
import { aedInput } from './Workspace';

const WEEK = [1, 2, 3, 4, 5, 6, 0] as const; // Monday first, as UAE calendars show it.
export const weekdayKey = (d: number) => `weekday.${d}` as MessageKey;

/** One opening interval a day; unticked days are closed. */
export function HoursFields({ locale, hours }: { locale: Locale; hours: Branch['hours'] }) {
  const tr = (key: MessageKey) => t(locale, key);
  return (
    <fieldset className="plain">
      <legend style={{ fontWeight: 600, marginBottom: 8 }}>{tr('branch.hours')}</legend>
      <div className="table-wrap">
        <table>
          <tbody>
            {WEEK.map((d) => {
              const h = hours.find((x) => x.weekday === d);
              return (
                <tr key={d}>
                  <td>
                    <label className="check">
                      <input type="checkbox" name={`open-${d}`} defaultChecked={Boolean(h)} />
                      <span>{tr(weekdayKey(d))}</span>
                    </label>
                  </td>
                  <td>
                    <input
                      type="time"
                      name={`from-${d}`}
                      aria-label={`${tr(weekdayKey(d))}: ${tr('branch.opens')}`}
                      step={300}
                      dir="ltr"
                      defaultValue={h?.start ?? '09:00'}
                    />
                  </td>
                  <td>
                    <input
                      type="time"
                      name={`to-${d}`}
                      aria-label={`${tr(weekdayKey(d))}: ${tr('branch.closes')}`}
                      step={300}
                      dir="ltr"
                      defaultValue={h?.end ?? '21:00'}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </fieldset>
  );
}

export function BranchFields({
  locale,
  branch,
  emirates,
}: {
  locale: Locale;
  branch: Branch | null;
  emirates: Emirate[];
}) {
  const tr = (key: MessageKey) => t(locale, key);
  return (
    <>
      <div className="grid2">
        <div className="field">
          <label htmlFor="nameEn">{tr('branch.nameEn')}</label>
          <input
            id="nameEn"
            name="nameEn"
            type="text"
            dir="ltr"
            lang="en"
            minLength={2}
            maxLength={80}
            required
            defaultValue={branch?.name.en ?? ''}
          />
        </div>
        <div className="field">
          <label htmlFor="nameAr">{tr('branch.nameAr')}</label>
          <input
            id="nameAr"
            name="nameAr"
            type="text"
            dir="rtl"
            lang="ar"
            minLength={2}
            maxLength={80}
            required
            defaultValue={branch?.name.ar ?? ''}
          />
        </div>
        <div className="field">
          <label htmlFor="emirate">{tr('branch.emirate')}</label>
          <select id="emirate" name="emirate" defaultValue={branch?.emirate ?? 'DXB'}>
            {emirates.map((e) => (
              <option key={e.code} value={e.code}>
                {e.name[locale]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="area">{tr('branch.area')}</label>
          <input
            id="area"
            name="area"
            type="text"
            maxLength={120}
            required
            defaultValue={branch?.area ?? ''}
          />
        </div>
        <div className="field">
          <label htmlFor="street">{tr('branch.street')}</label>
          <input
            id="street"
            name="street"
            type="text"
            maxLength={160}
            required
            defaultValue={branch?.street ?? ''}
          />
        </div>
        <div className="field">
          <label htmlFor="building">{tr('branch.building')}</label>
          <input
            id="building"
            name="building"
            type="text"
            maxLength={120}
            required
            defaultValue={branch?.building ?? ''}
          />
        </div>
      </div>
      <HoursFields locale={locale} hours={branch?.hours ?? []} />
    </>
  );
}

export function ServiceFields({
  locale,
  service,
  categories,
  branches,
}: {
  locale: Locale;
  service: Service | null;
  categories: CategoryView[];
  branches: Branch[];
}) {
  const tr = (key: MessageKey) => t(locale, key);
  const number = (
    name: string,
    label: MessageKey,
    value: number,
    opts: { min: number; max: number; step: number },
  ) => (
    <div className="field">
      <label htmlFor={name}>{tr(label)}</label>
      <input
        id={name}
        name={name}
        type="number"
        dir="ltr"
        min={opts.min}
        max={opts.max}
        step={opts.step}
        required
        defaultValue={value}
      />
    </div>
  );
  return (
    <>
      <div className="grid2">
        <div className="field">
          <label htmlFor="titleEn">{tr('service.titleEn')}</label>
          <input
            id="titleEn"
            name="titleEn"
            type="text"
            dir="ltr"
            lang="en"
            minLength={2}
            maxLength={120}
            required
            defaultValue={service?.title.en ?? ''}
          />
        </div>
        <div className="field">
          <label htmlFor="titleAr">{tr('service.titleAr')}</label>
          <input
            id="titleAr"
            name="titleAr"
            type="text"
            dir="rtl"
            lang="ar"
            minLength={2}
            maxLength={120}
            required
            defaultValue={service?.title.ar ?? ''}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="descriptionEn">{tr('service.descriptionEn')}</label>
        <textarea
          id="descriptionEn"
          name="descriptionEn"
          dir="ltr"
          lang="en"
          rows={3}
          minLength={10}
          maxLength={2000}
          required
          defaultValue={service?.description.en ?? ''}
        />
      </div>
      <div className="field">
        <label htmlFor="descriptionAr">{tr('service.descriptionAr')}</label>
        <textarea
          id="descriptionAr"
          name="descriptionAr"
          dir="rtl"
          lang="ar"
          rows={3}
          minLength={10}
          maxLength={2000}
          required
          defaultValue={service?.description.ar ?? ''}
        />
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="categoryId">{tr('service.category')}</label>
          <select
            id="categoryId"
            name="categoryId"
            defaultValue={service?.categoryId ?? ''}
            required
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name[locale]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="price">{tr('service.price')}</label>
          <input
            id="price"
            name="price"
            type="text"
            dir="ltr"
            inputMode="decimal"
            required
            defaultValue={service ? aedInput(service.priceFils) : ''}
          />
        </div>
        {number('durationMin', 'service.duration', service?.durationMin ?? 60, {
          min: 5,
          max: 480,
          step: 5,
        })}
        {number('bufferBeforeMin', 'service.bufferBefore', service?.bufferBeforeMin ?? 0, {
          min: 0,
          max: 120,
          step: 5,
        })}
        {number('bufferAfterMin', 'service.bufferAfter', service?.bufferAfterMin ?? 0, {
          min: 0,
          max: 120,
          step: 5,
        })}
        {number('cancelCutoffHours', 'service.cutoff', service?.cancelCutoffHours ?? 24, {
          min: 0,
          max: 168,
          step: 1,
        })}
        {number(
          'lateRefundPercent',
          'service.lateRefund',
          (service?.lateCancelRefundBps ?? 0) / 100,
          { min: 0, max: 100, step: 1 },
        )}
      </div>
      <fieldset className="plain">
        <legend style={{ fontWeight: 600, marginBottom: 8 }}>{tr('service.branches')}</legend>
        <div className="chips">
          {branches.map((b) => (
            <label key={b.id} className="check">
              <input
                type="checkbox"
                name="branchIds"
                value={b.id}
                defaultChecked={service ? service.branchIds.includes(b.id) : true}
              />
              <span>{b.name[locale]}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
