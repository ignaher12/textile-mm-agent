/**
 * The OFF function: one idempotent `shutdown()` that winds the agent down in
 * order, whatever triggered it. Each step gets its own timeout, so a dead
 * network can't hang the exit, and a failing step doesn't skip the rest.
 *
 * With Textile RFQ there are no resting orders to cancel: our quotes are
 * signed per request and expire within ~60 s. Going dark means making Stitch
 * stop answering, which the first step does through the feed.
 */
export interface ShutdownStep {
  name: string;
  run(reason: string): Promise<void> | void;
  timeoutMs?: number;
}

export interface ShutdownResult {
  reason: string;
  failed: { step: string; error: string }[];
}

export function createShutdown(opts: {
  steps: ShutdownStep[];
  defaultTimeoutMs?: number;
  log?: (msg: string) => void;
}) {
  const { steps, defaultTimeoutMs = 5_000, log = console.log } = opts;
  let running: Promise<ShutdownResult> | null = null;

  async function runAll(reason: string): Promise<ShutdownResult> {
    log(`🔴 Shutting down: ${reason}`);
    const failed: ShutdownResult["failed"] = [];
    for (const step of steps) {
      try {
        await withTimeout(Promise.resolve(step.run(reason)), step.timeoutMs ?? defaultTimeoutMs);
        log(`   ✓ ${step.name}`);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        failed.push({ step: step.name, error });
        log(`   ✗ ${step.name}: ${error}`);
      }
    }
    return { reason, failed };
  }

  return {
    /** Runs the shutdown once; later calls return the same result. */
    shutdown: (reason: string) => (running ??= runAll(reason)),
    get started() {
      return running !== null;
    },
  };
}

/**
 * Wires the OFF function to every way the process can end on its own terms:
 * Ctrl+C, the host stopping it, the console window closing (SIGHUP on
 * Windows), and unhandled errors. Exits non-zero for errors and failed steps.
 */
export function installShutdownHandlers(shutdown: (reason: string) => Promise<ShutdownResult>) {
  const exitAfter = (reason: string, code: number) =>
    void shutdown(reason).then((r) => process.exit(r.failed.length > 0 ? 1 : code));

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => exitAfter(signal, 0));
  }
  process.on("uncaughtException", (err) => exitAfter(`uncaught exception: ${err.message}`, 1));
  process.on("unhandledRejection", (err) => exitAfter(`unhandled rejection: ${String(err)}`, 1));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
