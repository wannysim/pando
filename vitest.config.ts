import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // engineering-standards §2.1: core/gates/scheduler 95%+, 전체 85%+.
      // 디렉터리별 임계치는 해당 디렉터리에 코드가 생길 때 glob으로 추가한다.
      thresholds: {
        statements: 85,
        branches: 85,
        functions: 85,
        lines: 85
      }
    }
  }
});
