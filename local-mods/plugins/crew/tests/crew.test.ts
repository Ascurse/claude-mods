import { expect, test } from 'claude-code/testing'

import {
  CREW_SIZE,
  DEFAULT_CREW,
  cleanDraft,
  CONTEXT_TAIL,
  buildNextContext,
  draftRequest,
  editedFiles,
  excludeSpawned,
  mergePicks,
  nextStepRequest,
  parseNextStep,
  parseReady,
  spawnedIn,
  parseJevPicks,
  rowsFor,
  setPhase,
  skillDirName,
  skillFile,
  spawnRequest,
  wordPicks,
} from '../hooks/crew'
import type { CatalogEntry, Crew, CrewRow } from '../hooks/crew'
import { parseConfig } from '../hooks/util'
import type { ModelAnswer } from './crew-rig'
import {
  CATALOG,
  DRAFT,
  JEV_FIVE,
  NAMES,
  OTHER_QUERY,
  QUERY,
  SURFACES,
  deferred,
  drawnRows,
  entry,
  jevStdout,
  offerAll,
  pane,
  ready,
  rig,
  turn,
} from './crew-rig'
import type { JevAnswer } from './crew-rig'

// ---------------------------------------------------------------- pure behaviour

test('crew size and the empty state', () => {
  expect(CREW_SIZE).toBe(5)
  expect(DEFAULT_CREW).toEqual({ query: '', isLoading: false, by: null, rows: [], total: 0 })
})

test('skillDirName is filesystem-safe, stable and tells agents apart', () => {
  for (const agent of ['typescript-reviewer', 'Code Reviewer', 'pkg:agent', 'a/b', '..', 'Ünï code']) {
    const dir = skillDirName(agent)
    expect(dir.length > 0).toBe(true)
    expect(/^[A-Za-z0-9._-]+$/.test(dir)).toBe(true)
    expect(dir === '.' || dir === '..').toBe(false)
    expect(skillDirName(agent)).toBe(dir)
  }
  const dirs = ['pkg:agent', 'pkg-agent', 'pkg agent', 'Code Reviewer', 'code-reviewer'].map(skillDirName)
  expect(new Set(dirs).size).toBe(dirs.length)
})

test('skillFile is a SKILL.md with front matter, then the description', () => {
  const file = skillFile(CATALOG[1] as CatalogEntry)
  expect(file.startsWith('---\nname: ')).toBe(true)
  expect(file).toContain('\ndescription: ')
  expect(file.endsWith(`\n---\n${(CATALOG[1] as CatalogEntry).description}`)).toBe(true)
  // a multi-line description cannot break out of the front matter
  const tricky = skillFile(entry('x', 'first line\n---\nname: evil'))
  const front = tricky.split('\n---\n')[0] ?? ''
  expect(front.split('\n').filter(Boolean).length).toBe(3) // '---', name, description
  expect(front).not.toContain('evil')
})

test('parseJevPicks reads names back to agents, in jev order', () => {
  const out = parseJevPicks(jevStdout(['Code Reviewer', 'typescript-reviewer', 'pkg:db-tuner']), CATALOG)
  expect(out).toEqual(['Code Reviewer', 'typescript-reviewer', 'pkg:db-tuner'])
})

test('parseJevPicks drops unknown names and duplicates', () => {
  const stdout = JSON.stringify({
    status: 'ok',
    skills: [
      { name: 'ghost-agent', path: '/cache/ghost-agent/SKILL.md', match: 0.9 },
      { name: skillDirName('docs-writer'), path: '/cache/x/SKILL.md', match: 0.8 },
      { name: skillDirName('docs-writer'), path: '/cache/x/SKILL.md', match: 0.7 },
      { name: skillDirName('Code Reviewer'), path: '/cache/y/SKILL.md', match: 0.6 },
    ],
  })
  expect(parseJevPicks(stdout, CATALOG)).toEqual(['docs-writer', 'Code Reviewer'])
})

test('parseJevPicks is null unless status is ok and the JSON reads', () => {
  expect(parseJevPicks(jevStdout(JEV_FIVE, 'error'), CATALOG)).toBe(null)
  expect(parseJevPicks('', CATALOG)).toBe(null)
  expect(parseJevPicks('not json {', CATALOG)).toBe(null)
  expect(parseJevPicks('{"status":"ok"}', CATALOG)).toBe(null)
  expect(parseJevPicks('[]', CATALOG)).toBe(null)
  expect(parseJevPicks('{"status":"ok","skills":[]}', CATALOG)).toEqual([])
  expect(parseJevPicks(jevStdout(JEV_FIVE), [])).toEqual([]) // empty catalog: every name is unknown
})

test('wordPicks ranks by shared words and respects k', () => {
  const picks = wordPicks(CATALOG, 'postgres queries', 5)
  expect(picks[0]).toBe('pkg:db-tuner')
  expect(wordPicks(CATALOG, 'review code', 3).length).toBe(3)
  expect(new Set(wordPicks(CATALOG, 'review code', 5)).size).toBe(5)
  expect(wordPicks(CATALOG, 'TYPESCRIPT Reviews', 1)).toEqual(['typescript-reviewer']) // case does not matter
  expect(wordPicks(CATALOG, 'postgres', 0)).toEqual([])
})

test('wordPicks has nothing to say when no word matches or there is no catalog', () => {
  expect(wordPicks(CATALOG, 'zzzz qqqq', 5)).toEqual([])
  expect(wordPicks(CATALOG, '', 5)).toEqual([])
  expect(wordPicks([], 'review code', 5)).toEqual([])
})

