import { BRAND as APP_BRAND, type Locale } from '@jays/i18n';
import type { MessageTemplate, OutboundMessage } from '../auth/notifier.js';
import { ADMIN_INVITE_TTL_SECONDS, OTP_TTL_SECONDS } from '../auth/policy.js';

const OTP_MIN = OTP_TTL_SECONDS / 60;
const INVITE_H = ADMIN_INVITE_TTL_SECONDS / 3600;

/**
 * Transactional email in English and Arabic (ADR-0031). Plain, inline-styled HTML that renders
 * in common mail clients, with a text part. Every value is escaped; links must be https (or
 * http on localhost) and are shown in full so people can see where they lead.
 */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Security email keeps its share of the daily allowance (ADR-0024 section 7). */
export const ESSENTIAL_TEMPLATES: ReadonlySet<MessageTemplate> = new Set([
  'otp.verify_contact',
  'otp.password_reset',
  'account.exists',
  'admin.invite',
]);

const BRAND = APP_BRAND.name;

type Copy = { subject: string; lines: string[]; footer: string };

const FOOTER = {
  en: `You received this email because of activity on your ${BRAND.en} account. If this was not you, you can ignore it.`,
  ar: `وصلتك هذه الرسالة بسبب نشاط على حسابك في ${BRAND.ar}. إن لم يكن هذا أنت، يمكنك تجاهلها.`,
} as const;

function copy(template: MessageTemplate, locale: Locale, p: Record<string, string>): Copy {
  const footer = FOOTER[locale];
  const en = locale === 'en';
  switch (template) {
    case 'otp.verify_contact':
      return {
        subject: en
          ? `Your ${BRAND.en} code: ${p['code'] ?? ''}`
          : `رمزك في ${BRAND.ar}: ${p['code'] ?? ''}`,
        lines: en
          ? [
              'Use this code to verify your email address:',
              `{code}`,
              `It expires in ${OTP_MIN} minutes.`,
            ]
          : [
              'استخدم هذا الرمز لتأكيد بريدك الإلكتروني:',
              `{code}`,
              `تنتهي صلاحيته خلال ${OTP_MIN} دقائق.`,
            ],
        footer,
      };
    case 'otp.password_reset':
      return {
        subject: en ? `Reset your ${BRAND.en} password` : `إعادة تعيين كلمة المرور في ${BRAND.ar}`,
        lines: en
          ? [
              'Use this code to reset your password:',
              `{code}`,
              `It expires in ${OTP_MIN} minutes. If you did not ask for this, your password has not changed.`,
            ]
          : [
              'استخدم هذا الرمز لإعادة تعيين كلمة المرور:',
              `{code}`,
              `تنتهي صلاحيته خلال ${OTP_MIN} دقائق. إن لم تطلب ذلك، فكلمة مرورك لم تتغير.`,
            ],
        footer,
      };
    case 'account.exists':
      return {
        subject: en ? `You already have a ${BRAND.en} account` : `لديك حساب في ${BRAND.ar} بالفعل`,
        lines: en
          ? [
              `Someone tried to create a ${BRAND.en} account with this email address, but it already has one.`,
              'Sign in instead, or reset your password if you have forgotten it.',
            ]
          : [
              `حاول أحدهم إنشاء حساب في ${BRAND.ar} بهذا البريد الإلكتروني، لكن لديه حساب بالفعل.`,
              'سجّل الدخول بدلًا من ذلك، أو أعد تعيين كلمة المرور إن نسيتها.',
            ],
        footer,
      };
    case 'admin.invite':
      return {
        subject: en ? `Your ${BRAND.en} admin invitation` : `دعوتك إلى إدارة ${BRAND.ar}`,
        lines: en
          ? [
              `You have been invited to the ${BRAND.en} admin console. Open this link to set your password and authenticator:`,
              `{link}`,
              `The link works once and expires in ${INVITE_H} hours.`,
            ]
          : [
              `تمت دعوتك إلى لوحة إدارة ${BRAND.ar}. افتح هذا الرابط لتعيين كلمة المرور وتطبيق المصادقة:`,
              `{link}`,
              `يعمل الرابط مرة واحدة وتنتهي صلاحيته خلال ${INVITE_H} ساعة.`,
            ],
        footer: en
          ? 'If you did not expect this invitation, ignore this email.'
          : 'إن لم تكن تتوقع هذه الدعوة، تجاهل هذه الرسالة.',
      };
    case 'notification':
      return {
        subject: p['title'] ?? BRAND[locale],
        lines: [p['body'] ?? ''],
        footer: en
          ? 'You can turn off email notifications in your account settings.'
          : 'يمكنك إيقاف إشعارات البريد الإلكتروني من إعدادات حسابك.',
      };
  }
}

const escape = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** Only https links (or http on localhost for development) are rendered as links. */
export function safeLink(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return url.toString();
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) {
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export function renderEmail(message: OutboundMessage): RenderedEmail {
  const { locale, params } = message;
  const c = copy(message.template, locale, params);
  const rtl = locale === 'ar';
  const link = safeLink(params['link']);
  const code = params['code'] ?? '';
  const htmlLine = (line: string) => {
    if (line === '{code}') {
      return `<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0;direction:ltr;text-align:center">${escape(code)}</p>`;
    }
    if (line === '{link}') {
      return link
        ? `<p style="margin:16px 0"><a href="${escape(link)}" style="color:#6b2d5c">${escape(link)}</a></p>`
        : '';
    }
    return `<p style="margin:0 0 12px">${escape(line)}</p>`;
  };
  const textLine = (line: string) =>
    line === '{code}' ? code : line === '{link}' ? (link ?? '') : line;
  const html = `<!doctype html>
<html lang="${locale}" dir="${rtl ? 'rtl' : 'ltr'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(c.subject)}</title></head>
<body style="margin:0;background:#f7f4f1;font-family:Arial,Tahoma,sans-serif;color:#1f1a1c">
<div style="max-width:560px;margin:0 auto;padding:24px;text-align:${rtl ? 'right' : 'left'}">
<p style="font-size:20px;font-weight:700;color:#6b2d5c;margin:0 0 16px">${BRAND[locale]}</p>
<div style="background:#ffffff;border-radius:12px;padding:24px;line-height:1.6">
${c.lines.map(htmlLine).join('\n')}
</div>
<p style="font-size:12px;color:#6b6266;margin:16px 0 0">${escape(c.footer)}</p>
</div>
</body>
</html>`;
  const text = [BRAND[locale], '', ...c.lines.map(textLine), '', c.footer].join('\n');
  return { subject: c.subject.slice(0, 200), html, text };
}
