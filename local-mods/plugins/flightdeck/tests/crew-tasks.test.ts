import { expect, test } from 'claude-code/testing'

import { TASK_MAX, catalogHash, draftRequest, parseTaskAnswer, taskRequest } from '../hooks/crew'
import { TASKS_KEY, TASK_LIMIT, getTasks, putTasks, taskKey } from '../hooks/cache/jev'
import { CATALOG, DRAFT, JEV_FIVE, OTHER_QUERY, PROJECT, QUERY, SURFACES, deferred, entry, pane, ready, rig } from './crew-rig'
import type { ModelAnswer } from './crew-rig'

// ---------------------------------------------------------------- fixtures

const FIRST = JEV_FIVE[0] as string
const TASKS: Record<string, string> = {
  'typescript-reviewer': 'Check the types in the parser diff',
  'security-reviewer': 'Look for injection in the request handlers',
  'Code Reviewer': 'Review the diff for correctness',
  'flutter-reviewer': 'Skim the dart widgets for mistakes',
  'test-planner': 'List the missing coverage',
}
const answerTasks = (): ModelAnswer => ({ isAnswered: true, text: JSON.stringify(TASKS) })
const fiveEntries = JEV_FIVE.map(a => CATALOG.find(e => e.agent === a) ?? entry(a, ''))

const fakeStore = (init: Record<string, unknown> = {}) => {
  const data = new Map<string, unknown>(Object.entries(init))
  return { data, get: async (k: string) => data.get(k), set: async (k: string, v: unknown) => void data.set(k, JSON.parse(JSON.stringify(v))) }
}

// ---------------------------------------------------------------- pure

test('taskRequest is one haiku call carrying the query, cwd and every agent with its description', () => {
  const req = taskRequest(fiveEntries, { query: 'fix the flaky parser test', cwd: '/work/parser' })
  expect(req.model).toBe('haiku')
  expect(/one-line tasks/i.test(req.system)).toBe(true)
  expect(req.prompt).toContain('fix the flaky parser test')
  expect(req.prompt).toContain('/work/parser')
  for (const e of fiveEntries) {
    expect(req.prompt).toContain(e.agent)
    expect(req.prompt).toContain(e.description)
  }
})

test('parseTaskAnswer keeps known agents, trims, and cuts a line to TASK_MAX characters', () => {
  const long = 'x'.repeat(TASK_MAX + 50)
  const text = JSON.stringify({ [FIRST]: `  ${long}  `, 'security-reviewer': '  Look for secrets  ', ghost: 'not in the crew' })
  const out = parseTaskAnswer(text, fiveEntries)
  expect(Object.keys(out).sort()).toEqual([FIRST, 'security-reviewer'].sort())
  expect((out[FIRST] ?? '').length <= TASK_MAX).toBe(true)
  expect((out[FIRST] ?? '').startsWith('xxx')).toBe(true)
  expect(out['security-reviewer']).toBe('Look for secrets')
})

test('parseTaskAnswer reads JSON inside a fence or preface, and drops empty or non-string lines', () => {
  const text = 'Sure:\n```json\n' + JSON.stringify({ [FIRST]: 'Check types', 'test-planner': '   ', 'Code Reviewer': 7 }) + '\n```'
  expect(parseTaskAnswer(text, fiveEntries)).toEqual({ [FIRST]: 'Check types' })
})

test('parseTaskAnswer on an unparsable answer is empty', () => {
  expect(parseTaskAnswer('no json here', fiveEntries)).toEqual({})
  expect(parseTaskAnswer('{broken', fiveEntries)).toEqual({})
  expect(parseTaskAnswer('["a"]', fiveEntries)).toEqual({})
})

test('draftRequest passes the one-line task as extra context, and is unchanged without it', () => {
  const e = entry('x', 'does x')
  const plain = draftRequest(e, { query: 'q', cwd: '/w' })
  expect(draftRequest(e, { query: 'q', cwd: '/w', task: null })).toEqual(plain)
  const withTask = draftRequest(e, { query: 'q', cwd: '/w', task: 'Check the lexer' })
  expect(withTask.prompt).toContain('Check the lexer')
  expect(plain.prompt).not.toContain('Check the lexer')
})

