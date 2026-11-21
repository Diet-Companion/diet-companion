# diet-companion

A single-user, mobile-friendly web app for following a self-defined diet: allowed products, a daily calorie budget, a daily food journal, body measurements and a weekly shopping plan.

Built with agent staff from [Diet-Companion/staff](https://github.com/Diet-Companion/staff), following its strategy. Current stage: lean slice, with the BA Analyst at stage 1 (drafts and comments only).

## Layout
- `.staff/`: the staff contract (`product.yml`, `areas.yml`), human-only.
- `requirements/<area>/`: requirements (`REQ-n.md`), test conditions, and interview sources under `sources/`.
- `knowledge/`: product core, the rules registry (`rules/<area>/R-n.md`) and discovered knowledge.

Areas: `diet-rules`, `budget`, `journal`, `measurements`, `shopping`.

Real personal data (measurements, journal) never reaches agents or this repo (S-DATA-004).
