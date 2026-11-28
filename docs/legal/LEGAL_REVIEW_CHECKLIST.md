# Legal review checklist (UAE, all seven emirates)

> **Status: not started.** No lawyer has been appointed. Nothing in this repository has been reviewed or approved by a lawyer. This checklist lists **questions** for a UAE-qualified lawyer. It does not state what the law requires. Laws, authorities and licence types named below are starting points for the lawyer to confirm, correct or replace; none of them is a conclusion.

Prepared: 2026-11-28 · For: the founder and the lawyer JAYS appoints · Related: ADR-0018 (D3, D13), ADR-0025, ADR-0027, ADR-0028, `docs/TAX_REVIEW.md`

## How to use this checklist

1. Read the twelve drafts in `docs/legal/drafts/` (English and Arabic). Every `[●]` is a fact JAYS must supply or a rule the lawyer must set.
2. Answer each question below. Record the answer, the source (law, regulation, authority guidance) and the date in the "Answer" column or a linked memo.
3. Mark changes needed in the drafts. Engineering makes them as new versions; published text is never edited in place.
4. When every blocking item is answered, the founder decides whether to record the review (ADR-0028, section 3). Until then the platform refuses to publish legal documents in production.

Legend: **B** = blocks the Abu Dhabi pilot · **L** = blocks a wider launch · **I** = improvement.

## 1. Corporate structure and JAYS's own licence

| #   | Question                                                                                                                                                                                                                          | Priority | Answer |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| 1.1 | Which legal entity operates JAYS, in which emirate or free zone, and which licence activity covers an online marketplace that collects payment for third-party sellers and service providers?                                     | B        |        |
| 1.2 | Does that licence allow JAYS to serve customers and sellers in all seven emirates, or is a branch, additional activity or separate permit needed in any emirate?                                                                  | L        |        |
| 1.3 | Does acting as a disclosed intermediary that collects payment through a licensed payment provider (Stripe Connect, not live) require any licence or approval from the Central Bank or another authority? (D3)                     | B        |        |
| 1.4 | Is the disclosed-intermediary, not-merchant-of-record structure (D3) effective under UAE law for consumer claims, refunds and product liability, and what must JAYS do to keep it effective (disclosure wording, invoice issuer)? | B        |        |
| 1.5 | Is a separate permit needed for advertising or promotions on the platform (for example the pilot's 0% commission offer to merchants, or merchants' sale prices to customers)?                                                     | B        |        |

## 2. Federal laws to confirm

The lawyer is asked to confirm which federal laws apply, their current versions and implementing regulations, and what each requires of JAYS. The names below are what the team believes to be relevant and must be checked.

| #   | Area                        | Starting point to confirm                                                       | Question                                                                                                                                 | Priority |
| --- | --------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 2.1 | Consumer protection         | Federal Law No. 15 of 2020 and its executive regulations                        | What does it require for pre-contract information, cancellation and refund rights, warranties, Arabic text and complaint handling?       | B        |
| 2.2 | E-commerce                  | Federal Decree-Law No. 14 of 2023 on modern-technology trade                    | What obligations fall on a platform operator versus the seller? Is registration or a licence needed?                                     | B        |
| 2.3 | Electronic transactions     | Federal Decree-Law No. 46 of 2021                                               | Is click-to-accept with our acceptance records (ADR-0028) valid evidence of agreement for customers and for merchants?                   | B        |
| 2.4 | Personal data               | Federal Decree-Law No. 45 of 2021 (PDPL) and any executive regulations in force | Lawful basis, consent wording, data subject rights, breach notice, cross-border transfer (Supabase region, Vercel, Resend, FCM, Stripe). | B        |
| 2.5 | Cybercrime and content      | Federal Decree-Law No. 34 of 2021                                               | Obligations for reviews, images and messages; takedown duties and timelines.                                                             | L        |
| 2.6 | Anti-money laundering       | Federal Decree-Law No. 20 of 2018 as amended                                    | Does JAYS have any AML/KYC duty of its own, or is it carried by the payment provider?                                                    | L        |
| 2.7 | Commercial agencies, brands | Trademark law; anti-counterfeit rules                                           | Notice-and-takedown process for counterfeit claims; what evidence to require from rights holders.                                        | L        |
| 2.8 | Advertising and pricing     | Consumer protection rules on discounts and promotions                           | Rules for "was" prices, sale periods and promotions (see section 6).                                                                     | B        |
| 2.9 | Any other federal law       | —                                                                               | Which other federal laws apply to a beauty, wellness, products and home-services marketplace?                                            | L        |

