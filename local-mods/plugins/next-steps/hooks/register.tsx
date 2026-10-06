import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Suggestion } from '../types'

const suggestions = atom({ plugin: 'next-steps', key: 'suggestions' } as const, [] as Suggestion[])
// What the person last asked, so the suggestions follow from it.
const lastPrompt = atom({ plugin: 'next-steps', key: 'lastPrompt' } as const, '')
// True while the suggestions for the last reply are being written.
const loading = atom({ plugin: 'next-steps', key: 'loading' } as const, false)
// Which suggestions are ticked, by index; Send sends them together.
const selected = atom({ plugin: 'next-steps', key: 'selected' } as const, [] as number[])
// Claude's last answer, kept so Send can write the prompt with full context.
const lastAnswer = atom({ plugin: 'next-steps', key: 'lastAnswer' } as const, '')
// True while Send is writing the prompt.
const composing = atom({ plugin: 'next-steps', key: 'composing' } as const, false)

// Writes the message Send submits: a real, specific request built from the ticked
// steps and the conversation, not a one-line restatement of the label.
const COMPOSE_SYSTEM =
  "You write the next message a user sends to an AI coding assistant. You are given the user's " +
  "last request, the assistant's last answer, and one or more next steps the user picked. Write " +
  'that message as the user, in the first person, ready to send. For each step: say exactly what to ' +
  'do, name the specific files, functions, commands, URLs or values from the conversation it ' +
  'involves, give any constraints or context the assistant needs, and say what done looks like. ' +
  'With several steps, number them in the order given and say to finish each before the next. ' +
  'Be concrete and concise: no greetings, no filler, no restating the whole conversation. Output ' +
  'only the message.'

const MAX = 6

// The model that writes the message Send submits. 'haiku' is near-instant; 'sonnet' is
// slower but more specific. Change this one line to switch.
const SEND_MODEL = 'haiku'

const SYSTEM =
  'You suggest what a user might ask a coding assistant to do next. Reply with only a JSON array ' +
  `of up to ${MAX} objects, each {"label": string}. ` +
  '"label" is the button text: imperative, at most 10 words and under 70 characters, specific to this conversation. ' +
  'Make the suggestions distinct from each other. ' +
  'If nothing useful follows, reply []. Write every label in Russian.'

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) + '…' : s)
const words = (s: string, max: number) => s.split(/\s+/).slice(0, max).join(' ')

// Страховка от слишком длинного ответа модели; узкое окно и так обрежет раскладка
const LABEL_CHARS = 80
function shortLabel(s: string): string {
  const w = s.replace(/\s+/g, ' ').trim()
  if (w.length <= LABEL_CHARS) return w
  const cut = w.slice(0, LABEL_CHARS - 1)
  const space = cut.lastIndexOf(' ')
  return (space > 12 ? cut.slice(0, space) : cut).replace(/[\s,.;:-]+$/, '') + '…'
}

function parseList(text: string): Suggestion[] {
  const m = text.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const list = JSON.parse(m[0])
    if (!Array.isArray(list)) return []
    return list
      .filter(x => x && typeof x.label === 'string' && x.label.trim() !== '')
      .map(x => {
        const label = shortLabel(x.label.trim())
        const prompt = typeof x.prompt === 'string' && x.prompt.trim() !== '' ? x.prompt.trim() : label
        return { label, prompt }
      })
      .slice(0, MAX)
  } catch {
    return []
  }
}

// ---------- cache: reuse a model reply when the exact same request repeats ----------

type CacheEntry = { text: string; at: number }

// A small LRU with expiry. The key is the whole request (model, instructions, the full
// prompt with its context, limits), so any change in context is a different key and a
// stale reply can never come back.
function makeCache(limit: number, ttlMs: number, now: () => number = () => Date.now()) {
  const entries = new Map<string, CacheEntry>()
  return {
    get(key: string): string | undefined {
      const hit = entries.get(key)
      if (!hit) return undefined
      if (now() - hit.at > ttlMs) {
        entries.delete(key)
        return undefined
      }
      entries.delete(key) // refresh its place as most recently used
      entries.set(key, hit)
      return hit.text
    },
    set(key: string, text: string) {
      entries.delete(key)
      entries.set(key, { text, at: now() })
      while (entries.size > limit) entries.delete(entries.keys().next().value as string)
    },
    get size() {
      return entries.size
    },
  }
}

