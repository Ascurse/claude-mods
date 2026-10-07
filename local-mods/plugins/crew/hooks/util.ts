// Мелкие помощники, скопированные из flightdeck (hooks/core.ts): мод не импортирует чужие модули.

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A stored object merged over its defaults, so a value saved under an older shape still reads. */
export const normalize = <T extends object>(def: T, stored: unknown): T =>
  isObject(stored) ? ({ ...def, ...stored } as T) : def

/** A stored list, or empty when what is stored is not a list. */
export const listOf = <T>(stored: unknown): T[] => (Array.isArray(stored) ? (stored as T[]) : [])

export const shorten = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return n <= 0 ? '' : one.length > n ? `${one.slice(0, Math.max(0, n - 1)).trimEnd()}…` : one
}

// ---------------------------------------------------------------- config

export type Palette = 'theme' | 'pastel'

export type Config = {
  crewRun: 'draft' | 'direct'
  palette: Palette
  autoOpen: boolean
}

/** The plugin's `/config` values, read leniently: anything malformed falls back to the default. */
export const parseConfig = (o: Readonly<Record<string, unknown>>): Config => {
  const str = (k: string, d: string) => (typeof o[k] === 'string' && o[k] !== '' ? (o[k] as string) : d)
  return {
    crewRun: str('crewRun', 'draft') === 'direct' ? 'direct' : 'draft',
    palette: str('palette', 'theme') === 'pastel' ? 'pastel' : 'theme',
    autoOpen: typeof o.autoOpen === 'boolean' ? o.autoOpen : true,
  }
}

// ---------------------------------------------------------------- palette

export type Colors = Record<'agent' | 'cleared' | 'amber' | 'faint', string>

/**
 * `theme` names the person's own theme colours (they follow light, dark and colour-blind themes);
 * `pastel` is fixed hex tuned for dark terminals.
 */
export const PALETTES: Record<Palette, Colors> = {
  theme: { agent: 'suggestion', cleared: 'permission', amber: 'warning', faint: 'subtle' },
  pastel: { agent: '#93c5fd', cleared: '#5eead4', amber: '#fcd34d', faint: '#3f4654' },
}

// ---------------------------------------------------------------- hand-back

/** A background subagent's report that opens a turn as `<agent-message from="…">`; null for any other text. */
export const handbackOf = (text: string): { from: string; body: string } | null => {
  const from = /^\s*<agent-message\s+from="([^"]+)"/.exec(text)?.[1]
  if (!from) return null
  const afterHeader = text.split(/The report follows:\s*\n/)[1]
  const rest = afterHeader ?? text.replace(/^\s*<agent-message[^>]*>/, '')
  const body =
    rest
      .split('\n')
      .map(l => l.trim())
      .find(l => l && !l.startsWith('[') && !l.startsWith('<') && !l.startsWith('</')) ?? ''
  return body ? { from, body } : null
}
