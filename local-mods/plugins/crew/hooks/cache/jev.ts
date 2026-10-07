// Кэш ответов jev в $.store: повторный запрос, даже из новой сессии, не запускает jev.
import type { JevCacheEntry, TaskInfo } from '../../types'

export const JEV_CACHE_KEY = 'crew.jevCache'
export const JEV_LIMIT = 50

type CacheStore = { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> }

/** FNV-1a, 32 бита: ключу кэша нужна стабильность, а не стойкость. */
export const fnv1a = (text: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Область ответа: хеш каталога и размер выдачи (или метка тегов). */
export const jevScope = (catalogHash: string, topK: number): string => `${catalogHash}:${topK}`

export const jevKey = (query: string, scope: string): string => fnv1a(`${scope}\n${query}`)

const entriesOf = (stored: unknown): JevCacheEntry[] =>
  Array.isArray(stored)
    ? stored.filter((e): e is JevCacheEntry => typeof e?.key === 'string' && Array.isArray(e.picks) && e.picks.every((p: unknown) => typeof p === 'string'))
    : []

export const getJev = async (store: CacheStore, key: string): Promise<string[] | undefined> =>
  entriesOf(await store.get(JEV_CACHE_KEY)).find(e => e.key === key)?.picks

/** Новая запись становится самой свежей; сверх лимита уходят самые старые. */
export const putJev = async (store: CacheStore, key: string, picks: readonly string[]): Promise<void> => {
  const kept = entriesOf(await store.get(JEV_CACHE_KEY)).filter(e => e.key !== key)
  await store.set(JEV_CACHE_KEY, [...kept, { key, picks: [...picks] }].slice(-JEV_LIMIT))
}

// v2: задача хранится вместе с plan; записи старого вида (строка) под прежним ключом больше не читаются
export const TASKS_KEY = 'crew.taskCache.v2'
export const TASK_LIMIT = 50

type TaskEntry = { key: string; tasks: Record<string, TaskInfo> }

const isTaskInfo = (t: unknown): t is TaskInfo =>
  typeof t === 'object' && t !== null && typeof (t as TaskInfo).task === 'string' && ((t as TaskInfo).plan === null || typeof (t as TaskInfo).plan === 'string')

const isTasks = (v: unknown): v is Record<string, TaskInfo> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every(isTaskInfo)

const taskEntriesOf = (stored: unknown): TaskEntry[] =>
  Array.isArray(stored) ? stored.filter((e): e is TaskEntry => typeof e?.key === 'string' && isTasks(e.tasks)) : []

/** Строки-задачи зависят от запроса, каталога, пятёрки в её порядке и папки проекта. */
export const taskKey = (query: string, catalogHash: string, agents: readonly string[], cwd: string): string =>
  jevKey(query, `tasks:${catalogHash}:${agents.join('|')}:${cwd}`)

export const getTasks = async (store: CacheStore, key: string): Promise<Record<string, TaskInfo> | undefined> =>
  taskEntriesOf(await store.get(TASKS_KEY)).find(e => e.key === key)?.tasks

export const putTasks = async (store: CacheStore, key: string, tasks: Record<string, TaskInfo>): Promise<void> => {
  const kept = taskEntriesOf(await store.get(TASKS_KEY)).filter(e => e.key !== key)
  await store.set(TASKS_KEY, [...kept, { key, tasks }].slice(-TASK_LIMIT))
}
