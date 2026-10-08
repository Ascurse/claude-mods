import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CatalogEntry, Crew, EditHistory, TagMap } from '../types'
import {
  CREW_SIZE,
  DEFAULT_CREW,
  FILTERED_TOP_K,
  NO_TASK,
  TAGS,
  TAG_TOP_K,
  catalogHash,
  READY_MAX,
  buildNextContext,
  cleanDraft,
  draftRequest,
  editedFiles,
  excludeSpawned,
  filterByTags,
  lastExchange,
  mergePicks,
  nextStepRequest,
  parseNextStep,
  parseReady,
  parseJevPicks,
  parseTagAnswer,
  parseTaskAnswer,
  pushHistory,
  rowsFor,
  setPhase,
  skillDirName,
  skillFile,
  spawnRequest,
  spawnedIn,
  tagBatches,
  tagFile,
  tagRequest,
  taskRequest,
  wordPicks,
} from './crew'
import type { CrewRow, RowPhase, Tag, TaskInfo } from './crew'
import { getJev, getTasks, jevKey, jevScope, putJev, putTasks, taskKey } from './cache/jev'
import { busyRows, keptRows, nextTitle } from './rows'
import { PALETTES, handbackOf, listOf, normalize, parseConfig } from './util'
import type { Config } from './util'

const PANE = 'crew'
const TITLE = 'Crew'
const PANE_COLUMNS = 66
const EDIT_PANE = 'crew-edit'
const TAGS_KEY_PREFIX = 'crew.tags.'
const EDIT_HISTORY_KEY = 'crew.editHistory'

// ---------------------------------------------------------------- state

const crew = atom({ plugin: 'crew', key: 'crew' } as const, DEFAULT_CREW)

const normalizeCrew = (stored: unknown): Crew => {
  const c = normalize(DEFAULT_CREW, stored)
  return { ...c, rows: listOf<CrewRow>(c.rows), tags: listOf<Tag>(c.tags) }
}
async function getCrew($: EngineInterface): Promise<Crew> {
  return normalizeCrew(await read($, crew))
}

// Пустой CREW места не занимает: панель открывается с первой подсказкой.
// Открытую человеком через /crew панель видно и пустой: в шапке есть ↻.
const paneMemo = { isAutoOpen: true, isOpenedByHand: false }

async function openPane($: EngineInterface) {
  // columns apply when docked beside the transcript, rows when seated inline above the prompt.
  return $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS, rows: 8 })
}

async function markRow($: EngineInterface, agent: string, phase: RowPhase, patch: { draft?: string | null; error?: string | null } = {}) {
  await update($, crew, c => setPhase(normalizeCrew(c), agent, phase, patch))
}

const failure = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** У мода нет своего журнала: сбой обновления показывается всплывающей строкой. */
const notify = ($: EngineInterface, text: string) => $.ui.toast(`crew · ${text}`)

/**
 * Запуск по нажатию человека — запрос главной модели, а не прямой спавн: в auto mode движок не зовёт
 * собственные хуки плагина на $.agent.spawn, и классификатор отказывает вызову без запроса.
 * Модель сама вызывает Agent, и классификатор видит запрос.
 */
async function requestSpawn($: EngineInterface, rows: readonly { agent: string; prompt: string }[], query: string) {
  const sent = await $.prompt.submit({ text: spawnRequest(rows, query) })
  if (sent.drop !== undefined) throw new Error(sent.drop)
}

/** Просьба запустить агента с готовым промптом; отказ и исключение одинаково дают строку с ошибкой. */
async function startRow($: EngineInterface, agent: string, query: string, prompt: string) {
  try {
    await requestSpawn($, [{ agent, prompt }], query)
    await markRow($, agent, 'started', { draft: prompt, error: null })
  } catch (err) {
    await markRow($, agent, 'error', { error: `failed: ${failure(err)}` })
  }
}

// ---------------------------------------------------------------- crew

