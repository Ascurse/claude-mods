/**
 * Kev's P1 over System One: the request body and the reading of its answer.
 */

// System One holds the socket on a long body (TASK-071): keep the answer's end.
const STATE_MAX = 8000;
const QUESTION =
  "Is the task this answer reports on finished, with nothing left for the agent or the owner to do?";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The System One request body: one `noul` question over the answer's end.
 * @param model the System One model
 * @param answer the main turn's final text
 * @returns the JSON body to POST to `/v1/systemone`
 */
export const kevBodyOf = (model: string, answer: string): string =>
  JSON.stringify({
    model,
    state: answer.slice(-STATE_MAX),
    questions: { done: { type: "noul", instructions: QUESTION } },
  });

/**
 * P1 from System One's parsed answer.
 * @param body the response body, parsed
 * @returns `answers.done.noul` when it is a number in 0..1, else undefined
 */
export const noulOf = (body: unknown): number | undefined => {
  const answers = isRecord(body) ? body["answers"] : undefined;
  const done = isRecord(answers) ? answers["done"] : undefined;
  const value = isRecord(done) ? done["noul"] : undefined;
  return typeof value === "number" && value >= 0 && value <= 1
    ? value
    : undefined;
};
