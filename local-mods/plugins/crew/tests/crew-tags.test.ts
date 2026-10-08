import { expect, test } from 'claude-code/testing'

import {
  CREW_SIZE,
  TAGS,
  catalogHash,
  filterByTags,
  parseTagAnswer,
  skillFile,
  tagBatches,
  tagFile,
  tagHeader,
  tagRequest,
} from '../hooks/crew'
import type { CatalogEntry } from '../hooks/crew'
import { JEV_LIMIT, fnv1a, getJev, jevKey, jevScope, putJev } from '../hooks/cache/jev'
import { CATALOG, JEV_FIVE, QUERY, SURFACES, deferred, drawnRows, entry, jevStdout, offerAll, pane, ready, rig } from './crew-rig'
import type { JevAnswer } from './crew-rig'

// ---------------------------------------------------------------- fixtures

const HASH = catalogHash(CATALOG)
const TAG_MAP: Record<string, string[]> = {
  'typescript-reviewer': ['frontend', 'testing'],
  'Code Reviewer': ['testing'],
  'pkg:db-tuner': ['data'],
  'repo-explorer': ['devops'],
  'test-planner': ['testing'],
  'security-reviewer': ['security', 'testing'],
  'flutter-reviewer': ['mobile', 'testing'],
  'docs-writer': ['docs', 'testing'],
}
const CARRYING = ['typescript-reviewer', 'Code Reviewer', 'test-planner', 'security-reviewer', 'flutter-reviewer', 'docs-writer']
const TAGS_KEY = `crew.tags.${HASH}`

const isTagRun = (argv: string[]) => (argv[argv.indexOf('--root') + 1] ?? '').endsWith('/tags')
const tagStdout = (tags: string[]) =>
  JSON.stringify({ status: 'ok', skills: tags.map((t, i) => ({ name: t, path: `/cache/${t}/SKILL.md`, match: 0.9 - i * 0.1 })) })

/** jev, который на теги отвечает query-тегами, а на агентов — списком агентов. */
const jevWith =
  (queryTags: string[], agents: string[] = JEV_FIVE) =>
  (argv: string[]): JevAnswer => ({ exitCode: 0, stdout: isTagRun(argv) ? tagStdout(queryTags) : jevStdout(agents) })

const seeded = { [TAGS_KEY]: TAG_MAP }

// ---------------------------------------------------------------- pure: tags

test('TAGS is the fixed vocabulary', () => {
  expect([...TAGS]).toEqual([
    'frontend', 'backend', 'security', 'testing', 'data', 'devops', 'docs', 'design', 'mobile', 'ai', 'finance', 'sales', 'marketing', 'legal', 'ops',
  ])
})

test('tagFile is a SKILL.md named after the tag, with a one-line description', () => {
  for (const tag of TAGS) {
    const file = tagFile(tag)
    expect(file.startsWith(`---\nname: ${tag}\n`)).toBe(true)
    const desc = file.split('\n').find(l => l.startsWith('description: ')) ?? ''
    expect(desc.length > 'description: '.length + 10).toBe(true)
    expect(file).toBe(skillFile({ agent: tag, description: file.split('\n---\n')[1] ?? '', source: '' }))
  }
})

test('tagRequest asks haiku, listing every agent with its description and the allowed tags', () => {
  const req = tagRequest(CATALOG.slice(0, 3))
  expect(req.model).toBe('haiku')
  expect(req.maxTokens > 0).toBe(true)
  expect(/label subagents/i.test(req.system)).toBe(true)
  for (const e of CATALOG.slice(0, 3)) for (const part of [e.agent, e.description]) expect(req.prompt).toContain(part)
  expect(req.prompt).not.toContain((CATALOG[3] as CatalogEntry).agent)
  for (const tag of TAGS) expect(req.prompt).toContain(tag)
})

test('tagBatches cuts the catalog by 50', () => {
  const many = Array.from({ length: 120 }, (_, i) => entry(`a${i}`, 'd'))
  expect(tagBatches(many).map(b => b.length)).toEqual([50, 50, 20])
  expect(tagBatches([])).toEqual([])
})