test('the task cache keeps fifty entries, drops the oldest, and tolerates a damaged value', async () => {
  const store = fakeStore()
  for (let i = 0; i < TASK_LIMIT + 1; i++) await putTasks(store, `k${i}`, { a: `t${i}` })
  expect(await getTasks(store, 'k0')).toBeUndefined()
  expect(await getTasks(store, `k${TASK_LIMIT}`)).toEqual({ a: `t${TASK_LIMIT}` })
  const damaged = fakeStore({ [TASKS_KEY]: 'junk' })
  expect(await getTasks(damaged, 'k')).toBeUndefined()
  await putTasks(damaged, 'k', { a: 'b' })
  expect(await getTasks(damaged, 'k')).toEqual({ a: 'b' })
})

test('taskKey depends on the query, the catalog, the crew and the project folder', () => {
  const h = catalogHash(CATALOG)
  expect(taskKey('q', h, ['a', 'b'], '/w')).toBe(taskKey('q', h, ['a', 'b'], '/w'))
  expect(taskKey('q', h, ['a', 'b'], '/w')).not.toBe(taskKey('q2', h, ['a', 'b'], '/w'))
  expect(taskKey('q', h, ['a', 'b'], '/w')).not.toBe(taskKey('q', h, ['a', 'c'], '/w'))
  expect(taskKey('q', h, ['a', 'b'], '/w')).not.toBe(taskKey('q', 'other', ['a', 'b'], '/w'))
  expect(taskKey('q', h, ['a', 'b'], '/work/a')).not.toBe(taskKey('q', h, ['a', 'b'], '/work/b'))
})

// ---------------------------------------------------------------- engine

test('a 5-row list makes exactly one haiku call for tasks, with all five agents in it', async ($, on) => {
  const r = rig(on, { task: answerTasks })
  await ready($, r)
  expect(r.taskCompletes.length).toBe(1)
  const prompt = r.taskCompletes[0]?.prompt ?? ''
  for (const a of JEV_FIVE) expect(prompt).toContain(a)
  expect(prompt).toContain(QUERY)
})

test('the list lands before the tasks answer arrives, and the task is written once it does', async ($, on) => {
  const gate = deferred<ModelAnswer>()
  const r = rig(on, { task: () => gate.promise })
  await ready($, r)
  const ui = await $.ui.mount({ ...pane(86), surface: 'terminal' })
  expect(await ui.find({ key: `crew-run-${FIRST}` })).toBeDefined()
  expect(await ui.find({ text: TASKS[FIRST] as string })).toBeUndefined()
  expect(await ui.find({ text: '…' })).toBeDefined() // pending: a placeholder beside the name
  gate.resolve(answerTasks())
  await r.settle()
  expect(await ui.find({ text: TASKS[FIRST] as string })).toBeDefined()
  await ui.unmount()
})

