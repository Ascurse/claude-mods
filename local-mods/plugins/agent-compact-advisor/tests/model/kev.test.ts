import { expect, test } from "claude-code/testing";

import { kevBodyOf, noulOf } from "../../hooks/model/kev.ts";

test("the body asks one noul question over the answer's last 8000 chars", () => {
  const body = JSON.parse(
    kevBodyOf("kev-latest", `${"x".repeat(9000)}END`),
  ) as {
    model: string;
    state: string;
    questions: { done: { type: string } };
  };
  expect(body.model).toBe("kev-latest");
  expect(body.state).toHaveLength(8000);
  expect(body.state.endsWith("END")).toBe(true);
  expect(body.questions.done.type).toBe("noul");
});

test("noul is read only when it is a number in 0..1", () => {
  expect(noulOf({ answers: { done: { type: "noul", noul: 0.84 } } })).toBe(
    0.84,
  );
  expect(noulOf({ answers: { done: { noul: 1.5 } } })).toBeUndefined();
  expect(noulOf({ answers: {} })).toBeUndefined();
  expect(noulOf("<html>502</html>")).toBeUndefined();
});