test('parseTagAnswer keeps known agents and known tags, drops the rest', () => {
  const answer = JSON.stringify({
    'Code Reviewer': ['testing', 'nonsense', 'testing', 'backend'],
    ghost: ['docs'],
    'docs-writer': 'docs',
    'pkg:db-tuner': [],
  })
  expect(parseTagAnswer(answer, CATALOG)).toEqual({ 'Code Reviewer': ['testing', 'backend'] })
})

test('parseTagAnswer reads JSON inside a fence or after a preface, and ignores what is unparsable', () => {
  expect(parseTagAnswer('```json\n{"docs-writer":["docs"]}\n```', CATALOG)).toEqual({ 'docs-writer': ['docs'] })
  expect(parseTagAnswer('Here you go: {"docs-writer":["docs"]} done', CATALOG)).toEqual({ 'docs-writer': ['docs'] })
  for (const bad of ['', 'no json', '{"docs-writer": ["docs"', '[]', '"x"', '42', 'null']) expect(parseTagAnswer(bad, CATALOG)).toEqual({})
})

test('filterByTags keeps agents carrying at least one query tag; untagged ones go while a filter is active', () => {
  const tagged: Record<string, string[]> = { 'Code Reviewer': ['testing'], 'docs-writer': ['docs'] }
  expect(filterByTags(CATALOG, tagged, ['testing']).map(e => e.agent)).toEqual(['Code Reviewer'])
  expect(filterByTags(CATALOG, tagged, ['docs', 'testing']).map(e => e.agent)).toEqual(['Code Reviewer', 'docs-writer'])
  expect(filterByTags(CATALOG, tagged, [])).toEqual(CATALOG) // no filter: everyone
})

test('tagHeader: count of the filtered set, how it was ranked, the applied tags', () => {
  expect(tagHeader(5, 38, 'jev', ['frontend', 'testing'])).toBe('5 of 38 · jev · frontend, testing')
  expect(tagHeader(5, 8, 'jev', [])).toBe('5 of 8 · jev')
  expect(tagHeader(3, 8, 'words', ['docs'])).toBe('3 of 8 · by words · docs')
  expect(tagHeader(3, 8, 'words', [])).toBe('3 of 8 · by words')
})

test('catalogHash ignores order and changes with any name or description', () => {
  expect(catalogHash([...CATALOG].reverse())).toBe(HASH)
  expect(catalogHash(CATALOG.slice(1))).not.toBe(HASH)
  expect(catalogHash([entry('x', 'one')])).not.toBe(catalogHash([entry('x', 'two')]))
})

// ---------------------------------------------------------------- pure: jev cache

type FakeStore = { data: Map<string, unknown>; get: (k: string) => Promise<unknown>; set: (k: string, v: unknown) => Promise<void> }
const fakeStore = (): FakeStore => {
  const data = new Map<string, unknown>()
  return { data, get: async k => data.get(k), set: async (k, v) => void data.set(k, JSON.parse(JSON.stringify(v))) }
}

test('fnv1a is stable and tells inputs apart', () => {
  expect(fnv1a('abc')).toBe(fnv1a('abc'))
  expect(fnv1a('abc')).not.toBe(fnv1a('abd'))
  expect(/^[0-9a-f]{8}$/.test(fnv1a('anything'))).toBe(true)
})

test('jevKey depends on the query and on the scope', () => {
  expect(jevKey('q', 'catalog1')).toBe(jevKey('q', 'catalog1'))
  expect(jevKey('q', 'catalog1')).not.toBe(jevKey('q2', 'catalog1'))
  expect(jevKey('q', 'catalog1')).not.toBe(jevKey('q', 'catalog2'))
  expect(jevScope('h', 5)).not.toBe(jevScope('h', 20))
  // до 0.3.2 jev отвечал тегами вместо агентов, и в кэш легли пустые выдачи: старая область не читается
  expect(jevScope('h', 5)).not.toBe('h:5')
})