// Каталог агентов собирается из agent.offer; в SKILL.md он пишется заново только когда изменился.
const catalog = new Map<string, CatalogEntry>()
const crewMemo = {
  writtenCatalog: '',
  writtenTags: false,
  // Предсказанный шаг, под который собрана подборка; пустой, пока предсказание идёт
  lastQuery: '',
  // Промпт человека в этом ходе: запасной шаг, если переписка пуста или Haiku не ответил
  lastPrompt: '',
  // Серая подсказка Claude Code к следующему промпту
  suggestion: null as string | null,
  // Подсказка приходит после конца хода: по ней предсказание перезапускается один раз
  isTurnDone: false,
  isSuggestionUsed: false,
  // Агенты, уже запущенные в сессии: подборка их не предлагает
  spawned: new Set<string>(),
  // Номер последнего предсказания: ответ устаревшего не пишется
  predictSeq: 0,
  tags: null as { hash: string; map: TagMap } | null,
  taggedHash: '',
  // Один запрос строк-задач на ключ: повторный refreshCrew (после разметки) ждёт тот же ответ
  pendingTasks: new Map<string, Promise<Record<string, TaskInfo>>>(),
  // ставится до первого await: двойное нажатие ↻ не запускает второе обновление
  isHandRefreshing: false,
}

/** Каталог агентов и псевдонавыки тегов — соседние папки: jev обходит --root вглубь, и теги внутри каталога агентов вытесняли бы агентов из ответа. */
async function crewRoots($: EngineInterface) {
  const tmp = await $.env.get('TMPDIR').catch(() => undefined)
  const base = `${(tmp || '/tmp').replace(/\/$/, '')}/crew`
  return { agents: `${base}/agents`, tags: `${base}/tags` }
}

async function writeCatalog($: EngineInterface, root: string, entries: CatalogEntry[]) {
  const signature = JSON.stringify(entries)
  if (signature === crewMemo.writtenCatalog) return
  await Promise.all(entries.map(e => $.fs.write(`${root}/${skillDirName(e.agent)}/SKILL.md`, skillFile(e))))
  crewMemo.writtenCatalog = signature
}

async function writeTags($: EngineInterface, root: string) {
  if (crewMemo.writtenTags) return
  await Promise.all(TAGS.map(t => $.fs.write(`${root}/${t}/SKILL.md`, tagFile(t))))
  crewMemo.writtenTags = true
}

/** $.store нельзя передавать значением, поэтому кэшу отдаётся обёртка с вызовами по месту. */
const storeOf = ($: EngineInterface) => ({
  get: (key: string) => $.store.get(key),
  set: (key: string, value: unknown) => $.store.set(key, value),
})

/** Ответ jev из $.store, а при промахе или shouldSkipCache из запуска; неудачный запуск (null) в кэш не попадает. */
async function cachedJev($: EngineInterface, scope: string, query: string, shouldSkipCache: boolean, run: () => Promise<string[] | null>) {
  const key = jevKey(query, scope)
  const hit = shouldSkipCache ? undefined : await getJev(storeOf($), key).catch(() => undefined)
  if (hit !== undefined) return hit
  const picks = await run()
  if (picks !== null) await putJev(storeOf($), key, picks).catch(() => undefined)
  return picks
}

async function askJev($: EngineInterface, query: string, entries: CatalogEntry[], topK: number, shouldSkipCache: boolean) {
  return cachedJev($, jevScope(catalogHash(entries), topK), query, shouldSkipCache, async () => {
    try {
      const { agents } = await crewRoots($)
      await writeCatalog($, agents, entries)
      const done = await $.process.run(['jev', 'pick-skill', '--turn', query, '--root', agents, '--top-k', String(topK)])
      return done.exitCode === 0 ? parseJevPicks(done.stdout, entries) : null
    } catch {
      return null
    }
  })
}

/** Теги запроса: jev выбирает среди псевдонавыков <tags>/<tag>/SKILL.md; без ответа тегов нет. */
async function askTags($: EngineInterface, query: string, entries: CatalogEntry[], shouldSkipCache: boolean): Promise<Tag[]> {
  const tagStubs: CatalogEntry[] = TAGS.map(t => ({ agent: t, description: '', source: '' }))
  const picks = await cachedJev($, jevScope('tags', TAG_TOP_K), query, shouldSkipCache, async () => {
    try {
      const { agents, tags } = await crewRoots($)
      await writeCatalog($, agents, entries)
      await writeTags($, tags)
      const done = await $.process.run(['jev', 'pick-skill', '--turn', query, '--root', tags, '--top-k', String(TAG_TOP_K)])
      return done.exitCode === 0 ? parseJevPicks(done.stdout, tagStubs) : null
    } catch {
      return null
    }
  })
  return picks ?? []
}

