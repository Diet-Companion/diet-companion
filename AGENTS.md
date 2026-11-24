# AGENTS.md: how code is written here

Human-owned (S-GEN-002, S-GEN-025). The Developer reads it on every run. It holds the conventions the
ADRs leave open. Where they differ, the accepted ADRs under `architecture/system/adr/` win.

## Stack (ADR-007, ADR-008, ADR-009)

- **Node.js 22 LTS** and **TypeScript** in strict mode, ES modules only.
- **npm workspaces.** The root `package.json` lists `client`, `backend` and `label-reader`, and only npm
  is used. `package-lock.json` is generated (`npm install --package-lock-only`), never written by hand.
- **`client/`** (CMP-001): React and Vite, an installable PWA (a web manifest and a service worker for
  installability only). It talks to the backend only through IF-001.
- **`backend/`** (CMP-002): Fastify. It serves the client bundle and implements IF-001, and it is the
  only owner of the database.
- **`label-reader/`** (CMP-003): the only package that calls the label-recognition provider (ADR-005).
  Only `backend/` imports it. It never imports `backend/` or `client/`.
- **Database:** PostgreSQL. The schema changes only through ordered, forward-only SQL files in
  `backend/migrations/`, named `NNN_<what>.sql`. Queries go through a typed query layer, with no ORM.
- **IF-001** is spec-first: `architecture/system/interfaces/IF-001/openapi.json` is the source of
  truth. Request and response types and validators follow it exactly.

## Root scripts (the work sandbox runs these, `.staff/code.yml`)

| Script | Does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` for every package |
| `npm run build` | Builds every package |
| `npm test` | Runs every package's Vitest unit tests once and writes one JUnit report to `reports/unit.xml` |

`npm test` must exit non-zero when a test fails, and must not need a database, a network or a secret.

## Tests

- **Unit tests** sit next to the code as `*.test.ts` (or `*.test.tsx`) and run with Vitest.
- **Cite the AC.** A test that checks an AC names it in a comment: `// cites: REQ-003/AC-002`.
- **Expected values** come only from the cited AC, rule or spec, never from the code under test.
- **The provider is a seam.** label-reader takes the provider client as a parameter, and tests pass a
  fake. No test calls the real provider.
- **Time, randomness and IDs** come through injected functions, so tests can fix them.

## Secrets and data

- **No secret** in code, tests or config. Runtime secrets (the provider key, the password hash, the
  session key, the database URL) come from environment variables that hosting sets (ADR-004, ADR-006).
- **Synthetic test data only** (S-DATA-004). Example products are made up; never use real labels or
  personal data.