test('mergePicks: jev first, padded by words, never a duplicate, never more than k', () => {
  expect(mergePicks(['a', 'b', 'c', 'd', 'e'], ['x', 'y'], 5)).toEqual({ picks: ['a', 'b', 'c', 'd', 'e'], by: 'jev' })
  expect(mergePicks(['a'], ['b', 'a', 'c', 'd', 'e', 'f'], 5)).toEqual({ picks: ['a', 'b', 'c', 'd', 'e'], by: 'jev' })
  expect(mergePicks(['a', 'a', 'b'], ['b', 'c'], 5)).toEqual({ picks: ['a', 'b', 'c'], by: 'jev' })
  expect(mergePicks(['a', 'b', 'c', 'd', 'e', 'f', 'g'], [], 5).picks).toEqual(['a', 'b', 'c', 'd', 'e'])
})

test('mergePicks says by words when jev gave nothing', () => {
  expect(mergePicks(null, ['x', 'y', 'z'], 2)).toEqual({ picks: ['x', 'y'], by: 'words' })
  expect(mergePicks([], ['x'], 5)).toEqual({ picks: ['x'], by: 'words' })
  expect(mergePicks(null, [], 5)).toEqual({ picks: [], by: 'words' })
})

test('rowsFor makes idle rows with the catalog description and drops unknown picks', () => {
  const rows = rowsFor(['Code Reviewer', 'ghost', 'docs-writer'], CATALOG)
  expect(rows).toEqual([
    { agent: 'Code Reviewer', description: (CATALOG[1] as CatalogEntry).description, phase: 'idle', draft: null, error: null },
    { agent: 'docs-writer', description: (CATALOG[7] as CatalogEntry).description, phase: 'idle', draft: null, error: null },
  ])
  expect(rowsFor([], CATALOG)).toEqual([])
  expect(rowsFor(['docs-writer'], [])).toEqual([])
})

test('draftRequest asks haiku for a task prompt built from the query, cwd and the agent', () => {
  const e = CATALOG[0] as CatalogEntry
  const req = draftRequest(e, { query: 'fix the flaky parser test', cwd: '/work/parser' })
  expect(req.model).toBe('haiku')
  expect(req.maxTokens > 0).toBe(true)
  expect(req.system.trim().length > 0).toBe(true)
  for (const part of ['fix the flaky parser test', '/work/parser', e.agent, e.description]) {
    expect(req.prompt).toContain(part)
  }
})

test('cleanDraft trims, strips fences and a leading Prompt label', () => {
  expect(cleanDraft('  hello  \n')).toBe('hello')
  expect(cleanDraft('```\nReview the diff.\n```')).toBe('Review the diff.')
  expect(cleanDraft('```text\nReview the diff.\nSecond line.\n```\n')).toBe('Review the diff.\nSecond line.')
  expect(cleanDraft('Prompt: Review the diff.')).toBe('Review the diff.')
  expect(cleanDraft('Prompt:\n```\nReview the diff.\n```')).toBe('Review the diff.')
  expect(cleanDraft('Review the Prompt: tool')).toBe('Review the Prompt: tool') // only a leading label goes
  expect(cleanDraft('')).toBe('')
  expect(cleanDraft('```\n```')).toBe('')
})

test('setPhase is pure: a new object, only that row changes', () => {
  const rows: CrewRow[] = rowsFor(['docs-writer', 'Code Reviewer'], CATALOG)
  const crew: Crew = { query: 'q', isLoading: false, by: 'jev', rows, total: 8 }
  const frozen = JSON.stringify(crew)
  const next = setPhase(crew, 'Code Reviewer', 'draft', { draft: 'do it' })
  expect(JSON.stringify(crew)).toBe(frozen)
  expect(next).not.toBe(crew)
  expect(next.rows[1]).toEqual({ ...(rows[1] as CrewRow), phase: 'draft', draft: 'do it' })
  expect(next.rows[0]).toEqual(rows[0])
  expect([next.query, next.by, next.total]).toEqual(['q', 'jev', 8])
  expect(setPhase(next, 'Code Reviewer', 'error', { error: 'boom', draft: null }).rows[1]).toMatchObject({ phase: 'error', error: 'boom', draft: null })
  expect(setPhase(crew, 'nobody', 'started').rows).toEqual(rows) // unknown agent: rows unchanged
})

test('config is read leniently: draft, theme palette and auto open by default', () => {
  expect(parseConfig({})).toEqual({ crewRun: 'draft', palette: 'theme', autoOpen: true })
  expect(parseConfig({ crewRun: 'direct', palette: 'pastel', autoOpen: false })).toEqual({ crewRun: 'direct', palette: 'pastel', autoOpen: false })
  expect(parseConfig({ crewRun: 'sideways', palette: 7, autoOpen: 'no' })).toEqual({ crewRun: 'draft', palette: 'theme', autoOpen: true })
})

// ---------------------------------------------------------------- engine: what the panel shows

