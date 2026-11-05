# AGENTS.md

Instructions for AI coding agents live in **[CLAUDE.md](CLAUDE.md)**: project map, data model, rules that protect the live data (schema migrations, sync), conventions, how to verify changes, and known gotchas.

Hosting, deploys, data backup and restore, and troubleshooting: **[docs/OPERATIONS.md](docs/OPERATIONS.md)**.

Minimum before committing: `npm run build` passes; any change to the shape of `state` comes with a migration in `src/store.js`; no secrets in the repo (it's public).
