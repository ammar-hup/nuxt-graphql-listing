import { defineComponent, h, ref } from 'vue'
import type { App } from 'vue'

export const i18nMock = () => ({
  useListingI18n: () => ({ t: (key: string) => key, locale: ref('en') }),
})

/** Records the props each stubbed Nuxt UI component received. */
export const received: Record<string, Record<string, any>> = {}

function stub(name: string, props: string[] = []) {
  return defineComponent({
    name,
    props,
    setup(p, { slots, attrs }) {
      received[name] = { ...attrs, ...p }
      return () => h('div', { 'data-stub': name }, slots.default?.())
    },
  })
}

export function registerStubs(app: App) {
  app.component('UEmpty', stub('UEmpty', ['title', 'description', 'icon', 'avatar', 'actions']))
  app.component('UError', stub('UError', ['error', 'redirect', 'clear']))
  app.component('UPagination', stub('UPagination', ['page', 'total', 'itemsPerPage', 'size']))
  app.component('UIcon', stub('UIcon', ['name']))
  app.component('ListingLoading', stub('ListingLoading'))
  app.component('LazyListingFiltersAsidePanel', stub('LazyListingFiltersAsidePanel'))
}
