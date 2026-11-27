import type { Locale } from './locales.js';

/**
 * UI copy lives here, never hard-coded in components.
 *
 * Arabic strings are working drafts and must be reviewed by a native speaker before launch.
 * `NEEDS_NATIVE_REVIEW` lists keys whose Arabic text has not been reviewed yet.
 */
const en = {
  'app.name': 'Marketplace',
  'app.scaffoldNotice': 'Foundation build. Features arrive in later phases.',
  'mode.shop': 'Shop Products',
  'mode.services': 'Book Services',
  'surface.customer': 'Customer app',
  'surface.business': 'Business portal',
  'surface.admin': 'Admin console',
  'language.switch': 'العربية',
} as const;

export type MessageKey = keyof typeof en;

const ar: Record<MessageKey, string> = {
  'app.name': 'السوق',
  'app.scaffoldNotice': 'نسخة تأسيسية. ستتوفر الميزات في المراحل القادمة.',
  'mode.shop': 'تسوّق المنتجات',
  'mode.services': 'احجز الخدمات',
  'surface.customer': 'تطبيق العملاء',
  'surface.business': 'بوابة الأعمال',
  'surface.admin': 'لوحة الإدارة',
  'language.switch': 'English',
};

export const catalogs: Record<Locale, Record<MessageKey, string>> = { en, ar };

export const NEEDS_NATIVE_REVIEW: readonly MessageKey[] = Object.keys(en) as MessageKey[];

export function t(locale: Locale, key: MessageKey): string {
  return catalogs[locale][key];
}
