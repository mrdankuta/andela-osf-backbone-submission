/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("profile save and get round-trips all brief fields", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.profiles.save, {
    ownerKey: "dev-1", firstName: "Adaeze", state: "Lagos", sector: "Fashion",
    businessStage: "Growing", cac: "Registered", staffSize: 4, age: "25–35",
    womenLed: true, needs: ["grant"], reminderDays: [7, 3], lowData: false, language: "English",
  });
  const p = await t.query(api.profiles.get, { ownerKey: "dev-1" });
  expect(p?.firstName).toBe("Adaeze");
  expect(p?.staffSize).toBe(4);
  expect(p?.reminderDays).toEqual([7, 3]);
});

test("clearFields removes previously saved business fields but keeps settings", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.profiles.save, {
    ownerKey: "dev-clear", firstName: "Adaeze", state: "Lagos", sector: "Fashion",
    businessStage: "Growing", cac: "Registered", staffSize: 4, age: "25–35",
    womenLed: false, needs: ["loan"], reminderDays: [7, 3], lowData: true, language: "Pidgin",
  });
  await t.mutation(api.profiles.save, {
    ownerKey: "dev-clear",
    clearFields: ["firstName", "state", "sector", "businessStage", "cac", "staffSize", "age", "womenLed", "needs"],
  });
  const p = await t.query(api.profiles.get, { ownerKey: "dev-clear" });
  expect(p).not.toBeNull();
  expect(p?.firstName).toBeUndefined();
  expect(p?.state).toBeUndefined();
  expect(p?.sector).toBeUndefined();
  expect(p?.businessStage).toBeUndefined();
  expect(p?.cac).toBeUndefined();
  expect(p?.staffSize).toBeUndefined();
  expect(p?.age).toBeUndefined();
  expect(p?.womenLed).toBeUndefined();
  expect(p?.needs).toBeUndefined();
  expect(p?.reminderDays).toEqual([7, 3]);
  expect(p?.lowData).toBe(true);
  expect(p?.language).toBe("Pidgin");
});

test("profile update overwrites prefs", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.profiles.save, { ownerKey: "dev-2", firstName: "A" });
  await t.mutation(api.profiles.save, { ownerKey: "dev-2", firstName: "B", lowData: true, language: "Pidgin" });
  const p = await t.query(api.profiles.get, { ownerKey: "dev-2" });
  expect(p?.firstName).toBe("B");
  expect(p?.lowData).toBe(true);
});