type CompleteRequest = {
  model: string
  system: string
  prompt: string
  maxTokens: number
  effort: 'low'
  timeoutMs: number
}

// 40 replies, kept 30 minutes. Lives in memory: a reload starts it empty.
const replyCache = makeCache(40, 30 * 60_000)
const cacheStats = { hits: 0, modelCalls: 0 }

const cacheKey = (r: CompleteRequest) =>
  JSON.stringify([r.model, r.system, r.prompt, r.maxTokens, r.effort])

// Answers from the cache when the identical request was answered before; otherwise asks
// the model and keeps a good answer. Only answered replies are cached, never errors.
async function completeCached($: EngineInterface, req: CompleteRequest): Promise<string | undefined> {
  const key = cacheKey(req)
  const cached = replyCache.get(key)
  if (cached !== undefined) {
    cacheStats.hits++
    return cached
  }
  cacheStats.modelCalls++
  const r = await $.model.complete(req)
  if (!r.isAnswered || !r.text.trim()) return undefined
  replyCache.set(key, r.text)
  return r.text
}

async function suggest($: EngineInterface, answer: string) {
  const [asked] = await Promise.all([
    read($, lastPrompt),
    update($, lastAnswer, () => answer),
    update($, loading, () => true),
  ])
  // Labels only (the full prompt is written at Send), at low effort: a short, fast reply.
  const reply = await completeCached($, {
    model: 'haiku',
    system: SYSTEM,
    prompt: `User asked:\n${clip(asked, 3000)}\n\nAssistant replied:\n${clip(answer, 6000)}\n\nNext steps (JSON array):`,
    maxTokens: 350,
    effort: 'low',
    timeoutMs: 15000,
  })
  await Promise.all([
    update($, suggestions, () => (reply ? parseList(reply) : [])),
    update($, selected, () => []),
    update($, loading, () => false),
  ])
}

async function dismiss($: EngineInterface) {
  await Promise.all([update($, suggestions, () => []), update($, selected, () => [])])
}

async function toggle($: EngineInterface, i: number) {
  await update($, selected, l => (l.includes(i) ? l.filter(x => x !== i) : [...l, i].sort((a, b) => a - b)))
}

// Sends the ticked steps as one well-written prompt, composed by SEND_MODEL with the
// conversation as context; falls back to the plain labels if that fails.
async function sendSelected($: EngineInterface) {
  const [list, ticked, busy, asked, answer] = await Promise.all([
    read($, suggestions),
    read($, selected),
    read($, composing),
    read($, lastPrompt),
    read($, lastAnswer),
  ])
  const picked = ticked.flatMap(i => list[i] ?? [])
  if (picked.length === 0 || busy) return
  // Fallback if the writer fails: the labels as a plain list.
  const [first] = picked
  let text =
    picked.length === 1 && first
      ? first.label
      : 'Please do the following, in this order:\n' + picked.map((s, i) => `${i + 1}. ${s.label}`).join('\n')
  await update($, composing, () => true)
  try {
    const steps = picked.map((s, i) => `${i + 1}. ${s.label}`).join('\n')
    const reply = await completeCached($, {
      model: SEND_MODEL,
      system: COMPOSE_SYSTEM,
      prompt:
        `User's last request:\n${clip(asked, 4000)}\n\n` +
        `Assistant's last answer:\n${clip(answer, 10000)}\n\n` +
        `Next steps the user picked, in order:\n${steps}\n\nThe message:`,
      maxTokens: 900,
      effort: 'low',
      timeoutMs: 25000,
    })
    if (reply) text = reply.trim()
  } catch {
    // keep the fallback
  }
  await Promise.all([
    update($, composing, () => false),
    update($, suggestions, () => []),
    update($, selected, () => []),
  ])
  await $.prompt.submit({ text, asUser: true })
}


// ---------- /mod-bench: timing measurements, run on demand ----------