const isTagMap = (v: unknown): v is TagMap => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Теги каталога: из памяти, затем из $.store по хешу каталога; null, пока их нет. */
async function loadTags($: EngineInterface, hash: string): Promise<TagMap | null> {
  if (crewMemo.tags?.hash === hash) return crewMemo.tags.map
  try {
    const stored = await $.store.get(`${TAGS_KEY_PREFIX}${hash}`)
    if (!isTagMap(stored)) return null
    crewMemo.tags = { hash, map: stored }
    return stored
  } catch {
    return null
  }
}

/** Фоновая разметка каталога Haiku пачками; раз за сессию на хеш, пустой результат не сохраняется. */
async function tagCatalog($: EngineInterface, entries: CatalogEntry[], hash: string) {
  if (crewMemo.taggedHash === hash) return
  crewMemo.taggedHash = hash
  const map: TagMap = {}
  for (const batch of tagBatches(entries)) {
    try {
      const done = await $.model.complete(tagRequest(batch))
      if (done.isAnswered) Object.assign(map, parseTagAnswer(done.text, batch))
    } catch {
      // пачка без ответа остаётся без тегов
    }
  }
  if (Object.keys(map).length === 0) return
  const key = `${TAGS_KEY_PREFIX}${hash}`
  for (const old of (await $.store.keys()).filter(k => k.startsWith(TAGS_KEY_PREFIX) && k !== key)) await $.store.delete(old)
  await $.store.set(key, map)
  crewMemo.tags = { hash, map }
  if (crewMemo.lastQuery !== '' && catalogHash([...catalog.values()]) === hash) await refreshCrew($, crewMemo.lastQuery)
}

/** Строки-задачи пятёрки: из кэша (кроме shouldSkipCache), иначе один запрос Haiku; пустой ответ в кэш не попадает. */
async function fetchTasks($: EngineInterface, query: string, entries: CatalogEntry[], picked: CatalogEntry[], shouldSkipCache: boolean) {
  const cwd = await $.session.cwd().catch(() => '')
  const key = taskKey(query, catalogHash(entries), picked.map(e => e.agent), cwd)
  const cached = shouldSkipCache ? undefined : await getTasks(storeOf($), key).catch(() => undefined)
  if (cached) return cached
  const inFlight = crewMemo.pendingTasks.get(key)
  if (inFlight) return inFlight
  const asked = (async (): Promise<Record<string, TaskInfo>> => {
    const done = await $.model.complete(taskRequest(picked, { query, cwd }))
    const tasks = done.isAnswered ? parseTaskAnswer(done.text, picked) : {}
    if (Object.keys(tasks).length > 0) await putTasks(storeOf($), key, tasks).catch(() => undefined)
    return tasks
  })()
  crewMemo.pendingTasks.set(key, asked)
  try {
    return await asked
  } finally {
    crewMemo.pendingTasks.delete(key)
  }
}

/** Фоново дописывает задачи в строки; список к этому моменту уже показан, сбой оставляет строки без задачи. */
async function loadTasks($: EngineInterface, query: string, entries: CatalogEntry[], rows: CrewRow[], shouldSkipCache: boolean) {
  const picked: CatalogEntry[] = rows.map(r => ({ agent: r.agent, description: r.description, source: '' }))
  try {
    const tasks = picked.length > 0 ? await fetchTasks($, query, entries, picked, shouldSkipCache) : {}
    if (crewMemo.lastQuery === query) {
      await update($, crew, c => {
        const n = normalizeCrew(c)
        const withTask = (r: CrewRow): CrewRow => {
          const t = tasks[r.agent]
          return t ? { ...r, task: t.task, plan: t.plan } : r
        }
        return { ...n, rows: n.rows.map(withTask) }
      })
    }
  } catch {
    // без ответа Haiku строки остаются без задачи
  } finally {
    if (crewMemo.lastQuery === query) await update($, crew, c => ({ ...normalizeCrew(c), isTasking: false }))
  }
}

