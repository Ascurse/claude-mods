import { expect, test } from 'claude-code/testing'

import { NO_TASK, PLAN_MAX, TASK_MAX, catalogHash, draftRequest, parseTaskAnswer, taskRequest } from '../hooks/crew'
import type { TaskInfo } from '../hooks/crew'
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
const PLANS: Record<string, string> = {
  'typescript-reviewer': 'Starts with tsc on the parser package, then reads the diff',
  'security-reviewer': 'Starts by listing every handler that reads the request body',
  'Code Reviewer': 'Starts from the largest changed file',
  'flutter-reviewer': 'Starts with flutter analyze',
  'test-planner': 'Starts by mapping tests to changed functions',
}
const INFOS: Record<string, TaskInfo> = Object.fromEntries(Object.keys(TASKS).map(a => [a, { task: TASKS[a] as string, plan: PLANS[a] as string }]))
const answerTasks = (): ModelAnswer => ({ isAnswered: true, text: JSON.stringify(INFOS) })
const answerOldTasks = (): ModelAnswer => ({ isAnswered: true, text: JSON.stringify(TASKS) })
const fiveEntries = JEV_FIVE.map(a => CATALOG.find(e => e.agent === a) ?? entry(a, ''))

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

/** Вторая строка ряда агента: Text под именем, если он есть (дальше идут кнопки в Box). */
const lineUnderName = async (ui: { findAll: (q: { type: string }) => Promise<Drawn[]> }, agent: string): Promise<Drawn | undefined> => {
  const row = (await ui.findAll({ type: 'Box' })).find(b => b.props?.key === `crew-${agent}`)
  const second = (row?.children as Drawn[] | undefined)?.[1]
  return second?.type === 'Text' ? second : undefined
}

const fakeStore = (init: Record<string, unknown> = {}) => {
  const data = new Map<string, unknown>(Object.entries(init))
  return { data, get: async (k: string) => data.get(k), set: async (k: string, v: unknown) => void data.set(k, JSON.parse(JSON.stringify(v))) }
}

// ---------------------------------------------------------------- pure

test('taskRequest is one haiku call carrying the query, cwd and every agent with its description', () => {
  const req = taskRequest(fiveEntries, { query: 'fix the flaky parser test', cwd: '/work/parser' })
  expect(req.model).toBe('haiku')
  expect(/one-line tasks/i.test(req.system)).toBe(true)
  expect(req.system).toContain('"plan"')
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
  expect((out[FIRST]?.task ?? '').length <= TASK_MAX).toBe(true)
  expect((out[FIRST]?.task ?? '').startsWith('xxx')).toBe(true)
  expect(out['security-reviewer']).toEqual({ task: 'Look for secrets', plan: null })
})

test('parseTaskAnswer reads {task, plan}, cuts the plan to PLAN_MAX on one line, and drops an entry without a task', () => {
  const long = 'y'.repeat(PLAN_MAX + 50)
  const text = JSON.stringify({
    [FIRST]: { task: ' Check types ', plan: ` Runs tsc\n  first ` },
    'security-reviewer': { task: 'Look for secrets', plan: long },
    'Code Reviewer': { plan: 'no task here' },
    'test-planner': { task: 'List gaps', plan: 7 },
  })
  const out = parseTaskAnswer(text, fiveEntries)
  expect(out[FIRST]).toEqual({ task: 'Check types', plan: 'Runs tsc first' })
  expect((out['security-reviewer']?.plan ?? '').length <= PLAN_MAX).toBe(true)
  expect((out['security-reviewer']?.plan ?? '').startsWith('yyy')).toBe(true)
  expect(out['Code Reviewer']).toBeUndefined()
  expect(out['test-planner']).toEqual({ task: 'List gaps', plan: null })
})

