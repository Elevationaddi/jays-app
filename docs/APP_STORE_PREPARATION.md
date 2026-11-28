# App Store and Google Play preparation

Status: prepared, **not submitted**. No developer account has been registered and no fee has been paid. **No real-device testing has been performed.** Store listings, privacy answers and screenshots below are drafts for the founder and, where noted, the lawyer.

Last updated: 28 November 2026.

## 1. Fees (founder decision)

| Store                     | Fee                                                           | Type                  | Notes                                                                                                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple Developer Program   | **USD 99 a year** (Apple may show a local price at enrolment) | Annual membership     | Required to publish on the App Store. It is a recurring fee, so it needs the founder's explicit approval under the cost rule (ADR-0024), even though it is a store fee rather than a software subscription. An organisation account needs a D-U-N-S number, which is free. |
| Google Play Console       | **USD 25 once**                                               | One-time registration | Required to publish on Google Play. An organisation account needs a D-U-N-S number and identity verification.                                                                                                                                                              |
| Store commission on sales | None expected                                                 | n/a                   | JAYS sells physical goods and services used outside the app, which both stores allow to be paid with an outside payment provider (Stripe), not in-app purchase. To be confirmed at review.                                                                                 |

Prices were checked on 28 November 2026 and must be confirmed at enrolment. Sources: [Apple membership details](https://developer.apple.com/programs/whats-included/), [Apple enrolment](https://developer.apple.com/programs/enroll/), [Google Play registration](https://support.google.com/googleplay/android-developer/answer/6112435).

## 2. Building the apps without a paid service

- The customer app is built with Expo. Two routes:
  1. **Local builds (no service):** `npx expo prebuild`, then Xcode (needs a Mac) for iOS and Android Studio or Gradle for Android. No new account or cost beyond the store fees.
  2. **EAS Build (Expo's hosted service):** has a free plan with a monthly build allowance. It is a new external service, so it needs the founder's approval, and the plan's commercial-use terms must be checked first.
- Recommendation: local builds for the pilot. EAS only if a Mac is not available, and only after approval.
- Push notifications in the app (Firebase registration) need a development build and the Firebase project (ADR-0031). They are not wired in the app yet.

## 3. App configuration (done in `apps/customer/app.json`)

| Setting                           | Value                                                                                                                                      | Status                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| App name                          | JAYS                                                                                                                                       | Founder decision D1                                                                                                   |
| iOS bundle ID and Android package | `ae.jays.customer`                                                                                                                         | **Proposed.** It should match a domain JAYS controls, and it cannot change after the first upload. Founder to confirm |
| Version                           | 0.1.0, build 1 / version code 1                                                                                                            | Ready                                                                                                                 |
| Encryption                        | `ITSAppUsesNonExemptEncryption: false` (standard HTTPS only)                                                                               | Ready; answers Apple's export question                                                                                |
| Location                          | Only "when in use", only after tapping "Use my location"; background location blocked on both platforms; explanation in English and Arabic | Ready. The position is used on the device to suggest an emirate and is never sent to the server                       |
| Languages                         | English and Arabic, right to left in Arabic                                                                                                | Ready                                                                                                                 |
| Icons and splash screen           | Not made                                                                                                                                   | **Needed:** a 1024 × 1024 icon and a splash image from the brand designer                                             |

## 4. Store requirements checklist

| Requirement                                                                           | Status                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account deletion inside the app (Apple 5.1.1(v); Google Play account deletion policy) | Built (ADR-0019): request in the app, a 14-day grace period (proposed), statutory retention. Google Play also needs a **web link** for deletion requests; the founder must provide a page URL once the site exists |
| Privacy policy URL                                                                    | **Blocked:** the privacy policy is a draft (ADR-0028). A lawyer must approve it before submission                                                                                                                  |
| Terms and refund policies                                                             | Drafts only; same blocker                                                                                                                                                                                          |
| Sign in with Apple                                                                    | Not required: JAYS offers only its own email or phone sign-in, no third-party sign-in                                                                                                                              |
| Payments                                                                              | Stripe for physical goods and in-person services; no digital goods, so no in-app purchase. Live payments are not approved (D5); review can use test mode only if the founder accepts that                          |
| Demo account for reviewers                                                            | To create at submission: fictional customer account on staging, with notes in English                                                                                                                              |
| Age rating                                                                            | Proposed 4+ (Apple) / Everyone (Google): no user-generated adult content, reviews are moderated                                                                                                                    |
| User-generated content (reviews, photos)                                              | Reporting and moderation exist (ADR-0016); review notes should mention them                                                                                                                                        |
| Content in Arabic                                                                     | All screens and both listings                                                                                                                                                                                      |
| Real-device testing                                                                   | **Not performed.** Must be done on at least one recent iPhone and one Android phone before submission, and recorded in `IMPLEMENTATION_STATUS.md`                                                                  |

## 5. Privacy answers (draft for Apple's labels and Google's Data safety form)

Based on what the code collects. To be checked by the lawyer with the privacy policy.

| Data                             | Collected                                                                    | Linked to the person | Purpose                          | Shared with                                                 |
| -------------------------------- | ---------------------------------------------------------------------------- | -------------------- | -------------------------------- | ----------------------------------------------------------- |
| Name                             | Yes                                                                          | Yes                  | Account, orders, bookings        | The business fulfilling the order or booking                |
| Email address                    | Yes (if used to sign up)                                                     | Yes                  | Account, sign-in codes, receipts | Resend (email delivery)                                     |
| Phone number                     | Optional                                                                     | Yes                  | Delivery and appointments        | The business fulfilling the order                           |
| Delivery address                 | Yes, for deliveries                                                          | Yes                  | Delivery                         | The business and its courier                                |
| Precise location                 | **No**: read on the device only, never sent                                  | n/a                  | Suggest an emirate               | No one                                                      |
| Purchase history                 | Yes                                                                          | Yes                  | Orders, refunds, invoices        | The business; Stripe (payment)                              |
| Payment card details             | **No**: entered in Stripe's own form; JAYS never sees or stores card numbers | n/a                  | Payment                          | Stripe                                                      |
| Photos and files                 | Only those the person uploads (reviews, support)                             | Yes                  | Reviews, support                 | Business (reviews), support staff                           |
| Device push token                | When push is enabled                                                         | Yes                  | Notifications                    | Firebase Cloud Messaging                                    |
| Analytics, advertising, tracking | **None**                                                                     | n/a                  | n/a                              | No one. No tracking, so no App Tracking Transparency prompt |

- Data is encrypted in transit (HTTPS). People can request deletion in the app.
- Data is stored outside the UAE (Supabase, Mumbai). The lawyer must confirm this is acceptable and how to disclose it.

## 6. Store listing drafts

**Short description (Google Play, 80 characters)**

- English: Shop local stores and book beauty and home services across the UAE.
- Arabic: تسوّق من المتاجر المحلية واحجز خدمات التجميل والخدمات المنزلية في الإمارات.

**Description (both stores)**

- English: JAYS brings local shops and service businesses together in one app. Order products from verified UAE businesses, or book appointments at a venue or at home, in English or Arabic. Prices include VAT where it applies, and every order and booking shows the business you are dealing with. Track deliveries, manage bookings, leave reviews and get help from support in the app.
- Arabic: يجمع JAYS المتاجر المحلية ومقدمي الخدمات في تطبيق واحد. اطلب المنتجات من أعمال موثّقة في الإمارات، أو احجز موعداً في المقر أو في المنزل، بالعربية أو الإنجليزية. تشمل الأسعار ضريبة القيمة المضافة حيث تنطبق، ويظهر في كل طلب وحجز اسم النشاط التجاري الذي تتعامل معه. تابع التوصيل، وأدر حجوزاتك، واكتب تقييماتك، واحصل على المساعدة من الدعم داخل التطبيق.

Claims about VAT and verification must stay true to what the founder and tax adviser approve before publishing.

**Screenshots needed**

- iPhone 6.9-inch display set (Apple's required size), Android phone set; English and Arabic.
- Taken from a real or simulator build with fictional data only. Existing web screenshots in `docs/screenshots/` are references, not store assets.

## 7. Submission steps (after approvals)

1. Founder approves the fees and registers both accounts (setup guide, step 9).
2. Founder confirms the bundle ID and provides the icon, splash image and a support URL.
3. Lawyer approves the privacy policy and terms; their URLs go into both listings.
4. Build signed release builds (section 2) against **production** configuration, which itself needs approval.
5. Real-device testing on iOS and Android, recorded with the devices and OS versions used.
6. Upload to TestFlight and Google Play internal testing; pilot testers only.
7. Submit for review with the demo account and review notes.
