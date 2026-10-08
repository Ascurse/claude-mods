import { expect, test } from 'claude-code/testing'

import type { Crew, CrewRow, RowPhase } from '../hooks/crew'
import { DEFAULT_CREW, setPhase } from '../hooks/crew'
import { busyRows, keptRows, nextTitle } from '../hooks/rows'

const row = (agent: string, phase: RowPhase): CrewRow => ({ agent, description: '', phase, draft: null, error: null })

const crew = (patch: Partial<Crew>): Crew => ({ query: 'q', isLoading: false, by: 'jev', rows: [], total: 8, ...patch })

test('busyRows keeps only the rows a person is working on', () => {
  const rows = [row('a', 'idle'), row('b', 'draft'), row('c', 'writing'), row('d', 'started'), row('f', 'error')]
  expect(busyRows(rows).map(r => r.agent)).toEqual(['b', 'c', 'd'])
  expect(busyRows([row('a', 'idle')])).toEqual([])
})

test('keptRows: an automatic refresh keeps open drafts and drafts being written, a manual one also keeps started agents', () => {
  const rows = [row('a', 'idle'), row('b', 'draft'), row('c', 'writing'), row('d', 'started'), row('f', 'error')]
  expect(keptRows(rows, false).map(r => r.agent)).toEqual(['b', 'c'])
  expect(keptRows(rows, true).map(r => r.agent)).toEqual(['b', 'c', 'd'])
})

test('nextTitle: the predicted step, an ellipsis while it is being predicted, nothing before the first prediction', () => {
  expect(nextTitle(crew({ query: 'review the parser diff' }))).toBe('next: review the parser diff')
  expect(nextTitle(crew({ query: '', isLoading: true }))).toBe('next: …')
  expect(nextTitle(crew({ query: 'old step', isLoading: true }))).toBe('next: …')
  expect(nextTitle(DEFAULT_CREW)).toBe('')
})

test('error phase: the row carries the message, no stale draft, and a refresh does not keep it', () => {
  const drafted = crew({ rows: [{ ...row('a', 'draft'), draft: 'old draft' }, row('b', 'idle')] })
  const writing = setPhase(drafted, 'a', 'writing', { draft: null, error: null })
  const failed = setPhase(writing, 'a', 'error', { error: 'error: timeout' })
  expect(failed.rows[0]).toEqual({ agent: 'a', description: '', phase: 'error', draft: null, error: 'error: timeout' })
  expect(failed.rows[1]).toEqual(row('b', 'idle'))
  expect(busyRows(failed.rows)).toEqual([])
})
