# [DEMO-1234] Jest environment setup and config cleanup

> Created: 2026-06-06T00:00:00+09:00
> Branch: feat/DEMO-1234
> Source: https://example.invalid/browse/DEMO-1234

## 📋 Requirements Overview

- Extend an existing CI test matrix to cover two additional workspaces.
- Add Jest configuration, setup files, and empty test directories for those workspaces.
- Standardize existing Jest config files by removing duplicate defaults and aligning option order.

## 🎨 Design & Logic Notes

This is an infrastructure/configuration ticket, not a UI ticket.

## 🏗 Implementation Roadmap

> Default shape: one PR with task-sized commits. The roadmap below is split by commit.

### Commit 1: Standardize existing Jest configs
- Focus: config cleanup
- Files: `apps/example-a/jest.config.ts`, `packages/example-b/jest.config.ts`
- Rationale: no new workspace behavior depends on this cleanup.

### Commit 2: Add missing Jest environments
- Focus: app-level setup
- Files: `apps/example-c/jest.config.ts`, `apps/example-d/jest.config.ts`
- Rationale: new setup files and package scripts can be reverted together.

### Commit 3: Expand CI test matrix
- Focus: CI integration
- Files: `.github/workflows/develop.ci.yml`, `.github/workflows/production.ci.yml`
- Rationale: CI should change only after workspace test scripts exist.

## 📝 Open Questions

- README scope: decide whether app README files should contain only test instructions or a short app overview too.

## ✅ Acceptance Criteria

- [ ] Existing config files remain green after cleanup.
- [ ] New workspaces can run their test command with no test files.
- [ ] CI matrix includes all intended workspaces.
