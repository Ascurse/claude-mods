import { expect, test } from 'claude-code/testing'

import { DRAFT_END, DRAFT_START, draftBlock, runReadmeDraft } from '../scripts/readme-draft-core'
import type { ReadmeIo } from '../scripts/readme-draft-core'

// ---------------------------------------------------------------- fixtures

const wrap = (block: string) => `# Flightdeck\n\nThe model is asked for:\n\n${block}\n\nAfter the example.\n`
const STALE = `${DRAFT_START}\n\`\`\`text\nUser request:\nold template\n\`\`\`\n${DRAFT_END}`

const memoryIo = (initial: string | null) => {
  const state = { text: initial, writes: 0 }
  const io: ReadmeIo = {
    read: () => {
      if (state.text === null) throw new Error('ENOENT: no such file or directory')
      return state.text
    },
    write: text => {
      state.text = text
      state.writes++
    },
  }
  return { io, state }
}

// ---------------------------------------------------------------- check mode

test('check passes when the README block matches draftRequest', () => {
  const { io, state } = memoryIo(wrap(draftBlock()))
  const result = runReadmeDraft(io, { write: false })
  expect(result.code).toBe(0)
  expect(state.writes).toBe(0)
})

test('check fails on a stale block and leaves the README untouched', () => {
  const before = wrap(STALE)
  const { io, state } = memoryIo(before)
  const result = runReadmeDraft(io, { write: false })
  expect(result.code).toBe(1)
  expect(result.message).toContain('--write')
  expect(state.text).toBe(before)
  expect(state.writes).toBe(0)
})

test('the block carries the draftRequest prompt with the task and plan lines', () => {
  const block = draftBlock()
  expect(block.startsWith(`${DRAFT_START}\n\`\`\`text\nUser request:\nfix the flaky parser test\n`)).toBe(true)
  expect(block).toContain('Its one-line task for this request: Check the types in the parser diff')
  expect(block).toContain('Its first steps, already shown to the user')
  expect(block.endsWith(`Write the prompt to give this subagent.\n\`\`\`\n${DRAFT_END}`)).toBe(true)
})

// ---------------------------------------------------------------- write mode

test('--write replaces a stale block and keeps the text around it', () => {
  const { io, state } = memoryIo(wrap(STALE))
  const result = runReadmeDraft(io, { write: true })
  expect(result.code).toBe(0)
  expect(state.text).toBe(wrap(draftBlock()))
  expect(runReadmeDraft(io, { write: false }).code).toBe(0)
})

test('--write does not rewrite a README that already matches', () => {
  const { io, state } = memoryIo(wrap(draftBlock()))
  expect(runReadmeDraft(io, { write: true }).code).toBe(0)
  expect(state.writes).toBe(0)
})

// ---------------------------------------------------------------- broken input

test('a missing README fails in both modes', () => {
  for (const write of [false, true]) {
    const { io } = memoryIo(null)
    const result = runReadmeDraft(io, { write })
    expect(result.code).toBe(1)
    expect(result.message).toContain('README.md')
  }
})

test('a stray end marker before the block does not hide the real pair', () => {
  const { io, state } = memoryIo(`Mentions ${DRAFT_END} in prose.\n\n${wrap(STALE)}`)
  expect(runReadmeDraft(io, { write: true }).code).toBe(0)
  expect(state.text).toBe(`Mentions ${DRAFT_END} in prose.\n\n${wrap(draftBlock())}`)
})

test('a README without the markers fails and is not written', () => {
  for (const text of ['# Flightdeck\n', `${DRAFT_END}\n${DRAFT_START}\n`]) {
    const { io, state } = memoryIo(text)
    const result = runReadmeDraft(io, { write: true })
    expect(result.code).toBe(1)
    expect(state.writes).toBe(0)
  }
})