/** isManual: ↻ или /crew refresh — мимо кэша; незаконченные черновики остаются сверху, новые строки занимают свободные места. */
async function refreshCrew($: EngineInterface, query: string, { isManual = false } = {}) {
  const entries = [...catalog.values()]
  const hash = catalogHash(entries)
  const prev = await getCrew($)
  const kept = keptRows(prev.rows, isManual)
  const keepEditing = { editing: kept.some(r => r.agent === prev.editing) ? prev.editing : null }
  await update($, crew, () => ({ ...DEFAULT_CREW, query, isLoading: true, total: entries.length, rows: kept, ...keepEditing }))
  try {
    const tagMap = await loadTags($, hash)
    if (!tagMap) void tagCatalog($, entries, hash).catch(() => undefined)
    const queryTags = tagMap ? await askTags($, query, entries, isManual) : []
    const filtered = filterByTags(entries, tagMap ?? {}, queryTags)
    // тегов никто не несёт: фильтр бесполезен, показываем как без него
    const isFiltered = queryTags.length > 0 && filtered.length > 0
    const pool = (isFiltered ? filtered : entries).filter(e => !crewMemo.spawned.has(e.agent))
    const jev = await askJev($, query, entries, isFiltered ? FILTERED_TOP_K : CREW_SIZE + crewMemo.spawned.size, isManual)
    const allowed = new Set(pool.map(e => e.agent))
    const size = CREW_SIZE + kept.length
    const { picks, by } = mergePicks(jev === null ? null : jev.filter(a => allowed.has(a)), wordPicks(pool, query, size), size)
    if (crewMemo.lastQuery === query) {
      let fresh: CrewRow[] = []
      await update($, crew, c => {
        // за время загрузки занятые строки могли смениться: берутся из текущего состояния
        const now = normalizeCrew(c)
        const held = keptRows(now.rows, isManual)
        const taken = new Set(held.map(r => r.agent))
        fresh = rowsFor(excludeSpawned(picks, crewMemo.spawned).filter(a => !taken.has(a)), entries).slice(0, Math.max(0, CREW_SIZE - held.length))
        return { query, isLoading: false, by, rows: [...held, ...fresh], total: pool.length, tags: isFiltered ? queryTags : [], isTasking: fresh.length > 0, editing: now.editing }
      })
      void loadTasks($, query, entries, fresh, isManual)
    }
  } finally {
    if (crewMemo.lastQuery === query) await update($, crew, c => ({ ...normalizeCrew(c), isLoading: false }))
  }
}

/** Вывод команды без оболочки; сбой и ненулевой код дают пустую строку: раздел просто не попадёт в запрос. */
async function runText($: EngineInterface, argv: string[], cwd: string): Promise<string> {
  try {
    const done = await $.process.run(argv, cwd ? { cwd } : {})
    return done.exitCode === 0 ? done.stdout : ''
  } catch {
    return ''
  }
}

type Exchange = { messages: Awaited<ReturnType<EngineInterface['session']['messages']>>; prompt: string; reply: string }

/** Haiku называет следующий шаг по переписке, репозиторию и задачам; без ответа шагом остаётся промпт человека. */
async function guessNextStep($: EngineInterface, { messages, prompt, reply }: Exchange): Promise<string> {
  const cwd = await $.session.cwd().catch(() => '')
  const [gitStatus, diffStat, ready] = await Promise.all([
    runText($, ['git', 'status', '--short'], cwd),
    runText($, ['git', 'diff', '--stat'], cwd),
    runText($, ['bd', 'ready', '--json', '--brief', '--limit', String(READY_MAX)], cwd),
  ])
  const context = buildNextContext({ prompt, reply, files: editedFiles(messages), gitStatus, diffStat, ready: parseReady(ready), suggestion: crewMemo.suggestion })
  try {
    const done = await $.model.complete(nextStepRequest(context))
    return (done.isAnswered ? parseNextStep(done.text) : null) ?? prompt
  } catch {
    return prompt
  }
}

type Prediction = { status: 'started'; done: Promise<void> } | { status: 'no-context' }

