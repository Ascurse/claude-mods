import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Rig } from './crew-rig'
import { CATALOG, DRAFT, JEV_FIVE, OTHER_QUERY, SURFACES, deferred, jevStdout, pane, ready, rig } from './crew-rig'

const FIRST = 'typescript-reviewer'
const SECOND = 'security-reviewer'
const GUESS = 'now add tests for the parser'

/** Типы агентов, которых главную модель просят запустить. */
const requested = (texts: readonly { text: string }[]) => texts.flatMap(t => [...t.text.matchAll(/subagent_type: (\S+)/g)].map(m => m[1]))

// ---------------------------------------------------------------- режим «следующий»

const suggest = ($: Engine, text: string, origin: { kind: 'suggestion' } | { kind: 'plugin'; name: string } = { kind: 'suggestion' }) =>
  $.prompt.suggest({ text, origin } as never)

async function readyNext($: Engine, r: Rig, on: Parameters<typeof rig>[0]) {
  on('prompt.suggest', () => ({ isShown: true }))
  await ready($, r)
  await suggest($, GUESS)
  await r.settle()
}

for (const surface of SURFACES) {
  test(`${surface}: the engine's guess at the next prompt rebuilds CREW for it, with next buttons and a "next ·" line`, async ($, on) => {
    const r = rig(on)
    await readyNext($, r, on)
    const jev = r.jevRuns().filter(a => !a.some(x => x.endsWith('/tags')))
    expect(jev.at(-1)).toContain(GUESS)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ text: new RegExp(`next · ${GUESS}`) })).toBeDefined()
    expect(await ui.find({ key: `crew-next-${FIRST}` })).toBeDefined()
    expect(await ui.find({ key: `crew-run-${FIRST}` })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: a plugin's suggestion leaves CREW as it was`, async ($, on) => {
    const r = rig(on)
    on('prompt.suggest', () => ({ isShown: true }))
    await ready($, r)
    const before = r.jevRuns().length
    await suggest($, GUESS, { kind: 'plugin', name: 'other' })
    await r.settle()
    expect(r.jevRuns().length).toBe(before)
    const ui = await $.ui.mount({ ...pane(86), surface })
    expect(await ui.find({ key: `crew-run-${FIRST}` })).toBeDefined()
    expect(await ui.find({ text: /next ·/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: next queues the agent, a second press takes it off`, async ($, on) => {
    const r = rig(on)
    await readyNext($, r, on)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-next-${FIRST}` })
    expect(await ui.find({ text: 'queued' })).toBeDefined()
    expect(r.completes.length).toBe(0)
    expect(r.submits.length).toBe(0)
    await ui.press({ key: `crew-next-${FIRST}` })
    expect(await ui.find({ text: 'queued' })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: the next real prompt starts each queued agent with a task written for that prompt, and CREW is back to now`, async ($, on) => {
    const r = rig(on)
    await readyNext($, r, on)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-next-${FIRST}` })
    await ui.press({ key: `crew-next-${SECOND}` })
    await $.turn.start({ text: OTHER_QUERY, turnId: 'T-next' })
    await r.settle()
    expect(r.completes.length).toBe(2)
    for (const c of r.completes) {
      expect(c.prompt).toContain(OTHER_QUERY)
      expect(c.prompt).not.toContain(GUESS)
    }
    expect(r.submits.length).toBe(1) // один общий запрос на всех
    expect(requested(r.submits).sort()).toEqual([FIRST, SECOND].sort())
    expect(r.submits[0]?.text).toContain(`\n${DRAFT}\n`)
    expect(await ui.find({ text: /next ·/ })).toBeUndefined()
    expect(await ui.find({ key: `crew-run-${FIRST}` })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: taking the guess as it is still starts the queue`, async ($, on) => {
    const r = rig(on)
    await readyNext($, r, on)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-next-${FIRST}` })
    await $.turn.start({ text: GUESS, turnId: 'T-guess' })
    await r.settle()
    expect(requested(r.submits)).toEqual([FIRST])
    expect(await ui.find({ key: `crew-run-${FIRST}` })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: with nothing queued the next prompt starts no agent`, async ($, on) => {
    const r = rig(on)
    await readyNext($, r, on)
    await $.turn.start({ text: OTHER_QUERY, turnId: 'T-none' })
    await r.settle()
    expect(r.completes.length).toBe(0)
    expect(r.submits.length).toBe(0)
  })

  test(`${surface}: a queued agent whose request is dropped leaves an error toast`, async ($, on) => {
    const r = rig(on, { submit: () => ({ drop: 'no capacity' }) })
    await readyNext($, r, on)
    const ui = await $.ui.mount({ ...pane(86), surface })
    await ui.press({ key: `crew-next-${FIRST}` })
    await $.turn.start({ text: OTHER_QUERY, turnId: 'T-deny' })
    await r.settle()
    expect(r.submits.length).toBe(1)
    expect(r.toasts.some(t => /no capacity/.test(t))).toBe(true)
    await ui.unmount()
  })
}

test('tagging that finishes after the guess keeps CREW in next mode with its queue', async ($, on) => {
  const gate = deferred<{ isAnswered: true; text: string }>()
  const r = rig(on, { tag: () => gate.promise })
  await readyNext($, r, on)
  const ui = await $.ui.mount({ ...pane(86), surface: 'terminal' })
  await ui.press({ key: `crew-next-${FIRST}` })
  gate.resolve({ isAnswered: true, text: JSON.stringify(Object.fromEntries(CATALOG.map(e => [e.agent, ['testing']]))) })
  await r.settle()
  expect(await ui.find({ text: new RegExp(`next · ${GUESS}`) })).toBeDefined()
  expect(await ui.find({ text: 'queued' })).toBeDefined()
  await $.turn.start({ text: OTHER_QUERY, turnId: 'T-tagged' })
  await r.settle()
  expect(requested(r.submits)).toEqual([FIRST])
  await ui.unmount()
})

test('a guess does not wipe a draft the person is reading', async ($, on) => {
  const r = rig(on)
  on('prompt.suggest', () => ({ isShown: true }))
  await ready($, r)
  const ui = await $.ui.mount({ ...pane(86), surface: 'terminal' })
  await ui.press({ key: `crew-run-${FIRST}` })
  await r.settle()
  expect(await ui.find({ key: `crew-start-${FIRST}` })).toBeDefined()
  await suggest($, GUESS)
  await r.settle()
  expect(await ui.find({ text: /next ·/ })).toBeUndefined()
  expect(await ui.find({ key: `crew-start-${FIRST}` })).toBeDefined()
  await ui.unmount()
})

test('a new guess keeps the queue made for the previous one', async ($, on) => {
  const r = rig(on)
  await readyNext($, r, on)
  const ui = await $.ui.mount({ ...pane(86), surface: 'terminal' })
  await ui.press({ key: `crew-next-${FIRST}` })
  await suggest($, 'and then deploy it')
  await r.settle()
  expect(await ui.find({ text: 'queued' })).toBeDefined()
  await $.turn.start({ text: OTHER_QUERY, turnId: 'T-kept' })
  await r.settle()
  expect(requested(r.submits)).toEqual([FIRST])
  await ui.unmount()
})

test('jev picks for the guess come from the same picker as for a prompt', async ($, on) => {
  const r = rig(on, { jev: () => ({ exitCode: 0, stdout: jevStdout(JEV_FIVE) }) })
  await readyNext($, r, on)
  const ui = await $.ui.mount({ ...pane(86), surface: 'desktop' })
  for (const name of JEV_FIVE) expect(await ui.find({ key: `crew-next-${name}` })).toBeDefined()
  await ui.unmount()
})
