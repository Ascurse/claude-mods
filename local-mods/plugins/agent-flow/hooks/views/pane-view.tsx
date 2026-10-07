/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { RenderElement } from 'claude-code'

import type { Row } from '../model'
import type { Ui } from './kit'

export type PaneActions = {
  /** Expands or collapses the node (or the unlisted group) with this id. */
  onToggle: (id: string) => void
}

type TextStyle = { color?: string; dimColor?: boolean; bold?: boolean; wrap: 'truncate-end' }

function styleOf(row: Row): TextStyle {
  return {
    ...(row.color !== undefined ? { color: row.color } : {}),
    ...(row.dim ? { dimColor: true } : {}),
    ...(row.bold ? { bold: true } : {}),
    wrap: 'truncate-end',
  }
}

const GLYPHS = '●◐✓✕○'

// Цвет — только у значка состояния, остальной текст строки остаётся обычным
function splitAtGlyph(text: string): { prefix: string; glyph: string; rest: string } | undefined {
  const at = [...text].findIndex(ch => GLYPHS.includes(ch))
  if (at < 0) {
    return undefined
  }
  const chars = [...text]

  return { prefix: chars.slice(0, at).join(''), glyph: chars[at] ?? '', rest: chars.slice(at + 1).join('') }
}

/**
 * The pane's body: one line per row; an expandable row is a row Box holding
 * the line and a `[+]` / `[-]` Button whose press toggles the id.
 *
 * @param ui the surface's elements
 * @param rows the document
 * @param actions what a press does
 * @returns the tree
 */
export function paneView(ui: Ui, rows: readonly Row[], actions: PaneActions): RenderElement {
  const { Box, Text, Button } = ui

  return (
    <Box flexDirection="column">
      {rows.map(row => {
        const id = row.id

        if (id === undefined) {
          return <Text {...styleOf(row)}>{row.text}</Text>
        }

        const parts = row.color !== undefined ? splitAtGlyph(row.text) : undefined
        const body = parts
          ? [
              <Text>{parts.prefix}</Text>,
              <Text color={row.color}>{parts.glyph}</Text>,
              <Text {...styleOf({ ...row, color: undefined })}>{`${parts.rest} `}</Text>,
            ]
          : [<Text {...styleOf(row)}>{`${row.text} `}</Text>]

        return (
          <Box flexDirection="row">
            {...body}
            <Button key={`toggle:${id}`} plain onPress={() => actions.onToggle(id)}>
              {row.isExpanded ? '[-]' : '[+]'}
            </Button>
          </Box>
        )
      })}
    </Box>
  )
}
