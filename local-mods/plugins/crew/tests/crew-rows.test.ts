import { expect, test } from 'claude-code/testing'

import type { Crew, CrewRow, RowPhase } from '../hooks/crew'
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
