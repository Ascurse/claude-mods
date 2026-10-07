import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { JEV_CACHE_KEY } from '../hooks/cache/jev'
import { CONTEXT_TAIL, contextQuery } from '../hooks/crew'
import type { JevAnswer, Rig } from './crew-rig'
import { JEV_FIVE, QUERY, SURFACES, deferred, drawnRows, jevStdout, offerAll, pane, ready, rig } from './crew-rig'

const FIRST = 'typescript-reviewer'
const GUESS = 'now add tests for the parser'
const REPLY = 'Found two bugs in parser.ts: an off-by-one in the tokenizer and a missing null check.'
const OTHER_FIVE = ['pkg:db-tuner', 'repo-explorer', 'docs-writer', 'Code Reviewer', 'test-planner']

const user = (text: string) => ({ role: 'user' as const, text, toolUses: [] })
const assistant = (text: string) => ({ role: 'assistant' as const, text, toolUses: [] })
const TRANSCRIPT = [user(QUERY), assistant(REPLY)]

/** Запросы jev за пятёркой, без запросов на теги. */
const crewTurns = (r: Rig) => r.jevRuns().filter(a => !a.some(x => x.endsWith('/tags'))).map(a => a[a.indexOf('--turn') + 1] ?? '')

/** jev отвечает по очереди: первый запуск — первым списком, дальше — последним. */
const jevInTurn = (...answers: string[][]) => {
  let n = 0
  return () => ({ exitCode: 0, stdout: jevStdout(answers[Math.min(n++, answers.length - 1)]!) })
}

/** Первый запуск jev отвечает сразу пятёркой, следующий ждёт gate. */
const jevThenGate = (gate: { promise: Promise<JevAnswer> }) => {
  let calls = 0
  return () => (++calls === 1 ? { exitCode: 0, stdout: jevStdout(JEV_FIVE) } : gate.promise)
}

/** /crew с аргументами, как его набрал человек; origin и presentation движку теста не нужны. */
const runCrew = ($: Engine, args: string) => $.command.run({ command: 'crew', args } as never)

// ---------------------------------------------------------------- contextQuery

test('contextQuery is the last real prompt plus the tail of the reply after it', () => {
  const q = contextQuery([user('old prompt'), assistant('old reply'), ...TRANSCRIPT], '')
  expect(q.startsWith(QUERY)).toBe(true)
  expect(q).toContain(REPLY)
  expect(q).not.toContain('old')
})

test('contextQuery skips handbacks and tool-result-only messages', () => {
  const handback = user('<agent-message from="tester">\nThe report follows:\nall green')
  const toolResult = { role: 'user' as const, text: '', toolUses: [], toolResults: [] }
  const q = contextQuery([...TRANSCRIPT, toolResult, handback, assistant('Tests pass now.')], '')
  expect(q.startsWith(QUERY)).toBe(true)
  expect(q).toContain('Tests pass now.')
  expect(q).not.toContain('agent-message')
})

test('contextQuery keeps only the flattened tail of a long reply', () => {
  const long = `${'first part '.repeat(80)}\nthe conclusion`
  const q = contextQuery([user(QUERY), assistant(long)], '')
  const tail = q.slice(q.indexOf('…'))
  expect(tail.length).toBeLessThanOrEqual(CONTEXT_TAIL + 1)
  expect(q.endsWith('the conclusion')).toBe(true)
  expect(q.split('\n').length).toBe(3)
})

test('contextQuery without a prompt falls back, and with nothing is empty', () => {
  expect(contextQuery([], 'the last query')).toBe('the last query')
  expect(contextQuery([assistant('hello')], '')).toBe('')
})

// ---------------------------------------------------------------- кнопка ↻