test('putJev then getJev returns the picks; an unknown key is undefined', async () => {
  const store = fakeStore()
  await putJev(store, 'k1', ['a', 'b'])
  expect(await getJev(store, 'k1')).toEqual(['a', 'b'])
  expect(await getJev(store, 'nope')).toBeUndefined()
  await putJev(store, 'k2', [])
  expect(await getJev(store, 'k2')).toEqual([]) // an empty answer is an answer
})

test('the cache keeps 50 entries and drops the oldest first', async () => {
  const store = fakeStore()
  expect(JEV_LIMIT).toBe(50)
  for (let i = 0; i < 51; i++) await putJev(store, `k${i}`, [`v${i}`])
  expect(await getJev(store, 'k0')).toBeUndefined()
  expect(await getJev(store, 'k1')).toEqual(['v1'])
  expect(await getJev(store, 'k50')).toEqual(['v50'])
  expect((store.data.get('crew.jevCache') as unknown[]).length).toBe(50)
})

test('putting a key again replaces it and makes it the newest', async () => {
  const store = fakeStore()
  for (let i = 0; i < 50; i++) await putJev(store, `k${i}`, [`v${i}`])
  await putJev(store, 'k0', ['fresh'])
  await putJev(store, 'k50', ['v50']) // evicts the oldest, which is now k1
  expect(await getJev(store, 'k0')).toEqual(['fresh'])
  expect(await getJev(store, 'k1')).toBeUndefined()
  expect((store.data.get('crew.jevCache') as unknown[]).length).toBe(50)
})

test('a damaged cache in the store reads as empty and is rewritten', async () => {
  const store = fakeStore()
  store.data.set('crew.jevCache', 'garbage')
  expect(await getJev(store, 'k')).toBeUndefined()
  await putJev(store, 'k', ['a'])
  expect(await getJev(store, 'k')).toEqual(['a'])
})

// ---------------------------------------------------------------- engine: the filter

for (const surface of SURFACES) {
  test(`${surface}: query tags filter the crew; header shows the tags and the filtered count`, async ($, on) => {
    const r = rig(on, { store: seeded, jev: jevWith(['frontend', 'testing'], ['docs-writer', 'pkg:db-tuner', 'typescript-reviewer']) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: '5 of 6 · jev · frontend, testing' })).toBeDefined()
    const rows = await drawnRows(ui)
    expect(rows.length).toBe(5)
    for (const name of rows) expect(CARRYING).toContain(name)
    expect(rows).toContain('typescript-reviewer') // jev's pick survives the filter
    expect(rows).toContain('docs-writer')
    expect(rows).not.toContain('pkg:db-tuner')
    expect(rows).not.toContain('repo-explorer')
    expect(r.tagCompletes.length).toBe(0) // tags of this catalog came from the store
    await ui.unmount()
  })

  test(`${surface}: with a filter on, jev is asked over the catalog for 20, and for the tags with the pseudo-skills`, async ($, on) => {
    const r = rig(on, { store: seeded, jev: jevWith(['testing']) })
    await ready($, r)
    const agentRun = r.jevRuns().find(a => !isTagRun(a)) as string[]
    const tagRun = r.jevRuns().find(isTagRun) as string[]
    const agentRoot = agentRun[agentRun.indexOf('--root') + 1] as string
    const tagRoot = tagRun[tagRun.indexOf('--root') + 1] as string
    expect(agentRun).toEqual(['jev', 'pick-skill', '--turn', QUERY, '--root', agentRoot, '--top-k', '20'])
    expect(tagRun).toEqual(['jev', 'pick-skill', '--turn', QUERY, '--root', tagRoot, '--top-k', '3'])
    // jev обходит --root вглубь: теги внутри каталога агентов вытесняют агентов из ответа
    expect(tagRoot.startsWith(`${agentRoot}/`)).toBe(false)
    expect(agentRoot.startsWith(`${tagRoot}/`)).toBe(false)
    expect(r.writes.filter(w => w.path.startsWith(`${agentRoot}/`)).every(w => !w.path.startsWith(`${tagRoot}/`))).toBe(true)
    const tagWrites = r.writes.filter(w => w.path.startsWith(`${tagRoot}/`))
    expect(tagWrites.length).toBe(TAGS.length)
    for (const tag of TAGS) expect(tagWrites.find(w => w.path === `${tagRoot}/${tag}/SKILL.md`)?.text).toBe(tagFile(tag))
    expect(r.order.lastIndexOf('write') < r.order.indexOf('jev')).toBe(true)
  })

  test(`${surface}: no query tags means no filter and the old top-k`, async ($, on) => {
    const r = rig(on, { store: seeded, jev: jevWith([]) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: '5 of 8 · jev' })).toBeDefined()
    expect((await drawnRows(ui)).sort()).toEqual([...JEV_FIVE].sort())
    expect(r.jevRuns().find(a => !isTagRun(a))?.at(-1)).toBe('5')
    await ui.unmount()
  })

  test(`${surface}: a failed tag pick means no filter`, async ($, on) => {
    const r = rig(on, {
      store: seeded,
      jev: argv => (isTagRun(argv) ? { exitCode: 2, stdout: '' } : { exitCode: 0, stdout: jevStdout(JEV_FIVE) }),
    })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: '5 of 8 · jev' })).toBeDefined()
    expect(await ui.find({ text: /· jev · / })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: tags nobody carries leave the crew unfiltered`, async ($, on) => {
    const r = rig(on, { store: seeded, jev: jevWith(['legal']) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: '5 of 8 · jev' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: without tags for this catalog the panel is as before: top-k 5, no tag run, no tags in the header`, async ($, on) => {
    const r = rig(on, { jev: jevWith(['testing']) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: '5 of 8 · jev' })).toBeDefined()
    expect(r.jevRuns().length).toBe(1)
    expect(r.jevRuns()[0]?.at(-1)).toBe('5')
    await ui.unmount()
  })
}

