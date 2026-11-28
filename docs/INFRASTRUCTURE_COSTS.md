# Infrastructure costs

Every external dependency JAYS uses or may need, what it costs, its limits, and when the founder must approve something. Rule: no paid software subscriptions beyond Vercel, ChatGPT and Claude ([ADR-0024](adr/0024-cost-constraints-and-vercel-first-architecture.md)).

**How the figures were checked.**

- **Prices and limits** were read from the providers' official pages on **28 November 2026**, and each line names its source. Providers change prices: check the source again before approving anything.
- **"Not verified":** where a figure was not checked on that date, it says so. No price is guessed.
- **Nothing is active.** No paid service is registered or active, and nothing is deployed.

## 1. Dependency register

### Vercel: hosting (existing subscription)

| Item                    | Value                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Purpose                 | Host the API (Node.js function), business portal, admin console and customer web build; run scheduled jobs (Vercel Cron)                                                                                                                                                                                                                               |
| Selected plan           | The founder's existing plan. The figures below are for **Pro**; which plan the account is on still needs confirming (setup guide, step 1)                                                                                                                                                                                                              |
| Mandatory monthly cost  | Pro: **$20 a month** platform fee, which includes a $20 usage credit; $20 a month for each extra deploying seat                                                                                                                                                                                                                                        |
| Annual cost             | $240 for one seat (already paid as part of the existing subscription)                                                                                                                                                                                                                                                                                  |
| Transaction fees        | None                                                                                                                                                                                                                                                                                                                                                   |
| Usage limits            | Functions: 300 s by default, 800 s at most (Pro, Fluid compute); 2 GB memory by default, 4 GB at most. Request and response bodies: 4.5 MB. Cron: 100 jobs per project, at most **once a minute** on Pro (once a day on Hobby). Content delivery on Pro: 1 million requests and 1 TB transfer a month. Runtime logs kept 1 day on Pro, 1 hour on Hobby |
| Commercial use          | Allowed on Pro. Hobby's commercial-use terms were not read in this review: use Pro for JAYS                                                                                                                                                                                                                                                            |
| Credit card             | Already on the account                                                                                                                                                                                                                                                                                                                                 |
| Automatic billing       | Usage beyond the included credit is billed. Spend management can alert and act at a threshold; new accounts are alerted at $200 per cycle by default. **Set a low spend alert and the "pause projects" action before any deployment** (setup guide)                                                                                                    |
| Region                  | Default function region is Washington, D.C. (`iad1`). Pro can use up to 5 regions. Vercel has announced a Dubai region (`dxb1`). JAYS will run functions in Mumbai (`bom1`), next to the database                                                                                                                                                      |
| Expected pilot usage    | About 160,000 function requests and about 10 GB transfer a month (section 2). Expected to stay within the included credit; to be confirmed from the usage dashboard in staging                                                                                                                                                                         |
| Expected production use | Can exceed the $20 credit at 500 or more businesses (section 2)                                                                                                                                                                                                                                                                                        |
| Over the limit          | Overages are billed unless spend management pauses the projects; pausing takes the site offline                                                                                                                                                                                                                                                        |
| Alternatives            | Any Node.js host: the Docker image from ADR-0017 still builds. Each would be a new subscription or free tier, so it needs approval                                                                                                                                                                                                                     |
| Founder approval        | Yes, for deployment, extra seats and any spend beyond the credit                                                                                                                                                                                                                                                                                       |
| Sources (28 Nov 2026)   | https://vercel.com/docs/plans/pro-plan · https://vercel.com/docs/functions/limitations · https://vercel.com/docs/limits · https://vercel.com/docs/cron-jobs/usage-and-pricing · https://vercel.com/changelog/introducing-the-dubai-vercel-region-dxb1                                                                                                  |

### Supabase: PostgreSQL and file storage (Free)

