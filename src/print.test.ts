import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(path.join(process.cwd(), "src/app.css"), "utf8");
const printBlock = css.slice(css.indexOf("@media print"));

test("print hides nav and interactive chrome", () => {
  for (const selector of [".tabbar", ".topbar", ".btn", ".chip", "button", "input", "select", "textarea"]) {
    expect(printBlock, selector).toMatch(new RegExp(selector.replace(".", "\\.")));
  }
  expect(printBlock).toMatch(/display:\s*none/);
});

test("print is low-ink with visible one-pager section", () => {
  expect(printBlock).toMatch(/background:#fff/);
  expect(printBlock).toMatch(/\.print-only\{display:block/);
  expect(css).toMatch(/\.print-only\{display:none\}/);
});
