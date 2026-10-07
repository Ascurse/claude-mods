/**
 * The preservation template every guarded compaction is told to follow.
 */

/** The instructions a compaction is given so the work can go on after it. */
export const TEMPLATE = [
  "Preserve for continuing this work after compaction:",
  "- Goal and the backlog task id, as the owner stated them; the owner's constraints.",
  "- Decisions made, each with its reason; what was rejected and why.",
  '- Open leftovers verbatim, including the last answer\'s "Хвосты для агента/владельца" lines.',
  "- Absolute file paths touched or relevant, the branch and uncommitted changes.",
  "- Verification commands run and their results (pass/fail, counts).",
  "- What not to do: approaches that failed, actions the owner forbade.",
  "- The next step.",
  "Mark what is confirmed versus assumed. Drop file contents already read and intermediate tool output.",
].join("\n");

/** The one-line `/compact` offered in the prompt box: one line, so it runs as typed. */
export const SUGGESTION =
  "/compact Keep the goal and task id, decisions with reasons, open leftovers verbatim, absolute file paths, verification commands and results, and what not to do.";

/**
 * The compaction's instructions with the template added after the owner's own.
 * @param instructions what was typed after `/compact`, if anything
 * @returns the template alone, or the owner's text and then the template
 */
export const withTemplate = (instructions: string | undefined): string => {
  const own = instructions?.trim() ?? "";
  return own === "" ? TEMPLATE : `${own}\n\n${TEMPLATE}`;
};
