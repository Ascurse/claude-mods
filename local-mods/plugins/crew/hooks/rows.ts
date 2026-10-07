import type { Crew, CrewRow, RowPhase } from './crew'
import { tagHeader } from './crew'

const BUSY_PHASES: ReadonlySet<RowPhase> = new Set(['draft', 'writing', 'started', 'queued'])

/** Строки, с которыми человек уже работает: ручное обновление их не трогает. */
export const busyRows = (rows: CrewRow[]) => rows.filter(r => BUSY_PHASES.has(r.phase))

export const headerText = (cr: Crew, catalogSize: number): string => {
  if (cr.isLoading) return `… of ${cr.total}`
  if (cr.rows.length === 0) return `0 of ${catalogSize}`
  return tagHeader(cr.rows.length, cr.total, cr.by, cr.tags ?? [])
}
