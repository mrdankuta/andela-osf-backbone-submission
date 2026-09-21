import { expect, test } from "vitest";
import {
  interpretProfileDescription,
  PROFILE_FIELDS,
  type ProfileField,
  type ProfileInterpretation,
  type ProfileJudgments,
} from "./profile-interpreter";

function prop(res: ProfileInterpretation, field: ProfileField) {
  const p = res.proposals.find((x) => x.field === field);
  if (!p) throw new Error(`missing proposal for ${field}`);
  return p;
}

function prob(res: ProfileInterpretation, field: ProfileField, label: string) {
  return prop(res, field).probabilities.find((x) => x.label === label)?.probability;
}

test("returns every profile field in declared order", async () => {
  const res = await interpretProfileDescription("I run a fashion business in Lagos.");
  expect(res.proposals.map((p) => p.field)).toEqual([...PROFILE_FIELDS]);
});

test("rejects descriptions outside 10..600 characters", async () => {
  await expect(interpretProfileDescription("short")).rejects.toThrow(/too short/);
  await expect(interpretProfileDescription(` ${"x".repeat(601)} `)).rejects.toThrow(/too long/);
});

test("fallback parses explicit facts and leaves sensitive fields unknown", async () => {
  const res = await interpretProfileDescription(
    "I run a fashion business in Lagos with 4 employees. My CAC is registered and I need a loan.",
  );
  expect(res.source).toBe("fallback");
  expect(prop(res, "state").value).toBe("Lagos");
  expect(prop(res, "sector").value).toBe("Fashion");
  expect(prop(res, "staffSize").value).toBe("4");
  expect(prop(res, "cac").value).toBe("Registered");
  expect(prop(res, "loan").value).toBe("Yes");
  expect(prop(res, "womenLed").value).toBe("unknown");
  expect(prop(res, "age").value).toBe("unknown");
  expect(prop(res, "grant").value).toBe("unknown");
});

test("fallback does not infer women-led or age from names or customers", async () => {
  const res = await interpretProfileDescription(
    "My name is Aisha. I sell clothes to women and work with female traders.",
  );
  expect(prop(res, "sector").value).toBe("Fashion");
  expect(prop(res, "womenLed").value).toBe("unknown");
  expect(prop(res, "age").value).toBe("unknown");
});

test("sparse description leaves every field unknown", async () => {
  const res = await interpretProfileDescription("I own a small business.");
  for (const p of res.proposals) expect(p.value).toBe("unknown");
});

test("model cannot infer sensitive facts the text does not state", async () => {
  const judge = async (): Promise<ProfileJudgments> => ({
    state: {
      choice: "Lagos",
      confidence: 0.9,
      probabilities: {
        Lagos: 0.9, "Abuja FCT": 0.025, Kano: 0.025, Rivers: 0.025,
        Oyo: 0.025, Kaduna: 0, Abia: 0, Ogun: 0, Kwara: 0, Gombe: 0,
        Other: 0, unknown: 0,
      },
    },
    womenLed: { choice: "Yes", confidence: 0.95, probabilities: { Yes: 0.95, No: 0, unknown: 0.05 } },
    age: {
      choice: "25–35",
      confidence: 0.9,
      probabilities: { "18–24": 0, "25–35": 0.9, "35+": 0, unknown: 0.1 },
    },
  });
  const res = await interpretProfileDescription(
    "My name is Aisha. I sell clothes to women and work with female traders.",
    judge,
  );
  expect(res.source).toBe("typesafe");
  expect(prop(res, "womenLed").value).toBe("unknown");
  expect(prop(res, "age").value).toBe("unknown");
  const state = prop(res, "state");
  expect(state.value).toBe("Lagos");
  expect(state.confidence).toBe(0.9);
  expect(state.probabilities.find((x) => x.label === "Lagos")?.probability).toBe(0.9);
});

test("explicit women-owned text lets the model answer stay", async () => {
  const judge = async (): Promise<ProfileJudgments> => ({
    womenLed: { choice: "Yes", confidence: 0.99, probabilities: { Yes: 0.99, No: 0, unknown: 0.01 } },
  });
  const res = await interpretProfileDescription(
    "I run a women-led tailoring business in Kano with 3 staff.",
    judge,
  );
  expect(prop(res, "womenLed").value).toBe("Yes");
  expect(prop(res, "womenLed").confidence).toBe(0.99);
  expect(prop(res, "staffSize").value).toBe("3");
});

test("throwing judge falls back to the deterministic parser", async () => {
  const res = await interpretProfileDescription(
    "I run a food business in Kano with 2 staff and I need a grant.",
    async () => {
      throw new Error("service down");
    },
  );
  expect(res.source).toBe("fallback");
  expect(prop(res, "state").value).toBe("Kano");
  expect(prop(res, "sector").value).toBe("Food");
  expect(prop(res, "staffSize").value).toBe("2");
  expect(prop(res, "grant").value).toBe("Yes");
});

test("malformed or out-of-range model answer degrades only that field", async () => {
  const judge = async (): Promise<ProfileJudgments> => ({
    state: { choice: "Atlantis", confidence: 0.9, probabilities: { Atlantis: 0.9 } },
    sector: { choice: "Fashion", confidence: 1.7, probabilities: { Fashion: 1 } },
    cac: {
      choice: "Registered",
      confidence: 0.8,
      probabilities: { Registered: 0.8, "In Progress": 0, "Not yet": 0, unknown: 0.2 },
    },
  });
  const res = await interpretProfileDescription(
    "I run a fashion business in Lagos and my CAC is registered.",
    judge,
  );
  expect(res.source).toBe("typesafe");
  const state = prop(res, "state");
  expect(state.value).toBe("unknown");
  expect(state.confidence).toBe(0);
  expect(state.probabilities).toEqual([{ label: "unknown", probability: 1 }]);
  const sector = prop(res, "sector");
  expect(sector.value).toBe("unknown");
  expect(sector.confidence).toBe(0);
  const cac = prop(res, "cac");
  expect(cac.value).toBe("Registered");
  expect(cac.confidence).toBe(0.8);
  expect(prob(res, "cac", "Registered")).toBe(0.8);
});

