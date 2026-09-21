import { expect, test } from "vitest";
import {
  buildFieldVerificationQuestions,
  buildFieldVerificationState,
  extractApplyDestination,
  extractBenefit,
  extractContacts,
  extractCriteria,
  extractDeadline,
  extractDraftFields,
  extractProgramStatus,
  extractTitleFromHtml,
  splitSentences,
  stripHtml,
  verifyDraftFields,
} from "./import-extractor";

const SNAPSHOT = [
  "GLOW — Guaranteed Loans for Women.",
  "A ₦10 billion fund empowering women-owned businesses with affordable financing and mentorship.",
  "To be eligible, applicants must be women-owned businesses operating in Nigeria.",
  "Applicants must be CAC registered before applying.",
  "Applications close on 15 March 2027. Apply via the official portal at https://glow.boi.ng/apply.",
  "The programme is now open. Contact us at info@boi.ng or 0700-123-4567.",
].join(" ");

test("stripHtml removes scripts and tags", () => {
  const html = "<html><head><title>T</title><script>evil()</script></head><body><p>Hello <b>world</b></p></body></html>";
  expect(stripHtml(html)).toBe("T Hello world");
});

test("title prefers the HTML title tag", () => {
  const f = extractTitleFromHtml("<title>BOI GLOW programme</title><p>x</p>", "Fallback first line. Rest.");
  expect(f.status).toBe("proposed");
  expect(f.value).toBe("BOI GLOW programme");
});

test("benefit captures the amount sentence", () => {
  const f = extractBenefit(splitSentences(SNAPSHOT));
  expect(f.status).toBe("proposed");
  expect(f.value).toMatch(/₦10 billion/);
});

test("deadline normalizes an exact date by code", () => {
  const f = extractDeadline(splitSentences(SNAPSHOT));
  expect(f.status).toBe("proposed");
  expect(f.value).toBe("2027-03-15");
  expect(f.passage).toMatch(/close on 15 March 2027/);
});

test("conflicting deadlines stay unresolved", () => {
  const f = extractDeadline(splitSentences("Apply before 2027-03-15. Extended deadline: 20 June 2027."));
  expect(f.status).toBe("unresolved");
  expect(f.value).toBeNull();
});

test("absent deadline stays unresolved, never invented", () => {
  const f = extractDeadline(splitSentences("A great programme for women. Apply soon."));
  expect(f.status).toBe("unresolved");
});

test("contacts prefer the same-host official link", () => {
  const f = extractContacts(splitSentences(SNAPSHOT), "https://glow.boi.ng/portal");
  expect(f.status).toBe("proposed");
  expect(f.value).toBe("https://glow.boi.ng/apply");
});

test("criteria collect eligibility sentences, capped", () => {
  const criteria = extractCriteria(splitSentences(SNAPSHOT));
  expect(criteria.length).toBeGreaterThanOrEqual(2);
  expect(criteria.length).toBeLessThanOrEqual(8);
  expect(criteria.some((c) => /must be/.test(c.value ?? ""))).toBe(true);
});

test("programme status detects an open call", () => {
  expect(extractProgramStatus(splitSentences(SNAPSHOT)).value).toBe("Active");
  expect(extractProgramStatus(splitSentences("This programme has closed.")).value).toBe("Closed");
  expect(extractProgramStatus(splitSentences("A programme exists.")).status).toBe("unresolved");
});

test("apply destination selects the portal link", () => {
  const f = extractApplyDestination(splitSentences(SNAPSHOT), "https://glow.boi.ng/x");
  expect(f.status).toBe("proposed");
  expect(f.value).toBe("https://glow.boi.ng/apply");
});

test("empty snapshots resolve nothing", () => {
  const d = extractDraftFields("", "https://example.com/");
  expect(d.benefit.status).toBe("unresolved");
  expect(d.deadline.status).toBe("unresolved");
  expect(d.criteria).toEqual([]);
});

test("verification cascade only demotes", () => {
  const draft = extractDraftFields(SNAPSHOT, "https://glow.boi.ng/portal");
  const kept = verifyDraftFields(draft, {
    benefit: { choice: "supported", confidence: 0.9 },
    deadline: { choice: "uncertain", confidence: 0.9 },
    contacts: { choice: "supported", confidence: 0.5 },
    programStatus: { choice: "unsupported", confidence: 0.95 },
  });
  expect(kept.benefit.status).toBe("proposed");
  expect(kept.deadline.status).toBe("unresolved");
  expect(kept.contacts.status).toBe("unresolved");
  expect(kept.programStatus.status).toBe("unresolved");
  // Values are kept for the curator even when unresolved.
  expect(kept.deadline.passage).toBeTruthy();
});

test("verification questions cover only proposed fields", () => {
  const draft = extractDraftFields(SNAPSHOT, "https://glow.boi.ng/portal");
  const questions = buildFieldVerificationQuestions(draft);
  const state = buildFieldVerificationState(draft);
  expect(Object.keys(questions).length).toBeGreaterThan(3);
  expect(Object.keys(questions)).toEqual(Object.keys(state));
  expect(questions.benefit?.criteria.supported).toMatch(/directly states/);
});
