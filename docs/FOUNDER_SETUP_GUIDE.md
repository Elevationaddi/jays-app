# Founder setup guide

Step-by-step instructions for the accounts JAYS needs. Every account here is free, or one you already have, except Stripe, which charges only per payment and stays in **test mode**.

**Before you start**

- **Never paste a key into a chat**, an email or a document. Keys go only into Vercel's environment variables, as described below. If a key is ever exposed, delete it in the provider's dashboard and create a new one.
- **Never add a payment method, start a trial or upgrade a plan** while following this guide. The only exception is your existing Vercel subscription. If a screen asks for a card to continue, stop and ask.
- The variable names below match the code planned for phases 9 and 10. The file `.env.example` in the repository is the final reference, and it will be updated when those phases land.

## 1. Vercel (you already have it)

1. Sign in at https://vercel.com.
2. Open **Settings → Billing** and note your plan (Hobby or Pro). JAYS needs **Pro**: it allows commercial use, cron jobs every minute and longer function times. Tell the team which plan you are on.
3. **Turn on spend protection now.**
   - Go to **Settings → Billing → Spend Management**.
   - Set a low monthly amount, for example the $20 included credit.
   - Turn on the email alert.
   - Turn on **"Pause production deployment"** when the amount is reached.

   This stops unexpected charges.

4. **Do not create projects yet.** The team prepares the configuration in phase 10. You will be asked to approve the first deployment.

## 2. Supabase: database and file storage (Free)

You will create **two** projects: one for staging and one for production. Supabase Free allows two.

1. Go to https://supabase.com and sign up with your work email (GitHub sign-in also works).
2. Create an organisation and choose the **Free** plan. Do not add a card.
3. Click **New project**:
   - **Name:** `jays-staging`
   - **Database password:** use the generator, then store it in your password manager.
   - **Region:** **South Asia (Mumbai)**. There is no UAE region. Data stored outside the UAE is a legal point on the review checklist.
4. Repeat for `jays-production`.
5. In each project, open **Project Settings → Database → Connection string**. You need two values:
   - **Transaction pooler** (port 6543): this becomes `DATABASE_URL`.
   - **Direct connection** (port 5432): this becomes `DATABASE_DIRECT_URL`, used only for migrations.
6. In each project, open **Project Settings → API**. Copy the **Project URL** (`SUPABASE_URL`) and the **service_role** key (`SUPABASE_SERVICE_ROLE_KEY`).
   - The service role key bypasses all security. It goes **only** into the API project's server-side variables in Vercel, never into a mobile app or a public website.
7. **Storage:**
   - The team's setup script creates the private buckets.
   - Do not create public buckets by hand.
8. **Free projects pause after a week with no activity.** Staging may pause. Restore it from the dashboard when needed. Production will have regular traffic during the pilot.

## 3. Resend: email (Free)

1. Go to https://resend.com and sign up. Stay on the **Free** plan, which allows 100 emails a day and 3,000 a month.
2. **Add your domain:**
   - Go to **Domains → Add Domain** and enter the domain JAYS will send from, for example `mail.yourdomain.ae`.
   - Resend shows DNS records (SPF, DKIM, and optionally DMARC). Add them where your domain's DNS is managed (your registrar, or Vercel if the domain is on Vercel).
   - Wait until the domain shows **Verified**.
3. **Create the API keys:**
   - Go to **API Keys → Create API Key**.
   - Choose **Sending access** only, and restrict the key to your domain.
   - Create one key for staging and one for production. Each key is shown once: put it straight into Vercel (step 7).
4. The sender address becomes `EMAIL_FROM`, for example `JAYS <no-reply@mail.yourdomain.ae>`.
5. Set `NOTIFY_PROVIDER=resend`. JAYS counts its own email and stops non-essential email at 80 a day (80% of the allowance), keeping the rest for sign-in codes. Leave `EMAIL_DAILY_LIMIT` and `EMAIL_MONTHLY_LIMIT` at their defaults (100 and 3,000), which match the Free plan.
6. There is no SMS. With Resend, customers sign up and reset passwords with an email address only.

## 4. Stripe: payments (test mode only)

