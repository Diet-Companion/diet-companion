# Using the Architect (stage 1)

The Architect is staff's working architecture agent (S-ARCH-002). It turns a design need into drafts:
- ADRs, each with 2 to 4 options, their trade-offs, a recommendation, and one question for you;
- components, each with a complete testability field;
- interface specs;
- quality scenarios (QAS) for ready quality requirements.

The workflow is [`.github/workflows/staff-architect.yml`](../../.github/workflows/staff-architect.yml). It runs as `diet-companion-engineering[bot]`, the staff-engineering identity.

## What stage 1 means

Stage 1 is advisory (S-GEN-052, S-ARCH-041). The Architect **only comments**:
- **On the design-need ticket:**
  - one main comment, with your decisions first;
  - one comment per drafted artifact, each with a readable summary and the proposed file under `architecture/`. An ADR and its question share one comment.
- **On the requirement's own intake ticket:** any requirement-defect item, when a ready requirement can't be designed as written (S-ARCH-017). The Architect never edits requirements.

**You decide** every ADR outcome and option, technology choice, boundary, data ownership, compatibility policy and accepted gap (S-ARCH-001). To accept a draft, commit the file yourself under `architecture/<area>/`.

## Work a design need

1. **Open an issue** that names the need and links the ready requirements it serves. Use the `system` area for cross-area design such as the stack or hosting.
2. **Apply `arch:design`.** The Architect posts its drafts.
3. **Answer the questions** in a comment, as `Q-001: b` or free text. Choosing an ADR option is your decision; the recommendation never applies by itself.
4. **Comment `/architect`** (the whole comment, nothing else) to apply your answers and redraft. Comments by anyone but an operator are ignored.

The Architect works only on **ready** requirements and their ACs (S-ARCH-015). Today those are REQ-003 and REQ-007. It treats the product core and the merged rules as truth.

## Model access and cost

The Architect uses the same `CLAUDE_CODE_OAUTH_TOKEN` as the Analyst (see [analyst.md](analyst.md#model-access-and-cost)).
- **Caps:** a notional $4 and 30 minutes per run (S-ARCH-039).
- **Optional:** set `ARCHITECT_MODEL` to override the default, `claude-sonnet-5-5`.

## Setup (once)

1. **Create the GitHub App** `diet-companion-engineering`:
   - webhook off;
   - repository permissions: Issues read and write, Contents read;
   - install it on this repo only.
2. **Store its ID and key:**
   ```sh
   gh variable set ENGINEERING_APP_ID --repo Diet-Companion/diet-companion --body <App ID>
   gh secret set ENGINEERING_APP_PRIVATE_KEY --repo Diet-Companion/diet-companion < <key>.pem
   ```
3. **Create the `arch:design` label.**

At stage 2 the same App will open `agent/architect/*` branches and PRs. That needs more permissions, granted then.
