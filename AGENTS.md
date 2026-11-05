# AGENTS.md

Instructions for AI coding agents live in **[CLAUDE.md](CLAUDE.md)**: project map, data model, rules that protect the live data (schema migrations, sync), conventions, how to verify changes, and known gotchas.

**Work queue:** the owner files issues per screen from inside the app. How to fetch them, fix them and mark them fixed: **[docs/ISSUES.md](docs/ISSUES.md)** (quick start: `npm run issues`, or `curl -s http://dokpoly.netbird.cloud/api/issues?status=active` over NetBird).

Hosting, deploys, data backup and restore, and troubleshooting: **[docs/OPERATIONS.md](docs/OPERATIONS.md)**.

Minimum before committing: `npm run build` passes; any change to the shape of `state` comes with a migration in `src/store.js`; no secrets in the repo (it's public).
