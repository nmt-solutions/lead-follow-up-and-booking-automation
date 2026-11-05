## Agent skills

### Issue tracker

Specs and tickets live in this repo's GitHub Issues. Before issue operations, selecting dependent work or implementation handoff, read `docs/agents/issue-tracker.md` and use its status-aware dependency readiness rules.

### Triage labels

Use the five default triage roles. Before triaging, read `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` and `docs/adr/`. Before exploring the codebase, read `docs/agents/domain.md`.

### TypeScript

Before writing or changing TypeScript, read `docs/ts-coding-guide.md`. Discovery orchestration uses Effect; Next.js handlers and other workflows use conventional TypeScript. Trigger.dev owns durable jobs and recovery. See `docs/adr/0010-use-effect-for-discovery-workflow.md` for the boundary.

### Frontend

Use Tailwind CSS and shadcn/ui for all website UI. Before writing or changing frontend code, read `docs/agents/frontend.md` and apply both `apple-design` and `apple-design-diwu`; review the changed flow with both skills before finishing.

### Final code checks

After finalizing code changes and before handing work back:

1. Apply Prettier formatting to the changed files using the repository's configuration.
2. Run the project's lint command using its configured package manager and scripts.
3. Fix formatting and lint failures, then rerun Prettier and lint after any further code edits until both pass.

Report the checks and their results in the final response. If tooling is missing or a check cannot run, state the reason explicitly; never report an unrun check as passing.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
