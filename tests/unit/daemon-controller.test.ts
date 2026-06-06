import { describe, expect, it, vi } from "vitest";
import { createDaemonLoopController } from "../../src/daemon/local-runtime";

describe("daemon loop controller", () => {
  it("runs one tick at a time and reports tick failures without stopping", async () => {
    const deferred = createDeferred<void>();
    const calls: string[] = [];
    const errors: string[] = [];
    const controller = createDaemonLoopController({
      intervalMs: 10,
      onError(error) {
        errors.push(error instanceof Error ? error.message : String(error));
      },
      async runOnce() {
        calls.push("start");
        await deferred.promise;
        calls.push("end");
        throw new Error("tick failed");
      },
    });

    const first = controller.tick();
    const second = controller.tick();
    deferred.resolve();
    await Promise.all([first, second]);

    expect(calls).toEqual(["start", "end"]);
    expect(errors).toEqual(["tick failed"]);
  });

  it("starts only one interval and calls onStop once when running", async () => {
    let ticks = 0;
    let stops = 0;
    const controller = createDaemonLoopController({
      intervalMs: 1_000,
      onStop() {
        stops += 1;
      },
      async runOnce() {
        ticks += 1;
      },
    });

    controller.start();
    controller.start();
    await controller.tick();
    controller.stop();
    controller.stop();

    expect(ticks).toBeGreaterThanOrEqual(1);
    expect(stops).toBe(1);
  });

  it("stops after a manual tick even when the interval was never started", async () => {
    let stops = 0;
    const controller = createDaemonLoopController({
      intervalMs: 1_000,
      onStop() {
        stops += 1;
      },
      async runOnce() {},
    });

    await controller.tick();
    controller.stop();
    controller.stop();

    expect(stops).toBe(1);
  });

  it("does not call onStop when stopped before any tick starts", () => {
    let stops = 0;
    const controller = createDaemonLoopController({
      intervalMs: 1_000,
      onStop() {
        stops += 1;
      },
      async runOnce() {},
    });

    controller.stop();

    expect(stops).toBe(0);
  });

  it("runs ticks from the configured interval", async () => {
    vi.useFakeTimers();
    let ticks = 0;
    const controller = createDaemonLoopController({
      intervalMs: 1_000,
      async runOnce() {
        ticks += 1;
      },
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(1_000);
    controller.stop();
    vi.useRealTimers();

    expect(ticks).toBeGreaterThanOrEqual(2);
  });
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}
