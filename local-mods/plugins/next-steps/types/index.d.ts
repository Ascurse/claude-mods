/** A suggested next step: the short button label and the full prompt it sends. */
export type Suggestion = { label: string; prompt: string }

declare module 'claude-code' {
  interface PluginState {
    'next-steps': {
      suggestions: Suggestion[]
      lastPrompt: string
      lastAnswer: string
      loading: boolean
      composing: boolean
      selected: number[]
      benchA: number
      benchB: number
      benchC: number
    }
  }
}
