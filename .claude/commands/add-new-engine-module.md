---
name: add-new-engine-module
description: Workflow command scaffold for add-new-engine-module in GaN-optimization-.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /add-new-engine-module

Use this workflow when working on **add-new-engine-module** in `GaN-optimization-`.

## Goal

Adds a new engine module (such as compliance, data, loss, magnetics, thermal, control, simulation, topology, bom, copilot, firmware, layout, optimizer, schematic, export) with implementation, test, and index wiring.

## Common Files

- `src/lib/<module>/<module>.ts`
- `src/lib/<module>/<module>.test.ts`
- `src/lib/<module>/index.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Create implementation file in src/lib/<module>/<module>.ts
- Create test file in src/lib/<module>/<module>.test.ts
- Create or update index file in src/lib/<module>/index.ts

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.