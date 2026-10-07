// Логика сверки примера draftRequest в README без файловой системы: чтение и запись приходят снаружи,
// поэтому её проверяют тесты плагина, у которых нет node:fs.
import { draftRequest } from '../hooks/crew'

export const DRAFT_START = '<!-- draft-request:start (bun scripts/readme-draft.ts --write) -->'
export const DRAFT_END = '<!-- draft-request:end -->'

export type ReadmeIo = { read: () => string; write: (text: string) => void }
export type ReadmeDraftResult = { code: 0 | 1; message: string }

/** Блок README между метками: запрос run для строки с задачей и кратким черновиком. */
export const draftBlock = (): string => {
  const prompt = draftRequest(
    { agent: 'typescript-reviewer', description: 'Reviews typescript code', source: '' },
    {
      query: 'fix the flaky parser test',
      cwd: '/work/parser',
      task: 'Check the types in the parser diff',
      plan: 'Starts with tsc on the parser package, then reads the diff',
    },
  ).prompt
  return `${DRAFT_START}\n\`\`\`text\n${prompt}\n\`\`\`\n${DRAFT_END}`
}

export const runReadmeDraft = (io: ReadmeIo, opts: { write: boolean }): ReadmeDraftResult => {
  let readme: string
  try {
    readme = io.read()
  } catch (err) {
    return { code: 1, message: `readme-draft: не прочитать README.md — запускать из корня плагина (${err instanceof Error ? err.message : String(err)})` }
  }
  const from = readme.indexOf(DRAFT_START)
  const to = from < 0 ? -1 : readme.indexOf(DRAFT_END, from)
  if (from < 0 || to < 0) return { code: 1, message: `readme-draft: в README.md нет меток ${DRAFT_START} … ${DRAFT_END}` }

  const block = draftBlock()
  const current = readme.slice(from, to + DRAFT_END.length)
  if (current === block) return { code: 0, message: 'readme-draft: README совпадает с draftRequest' }
  if (!opts.write) {
    return {
      code: 1,
      message: 'readme-draft: пример в README.md расходится с draftRequest (hooks/crew.ts). Обновить: bun scripts/readme-draft.ts --write',
    }
  }
  io.write(readme.slice(0, from) + block + readme.slice(to + DRAFT_END.length))
  return { code: 0, message: 'readme-draft: пример в README обновлён' }
}