test('parseTaskAnswer reads JSON inside a fence or preface, and drops empty or non-string lines', () => {
  const text = 'Sure:\n```json\n' + JSON.stringify({ [FIRST]: 'Check types', 'test-planner': '   ', 'Code Reviewer': 7 }) + '\n```'
  expect(parseTaskAnswer(text, fiveEntries)).toEqual({ [FIRST]: { task: 'Check types', plan: null } })
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

test('draftRequest passes the plan shown under the name, and adds nothing without it', () => {
  const e = entry('x', 'does x')
  const taskOnly = draftRequest(e, { query: 'q', cwd: '/w', task: 'Check the lexer' })
  expect(draftRequest(e, { query: 'q', cwd: '/w', task: 'Check the lexer', plan: null })).toEqual(taskOnly)
  expect(taskOnly.prompt).not.toMatch(/first steps/i)
  const withPlan = draftRequest(e, { query: 'q', cwd: '/w', task: 'Check the lexer', plan: 'Starts with tsc' })
  expect(withPlan.prompt).toContain('Starts with tsc')
  expect(withPlan.prompt).toMatch(/first steps/i)
})

test('the task cache keeps fifty entries, drops the oldest, and tolerates a damaged value', async () => {
  const store = fakeStore()
  for (let i = 0; i < TASK_LIMIT + 1; i++) await putTasks(store, `k${i}`, { a: { task: `t${i}`, plan: null } })
  expect(await getTasks(store, 'k0')).toBeUndefined()
  expect(await getTasks(store, `k${TASK_LIMIT}`)).toEqual({ a: { task: `t${TASK_LIMIT}`, plan: null } })
  const damaged = fakeStore({ [TASKS_KEY]: 'junk' })
  expect(await getTasks(damaged, 'k')).toBeUndefined()
  await putTasks(damaged, 'k', { a: { task: 'b', plan: 'c' } })
  expect(await getTasks(damaged, 'k')).toEqual({ a: { task: 'b', plan: 'c' } })
})

test('the task cache does not read entries of the old shape, where a task was a bare string', async () => {
  const store = fakeStore({ [TASKS_KEY]: [{ key: 'k', tasks: { a: 'old line' } }], 'crew.taskCache': [{ key: 'k', tasks: { a: 'old line' } }] })
  expect(TASKS_KEY).not.toBe('crew.taskCache')
  expect(await getTasks(store, 'k')).toBeUndefined()
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

test('the old answer format, a bare string per agent, still fills the task line and draws no plan', async ($, on) => {
  const r = rig(on, { task: answerOldTasks })
  await ready($, r)
  const ui = await $.ui.mount({ ...pane(86), surface: 'terminal' })
  expect(await ui.find({ text: TASKS[FIRST] as string })).toBeDefined()
  expect(await lineUnderName(ui, FIRST)).toBeUndefined()
  await ui.unmount()
})

test('a session that cached tasks in the old shape asks haiku again', async ($, on) => {
  const r = rig(on, { store: { 'crew.taskCache': [{ key: taskKey(QUERY, catalogHash(CATALOG), JEV_FIVE, PROJECT), tasks: TASKS }] }, task: answerTasks })
  await ready($, r)
  expect(r.taskCompletes.length).toBe(1)
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

  test(`${surface}: before run the plan is drawn dim on its own line under the name, one line of at most PLAN_MAX`, async ($, on) => {
    const r = rig(on, { task: answerTasks })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    const plan = await lineUnderName(ui, FIRST)
    expect(plan?.props?.dimColor).toBe(true)
    expect(plan?.props?.wrap).toBe('truncate')
    expect(plan?.children?.[0]).toBe(PLANS[FIRST])
    expect(String(plan?.children?.[0]).length <= PLAN_MAX).toBe(true)
    const row = (await ui.findAll({ type: 'Box' })).find(b => b.props.key === `crew-${FIRST}`)
    const lines = (row?.children as unknown[] | undefined) ?? []
    expect(JSON.stringify(lines[0])).not.toContain(PLANS[FIRST] as string) // not beside the name
    expect(JSON.stringify(lines[1])).toContain(PLANS[FIRST] as string)
    expect(r.completes.length).toBe(0) // no run pressed
    await ui.unmount()
  })

  test(`${surface}: once the draft is written it replaces the plan line`, async ($, on) => {
    const r = rig(on, { task: answerTasks })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    expect(await ui.find({ text: DRAFT })).toBeDefined()
    expect(await ui.find({ text: PLANS[FIRST] as string })).toBeUndefined()
    expect(await ui.find({ text: PLANS['security-reviewer'] as string })).toBeDefined() // other rows keep theirs
    await ui.unmount()
  })

  test(`${surface}: a Haiku failure draws no plan line and leaves the row`, async ($, on) => {
    const r = rig(on, { task: () => { throw new Error('haiku is down') } })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ key: `crew-run-${FIRST}` })).toBeDefined()
    expect(await lineUnderName(ui, FIRST)).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: the row draws no agent description, not even one revealed on hover`, async ($, on) => {
    const r = rig(on, { task: answerTasks })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    const description = CATALOG.find(e => e.agent === FIRST)?.description as string
    const row = (await ui.findAll({ type: 'Box' })).find(b => b.props.key === `crew-${FIRST}`)
    expect(JSON.stringify(row)).toContain(TASKS[FIRST] as string)
    expect(JSON.stringify(row)).not.toContain(description)
    await ui.unmount()
  })

  test(`${surface}: with no task at all the name is followed by an explicit no-task mark, and the row buttons stay`, async ($, on) => {
    const r = rig(on) // Haiku never answers the tasks call
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ key: `crew-run-${FIRST}` })).toBeDefined()
    expect(await ui.find({ text: '…' })).toBeUndefined()
    const row = (await ui.findAll({ type: 'Box' })).find(b => b.props.key === `crew-${FIRST}`)
    const nameLine = JSON.stringify((row?.children as unknown[] | undefined)?.[0])
    expect(nameLine).toContain(NO_TASK)
    expect(JSON.stringify(row)).not.toContain('Reviews typescript code')
    await ui.unmount()
  })

  test(`${surface}: a Haiku failure on the tasks call leaves every row drawn`, async ($, on) => {
    const r = rig(on, { task: () => { throw new Error('haiku is down') } })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    for (const a of JEV_FIVE) expect(await ui.find({ key: `crew-run-${a}` })).toBeDefined()
    expect(await ui.find({ text: '…' })).toBeUndefined()
    expect((await ui.findAll({ type: 'Text', text: NO_TASK })).length).toBe(JEV_FIVE.length)
    expect(JSON.stringify(await ui.findAll({ type: 'Box' }))).not.toContain('Reviews typescript code')
    await ui.unmount()
  })

  test(`${surface}: an unparsable tasks answer leaves tasks empty`, async ($, on) => {
    const r = rig(on, { task: () => ({ isAnswered: true, text: 'sorry, no json' }) })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ key: `crew-run-${FIRST}` })).toBeDefined()
    expect(await ui.find({ text: TASKS[FIRST] as string })).toBeUndefined()
    expect(await ui.find({ text: NO_TASK })).toBeDefined()
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

for (const surface of SURFACES) {
  test(`${surface}: run passes the plan shown under the name into the one draft call`, async ($, on) => {
    const r = rig(on, { task: answerTasks })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    expect(r.completes.length).toBe(1)
    expect(r.completes[0]?.prompt).toContain(PLANS[FIRST] as string)
    expect(r.completes[0]?.prompt).not.toContain(PLANS[JEV_FIVE[1] as string] as string)
    await ui.unmount()
  })

  test(`${surface}: run on a row without a plan sends no plan line`, async ($, on) => {
    const r = rig(on, { task: answerOldTasks })
    await ready($, r)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-run-${FIRST}` })
    expect(r.completes.length).toBe(1)
    expect(r.completes[0]?.prompt).toContain(TASKS[FIRST] as string)
    expect(r.completes[0]?.prompt).not.toMatch(/first steps/i)
    await ui.unmount()
  })
}

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
  await putTasks(prior, key, INFOS)
  const r = rig(on, { store: Object.fromEntries(prior.data), task: () => { throw new Error('must not be asked') } })
  await ready($, r)
  expect(r.taskCompletes.length).toBe(0)
  const ui = await $.ui.mount({ ...pane(86), surface: 'terminal' })
  expect(await ui.find({ text: TASKS[FIRST] as string })).toBeDefined()
  expect(await ui.find({ text: PLANS[FIRST] as string })).toBeDefined()
  await ui.unmount()
})

test('the same query in another project folder asks haiku again instead of reusing the old tasks', async ($, on) => {
  const prior = fakeStore()
  await putTasks(prior, taskKey(QUERY, catalogHash(CATALOG), JEV_FIVE, '/work/other'), INFOS)
  const r = rig(on, { store: Object.fromEntries(prior.data), task: answerTasks })
  await ready($, r)
  expect(r.taskCompletes.length).toBe(1)
})

test('the tasks answer is stored under the cache key for the next session', async ($, on) => {
  const r = rig(on, { task: answerTasks })
  await ready($, r)
  const stored = r.store.get(TASKS_KEY) as { key: string; tasks: Record<string, TaskInfo> }[]
  expect(stored.length).toBe(1)
  expect(stored[0]?.key).toBe(taskKey(QUERY, catalogHash(CATALOG), JEV_FIVE, PROJECT))
  expect(stored[0]?.tasks).toEqual(INFOS)
})

test('a failed tasks call is not cached', async ($, on) => {
  const r = rig(on, { task: () => ({ isAnswered: false, reason: 'empty-reply' }) })
  await ready($, r)
  expect(r.taskCompletes.length).toBe(1)
  expect(r.store.get(TASKS_KEY)).toBeUndefined()
})

