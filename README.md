# diet-companion

A single-user, mobile-friendly web app for planning and logging meals against daily nutrient targets: a product and dish catalog, a five-meal day plan and log, weekly body measurements and a Saturday shopping plan grouped by shop.

Built with agent staff from [Diet-Companion/staff](https://github.com/Diet-Companion/staff), following its strategy. Current stage: lean slice, with the BA Analyst at stage 1 (drafts and comments only).

## Layout
- `.staff/`: the staff contract (`product.yml`, `areas.yml`), human-only.
- `requirements/<area>/`: requirements (`REQ-n.md`), test conditions, and interview sources under `sources/`.
- `knowledge/`: product core, the rules registry (`rules/<area>/R-n.md`) and discovered knowledge.

Areas: `catalog`, `targets`, `journal`, `measurements`, `shopping`.

Real personal data (measurements, journal) never reaches agents or this repo (S-DATA-004).
