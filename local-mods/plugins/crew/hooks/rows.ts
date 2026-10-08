import type { Crew, CrewRow, RowPhase } from './crew'

const BUSY_PHASES: ReadonlySet<RowPhase> = new Set(['draft', 'writing', 'started'])

/** Строки, с которыми человек уже работает: ручное обновление их не трогает. */
export const busyRows = (rows: CrewRow[]) => rows.filter(r => BUSY_PHASES.has(r.phase))

/** Что переживает обновление: незаконченный черновик всегда, запущенный агент — только при ручном ↻. */
export const keptRows = (rows: CrewRow[], isManual: boolean) => busyRows(rows).filter(r => isManual || r.phase !== 'started')

/** Шапка CREW: предсказанный шаг, многоточие пока он считается, пусто до первого предсказания. */
export const nextTitle = (cr: Crew): string => {
  if (cr.isLoading) return 'next: …'
  return cr.query === '' ? '' : `next: ${cr.query}`
}
