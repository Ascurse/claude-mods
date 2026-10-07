import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { mock } from 'claude-code/testing'

import { skillDirName } from '../hooks/crew'
import type { CatalogEntry } from '../hooks/crew'

// ---------------------------------------------------------------- fixtures

export const entry = (agent: string, description: string, source = 'plugin'): CatalogEntry => ({ agent, description, source })

// Descriptions never contain another agent's name, so a name on screen means that row is drawn.
export const CATALOG: CatalogEntry[] = [
  entry('typescript-reviewer', 'Reviews typescript code for type safety and async bugs'),
  entry('Code Reviewer', 'Reviews code changes for correctness and maintainability'),
  entry('pkg:db-tuner', 'Tunes database queries and code that talks to postgres'),
  entry('repo-explorer', 'Searches the repository code to answer where things live'),
  entry('test-planner', 'Plans tests and reviews code coverage gaps'),
  entry('security-reviewer', 'Reviews code for secrets, injection and unsafe input'),
  entry('flutter-reviewer', 'Reviews dart and flutter code for widget mistakes'),
  entry('docs-writer', 'Writes documentation and readme files', 'built-in'),
]
export const NAMES = CATALOG.map(e => e.agent)
export const QUERY = 'review the code for bugs'
export const OTHER_QUERY = 'tune the postgres queries'
export const DRAFT = 'Review the parser diff and list real bugs only.'
export const JEV_FIVE = ['typescript-reviewer', 'security-reviewer', 'Code Reviewer', 'flutter-reviewer', 'test-planner']

export const jevStdout = (names: string[], status = 'ok') =>
  JSON.stringify({
    status,
    skills: names.map((n, i) => ({ name: skillDirName(n), path: `/cache/${skillDirName(n)}/SKILL.md`, match: 0.9 - i * 0.1 })),
  })


// ---------------------------------------------------------------- engine rig

export type JevAnswer = { exitCode: number; stdout: string } | 'reject'
export type ModelAnswer = { isAnswered: true; text: string } | { isAnswered: false; reason: 'empty-reply' }

export const deferred = <T = void>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

export type Rig = {
  writes: { path: string; text: string }[]
  runs: string[][]
  jevRuns: () => string[][]
  /** Запросы за черновиком промпта (без запросов на теги). */
  completes: { model: string; prompt: string; system?: string; maxTokens?: number }[]
  /** Запросы Haiku на однострочные задачи для строк CREW. */
  taskCompletes: { model: string; prompt: string; system?: string; maxTokens?: number }[]
  /** Запросы Haiku на разметку агентов тегами. */
  tagCompletes: { model: string; prompt: string; system?: string; maxTokens?: number }[]
  spawns: { subagentType?: string; prompt: string; description?: string }[]
  /** Панели, открытые через $.ui.open, и закрытые через $.ui.close. */
  opens: { id: string; focus?: true; closeOnEscape?: true }[]
  closes: string[]
  /** Хранилище $.store в памяти. */
  store: Map<string, unknown>
  /** Event order: 'write' | 'jev' */
  order: string[]
  settle: () => Promise<void>
}

export type RigOptions = {
  jev?: (argv: string[]) => JevAnswer | Promise<JevAnswer>
  model?: (req: { prompt: string }) => ModelAnswer | Promise<ModelAnswer>
  /** Ответ Haiku со строками-задачами; по умолчанию не отвечает, и задач нет. */
  task?: (req: { prompt: string }) => ModelAnswer | Promise<ModelAnswer>
  /** Ответ Haiku на разметку; по умолчанию не отвечает, и тегов нет. */
  tag?: (req: { prompt: string }) => ModelAnswer | Promise<ModelAnswer>
  spawn?: () => { deny: string } | { agentId: string } | Promise<{ deny: string } | { agentId: string }>
  /** Что лежит в $.store к началу теста. */
  store?: Record<string, unknown>
  /** Папка проекта сессии; по умолчанию PROJECT. */
  cwd?: string
}

export const PROJECT = '/work/project'

export const OFFER_PROVIDER = { plugin: 'engine', tier: 'core' as const }

