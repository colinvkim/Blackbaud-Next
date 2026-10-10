import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { resolve } from 'node:path';

export interface BuildQueueOptions {
  build: (signal: AbortSignal) => Promise<void>;
  onSuccess: (signal: AbortSignal) => Promise<void> | void;
  onError: (error: unknown) => void;
  debounceMs?: number;
}

interface BuildWaiter {
  revision: number;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/** Keeps complete builds and extension reloads in one serialized operation. */
export class BuildQueue {
  private readonly options: BuildQueueOptions;
  private readonly controller = new AbortController();
  private revision = 0;
  private pendingRevision: number | undefined;
  private ready = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private readonly buildWaiters: BuildWaiter[] = [];
  private readonly idleWaiters: Array<() => void> = [];

  constructor(options: BuildQueueOptions) {
    this.options = options;
    if (!Number.isFinite(options.debounceMs ?? 150) || (options.debounceMs ?? 150) < 0) {
      throw new RangeError('Build debounce must be a nonnegative number.');
    }
  }

  requestBuild(): void {
    if (this.controller.signal.aborted) return;
    this.pendingRevision = ++this.revision;
    this.ready = false;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.ready = true;
      this.startNext();
    }, this.options.debounceMs ?? 150);
  }

  /** Runs an immediate initial build, rejecting rather than using stale output. */
  buildNow(): Promise<void> {
    if (this.controller.signal.aborted) return Promise.reject(this.controller.signal.reason);
    this.pendingRevision = ++this.revision;
    this.ready = true;
    this.clearTimer();
    const result = new Promise<void>((resolve, reject) => {
      this.buildWaiters.push({ revision: this.revision, resolve, reject });
    });
    this.startNext();
    return result;
  }

  idle(): Promise<void> {
    if (!this.running && this.pendingRevision === undefined && !this.timer) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  async dispose(): Promise<void> {
    if (!this.controller.signal.aborted) {
      this.controller.abort();
      this.clearTimer();
      this.pendingRevision = undefined;
      this.ready = false;
      for (const waiter of this.buildWaiters.splice(0)) waiter.reject(this.controller.signal.reason);
    }
    await this.running;
    this.resolveIdle();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private startNext(): void {
    if (this.controller.signal.aborted || this.running || !this.ready || this.pendingRevision === undefined) return;
    const revision = this.pendingRevision;
    this.pendingRevision = undefined;
    this.ready = false;
    this.running = this.run(revision).finally(() => {
      this.running = undefined;
      this.startNext();
      this.resolveIdle();
    });
  }

  private async run(revision: number): Promise<void> {
    try {
      await this.options.build(this.controller.signal);
      if (this.controller.signal.aborted || revision !== this.revision) return;
      await this.options.onSuccess(this.controller.signal);
      if (!this.controller.signal.aborted) this.settleBuildWaiters(revision);
    } catch (error) {
      if (this.controller.signal.aborted) return;
      this.settleBuildWaiters(revision, { error });
      try {
        this.options.onError(error);
      } catch (reportError) {
        // Reporting must not leave the queue stuck after a failed build.
        console.error('Could not report the development build error:', reportError);
      }
    }
  }

  private settleBuildWaiters(revision: number, failure?: { error: unknown }): void {
    for (let index = this.buildWaiters.length - 1; index >= 0; index--) {
      const waiter = this.buildWaiters[index];
      if (waiter.revision > revision) continue;
      this.buildWaiters.splice(index, 1);
      if (failure) waiter.reject(failure.error);
      else waiter.resolve();
    }
  }

  private resolveIdle(): void {
    if (this.running || this.pendingRevision !== undefined || this.timer !== undefined) return;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
}

/** Watches source inputs, including files created in new nested directories. */
export function watchProjectSources(
  root: string,
  onChange: (path: string) => void,
  onError: (error: unknown) => void = (error) => console.error('Source watcher failed:', error),
): () => void {
  const watchers: FSWatcher[] = [];
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const watcher of watchers) watcher.close();
  };
  try {
    for (const directory of ['src', 'assets', 'extension']) {
      const path = resolve(root, directory);
      const watcher = watch(path, { recursive: true }, (_event, filename) => {
        if (!closed) onChange(filename ? resolve(path, filename.toString()) : path);
      });
      watcher.on('error', (error) => { if (!closed) onError(error); });
      watchers.push(watcher);
    }
    const buildScript = resolve(root, 'scripts/build.ts');
    const watcher = watch(resolve(root, 'scripts'), (_event, filename) => {
      if (!closed && (filename === null || filename.toString() === 'build.ts')) onChange(buildScript);
    });
    watcher.on('error', (error) => { if (!closed) onError(error); });
    watchers.push(watcher);
  } catch (error) {
    close();
    throw error;
  }
  return close;
}