for (const surface of SURFACES) {
  test(`${surface}: the header carries a ↻ button, dim text while loading`, async ($, on) => {
    const gate = deferred<JevAnswer>()
    const r = rig(on, { messages: TRANSCRIPT, jev: jevThenGate(gate) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ key: 'crew-refresh' })).toBeDefined()
    await ui.press({ key: 'crew-refresh' })
    await r.settle()
    expect(await ui.find({ key: 'crew-refresh' })).toBeUndefined()
    expect(await ui.find({ text: '↻' })).toBeDefined()
    gate.resolve({ exitCode: 0, stdout: jevStdout(JEV_FIVE) })
    await r.settle()
    expect(await ui.find({ key: 'crew-refresh' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: ↻ asks jev with the prompt and the tail of the reply`, async ($, on) => {
    const r = rig(on, { messages: TRANSCRIPT, jev: jevInTurn(JEV_FIVE, OTHER_FIVE) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: 'crew-refresh' })
    await r.settle()
    const turn = crewTurns(r).at(-1) ?? ''
    expect(turn.startsWith(QUERY)).toBe(true)
    expect(turn).toContain(REPLY)
    expect((await drawnRows(ui)).sort()).toEqual([...OTHER_FIVE].sort())
    await ui.unmount()
  })

  test(`${surface}: ↻ skips the jev and task caches each time`, async ($, on) => {
    const r = rig(on, { messages: TRANSCRIPT, task: () => ({ isAnswered: true, text: JSON.stringify({ [FIRST]: 'check the tokenizer' }) }) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: 'crew-refresh' })
    await r.settle()
    const [jevAfterOne, tasksAfterOne] = [crewTurns(r).length, r.taskCompletes.length]
    await ui.press({ key: 'crew-refresh' })
    await r.settle()
    expect(crewTurns(r).length).toBe(jevAfterOne + 1)
    expect(r.taskCompletes.length).toBe(tasksAfterOne + 1)
    await ui.unmount()
  })

  test(`${surface}: ↻ keeps a draft row and fills the free slots, five rows at most`, async ($, on) => {
    const r = rig(on, { messages: TRANSCRIPT, jev: jevInTurn(JEV_FIVE, OTHER_FIVE) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    await ui.press({ key: 'crew-refresh' })
    await r.settle()
    expect(await ui.find({ key: `crew-start-${FIRST}` })).toBeDefined()
    const drawn = await drawnRows(ui)
    expect([...drawn].sort()).toEqual([FIRST, ...OTHER_FIVE.slice(0, 4)].sort())
    await ui.unmount()
  })

  test(`${surface}: a fresh pick that is already a draft row is drawn once`, async ($, on) => {
    const r = rig(on, { messages: TRANSCRIPT, jev: jevInTurn(JEV_FIVE, [FIRST, ...OTHER_FIVE]) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    await ui.press({ key: 'crew-refresh' })
    await r.settle()
    const drawn = await drawnRows(ui)
    expect([...drawn].sort()).toEqual([FIRST, ...OTHER_FIVE.slice(0, 4)].sort())
    await ui.unmount()
  })

  test(`${surface}: a draft dropped while ↻ loads is not kept`, async ($, on) => {
    const gate = deferred<JevAnswer>()
    const r = rig(on, { messages: TRANSCRIPT, jev: jevThenGate(gate) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    await ui.press({ key: 'crew-refresh' })
    await r.settle()
    await ui.press({ key: `crew-drop-${FIRST}` })
    gate.resolve({ exitCode: 0, stdout: jevStdout(OTHER_FIVE) })
    await r.settle()
    expect([...(await drawnRows(ui))].sort()).toEqual([...OTHER_FIVE].sort())
    await ui.unmount()
  })

  test(`${surface}: ↻ with nothing to go on says so in a toast`, async ($, on) => {
    const r = rig(on, { messages: [] })
    await offerAll($)
    await runCrew($, '')
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: 'crew-refresh' })
    await r.settle()
    expect(r.toasts.some(t => /nothing to go on/.test(t))).toBe(true)
    expect(r.jevRuns().length).toBe(0)
    await ui.unmount()
  })

  test(`${surface}: while ↻ loads, the draft row stays drawn`, async ($, on) => {
    const gate = deferred<JevAnswer>()
    const r = rig(on, { messages: TRANSCRIPT, jev: jevThenGate(gate) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    await ui.press({ key: 'crew-refresh' })
    await r.settle()
    expect(await ui.find({ key: `crew-start-${FIRST}` })).toBeDefined()
    expect(await ui.find({ text: 'security-reviewer' })).toBeUndefined()
    gate.resolve({ exitCode: 0, stdout: jevStdout(OTHER_FIVE) })
    await r.settle()
    await ui.unmount()
  })

  test(`${surface}: /crew on an empty pane draws the header with ↻, and ↻ builds CREW from the transcript`, async ($, on) => {
    const r = rig(on, { messages: TRANSCRIPT })
    await offerAll($)
    await runCrew($, '')
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: /CREW/ })).toBeDefined()
    await ui.press({ key: 'crew-refresh' })
    await r.settle()
    expect(crewTurns(r).at(-1)?.startsWith(QUERY)).toBe(true)
    expect((await drawnRows(ui)).length).toBe(5)
    await ui.unmount()
  })
}

// ---------------------------------------------------------------- /crew refresh

test('/crew refresh rebuilds CREW from the transcript, skipping the cache', async ($, on) => {
  const r = rig(on, { messages: TRANSCRIPT })
  await ready($, r)
  const before = crewTurns(r).length
  const done = await runCrew($, 'refresh')
  await r.settle()
  expect(done.text).toMatch(/refresh/i)
  expect(crewTurns(r).length).toBe(before + 1)
  expect(crewTurns(r).at(-1)).toContain(REPLY)
})

test('/crew refresh writes the fresh picks back to the jev cache', async ($, on) => {
  const r = rig(on, { messages: TRANSCRIPT, jev: jevInTurn(JEV_FIVE, OTHER_FIVE) })
  await ready($, r)
  await runCrew($, 'refresh')
  await r.settle()
  const cached = (r.store.get(JEV_CACHE_KEY) ?? []) as { picks: string[] }[]
  expect(cached.some(c => c.picks.join() === OTHER_FIVE.join())).toBe(true)
})

test('two /crew refresh at once start one refresh', async ($, on) => {
  const r = rig(on, { messages: TRANSCRIPT })
  await ready($, r)
  const before = crewTurns(r).length
  const done = await Promise.all([runCrew($, 'refresh'), runCrew($, 'refresh')])
  await r.settle()
  expect(done.map(d => d.text).sort()).toEqual(['Crew is already refreshing.', 'Crew refreshing.'])
  expect(crewTurns(r).length).toBe(before + 1)
})

test('/crew refresh with no agents yet says so and asks nothing', async ($, on) => {
  const r = rig(on, { messages: TRANSCRIPT })
  const done = await runCrew($, 'refresh')
  await r.settle()
  expect(done.text).toMatch(/no agents/i)
  expect(r.jevRuns().length).toBe(0)
})

// ---------------------------------------------------------------- режим «следующий»

async function readyNext($: Engine, r: Rig, on: Parameters<typeof rig>[0]) {
  on('prompt.suggest', () => ({ isShown: true }))
  await ready($, r)
  await $.prompt.suggest({ text: GUESS, origin: { kind: 'suggestion' } } as never)
  await r.settle()
}

for (const surface of SURFACES) {
  test(`${surface}: ↻ in next mode re-picks for the guess and keeps the queue`, async ($, on) => {
    const r = rig(on, { messages: TRANSCRIPT, jev: jevInTurn(JEV_FIVE, JEV_FIVE, OTHER_FIVE) })
    await readyNext($, r, on)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-next-${FIRST}` })
    await ui.press({ key: 'crew-refresh' })
    await r.settle()
    expect(crewTurns(r).at(-1)).toBe(GUESS)
    expect(await ui.find({ text: new RegExp(`next · ${GUESS}`) })).toBeDefined()
    expect(await ui.find({ text: 'queued' })).toBeDefined()
    expect(await drawnRows(ui)).toContain(FIRST)
    expect((await drawnRows(ui)).length).toBe(5)
    await ui.unmount()
  })
}