| Item                    | Value                                                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                 | Production and staging PostgreSQL (the same SQL migrations); private storage buckets with signed upload and download links                                                                                                                                                      |
| Selected plan           | Free                                                                                                                                                                                                                                                                            |
| Mandatory monthly cost  | $0                                                                                                                                                                                                                                                                              |
| Annual cost             | $0                                                                                                                                                                                                                                                                              |
| Transaction fees        | None                                                                                                                                                                                                                                                                            |
| Usage limits            | 2 active projects; **500 MB database** per project; **1 GB storage**; 50 MB largest file; **5 GB egress** (plus 5 GB cached); 50,000 monthly active users (Supabase Auth, which JAYS does not use); 1-day logs; **no automatic backups**; **paused after 1 week of inactivity** |
| Commercial use          | Not stated on the pages read. To confirm in Supabase's terms before production                                                                                                                                                                                                  |
| Credit card             | Not required for Free                                                                                                                                                                                                                                                           |
| Automatic billing       | None on Free                                                                                                                                                                                                                                                                    |
| Region                  | **No Middle East region.** Nearest: Mumbai (`ap-south-1`) and Frankfurt. Customer data would be stored outside the UAE (legal question)                                                                                                                                         |
| Expected pilot usage    | Database about 50 MB in the first months; storage about 700 MB; Supabase egress about 1 GB a month if the CDN caches public images                                                                                                                                              |
| Expected production use | Storage passes 1 GB at about 100 businesses; the database passes 500 MB at about 500 businesses (section 2)                                                                                                                                                                     |
| Over the limit          | Free projects are restricted, not billed. A paused project stops the whole site until it is restored                                                                                                                                                                            |
| Alternatives            | Supabase Pro (paid; price not verified in this review); Vercel Blob for storage within the Vercel plan (usage against the credit; not priced in this review); any PostgreSQL host                                                                                               |
| Founder approval        | Yes, before any paid plan or add-on                                                                                                                                                                                                                                             |
| Sources (28 Nov 2026)   | https://supabase.com/pricing · https://supabase.com/docs/guides/platform/billing-on-supabase · https://supabase.com/docs/guides/platform/regions                                                                                                                                |

### Stripe Connect: payments (per transaction, test mode only)

| Item                   | Value                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                | Card, Apple Pay and Google Pay payments for orders and bookings; connected accounts for merchants; refunds, disputes and payouts                                                                                                                                                                                                            |
| Selected plan          | Connect with **"Stripe handles pricing for your users"**, which has no platform fees. To be confirmed with Stripe for a UAE marketplace where merchants are the sellers                                                                                                                                                                     |
| Mandatory monthly cost | $0 under "Stripe handles pricing". The alternative, "you handle pricing", costs **AED 7.50 per monthly active account** plus **0.25% + AED 5.50 per payout**; it is not selected                                                                                                                                                            |
| Annual cost            | $0 fixed                                                                                                                                                                                                                                                                                                                                    |
| Transaction fees       | **2.9% + AED 1.00** per successful domestic card payment; **+1%** for international cards; **+1%** with currency conversion. Refunds have no extra fee, but the original fees are not returned. Disputes **AED 60** each, plus AED 60 to counter manually (returned if won). Standard payouts free. Instant payouts 1.5% (minimum AED 2.00) |
| Usage limits           | Subject to Stripe's account approval and the UAE Connect rules for marketplaces                                                                                                                                                                                                                                                             |
| Commercial use         | Yes                                                                                                                                                                                                                                                                                                                                         |
| Credit card            | No. A business bank account and verification are needed for live mode                                                                                                                                                                                                                                                                       |
| Automatic billing      | Fees are deducted from each transaction                                                                                                                                                                                                                                                                                                     |
| Region                 | Stripe UAE                                                                                                                                                                                                                                                                                                                                  |
| Expected pilot usage   | About AED 37,500 a month in sales gives about AED 1,300 in fees (section 2). Who bears them, the merchant or JAYS, is a commercial decision                                                                                                                                                                                                 |
| Over the limit         | Not applicable                                                                                                                                                                                                                                                                                                                              |
| Alternatives           | Other UAE payment providers (not reviewed). The provider adapter is replaceable                                                                                                                                                                                                                                                             |
| Founder approval       | **Yes**: the fee model, the Connect configuration, and any live activation                                                                                                                                                                                                                                                                  |
| Sources (28 Nov 2026)  | https://stripe.com/ae/pricing · https://stripe.com/ae/connect/pricing                                                                                                                                                                                                                                                                       |

### Resend: transactional email (Free)

