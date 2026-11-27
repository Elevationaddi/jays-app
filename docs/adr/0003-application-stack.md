# ADR-0003: Application stack and modular monolith

- Status: Accepted
- Date: 2026-11-27

## Context

`docs/06-architecture-data.md` proposes (not mandates) Expo React Native for customers, Next.js for business and admin web, a NestJS REST API, PostgreSQL, Redis, S3-compatible storage and background workers. The hardest requirements are transactional: no oversell, no double booking, idempotent payments and a balanced ledger.

## Decision

Adopt the proposed stack:

| Surface                        | Choice                                                                                                 | Version at scaffold            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------ |
| Customer app                   | Expo (React Native)                                                                                    | Expo SDK 58, React Native 0.88 |
| Business portal, admin console | Next.js App Router                                                                                     | Next.js 16.4, React 19.3       |
| API                            | NestJS on Express                                                                                      | NestJS 12.6                    |
| Worker                         | Plain Node.js process (queue library chosen when the first job lands; BullMQ is the default candidate) | –                              |
| Database                       | PostgreSQL                                                                                             | 17                             |
| Queues, rate limits            | Redis (not used for authoritative locks)                                                               | 7                              |

The backend is **one modular monolith** (API plus a worker sharing the same packages and database), not microservices. Module boundaries follow the domain: identity, businesses, catalog, inventory, checkout, services, bookings, payments, ledger, support, admin.

Clients never access the database directly. The API is authoritative for identity, tenant scope, prices, availability, money and state transitions.

## Consequences

- Transactions can span inventory, orders, bookings and ledger entries in one PostgreSQL transaction, which is what the invariants need.
- Customer web (a browser version of the customer app) is not in the MVP spec; Expo can target web later if wanted.
- Object storage, maps, email/SMS/push and delivery providers sit behind adapter interfaces with local mocks; concrete providers need founder decisions (ADR-0007).
