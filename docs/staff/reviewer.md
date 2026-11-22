# Using the reviewer (reviewer/requirements, stage 1)

The reviewer is staff's shared reviewer, here with its requirements checklist RC-1 to RC-9 (S-BA-029). It checks a PR that changes `requirements/**` against:
- the merged rules;
- the ready requirements;
- the product core.

The workflow is [`.github/workflows/staff-review.yml`](../../.github/workflows/staff-review.yml), and its rules come from the pinned `Diet-Companion/staff` commit.

## What it does

- **It comments, nothing else.** Each run posts one comment on the PR as `diet-companion-reviewer[bot]`, and sets or clears two labels:
  - `ba:not-ready`: the verdict is not ready;
  - `ba:questions`: it asked you something.
- **It never edits or approves.** It never pushes, approves or merges. Its verdict is advice: you decide (S-BA-018).
- **What the comment holds:**
  - the verdict;
  - the decisions for you first;
  - at most 7 findings, blocker first, each with a suggested rewording;
  - questions;
  - proposed `changes` declarations for rule conflicts that no `changes` entry declares;
  - draft test conditions.
- **The comment is headed "not yet qualified".** That stays until the checklist meets its stage 1→2 threshold (S-BA-032).
- **It ends with a hidden block** holding the reviewed commit and the finding IDs. The ready-gate check will read that block.
- **A failed run** posts one fixed notice, `Reviewer run <id> failed: <reason>`, with a link to the logs.

## When it runs

- **Automatically,** when a PR touching `requirements/**` opens, reopens or is marked ready for review. A draft PR isn't reviewed until it's marked ready.
- **On request,** when you comment `/review` on the PR (the whole comment, nothing else). Use this after you push changes: a new push doesn't start a re-run.

It reviews the PR's head commit as it is when the run starts. It runs only for PRs from branches in this repo, and only when the person who triggers it is an operator. The `AGENTS_ENABLED` switch applies, as it does for the Analyst.

## Working with the findings

- **Finding IDs are stable.** An ID looks like `RC-4|REQ-012/AC-003|R-007`. The same issue gets the same ID on every re-review.
- **Answer questions** in a PR comment as `Q-001: b`, then comment `/review`.
- **A "contradicts" finding needs your disposition** in the requirement's `review_dispositions` before it can pass the ready gate (S-BA-017 item 5):
  - `declared`: you added the `changes` entry;
  - `accepted`: you agree, and you'll change the requirement;
  - `rejected`: you disagree. Cite your comment.

## Model access and cost

The reviewer uses the same `CLAUDE_CODE_OAUTH_TOKEN` secret as the Analyst; see [analyst.md](analyst.md#model-access-and-cost).
- **Per-run caps:** a notional $0.50 and 5 minutes (S-GEN-057). A run that hits a cap fails with `budget_exceeded`, `cost_cap` or `claude_timeout`. Keep ready-gate PRs to one requirement, or a few small ones.
- **Optional:** set `REVIEWER_MODEL` to override the default model, `claude-sonnet-5-5`.

## Setup (once)

1. **Create the GitHub App** `diet-companion-reviewer` in the Diet-Companion org:
   - webhook off;
   - repository permissions: Pull requests read and write, Issues read and write, Contents read;
   - install it on this repo only.
2. **Store its ID and key:**
   ```sh
   gh variable set REVIEWER_APP_ID --repo Diet-Companion/diet-companion --body <App ID>
   gh secret set REVIEWER_APP_PRIVATE_KEY --repo Diet-Companion/diet-companion < <key>.pem
   ```