1. Go to https://dashboard.stripe.com/register and create an account with **United Arab Emirates** as the country.
2. Keep the **Test mode** switch on. Do not complete "Activate payments". Live payments need your separate approval later.
3. **Turn on Connect:**
   - In test mode, open **Connect → Get started**.
   - Choose the **platform/marketplace** option.
   - Where Stripe asks who handles pricing, choose **"Stripe handles pricing for your users"**. This option has no platform fees; the other option adds AED 7.50 per active merchant each month plus a fee per payout.
   - If Stripe says a UAE marketplace configuration is not available, stop and tell the team.
4. **Copy the test keys:** go to **Developers → API keys**.
   - The **Secret key** starts with `sk_test_`. It becomes `PSP_API_KEY`.
   - The **Publishable key** starts with `pk_test_`. It becomes `PSP_PUBLISHABLE_KEY`.
   - JAYS refuses to start with a live key (`sk_live_` or `pk_live_`), so a mistake here cannot take a real payment.
5. **Add the webhooks:** this is done after the first staging deployment, because it needs the staging address. Use API version `2024-06-20` for both, so the events match what JAYS reads.
   - Go to **Developers → Webhooks → Add endpoint**.
   - **URL:** `https://<staging API address>/v1/webhooks/payments`.
   - **Events:** `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `refund.created`, `refund.updated`, `refund.failed`, `transfer.created` and `transfer.reversed`.
   - Copy the **Signing secret** (`whsec_…`). It becomes `PSP_WEBHOOK_SECRET`.
   - Add a **second endpoint** with the same URL, and choose **Events on Connected accounts**. Select `account.updated`. Its signing secret becomes `PSP_CONNECT_WEBHOOK_SECRET`.
6. Set `PSP_PROVIDER=stripe`. Production stays switched off for payments until you approve going live.
7. **Check it with the team:** businesses open **Finance → Set up payouts with Stripe** in the business portal. In test mode Stripe accepts its documented test details, so no real identity or bank account is needed.

## 5. Firebase: push notifications (Spark, no cost)

1. Go to https://console.firebase.google.com and click **Add project**. Name it `jays`. Google Analytics is optional; you can turn it off.
2. Stay on the **Spark** plan. **Never** click "Upgrade" to Blaze.
3. **Add the apps:**
   - **Android:** click **Add app → Android** with the package name the team gives you, and download `google-services.json`.
   - **iOS:** click **Add app → Apple** with the bundle ID, and download `GoogleService-Info.plist`.
   - Both files are needed only for building the mobile apps. Send them to the team through a shared private folder, not chat.
4. **Create the server key:**
   - Go to **Project settings → Service accounts → Generate new private key**.
   - This downloads a JSON file. Its whole content becomes `FCM_SERVICE_ACCOUNT_JSON`, set only on the API project in Vercel.
   - Set `PUSH_PROVIDER=fcm`. Keep the project on **Spark**: sending push messages is free there.
5. **iOS push:** this needs an APNs key from your Apple Developer account (see section 9).
   - Upload it under **Project settings → Cloud Messaging → Apple app configuration**.

## 6. GitHub: backups

The daily encrypted database backup runs in GitHub Actions (free).

1. In the repository, open **Settings → Secrets and variables → Actions**.
2. Add these secrets:
   - `BACKUP_DATABASE_URL`: the **direct** production connection string from step 2.5.
   - `BACKUP_PASSPHRASE`: a long random passphrase. Keep a copy in your password manager. Without it, backups cannot be restored.
3. Do not add a payment method to GitHub to get more Actions minutes.

## 7. Adding keys in Vercel

When the team asks, after the projects exist:

1. Open the project in Vercel (for example `jays-api`).
2. Go to **Settings → Environment Variables**.
3. Add each key:
   - **Name:** the variable name, for example `PSP_API_KEY`.
   - **Value:** paste the key.
   - **Environments:** tick **Preview** for staging values, or **Production** for production values. Staging and production must use different keys and different Supabase projects.
   - Mark it **Sensitive**.
4. Save, then ask the team to redeploy.

| Variable                                                                                  | Project          | Where it comes from                                                           |
| ----------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                            | API              | Supabase transaction pooler (step 2.5)                                        |
| `DATABASE_DIRECT_URL`                                                                     | API (migrations) | Supabase direct connection (step 2.5)                                         |
| `SUPABASE_URL`                                                                            | API              | Supabase Project URL (step 2.6)                                               |
| `SUPABASE_SERVICE_ROLE_KEY`                                                               | API              | Supabase service role key (step 2.6)                                          |
| `EMAIL_KEY`, `EMAIL_FROM`                                                                 | API              | Resend (step 3)                                                               |
| `PSP_API_KEY`                                                                             | API              | Stripe test secret key (step 4.4)                                             |
| `PSP_WEBHOOK_SECRET`                                                                      | API              | Stripe webhook signing secret (step 4.5)                                      |
| `PSP_CONNECT_WEBHOOK_SECRET`                                                              | API              | Stripe Connect webhook signing secret (step 4.5)                              |
| `PSP_PUBLISHABLE_KEY`                                                                     | API              | Stripe test publishable key (step 4.4)                                        |
| `BUSINESS_WEB_URL`                                                                        | API              | The business portal's address, for Stripe's return links                      |
| `FCM_SERVICE_ACCOUNT_JSON`                                                                | API              | Firebase service account (step 5.4)                                           |
| `NOTIFY_PROVIDER`, `PUSH_PROVIDER`                                                        | API              | `resend` (step 3.5) and `fcm` (step 5.4)                                      |
| `CRON_SECRET`                                                                             | API              | A random value you generate (Vercel sends it with each cron call)             |
| `JWT_KEYS`, `OTP_SECRET`, `MFA_ENCRYPTION_KEY`, `STORAGE_SIGNING_SECRET`, `METRICS_TOKEN` | API              | Random values the team's script generates for you. Never reuse the local ones |
| `API_URL`                                                                                 | Business, admin  | The API's address                                                             |

## 8. Domain

1. Decide the domain (for example `jays.ae`) and register it with any registrar. This is an annual registrar fee and needs your approval.
2. **Connect it to Vercel:**
   - In each Vercel project, open **Settings → Domains → Add**.
   - Use, for example:
     - `api.yourdomain` for the API;
     - `business.yourdomain` for the business portal;
     - `admin.yourdomain` for the admin console;
     - the main domain for the customer website.
   - Vercel shows the DNS records to add.
3. Use a subdomain such as `mail.yourdomain` for Resend (step 3), so email reputation is kept apart from the website.

## 9. Mobile stores (later, phase 11)

- **Apple Developer Program:** annual fee. Enrol at https://developer.apple.com/programs/.
- **Google Play Console:** one-time fee. Register at https://play.google.com/console.
- These are official store fees, not software subscriptions. Both need your approval before you pay.

## 10. Checking staging

After the team deploys staging with your approval:

1. **Customer website:** open it. Switch between English and Arabic, and check the layout flips right to left.
2. **Sign-up email:** sign up with your own email. The verification email should arrive from your Resend domain.
3. **Test payment:** in the shop, buy a test product with Stripe's test card `4242 4242 4242 4242` (any future date, any CVC).
   - The order shows as paid.
   - The payment appears in Stripe's **test** dashboard.
4. **Booking:** book a test appointment. The confirmation appears in the app and by email.
5. **Admin console:** sign in with your authenticator app. Check that the usage card shows database, storage and email use.
6. **Push:** with a test build of the mobile app, allow notifications. A test order update should arrive as a push message.

## 11. Do not upgrade

- **Vercel:** do not add seats or raise the spend limit without asking.
- **Supabase:** stay on Free. No Pro, compute add-ons or point-in-time recovery.
- **Resend:** stay on Free. Do not enable overages.
- **Firebase:** stay on Spark, never Blaze.
- **Stripe:** do not activate live payments, Instant Payouts or the "you handle pricing" option.
- **GitHub:** no paid plan, Actions spending limit or extra storage.

## 12. Actions that need your approval later

- **Deployment:** the first staging deployment, and any production deployment.
- **Live payments:** activating them, and choosing who bears card fees.
- **Paid upgrades:** any paid plan or upgrade, for example when the pilot outgrows a free tier. See [INFRASTRUCTURE_COSTS.md](INFRASTRUCTURE_COSTS.md).
- **Malware scanning:** where the scanner runs (a production blocker).
- **Pilot:** the list of pilot businesses, and launching the pilot.
- **Professional sign-offs:** legal approval of documents and tax approval of VAT rules, both by appointed professionals.
- **Store fees:** paying the store registration fees.
