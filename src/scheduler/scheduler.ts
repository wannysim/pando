import type { ContextProvider, RepoProfile } from "../core/types";
import { CountingSemaphore, type SemaphoreLease } from "./semaphore";

export interface RunSchedulerConfig {
  globalConcurrency: number;
  providerConcurrency: Partial<Record<ContextProvider, number>>;
}

export interface ScheduleRequest {
  jobId: string;
  repo: string;
  profile: RepoProfile;
}

export interface RunSchedulerLease {
  readonly jobId: string;
  release(): void;
}

export interface RunScheduler {
  readonly maxConcurrency: number;
  readonly activeJobIds: readonly string[];
  hasCapacity(): boolean;
  tryAcquire(request: ScheduleRequest): RunSchedulerLease | undefined;
}

export function createRunScheduler(config: RunSchedulerConfig): RunScheduler {
  return new InProcessRunScheduler(config);
}

class InProcessRunScheduler implements RunScheduler {
  private readonly global: CountingSemaphore;
  private readonly providers = new Map<ContextProvider, CountingSemaphore>();
  private readonly repos = new Map<string, CountingSemaphore>();
  private readonly active = new Set<string>();

  constructor(config: RunSchedulerConfig) {
    this.global = new CountingSemaphore(config.globalConcurrency);
    for (const [provider, capacity] of Object.entries(config.providerConcurrency)) {
      if (capacity !== undefined) {
        this.providers.set(provider as ContextProvider, new CountingSemaphore(capacity));
      }
    }
  }

  get maxConcurrency(): number {
    return this.global.capacity;
  }

  get activeJobIds(): readonly string[] {
    return [...this.active];
  }

  hasCapacity(): boolean {
    return this.global.available > 0;
  }

  tryAcquire(request: ScheduleRequest): RunSchedulerLease | undefined {
    if (this.active.has(request.jobId)) return undefined;

    const acquired: SemaphoreLease[] = [];
    const acquire = (semaphore: CountingSemaphore): boolean => {
      const lease = semaphore.tryAcquire();
      if (lease === undefined) return false;
      acquired.push(lease);
      return true;
    };

    if (!acquire(this.global)) return undefined;
    if (!acquire(this.repoSemaphore(request.repo, request.profile.concurrency))) {
      releaseAll(acquired);
      return undefined;
    }

    for (const provider of request.profile.context.providers) {
      const semaphore = this.providers.get(provider);
      if (semaphore === undefined) continue;
      if (!acquire(semaphore)) {
        releaseAll(acquired);
        return undefined;
      }
    }

    this.active.add(request.jobId);
    let released = false;
    return {
      jobId: request.jobId,
      release: () => {
        if (released) return;
        released = true;
        this.active.delete(request.jobId);
        releaseAll(acquired);
      },
    };
  }

  private repoSemaphore(repo: string, capacity: number): CountingSemaphore {
    const existing = this.repos.get(repo);
    if (existing !== undefined) return existing;

    const semaphore = new CountingSemaphore(capacity);
    this.repos.set(repo, semaphore);
    return semaphore;
  }
}

function releaseAll(leases: readonly SemaphoreLease[]): void {
  for (const lease of [...leases].reverse()) lease.release();
}
