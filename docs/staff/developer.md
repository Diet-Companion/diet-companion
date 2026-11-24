# Using the Developer (stage 1)

The Developer is staff's working developer agent (S-DEV-002). It reads one ticket and proposes a code
change as whole files, with unit tests. Or it says what blocks the ticket: questions, design requests and
requirement-defect items.

The workflow is [`.github/workflows/staff-developer.yml`](../../.github/workflows/staff-developer.yml).
It runs as `diet-companion-engineering[bot]`, the same staff-engineering identity as the Architect.

## What stage 1 means

Stage 1 is advisory (S-GEN-052, S-DEV-022). Nothing is committed:
- **On the ticket:** one comment per draft. It shows the decision summary first, then the PR block (ACs,
  interface versions, constraints, flags, dependencies), the changed files and the work-sandbox result.
- **As a CI artifact:** the full patch, `developer-patch-<run>`.
- **On the requirement's own ticket:** any requirement-defect item (S-DEV-008).

**You decide** what is built, every merge and every trade-off (S-DEV-001). To take a draft, apply the
patch on a branch and open the PR yourself.

## The work sandbox

The model can't build or run anything. A separate job with no secrets and no write token:
1. applies the proposed files to `main`;
2. runs the code map's generators (the lockfile);
3. saves the patch;
4. runs `.staff/code.yml`'s `sandbox` commands on `main` and on the change: install, `npm run typecheck`,
   `npm run build` and `npm test`.

A draft passes when the build passes, no test that passes on `main` fails on it, and every test it adds
passes (S-DEV-042). The tests ran the proposed code, so the result is advisory.

## Work a ticket

1. **Open an issue** with these lines in its body:
   - `Area: system` (all code is in the `system` area, `.staff/code.yml`);
   - the ACs to build, as `REQ-003/AC-002`, or `REQ-003` for all its live ACs;
   - any interface version, as `IF-001@1.0.0`.

   For work with no AC, such as scaffolding, add `Kind: refactor` and say what to do.
2. **Apply one label:**
   - `dev:implement` to build or refactor;
   - `dev:fix` for a confirmed defect, naming its target (an AC, `R-n`, or `ADR-n/C-k`);
   - `dev:bootstrap` to draft a code-map entry from existing code.
3. **Read the draft,** then answer any questions in a comment and comment `/developer` (the whole comment)
   to redraft. Comments by anyone but an operator are ignored.

The Developer works only on **ready** tickets (S-DEV-007). That means every AC is live in a ready
requirement, every quality requirement it lists has an accepted QAS, and every interface version named
is approved. Otherwise the comment lists what blocks it, and no code is proposed.

## Model access and cost

The Developer uses the same `CLAUDE_CODE_OAUTH_TOKEN` as the Analyst (see
[analyst.md](analyst.md#model-access-and-cost)).
- **Caps:** a notional $6 and 45 minutes per run (S-DEV-033).
- **Optional:** set `DEVELOPER_MODEL` to override the default, `claude-sonnet-5-5`.

## Known stage-1 gaps

- **Private reports** (suspected vulnerabilities, S-DEV-019) are withheld from the public comment and
  artifacts. There is no private store yet.
- **Sandbox network:** the sandbox reaches the npm registry and anything else on the internet. GitHub-hosted
  runners can't limit egress to a package mirror (S-DEV-042).
- **Not yet wired:** reviews, check-failure runs, the nightly readiness re-run, and the BA and ARCH trace
  matrices. Readiness reads the requirement and architecture files directly.

## Setup (once)

- The labels `dev:implement`, `dev:fix` and `dev:bootstrap`.
- `.staff/code.yml` and `AGENTS.md`, both human-owned.
