export type Moment = 'before a plan' | 'error repeats' | 'before done'

export type Bucket = 'file' | 'shell' | 'other'

/** rule: settings allowed it. ask: put to the decider, outcome pending. cleared: asked, then ran. deny: refused. */
export type Verdict = 'rule' | 'ask' | 'cleared' | 'deny'

export type Main = { model: string; effort: string; mode: string; steps: number; isRunning: boolean }

export type Usage = {
  pct: number | null
  tokens: number | null
  window: number
  costUsd: number | null
  limits: { kind: string; pct: number }[]
  compactions: number
  lastCompactAt: number | null
}

export type Consult = { id: string; at: number; endAt: number | null; moment: Moment; via: string }

export type Architect = { consults: Consult[]; ids: string[]; seen: string[]; lastAdvice: string }

export type Check = {
  id: string
  tool: string
  bucket: Bucket
  verdict: Verdict
  inSubagent: boolean
  detail: string
  at: number
}

export type Tally = { rule: number; ask: number; cleared: number; deny: number }

export type Gate = { recent: Check[]; totals: Record<Bucket, Tally> }

export type ToolNote = { tool: string; text: string; isError: boolean }

export type AgentCard = {
  id: string
  type: string
  model: string
  description: string
  status: string
  spawnedAt: number
  endedAt: number | null
  /** The agent's context now: input + cache read + cache write of its latest step. */
  ctx: number
  /** Output tokens summed over its steps. */
  out: number
  steps: number
  lastStop: string | null
  tools: ToolNote[]
  answer: string
}

/** A model loop whose id matches no card: a workflow agent, a compaction or a memory fork. */
export type Loop = { id: string; steps: number; firstAt: number; lastAt: number; isDone: boolean }

export type LogLine = {
  at: number
  who: string
  text: string
  agentId: string | null
  kind: 'info' | 'error' | 'consult' | 'done'
}

export type Turn = {
  edits: number
  errorStreak: number
  errors: number
  isReviewing: boolean
  startedAt: number
  costAtStart: number | null
}

export type Receipt = {
  durationMs: number
  agents: number
  edits: number
  errors: number
  costDelta: number | null
  reason: string
}

export type Layout = 'auto' | 'compact' | 'wide' | 'mini'

export type View = { expanded: string | null; gateOpen: Bucket | null; layout: Layout | null }

export type Roster = { architectTypes: string[] }

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
    'flightdeck': {
      meta: { schemaVersion: number }
      main: Main
      usage: Usage
      architect: Architect
      gate: Gate
      agents: AgentCard[]
      loops: Loop[]
      log: LogLine[]
      turn: Turn
      receipt: Receipt | null
      view: View
      roster: Roster
      crew: Crew
    }
  }
}
