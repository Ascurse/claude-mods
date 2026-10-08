// Pure data of the CREW panel: which agents suit the prompt, and the text sent to the model.
// Nothing here touches `$`, so every rule is testable directly.
import type { CatalogEntry, Crew, CrewRow, RowPhase, Tag, TagMap, TaskInfo } from '../types'
import { fnv1a } from './cache/jev'
import { shorten } from './util'

export type { CatalogEntry, Crew, CrewRow, RowPhase, Tag, TagMap, TaskInfo }

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

/** Сколько знаков конца последнего ответа модели идёт в запрос следующего шага. */
export const CONTEXT_TAIL = 400

type ToolUse = { tool: string; input: Record<string, unknown> }
type TranscriptMessage = { role: 'user' | 'assistant'; text: string; toolUses?: readonly ToolUse[] }

/** Отчёт фонового агента и служебные строки команд — не запрос человека. */
const isPrompt = (m: TranscriptMessage) => m.role === 'user' && m.text.trim() !== '' && !/^\s*<(agent-message|command-|local-command-)/.test(m.text)

/** Последний настоящий промпт человека и последний непустой ответ Claude после него. */
export const lastExchange = (messages: readonly TranscriptMessage[]): { prompt: string; reply: string } => {
  const at = messages.findLastIndex(isPrompt)
  if (at < 0) return { prompt: '', reply: '' }
  const reply = messages.slice(at + 1).findLast(m => m.role === 'assistant' && m.text.trim() !== '')
  return { prompt: messages[at]!.text.trim(), reply: reply?.text.trim() ?? '' }
}

// ---------------------------------------------------------------- следующий шаг

/** Сколько задач из `bd ready` идёт в предсказание. */
export const READY_MAX = 3
/** Предел строки следующего шага: она же запрос jev и шапка CREW. */
export const STEP_MAX = 160

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

const usesOf = (messages: readonly TranscriptMessage[]) => messages.flatMap(m => m.toolUses ?? [])

/** Файлы, которые Claude правил или писал после последнего промпта человека, по одному разу. */
export const editedFiles = (messages: readonly TranscriptMessage[]): string[] => {
  const files = usesOf(messages.slice(messages.findLastIndex(isPrompt) + 1))
    .filter(u => EDIT_TOOLS.has(u.tool))
    .map(u => u.input.file_path ?? u.input.notebook_path)
    .filter((f): f is string => typeof f === 'string' && f !== '')
  return [...new Set(files)]
}

/** Агенты, которых сессия уже запускала инструментом Agent: CREW их не предлагает. */
export const spawnedIn = (messages: readonly TranscriptMessage[]): Set<string> =>
  new Set(
    usesOf(messages)
      .filter(u => u.tool === 'Agent' || u.tool === 'Task')
      .map(u => u.input.subagent_type)
      .filter((a): a is string => typeof a === 'string' && a !== ''),
  )

export const excludeSpawned = (picks: readonly string[], spawned: ReadonlySet<string>): string[] => picks.filter(a => !spawned.has(a))

/** Задачи `bd ready --json` строками `id: title`, не больше READY_MAX; нечитаемый вывод — пусто. */
export const parseReady = (stdout: string): string[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((t): t is { id: string; title: string } => typeof t?.id === 'string' && typeof t?.title === 'string')
    .slice(0, READY_MAX)
    .map(t => `${t.id}: ${t.title}`)
}

export type NextInput = {
  prompt: string
  reply: string
  files: readonly string[]
  gitStatus: string
  diffStat: string
  ready: readonly string[]
  suggestion: string | null
}

const tailOf = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > CONTEXT_TAIL ? `…${flat.slice(-CONTEXT_TAIL).trimStart()}` : flat
}

/** Что известно о сессии к концу хода; разделы без данных не пишутся. */
export const buildNextContext = (i: NextInput): string => {
  const reply = tailOf(i.reply)
  const sections: [string, string][] = [
    ['User request', i.prompt.trim()],
    ["Claude's latest reply", reply],
    ['Files edited this turn', i.files.join('\n')],
    ['git status --short', i.gitStatus.trimEnd()],
    ['git diff --stat', i.diffStat.trimEnd()],
    ['Ready tasks (bd ready)', i.ready.slice(0, READY_MAX).join('\n')],
    ["Claude Code's suggested next prompt", i.suggestion?.trim() ?? ''],
  ]
  return sections
    .filter(([, body]) => body.trim() !== '')
    .map(([title, body]) => `${title}:\n${body}`)
    .join('\n\n')
}

export const nextStepRequest = (context: string) => ({
  model: 'haiku',
  maxTokens: 200,
  system:
    'You predict the next step of a coding session from what was just done. Reply with one line only: the single most likely next step, as a short task for a specialist subagent. Do not suggest work that is already done in this session; look ahead to what should follow it.',
  prompt: `${context}\n\nWhat is the next step?`,
})