for (const surface of SURFACES) {
  test(`${surface}: the task is drawn dim beside the name, truncated to one line`, async ($, on) => {
    const r = rig(on, { task: answerTasks })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    const texts = await ui.findAll({ type: 'Text' })
    const task = texts.find(t => t.children?.[0] === TASKS[FIRST])
    expect(task?.props.dimColor).toBe(true)
    expect(task?.props.wrap).toBe('truncate')
    const row = (await ui.findAll({ type: 'Box' })).find(b => b.props.key === `crew-${FIRST}`)
    const nameLine = (row?.children as { children?: unknown }[] | undefined)?.[0]
    const beside = JSON.stringify(nameLine)
    expect(beside).toContain(TASKS[FIRST] as string)
    expect(beside).not.toContain('Reviews typescript code') // the description is not beside the name
    await ui.unmount()
  })

  test(`${surface}: the description sits in a Box that is display none and shown on hover`, async ($, on) => {
    const r = rig(on, { task: answerTasks })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    const description = CATALOG.find(e => e.agent === FIRST)?.description as string
    const row = (await ui.findAll({ type: 'Box' })).find(b => b.props.key === `crew-${FIRST}`)
    type Node = { type?: string; props?: Record<string, unknown>; hover?: unknown; children?: unknown[] }
    const hidden = (row?.children as Node[] | undefined)?.find(c => c.props?.display === 'none' && JSON.stringify(c.children).includes(description))
    expect(hidden?.type).toBe('Box')
    expect(hidden?.hover).toEqual({ display: 'flex' })
    expect(hidden?.props?.position).toBe('absolute')
    await ui.unmount()
  })

  test(`${surface}: with no task at all nothing is drawn beside the name, and the row buttons stay`, async ($, on) => {
    const r = rig(on) // Haiku never answers the tasks call
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ key: `crew-run-${FIRST}` })).toBeDefined()
    expect(await ui.find({ text: '…' })).toBeUndefined()
    const row = (await ui.findAll({ type: 'Box' })).find(b => b.props.key === `crew-${FIRST}`)
    const nameLine = JSON.stringify((row?.children as unknown[] | undefined)?.[0])
    expect(nameLine).not.toContain('Reviews typescript code')
    await ui.unmount()
  })

  test(`${surface}: a Haiku failure on the tasks call leaves every row drawn`, async ($, on) => {
    const r = rig(on, { task: () => { throw new Error('haiku is down') } })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    for (const a of JEV_FIVE) expect(await ui.find({ key: `crew-run-${a}` })).toBeDefined()
    expect(await ui.find({ text: '…' })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: an unparsable tasks answer leaves tasks empty`, async ($, on) => {
    const r = rig(on, { task: () => ({ isAnswered: true, text: 'sorry, no json' }) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ key: `crew-run-${FIRST}` })).toBeDefined()
    expect(await ui.find({ text: TASKS[FIRST] as string })).toBeUndefined()
    await ui.unmount()
  })
}

test('run passes the one-line task into the draft request as extra context', async ($, on) => {
  const r = rig(on, { task: answerTasks })
  await ready($, r)
  const ui = await $.ui.mount({ ...pane(86), surface: 'terminal' })
  await ui.press({ key: `crew-run-${FIRST}` })
  expect(r.completes.length).toBe(1)
  expect(r.completes[0]?.prompt).toContain(TASKS[FIRST] as string)
  expect(await ui.find({ text: DRAFT })).toBeDefined()
  await ui.unmount()
})

test('a repeated query makes no tasks call', async ($, on) => {
  const r = rig(on, { task: answerTasks })
  await ready($, r)
  expect(r.taskCompletes.length).toBe(1)
  await $.turn.start({ text: OTHER_QUERY, turnId: 'T-other' })
  await r.settle()
  const afterOther = r.taskCompletes.length
  await $.turn.start({ text: QUERY, turnId: 'T-again' })
  await r.settle()
  expect(r.taskCompletes.length).toBe(afterOther) // QUERY is cached, no new call
  const ui = await $.ui.mount({ ...pane(86), surface: 'terminal' })
  expect(await ui.find({ text: TASKS[FIRST] as string })).toBeDefined()
  await ui.unmount()
})

test('a fresh session with only $.store behind it makes no tasks call for a seen query', async ($, on) => {
  const key = taskKey(QUERY, catalogHash(CATALOG), JEV_FIVE, PROJECT)
  const prior = fakeStore()
  await putTasks(prior, key, TASKS)
  const r = rig(on, { store: Object.fromEntries(prior.data), task: () => { throw new Error('must not be asked') } })
  await ready($, r)
  expect(r.taskCompletes.length).toBe(0)
  const ui = await $.ui.mount({ ...pane(86), surface: 'terminal' })
  expect(await ui.find({ text: TASKS[FIRST] as string })).toBeDefined()
  await ui.unmount()
})

test('the same query in another project folder asks haiku again instead of reusing the old tasks', async ($, on) => {
  const prior = fakeStore()
  await putTasks(prior, taskKey(QUERY, catalogHash(CATALOG), JEV_FIVE, '/work/other'), TASKS)
  const r = rig(on, { store: Object.fromEntries(prior.data), task: answerTasks })
  await ready($, r)
  expect(r.taskCompletes.length).toBe(1)
})

test('the tasks answer is stored under the cache key for the next session', async ($, on) => {
  const r = rig(on, { task: answerTasks })
  await ready($, r)
  const stored = r.store.get(TASKS_KEY) as { key: string; tasks: Record<string, string> }[]
  expect(stored.length).toBe(1)
  expect(stored[0]?.key).toBe(taskKey(QUERY, catalogHash(CATALOG), JEV_FIVE, PROJECT))
  expect(stored[0]?.tasks).toEqual(TASKS)
})

test('a failed tasks call is not cached', async ($, on) => {
  const r = rig(on, { task: () => ({ isAnswered: false, reason: 'empty-reply' }) })
  await ready($, r)
  expect(r.taskCompletes.length).toBe(1)
  expect(r.store.get(TASKS_KEY)).toBeUndefined()
})

