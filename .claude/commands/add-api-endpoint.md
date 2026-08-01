---
name: add-api-endpoint
description: Workflow command scaffold for add-api-endpoint in GaN-optimization-.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /add-api-endpoint

Use this workflow when working on **add-api-endpoint** in `GaN-optimization-`.

## Goal

Implements a new API endpoint with route, test, and UI integration.

## Common Files

- `src/app/api/<endpoint>/route.ts`
- `src/app/api/<endpoint>/route.test.ts`
- `src/app/<endpoint>/page.tsx`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Create route implementation file src/app/api/<endpoint>/route.ts
- Create test file src/app/api/<endpoint>/route.test.ts
- Update or create related UI page in src/app/<endpoint>/page.tsx

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.