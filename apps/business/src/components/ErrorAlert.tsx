import { t, type Locale } from '@jays/i18n';
import { errorMessageKey } from '../lib/errors';

export function ErrorAlert({
  locale,
  code,
  retryAfter,
}: {
  locale: Locale;
  code?: string | undefined;
  retryAfter?: string | undefined;
}) {
  const key = errorMessageKey(code);
  if (!key) return null;
  return (
    <div className="alert error" role="alert">
      {t(locale, key, { seconds: retryAfter ?? '60' })}
    </div>
  );
}
