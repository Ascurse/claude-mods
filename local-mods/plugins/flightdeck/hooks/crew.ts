// Pure data of the CREW panel: which agents suit the prompt, and the text sent to the model.
// Nothing here touches `$`, so every rule is testable directly.
import type { CatalogEntry, Crew, CrewRow, RowPhase, Tag, TagMap } from '../types'
import { fnv1a } from './cache/jev'

export type { CatalogEntry, Crew, CrewRow, RowPhase, Tag, TagMap }

export const CREW_SIZE = 5

/** Сколько агентов jev отдаёт, когда включён фильтр по тегам: после фильтра должно хватить на CREW_SIZE. */
export const FILTERED_TOP_K = 20
export const TAG_TOP_K = 3
export const TAG_BATCH_SIZE = 50

export const TAGS = [
  'frontend', 'backend', 'security', 'testing', 'data', 'devops', 'docs', 'design', 'mobile', 'ai', 'finance', 'sales', 'marketing', 'legal', 'ops',
] as const

const TAG_DESCRIPTIONS: Record<(typeof TAGS)[number], string> = {
  frontend: 'User interface work: web pages, React and other UI frameworks, CSS, browser behaviour, accessibility',
  backend: 'Server-side work: APIs, services, business logic, databases access layers, queues and integrations',
  security: 'Security: vulnerabilities, threat modeling, secrets, authentication, penetration tests and audits',
  testing: 'Testing and quality: unit, integration and end-to-end tests, test strategy, coverage, bug reproduction, code review',
  data: 'Data work: SQL, schemas, pipelines, analytics, reporting, statistics, data science and machine learning data',
  devops: 'Infrastructure and delivery: CI/CD, cloud, containers, deployment, monitoring, reliability and incidents',
  docs: 'Documentation and writing: README files, API docs, tutorials, technical writing, notes and summaries',
  design: 'Design: visual and interaction design, UX research, branding, design systems, illustrations',
  mobile: 'Mobile apps: iOS, Android, Flutter, React Native, app store releases',
  ai: 'AI and machine learning: LLM prompts, agents, RAG, model training and evaluation, MCP servers',
  finance: 'Finance and accounting: budgets, forecasts, bookkeeping, tax, payments and billing, investment',
  sales: 'Sales: prospecting, outreach, deals, pipeline, account management and customer success',
  marketing: 'Marketing: campaigns, ads, SEO, content, social media, analytics of growth and brand',
  legal: 'Legal and compliance: contracts, regulations, privacy, GDPR, audits, policies',
  ops: 'Business operations: process improvement, project and people management, support, procurement and logistics',
}

export const DEFAULT_CREW: Crew = { query: '', isLoading: false, by: null, rows: [], total: 0 }

/** Имя папки навыка: буквы, цифры и дефис как есть, остальное `_hex_`, так что разные агенты не сливаются. */
export const skillDirName = (agent: string): string => {
  const dir = [...agent].map(ch => (/[A-Za-z0-9-]/.test(ch) ? ch : `_${(ch.codePointAt(0) ?? 0).toString(16)}_`)).join('')
  return dir === '' ? '_' : dir
}

/** SKILL.md: в шапке одна строка описания, целиком оно идёт после шапки. */
export const skillFile = (e: CatalogEntry): string => {
  const firstLine = e.description.split('\n').find(l => l.trim() !== '')?.trim() ?? ''
  return `---\nname: ${skillDirName(e.agent)}\ndescription: ${JSON.stringify(firstLine)}\n---\n${e.description}`
}

/** Агенты в порядке ответа jev; null, когда ответ нельзя использовать. */
export const parseJevPicks = (stdout: string, catalog: readonly CatalogEntry[]): string[] | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const { status, skills } = parsed as { status?: unknown; skills?: unknown }
  if (status !== 'ok' || !Array.isArray(skills)) return null
  const byDir = new Map(catalog.map(e => [skillDirName(e.agent), e.agent]))
  const picks: string[] = []
  for (const s of skills) {
    const agent = typeof s?.name === 'string' ? byDir.get(s.name) : undefined
    if (agent !== undefined && !picks.includes(agent)) picks.push(agent)
  }
  return picks
}