| Item                    | Value                                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                 | Verification, password reset, security alerts, order, booking, refund and payout emails in English and Arabic                                                                                |
| Selected plan           | Free                                                                                                                                                                                         |
| Mandatory monthly cost  | $0                                                                                                                                                                                           |
| Annual cost             | $0                                                                                                                                                                                           |
| Transaction fees        | None                                                                                                                                                                                         |
| Usage limits            | **100 emails a day**; **3,000 a month**; 3 verified domains; 10 requests a second; logs kept 30 days. Keep bounces under 4% and spam complaints under 0.08%                                  |
| Commercial use          | Not stated on the pages read. To confirm in Resend's terms                                                                                                                                   |
| Credit card             | Not stated for Free                                                                                                                                                                          |
| Automatic billing       | Free cannot use overages                                                                                                                                                                     |
| Region                  | Not reviewed                                                                                                                                                                                 |
| Expected pilot usage    | About 900 emails a month and about 30 a day on average, with peaks close to 100 (section 2)                                                                                                  |
| Expected production use | Over 3,000 a month from about 100 businesses and 1,000 customers                                                                                                                             |
| Over the limit          | Resend answers HTTP 429 and does not queue the email. JAYS keeps the event in the outbox and retries later. Essential and security email have priority; everything else stays in-app or push |
| Alternatives            | Resend paid plans (price not verified in this review); another free email provider; push and in-app only for non-security messages                                                           |
| Founder approval        | Yes, before any paid plan                                                                                                                                                                    |
| Sources (28 Nov 2026)   | https://resend.com/pricing.md · https://resend.com/docs/knowledge-base/resend-sending-limits                                                                                                 |

### Firebase Cloud Messaging: push (Spark, no cost)

| Item                   | Value                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------- |
| Purpose                | Push notifications to the iOS and Android apps                                          |
| Selected plan          | Spark (no cost)                                                                         |
| Mandatory monthly cost | $0                                                                                      |
| Annual cost            | $0                                                                                      |
| Transaction fees       | None                                                                                    |
| Usage limits           | Cloud Messaging is listed as a no-cost product                                          |
| Commercial use         | Yes (Firebase terms)                                                                    |
| Credit card            | **No**: "No payment method needed" on Spark                                             |
| Automatic billing      | None on Spark. Do not upgrade to the pay-as-you-go plan (Blaze)                         |
| Region                 | Google global infrastructure                                                            |
| Expected pilot usage   | A few thousand messages a month                                                         |
| Over the limit         | Not applicable for Cloud Messaging                                                      |
| Alternatives           | Expo's push service (free; not reviewed), which also relays through Firebase on Android |
| Founder approval       | No, for Spark. Yes, for any paid Firebase product                                       |
| Sources (28 Nov 2026)  | https://firebase.google.com/pricing                                                     |

### GitHub: code, CI and backups (Free)

| Item                   | Value                                                                                                                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                | Repository, CI, the daily encrypted database backup workflow (ADR-0024), the monthly restore drill                                                                                                                                                                                           |
| Selected plan          | GitHub Free                                                                                                                                                                                                                                                                                  |
| Mandatory monthly cost | $0                                                                                                                                                                                                                                                                                           |
| Usage limits           | Actions minutes and artifact storage for private repositories are limited on Free. The exact allowance was **not verified in this review**; check https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions |
| Over the limit         | Workflows stop until the next cycle. Never add a payment method to lift the limit without approval                                                                                                                                                                                           |
| Founder approval       | Yes, for any paid GitHub plan                                                                                                                                                                                                                                                                |

### ClamAV: malware scanning (open source, hosting undecided)

| Item             | Value                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Purpose          | Scan uploaded business documents and attachments before release                                                                                                                                                                            |
| Cost             | Software free. It cannot run reliably inside a Vercel function (signature database of a few hundred MB, daily updates, memory). It needs a small always-on machine. A free virtual machine for commercial use usually needs a card on file |
| Status           | **Production blocker** until the founder approves where it runs. Until then, images are re-encoded and documents stay quarantined, visible only to compliance admins with a warning (ADR-0024, section 6)                                  |
| Founder approval | Yes                                                                                                                                                                                                                                        |

### Fees that are not software subscriptions

| Item                                | Cost                                                         | Notes                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple Developer Program (App Store) | Annual membership fee, commonly USD 99. **Not verified**     | Required to publish the iOS app. Official registration fee, not an optional software subscription. Source to check: https://developer.apple.com/programs/ |
| Google Play Console                 | One-time registration fee, commonly USD 25. **Not verified** | Required to publish the Android app. Source to check: https://support.google.com/googleplay/android-developer/answer/6112435                              |
| Domain name                         | Registrar's annual fee (not priced here)                     | Needed for the site, email sending (Resend domain verification) and links. Any registrar, or Vercel Domains                                               |