// Scratch values the storage benchmark writes, so it never touches real state.
const benchA = atom({ plugin: 'next-steps', key: 'benchA' } as const, 0)
const benchB = atom({ plugin: 'next-steps', key: 'benchB' } as const, 0)
const benchC = atom({ plugin: 'next-steps', key: 'benchC' } as const, 0)

// The module's own clock: no round-trip to the host, so short timings stay honest.
const tick = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// How long each real message waited inside this mod before going out, newest last.
const submitWaits: number[] = []

type Stat = { runs: number; min: number; median: number; mean: number; max: number }
function stat(xs: number[]): Stat {
  const a = [...xs].sort((x, y) => x - y)
  const r = (n: number) => Math.round(n * 100) / 100
  return {
    runs: a.length,
    min: r(a[0] ?? 0),
    median: r(a[Math.floor((a.length - 1) / 2)] ?? 0),
    mean: r(a.reduce((x, y) => x + y, 0) / (a.length || 1)),
    max: r(a[a.length - 1] ?? 0),
  }
}

async function timeIt(n: number, fn: () => Promise<unknown>): Promise<Stat> {
  const xs: number[] = []
  for (let i = 0; i < n; i++) {
    const t0 = tick()
    await fn()
    xs.push(tick() - t0)
  }
  return stat(xs)
}

