// Offline operation queue: ticks and plan-state changes made without
// connectivity are stored locally and replayed in order when back online.
// Storage is injectable so the replay logic is unit-testable; the app passes
// localStorage.

export type QueuedOp =
  | { kind: "tick"; oppId: string; step: number; at: number }
  | { kind: "planState"; oppId: string; state: string; abandonReason?: string; at: number }
  | { kind: "linkSuggestion"; url: string; at: number };

export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const OFFLINE_QUEUE_KEY = "ba-offline-queue";

export function loadQueue(storage: QueueStorage): QueuedOp[] {
  try {
    const raw = storage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((op: any): op is QueuedOp => {
      if (!op || typeof op !== "object") return false;
      if (op.kind === "tick" || op.kind === "planState") return typeof op.oppId === "string";
      if (op.kind === "linkSuggestion") return typeof op.url === "string";
      // Legacy entries (pre-plan-states) were bare ticks.
      return typeof op.oppId === "string" && typeof op.step === "number";
    }).map((op: any): QueuedOp =>
      op.kind === "tick" || op.kind === "planState"
        ? op
        : { kind: "tick", oppId: op.oppId, step: op.step, at: op.at ?? Date.now() },
    );
  } catch {
    return [];
  }
}

function persist(storage: QueueStorage, ops: QueuedOp[]): void {
  if (ops.length === 0) storage.removeItem(OFFLINE_QUEUE_KEY);
  else storage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(ops));
}

export function enqueueOp(storage: QueueStorage, op: QueuedOp): QueuedOp[] {
  const ops = [...loadQueue(storage), op];
  persist(storage, ops);
  return ops;
}

/** Replay queued ops in order. Failures stay queued; successes are dropped. */
export async function replayQueue(
  storage: QueueStorage,
  execute: (op: QueuedOp) => Promise<unknown>,
): Promise<{ replayed: number; pending: QueuedOp[] }> {
  const ops = loadQueue(storage);
  const pending: QueuedOp[] = [];
  let replayed = 0;
  for (const op of ops) {
    try {
      await execute(op);
      replayed += 1;
    } catch {
      pending.push(op);
    }
  }
  persist(storage, pending);
  return { replayed, pending };
}