## 3. Each emirate

For **each** emirate, answer the same questions. The authority names are what the team believes to be the economic and health regulators; the lawyer must confirm them.

Questions for every emirate:

- **E1.** Does JAYS need any licence, permit or registration in this emirate to let its businesses sell to, or visit, customers located there?
- **E2.** Which licence types must a **product seller** hold to sell through JAYS to customers in this emirate (for example a trade licence with an e-commerce activity)? Which documents should JAYS collect and check?
- **E3.** Which licence types must a **salon, spa or beauty service provider** hold for in-venue services? Which services need a health-authority licence or a licensed professional?
- **E4.** Which permits does a provider need to offer **home services** (services at the customer's address) in this emirate? Does the professional need an individual permit? (ADR-0022 collects a licence number, authority and expiry, and an admin reviews it; it does not decide which licence is right.)
- **E5.** Can a provider licensed in another emirate visit customers in this emirate?
- **E6.** Are any products or services restricted or prohibited here beyond federal rules (for example cosmetics registration, treatments reserved to medical facilities)?
- **E7.** Are there local rules on consumer complaints, opening hours, or the Arabic language that affect the customer terms?

| Emirate        | Starting point to confirm (economic / health regulator)                        | E1  | E2  | E3  | E4  | E5  | E6  | E7  | Priority      |
| -------------- | ------------------------------------------------------------------------------ | --- | --- | --- | --- | --- | --- | --- | ------------- |
| Abu Dhabi      | Abu Dhabi Department of Economic Development; Department of Health – Abu Dhabi |     |     |     |     |     |     |     | **B** (pilot) |
| Dubai          | Dubai Department of Economy and Tourism; Dubai Health Authority                |     |     |     |     |     |     |     | L             |
| Sharjah        | Sharjah Economic Development Department; health regulator to confirm           |     |     |     |     |     |     |     | L             |
| Ajman          | Ajman Department of Economic Development; health regulator to confirm          |     |     |     |     |     |     |     | L             |
| Umm Al Quwain  | Umm Al Quwain Economic Development Department; health regulator to confirm     |     |     |     |     |     |     |     | L             |
| Ras Al Khaimah | Ras Al Khaimah Department of Economic Development; health regulator to confirm |     |     |     |     |     |     |     | L             |
| Fujairah       | Fujairah Department of Economic Development; health regulator to confirm       |     |     |     |     |     |     |     | L             |
| Free zones     | Each free zone authority                                                       |     |     |     |     |     |     |     | L             |

Free zones: can a business licensed in a free zone sell to or visit customers on the mainland through JAYS? What should JAYS check?

## 4. The twelve documents

For each document: is it needed, is the structure right, what is missing, what must change, and is the Arabic text accurate and the controlling language question settled?

| #    | Document (draft file)                                  | Specific questions                                                                                                                                                                                              | Priority |
| ---- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 4.1  | Customer terms (`customer_terms`)                      | Intermediary disclosure; limitation of liability; governing law and courts; which language prevails; account suspension; minimum age.                                                                           | B        |
| 4.2  | Merchant agreement (`merchant_agreement`)              | Commission (10% default, 0% for the first 30 days of the pilot, then 10%; no commission on VAT, delivery or travel fees); payout timing (7 days); chargebacks; indemnities; termination; data processing terms. | B        |
| 4.3  | Privacy policy (`privacy_policy`)                      | PDPL compliance; processors and their locations; retention periods; data subject requests; children.                                                                                                            | B        |
| 4.4  | Return and refund policy (`returns_refunds`)           | Minimum statutory rights; which goods can be excluded (hygiene, cosmetics opened); who pays return shipping; refund timelines.                                                                                  | B        |
| 4.5  | Appointment cancellation (`appointment_cancellation`)  | Are merchant-set late-cancellation and no-show fees enforceable? Limits? Disclosure before payment (ADR-0027 shows it).                                                                                         | B        |
| 4.6  | Home-service policy (`home_services`)                  | Travel fee refund rule (full refund before travel starts, ADR-0025); safety; customer obligations; professional licensing (section 3, E4).                                                                      | B        |
| 4.7  | Marketing consent (`marketing_consent`)                | Opt-in wording; channels (email and push only; no SMS); withdrawal; records.                                                                                                                                    | B        |
| 4.8  | Prohibited products and services (`prohibited_items`)  | Complete the list from federal and emirate rules; treatments reserved to medical facilities; restricted cosmetics.                                                                                              | B        |
| 4.9  | Review moderation (`review_moderation`)                | Grounds for removal; merchant responses; defamation risk; verified-purchase only.                                                                                                                               | L        |
| 4.10 | Merchant licensing requirements (`merchant_licensing`) | Fill in from section 3. **The draft lists no specific licences on purpose.**                                                                                                                                    | B        |
| 4.11 | Authenticity and counterfeits (`authenticity`)         | Seller warranties; evidence; takedown and repeat-infringer policy.                                                                                                                                              | L        |
| 4.12 | Promotional pricing (`promotional_pricing`)            | See section 6.                                                                                                                                                                                                  | B        |

## 5. Acceptance, records and evidence

| #   | Question                                                                                                                                                                       | Priority |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| 5.1 | Are our acceptance records enough (user, exact version, language shown, time, request id, source; append-only)? Should we also keep IP address or device details?              | B        |
| 5.2 | When a new version is published, may existing customers keep using the service until they accept, or must they accept before their next order? (Today: a banner, not a block.) | B        |
| 5.3 | How much notice must we give before a new version takes effect? (Publishing supports a future effective date.)                                                                 | L        |
| 5.4 | Is a single checkbox at sign-up for both terms and privacy acceptable, or must privacy consent be separate?                                                                    | B        |
| 5.5 | How long must acceptance records, invoices and audit logs be kept?                                                                                                             | L        |

## 6. Prices and promotions

| #   | Question                                                                                                                                                                             | Priority |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| 6.1 | When can a merchant show a previous ("was") price? For how long must the item have been offered at that price, and what evidence should JAYS keep? (ADR-0023 records price history.) | B        |
| 6.2 | Must displayed prices include VAT? (They do today.) What must be shown when a seller is not VAT registered?                                                                          | B        |
| 6.3 | Does the merchant pilot offer (0% commission for 30 days, then 10%) need any approval or particular wording?                                                                         | B        |

## 7. Platform responsibilities

| #   | Question                                                                                                                                             | Priority |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 7.1 | What due diligence must JAYS perform on merchants before they go live (ADR-0012 collects licence documents; admins review them)?                     | B        |
| 7.2 | What duties does JAYS have when a customer reports harm from a service or product?                                                                   | B        |
| 7.3 | Are we required to appoint a data protection officer or register with a data authority?                                                              | L        |
| 7.4 | Data residency: may personal data be stored outside the UAE (Supabase region to be chosen; Vercel; Resend; Firebase)? Which safeguards are required? | B        |
| 7.5 | App Store and Google Play: what legal entity and documents are needed to publish the apps in the UAE?                                                | L        |

## Sign-off

| Item                                        | Name | Date | Notes |
| ------------------------------------------- | ---- | ---- | ----- |
| Lawyer appointed                            |      |      |       |
| Review complete for the Abu Dhabi pilot (B) |      |      |       |
| Review complete for all emirates (L)        |      |      |       |
| Founder authorizes recording the review     |      |      |       |
