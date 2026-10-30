---
name: baseline-ui
description: Quickly deslop UI code by fixing interaction states, animation defaults, typography, layout and visual noise. Use when the interface needs a fast cleanup or polish pass, or when reviewing AI-generated UI code.
disable-model-invocation: true
---

# Baseline UI

An opinionated baseline that prevents AI-generated interface slop. Stack-agnostic:
rules are stated in CSS/behaviour terms, with Tailwind utilities in parentheses where
the project uses Tailwind. In a MUI / styled-components / CSS-modules project apply the
same rule through that project's own mechanism.

## How to use

- `/baseline-ui`
  Apply these constraints to any UI work in this conversation.

- `/baseline-ui <file>`
  Review the file against all constraints below and output:
  - violations (quote the exact line/snippet)
  - why it matters (1 short sentence)
  - a concrete fix (code-level suggestion)

## Tool boundaries

- MUST use the project's existing component primitives, styling approach and design tokens first
- Never introduce a new UI library, styling system or animation library to satisfy a rule here
- Never mix primitive systems within the same interaction surface
- Keep diffs minimal and scoped to the issue found; do not rewrite large parts of the UI

## Components

- MUST use accessible primitives for anything with keyboard or focus behaviour
- Never rebuild keyboard or focus behaviour by hand unless explicitly requested
- MUST add an accessible name (`aria-label`) to icon-only buttons

## Interaction

- MUST use a confirmation dialog for destructive or irreversible actions
- SHOULD use structural skeletons for loading states, not a bare spinner over the whole page
- Never size full-height surfaces with `100vh` — use `100dvh` (`h-dvh`, not `h-screen`)
- MUST respect `safe-area-inset` for fixed elements
- MUST show errors next to where the action happens, not only in a global toast
- Never block paste in `input` or `textarea` elements

## Animation

- Never add animation unless it is explicitly requested
- MUST animate only compositor props (`transform`, `opacity`)
- Never animate layout properties (`width`, `height`, `top`, `left`, `margin`, `padding`)
- SHOULD avoid animating paint properties (`background`, `color`) except for small, local UI (text, icons)
- SHOULD use `ease-out` on entrance
- Never exceed `200ms` for interaction feedback
- MUST pause looping animations when off-screen
- SHOULD respect `prefers-reduced-motion`
- Never introduce custom easing curves unless explicitly requested
- SHOULD avoid animating large images or full-screen surfaces

For a deeper pass on animation performance see the `fixing-motion-performance` skill.

## Typography

- MUST balance headings and prettify body copy (`text-wrap: balance` / `pretty`, i.e. `text-balance` / `text-pretty`)
- MUST use tabular figures for numeric data (`font-variant-numeric: tabular-nums`, i.e. `tabular-nums`)
- SHOULD truncate or clamp text in dense UI (`text-overflow` / `-webkit-line-clamp`, i.e. `truncate` / `line-clamp-*`)
- Never modify `letter-spacing` unless explicitly requested

## Layout

- MUST use a fixed `z-index` scale — no arbitrary one-off values
- SHOULD size square elements with a single dimension utility instead of duplicating width and height

## Performance

- Never animate large `blur()` or `backdrop-filter` surfaces
- Never apply `will-change` outside an active animation
- Never use `useEffect` for anything that can be expressed as render logic

## Design

- Never use gradients unless explicitly requested
- Never use purple or multicolor gradients
- Never use glow effects as primary affordances
- SHOULD use the project's existing shadow scale unless explicitly requested
- MUST give empty states one clear next action
- SHOULD limit accent color usage to one per view
- SHOULD use existing theme color tokens before introducing new ones

---

Source: [ibelick/ui-skills](https://github.com/ibelick/ui-skills/blob/main/skills/baseline-ui/SKILL.md) (MIT), adapted 2026-08-02 — the original `Stack` section (Tailwind + `motion/react` + Base UI, hard requirements) was removed as incompatible with our projects; the remaining rules were restated stack-agnostically.
