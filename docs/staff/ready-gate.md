# The ready gate

A requirement becomes `ready` only through a ready-gate PR that you merge (S-BA-018). A ready-gate PR is any PR that sets a requirement's `status` to `ready`. The workflow [`.github/workflows/staff-ready-gate.yml`](../../.github/workflows/staff-ready-gate.yml) checks the structural items and posts one commit status, `staff/ready-gate`, on the PR head. It runs no model.

## When it runs
- On every PR when it opens, gets a push, or is edited or reopened.
- Again whenever the reviewer App or an operator comments on the PR. So a new review, a disposition you push, or a waiver comment updates the status.

A PR that makes no requirement ready passes, as long as the lifecycle check passes. That check applies to every PR (S-BA-009):
- `draft` can become `draft`, `ready` or `retired`.
- `changed` can become `changed`, `ready` or `retired`.
- `ready` can become `changed` (with `affected_acs` in a new `revision` entry) or `retired`.
- A ready requirement can't be edited while it stays ready. Link repairs (S-BA-053) aren't recognised yet, so they fail too.
- Requirements are never deleted, and a retired requirement never changes.

## What a requirement needs (S-BA-017)
1. **Valid structure.**
   - The requirement schema passes, and its IDs are consistent.
   - Every source ref resolves: transcript turns, REQ and AC IDs, rules, and its own (or its epic's) A and Q IDs.
   - `rules` lists only merged active rules.
   - Human-owned fields are backed by your comments:
     - `accepted_by`, answer refs, `accepted` or `rejected` dispositions, and waivers are each the ref of an operator comment on the issue they name;
     - none of them changes in a PR that has non-operator commits.
2. **No open blocking question or assumption.**
3. **`priority` is set.** It's yours to set.
4. **Every rule in `rules` that has a `condition` is cited by a live `negative` or `boundary` AC.**
5. **A review, or a waiver.**
   - The review must be the reviewer App's result on this PR, for a commit whose ACs, `rules` and `changes` match the head. A status change or a prose edit after the review keeps it valid. Changing an AC, `rules` or `changes` needs `/review` again.
   - Every `contradicts` finding about the requirement needs a `review_dispositions` entry: `declared` with the R-ID of an accepted `changes` entry, or `accepted` or `rejected` with the ref of your comment.
   - Instead of a review: `review_waiver: {ref: <your comment ref>, revision: Diet-Companion/diet-companion#<this PR>}`, plus a `revision` entry this PR adds with `source_ref` set to this PR.

The job summary lists each item, with a pass or fail mark and the problems found. The semantic items stay with you: are the ACs atomic and complete, is every rule change declared, and are the remaining findings acceptable?

## Make it required
In the `protect-main` ruleset, add `staff/ready-gate` under **Require status checks to pass**. Until you do, the status is advisory.

## Today's gaps
These are the problems a gate would find in today's requirements. Fix them before you open a ready-gate PR.
- **No requirement has `priority`.**
- **ACs cite transcript turns instead of R-IDs.** In REQ-002, REQ-005, REQ-006, REQ-009, REQ-010 and REQ-013, a negative or boundary AC needs to cite the rule's R-ID (item 4).
- **REQ-012 is an epic with no ACs.** It lists `rules`, so it can only pass by dropping them.
