import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { CalendarDate } from '@internationalized/date'
import { i18nMock, instances, received, registerStubs, resetReceived } from './stubs'
import DateRangeGroup from '../../../src/runtime/components/Listing/Filters/Field/DateRangeGroup.vue'
import Drawer from '../../../src/runtime/components/Listing/Filters/Drawer.vue'

vi.mock('../../../src/runtime/composables/useListingI18n', () => i18nMock())

const field = {
  key: 'dates',
  kind: 'datetime-range-group',
  label: 'Dates',
  dateFields: [
    { field: 'created', label: 'Created' },
    { field: 'updated', label: 'Updated' },
  ],
}
// Time is frozen at local noon so the default range's end can't cross midnight.
const todayStr = '2026-06-15'
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 5, 15, 12))
})
afterEach(() => {
  vi.useRealTimers()
})
const march = { start: new CalendarDate(2026, 3, 1), end: new CalendarDate(2026, 3, 31) }
const applied = { created: { gte: '2026-01-01', lte: '2026-01-31' }, updated: null }

async function render(props: Record<string, any> = {}) {
  const emitted: Record<string, any>[] = []
  const app = createSSRApp({
    render: () => h(DateRangeGroup as any, {
      field,
      filters: {},
      onChange: (patch: Record<string, any>) => emitted.push(patch),
      ...props,
    }),
  })
  registerStubs(app)
  const html = await renderToString(app)
  return { emitted, html }
}

const button = (variant: string) => (instances.UButton ?? []).find(b => b.variant === variant)
const clearButton = () => button('ghost')
const applyButton = () => button('soft')

describe('DateRangeGroup drafting (the drawer)', () => {
  beforeEach(resetReceived)

  it('a picked field emits the default range it shows', async () => {
    const { emitted } = await render({ draft: true })
    received.URadioGroup!['onUpdate:modelValue']('created')
    expect(emitted).toEqual([{ created: { gte: '2025-01-01', lte: todayStr }, updated: null }])
  })

  it('renders Clear but no Apply', async () => {
    const { html } = await render({ draft: true, filters: applied })
    expect(html).toContain('listing.clear')
    expect(html).not.toContain('listing.apply')
    expect(clearButton()).toBeDefined()
    expect(applyButton()).toBeUndefined()
  })

  it.each(['UInputDate', 'UCalendar'])('a range edited in %s emits it', async (input) => {
    const { emitted } = await render({ draft: true, filters: applied })
    received[input]!['onUpdate:modelValue'](march)
    expect(emitted).toEqual([{ created: { gte: '2026-03-01', lte: '2026-03-31' }, updated: null }])
  })

  it('a half-chosen range emits nothing', async () => {
    const { emitted } = await render({ draft: true, filters: applied })
    received.UInputDate!['onUpdate:modelValue']({ start: march.start, end: undefined })
    received.UCalendar!['onUpdate:modelValue']({ start: march.start })
    received.UInputDate!['onUpdate:modelValue']({ start: undefined, end: march.end })
    expect(emitted).toEqual([])
  })

  it.each([null, { start: undefined, end: undefined }])('an emptied input (%s) emits every date field null', async (value) => {
    const { emitted } = await render({ draft: true, filters: applied })
    received.UInputDate!['onUpdate:modelValue'](value)
    expect(emitted).toEqual([{ created: null, updated: null }])
  })

  it('Clear emits every date field null', async () => {
    const { emitted } = await render({ draft: true, filters: applied })
    clearButton()!.onClick()
    expect(emitted).toEqual([{ created: null, updated: null }])
  })

  it('switching field nulls the old one and emits the new one\'s range', async () => {
    const { emitted } = await render({
      draft: true,
      filters: { created: applied.created, updated: { gte: '2026-02-01', lte: '2026-02-28' } },
    })
    received.URadioGroup!['onUpdate:modelValue']('updated')
    expect(emitted).toEqual([{ created: null, updated: { gte: '2026-02-01', lte: '2026-02-28' } }])
  })

  it('switching to a field with no stored range emits the default range for it', async () => {
    const { emitted } = await render({ draft: true, filters: applied })
    received.URadioGroup!['onUpdate:modelValue']('updated')
    expect(emitted).toEqual([{ created: null, updated: { gte: '2025-01-01', lte: todayStr } }])
  })
})

describe('DateRangeGroup in the sidebar (no draft)', () => {
  beforeEach(resetReceived)

  it('picking or editing emits nothing; Apply and Clear emit as before', async () => {
    const { emitted, html } = await render({ filters: applied })
    expect(html).toContain('listing.apply')
    expect(html).toContain('listing.clear')
    received.URadioGroup!['onUpdate:modelValue']('created')
    received.UInputDate!['onUpdate:modelValue'](march)
    expect(emitted).toEqual([])
    applyButton()!.onClick()
    expect(emitted).toEqual([{ created: { gte: '2026-03-01', lte: '2026-03-31' }, updated: null }])
    clearButton()!.onClick()
    expect(emitted).toEqual([
      { created: { gte: '2026-03-01', lte: '2026-03-31' }, updated: null },
      { created: null, updated: null },
    ])
  })
})

describe('Drawer with a date range group', () => {
  beforeEach(resetReceived)

  async function renderDrawer(filters: Record<string, any>) {
    const closed: any[] = []
    const app = createSSRApp({
      render: () => h(Drawer as any, {
        filters,
        config: [field],
        onClose: (result: any) => closed.push(result),
      }),
    })
    registerStubs(app)
    app.component('USlideover', defineComponent({
      setup: (_, { slots }) => () => h('div', [slots.body?.(), slots.footer?.()]),
    }))
    await renderToString(app)
    const footer = (instances.UButton ?? []).filter(b => b.label)
    const cancel = footer.find(b => b.label === 'listing.cancel')!
    const apply = footer.find(b => b.label === 'listing.apply')!
    return { closed, cancel, apply }
  }

  it('the drawer\'s Apply closes with the picked field\'s default range', async () => {
    const { closed, apply } = await renderDrawer({})
    received.URadioGroup!['onUpdate:modelValue']('created')
    apply.onClick()
    expect(closed).toEqual([{
      applied: true,
      filters: { created: { gte: '2025-01-01', lte: todayStr }, updated: null },
    }])
  })

  it('the drawer\'s Apply closes with an edited range', async () => {
    const { closed, apply } = await renderDrawer(applied)
    received.UInputDate!['onUpdate:modelValue'](march)
    apply.onClick()
    expect(closed).toEqual([{
      applied: true,
      filters: { created: { gte: '2026-03-01', lte: '2026-03-31' }, updated: null },
    }])
  })

  it('after a drafted Clear, Cancel closes unapplied with no filters and Apply closes with the cleared draft', async () => {
    const { closed, cancel, apply } = await renderDrawer(applied)
    clearButton()!.onClick()
    cancel.onClick()
    apply.onClick()
    expect(closed).toEqual([
      { applied: false, filters: null },
      { applied: true, filters: { created: null, updated: null } },
    ])
  })
})
