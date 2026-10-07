// Ровно то из node, что нужно scripts/readme-draft.ts: @types/node в плагине нет,
// а глобальные process и console объявлять нельзя — hooks/ тогда прошли бы tsc с API, которых нет в песочнице.
// Эти модули tsc видит во всём проекте: импорт node:* в hooks/ или tests/ пройдёт проверку типов, но упадёт в песочнице.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function writeFileSync(path: string, data: string): void
}

declare module 'node:process' {
  type Stream = { write: (text: string) => boolean }
  export const argv: string[]
  export const stdout: Stream
  export const stderr: Stream
  export function exit(code: number): never
}
