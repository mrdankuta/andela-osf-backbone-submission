import { expect, test } from "vitest";
import {
  displayFreshness,
  hashText,
  judgeContentChange,
  tokenSignature,
} from "./source-monitor";

test("hashing is stable and sensitive", () => {
  expect(hashText("hello")).toBe(hashText("hello"));
  expect(hashText("hello")).not.toBe(hashText("hello!"));
});

test("identical content is unchanged", () => {
  const text = "A ₦10 billion fund for women.";
  expect(judgeContentChange(hashText(text), tokenSignature(text), text)).toEqual({ changed: false });
});

test("small tweaks change the version without paging a curator", () => {
  const before = "A ₦10 billion fund for women-owned businesses.";
  const after = "A ₦10 billion fund for women-owned businesses! Apply now.";
  const verdict = judgeContentChange(hashText(before), tokenSignature(before), after);
  expect(verdict).toMatchObject({ changed: true, meaningful: false });
});

test("large rewrites count as meaningful", () => {
  const before = "A ₦10 billion fund for women-owned businesses with mentoring.";
  const after = "Closed. This programme has ended permanently. See other funds.";
  const verdict = judgeContentChange(hashText(before), tokenSignature(before), after);
  expect(verdict).toMatchObject({ changed: true, meaningful: true });
});

test("first observation establishes the version", () => {
  expect(judgeContentChange(null, null, "hello").changed).toBe(true);
});

test("freshness display prioritizes closed, unavailable, review, stale", () => {
  expect(displayFreshness({ status: "expired", lastChecked: 1, unreachable: true, changedUnreviewed: true, hasOpenFlag: true }).state).toBe("closed");
  expect(displayFreshness({ status: "verified", unreachable: true, changedUnreviewed: false, hasOpenFlag: false }).state).toBe("unavailable");
  expect(displayFreshness({ status: "verified", unreachable: false, changedUnreviewed: false, hasOpenFlag: true }).state).toBe("under-review");
  expect(displayFreshness({ status: "verified", unreachable: false, changedUnreviewed: true, hasOpenFlag: false }).state).toBe("stale");
  expect(displayFreshness({ status: "verified", lastChecked: 7, unreachable: false, changedUnreviewed: false, hasOpenFlag: false })).toEqual({
    state: "ok",
    lastChecked: 7,
  });
});