// ---------------------------------------------------------------- engine: tagging in the background

test('tagging runs in the background: the first prompt is unfiltered, the filter appears when Haiku answers, and the map is stored', async ($, on) => {
  const gate = deferred<{ isAnswered: true; text: string }>()
  const r = rig(on, { tag: () => gate.promise, jev: jevWith(['frontend', 'testing']) })
  await ready($, r)
  const ui = await $.ui.mount({ ...pane(86), surface: 'terminal' })
  expect(await ui.find({ text: '5 of 8 · jev' })).toBeDefined() // not tagged yet: as today
  expect(r.tagCompletes.length).toBe(1)
  expect(r.tagCompletes[0]?.model).toBe('haiku')
  for (const e of CATALOG) expect(r.tagCompletes[0]?.prompt).toContain(e.agent)
  gate.resolve({ isAnswered: true, text: JSON.stringify(TAG_MAP) })
  await r.settle()
  expect(r.store.get(TAGS_KEY)).toEqual(TAG_MAP)
  expect(await ui.find({ text: '5 of 6 · jev · frontend, testing' })).toBeDefined()
  await ui.unmount()
})

test('a catalog is tagged in batches of 50 agents', async ($, on) => {
  const many = Array.from({ length: 120 }, (_, i) => entry(`agent-${String(i).padStart(3, '0')}`, `does job ${i}`))
  const r = rig(on, { tag: () => ({ isAnswered: true, text: '{}' }) })
  await offerAll($, many)
  await $.turn.start({ text: QUERY, turnId: 'T-many' })
  await r.settle()
  expect(r.tagCompletes.length).toBe(3)
  expect(r.tagCompletes[0]?.prompt).toContain('agent-049')
  expect(r.tagCompletes[0]?.prompt).not.toContain('agent-050')
  expect(r.tagCompletes[2]?.prompt).toContain('agent-119')
})