/** Предсказание шага и подборка под него; done — фоновая часть. Более позднее предсказание отменяет запись этого. */
async function predictNext($: EngineInterface, { isManual = false } = {}): Promise<Prediction> {
  const messages = await $.session.messages().catch(() => [])
  const last = lastExchange(messages)
  const prompt = last.prompt || crewMemo.lastPrompt
  if (prompt === '') return { status: 'no-context' }
  const seq = ++crewMemo.predictSeq
  const done = (async () => {
    try {
      crewMemo.spawned = spawnedIn(messages)
      // пустой шаг отменяет запись строк, которые ещё собирает прошлое обновление
      crewMemo.lastQuery = ''
      const prev = await getCrew($)
      const kept = keptRows(prev.rows, isManual)
      await update($, crew, () => ({ ...DEFAULT_CREW, isLoading: true, total: catalog.size, rows: kept, editing: kept.some(r => r.agent === prev.editing) ? prev.editing : null }))
      if (paneMemo.isAutoOpen) void openPane($).catch(() => undefined)
      const step = await guessNextStep($, { messages, prompt, reply: last.reply })
      if (seq !== crewMemo.predictSeq) return
      crewMemo.lastQuery = step
      await refreshCrew($, step, { isManual })
    } catch (err) {
      // прошлое предсказание уже отменено этим: панель не должна остаться в загрузке
      if (seq === crewMemo.predictSeq) await update($, crew, c => ({ ...c, isLoading: false })).catch(() => undefined)
      throw err
    }
  })()
  return { status: 'started', done }
}

/** Предсказание вне нажатия человека: сбой виден всплывающей строкой. */
// во время ↻ фоновое предсказание его сменяет и остаётся ручным: мимо кэша, запущенные строки на месте
const predictInBackground = ($: EngineInterface) =>
  void predictNext($, { isManual: crewMemo.isHandRefreshing })
    .then(p => (p.status === 'started' ? p.done : undefined))
    .catch(err => notify($, `prediction failed: ${failure(err)}`))

type HandRefresh = 'started' | 'busy' | 'no-agents' | 'no-context'

/** ↻ и /crew refresh: шаг предсказывается заново по текущей переписке, мимо кэша. */
async function refreshByHand($: EngineInterface): Promise<HandRefresh> {
  if (catalog.size === 0) return 'no-agents'
  if (crewMemo.isHandRefreshing) return 'busy'
  crewMemo.isHandRefreshing = true
  const release = () => {
    crewMemo.isHandRefreshing = false
  }
  let isStarted = false
  try {
    if ((await getCrew($)).isLoading) return 'busy'
    const p = await predictNext($, { isManual: true })
    if (p.status === 'no-context') return 'no-context'
    void p.done.catch(err => notify($, `refresh failed: ${failure(err)}`)).finally(release)
    isStarted = true
    return 'started'
  } finally {
    // не началось — флаг снимается сразу, иначе по окончании обновления
    if (!isStarted) release()
  }
}

const HAND_REFRESH_TEXT: Record<HandRefresh, string> = {
  started: 'Crew refreshing.',
  busy: 'Crew is already refreshing.',
  'no-agents': 'Crew has no agents yet.',
  'no-context': 'Crew has nothing to go on yet: send a prompt first.',
}

async function runRow($: EngineInterface, cfg: Config, agent: string) {
  const c = await getCrew($)
  const row = c.rows.find(r => r.agent === agent)
  if (!row || row.phase === 'writing') return
  await markRow($, agent, 'writing', { draft: null, error: null })
  try {
    const cwd = await $.session.cwd().catch(() => '')
    const done = await $.model.complete(draftRequest({ agent, description: row.description, source: '' }, { query: c.query, cwd, task: row.task, plan: row.plan }))
    if (!done.isAnswered) return await markRow($, agent, 'error', { error: `error: ${done.reason}` })
    const draft = cleanDraft(done.text)
    if (draft === '') return await markRow($, agent, 'error', { error: 'error: empty draft' })
    if (cfg.crewRun === 'direct') return await startRow($, agent, c.query, draft)
    await markRow($, agent, 'draft', { draft })
  } catch (err) {
    await markRow($, agent, 'error', { error: `error: ${failure(err)}` })
  }
}

async function startDraft($: EngineInterface, agent: string) {
  const c = await getCrew($)
  const row = c.rows.find(r => r.agent === agent)
  if (row?.phase === 'draft' && row.draft) await startRow($, agent, c.query, row.draft)
}

async function editDraft($: EngineInterface, agent: string) {
  const row = (await getCrew($)).rows.find(r => r.agent === agent)
  if (row?.phase !== 'draft' || !row.draft) return
  await update($, crew, c => ({ ...normalizeCrew(c), editing: agent }))
  await $.ui.open({ id: EDIT_PANE, title: `Edit · ${agent}`, focus: true, closeOnEscape: true }).catch(() => undefined)
}

async function clearEditing($: EngineInterface) {
  await update($, crew, c => ({ ...normalizeCrew(c), editing: null }))
}

