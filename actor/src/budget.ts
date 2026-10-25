import { Transform } from "node:stream";

/** Tracks a time + byte budget for one ingest. When exceeded, `stop()` aborts the download. */
export class Budget {
  readonly started = Date.now();
  bytes = 0;
  stoppedReason: string | null = null;
  readonly ctrl = new AbortController();

  constructor(
    readonly timeMs: number,
    readonly maxBytes: number,
  ) {}

  get elapsedMs() {
    return Date.now() - this.started;
  }

  check(): boolean {
    if (this.stoppedReason) return false;
    if (this.elapsedMs > this.timeMs) this.stop(`time budget of ${Math.round(this.timeMs / 1000)}s reached`);
    else if (this.bytes > this.maxBytes) this.stop(`byte budget of ${Math.round(this.maxBytes / 1e6)} MB reached`);
    return !this.stoppedReason;
  }

  stop(reason: string) {
    if (!this.stoppedReason) {
      this.stoppedReason = reason;
      this.ctrl.abort(new BudgetStop(reason));
    }
  }

  /** Byte counter placed right after the network stream (counts bytes as downloaded). */
  counter(): Transform {
    return new Transform({
      transform: (chunk: Buffer, _enc, cb) => {
        this.bytes += chunk.length;
        if (!this.check()) return cb(new BudgetStop(this.stoppedReason ?? "budget reached"));
        cb(null, chunk);
      },
    });
  }
}

export class BudgetStop extends Error {}
