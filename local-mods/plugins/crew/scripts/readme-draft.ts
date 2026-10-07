// Пример запроса draftRequest в README: без флага сверяет его с кодом, с --write вписывает заново.
// Живёт вне hooks/ и tests/: песочница `claude plugin test` не даёт читать файлы.
// Запуск из корня плагина: bun scripts/readme-draft.ts [--write]  (node не разрешает импорты без расширения в hooks/)
import { readFileSync, writeFileSync } from 'node:fs'
import { argv, exit, stderr, stdout } from 'node:process'
import { runReadmeDraft } from './readme-draft-core'

const README = 'README.md'

const result = runReadmeDraft(
  { read: () => readFileSync(README, 'utf8'), write: text => writeFileSync(README, text) },
  { write: argv.includes('--write') },
)
;(result.code === 0 ? stdout : stderr).write(`${result.message}\n`)
exit(result.code)
