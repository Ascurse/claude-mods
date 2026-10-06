import { expect, test } from 'claude-code/testing'

// В среде тестов таймер есть, а в библиотеке типов es2023 его нет
declare function setTimeout(callback: (value: unknown) => void, ms: number): unknown

const LABELS = '[{"label":"Прогнать все тесты"},{"label":"Обновить CHANGELOG"},{"label":"Открыть MR"}]'

async function mountWithSuggestions($: any, on: any, surface: 'terminal' | 'desktop', asked: string[] = []) {
  on('model.complete', async (_$: unknown, e: { system: string }) => {
    asked.push(e.system)
    return { value: { isAnswered: true, text: LABELS, usage: { input_tokens: 1, output_tokens: 1 } } } as never
  })
  on('ui.render', async ($$: any, e: any) => { const { Box } = $$.ui.resolve(e); return h(Box, { key: 'engine' }) as never })
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }) as never)
  await $.turn.complete({ reason: 'answer', answer: 'Готово.' } as never)
  const ui = await $.ui.mount({ plugin: 'next-steps', surface, component: 'AbovePrompt', props: {} } as never)
  for (let i = 0; i < 50 && !(await ui.find({ type: 'Button', text: /Открыть MR/ })); i++) await new Promise(r => setTimeout(r, 10))
  return ui
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: steps are digit-hotkey buttons with ○, ticking turns ● and shows Russian controls`, async ($, on) => {
    const ui = await mountWithSuggestions($, on, surface)
    const first = await ui.find({ type: 'Button', text: /Прогнать все тесты/ })
    expect(first?.props.hotkey).toBe('1')
    expect(first?.props.label).toBe('○ Прогнать все тесты')
    expect(await ui.find({ type: 'Button', text: /☐|☑/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '1–3 выбрать ·' })).toBeDefined()
    const hide = await ui.find({ type: 'Button', text: 'скрыть' })
    expect(hide?.props.hotkey).toBe('0')

    await ui.press({ key: first!.key! } as never)
    expect((await ui.find({ type: 'Button', text: /Прогнать все тесты/ }))?.props.label).toBe('● Прогнать все тесты')
    expect(await ui.find({ type: 'Button', text: 'Отправить' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: 'Сбросить' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Tick|selected|Send/ })).toBeUndefined()
    await ui.unmount()
  })
}

test('0 hides the steps and the band draws nothing of its own', async ($, on) => {
  const ui = await mountWithSuggestions($, on, 'terminal')
  const hide = await ui.find({ type: 'Button', text: 'скрыть' })
  await ui.press({ key: hide!.key! } as never)
  expect(await ui.find({ type: 'Button', text: /Открыть MR/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /шаг|step/i })).toBeUndefined()
  await ui.unmount()
})

test('nothing of its own is drawn while Claude works', async ($, on) => {
  on('ui.render', async ($$: any, e: any) => { const { Box } = $$.ui.resolve(e); return h(Box, { key: 'engine' }) as never })
  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'desktop', component: 'AbovePrompt', props: { isWorking: true } } as never)
  expect(await ui.findAll({ type: 'Text' })).toHaveLength(0)
  await ui.unmount()
})

test('the model is asked for labels in Russian', async ($, on) => {
  const asked: string[] = []
  const ui = await mountWithSuggestions($, on, 'terminal', asked)
  expect(asked.some(s => /Russian/.test(s))).toBe(true)
  await ui.unmount()
})

test('a long Russian label is shown whole, up to 70 characters', async ($, on) => {
  const label = 'Проверить оценку 38% первых платежей в отчёте для новичков за сентябрь'
  on('model.complete', async () =>
    ({ value: { isAnswered: true, text: JSON.stringify([{ label }]), usage: { input_tokens: 1, output_tokens: 1 } } }) as never)
  on('ui.render', async ($$: any, e: any) => { const { Box } = $$.ui.resolve(e); return h(Box, { key: 'engine' }) as never })
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }) as never)
  await $.turn.complete({ reason: 'answer', answer: 'Готово.' } as never)
  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', component: 'AbovePrompt', props: {} } as never)
  for (let i = 0; i < 50 && !(await ui.find({ type: 'Button', text: /Проверить/ })); i++) await new Promise(r => setTimeout(r, 10))
  expect((await ui.find({ type: 'Button', text: /Проверить/ }))?.props.label).toBe(`○ ${label}`)
  await ui.unmount()
})
