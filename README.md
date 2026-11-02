# Parakkat AI Office

An operations system for Parakkat Jewels that takes a known problem to verified closure and proves it stayed closed. Claude is the reasoning engine, called from the server. Nothing here changes anything in Shopify, an ad or a shipment: the system recommends and records, people act.

The full plan is the blueprint (`parakkat_ai_office_plan_v1.6.html` in the project docs). This README covers only running the code.

## Status — 1 Nov 2026

| Day | Scope | State |
|---|---|---|
| 1 | Database schema with the lifecycle rules enforced in Postgres; 16 tests prove them | **Done** |
| 2 | Sign-in, Inbox, Finding detail, Add finding | **Done** (sign-in needs your Supabase project) |
| 3 | Status changes from the UI: triage, assign, fix reported, verify screen, close locked by the database | **Done** (full loop walked in a browser against `next build`, 12/12 steps) |
| 4 | Claude: triage drafts, run ledger, budget cap | Not started |
| 5 | Saved checks, verification, register import | Not started |
| 6 | Scheduled re-checks (Supabase Pro from here) | Not started |
| 7 | Closure ledger, the floor, usage | Not started |

## What the database refuses, whoever asks

- Closing a finding without a clean check run recorded **after** the owner reported the fix, **and** a prevention rule in force.
- Skipping lifecycle steps (`new → assigned`, anything `→ closed` except from `verifying`).
- Triage without area, severity and a root cause; assignment without an owner and a proposed fix.
- A second finding with the same identity (`fingerprint`) in the same brand.
- A count without the date it was counted; money at risk without the method.
- A check run marked clean that still matched something.
- Editing or deleting the audit log.
- An owner from another brand.

`npm test` proves every line above against a real Postgres.

## Run it

```
npm install
cp .env.example .env.local        # fill in Supabase URL, anon key, DATABASE_URL
npm run db:migrate                # creates the office schema, seeds the brand and agents
npm run dev                       # http://localhost:3000
```

Create your login in the Supabase dashboard (Authentication → Users → Add user). There is no self sign-up.

## Deploy

1. Push this repo to GitHub.
2. Vercel → New project → import it. Set the variables from `.env.example` (`ALLOWED_EMAILS` is required: empty means nobody can sign in).
3. Run `npm run db:migrate` once against the production `DATABASE_URL`.
4. Open `/api/health` — it answers `{"ok":true,"tenants":1}` when the database is reachable and migrated.

## Tests

```
# needs a Postgres you can write to; the test suite creates rows
TEST_DATABASE_URL=postgres://... npm test
```

## Layout

```
db/migrations/   schema, one file per change, applied once in order
db/seed/         base rows, safe to re-run (brand, agents). Owners are NOT seeded: names are NOT PROVIDED.
scripts/         migrate.mjs
src/app/         pages and routes (Next.js app router)
src/lib/         db access (server only), tenant, finding queries
src/components/  shared UI
public/ds/       design-system styles (Parakkat SEO Command Center)
tests/           database rule tests
```

## Rules carried into the code

- Secrets live in environment variables only. `.gitignore` was written before any secret existed.
- Every table carries the brand (`tenant_id`); a second brand is a row in `office.tenants` and a `TENANT_SLUG`.
- Tables sit in a private `office` schema that Supabase does not expose to the browser; the server reaches them over `DATABASE_URL`.
- Evidence files go to object storage; the row keeps a path and a hash. No binaries in the database or in git.
- One finding per defect class, never one per affected product.
