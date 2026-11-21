# Using the Analyst (stage 1)

The Analyst is the staff business analyst. It turns an intake issue into questions, draft requirements with acceptance criteria, a kickoff interview guide, or an escalation. The workflow is [`.github/workflows/staff-analyst.yml`](../../.github/workflows/staff-analyst.yml), and its rules come from the pinned `Diet-Companion/staff` commit.

## What stage 1 means

Stage 1 is advisory (S-GEN-052, S-BA-042). The Analyst **only comments** on the intake issue:
- no branches, commits or PRs;
- no labels and no verdicts;
- you decide everything. To accept a draft, apply it in your own commit under `requirements/<area>/`.

Each run posts one main comment, with the decisions for you first and then the questions, guide or escalation. Then it posts one comment per drafted requirement. A failed run posts one fixed notice, `Analyst run <id> failed: <reason>`, with a link to the run's logs.

## Turn it on

The repo variable `AGENTS_ENABLED` is the kill switch (S-GEN-069). The workflow does nothing unless it is `true`:

```sh
gh variable set AGENTS_ENABLED --body true  --repo Diet-Companion/diet-companion   # on
gh variable set AGENTS_ENABLED --body false --repo Diet-Companion/diet-companion   # off
```

Optional: set `ANALYST_MODEL` to override the default model, `claude-sonnet-5-5`.

## Work an intake

1. **Open an intake issue.** Describe what you want, in one area from `.staff/areas.yml` (diet-rules, budget, journal, measurements or shopping). Keep personal data and secrets out of it: a run with either fails closed.
2. **Add the `analyst:intake` label.** This starts a run. Only labels and comments from accounts in staff's `governance/operators.yml` count. Anyone else's events are denied, and nothing is posted.
3. **Answer the questions** in a comment, one per line, for example:

   ```
   Q-001: b
   Q-002: only on weekdays
   ```

   Pick an option letter or write free text. The recommended option is only a suggestion: it never applies by itself.
4. **Comment `/analyst`** (the whole comment, nothing else) to run the next batch. The Analyst reads your answers and its own earlier comments. Comments by anyone else are ignored.

After three batches with blocking questions still open, the Analyst escalates instead of asking again (S-BA-016). For a new area's first intake it posts an interview guide. You run the interview and commit the transcript under `requirements/<area>/sources/`.

## Limits and records

- One run per issue at a time. A second `/analyst` waits for the first to finish.
- Each run stops at 15 turns, $3, or a 10-minute job timeout (S-BA-038).
- The validated output and the run record (S-GEN-029) are kept as the run's workflow artifact for 90 days.