for (const surface of SURFACES) {
  test(`${surface}: no CREW panel without a catalog or without a prompt`, async ($, on) => {
    const r = rig(on)
    // neither
    let ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: /CREW/ })).toBeUndefined()
    await ui.unmount()
    // a prompt but no catalog
    await turn($, QUERY, 'T-nocat')
    await r.settle()
    ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: /CREW/ })).toBeUndefined()
    await ui.unmount()
    expect(r.jevRuns().length).toBe(0) // nothing to rank, so jev is not asked
  })

  test(`${surface}: a prompt that comes before the agent listing still gets its crew once the turn ends`, async ($, on) => {
    const r = rig(on)
    // после перезагрузки мода список агентов приходит уже после turn.start
    await $.turn.start({ text: QUERY, turnId: 'T-late' })
    await offerAll($)
    await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 'T-late', reason: 'answer' })
    await r.settle()
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect((await drawnRows(ui)).sort()).toEqual([...JEV_FIVE].sort())
    await ui.unmount()
    expect(r.jevRuns().length > 0).toBe(true)
  })

  test(`${surface}: a catalog but no prompt yet draws no CREW panel, and an empty prompt asks nothing`, async ($, on) => {
    const r = rig(on)
    await offerAll($)
    await turn($, '', 'T-empty')
    await r.settle()
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: /CREW/ })).toBeUndefined()
    await ui.unmount()
    expect(r.jevRuns().length).toBe(0)
    expect(r.writes.length).toBe(0)
    expect(r.nextCompletes.length).toBe(0)
    expect(r.opens.length).toBe(0)
  })

  test(`${surface}: loading shows "next: …" with bare placeholders, then the step and five rows when jev answers`, async ($, on) => {
    const gate = deferred<JevAnswer>()
    const jevStarted = deferred()
    const r = rig(on, {
      jev: () => {
        jevStarted.resolve()
        return gate.promise
      },
    })
    await offerAll($)
    const started = turn($, QUERY, 'T-load') // may or may not wait for jev
    await jevStarted.promise
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: /CREW/ })).toBeDefined()
    expect(await ui.find({ text: ' · next: …' })).toBeDefined()
    expect(await ui.find({ key: 'crew-run-typescript-reviewer' })).toBeUndefined() // loading rows carry no buttons
    expect(await ui.find({ key: 'crew-refresh' })).toBeUndefined() // ↻ is not pressable while loading
    const wait = await ui.find({ key: 'crew-wait-0' })
    expect(JSON.stringify(wait?.children)).toContain('░░░')
    expect(JSON.stringify(wait?.children)).not.toContain('borderStyle')
    gate.resolve({ exitCode: 0, stdout: jevStdout(JEV_FIVE) })
    await started
    await r.settle()
    expect(await ui.find({ text: ' · next: …' })).toBeUndefined()
    expect(await ui.find({ text: ` · next: ${QUERY}` })).toBeDefined()
    expect(await ui.find({ text: /of 8/ })).toBeUndefined() // no counters in the header
    await ui.unmount()
  })

  test(`${surface}: jev picks five agents; rows are jev's, each has a run button`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: /CREW/ })).toBeDefined()
    expect((await drawnRows(ui)).sort()).toEqual([...JEV_FIVE].sort())
    for (const agent of JEV_FIVE) expect(await ui.find({ key: `crew-run-${agent}` })).toBeDefined()
    expect(await ui.find({ key: 'crew-run-docs-writer' })).toBeUndefined() // not picked
    await ui.unmount()
  })

  test(`${surface}: jev is asked after the catalog is written as SKILL.md files, with the prompt and top-k 5`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    expect(r.writes.length).toBe(CATALOG.length)
    for (const e of CATALOG) {
      const w = r.writes.find(x => x.path.endsWith(`/${skillDirName(e.agent)}/SKILL.md`))
      expect(w).toBeDefined()
      expect(w?.text).toBe(skillFile(e))
    }
    const roots = new Set(r.writes.map(w => w.path.split('/').slice(0, -2).join('/')))
    expect(roots.size).toBe(1)
    const root = [...roots][0] as string
    expect(root.length > 0).toBe(true)
    expect(r.jevRuns()).toEqual([['jev', 'pick-skill', '--turn', QUERY, '--root', root, '--top-k', '5']])
    expect(r.order.lastIndexOf('write') < r.order.indexOf('jev')).toBe(true) // every file is down before jev reads
  })

  test(`${surface}: the same query asks jev once; a new query asks again`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    await turn($, QUERY, 'T-again')
    await r.settle()
    expect(r.jevRuns().length).toBe(1)
    await turn($, OTHER_QUERY, 'T-other')
    await r.settle()
    expect(r.jevRuns().length).toBe(2)
    expect(r.jevRuns()[1]).toContain(OTHER_QUERY)
  })

  const FAILED_JEV: [string, () => JevAnswer][] = [
    ['non-zero exit', () => ({ exitCode: 2, stdout: '' })],
    ['status not ok', () => ({ exitCode: 0, stdout: jevStdout(JEV_FIVE, 'error') })],
    ['bad JSON', () => ({ exitCode: 0, stdout: 'Traceback (most recent call last)' })],
    ['rejected run', () => 'reject'],
  ]
  for (const [why, answer] of FAILED_JEV) {
    test(`${surface}: jev failing (${why}) falls back to word matching`, async ($, on) => {
      const r = rig(on, { jev: answer })
      await ready($, r)
      expect(r.jevRuns().length).toBe(1)
      const ui = await $.ui.mount({ ...pane(86), surface })
      expect((await drawnRows(ui)).length).toBe(5)
      await ui.unmount()
    })
  }

  test(`${surface}: jev returning one agent is padded to five with word matches, no duplicates`, async ($, on) => {
    const r = rig(on, { jev: () => ({ exitCode: 0, stdout: jevStdout(['docs-writer']) }) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    const rows = await drawnRows(ui)
    expect(rows.length).toBe(5)
    expect(rows).toContain('docs-writer') // jev's pick stays, though no word of the query matches it
    expect(new Set(rows).size).toBe(5)
    await ui.unmount()
  })

  test(`${surface}: with fewer agents than five the panel shows them all`, async ($, on) => {
    const small = CATALOG.slice(0, 3)
    const r = rig(on, { jev: () => ({ exitCode: 0, stdout: jevStdout(['Code Reviewer']) }) })
    await offerAll($, small)
    await turn($, QUERY, 'T-small')
    await r.settle()
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect((await drawnRows(ui)).length).toBe(3)
    await ui.unmount()
  })

  test(`${surface}: a /clear starts the CREW panel fresh`, async ($, on) => {
    const r = rig(on)
    on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
    await ready($, r)
    const before = await $.ui.mount({ ...pane(86), surface })
    expect(await before.find({ text: /CREW/ })).toBeDefined()
    await before.unmount()
    await $.session.end({ reason: 'clear', sessionId: 's' } as never)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: /CREW/ })).toBeUndefined()
    await ui.unmount()
  })
}

