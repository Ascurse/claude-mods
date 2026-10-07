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
  cleanDraft,
  draftRequest,
  filterByTags,
  mergePicks,
  parseJevPicks,
  parseTagAnswer,
  parseTaskAnswer,
  pushHistory,
  rowsFor,
  setPhase,
  skillDirName,
  skillFile,
  spawnRequest,
  tagBatches,
  tagFile,
  tagHeader,
  tagRequest,
  taskRequest,
  wordPicks,
} from './crew'
import type { CrewMode, CrewRow, RowPhase, Tag, TaskInfo } from './crew'
import { getJev, getTasks, jevKey, jevScope, putJev, putTasks, taskKey } from './cache/jev'
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
const paneMemo = { isAutoOpen: true }

async function openPane($: EngineInterface) {
  // columns apply when docked beside the transcript, rows when seated inline above the prompt.
  return $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS, rows: 8 })
}

async function markRow($: EngineInterface, agent: string, phase: RowPhase, patch: { draft?: string | null; error?: string | null } = {}) {
  await update($, crew, c => setPhase(normalizeCrew(c), agent, phase, patch))
}

const failure = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** У мода нет своего журнала: сбой запуска очереди показывается всплывающей строкой. */
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
  lastQuery: '',
  // Запрос, пришедший раньше списка агентов (первый ход после перезагрузки мода)
  waitingQuery: '',
  tags: null as { hash: string; map: TagMap } | null,
  taggedHash: '',
  // Один запрос строк-задач на ключ: повторный refreshCrew (после разметки) ждёт тот же ответ
  pendingTasks: new Map<string, Promise<Record<string, TaskInfo>>>(),
}

async function catalogRoot($: EngineInterface) {
  const tmp = await $.env.get('TMPDIR').catch(() => undefined)
  return `${(tmp || '/tmp').replace(/\/$/, '')}/crew`
}

async function writeCatalog($: EngineInterface, root: string, entries: CatalogEntry[]) {
  const signature = JSON.stringify(entries)
  if (signature === crewMemo.writtenCatalog) return
  await Promise.all(entries.map(e => $.fs.write(`${root}/${skillDirName(e.agent)}/SKILL.md`, skillFile(e))))
  crewMemo.writtenCatalog = signature
}

async function writeTags($: EngineInterface, root: string) {
  if (crewMemo.writtenTags) return
  await Promise.all(TAGS.map(t => $.fs.write(`${root}/tags/${t}/SKILL.md`, tagFile(t))))
  crewMemo.writtenTags = true
}

/** $.store нельзя передавать значением, поэтому кэшу отдаётся обёртка с вызовами по месту. */
const storeOf = ($: EngineInterface) => ({
  get: (key: string) => $.store.get(key),
  set: (key: string, value: unknown) => $.store.set(key, value),
})

/** Ответ jev из $.store, а при промахе из запуска; неудачный запуск (null) в кэш не попадает. */
async function cachedJev($: EngineInterface, scope: string, query: string, run: () => Promise<string[] | null>) {
  const key = jevKey(query, scope)
  const hit = await getJev(storeOf($), key).catch(() => undefined)
  if (hit !== undefined) return hit
  const picks = await run()
  if (picks !== null) await putJev(storeOf($), key, picks).catch(() => undefined)
  return picks
}

async function askJev($: EngineInterface, query: string, entries: CatalogEntry[], topK: number) {
  return cachedJev($, jevScope(catalogHash(entries), topK), query, async () => {
    try {
      const root = await catalogRoot($)
      await writeCatalog($, root, entries)
      const done = await $.process.run(['jev', 'pick-skill', '--turn', query, '--root', root, '--top-k', String(topK)])
      return done.exitCode === 0 ? parseJevPicks(done.stdout, entries) : null
    } catch {
      return null
    }
  })
}