const wordsOf = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** Запасной отбор: чем больше слов запроса встречается в имени и описании, тем выше; без совпадений — пусто. */
export const wordPicks = (catalog: readonly CatalogEntry[], query: string, k: number): string[] => {
  const wanted = [...new Set(wordsOf(query))]
  if (k <= 0 || wanted.length === 0) return []
  return catalog
    .map((e, order) => {
      const have = new Set(wordsOf(`${e.agent} ${e.description}`))
      return { agent: e.agent, order, score: wanted.filter(w => have.has(w)).length }
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, k)
    .map(x => x.agent)
}

export const mergePicks = (jev: readonly string[] | null, words: readonly string[], k: number): { picks: string[]; by: 'jev' | 'words' } => {
  const first = [...new Set(jev ?? [])]
  const by = first.length > 0 ? 'jev' : 'words'
  return { picks: [...new Set([...first, ...words])].slice(0, k), by }
}

export const rowsFor = (picks: readonly string[], catalog: readonly CatalogEntry[]): CrewRow[] =>
  picks.flatMap(agent => {
    const e = catalog.find(x => x.agent === agent)
    return e ? [{ agent, description: e.description, phase: 'idle' as const, draft: null, error: null }] : []
  })

export const draftRequest = (e: CatalogEntry, ctx: { query: string; cwd: string; task?: string | null }) => ({
  model: 'haiku',
  maxTokens: 600,
  system:
    'You write the task prompt for a subagent. Reply with the prompt text only: concrete, self-contained, a few sentences, no preface and no code fences.',
  prompt: `User request:\n${ctx.query}\n\nWorking directory: ${ctx.cwd}\n\nSubagent: ${e.agent}\nWhat it does: ${e.description}\n${ctx.task ? `\nIts one-line task for this request: ${ctx.task}\n` : ''}\nWrite the prompt to give this subagent.`,
})

/** Ответ модели без рамки: обрезка пробелов, ограждение ``` и ведущая метка `Prompt:`. */
export const cleanDraft = (text: string): string => {
  const noLabel = (s: string) => s.replace(/^prompt:\s*/i, '').trim()
  const noFence = (s: string) => s.replace(/^```[^\n]*\n([\s\S]*?)\n?```$/, '$1').trim()
  return noLabel(noFence(noLabel(text.trim())))
}

export const setPhase = (crew: Crew, agent: string, phase: RowPhase, patch: { draft?: string | null; error?: string | null } = {}): Crew =>
  crew.rows.some(r => r.agent === agent)
    ? { ...crew, rows: crew.rows.map(r => (r.agent === agent ? { ...r, ...patch, phase } : r)) }
    : crew

// ---------------------------------------------------------------- теги

/** SKILL.md псевдонавыка-тега: по нему jev выбирает теги запроса. */
export const tagFile = (tag: Tag): string => skillFile({ agent: tag, description: TAG_DESCRIPTIONS[tag as keyof typeof TAG_DESCRIPTIONS] ?? tag, source: '' })

/** Хеш каталога не зависит от порядка выдачи агентов. */
export const catalogHash = (catalog: readonly CatalogEntry[]): string =>
  fnv1a(JSON.stringify([...catalog].map(e => [e.agent, e.description]).sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''))))

export const tagBatches = (catalog: readonly CatalogEntry[]): CatalogEntry[][] => {
  const batches: CatalogEntry[][] = []
  for (let i = 0; i < catalog.length; i += TAG_BATCH_SIZE) batches.push(catalog.slice(i, i + TAG_BATCH_SIZE))
  return batches
}

