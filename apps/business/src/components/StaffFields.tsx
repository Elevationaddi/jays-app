import type { Branch, Member, Service, Staff } from '@jays/contracts';
import { t, type Locale, type MessageKey } from '@jays/i18n';

/** Name, linked member, branches and services of a staff profile. */
export function StaffFields({
  locale,
  staff,
  members,
  branches,
  services,
}: {
  locale: Locale;
  staff: Staff | null;
  members: Member[];
  branches: Branch[];
  services: Service[];
}) {
  const tr = (key: MessageKey) => t(locale, key);
  return (
    <>
      <div className="grid2">
        <div className="field">
          <label htmlFor="displayName">{tr('staff.name')}</label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            maxLength={80}
            required
            defaultValue={staff?.displayName ?? ''}
          />
        </div>
        <div className="field">
          <label htmlFor="membershipId">{tr('staff.member')}</label>
          <select id="membershipId" name="membershipId" defaultValue={staff?.membershipId ?? ''}>
            <option value="">{tr('staff.noMember')}</option>
            {members
              .filter((m) => m.status === 'active')
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName ?? m.contact}
                </option>
              ))}
          </select>
        </div>
      </div>
      <fieldset className="plain">
        <legend style={{ fontWeight: 600, marginBottom: 8 }}>{tr('staff.branches')}</legend>
        <div className="chips">
          {branches.map((b) => (
            <label key={b.id} className="check">
              <input
                type="checkbox"
                name="branchIds"
                value={b.id}
                defaultChecked={staff ? staff.branchIds.includes(b.id) : branches.length === 1}
              />
              <span>{b.name[locale]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="plain" style={{ marginTop: 12 }}>
        <legend style={{ fontWeight: 600, marginBottom: 8 }}>{tr('staff.services')}</legend>
        <div className="chips">
          {services.map((s) => (
            <label key={s.id} className="check">
              <input
                type="checkbox"
                name="serviceIds"
                value={s.id}
                defaultChecked={staff ? staff.serviceIds.includes(s.id) : true}
              />
              <span>{s.title[locale]}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
