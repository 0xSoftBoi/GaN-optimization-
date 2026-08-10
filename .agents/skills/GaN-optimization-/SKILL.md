```markdown
# GaN-optimization- Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns, coding conventions, and workflows used in the GaN-optimization- repository. The project is a TypeScript codebase built on Next.js, focusing on modular engineering engines and API endpoints for power electronics optimization. It emphasizes maintainable structure, consistent code style, and robust testing with vitest.

## Coding Conventions

- **File Naming:**  
  Use `camelCase` for file and directory names.
  ```
  src/lib/compliance/compliance.ts
  src/app/api/optimizer/route.ts
  ```

- **Import Style:**  
  Use alias imports for modules.
  ```typescript
  import { calculateLoss } from '@/lib/loss/loss';
  ```

- **Export Style:**  
  Prefer named exports.
  ```typescript
  // src/lib/thermal/thermal.ts
  export function calculateThermalProfile(params: ThermalParams): ThermalResult { ... }
  ```

- **Component and Module Structure:**  
  Each engine module lives in its own directory under `src/lib/`, with an implementation file, test file, and index file.
  ```
  src/lib/magnetics/magnetics.ts
  src/lib/magnetics/magnetics.test.ts
  src/lib/magnetics/index.ts
  ```

## Workflows

### Add New Engine Module
**Trigger:** When you want to add a new engine module or major feature to the `src/lib/` directory.  
**Command:** `/add-engine-module`

1. Create the implementation file:  
   `src/lib/<module>/<module>.ts`
2. Create the test file:  
   `src/lib/<module>/<module>.test.ts`
3. Create or update the index file:  
   `src/lib/<module>/index.ts`
4. Example:
   ```
   src/lib/optimizer/optimizer.ts
   src/lib/optimizer/optimizer.test.ts
   src/lib/optimizer/index.ts
   ```
5. Use named exports and alias imports as per conventions.

---

### Add API Endpoint
**Trigger:** When you want to expose a new API route under `src/app/api/`.  
**Command:** `/add-api-endpoint`

1. Create the route implementation file:  
   `src/app/api/<endpoint>/route.ts`
2. Create the test file:  
   `src/app/api/<endpoint>/route.test.ts`
3. Update or create the related UI page:  
   `src/app/<endpoint>/page.tsx`
4. Example:
   ```
   src/app/api/simulation/route.ts
   src/app/api/simulation/route.test.ts
   src/app/simulation/page.tsx
   ```

---

### Add or Update Project Goal or Plan Doc
**Trigger:** When you want to update project goals, masterplan, technical plan, or foundational research docs.  
**Command:** `/update-plan-doc`

1. Edit or add one of the following files:
   - `GOAL.md`
   - `MASTERPLAN.md`
   - `TECHPLAN.md`
   - `docs/PHYSICS.md`
2. Commit with a summary of changes.
3. Example commit message:
   ```
   Update TECHPLAN.md with new simulation workflow
   ```

## Testing Patterns

- **Framework:** [vitest](https://vitest.dev/)
- **Test File Pattern:**  
  Test files are named with `.test.ts` and colocated with the implementation.
  ```
  src/lib/control/control.test.ts
  src/app/api/layout/route.test.ts
  ```
- **Test Example:**
  ```typescript
  // src/lib/loss/loss.test.ts
  import { describe, it, expect } from 'vitest';
  import { calculateLoss } from './loss';

  describe('calculateLoss', () => {
    it('returns correct loss for typical input', () => {
      expect(calculateLoss({ voltage: 400, current: 10 })).toBeGreaterThan(0);
    });
  });
  ```

## Commands

| Command              | Purpose                                                         |
|----------------------|-----------------------------------------------------------------|
| /add-engine-module   | Scaffold a new engine module with implementation and tests      |
| /add-api-endpoint    | Scaffold a new API endpoint with route, test, and UI integration|
| /update-plan-doc     | Create or update project-level planning or research documents   |
```
