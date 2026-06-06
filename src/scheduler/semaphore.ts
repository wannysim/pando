export class CountingSemaphore {
  private used = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`semaphore capacity must be a positive integer: ${capacity}`);
    }
  }

  get available(): number {
    return this.capacity - this.used;
  }

  tryAcquire(): SemaphoreLease | undefined {
    if (this.used >= this.capacity) return undefined;
    this.used += 1;

    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.used -= 1;
      },
    };
  }
}

export interface SemaphoreLease {
  release(): void;
}
