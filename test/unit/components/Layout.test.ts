import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { i18nMock, received, registerStubs } from './stubs'
import Layout from '../../../src/runtime/components/Listing/Layout.vue'

vi.mock('../../../src/runtime/composables/useListingI18n', () => i18nMock())
vi.mock('../../../src/runtime/components/Listing/Topbar.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ name: 'Topbar', setup: () => () => h('div') }) }
})

const base = {
  filtersConfig: [],
  facets: null,
  sortConfig: [],
  sort: null,
  total: 0,
  limit: 20,
  offset: 0,
  items: [],
  loading: false,
  error: null,
}

async function render(props: Record<string, any>) {
  const emitted = { filters: [] as any[], offset: [] as any[] }
  const app = createSSRApp({
    render: () => h(Layout as any, {
      ...base,
      ...props,
      'onUpdate:filters': (v: any) => emitted.filters.push(v),
      'onUpdate:offset': (v: any) => emitted.offset.push(v),
    }),
  })
  registerStubs(app)
  const html = await renderToString(app)
  return { emitted, html }
}

describe('Listing Layout', () => {
  beforeEach(() => {
    for (const k of Object.keys(received)) Reflect.deleteProperty(received, k)
  })

  it('Reset with filters emits one update:filters clearing them, and no update:offset', async () => {
    const { emitted } = await render({ filters: { categoryId: 'c', search: '' } })
    received.UEmpty!.actions[0].onClick()
    expect(emitted.filters).toEqual([{ categoryId: null }])
    expect(emitted.offset).toEqual([])
  })

  it('Reset with no filters set emits only update:offset 0', async () => {
    const { emitted } = await render({ filters: { categoryId: null } })
    received.UEmpty!.actions[0].onClick()
    expect(emitted.filters).toEqual([])
    expect(emitted.offset).toEqual([0])
  })

  it('the default Retry emits update:offset 0', async () => {
    const { emitted } = await render({ filters: {}, error: new Error('boom') })
    expect(received.UError!.error).toEqual({ message: 'boom' })
    received.UError!.clear.onClick()
    expect(emitted.offset).toEqual([0])
    expect(received.UEmpty).toBeUndefined()
  })

  it('hides pagination while an error is shown, even with kept items', async () => {
    const { html } = await render({ filters: {}, error: new Error('boom'), items: [{ id: 1 }], total: 1 })
    expect(received.UPagination).toBeUndefined()
    expect(html).not.toContain('listing.results')
  })

  it('shows pagination with items and no error', async () => {
    await render({ filters: {}, items: [{ id: 1 }], total: 1 })
    expect(received.UPagination).toBeDefined()
  })

  it('pagination emits update:offset only when the page changes', async () => {
    const { emitted } = await render({ filters: {}, items: [{ id: 1 }], total: 50, offset: 20 })
    const setPage = received.UPagination!['onUpdate:page']
    setPage(2)
    expect(emitted.offset).toEqual([])
    setPage(3)
    expect(emitted.offset).toEqual([40])
  })
})