test('an unparsable Haiku answer is ignored: nothing stored, no filter, and it is not asked again this session', async ($, on) => {
  const r = rig(on, { tag: () => ({ isAnswered: true, text: 'sorry, I cannot do that' }), jev: jevWith(['testing']) })
  await ready($, r)
  await $.turn.start({ text: 'another request entirely', turnId: 'T-2' })
  await r.settle()
  expect(r.store.get(TAGS_KEY)).toBeUndefined()
  expect(r.tagCompletes.length).toBe(1)
  const ui = await $.ui.mount({ ...pane(86), surface: 'terminal' })
  expect(await ui.find({ text: /5 of 8 · jev$/ })).toBeDefined()
  await ui.unmount()
})

test('a rejected tagging call is swallowed', async ($, on) => {
  const r = rig(on, { tag: () => ({ isAnswered: false, reason: 'empty-reply' }) })
  await ready($, r)
  const ui = await $.ui.mount({ ...pane(86), surface: 'terminal' })
  expect(await ui.find({ text: '5 of 8 · jev' })).toBeDefined()
  await ui.unmount()
})

test('tags of an older catalog are dropped from the store when a new catalog is tagged', async ($, on) => {
  const r = rig(on, { store: { 'crew.tags.deadbeef': { x: ['docs'] }, other: 1 }, tag: () => ({ isAnswered: true, text: JSON.stringify(TAG_MAP) }) })
  await ready($, r)
  expect(r.store.get(TAGS_KEY)).toEqual(TAG_MAP)
  expect(r.store.has('crew.tags.deadbeef')).toBe(false)
  expect(r.store.get('other')).toBe(1)
})

// ---------------------------------------------------------------- engine: the jev cache

test('a fresh session with only $.store behind it asks jev nothing for a query it has seen', async ($, on) => {
  const prior = fakeStore()
  const agentKey = jevKey(QUERY, jevScope(HASH, CREW_SIZE))
  await putJev(prior, agentKey, ['docs-writer', 'repo-explorer'])
  const r = rig(on, { store: Object.fromEntries(prior.data), jev: () => 'reject' })
  await ready($, r)
  expect(r.jevRuns().length).toBe(0)
  expect(r.runs.length).toBe(0)
  const ui = await $.ui.mount({ ...pane(86), surface: 'terminal' })
  expect(await ui.find({ text: /5 of 8 · jev/ })).toBeDefined()
  const rows = await drawnRows(ui)
  expect(rows).toContain('docs-writer')
  expect(rows).toContain('repo-explorer')
  await ui.unmount()
})

test('both jev calls are cached: after /clear the same query costs no jev run, tags included', async ($, on) => {
  const r = rig(on, { store: seeded, jev: jevWith(['frontend', 'testing']) })
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  await ready($, r)
  expect(r.jevRuns().length).toBe(2)
  expect((r.store.get('crew.jevCache') as unknown[]).length).toBe(2)
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  await $.turn.start({ text: QUERY, turnId: 'T-again' })
  await r.settle()
  expect(r.jevRuns().length).toBe(2)
  const ui = await $.ui.mount({ ...pane(86), surface: 'terminal' })
  expect(await ui.find({ text: '5 of 6 · jev · frontend, testing' })).toBeDefined()
  await ui.unmount()
  await $.turn.start({ text: 'a different request', turnId: 'T-new' })
  await r.settle()
  expect(r.jevRuns().length).toBe(4) // a new query goes to jev again
})

test('a failed jev answer is not cached', async ($, on) => {
  let fail = true
  const r = rig(on, { jev: () => (fail ? { exitCode: 2, stdout: '' } : { exitCode: 0, stdout: jevStdout(JEV_FIVE) }) })
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  await ready($, r)
  expect(r.store.get('crew.jevCache')).toBeUndefined()
  fail = false
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  await $.turn.start({ text: QUERY, turnId: 'T-retry' })
  await r.settle()
  expect(r.jevRuns().length).toBe(2)
})

test('the cache holds 50 entries across many different queries', async ($, on) => {
  const r = rig(on)
  await offerAll($)
  for (let i = 0; i < 55; i++) {
    await $.turn.start({ text: `question number ${i}`, turnId: `T-${i}` })
    await r.settle()
  }
  expect((r.store.get('crew.jevCache') as unknown[]).length).toBe(50)
})