export function rig(on: On, o: RigOptions = {}): Rig {
  const clock = mock.clock(on)
  const r: Rig = {
    writes: [],
    runs: [],
    jevRuns: () => r.runs.filter(a => a[0] === 'jev'),
    completes: [],
    tagCompletes: [],
    taskCompletes: [],
    spawns: [],
    opens: [],
    closes: [],
    store: new Map(Object.entries(o.store ?? {})),
    order: [],
    settle: async () => {
      await clock.advance(1)
    },
  }
  on('ui.status', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: o.cwd ?? PROJECT }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.offer', () => ({ isOffered: true }))
  on('fs.write', (_$, e) => {
    r.writes.push({ path: e.path, text: e.text })
    r.order.push('write')
    return { value: undefined }
  })
  on('process.run', async (_$, e) => {
    const argv = [...e.argv]
    r.runs.push(argv)
    let answer: JevAnswer = { exitCode: 0, stdout: '' }
    if (argv[0] === 'jev') {
      r.order.push('jev')
      answer = await (o.jev ?? (() => ({ exitCode: 0, stdout: jevStdout(JEV_FIVE) })))(argv)
    }
    if (answer === 'reject') return { deny: 'jev is not installed' }
    return { value: { exitCode: answer.exitCode, stdout: answer.stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('model.complete', async (_$, e) => {
    const isTagging = /label subagents/i.test(e.system ?? '')
    const isTasking = /one-line tasks/i.test(e.system ?? '')
    const asked = isTagging ? r.tagCompletes : isTasking ? r.taskCompletes : r.completes
    asked.push(e as never)
    const silent = () => ({ isAnswered: false as const, reason: 'empty-reply' as const })
    const answer = isTagging
      ? o.tag ?? silent
      : isTasking
        ? o.task ?? silent
        : o.model ?? (() => ({ isAnswered: true as const, text: DRAFT }))
    const a = await answer(e as never)
    return { value: { ...a, usage: {} } as never }
  })
  on('agent.spawn', async (_$, e) => {
    // движок 2.1.292 отдаёт хуку вход Agent-инструмента: тип агента лежит в subagent_type
    r.spawns.push({ subagentType: e.subagentType ?? (e as { subagent_type?: string }).subagent_type, prompt: e.prompt, description: e.description })
    const a = await (o.spawn ?? (() => ({ agentId: `crew${r.spawns.length}` })))()
    return 'deny' in a ? a : { model: 'claude-sonnet-5-5', agentId: a.agentId }
  })
  on('store.get', (_$, e) => ({ value: r.store.get(e.key) }))
  on('store.set', (_$, e) => {
    r.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    r.store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...r.store.keys()] }))
  on('ui.open', (_$, e) => {
    r.opens.push({ id: e.id, focus: e.focus, closeOnEscape: e.closeOnEscape })
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => {
    r.closes.push(e.id)
    return { value: undefined }
  })
  return r
}

export async function offerAll($: Engine, catalog: CatalogEntry[] = CATALOG) {
  for (const e of catalog) await $.agent.offer({ ...e, provider: OFFER_PROVIDER })
}

export const pane = (bodyColumns: number, requestId = 'flightdeck') => ({
  plugin: 'flightdeck',
  component: 'Pane' as const,
  requestId,
  props: {
    title: 'Flightdeck',
    isFocused: true,
    bodyColumns,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 70 },
    view: {},
  },
})

export const SURFACES = ['terminal', 'desktop'] as const

/** Offer the catalog, send one prompt, let background work settle. */
export async function ready($: Engine, r: Rig, query = QUERY) {
  await offerAll($)
  await $.turn.start({ text: query, turnId: `T-${query.length}` })
  await r.settle()
}

export type Mounted = Awaited<ReturnType<Engine['ui']['mount']>>

/** How many catalog agents are drawn as a row. */
export async function drawnRows(ui: Pick<Mounted, 'find'>): Promise<string[]> {
  const drawn: string[] = []
  for (const name of NAMES) if (await ui.find({ text: name })) drawn.push(name)
  return drawn
}

