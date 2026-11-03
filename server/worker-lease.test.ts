import { describe, it, expect, vi } from "vitest";
vi.mock("./db.ts", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  return { db: new DatabaseSync(":memory:") };
});
import { db } from "./db.ts";
import {
  acquireWorkerLease,
  releaseWorkerLease,
  renewWorkerLease,
} from "./worker-lease";
describe("single active audit worker", () => {
  it("rejects another live owner and recovers an expired lease", () => {
    expect(acquireWorkerLease()).toBe(true);
    renewWorkerLease();
    db.prepare("UPDATE worker_lease SET owner=?,pid=?,expires_at=?").run(
      "another-worker",
      process.pid,
      Date.now() + 45000,
    );
    expect(acquireWorkerLease()).toBe(false);
    releaseWorkerLease();
    expect(db.prepare("SELECT owner FROM worker_lease").get()?.owner).toBe(
      "another-worker",
    );
    db.prepare("UPDATE worker_lease SET expires_at=0").run();
    expect(acquireWorkerLease()).toBe(true);
    releaseWorkerLease();
    expect(db.prepare("SELECT * FROM worker_lease").all()).toHaveLength(0);
  });
});
