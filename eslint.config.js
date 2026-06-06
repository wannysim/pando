// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules", "coverage", "dist", "dashboard", "deploy"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/core/**", "src/pipeline/**", "src/scheduler/**"],
    rules: {
      // engineering-standards §2.2: 순수 계층은 I/O 모듈 임포트 금지 (ports로만 의존)
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "node:fs", message: "core/pipeline/scheduler는 순수 계층입니다. port 인터페이스를 통해 주입하세요." },
            { name: "node:fs/promises", message: "core/pipeline/scheduler는 순수 계층입니다. port 인터페이스를 통해 주입하세요." },
            { name: "node:child_process", message: "core/pipeline/scheduler는 순수 계층입니다. port 인터페이스를 통해 주입하세요." },
            { name: "node:net", message: "core/pipeline/scheduler는 순수 계층입니다. port 인터페이스를 통해 주입하세요." },
            { name: "node:http", message: "core/pipeline/scheduler는 순수 계층입니다. port 인터페이스를 통해 주입하세요." }
          ],
          patterns: [
            {
              group: ["**/engines/*", "**/reporters/*", "**/worktree/*", "**/db/*", "**/intake/*"],
              message: "순수 계층에서 adapter를 직접 임포트할 수 없습니다. core의 port 타입에만 의존하세요."
            }
          ]
        }
      ]
    }
  }
);
