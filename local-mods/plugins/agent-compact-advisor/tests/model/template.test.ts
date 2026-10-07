import { expect, test } from "claude-code/testing";

import {
  SUGGESTION,
  TEMPLATE,
  withTemplate,
} from "../../hooks/model/template.ts";

test("no instructions get the template alone", () => {
  expect(withTemplate(undefined)).toBe(TEMPLATE);
  expect(withTemplate("  \n")).toBe(TEMPLATE);
});

test("the owner's text comes first, the template after it", () => {
  expect(withTemplate("keep the API notes")).toBe(
    `keep the API notes\n\n${TEMPLATE}`,
  );
});

test("the suggestion is one /compact line", () => {
  expect(SUGGESTION.startsWith("/compact ")).toBe(true);
  expect(SUGGESTION).not.toContain("\n");
});

test("the template asks for what must survive", () => {
  for (const part of [
    "Goal",
    "Decisions",
    "leftovers verbatim",
    "Absolute file paths",
    "Verification commands",
    "What not to do",
  ]) {
    expect(TEMPLATE).toContain(part);
  }
});