async function runBench($: EngineInterface): Promise<string> {
  const N = 20
  const bump = (n: number) => n + 1
  const writesSequential = await timeIt(N, async () => {
    await update($, benchA, bump)
    await update($, benchB, bump)
    await update($, benchC, bump)
  })
  const writesBatched = await timeIt(N, () =>
    Promise.all([update($, benchA, bump), update($, benchB, bump), update($, benchC, bump)]),
  )
  const readsSequential = await timeIt(N, async () => {
    await read($, suggestions)
    await read($, selected)
    await read($, composing)
    await read($, loading)
  })
  const readsBatched = await timeIt(N, () =>
    Promise.all([read($, suggestions), read($, selected), read($, composing), read($, loading)]),
  )

  // Model calls on the current conversation: labels, then Send written by each model.
  const [asked, answer, list] = await Promise.all([read($, lastPrompt), read($, lastAnswer), read($, suggestions)])
  const labels = list.filter(x => x && typeof x === 'object' && x.label).slice(0, 2).map(x => x.label)
  const steps = (labels.length ? labels : ['Summarize what changed in this session'])
    .map((l, i) => `${i + 1}. ${l}`)
    .join('\n')
  const composeInput =
    `User's last request:\n${clip(asked, 4000)}\n\n` +
    `Assistant's last answer:\n${clip(answer, 10000)}\n\n` +
    `Next steps the user picked, in order:\n${steps}\n\nThe message:`
  const timed = async (model: string, system: string, prompt: string, maxTokens: number) => {
    const t0 = tick()
    const r = await $.model.complete({ model, system, prompt, maxTokens, effort: 'low', timeoutMs: 60000 })
    return {
      model,
      ms: Math.round(tick() - t0),
      outputTokens: r.usage.output_tokens,
      text: r.isAnswered ? r.text : `(no reply: ${r.reason})`,
    }
  }
  const labelsCall = await timed(
    'haiku',
    SYSTEM,
    `User asked:\n${clip(asked, 3000)}\n\nAssistant replied:\n${clip(answer, 6000)}\n\nNext steps (JSON array):`,
    350,
  )
  const sendHaiku = await timed('haiku', COMPOSE_SYSTEM, composeInput, 900)
  const sendSonnet = await timed('sonnet', COMPOSE_SYSTEM, composeInput, 900)

  const result = {
    measuredAt: new Date().toISOString(),
    storage: { writesSequential, writesBatched, readsSequential, readsBatched },
    realMessagesWaitedInMod: stat(submitWaits),
    cache: { entries: replyCache.size, hits: cacheStats.hits, modelCalls: cacheStats.modelCalls },
    models: { labels: labelsCall, sendHaiku, sendSonnet },
    stepsUsed: steps,
  }
  await $.fs.write(`${$.plugin.root}/bench.json`, JSON.stringify(result, null, 2))
  const ms = (x: Stat) => `${x.median} ms median`
  return [
    'mod-bench done (full results in next-steps/bench.json):',
    `  3 writes, one at a time: ${ms(writesSequential)}  ·  batched: ${ms(writesBatched)}`,
    `  4 reads, one at a time: ${ms(readsSequential)}  ·  batched: ${ms(readsBatched)}`,
    `  cache: ${cacheStats.hits} hits, ${cacheStats.modelCalls} model calls, ${replyCache.size} entries`,
    `  Haiku labels: ${labelsCall.ms} ms  ·  Send with Haiku: ${sendHaiku.ms} ms  ·  Send with Sonnet: ${sendSonnet.ms} ms`,
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'mod-bench', description: 'Time next-steps storage and model calls' })
    return result
  })

  on('command.run', { command: 'mod-bench' }, async $ => ({ text: await runBench($) }))

  on('prompt.submit', async ($, e, next) => {
    const t0 = tick()
    // A new request makes the old suggestions stale.
    if (!e.turnId) {
      // In the background: the message goes out without waiting on these.
      void Promise.all([
        update($, lastPrompt, () => e.text),
        update($, suggestions, () => []),
        update($, selected, () => []),
      ])
    }
    submitWaits.push(tick() - t0)
    if (submitWaits.length > 50) submitWaits.shift()
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId && e.reason === 'answer' && e.answer.trim()) {
      void suggest($, e.answer).catch(() => update($, loading, () => false))
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)
    if (e.props.hasSurvey) return inner
    // Skip anything saved in an older format (plain strings) before a reload.
    const [saved, picked, isComposing, isLoading] = await Promise.all([
      read($, suggestions),
      read($, selected),
      read($, composing),
      read($, loading),
    ])
    const list = saved.filter(x => x && typeof x === 'object' && x.label)
    const { Box, Text, Button } = $.ui.resolve(e)

    // Пустая полоса не рисуется: шаги появляются, только когда они есть
    if (e.props.isWorking || isLoading || list.length === 0) return inner

    const item = (s: Suggestion, i: number) => (
      <Button
        key={`n${i}`}
        plain
        hotkey={String(i + 1)}
        label={`${picked.includes(i) ? '●' : '○'} ${s.label}`}
        dimColor={!picked.includes(i)}
        onPress={() => toggle($, i)}
      />
    )
    // Two columns, filled down then across: 1-3 left, 4-6 right.
    const half = Math.ceil(list.length / 2)
    // Полосы других модов (bead-band) — отдельной строкой сверху: в одной строке они отнимали ширину у шагов
    return (
      <Box flexDirection="column" alignItems="stretch" gap={1}>
        <Box>{inner}</Box>
        <Box flexDirection="column" alignItems="flex-start" gap={1} minWidth={0} overflow="hidden">
          <Box flexDirection="row" alignItems="flex-start" columnGap={2}>
            <Box flexDirection="column" alignItems="flex-start" gap={1}>
              {list.slice(0, half).map((s, i) => item(s, i))}
            </Box>
            <Box flexDirection="column" alignItems="flex-start" gap={1}>
              {list.slice(half).map((s, i) => item(s, i + half))}
            </Box>
          </Box>
          {/* Footer: what is ticked, a way to undo it, and the action, side by side. */}
          <Box flexDirection="row" alignItems="center" gap={1}>
            {isComposing ? (
              <Text dimColor>Пишу запрос…</Text>
            ) : (
              <Box flexDirection="row" alignItems="center" gap={2}>
                {picked.length > 0 ? (
                  <Box flexDirection="row" alignItems="center" gap={2}>
                    <Button
                      key="send"
                      label={picked.length === 1 ? 'Отправить' : `Отправить ${picked.length}`}
                      variant="primary"
                      onPress={() => sendSelected($)}
                    />
                    <Button key="clear" label="Сбросить" plain dimColor onPress={() => update($, selected, () => [])} />
                  </Box>
                ) : null}
                <Box flexDirection="row" alignItems="center" gap={1}>
                  <Text dimColor>{`1–${list.length} выбрать ·`}</Text>
                  <Button key="dismiss" label="скрыть" plain hotkey="0" dimColor onPress={() => dismiss($)} />
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    )
  })
}
