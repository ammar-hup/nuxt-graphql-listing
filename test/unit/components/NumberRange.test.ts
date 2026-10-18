import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { i18nMock, instances, received, registerStubs, resetReceived } from './stubs'
import NumberRange from '../../../src/runtime/components/Listing/Filters/Field/NumberRange.vue'
import Drawer from '../../../src/runtime/components/Listing/Filters/Drawer.vue'
import Renderer from '../../../src/runtime/components/Listing/Filters/Renderer.vue'

vi.mock('../../../src/runtime/composables/useListingI18n', () => i18nMock())

async function render(props: Record<string, any> = {}) {
  const emitted: Record<string, any>[] = []
  const app = createSSRApp({
    render: () => h(NumberRange as any, {
      field: { key: 'price', field: 'price', kind: 'decimal-range', label: 'Price' },
      filters: {},
      onChange: (patch: Record<string, any>) => emitted.push(patch),
      ...props,
    }),
  })
  registerStubs(app)
  const html = await renderToString(app)
  const [minBox, maxBox] = instances.UInput ?? []
  return { emitted, html, minBox: minBox!, maxBox: maxBox! }
}

let probeAttrs: Record<string, any> | null = null
const Probe = defineComponent({
  inheritAttrs: false,
  setup: (_, { attrs }) => {
    probeAttrs = { ...attrs }
    return () => h('div')
  },
})

const buttons = () => (instances.UButton ?? []).length

describe('NumberRange', () => {
  beforeEach(resetReceived)

  it('drafting: a typed box emits at once, and no Apply or Clear is rendered', async () => {
    const { emitted, html, minBox } = await render({ draft: true, facetMin: 0, facetMax: 1000 })
    expect(buttons()).toBe(0)
    expect(html).not.toContain('listing.apply')
    expect(html).not.toContain('listing.clear')
    minBox['onUpdate:modelValue'](12.5)
    expect(emitted).toEqual([{ price: { gte: 12.5 } }])
  })

  it('drafting: a moved thumb emits only that end', async () => {
    const { emitted } = await render({ draft: true, facetMin: 0, facetMax: 1000 })
    received.USlider!['onUpdate:modelValue']([0, 400])
    expect(emitted).toEqual([{ price: { lte: 400 } }])
  })

  it('drafting: a thumb moved after an earlier edit keeps the drafted bound', async () => {
    const { emitted } = await render({
      draft: true, facetMin: 0, facetMax: 1000, filters: { price: { gte: 12.5 } },
    })
    received.USlider!['onUpdate:modelValue']([12.5, 400])
    expect(emitted).toEqual([{ price: { gte: 12.5, lte: 400 } }])
  })

  it('drafting: emptying both boxes emits a cleared range', async () => {
    const { emitted, minBox, maxBox } = await render({
      draft: true, facetMin: 0, facetMax: 1000, filters: { price: { gte: 5, lte: 10 } },
    })
    minBox['onUpdate:modelValue']('')
    maxBox['onUpdate:modelValue']('')
    expect(emitted).toEqual([{ price: { lte: 10 } }, { price: null }])
  })

  it('sidebar: typing emits nothing; Apply and Clear emit as before', async () => {
    const { emitted, minBox } = await render({ facetMin: 0, facetMax: 1000 })
    minBox['onUpdate:modelValue'](12.5)
    expect(emitted).toEqual([])
    const [clear, apply] = instances.UButton!
    apply!.onClick()
    expect(emitted).toEqual([{ price: { gte: 12.5 } }])
    clear!.onClick()
    expect(emitted).toEqual([{ price: { gte: 12.5 } }, { price: null }])
  })

  it.each([[0, 0], [50, 10]])('no usable range (%s–%s): no slider, unclamped boxes, bounds still emit', async (facetMin, facetMax) => {
    const { emitted, html, minBox, maxBox } = await render({ draft: true, facetMin, facetMax })
    expect(html).not.toContain('data-stub="USlider"')
    for (const box of [minBox, maxBox]) {
      expect(box.min).toBeUndefined()
      expect(box.max).toBeUndefined()
      expect(box.placeholder).toBeUndefined()
    }
    maxBox['onUpdate:modelValue'](30)
    expect(emitted).toEqual([{ price: { lte: 30 } }])
  })

  it('no usable range in the sidebar: typed bounds still apply', async () => {
    const { emitted, minBox } = await render({ facetMin: 0, facetMax: 0 })
    minBox['onUpdate:modelValue'](7)
    instances.UButton![1]!.onClick()
    expect(emitted).toEqual([{ price: { gte: 7 } }])
  })

  it('facet unknown: slider on 0–1000', async () => {
    const { html, minBox } = await render()
    expect(html).toContain('data-stub="USlider"')
    expect(received.USlider).toMatchObject({ min: 0, max: 1000, modelValue: [0, 1000] })
    expect(minBox).toMatchObject({ min: 0, max: 1000 })
  })
})

describe('Drawer with a number range field', () => {
  beforeEach(() => {
    resetReceived()
    probeAttrs = null
  })

  it.each(['decimal-range', 'int-range'])('%s: the drawer\'s Apply closes with the range set in it; only the range gets draft', async (kind) => {
    const closed: any[] = []
    const app = createSSRApp({
      render: () => h(Drawer as any, {
        filters: {},
        config: [
          { key: 'price', field: 'price', kind, label: 'Price' },
          { key: 'x', field: 'x', kind: 'custom', component: Probe },
        ],
        facets: { price: { min: 0, max: 1000 } },
        onClose: (result: any) => closed.push(result),
      }),
    })
    registerStubs(app)
    app.component('USlideover', defineComponent({
      setup: (_, { slots }) => () => h('div', [slots.body?.(), slots.footer?.()]),
    }))
    await renderToString(app)
    expect(probeAttrs).toMatchObject({ field: { field: 'x' } })
    expect(probeAttrs).not.toHaveProperty('draft')
    const [, apply] = instances.UButton!
    expect(apply!.label).toBe('listing.apply')
    instances.UInput![0]!['onUpdate:modelValue'](12.5)
    received.USlider!['onUpdate:modelValue']([12.5, 400])
    apply!.onClick()
    expect(closed).toEqual([{ applied: true, filters: { price: { gte: 12.5, lte: 400 } } }])
  })
})

describe('Renderer without draft (the sidebar)', () => {
  beforeEach(resetReceived)

  it('a decimal range shows Apply and Clear; typing emits nothing until Apply', async () => {
    const changes: any[] = []
    const app = createSSRApp({
      render: () => h(Renderer as any, {
        filters: {},
        config: [{ key: 'price', field: 'price', kind: 'decimal-range', label: 'Price' }],
        facets: { price: { min: 0, max: 1000 } },
        onChange: (patch: any) => changes.push(patch),
      }),
    })
    registerStubs(app)
    const html = await renderToString(app)
    expect(html).toContain('listing.apply')
    expect(html).toContain('listing.clear')
    instances.UInput![0]!['onUpdate:modelValue'](12.5)
    expect(changes).toEqual([])
    instances.UButton![1]!.onClick()
    expect(changes).toEqual([{ price: { gte: 12.5 } }])
  })
})