/** Строка шага из ответа Haiku: первая непустая, без метки `Next step:`; пусто — null. */
export const parseNextStep = (text: string): string | null => {
  const line = text.split('\n').map(l => l.trim()).find(l => l !== '') ?? ''
  const step = line.replace(/^(next step|step)\s*:\s*/i, '').replace(/^["'`]|["'`]$/g, '').trim().slice(0, STEP_MAX).trim()
  return step === '' ? null : step
}

export const draftRequest = (e: CatalogEntry, ctx: { query: string; cwd: string; task?: string | null; plan?: string | null }) => ({
  model: 'haiku',
  maxTokens: 600,
  system:
    'You write the task prompt for a subagent. Reply with the prompt text only: concrete, self-contained, a few sentences, no preface and no code fences.',
  prompt: `User request:\n${ctx.query}\n\nWorking directory: ${ctx.cwd}\n\nSubagent: ${e.agent}\nWhat it does: ${e.description}\n${ctx.task ? `\nIts one-line task for this request: ${ctx.task}\n` : ''}${ctx.plan ? `\nIts first steps, already shown to the user; begin the prompt with them, phrased as instructions to the subagent: ${ctx.plan}\n` : ''}\nWrite the prompt to give this subagent.`,
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

/**
 * Запрос главной модели: запустить перечисленных агентов инструментом Agent. Задание каждого идёт дословно
 * в ограждении, чтобы модель не пересказывала его и не делала работу сама.
 */
export const spawnRequest = (rows: readonly { agent: string; prompt: string }[], query: string): string => {
  const description = `crew · ${shorten(query, 40)}`
  const blocks = rows.map(({ agent, prompt }) => {
    // Ограждение длиннее любой серии ``` внутри задания, иначе оно оборвётся посреди текста
    const longestRun = Math.max(0, ...(prompt.match(/`+/g) ?? []).map(run => run.length))
    const fence = '`'.repeat(Math.max(3, longestRun + 1))
    return `subagent_type: ${agent}\n${fence}\n${prompt}\n${fence}`
  })
  return [
    `Start ${rows.length === 1 ? 'this subagent' : 'these subagents'} now: one Agent tool call each, in a single message.`,
    'For each call use the subagent_type given, run_in_background: true and this description:',
    `description: ${description}`,
    'Pass the text between the fences as the Agent prompt exactly as written, without rewording. Do not do the tasks yourself.',
    '',
    blocks.join('\n\n'),
  ].join('\n')
}

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

export const EDIT_HISTORY_LIMIT = 10

/** Новая правка первой; у агента остаётся не больше EDIT_HISTORY_LIMIT, соседние агенты не трогаются. */
export const pushHistory = (history: Record<string, string[]>, agent: string, text: string): Record<string, string[]> => ({
  ...history,
  [agent]: [text, ...(Array.isArray(history[agent]) ? history[agent] : [])].slice(0, EDIT_HISTORY_LIMIT),
})

// ---------------------------------------------------------------- одна строка-задача на агента

export const TASK_MAX = 120
/** Предел строки «с чего начнёт» под именем агента. */
export const PLAN_MAX = 160
/** Пометка вместо задачи, когда Haiku её не дал. */
export const NO_TASK = 'нет задачи'

/** Один запрос Haiku на всю пятёрку: что каждый агент сделал бы по этому запросу и с чего начал бы. */
export const taskRequest = (entries: readonly CatalogEntry[], ctx: { query: string; cwd: string }) => ({
  model: 'haiku',
  maxTokens: 1500,
  system:
    'You write one-line tasks for subagents. Reply with one JSON object only, no preface and no code fences: {"<agent name>": {"task": "<one line: what this agent would do for this request>", "plan": "<one or two short sentences: the first concrete steps it would take>"}}.',
  prompt: `User request:\n${ctx.query}\n\nWorking directory: ${ctx.cwd}\n\nAgents:\n${entries.map(e => `- ${e.agent}: ${(e.description.split('\n').find(l => l.trim() !== '') ?? '').trim()}`).join('\n')}`,
})

const oneLine = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max).trim() : ''

/**
 * Задачи из ответа Haiku: {task, plan} или по-старому строка-задача без plan. Неизвестные агенты и записи
 * без задачи отбрасываются; задача режется до TASK_MAX, plan до PLAN_MAX.
 */
export const parseTaskAnswer = (text: string, entries: readonly CatalogEntry[]): Record<string, TaskInfo> => {
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
  const out: Record<string, TaskInfo> = {}
  for (const [agent, value] of Object.entries(parsed)) {
    if (!known.has(agent)) continue
    const isObject = typeof value === 'object' && value !== null && !Array.isArray(value)
    const task = oneLine(isObject ? (value as { task?: unknown }).task : value, TASK_MAX)
    const plan = isObject ? oneLine((value as { plan?: unknown }).plan, PLAN_MAX) : ''
    if (task !== '') out[agent] = { task, plan: plan === '' ? null : plan }
  }
  return out
}