/** Enter в окне правки: новый текст становится черновиком строки и попадает в историю агента. */
async function saveEdit($: EngineInterface, agent: string, text: string) {
  const draft = text.trim()
  if (draft !== '') {
    await markRow($, agent, 'draft', { draft, error: null })
    const history = ((await $.store.get(EDIT_HISTORY_KEY).catch(() => undefined)) ?? {}) as EditHistory
    await $.store.set(EDIT_HISTORY_KEY, pushHistory(history, agent, draft)).catch(() => undefined)
  }
  await $.ui.close({ id: EDIT_PANE }).catch(() => undefined)
  await clearEditing($)
}

// ---------------------------------------------------------------- hooks

const forget = () => {
  crewMemo.predictSeq++
  crewMemo.lastQuery = ''
  crewMemo.lastPrompt = ''
  crewMemo.suggestion = null
  crewMemo.spawned = new Set()
}

export const register: Register = (on, options) => {
  const cfg = parseConfig(options)
  paneMemo.isAutoOpen = cfg.autoOpen
  const C = PALETTES[cfg.palette]

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'crew',
      description: 'Crew, agents that fit your request: open, refresh, close or reset the pane',
      argumentHint: '[open|refresh|close|reset]',
    })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      forget()
      await update($, crew, () => DEFAULT_CREW)
    }
    return next(e)
  })

  on('command.run', { command: 'crew' }, async ($, e) => {
    const verb = e.args.trim().split(/\s+/)[0] || 'open'
    if (verb === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Crew closed.' }
    }
    if (verb === 'reset') {
      forget()
      await update($, crew, () => DEFAULT_CREW)
      return { text: 'Crew reset.' }
    }
    paneMemo.isOpenedByHand = true
    if (verb === 'refresh') {
      const done = await refreshByHand($)
      if (done !== 'started') return { text: HAND_REFRESH_TEXT[done] }
      const opened = await openPane($)
      return { text: opened.isPlaced ? HAND_REFRESH_TEXT.started : `${HAND_REFRESH_TEXT.started} The pane is not shown yet: ${opened.reason}` }
    }
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'Crew opened.' : `Crew is not shown yet: ${opened.reason}` }
  })

  on('agent.offer', async ($, e, next) => {
    const offered = await next(e)
    catalog.set(e.agent, { agent: e.agent, description: e.description, source: e.source })
    return offered
  })

  on('turn.start', async ($, e, next) => {
    crewMemo.isTurnDone = false
    crewMemo.isSuggestionUsed = false
    // подсказка относится к ответу, который только что закончился
    crewMemo.suggestion = null
    // Отчёт фонового агента приходит текстом хода и промптом человека не считается
    const text = (e.text ?? '').trim()
    if (text !== '' && !handbackOf(text) && !text.startsWith('<agent-message')) {
      crewMemo.lastPrompt = text
    }
    return next(e)
  })

  // Подборка строится только после ответа основной сессии: под шаг, который пойдёт за ним
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId && e.reason === 'answer' && catalog.size > 0) {
      crewMemo.isTurnDone = true
      predictInBackground($)
    }
    return done
  })

  // Серая подсказка Claude Code приходит после ответа: предсказание с ней повторяется один раз за ход
  on('prompt.suggest', async ($, e, next) => {
    const shown = await next(e)
    const text = e.text.trim()
    if (e.origin.kind !== 'suggestion' || text === '' || text === crewMemo.suggestion) return shown
    crewMemo.suggestion = text
    if (!crewMemo.isTurnDone || crewMemo.isSuggestionUsed || catalog.size === 0) return shown
    const c = await getCrew($)
    // открытый черновик важнее уточнённой подборки
    if (c.editing || c.rows.some(r => r.phase === 'writing' || r.phase === 'draft')) return shown
    crewMemo.isSuggestionUsed = true
    predictInBackground($)
    return shown
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    paneMemo.isOpenedByHand = false
    return next(e)
  })

  // Escape и закрытие крестиком: правка отменена, черновик строки не тронут
  on('ui.close', { id: EDIT_PANE }, async ($, e, next) => {
    await clearEditing($)
    return next(e)
  })

  // ---------------------------------------------------------------- drawing

  on('ui.render', { component: 'Pane', requestId: EDIT_PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const c = await getCrew($)
    const row = c.rows.find(r => r.agent === c.editing)
    if (!row || !('Input' in els)) return <Text dimColor>nothing to edit</Text>
    const { Input } = els
    return (
      <Box flexDirection="column" width={Math.max(30, e.props.bodyColumns)}>
        <Text bold wrap="truncate">{`${row.agent} · prompt`}</Text>
        <Input key={`crew-edit-input-${row.agent}`} value={row.draft ?? ''} autoFocus submitLabel="save" onSubmit={(text: string) => saveEdit($, row.agent, text)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const cr = await getCrew($)
    // Пустому CREW места не отдаётся, кроме панели, открытой человеком: там шапка с ↻
    if (cr.rows.length === 0 && !cr.isLoading && !paneMemo.isOpenedByHand) return <Box />
    const w = Math.max(40, e.props.bodyColumns)

    // ---- crew: строка агента — имя, задача и действие справа; под ней план или черновик с его кнопками
    const crewPanel = () => {
      const nameW = Math.min(22, Math.max(12, Math.floor((w - 4) / 3)))
      const title = nextTitle(cr)
      const side = (row: CrewRow) => {
        if (row.phase === 'writing') return <Text color={C.amber}>writing</Text>
        if (row.phase === 'started') return <Text color={C.cleared}>started</Text>
        if (row.phase === 'draft') return null
        return <Button key={`crew-run-${row.agent}`} plain label="▸ run" onPress={() => runRow($, cfg, row.agent)} />
      }
      const draftActions = (row: CrewRow) => (
        <Box columnGap={3}>
          <Button key={`crew-start-${row.agent}`} plain label="▸ start" onPress={() => startDraft($, row.agent)} />
          <Button key={`crew-edit-${row.agent}`} plain dimColor label="✎ edit" onPress={() => editDraft($, row.agent)} />
          <Button key={`crew-drop-${row.agent}`} plain dimColor label="✕ drop" onPress={() => markRow($, row.agent, 'idle', { draft: null, error: null })} />
        </Box>
      )
      // занятые строки при ручном обновлении видны и во время загрузки, заглушки — на свободных местах
      const placeholders = cr.isLoading ? Array.from({ length: Math.max(0, Math.min(CREW_SIZE, catalog.size) - cr.rows.length) }, (_, i) => i) : []
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.faint} paddingX={1} width={w}>
          <Box columnGap={1}>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate">
                <Text color={C.agent} bold>
                  CREW
                </Text>
                {title ? <Text dimColor>{` · ${title}`}</Text> : null}
              </Text>
            </Box>
            {cr.isLoading ? (
              <Text color={C.faint}>↻</Text>
            ) : (
              <Button
                key="crew-refresh"
                plain
                label="↻"
                onPress={async () => {
                  const done = await refreshByHand($)
                  if (done !== 'started') $.ui.toast(HAND_REFRESH_TEXT[done])
                }}
              />
            )}
          </Box>
          {cr.rows.map(row => (
            <Box key={`crew-${row.agent}`} flexDirection="column">
              <Box columnGap={1}>
                <Box width={nameW} flexShrink={0}>
                  <Text color={C.agent} bold wrap="truncate">
                    {row.agent}
                  </Text>
                </Box>
                <Box flexGrow={1} flexShrink={1}>
                  {row.task ? (
                    <Text dimColor wrap="truncate">
                      {row.task}
                    </Text>
                  ) : (
                    <Text color={C.faint}>{cr.isTasking ? '…' : NO_TASK}</Text>
                  )}
                </Box>
                <Box flexShrink={0}>{side(row)}</Box>
              </Box>
              {(row.phase === 'draft' || row.phase === 'started') && row.draft ? (
                <Text wrap="wrap" dimColor={row.phase === 'started'}>
                  {row.draft}
                </Text>
              ) : row.plan ? (
                <Text dimColor wrap="truncate">
                  {row.plan}
                </Text>
              ) : null}
              {row.phase === 'draft' ? draftActions(row) : null}
              {row.phase === 'error' && row.error ? (
                <Text color={C.faint} wrap="truncate">
                  {row.error}
                </Text>
              ) : null}
            </Box>
          ))}
          {placeholders.map(i => (
            <Box key={`crew-wait-${i}`} columnGap={1}>
              <Box width={nameW} flexShrink={0}>
                <Text color={C.faint}>…</Text>
              </Box>
              <Text color={C.faint}>░░░</Text>
            </Box>
          ))}
        </Box>
      )
    }

    return crewPanel()
  })
}
