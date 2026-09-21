import { expect, test } from "vitest";
import { normalizeSharedUrl, sameNormalizedUrl } from "./linkNormalize";

test("strips tracking noise but keeps identity", () => {
  expect(normalizeSharedUrl("https://glow.boi.ng/portal?utm_source=whatsapp&utm_medium=forward#section")).toBe(
    "glow.boi.ng/portal",
  );
  expect(normalizeSharedUrl("https://GLOW.BOI.NG/portal/")).toBe("glow.boi.ng/portal");
  expect(normalizeSharedUrl("www.boi.ng?a=1&fbclid=xyz")).toBe("boi.ng/?a=1");
  expect(normalizeSharedUrl("glow.boi.ng")).toBe("glow.boi.ng/");
});

test("rejects non-links", () => {
  expect(normalizeSharedUrl("")).toBeNull();
  expect(normalizeSharedUrl("just some text")).toBeNull();
  expect(normalizeSharedUrl("ftp://files.example.org/x")).toBeNull();
  expect(normalizeSharedUrl("notaurl")).toBeNull();
});

test("matches across forward noise, never across hosts", () => {
  expect(sameNormalizedUrl("https://glow.boi.ng/?utm_source=wa", "http://www.glow.boi.ng/")).toBe(true);
  expect(sameNormalizedUrl("https://glow.boi.ng/", "https://evil-boi.ng/")).toBe(false);
  expect(sameNormalizedUrl("https://glow.boi.ng/a", "https://glow.boi.ng/b")).toBe(false);
});