export const tagRequest = (batch: readonly CatalogEntry[]) => ({
  model: 'haiku',
  maxTokens: 3000,
  system:
    'You label subagents with tags. Reply with one JSON object only, no preface and no code fences: {"<agent name>": ["tag", ...]}. Use only the allowed tags, one to three per agent.',
  prompt: `Allowed tags: ${TAGS.join(', ')}\n\nAgents:\n${batch.map(e => `- ${e.agent}: ${(e.description.split('\n').find(l => l.trim() !== '') ?? '').trim()}`).join('\n')}`,
})

/** Теги из ответа Haiku: неизвестные агенты и теги отбрасываются, нечитаемый ответ даёт пустой результат. */
export const parseTagAnswer = (text: string, catalog: readonly CatalogEntry[]): TagMap => {
  const from = text.indexOf('{')
  const to = text.lastIndexOf('}')
  if (from < 0 || to < from) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(from, to + 1))
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const known = new Set(catalog.map(e => e.agent))
  const out: TagMap = {}
  for (const [agent, value] of Object.entries(parsed)) {
    if (!known.has(agent) || !Array.isArray(value)) continue
    const tags = [...new Set(value.filter((t): t is Tag => typeof t === 'string' && (TAGS as readonly string[]).includes(t)))]
    if (tags.length > 0) out[agent] = tags
  }
  return out
}

/** Агенты хотя бы с одним тегом запроса; без тегов запроса фильтра нет, без тегов у агента он при фильтре выпадает. */
export const filterByTags = (catalog: readonly CatalogEntry[], tagMap: TagMap, queryTags: readonly Tag[]): CatalogEntry[] =>
  queryTags.length === 0 ? [...catalog] : catalog.filter(e => (tagMap[e.agent] ?? []).some(t => queryTags.includes(t)))

export const tagHeader = (shown: number, total: number, by: 'jev' | 'words' | null, tags: readonly Tag[]): string =>
  [`${shown} of ${total}`, by === 'jev' ? 'jev' : 'by words', ...(tags.length > 0 ? [tags.join(', ')] : [])].join(' · ')

export const EDIT_HISTORY_LIMIT = 10

/** Новая правка первой; у агента остаётся не больше EDIT_HISTORY_LIMIT, соседние агенты не трогаются. */
export const pushHistory = (history: Record<string, string[]>, agent: string, text: string): Record<string, string[]> => ({
  ...history,
  [agent]: [text, ...(Array.isArray(history[agent]) ? history[agent] : [])].slice(0, EDIT_HISTORY_LIMIT),
})

// ---------------------------------------------------------------- одна строка-задача на агента

export const TASK_MAX = 120

/** Один запрос Haiku на всю пятёрку: что каждый агент сделал бы по этому запросу. */
export const taskRequest = (entries: readonly CatalogEntry[], ctx: { query: string; cwd: string }) => ({
  model: 'haiku',
  maxTokens: 800,
  system:
    'You write one-line tasks for subagents. Reply with one JSON object only, no preface and no code fences: {"<agent name>": "<one line: what this agent would do for this request>"}.',
  prompt: `User request:\n${ctx.query}\n\nWorking directory: ${ctx.cwd}\n\nAgents:\n${entries.map(e => `- ${e.agent}: ${(e.description.split('\n').find(l => l.trim() !== '') ?? '').trim()}`).join('\n')}`,
})

/** Строки из ответа Haiku: неизвестные агенты, пустые и нестроковые значения отбрасываются, строка режется до TASK_MAX. */
export const parseTaskAnswer = (text: string, entries: readonly CatalogEntry[]): Record<string, string> => {
  const from = text.indexOf('{')
  const to = text.lastIndexOf('}')
  if (from < 0 || to < from) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(from, to + 1))
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const known = new Set(entries.map(e => e.agent))
  const out: Record<string, string> = {}
  for (const [agent, value] of Object.entries(parsed)) {
    if (!known.has(agent) || typeof value !== 'string') continue
    const line = value.replace(/\s+/g, ' ').trim().slice(0, TASK_MAX).trim()
    if (line !== '') out[agent] = line
  }
  return out
}
