/**
 * Branding in one place (founder decision D1, ADR-0018). "JAYS" is the working name, pending final
 * branding and trademark approval. Change it here and every surface follows: web titles and top
 * bars, the customer app, notification templates that use {app}, and the admin TOTP issuer.
 * Colors live in @jays/ui tokens; the Expo display name is in apps/customer/app.json.
 */
export const BRAND = {
  /** The Arabic name is not chosen yet, so the Latin working name is used in both languages. */
  name: { en: 'JAYS', ar: 'JAYS' },
  /** Shown in authenticator apps next to admin codes. */
  adminIssuer: 'JAYS Admin',
  /** True until branding and trademark are approved; surfaces can show a "working name" note. */
  provisional: true,
} as const;