## 2. Scale estimates

### Assumptions

These figures are planning estimates, not measurements. They should be checked against real usage in staging.

**Customers and orders**

- **Active customers:** 60% of registered customers in a month.
- **API traffic:** each active customer makes 6 visits a month of about 40 API requests each (240 requests).
- **Orders and bookings:** 0.4 orders and 0.3 bookings per active customer a month.
- **Average values:** an order averages AED 200; a booking averages AED 150.
- **Product and service mix:** 60% of businesses sell products and 40% offer services.

**Business users**

- Each business user makes 30 portal visits a month of about 60 requests each (1,800 requests).

**Email (essential only)**

- Each order: 3 emails (confirmed, dispatched, delivered).
- Each booking: 2 emails (confirmed, reminder).
- Sign-ups: 1 email for each new customer; new customers are 20% of the base a month.
- Password resets: 5% of active customers.
- Refunds: 1 email for each refund (5% of orders).
- Payouts: 4 payout emails per business.

**Database**

- About 20 KB per order and 15 KB per booking, including audit, ledger and outbox rows.
- Catalog: about 5 KB per product, 40 products per shop.

**Storage**

- Product images: 3 per product, re-encoded to about 150 KB.
- Business documents: 2 MB per business.
- Review and support photos: about 10% of the catalog size.

**Image traffic**

- 30 product images seen per visit.
- The Vercel CDN serves 90% of repeat views. Supabase serves the rest.

### Results

| Scenario                           | API requests a month | Orders + bookings a month | Essential emails a month (daily average) | Database after 12 months | File storage | Supabase egress a month | Card fees a month (sales)       | Within free tiers?                                                                                                                                                                                            |
| ---------------------------------- | -------------------- | ------------------------- | ---------------------------------------- | ------------------------ | ------------ | ----------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development                        | Negligible           | Test data                 | Under 100 (mock locally)                 | Under 50 MB              | Under 100 MB | Negligible              | None (test mode)                | Yes. Local Docker database; Supabase staging only for checks                                                                                                                                                  |
| 50 businesses, 500 customers       | ~160,000             | 120 + 90                  | ~900 (~30, peaks near 100)               | ~80 MB                   | ~700 MB      | ~1 GB                   | ~AED 1,300 (AED 37,500 sales)   | **Yes, but tight:** Resend's 100-a-day limit on busy days, and storage at 70% of 1 GB                                                                                                                         |
| 100 businesses, 1,000 customers    | ~320,000             | 240 + 180                 | ~1,800 (~60, peaks over 100)             | ~150 MB                  | ~1.3 GB      | ~2 GB                   | ~AED 2,600 (AED 75,000 sales)   | **No:** storage passes 1 GB; Resend's daily limit is exceeded on busy days. Needs a storage decision (Supabase paid, or Vercel Blob within the Vercel credit) and email prioritisation                        |
| 500 businesses, 10,000 customers   | ~2.3 million         | 2,400 + 1,800             | ~15,000 (~500)                           | ~1 GB                    | ~7 GB        | ~16 GB                  | ~AED 26,000 (AED 750,000 sales) | **No:** database, storage, egress and email all exceed free tiers. Needs Supabase paid and a paid email plan, or email cut to security-only. Vercel usage may exceed the $20 credit                           |
| 1,000 businesses, 50,000 customers | ~9 million           | 12,000 + 9,000            | ~75,000 (~2,500)                         | ~5 GB                    | ~14 GB       | ~80 GB                  | ~AED 130,000 (AED 3.75M sales)  | **No:** needs paid database, storage and email plans and Vercel usage beyond the credit; image transfer (about 800 GB) approaches Vercel's 1 TB. A capacity review and load test are needed before this scale |

### What this means

- **The 30-day pilot** (about 50 businesses and up to a few hundred customers) fits the free tiers. It depends on:
  - re-encoded images;
  - CDN caching of public images;
  - email limited to essential messages.
- The usage card (phase 10) warns at 80% of each limit.
- **The first paid decision** comes at about 100 businesses: file storage. Email follows soon after.
- **Card processing fees are the largest cost at every scale.** They are deducted per transaction. Whether merchants, JAYS or customers bear them is a commercial decision.
- **No zero-cost claim is made for production.** Beyond the pilot, the free tiers run out.
