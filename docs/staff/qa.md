# Using the test engineer (stage 1)

The test engineer's first agent is **`test-gen-api`** (S-QA-002). It drafts API tests for ready ACs, rules and
interface versions: behaviour tests through the real backend and PostgreSQL, in `tests/api/` (S-QA-004).

The workflow is [`.github/workflows/staff-qa.yml`](../../.github/workflows/staff-qa.yml). It runs as
`diet-companion-qa[bot]`, the staff-qa identity (S-QA-003).

## What stage 1 means

Stage 1 is advisory (S-GEN-052, S-QA-018). Nothing is committed:
- **On the ticket:** one comment per draft, with the decision summary, the cited IDs, the files, the
  work-sandbox result, and any suspected issues.
- **As a CI artifact:** the full patch, `qa-patch-<run>`.

**You decide** what counts as a bug, every merge, and every flagged diff (S-QA-001). To take a draft, apply
the patch on a branch and open the PR yourself.

## The work sandbox

A separate job with no secrets, no write token and a throwaway PostgreSQL service:
1. applies the proposed tests to `main` and saves the patch;
2. runs the `api` layer's `sandbox` commands from `.staff/tests.yml` on `main` and on the change.

A draft passes when the build passes, no test that passes on `main` fails, and every added test passes. The
exception is a test the draft declares as an **expected failure**: it says the code disagrees with a cited
source. That's a suspected issue for you to judge, never a test to weaken (S-QA-009). When a draft fails, the
workflow re-runs the agent automatically, at most 2 times (S-QA-024).

## Work a ticket

1. **Open an issue** with these lines in its body:
   - `Area: system`;
   - `Layer: api`;
   - the ACs to cover, as `REQ-005/AC-001`, or `REQ-005` for all its live ACs, plus any rule (`R-004`) or
     interface version (`IF-001@1.3.0`).
2. **Apply `qa:tests`.**
3. **Read the draft.** Answer any questions in a comment, then comment `/qa` (the whole comment) to redraft.
   Comments by anyone but an operator are ignored.

Tests cite only ready ACs, active rules, approved interface versions and accepted ADR constraints (S-QA-010).
Every test carries a `cites:` comment, and every cited ID must be live on `main`, or the draft is refused.

## Model access and cost

The same `CLAUDE_CODE_OAUTH_TOKEN` as the other agents.
- **Caps:** a notional $5 and 20 minutes per run (S-QA-045).
- **Optional:** set `QA_MODEL` to override the default, `claude-sonnet-5-5`.

## Not yet wired

The other test layers (unit gaps, UI journeys), the mutation gate, the `reviewer/tests` checklist, the CI
healer, exploratory sessions, and automatic triggers from Developer PRs.
