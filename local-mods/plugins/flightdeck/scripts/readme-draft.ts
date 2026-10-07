// Пример запроса draftRequest в README: без флага сверяет его с кодом, с --write вписывает заново.
// Живёт вне hooks/ и tests/: песочница `claude plugin test` не даёт читать файлы.
// Запуск: bun scripts/readme-draft.ts [--write]  (node не разрешает импорты без расширения в hooks/)
import { readFileSync, writeFileSync } from 'node:fs'
import { draftRequest } from '../hooks/crew'

const README = new URL('../README.md', import.meta.url)
const START = '<!-- draft-request:start (bun scripts/readme-draft.ts --write) -->'
const END = '<!-- draft-request:end -->'

const example = draftRequest(
  { agent: 'typescript-reviewer', description: 'Reviews typescript code', source: '' },
  {
    query: 'fix the flaky parser test',
    cwd: '/work/parser',
    task: 'Check the types in the parser diff',
    plan: 'Starts with tsc on the parser package, then reads the diff',
  },
).prompt

const block = `${START}\n\`\`\`text\n${example}\n\`\`\`\n${END}`

const readme = readFileSync(README, 'utf8')
const from = readme.indexOf(START)
const to = readme.indexOf(END)
if (from < 0 || to < from) {
  console.error(`readme-draft: в README.md нет меток ${START} … ${END}`)
  process.exit(1)
}
const current = readme.slice(from, to + END.length)

if (process.argv.includes('--write')) {
  if (current !== block) writeFileSync(README, readme.slice(0, from) + block + readme.slice(to + END.length))
  console.log(current === block ? 'readme-draft: README уже совпадает с draftRequest' : 'readme-draft: пример в README обновлён')
} else if (current !== block) {
  console.error('readme-draft: пример в README.md расходится с draftRequest (hooks/crew.ts). Обновить: bun scripts/readme-draft.ts --write')
  process.exit(1)
} else {
  console.log('readme-draft: README совпадает с draftRequest')
}