/** Теги запроса: jev выбирает среди псевдонавыков <root>/tags/<tag>/SKILL.md; без ответа тегов нет. */
async function askTags($: EngineInterface, query: string, entries: CatalogEntry[]): Promise<Tag[]> {
  const tagStubs: CatalogEntry[] = TAGS.map(t => ({ agent: t, description: '', source: '' }))
  const picks = await cachedJev($, jevScope('tags', TAG_TOP_K), query, async () => {
    try {
      const root = await catalogRoot($)
      await writeCatalog($, root, entries)
      await writeTags($, root)
      const done = await $.process.run(['jev', 'pick-skill', '--turn', query, '--root', `${root}/tags`, '--top-k', String(TAG_TOP_K)])
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
  if (crewMemo.lastQuery !== '' && catalogHash([...catalog.values()]) === hash) await refreshCrew($, crewMemo.lastQuery, (await getCrew($)).mode ?? 'now')
}

/** Строки-задачи пятёрки: из кэша, иначе один запрос Haiku; пустой ответ в кэш не попадает. */
async function fetchTasks($: EngineInterface, query: string, entries: CatalogEntry[], picked: CatalogEntry[]) {
  const cwd = await $.session.cwd().catch(() => '')
  const key = taskKey(query, catalogHash(entries), picked.map(e => e.agent), cwd)
  const cached = await getTasks(storeOf($), key).catch(() => undefined)
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
async function loadTasks($: EngineInterface, query: string, entries: CatalogEntry[], rows: CrewRow[]) {
  const picked: CatalogEntry[] = rows.map(r => ({ agent: r.agent, description: r.description, source: '' }))
  try {
    const tasks = picked.length > 0 ? await fetchTasks($, query, entries, picked) : {}
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

async function refreshCrew($: EngineInterface, query: string, mode: CrewMode = 'now') {
  const entries = [...catalog.values()]
  const hash = catalogHash(entries)
  // перестройка под ту же догадку (например, после разметки) не теряет отмеченных
  const prev = await getCrew($)
  const queued = new Set(mode === 'next' && prev.query === query ? prev.rows.filter(r => r.phase === 'queued').map(r => r.agent) : [])
  await update($, crew, () => ({ ...DEFAULT_CREW, query, isLoading: true, total: entries.length, mode }))
  if (paneMemo.isAutoOpen) void openPane($).catch(() => undefined)
  try {
    const tagMap = await loadTags($, hash)
    if (!tagMap) void tagCatalog($, entries, hash).catch(() => undefined)
    const queryTags = tagMap ? await askTags($, query, entries) : []
    const filtered = filterByTags(entries, tagMap ?? {}, queryTags)
    // тегов никто не несёт: фильтр бесполезен, показываем как без него
    const isFiltered = queryTags.length > 0 && filtered.length > 0
    const pool = isFiltered ? filtered : entries
    const jev = await askJev($, query, entries, isFiltered ? FILTERED_TOP_K : CREW_SIZE)
    const allowed = new Set(pool.map(e => e.agent))
    const { picks, by } = mergePicks(jev === null ? null : jev.filter(a => allowed.has(a)), wordPicks(pool, query, CREW_SIZE), CREW_SIZE)
    if (crewMemo.lastQuery === query) {
      const rows = rowsFor(picks, entries).map(r => (queued.has(r.agent) ? { ...r, phase: 'queued' as const } : r))
      await update($, crew, () => ({ query, isLoading: false, by, rows, total: pool.length, tags: isFiltered ? queryTags : [], isTasking: rows.length > 0, mode }))
      void loadTasks($, query, entries, rows)
    }
  } finally {
    if (crewMemo.lastQuery === query) await update($, crew, c => ({ ...normalizeCrew(c), isLoading: false }))
  }
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

async function toggleQueued($: EngineInterface, agent: string) {
  await update($, crew, c => {
    const n = normalizeCrew(c)
    const row = n.rows.find(r => r.agent === agent)
    if (!row || n.mode !== 'next') return n
    return setPhase(n, agent, row.phase === 'queued' ? 'idle' : 'queued')
  })
}

/** Отмеченные в режиме next: задание пишется по реальному промпту; дальше их видно в карточках агентов и журнале. */
async function startQueued($: EngineInterface, query: string, rows: readonly CrewRow[]) {
  const cwd = await $.session.cwd().catch(() => '')
  const drafts = await Promise.all(
    rows.map(async row => {
      try {
        const done = await $.model.complete(draftRequest({ agent: row.agent, description: row.description, source: '' }, { query, cwd }))
        const draft = done.isAnswered ? cleanDraft(done.text) : ''
        if (draft !== '') return { agent: row.agent, prompt: draft }
        notify($, `${row.agent} · error: ${done.isAnswered ? 'empty draft' : done.reason}`)
      } catch (err) {
        notify($, `${row.agent} · failed: ${failure(err)}`)
      }
      return null
    }),
  )
  const ready = drafts.filter(d => d !== null)
  if (ready.length === 0) return
  try {
    await requestSpawn($, ready, query)
  } catch (err) {
    for (const d of ready) notify($, `${d.agent} · failed: ${failure(err)}`)
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

export const register: Register = (on, options) => {
  const cfg = parseConfig(options)
  paneMemo.isAutoOpen = cfg.autoOpen
  const C = PALETTES[cfg.palette]

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'crew',
      description: 'Crew, agents that fit your request: open, close or reset the pane',
      argumentHint: '[open|close|reset]',
    })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      crewMemo.lastQuery = ''
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
      crewMemo.lastQuery = ''
      await update($, crew, () => DEFAULT_CREW)
      return { text: 'Crew reset.' }
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
    // Отчёт фонового агента приходит текстом хода и новым запросом не считается
    const back = e.text ? handbackOf(e.text) : null
    const query = (e.text ?? '').trim()
    // CREW режима next ждёт этот промпт, даже если он слово в слово совпал с догадкой
    const was = await getCrew($)
    const isNext = was.mode === 'next'
    if (!back && query !== '' && !query.startsWith('<agent-message') && (query !== crewMemo.lastQuery || isNext)) {
      crewMemo.waitingQuery = catalog.size > 0 ? '' : query
      if (catalog.size > 0) {
        crewMemo.lastQuery = query
        void refreshCrew($, query).catch(() => undefined)
      }
      const queued = isNext ? was.rows.filter(r => r.phase === 'queued') : []
      if (queued.length > 0) void startQueued($, query, queued).catch(() => undefined)
    }
    return next(e)
  })

  // Догадка движка о следующем промпте: CREW подбирается под неё, пока человек ещё не начал печатать.
  on('prompt.suggest', async ($, e, next) => {
    const shown = await next(e)
    const text = e.text.trim()
    if (e.origin.kind !== 'suggestion' || text === '' || catalog.size === 0) return shown
    const c = await getCrew($)
    if (c.mode === 'next' && c.query === text) return shown
    // открытый черновик и уже собранная очередь важнее новой догадки
    if (c.editing || c.rows.some(r => r.phase === 'writing' || r.phase === 'draft' || r.phase === 'queued')) return shown
    crewMemo.lastQuery = text
    void refreshCrew($, text, 'next').catch(() => undefined)
    return shown
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId && crewMemo.waitingQuery && catalog.size > 0) {
      const query = crewMemo.waitingQuery
      crewMemo.waitingQuery = ''
      crewMemo.lastQuery = query
      void refreshCrew($, query).catch(() => undefined)
    }
    return done
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
    // Пустому CREW места не отдаётся: без каталога или запроса показывать нечего
    if (cr.rows.length === 0 && !cr.isLoading) return <Box />
    const w = Math.max(40, e.props.bodyColumns)

    // ---- crew: рядов всегда по два (имя и описание, действия), у загрузки те же ячейки без кнопок
    const crewPanel = () => {
      const nameW = Math.min(22, Math.max(12, Math.floor((w - 4) / 3)))
      const header = cr.isLoading ? `… of ${cr.total}` : tagHeader(cr.rows.length, cr.total, cr.by, cr.tags ?? [])
      const actions = (row: CrewRow) => {
        if (cr.mode === 'next') {
          const isQueued = row.phase === 'queued'
          return (
            <Box borderStyle="round">
              <Button key={`crew-next-${row.agent}`} variant={isQueued ? undefined : 'primary'} label={isQueued ? 'queued' : 'next'} onPress={() => toggleQueued($, row.agent)} />
            </Box>
          )
        }
        if (row.phase === 'writing') return <Text color={C.amber}>writing</Text>
        if (row.phase === 'started') return <Text color={C.cleared}>started</Text>
        if (row.phase === 'draft') {
          return (
            <Box columnGap={2}>
              <Button key={`crew-start-${row.agent}`} plain label="start" onPress={() => startDraft($, row.agent)} />
              <Button key={`crew-edit-${row.agent}`} plain label="edit" onPress={() => editDraft($, row.agent)} />
              <Button key={`crew-drop-${row.agent}`} plain label="drop" onPress={() => markRow($, row.agent, 'idle', { draft: null, error: null })} />
            </Box>
          )
        }
        return (
          <Box columnGap={2}>
            <Box borderStyle="round">
              <Button key={`crew-run-${row.agent}`} variant="primary" label="run" onPress={() => runRow($, cfg, row.agent)} />
            </Box>
            {row.phase === 'error' && row.error ? <Text color={C.faint} wrap="truncate">{row.error}</Text> : null}
          </Box>
        )
      }
      const placeholders = Array.from({ length: Math.min(CREW_SIZE, cr.total) }, (_, i) => i)
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.faint} paddingX={1} width={w}>
          <Box justifyContent="space-between">
            <Text color={C.agent} bold>
              CREW
            </Text>
            <Text dimColor>{header}</Text>
          </Box>
          {cr.mode === 'next' ? (
            <Text dimColor wrap="truncate">
              {`next · ${cr.query}`}
            </Text>
          ) : null}
          {cr.isLoading
            ? placeholders.map(i => (
                <Box key={`crew-wait-${i}`} flexDirection="column">
                  <Box>
                    <Box width={nameW} flexShrink={0}>
                      <Text color={C.faint}>…</Text>
                    </Box>
                    <Text color={C.faint}> </Text>
                  </Box>
                  <Box borderStyle="round">
                    <Text color={C.faint}>{'   '}</Text>
                  </Box>
                </Box>
              ))
            : cr.rows.map(row => (
                <Box key={`crew-${row.agent}`} flexDirection="column">
                  <Box>
                    <Box width={nameW} flexShrink={0}>
                      <Text color={C.agent} bold wrap="truncate">
                        {row.agent}
                      </Text>
                    </Box>
                    {row.task ? (
                      <Text dimColor wrap="truncate">
                        {row.task}
                      </Text>
                    ) : (
                      <Text color={C.faint}>{cr.isTasking ? '…' : NO_TASK}</Text>
                    )}
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
                  {actions(row)}
                </Box>
              ))}
        </Box>
      )
    }

    return crewPanel()
  })
}
