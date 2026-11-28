# Launch checklist

What must be true before the **staging** deployment, the **pilot**, and **production**. An item is ticked only with evidence: a merged PR, a test run, or a sign-off by a named person. Nothing here is ticked by assumption.

Last updated: 28 November 2026. Related: [founder decisions](FOUNDER_DECISIONS.md), [costs](INFRASTRUCTURE_COSTS.md), [setup guide](FOUNDER_SETUP_GUIDE.md).

## Staging (needs founder approval to deploy)

- [ ] Founder confirms the Vercel plan and sets the spend limit and pause action (setup guide, step 1)
- [ ] Supabase staging project created (founder)
- [x] Phase 10 configuration merged: Vercel project files, cron routes, the PostgreSQL rate limiter, pooled connections (PR #23; nothing deployed)
- [ ] Migrations applied to staging through the direct connection
- [ ] Resend domain verified and staging key added (founder)
- [ ] Stripe test mode keys and webhook added (founder)
- [ ] Firebase project created and server key added (founder)
- [ ] Staging checks in setup guide section 10 pass, recorded with screenshots

## Pilot (Abu Dhabi, 30 days; needs founder approval to launch)

- [ ] Phases 8 to 12 merged with passing CI
- [ ] Founder approves the list of 30 product and 20 service businesses
- [ ] Pilot promotion (0% commission for each approved merchant's first 30 days) recorded and audited
- [ ] Merchants verified and onboarded; training guide sent
- [ ] Draft legal documents shown as drafts, with acceptance recorded. The founder decides whether the pilot may run on drafts
- [ ] Support rota for 9 AM–9 PM staffed
- [ ] Usage card below 80% of every free-tier limit
- [ ] Daily encrypted backup running, and one restore drill passed against staging
- [ ] Incident response procedure agreed

## Production (blocked until each item has a sign-off)

- [ ] **Malware scanning:** a real scanner is running. The ClamAV adapter is built; where it runs is a founder decision. Today this is a **blocker** (ADR-0032)
- [ ] **Data residency:** a lawyer confirms whether storing data in Mumbai is acceptable (no UAE region on Supabase)
- [ ] **Legal:** a lawyer approves every document and the per-emirate checklist. No lawyer is appointed yet
- [ ] **Tax:** a UAE tax adviser approves the VAT rules; JAYS's TRN status is confirmed. No adviser is appointed yet
- [ ] **Payments:** Stripe approves the UAE Connect configuration; the founder approves the fee model and live activation
- [ ] **Backups:** the founder approves where encrypted backups are kept
- [ ] **Capacity:** the free tiers are enough for the expected volume, or the founder approves the paid upgrade
- [ ] **App Store and Google Play:** accounts registered (official fees) and review passed
- [ ] **Real devices:** iOS and Android testing actually performed and recorded
- [ ] **Security review:** phase 11 review done (docs/SECURITY_REVIEW.md); no open high-severity code finding, but the scanner host and data residency are open, and no external penetration test has been done
