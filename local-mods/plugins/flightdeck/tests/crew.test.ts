import { expect, test } from 'claude-code/testing'

import {
  CREW_SIZE,
  DEFAULT_CREW,
  cleanDraft,
  draftRequest,
  mergePicks,
  parseJevPicks,
  rowsFor,
  setPhase,
  skillDirName,
  skillFile,
  wordPicks,
} from '../hooks/crew'
import type { CatalogEntry, Crew, CrewRow } from '../hooks/crew'
import { parseConfig } from '../hooks/core'
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

test('crew is one of the default panels, last, and a config can drop it', () => {
  const d = parseConfig({})
  expect(d.panels).toContain('crew')
  expect(d.panels.length).toBe(8)
  expect(parseConfig({ panels: 'main,log' }).panels).toEqual(['main', 'log'])
  expect(parseConfig({ panels: 'main,crew,log' }).panels).toEqual(['main', 'crew', 'log'])
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
    await $.turn.start({ text: QUERY, turnId: 'T-nocat' })
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
    await $.turn.start({ text: '', turnId: 'T-empty' })
    await r.settle()
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: /CREW/ })).toBeUndefined()
    await ui.unmount()
    expect(r.jevRuns().length).toBe(0)
    expect(r.writes.length).toBe(0)
  })

  test(`${surface}: loading shows the header with "… of N", then five rows when jev answers`, async ($, on) => {
    const gate = deferred<JevAnswer>()
    const jevStarted = deferred()
    const r = rig(on, {
      jev: () => {
        jevStarted.resolve()
        return gate.promise
      },
    })
    await offerAll($)
    const started = $.turn.start({ text: QUERY, turnId: 'T-load' }) // may or may not wait for jev
    await jevStarted.promise
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: /CREW/ })).toBeDefined()
    expect(await ui.find({ text: /… of 8/ })).toBeDefined()
    expect(await ui.find({ key: 'crew-run-typescript-reviewer' })).toBeUndefined() // loading rows carry no buttons
    // заглушка той же высоты, что и ряд с рамкой вокруг run: список не прыгает
    const wait = await ui.find({ key: 'crew-wait-0' })
    expect(JSON.stringify(wait?.children)).toContain('"borderStyle":"round"')
    gate.resolve({ exitCode: 0, stdout: jevStdout(JEV_FIVE) })
    await started
    await r.settle()
    expect(await ui.find({ text: /… of/ })).toBeUndefined()
    expect(await ui.find({ text: /5 of 8 · jev/ })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: jev picks five agents; header says jev, rows are jev's, each has a run button`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: /CREW/ })).toBeDefined()
    expect(await ui.find({ text: /5 of 8 · jev/ })).toBeDefined()
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
    await $.turn.start({ text: QUERY, turnId: 'T-again' })
    await r.settle()
    expect(r.jevRuns().length).toBe(1)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: /5 of 8 · jev/ })).toBeDefined()
    await ui.unmount()
    await $.turn.start({ text: OTHER_QUERY, turnId: 'T-other' })
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
      expect(await ui.find({ text: /5 of 8 · by words/ })).toBeDefined()
      expect((await drawnRows(ui)).length).toBe(5)
      await ui.unmount()
    })
  }

  test(`${surface}: jev returning one agent is padded to five with word matches, no duplicates`, async ($, on) => {
    const r = rig(on, { jev: () => ({ exitCode: 0, stdout: jevStdout(['docs-writer']) }) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: /5 of 8 · jev/ })).toBeDefined()
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
    await $.turn.start({ text: QUERY, turnId: 'T-small' })
    await r.settle()
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: /3 of 3 · jev/ })).toBeDefined()
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
    expect(r.spawns.length).toBe(0) // draft mode: nothing runs until start
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
    expect(r.spawns[0]?.prompt).toBe(DRAFT)
    await ui.unmount()
  })

  test(`${surface}: start spawns that agent with the draft and marks the row started`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    await ui.press({ key: `crew-start-${FIRST}` })
    expect(r.spawns.length).toBe(1)
    expect(r.spawns[0]?.subagentType).toBe(FIRST)
    expect(r.spawns[0]?.prompt).toBe(DRAFT)
    expect((r.spawns[0]?.description ?? '').length > 0).toBe(true)
    expect(await ui.find({ text: /started/ })).toBeDefined()
    expect(await ui.find({ key: `crew-start-${FIRST}` })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: edit opens a focused pane with an Input holding the draft, and spawns nothing`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    await ui.press({ key: `crew-edit-${FIRST}` })
    expect(r.opens).toEqual([{ id: 'crew-edit', focus: true, closeOnEscape: true }])
    expect(r.spawns.length).toBe(0)
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

  test(`${surface}: submitting the edit pane saves the draft, closes the pane, and start spawns the new text`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    await ui.press({ key: `crew-edit-${FIRST}` })
    const edit = await $.ui.mount({ ...pane(60, 'crew-edit'), surface })
    await $.ui.input({ plugin: 'flightdeck', key: `crew-edit-input-${FIRST}`, text: EDITED, surface, requestId: 'crew-edit' })
    expect(r.closes).toEqual(['crew-edit'])
    expect(await ui.find({ text: EDITED })).toBeDefined()
    expect(await ui.find({ text: DRAFT })).toBeUndefined()
    expect(await ui.find({ key: `crew-start-${FIRST}` })).toBeDefined() // still a draft
    expect(r.spawns.length).toBe(0)
    await ui.press({ key: `crew-start-${FIRST}` })
    expect(r.spawns.length).toBe(1)
    expect(r.spawns[0]?.prompt).toBe(EDITED)
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
      await $.ui.input({ plugin: 'flightdeck', key: `crew-edit-input-${FIRST}`, text, surface, requestId: 'crew-edit' })
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
    expect(r.spawns[0]?.prompt).toBe(DRAFT)
    await ui.unmount()
  })

  test(`${surface}: an empty submit in the edit pane keeps the old draft`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    await ui.press({ key: `crew-edit-${FIRST}` })
    const edit = await $.ui.mount({ ...pane(60, 'crew-edit'), surface })
    await $.ui.input({ plugin: 'flightdeck', key: `crew-edit-input-${FIRST}`, text: '   ', surface, requestId: 'crew-edit' })
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

  test(`${surface}: run is a primary Button, not plain, inside a round-bordered Box`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    const run = await ui.find({ key: `crew-run-${FIRST}` })
    expect(run?.type).toBe('Button')
    expect(run?.props.variant).toBe('primary')
    expect(run?.props.plain).toBeUndefined()
    // ближайшая рамка вокруг кнопки: круглая, без своего цвета (цвет темы)
    const frames = (await ui.findAll({ type: 'Box' })).filter(
      b => b.props.borderStyle === 'round' && b.props.borderColor === undefined && JSON.stringify(b.children).includes(`crew-run-${FIRST}`),
    )
    expect(frames.length > 0).toBe(true)
    await ui.press({ key: `crew-run-${FIRST}` })
    for (const k of ['start', 'edit', 'drop']) expect((await ui.find({ key: `crew-${k}-${FIRST}` }))?.props.plain).toBe(true)
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
    expect(r.spawns.length).toBe(0)
    expect(r.opens.length).toBe(0)
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

  test(`${surface}: crewRun direct spawns at once, without a draft`, { options: { crewRun: 'direct' } }, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    expect(r.completes.length).toBe(1) // the prompt is still written by the model
    expect(r.spawns.length).toBe(1)
    expect(r.spawns[0]?.subagentType).toBe(FIRST)
    expect(r.spawns[0]?.prompt).toBe(DRAFT)
    expect(await ui.find({ key: `crew-start-${FIRST}` })).toBeUndefined()
    expect(await ui.find({ text: /started/ })).toBeDefined()
    expect(await ui.find({ text: DRAFT })).toBeDefined() // direct: the user still sees what the agent was asked
    await ui.unmount()
  })

  test(`${surface}: a refused spawn turns the row to error, without throwing`, async ($, on) => {
    const r = rig(on, { spawn: () => ({ deny: 'no capacity' }) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    await ui.press({ key: `crew-start-${FIRST}` }) // must resolve, not reject
    expect(r.spawns.length).toBe(1)
    expect(await ui.find({ text: /no capacity|error|failed/i })).toBeDefined()
    expect(await ui.find({ text: /started/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: a refused spawn in direct mode is an error row too`, { options: { crewRun: 'direct' } }, async ($, on) => {
    const r = rig(on, { spawn: () => ({ deny: 'no capacity' }) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    expect(await ui.find({ text: /no capacity|error|failed/i })).toBeDefined()
    expect(await ui.find({ text: /started/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: a model that does not answer turns the row to error, with no draft and no spawn`, async ($, on) => {
    const r = rig(on, { model: () => ({ isAnswered: false, reason: 'empty-reply' }) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` }) // must resolve, not reject
    expect(await ui.find({ text: /error|failed|empty/i })).toBeDefined()
    expect(await ui.find({ key: `crew-start-${FIRST}` })).toBeUndefined()
    expect(r.spawns.length).toBe(0)
    await ui.unmount()
  })
}

// ---------------------------------------------------------------- the rest of the pane still draws

for (const surface of SURFACES) {
  test(`${surface}: the existing panels still draw beside CREW`, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: /· main$/ })).toBeDefined()
    expect(await ui.find({ text: /session log/ })).toBeDefined()
    expect(await ui.find({ text: /CREW/ })).toBeDefined()
    expect(await ui.find({ text: /agents ·/ })).toBeUndefined() // no subagents yet
    await ui.unmount()
  })

  test(`${surface}: a config without crew in panels hides it though a prompt and a catalog exist`, { options: { panels: 'main,log' } }, async ($, on) => {
    const r = rig(on)
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: /· main$/ })).toBeDefined()
    expect(await ui.find({ text: /CREW/ })).toBeUndefined()
    await ui.unmount()
  })
}