test("partial probability distribution degrades only that field", async () => {
  const judge = async (): Promise<ProfileJudgments> => ({
    sector: {
      choice: "Fashion",
      confidence: 0.9,
      probabilities: { Fashion: 0.9, Tech: 0.1 },
    },
    cac: {
      choice: "Registered",
      confidence: 0.7,
      probabilities: { Registered: 0.7, "In Progress": 0, "Not yet": 0, unknown: 0.3 },
    },
  });
  const res = await interpretProfileDescription(
    "I run a fashion business in Lagos and my CAC is registered.",
    judge,
  );
  const sector = prop(res, "sector");
  expect(sector.value).toBe("unknown");
  expect(sector.confidence).toBe(0);
  expect(sector.probabilities).toEqual([{ label: "unknown", probability: 1 }]);
  const cac = prop(res, "cac");
  expect(cac.value).toBe("Registered");
  expect(cac.confidence).toBe(0.7);
});

test("fallback needs require explicit intent, not mere mention", async () => {
  const asked = await interpretProfileDescription("I run a salon and I need a loan.");
  expect(prop(asked, "loan").value).toBe("Yes");
  const negated = await interpretProfileDescription(
    "I run a salon. I am not interested in a loan, but I am looking for a grant.",
  );
  expect(prop(negated, "loan").value).toBe("No");
  expect(prop(negated, "grant").value).toBe("Yes");
  const incidental = await interpretProfileDescription(
    "I already have a loan I repaid last year.",
  );
  expect(prop(incidental, "loan").value).toBe("unknown");
  const history = await interpretProfileDescription("I repaid a loan in 2023.");
  expect(prop(history, "loan").value).toBe("unknown");
});

test("Unicode age label serializes inside the probabilities array", async () => {
  const judge = async (): Promise<ProfileJudgments> => ({
    age: {
      choice: "18–24",
      confidence: 0.9,
      probabilities: { "18–24": 0.9, "25–35": 0.05, "35+": 0, unknown: 0.05 },
    },
  });
  const res = await interpretProfileDescription(
    "I am 20 years old and run a tailoring shop in Kano.",
    judge,
  );
  const age = prop(res, "age");
  expect(age.value).toBe("18–24");
  expect(Array.isArray(age.probabilities)).toBe(true);
  expect(age.probabilities).toHaveLength(4);
  expect(prob(res, "age", "18–24")).toBe(0.9);
});

test("model cannot assert needs the text does not state", async () => {
  const judge = async (): Promise<ProfileJudgments> => ({
    grant: { choice: "No", confidence: 0.9, probabilities: { Yes: 0.1, No: 0.85, unknown: 0.05 } },
    loan: { choice: "Yes", confidence: 0.9, probabilities: { Yes: 0.9, No: 0.05, unknown: 0.05 } },
    fellowship: { choice: "No", confidence: 0.9, probabilities: { Yes: 0.1, No: 0.85, unknown: 0.05 } },
  });
  const res = await interpretProfileDescription("I need a loan.", judge);
  expect(res.source).toBe("typesafe");
  expect(prop(res, "grant").value).toBe("unknown");
  expect(prop(res, "fellowship").value).toBe("unknown");
  const loan = prop(res, "loan");
  expect(loan.value).toBe("Yes");
  expect(loan.confidence).toBe(0.9);
});

test("explicit negated need keeps the model No", async () => {
  const judge = async (): Promise<ProfileJudgments> => ({
    grant: { choice: "No", confidence: 0.9, probabilities: { Yes: 0.1, No: 0.85, unknown: 0.05 } },
  });
  const res = await interpretProfileDescription(
    "I run a salon in Lagos and I do not want a grant.",
    judge,
  );
  const grant = prop(res, "grant");
  expect(grant.value).toBe("No");
  expect(grant.confidence).toBe(0.9);
});

test("explicit need wording overrides a wrong model answer", async () => {
  const judge = async (): Promise<ProfileJudgments> => ({
    grant: { choice: "No", confidence: 0.9, probabilities: { Yes: 0.1, No: 0.85, unknown: 0.05 } },
  });
  const res = await interpretProfileDescription(
    "I run a salon in Lagos and I need a grant.",
    judge,
  );
  const grant = prop(res, "grant");
  expect(grant.value).toBe("Yes");
  expect(grant.confidence).toBe(1);
  expect(grant.probabilities).toEqual([{ label: "Yes", probability: 1 }]);
});

test("owner age requires a person context", async () => {
  const businessAge = await interpretProfileDescription(
    "My business is 18-24 months old and still young.",
  );
  expect(prop(businessAge, "age").value).toBe("unknown");
  const young = await interpretProfileDescription("I run a young business in Lagos.");
  expect(prop(young, "age").value).toBe("unknown");
  const owner = await interpretProfileDescription("I am 30 years old and run a salon in Oyo.");
  expect(prop(owner, "age").value).toBe("25–35");
  const ranged = await interpretProfileDescription("I am in the 18-24 bracket and I farm in Kano.");
  expect(prop(ranged, "age").value).toBe("18–24");
});