// ---------------------------------------------------------------- engine: run, start, edit, drop

const FIRST = 'typescript-reviewer'
const EDITED = 'Only check the lexer; skip the parser.'

for (const surface of SURFACES) {
  test(`${surface}: run puts the row in writing while the model drafts, then shows the draft with start, edit, drop`, async ($, on) => {
    const gate = deferred<ModelAnswer>()
    const asked = deferred()
    const r = rig(on, {
      model: () => {
        asked.resolve()
        return gate.promise
      },
    })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    const pressed = ui.press({ key: `crew-run-${FIRST}` })
    await asked.promise
    expect(await ui.find({ text: /writing/ })).toBeDefined()
    expect(await ui.find({ key: `crew-start-${FIRST}` })).toBeUndefined()
    gate.resolve({ isAnswered: true, text: DRAFT })
    await pressed
    await r.settle()

    expect(r.completes.length).toBe(1)
    expect(r.completes[0]?.model).toBe('haiku')
    expect(r.completes[0]?.prompt).toContain(QUERY)
    expect(r.completes[0]?.prompt).toContain(FIRST)
    expect(r.submits.length).toBe(0) // draft mode: nothing runs until start
    expect(await ui.find({ text: DRAFT })).toBeDefined()
    for (const k of ['start', 'edit', 'drop']) expect(await ui.find({ key: `crew-${k}-${FIRST}` })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: a draft written with fences is shown and sent clean`, async ($, on) => {
    const r = rig(on, { model: () => ({ isAnswered: true, text: `Prompt:\n\`\`\`\n${DRAFT}\n\`\`\`\n` }) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    expect(await ui.find({ text: DRAFT })).toBeDefined()
    expect(await ui.find({ text: /```/ })).toBeUndefined()
    await ui.press({ key: `crew-start-${FIRST}` })
    expect(r.submits[0]?.text).toContain(`\n${DRAFT}\n`)
    expect(r.submits[0]?.text).not.toContain('Prompt:')
    await ui.unmount()
  })

  test(`${surface}: start asks the main model to run that agent with the draft and marks the row started`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    await ui.press({ key: `crew-start-${FIRST}` })
    expect(r.submits.length).toBe(1)
    expect(r.submits[0]?.text).toContain(`subagent_type: ${FIRST}`)
    expect(r.submits[0]?.text).toContain(`\n${DRAFT}\n`)
    expect(r.submits[0]?.text).toContain('run_in_background: true')
    expect(await ui.find({ text: /started/ })).toBeDefined()
    expect(await ui.find({ key: `crew-start-${FIRST}` })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: edit opens a focused pane with an Input holding the draft, and asks for nothing`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    await ui.press({ key: `crew-edit-${FIRST}` })
    expect(r.opens.filter(o => o.id === 'crew-edit')).toEqual([{ id: 'crew-edit', focus: true, closeOnEscape: true }])
    expect(r.submits.length).toBe(0)
    expect(await ui.find({ text: DRAFT })).toBeDefined() // the row keeps its draft until a new text is submitted
    expect(await ui.find({ key: `crew-start-${FIRST}` })).toBeDefined()
    const edit = await $.ui.mount({ ...pane(60, 'crew-edit'), surface })
    const input = await edit.find({ key: `crew-edit-input-${FIRST}` })
    expect(input?.type).toBe('Input')
    expect(input?.props.value).toBe(DRAFT)
    expect(await edit.find({ type: 'Input' })).toBeDefined()
    await edit.unmount()
    await ui.unmount()
  })

  test(`${surface}: submitting the edit pane saves the draft, closes the pane, and start asks for the new text`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    await ui.press({ key: `crew-edit-${FIRST}` })
    const edit = await $.ui.mount({ ...pane(60, 'crew-edit'), surface })
    await $.ui.input({ plugin: 'crew', key: `crew-edit-input-${FIRST}`, text: EDITED, surface, requestId: 'crew-edit' })
    expect(r.closes).toEqual(['crew-edit'])
    expect(await ui.find({ text: EDITED })).toBeDefined()
    expect(await ui.find({ text: DRAFT })).toBeUndefined()
    expect(await ui.find({ key: `crew-start-${FIRST}` })).toBeDefined() // still a draft
    expect(r.submits.length).toBe(0)
    await ui.press({ key: `crew-start-${FIRST}` })
    expect(r.submits.length).toBe(1)
    expect(r.submits[0]?.text).toContain(`\n${EDITED}\n`)
    await edit.unmount()
    await ui.unmount()
  })

  test(`${surface}: every saved edit goes to the agent's history in $.store, newest first, ten at most`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    const texts = Array.from({ length: 12 }, (_, i) => `edit number ${i}`)
    for (const text of texts) {
      await ui.press({ key: `crew-edit-${FIRST}` })
      const edit = await $.ui.mount({ ...pane(60, 'crew-edit'), surface })
      await $.ui.input({ plugin: 'crew', key: `crew-edit-input-${FIRST}`, text, surface, requestId: 'crew-edit' })
      await edit.unmount()
    }
    const history = r.store.get('crew.editHistory') as Record<string, string[]>
    expect(history[FIRST]).toEqual(texts.slice(2).reverse())
    expect(Object.keys(history)).toEqual([FIRST])
    await ui.unmount()
  })

  test(`${surface}: leaving the edit pane without submitting (Escape) leaves the draft as it was`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    await ui.press({ key: `crew-edit-${FIRST}` })
    // Escape закрывает панель, ничего не отправляя: тест движка не умеет поднимать ui.close, так что просто не отправляем
    expect(await ui.find({ text: DRAFT })).toBeDefined()
    expect(await ui.find({ key: `crew-start-${FIRST}` })).toBeDefined()
    expect(r.store.get('crew.editHistory')).toBeUndefined()
    await ui.press({ key: `crew-start-${FIRST}` })
    expect(r.submits[0]?.text).toContain(`\n${DRAFT}\n`)
    await ui.unmount()
  })

  test(`${surface}: an empty submit in the edit pane keeps the old draft`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    await ui.press({ key: `crew-edit-${FIRST}` })
    const edit = await $.ui.mount({ ...pane(60, 'crew-edit'), surface })
    await $.ui.input({ plugin: 'crew', key: `crew-edit-input-${FIRST}`, text: '   ', surface, requestId: 'crew-edit' })
    expect(await ui.find({ text: DRAFT })).toBeDefined()
    expect(r.store.get('crew.editHistory')).toBeUndefined()
    await edit.unmount()
    await ui.unmount()
  })

  test(`${surface}: the prompt stays on the row after start, dim, with "started" as the status`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    await ui.press({ key: `crew-start-${FIRST}` })
    expect(await ui.find({ text: /started/ })).toBeDefined()
    const shown = (await ui.findAll({ type: 'Text' })).find(t => t.children?.[0] === DRAFT)
    expect(shown).toBeDefined()
    expect(shown?.props.dimColor).toBe(true)
    await ui.unmount()
  })

  test(`${surface}: a long prompt is drawn whole and wrapped, never truncated`, async ($, on) => {
    const long = `${'Check every branch of the parser and report each real defect with its file and line. '.repeat(6)}END`
    const r = rig(on, { model: () => ({ isAnswered: true, text: long }) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(60), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    const drafted = await ui.find({ text: long })
    expect(drafted?.props.wrap).not.toBe('truncate')
    await ui.press({ key: `crew-start-${FIRST}` })
    const started = await ui.find({ text: long })
    expect(started).toBeDefined()
    expect(started?.props.wrap).not.toBe('truncate')
    await ui.unmount()
  })

  test(`${surface}: run is a plain "▸ run" without a frame; in a draft start is bright, edit and drop are dim`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    const run = await ui.find({ key: `crew-run-${FIRST}` })
    expect(run?.type).toBe('Button')
    expect(run?.props.label).toBe('▸ run')
    expect(run?.props.plain).toBe(true)
    expect(run?.props.variant).toBeUndefined()
    const frames = (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderStyle === 'round' && JSON.stringify(b.children).includes(`crew-run-${FIRST}`))
    expect(frames.length).toBe(1) // only the panel's own border
    await ui.press({ key: `crew-run-${FIRST}` })
    const labels = { start: '▸ start', edit: '✎ edit', drop: '✕ drop' }
    for (const [k, label] of Object.entries(labels)) {
      const b = await ui.find({ key: `crew-${k}-${FIRST}` })
      expect(b?.props.plain).toBe(true)
      expect(b?.props.label).toBe(label)
      expect(b?.props.dimColor).toBe(k === 'start' ? undefined : true)
    }
    expect(await ui.find({ key: `crew-run-${FIRST}` })).toBeUndefined() // a draft row has no run on its right
    await ui.unmount()
  })

  test(`${surface}: drop clears the draft and the row is idle again`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    await ui.press({ key: `crew-drop-${FIRST}` })
    expect(await ui.find({ text: DRAFT })).toBeUndefined()
    for (const k of ['start', 'edit', 'drop']) expect(await ui.find({ key: `crew-${k}-${FIRST}` })).toBeUndefined()
    expect(await ui.find({ key: `crew-run-${FIRST}` })).toBeDefined()
    expect(r.submits.length).toBe(0)
    expect(r.opens.filter(o => o.id === 'crew-edit').length).toBe(0)
    await ui.unmount()
  })

  test(`${surface}: only the pressed row is touched`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    for (const other of JEV_FIVE.filter(a => a !== FIRST)) {
      expect(await ui.find({ key: `crew-run-${other}` })).toBeDefined()
      expect(await ui.find({ key: `crew-start-${other}` })).toBeUndefined()
    }
    await ui.unmount()
  })

  test(`${surface}: crewRun direct asks the main model at once, without a draft`, { options: { crewRun: 'direct' } }, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    expect(r.completes.length).toBe(1) // the prompt is still written by the model
    expect(r.submits.length).toBe(1)
    expect(r.submits[0]?.text).toContain(`subagent_type: ${FIRST}`)
    expect(r.submits[0]?.text).toContain(`\n${DRAFT}\n`)
    expect(await ui.find({ key: `crew-start-${FIRST}` })).toBeUndefined()
    expect(await ui.find({ text: /started/ })).toBeDefined()
    expect(await ui.find({ text: DRAFT })).toBeDefined() // direct: the user still sees what the agent was asked
    await ui.unmount()
  })

  test(`${surface}: a dropped request turns the row to error, without throwing`, async ($, on) => {
    const r = rig(on, { submit: () => ({ drop: 'no capacity' }) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    await ui.press({ key: `crew-start-${FIRST}` }) // must resolve, not reject
    expect(r.submits.length).toBe(1)
    expect(await ui.find({ text: /no capacity|error|failed/i })).toBeDefined()
    expect(await ui.find({ text: /started/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: a dropped request in direct mode is an error row too`, { options: { crewRun: 'direct' } }, async ($, on) => {
    const r = rig(on, { submit: () => ({ drop: 'no capacity' }) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    expect(r.submits.length).toBe(1)
    expect(await ui.find({ text: /failed: no capacity/i })).toBeDefined()
    expect(await ui.find({ text: /started/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: a model that does not answer turns the row to error, with no draft and no request`, async ($, on) => {
    const r = rig(on, { model: () => ({ isAnswered: false, reason: 'empty-reply' }) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` }) // must resolve, not reject
    expect(await ui.find({ text: /error|failed|empty/i })).toBeDefined()
    expect(await ui.find({ key: `crew-start-${FIRST}` })).toBeUndefined()
    expect(r.submits.length).toBe(0)
    await ui.unmount()
  })
}

// ---------------------------------------------------------------- the rest of the pane still draws

for (const surface of SURFACES) {
  test(`${surface}: the crew pane draws only CREW, none of flightdeck's panels`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: /CREW/ })).toBeDefined()
    expect(await ui.find({ text: /· main$/ })).toBeUndefined()
    expect(await ui.find({ text: /session log/ })).toBeUndefined()
    await ui.unmount()
  })
}

const START = { cwd: '/work/project', surface: 'terminal', isInteractive: true } as const

// пустой CREW места не занимает: панель открывается с первой подсказкой, а не на старте сессии
test('session start opens no pane', async ($, on) => {
  const r = rig(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  await $.session.start(START)
  await r.settle()
  expect(r.opens.length).toBe(0)
})

test('the first prompt with a catalog opens the pane', async ($, on) => {
  const r = rig(on, { jev: () => ({ exitCode: 0, stdout: jevStdout(JEV_FIVE) }) })
  await offerAll($)
  await turn($, QUERY, 'T-open')
  await r.settle()
  expect(r.opens.map(o => o.id)).toEqual(['crew'])
})

test('a prompt without a catalog opens no pane', async ($, on) => {
  const r = rig(on)
  await turn($, QUERY, 'T-nocat-open')
  await r.settle()
  expect(r.opens.length).toBe(0)
})

test('autoOpen false keeps the pane closed when suggestions arrive', { options: { autoOpen: false } }, async ($, on) => {
  const r = rig(on, { jev: () => ({ exitCode: 0, stdout: jevStdout(JEV_FIVE) }) })
  await offerAll($)
  await turn($, QUERY, 'T-noauto')
  await r.settle()
  expect(r.opens.length).toBe(0)
})

// ---------------------------------------------------------------- engine: next step

const STEP = 'run the parser tests and fix what fails'
const answer = (text: string) => () => ({ isAnswered: true as const, text })

test('CREW is built for the step Haiku predicts, not for the prompt, and the header names that step', async ($, on) => {
  const r = rig(on, { next: answer(`Next step: ${STEP}`) })
  await ready($, r)
  expect(r.nextCompletes.length).toBe(1)
  expect(r.nextCompletes[0]?.prompt).toContain(QUERY)
  expect(r.jevRuns().map(a => a[3])).toEqual([STEP])
  const ui = await $.ui.mount({ ...pane(86), surface: 'terminal' })
  expect(await ui.find({ text: ` · next: ${STEP}` })).toBeDefined()
  await ui.unmount()
})

test('nothing is predicted on turn.start: the list waits for the answer', async ($, on) => {
  const r = rig(on, { next: answer(STEP) })
  await offerAll($)
  await $.turn.start({ text: QUERY, turnId: 'T-only-start' })
  await r.settle()
  expect(r.nextCompletes.length).toBe(0)
  expect(r.jevRuns().length).toBe(0)
})

test('a subagent finishing its turn, or an aborted turn, predicts nothing', async ($, on) => {
  const r = rig(on, { next: answer(STEP) })
  await offerAll($)
  await $.turn.start({ text: QUERY, turnId: 'T-sub' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'T-sub', reason: 'answer', agentId: 'a-1' } as never)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 'T-sub', reason: 'aborted' })
  await r.settle()
  expect(r.nextCompletes.length).toBe(0)
})

test('the prediction is told the git state and the first ready tasks, read without a shell', async ($, on) => {
  const cmd = (argv: string[]) => {
    if (argv[0] === 'git' && argv[1] === 'status') return { exitCode: 0, stdout: ' M src/parser.ts\n' }
    if (argv[0] === 'git' && argv[1] === 'diff') return { exitCode: 0, stdout: ' src/parser.ts | 12 ++++++------\n' }
    if (argv[0] === 'bd') return { exitCode: 0, stdout: JSON.stringify([{ id: 'claude-1', title: 'Write parser docs' }]) }
    return { exitCode: 1, stdout: '' }
  }
  const r = rig(on, { next: answer(STEP), cmd })
  await ready($, r)
  const asked = r.nextCompletes[0]?.prompt ?? ''
  expect(asked).toContain('M src/parser.ts')
  expect(asked).toContain('src/parser.ts | 12')
  expect(asked).toContain('claude-1: Write parser docs')
  expect(r.runs.find(a => a[0] === 'bd')).toEqual(['bd', 'ready', '--json', '--brief', '--limit', '3'])
})

test('a failing git or bd leaves its section out and the prediction still runs', async ($, on) => {
  const r = rig(on, { next: answer(STEP), cmd: () => ({ exitCode: 128, stdout: 'fatal: not a git repository' }) })
  await ready($, r)
  expect(r.nextCompletes[0]?.prompt).not.toContain('fatal')
  expect(r.jevRuns().map(a => a[3])).toEqual([STEP])
})

test('agents already started in this session are not offered again', async ($, on) => {
  const spawned = { role: 'assistant' as const, text: '', toolUses: [{ tool: 'Agent', input: { subagent_type: 'typescript-reviewer', prompt: 'x' }, result: '', text: '', isError: false }] }
  const r = rig(on, { messages: [{ role: 'user', text: QUERY, toolUses: [] }, spawned] as never })
  await ready($, r)
  const ui = await $.ui.mount({ ...pane(86), surface: 'terminal' })
  const rows = await drawnRows(ui)
  expect(rows).not.toContain('typescript-reviewer')
  expect(rows.length).toBe(5)
  await ui.unmount()
})

test("Claude Code's suggestion after the answer re-predicts once, with the suggestion in the context", async ($, on) => {
  on('prompt.suggest', () => ({ isShown: true }))
  const r = rig(on, { next: answer(STEP) })
  await ready($, r)
  await $.prompt.suggest({ text: 'commit the parser fix', origin: { kind: 'suggestion' } } as never)
  await r.settle()
  expect(r.nextCompletes.length).toBe(2)
  expect(r.nextCompletes[1]?.prompt).toContain('commit the parser fix')
  await $.prompt.suggest({ text: 'push it', origin: { kind: 'suggestion' } } as never)
  await r.settle()
  expect(r.nextCompletes.length).toBe(2)
})

test('a suggestion that comes before the answer is used by the one prediction after it', async ($, on) => {
  on('prompt.suggest', () => ({ isShown: true }))
  const r = rig(on, { next: answer(STEP) })
  await offerAll($)
  await $.turn.start({ text: QUERY, turnId: 'T-early' })
  await $.prompt.suggest({ text: 'commit the parser fix', origin: { kind: 'suggestion' } } as never)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'T-early', reason: 'answer' })
  await r.settle()
  expect(r.nextCompletes.length).toBe(1)
  expect(r.nextCompletes[0]?.prompt).toContain('commit the parser fix')
})

test('an open draft survives the next automatic prediction; a started row does not', async ($, on) => {
  const r = rig(on)
  await ready($, r)
  const ui = await $.ui.mount({ ...pane(86), surface: 'terminal' })
  await ui.press({ key: `crew-run-${FIRST}` })
  await turn($, OTHER_QUERY, 'T-after-draft')
  await r.settle()
  expect(await ui.find({ key: `crew-start-${FIRST}` })).toBeDefined()
  await ui.press({ key: `crew-start-${FIRST}` })
  await turn($, 'and the lexer too', 'T-after-start')
  await r.settle()
  expect(await ui.find({ text: /started/ })).toBeUndefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- spawnRequest

const ROWS = [
  { agent: 'typescript-reviewer', prompt: 'Review src/a.ts for type holes.' },
  { agent: 'security-reviewer', prompt: 'Check src/b.ts for injection.\nReport only real findings.' },
]

test('spawnRequest names the agent as subagent_type, asks for background and keeps the prompt verbatim', () => {
  const text = spawnRequest([ROWS[0]!], 'fix the parser')
  expect(text).toContain('subagent_type: typescript-reviewer')
  expect(text).toContain('run_in_background: true')
  expect(text).toContain('description: crew · fix the parser')
  expect(text).toContain('\n```\nReview src/a.ts for type holes.\n```')
  expect(text).toMatch(/do not do (the|these) tasks yourself/i)
})

test('spawnRequest carries every row, in order, each with its own prompt', () => {
  const text = spawnRequest(ROWS, 'fix the parser')
  expect(text.indexOf('subagent_type: typescript-reviewer')).toBeLessThan(text.indexOf('subagent_type: security-reviewer'))
  expect(text).toContain('Review src/a.ts for type holes.')
  expect(text).toContain('Check src/b.ts for injection.\nReport only real findings.')
  expect(text.match(/subagent_type:/g)?.length).toBe(2)
})

test('spawnRequest shortens a long query in the description and flattens its newlines', () => {
  const text = spawnRequest([ROWS[0]!], `${'word '.repeat(40)}\nsecond line`)
  const description = /description: (crew · .*)/.exec(text)?.[1] ?? ''
  expect(description.length).toBeLessThanOrEqual('crew · '.length + 40)
  expect(description).toContain('…')
})

test('spawnRequest fences a prompt that holds backticks with a longer fence, so it stays one block', () => {
  const prompt = 'Use:\n```ts\nconst a = 1\n```\nthen stop'
  const text = spawnRequest([{ agent: 'x', prompt }], 'q')
  expect(text).toContain(`\n\`\`\`\`\n${prompt}\n\`\`\`\``)
})

// ---------------------------------------------------------------- предсказание следующего шага

const NEXT_INPUT = {
  prompt: 'fix the flaky parser test',
  reply: 'Fixed the race in parser.ts and the test passes now.',
  files: ['src/parser.ts', 'tests/parser.test.ts'],
  gitStatus: ' M src/parser.ts\n M tests/parser.test.ts',
  diffStat: ' src/parser.ts | 12 ++++++------\n 1 file changed',
  ready: ['claude-a1: Add parser docs', 'claude-b2: Benchmark parser', 'claude-c3: Release 1.2', 'claude-d4: Fourth task'],
  suggestion: 'run the full test suite',
}

test('buildNextContext carries the prompt, the reply, the edited files, git state, ready tasks and the suggestion', () => {
  const ctx = buildNextContext(NEXT_INPUT)
  expect(ctx).toContain('fix the flaky parser test')
  expect(ctx).toContain('Fixed the race in parser.ts')
  expect(ctx).toContain('src/parser.ts')
  expect(ctx).toContain('tests/parser.test.ts')
  expect(ctx).toContain(' M src/parser.ts')
  expect(ctx).toContain('1 file changed')
  expect(ctx).toContain('claude-a1: Add parser docs')
  expect(ctx).toContain('run the full test suite')
})

test('buildNextContext keeps only the first 3 ready tasks', () => {
  const ctx = buildNextContext(NEXT_INPUT)
  expect(ctx).toContain('claude-c3: Release 1.2')
  expect(ctx).not.toContain('claude-d4')
})

test('buildNextContext keeps only the tail of a long reply', () => {
  const reply = `${'head '.repeat(200)}TAIL_MARK`
  const ctx = buildNextContext({ ...NEXT_INPUT, reply })
  expect(ctx).toContain('TAIL_MARK')
  expect(ctx).not.toContain('head '.repeat(CONTEXT_TAIL / 5 + 1))
})

test('buildNextContext leaves out the sections it has nothing for', () => {
  const ctx = buildNextContext({ prompt: 'explain the parser', reply: '', files: [], gitStatus: '', diffStat: '', ready: [], suggestion: null })
  expect(ctx).toContain('explain the parser')
  expect(ctx).not.toMatch(/git status/i)
  expect(ctx).not.toMatch(/diff/i)
  expect(ctx).not.toMatch(/ready/i)
  expect(ctx).not.toMatch(/suggest/i)
  expect(ctx).not.toMatch(/files/i)
})

test('nextStepRequest asks Haiku for the next step and forbids suggesting work already done', () => {
  const ctx = buildNextContext(NEXT_INPUT)
  const req = nextStepRequest(ctx)
  expect(req.model).toBe('haiku')
  expect(req.prompt).toContain(ctx)
  expect(`${req.system}\n${req.prompt}`).toMatch(/do not suggest[^.]*already done/i)
})

test('excludeSpawned drops agents this session already started and keeps the order of the rest', () => {
  const picks = ['code-reviewer', 'tdd-guide', 'doc-updater', 'security-reviewer']
  expect(excludeSpawned(picks, new Set(['tdd-guide', 'security-reviewer']))).toEqual(['code-reviewer', 'doc-updater'])
})

test('excludeSpawned leaves the picks as they are when the session started no agents', () => {
  const picks = ['code-reviewer', 'tdd-guide']
  expect(excludeSpawned(picks, new Set())).toEqual(picks)
})

const use = (tool: string, input: Record<string, unknown>) => ({ tool_use_id: `${tool}-${JSON.stringify(input).length}`, tool, input })
const said = (role: 'user' | 'assistant', text: string, toolUses: ReturnType<typeof use>[] = []) => ({ role, text, toolUses })

test('editedFiles lists the files Claude edited or wrote after the last prompt, each once', () => {
  const messages = [
    said('user', 'first prompt'),
    said('assistant', '', [use('Edit', { file_path: '/old.ts' })]),
    said('user', 'fix the parser'),
    said('assistant', '', [use('Read', { file_path: '/read.ts' }), use('Edit', { file_path: '/src/parser.ts' })]),
    said('assistant', '', [use('Write', { file_path: '/tests/parser.test.ts' }), use('Edit', { file_path: '/src/parser.ts' })]),
  ]
  expect(editedFiles(messages)).toEqual(['/src/parser.ts', '/tests/parser.test.ts'])
})

test('spawnedIn names every subagent type the session started with the Agent tool', () => {
  const messages = [
    said('assistant', '', [use('Agent', { subagent_type: 'code-reviewer', prompt: 'x' })]),
    said('user', 'next'),
    said('assistant', '', [use('Agent', { subagent_type: 'tdd-guide', prompt: 'y' }), use('Bash', { command: 'ls' })]),
  ]
  expect([...spawnedIn(messages)].sort()).toEqual(['code-reviewer', 'tdd-guide'])
})

test('parseNextStep keeps one clean line and drops a leading label', () => {
  expect(parseNextStep('Next step: review the parser diff\nand more')).toBe('review the parser diff')
  expect(parseNextStep('   ')).toBeNull()
})

test('parseReady turns bd ready --json into "id: title" lines, at most 3; unreadable output gives none', () => {
  const out = JSON.stringify([1, 2, 3, 4].map(n => ({ id: `claude-${n}`, title: `Task ${n}`, status: 'open' })))
  expect(parseReady(out)).toEqual(['claude-1: Task 1', 'claude-2: Task 2', 'claude-3: Task 3'])
  expect(parseReady('Error: no beads database found')).toEqual([])
})
