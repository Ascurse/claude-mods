import { expect, test } from 'claude-code/testing'

import type { Crew, CrewRow, RowPhase } from '../hooks/crew'
import { DEFAULT_CREW, setPhase } from '../hooks/crew'
import { busyRows, headerText } from '../hooks/rows'

const row = (agent: string, phase: RowPhase): CrewRow => ({ agent, description: '', phase, draft: null, error: null })

const crew = (patch: Partial<Crew>): Crew => ({ query: 'q', isLoading: false, by: 'jev', rows: [], total: 8, ...patch })

test('busyRows keeps only the rows a person is working on', () => {
  const rows = [row('a', 'idle'), row('b', 'draft'), row('c', 'writing'), row('d', 'started'), row('e', 'queued'), row('f', 'error')]
  expect(busyRows(rows).map(r => r.agent)).toEqual(['b', 'c', 'd', 'e'])
  expect(busyRows([row('a', 'idle')])).toEqual([])
})

test('headerText: loading, empty and tagged header', () => {
  expect(headerText(crew({ isLoading: true, rows: [row('a', 'idle')] }), 38)).toBe('… of 8')
  expect(headerText(crew({ isLoading: true, rows: [] }), 38)).toBe('… of 8')
  expect(headerText(crew({ rows: [] }), 38)).toBe('0 of 38')
  expect(headerText(crew({ rows: [row('a', 'idle')], tags: ['docs'] }), 38)).toBe('1 of 8 · jev · docs')
  expect(headerText(crew({ rows: [row('a', 'idle')], by: 'words' }), 38)).toBe('1 of 8 · by words')
})

test('empty load: nothing loaded yet gives no rows and a zero header', () => {
  expect(busyRows(DEFAULT_CREW.rows)).toEqual([])
  expect(headerText(DEFAULT_CREW, 38)).toBe('0 of 38')
  expect(headerText({ ...DEFAULT_CREW, isLoading: true }, 38)).toBe('… of 0')
})

test('error phase: the row carries the message, no stale draft, and a refresh does not keep it', () => {
  const drafted = crew({ rows: [{ ...row('a', 'draft'), draft: 'old draft' }, row('b', 'idle')] })
  const writing = setPhase(drafted, 'a', 'writing', { draft: null, error: null })
  const failed = setPhase(writing, 'a', 'error', { error: 'error: timeout' })
  expect(failed.rows[0]).toEqual({ agent: 'a', description: '', phase: 'error', draft: null, error: 'error: timeout' })
  expect(failed.rows[1]).toEqual(row('b', 'idle'))
  expect(busyRows(failed.rows)).toEqual([])
  expect(headerText(failed, 38)).toBe('2 of 8 · jev')
})
