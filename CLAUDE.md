# Dazbee

A web app where a solo marketer, a company's team or a digital marketing agency makes everything a brand needs: ads in every size, social posts and everyday creative. It joins an AI flow (brief to editable ad), a design editor built for many sizes, and the team workflow (brand kits, approval, publishing). Each sign-up is a workspace with brands inside; an agency's clients are brands too (ADR-0011, ADR-0013).

Read `GLOSSARY.md` before naming anything, and the ADRs in `docs/adr/` before changing an area they cover.

## Layout

pnpm + Turborepo monorepo. `apps/` deploy (web, api, sync, mcp); `packages/` are shared code and only ever depend downward: schema → doc → renderer → editor. `tests/pixels` holds the cross-app Vitest suite. Add ADR-0001's worker app and `python/` uv workspace (model-adjacent work, phase 2) with the ticket that first needs each. Before adding, moving or removing a workspace, read the layout in `README.md` and update it in the same PR.

## Rules

- Every document type and job contract is defined once in `packages/schema` (zod). Generated files are never edited by hand.
- Nothing writes to a design except a **command** in `packages/doc`, through the store; a tab's follow-up of derived values is the one exception. One command is one undo step, or one gesture (a drag, a typing session, which also ends on a 2 s pause or a hidden tab) is, for the commands it runs (ADR-0004).
- Exports are drawn on the CPU surface only. Never add an export path that reads pixels from WebGL.
- Fonts and images are loaded from bytes we control, never from the system or the browser's decoder.
- Never put server addresses or secrets in the repo.
- Dazbee runs in production as ADR-0017 describes, and keeps people's work. Every change to the tables comes with a migration that keeps the data, and a change to the design schema that stored designs must be carried over for raises `SCHEMA_VERSION` with the step that carries them (the Data section of `docs/agents/code-layout.md`).
- Before adding or moving code, read `docs/agents/code-layout.md`: which folder and file it goes in, the order inside the file, and the imports each folder may make.

## Tests

This repo keeps its tests: commit them, and every bug fix adds a test that fails without the fix. That holds here even where a general rule says tests are throwaway. The repo has no browser tests; don't add any.

## Planning

A big feature, one that needs more than one ticket or changes what is stored or an ADR, is planned once as a spec: `prototype` only where a design question can't be settled on paper, the grilling (`/wayfinder` first only when it won't fit one session), `/to-spec`, `/to-tickets`, then `/spec-check` before any of its tickets is built. A smaller item is built straight from its ticket or epic line, with no grilling.

Every ticket is built with `/implement`: one ticket, one PR. A ticket that changes how a design is stored or synced, or anything through which a person could lose work, also gets a second `code-review` by a fresh agent before its PR is ready. A ticket that changes the screen also gets `/try-it`. Don't use `/implement-spec`: it merges a whole spec onto one branch.

- Start the grilling yourself, as `/grill-with-docs` does: call the Skill tool twice, for `grilling` and `domain-modeling`. When the owner is away, take each decision yourself and write it into the spec as "Decision (Claude, <date>)".
- `/wayfinder`, `/to-spec`, `/to-tickets` and `/implement` are skills only the owner can start. When one is next, read its `SKILL.md` in the mattpocock-skills plugin and follow its steps yourself, asking the owner at each point where it asks the user.
- A spec has a goals table: each goal, and how it is measured.
- A ticket names the file each behaviour lives in, and fits one session. That holds here even where a skill says to leave file paths out.

## Pull requests

One ticket, one PR, closing its issue; a ticket cut into steps has one PR per step, and the last closes it. Open a new issue only when the owner asks for one. Only ask the owner when a decision is needed.

Turn on auto-merge as soon as a PR is opened (`gh pr merge <number> --auto --merge`), so it merges once CI's `check` passes. Leave it off while the PR waits on a decision from the owner, and turn it on once they answer.

## Agent docs

### Issue tracker

Issues and specs live in GitHub Issues on dazbee-ai/dazbee. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
