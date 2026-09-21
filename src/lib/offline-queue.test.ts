import { expect, test } from "vitest";
import {
  enqueueOp,
  loadQueue,
  replayQueue,
  type QueueStorage,
} from "./offline-queue";

function memoryStorage(): QueueStorage & { dump(): string | null } {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
    dump: () => store.get("ba-offline-queue") ?? null,
  };
}

test("enqueue preserves order and load recovers", () => {
  const s = memoryStorage();
  expect(loadQueue(s)).toEqual([]);
  enqueueOp(s, { kind: "tick", oppId: "a", step: 1, at: 1 });
  enqueueOp(s, { kind: "planState", oppId: "a", state: "applying", at: 2 });
  const ops = loadQueue(s);
  expect(ops.length).toBe(2);
  expect(ops[0]).toMatchObject({ kind: "tick", step: 1 });
  expect(ops[1]).toMatchObject({ kind: "planState", state: "applying" });
});

test("replay executes in order and clears on success", async () => {
  const s = memoryStorage();
  enqueueOp(s, { kind: "tick", oppId: "a", step: 1, at: 1 });
  enqueueOp(s, { kind: "tick", oppId: "a", step: 2, at: 2 });
  const seen: string[] = [];
  const res = await replayQueue(s, async (op) => {
    seen.push(`${op.kind}:${"oppId" in op ? op.oppId : op.url}`);
  });
  expect(res).toEqual({ replayed: 2, pending: [] });
  expect(seen).toEqual(["tick:a", "tick:a"]);
  expect(s.dump()).toBeNull();
});

test("failed ops stay queued for the next replay", async () => {
  const s = memoryStorage();
  enqueueOp(s, { kind: "tick", oppId: "a", step: 1, at: 1 });
  enqueueOp(s, { kind: "planState", oppId: "a", state: "applying", at: 2 });
  const first = await replayQueue(s, async (op) => {
    if (op.kind === "tick") throw new Error("offline");
  });
  expect(first.replayed).toBe(1);
  expect(first.pending.length).toBe(1);
  const second = await replayQueue(s, async () => {});
  expect(second).toEqual({ replayed: 1, pending: [] });
});

test("corrupt queues load as empty rather than crashing", () => {
  const s = memoryStorage();
  s.setItem("ba-offline-queue", "not json{{{");
  expect(loadQueue(s)).toEqual([]);
  s.setItem("ba-offline-queue", JSON.stringify([{ kind: "bogus" }, null, "x"]));
  expect(loadQueue(s)).toEqual([]);
});

test("legacy bare-tick entries replay as ticks", async () => {
  const s = memoryStorage();
  s.setItem("ba-offline-queue", JSON.stringify([{ oppId: "a", step: 2, at: 5 }]));
  const seen: string[] = [];
  const res = await replayQueue(s, async (op) => {
    seen.push(`${op.kind}:${"oppId" in op ? op.oppId : op.url}`);
  });
  expect(res).toEqual({ replayed: 1, pending: [] });
  expect(seen).toEqual(["tick:a"]);
});
