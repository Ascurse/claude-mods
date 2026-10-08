export type CatalogEntry = { agent: string; description: string; source: string }

export type RowPhase = 'idle' | 'writing' | 'draft' | 'started' | 'error'

export type CrewRow = {
  agent: string
  description: string
  phase: RowPhase
  draft: string | null
  error: string | null
  /** Одна строка Haiku: что агент сделал бы по запросу; null или нет, пока ответа нет. */
  task?: string | null
  /** Краткий черновик Haiku: с чего агент начнёт; рисуется под именем до run. */
  plan?: string | null
}

/** Задача агента и краткий черновик: с чего он начнёт; plan null, когда Haiku его не дал. */
export type TaskInfo = { task: string; plan: string | null }

/** Теги агентов из фиксированного словаря TAGS (hooks/crew.ts). */
export type Tag = string

/** Теги по агентам: ответ Haiku, оставшийся после отбрасывания неизвестных. */
export type TagMap = Record<string, Tag[]>

/** Запись кэша jev: ключ из запроса и каталога, агенты (или теги) в порядке ответа. */
export type JevCacheEntry = { key: string; picks: string[] }

/** Последние правки черновиков по агентам, новые первыми. */
export type EditHistory = Record<string, string[]>

/**
 * total: сколько агентов прошло фильтр (весь каталог, когда фильтра нет). tags: применённые теги запроса.
 * editing: агент, чей черновик открыт в окне правки.
 */
export type Crew = {
  /** Предсказанный следующий шаг: по нему подобраны агенты и он же в шапке. */
  query: string
  isLoading: boolean
  by: 'jev' | 'words' | null
  rows: CrewRow[]
  total: number
  tags?: Tag[]
  editing?: string | null
  /** Идёт фоновый запрос строк-задач: у строк без задачи рисуется `…`. */
  isTasking?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'crew': {
      crew: Crew
    }
  }
}
