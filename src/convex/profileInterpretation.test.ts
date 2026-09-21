/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import {
  buildOpenRouterRequest,
  OPENROUTER_DECISIONS_URL,
  OPENROUTER_JEV_MODEL,
} from "./profileInterpretation";

const modules = import.meta.glob("./**/*.ts");

test("request builder targets the OpenRouter Jev decisions contract", () => {
  const req = buildOpenRouterRequest("I run a fashion business in Lagos.");
  expect(OPENROUTER_JEV_MODEL).toBe("~typesafe/jev-latest");
  expect(OPENROUTER_DECISIONS_URL).toBe("https://openrouter.ai/api/alpha/decisions");
  expect(req.model).toBe("~typesafe/jev-latest");
  expect(req.state).toEqual({ businessDescription: "I run a fashion business in Lagos." });
  expect(Object.keys(req.questions).length).toBe(11);
  for (const q of Object.values(req.questions)) expect(q.type).toBe("choice");
});

test("interpret uses fallback without an API key and never saves a profile", async () => {
  const t = convexTest(schema, modules);
  const res = await t.action(api.profileInterpretation.interpret, {
    description:
      "I run a fashion business in Lagos with 4 employees. My CAC is registered and I need a loan.",
  });
  expect(res.source).toBe("fallback");
  expect(res.proposals.length).toBe(12);
  const state = res.proposals.find((p) => p.field === "state");
  expect(state?.value).toBe("Lagos");
  const staff = res.proposals.find((p) => p.field === "staffSize");
  expect(staff?.value).toBe("4");
  const women = res.proposals.find((p) => p.field === "womenLed");
  expect(women?.value).toBe("unknown");
  for (const p of res.proposals) {
    expect(Array.isArray(p.probabilities)).toBe(true);
    for (const entry of p.probabilities) {
      expect(typeof entry.label).toBe("string");
      expect(typeof entry.probability).toBe("number");
    }
  }
  expect(await t.query(api.profiles.get, { ownerKey: "dev-interp" })).toBeNull();
});

test("reviewed fields save and round-trip only after explicit save", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.profiles.save, {
    ownerKey: "dev-save", state: "Kano", sector: "Agro", businessStage: "Scaling",
    cac: "Not yet", staffSize: 9, age: "35+", womenLed: false, needs: ["grant"],
  });
  const res = await t.action(api.profileInterpretation.interpret, {
    description:
      "I run a fashion business in Lagos with 4 employees. My CAC is registered and I need a loan.",
  });
  const reviewed = Object.fromEntries(res.proposals.map((p) => [p.field, p.value]));
  const clearFields = (["businessStage", "age", "womenLed"] as const).filter(
    (f) => reviewed[f] === "unknown",
  );
  const saved = await t.mutation(api.profiles.save, {
    ownerKey: "dev-save",
    state: reviewed.state === "unknown" ? undefined : reviewed.state,
    sector: reviewed.sector === "unknown" ? undefined : reviewed.sector,
    cac: reviewed.cac === "unknown" ? undefined : reviewed.cac,
    staffSize: reviewed.staffSize === "unknown" ? undefined : Number.parseInt(reviewed.staffSize, 10),
    needs: ["grant", "loan", "accelerator", "fellowship", "gov-program"].filter(
      (n) => reviewed[n as keyof typeof reviewed] === "Yes",
    ),
    clearFields: [...clearFields],
  });
  expect(saved).toBe(true);
  const p = await t.query(api.profiles.get, { ownerKey: "dev-save" });
  expect(p?.state).toBe("Lagos");
  expect(p?.sector).toBe("Fashion");
  expect(p?.staffSize).toBe(4);
  expect(p?.cac).toBe("Registered");
  expect(p?.needs).toEqual(["loan"]);
  expect(p?.businessStage).toBeUndefined();
  expect(p?.age).toBeUndefined();
  expect(p?.womenLed).toBeUndefined();
});
