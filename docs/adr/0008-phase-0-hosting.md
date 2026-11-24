# Phase 0 runs on one small server plus managed services

Superseded by ADR-0017 on 2026-11-19: the web app, API, sync server and Postgres run on one server behind Cloudflare, with files in R2. Its durable jobs on Temporal Cloud are replaced by ADR-0022: pg-boss in our own Postgres, run by the worker app.

Once deployed, the API, sync server, light TypeScript worker, Postgres and Redis run in Docker Compose behind Caddy on the owner's server (1 vCPU, 3.8 GB RAM). The web app is on Vercel, files on Cloudflare R2, durable jobs on Temporal Cloud and GPU work on Modal. Every service is its own container so it can move host without code changes; server renders of large designs move to Cloudflare Containers when the server is too small. The server's address lives in deploy secrets, never in the repo.
