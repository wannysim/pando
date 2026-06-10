import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, expect } from "bun:test";

GlobalRegistrator.register();

const matchersModule = await import("@testing-library/jest-dom/matchers");
const { default: _default, ...matchers } = matchersModule;
const { cleanup } = await import("@testing-library/react");

expect.extend(matchers);

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});
