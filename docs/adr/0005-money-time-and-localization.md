# ADR-0005: Money, time and localization conventions

- Status: Accepted
- Date: 2026-11-27

## Decision

**Money**

- All amounts are integer **fils** (1 AED = 100 fils), stored as `bigint`, currency `AED`. No floating point anywhere in money paths. `packages/domain` provides `fils()`, add, subtract (never negative) and multiply guards.
- Percentages (commission, tax, discounts) are integer **basis points**.
- Rounding is a tax and commercial decision that has not been approved, so `applyBasisPoints` takes an explicit rounding mode and has no default. The chosen policy will be recorded when the accountant confirms VAT treatment (ADR-0007).
- Totals are computed on the server only and snapshotted onto orders and bookings; later price or policy changes never mutate history.

**Time**

- Timestamps are stored as `timestamptz` in UTC.
- Each branch stores its IANA timezone; `Asia/Dubai` is the default for UAE venues and display. Slot generation uses a 15-minute grid and 10-minute holds by default, both configurable (`docs/05-workflows.md`).
- Intervals are half-open `[start, end)` so back-to-back appointments do not overlap.

**Localization**

- Locales `en` and `ar`; localized content is stored as `{ en, ar }`. Arabic renders right to left; layout mirrors but images do not.
- UI copy lives in `packages/i18n` catalogs, never hard-coded in components. A test enforces identical keys in both languages.
- Arabic strings written by engineers are drafts. `NEEDS_NATIVE_REVIEW` lists them until a native speaker reviews them before launch.

## Consequences

- Every new money field, migration or DTO follows these rules; reviewers reject floats in money paths.
