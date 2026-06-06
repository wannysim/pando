# [DEMO-1234] Jest environment setup and config cleanup

> Created: 2026-06-06T00:00:00+09:00
> Branch: feat/DEMO-1234
> Source: https://example.invalid/browse/DEMO-1234

## 📋 Requirements Overview

- Extend an existing CI test matrix to cover two additional workspaces.
- Add Jest configuration, setup files, and empty test directories for those workspaces.
- Standardize existing Jest config files by removing duplicate defaults and aligning option order.
- Do not add runtime test cases in this planning step.

## 🎨 Design & Logic Notes

This is an infrastructure/configuration ticket, not a UI ticket.

## 🏗 Stacked PR Roadmap

> Legacy output shape preserved from DEMO-1234: this is parsed for drift detection,
> but current pando PLAN validation requires `Implementation Roadmap` commit units.

### PR 1: Existing Jest config standardization
- Focus: config cleanup
- Files: `apps/example-a/jest.config.ts`, `packages/example-b/jest.config.ts`
- Independence: no behavior change expected
- Commit: `refactor(test): standardize jest config defaults`

### PR 2: Add missing Jest environments
- Focus: app-level setup
- Depends on: PR 1
- Files: `apps/example-c/jest.config.ts`, `apps/example-d/jest.config.ts`
- Independence: new files and scripts only
- Commit: `chore(test): add missing jest environments`

## 📝 Open Questions

- **[Blocker] Base branch alignment**: implementation must start from the release branch that already contains the CI test job.
- README scope: decide whether app README files should contain only test instructions or a short app overview too.

## ✅ Acceptance Criteria

- [ ] Existing config files remain green after cleanup.
- [ ] New workspaces can run their test command with no test files.
- [ ] CI matrix includes all intended workspaces.
