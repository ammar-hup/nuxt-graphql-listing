import { defineComponent, h, ref } from 'vue'
import type { App } from 'vue'

export const i18nMock = () => ({
  useListingI18n: () => ({ t: (key: string) => key, locale: ref('en') }),
})

/** Records the props each stubbed Nuxt UI component received (the last instance). */
export const received: Record<string, Record<string, any>> = {}
/** Every instance's props, in render order, for components rendered more than once. */
export const instances: Record<string, Record<string, any>[]> = {}

export function resetReceived() {
  for (const k of Object.keys(received)) Reflect.deleteProperty(received, k)
  for (const k of Object.keys(instances)) Reflect.deleteProperty(instances, k)
}

/** `allSlots` renders named slots too (e.g. UInputDate's #trailing, UPopover's #content). */
function stub(name: string, props: string[] = [], allSlots = false) {
  return defineComponent({
    name,
    props,
    setup(p, { slots, attrs }) {
      received[name] = { ...attrs, ...p }
      ;(instances[name] ??= []).push(received[name])
      return () => h('div', { 'data-stub': name },
        allSlots ? Object.values(slots).flatMap(s => s?.() ?? []) : slots.default?.())
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
  app.component('UFormField', stub('UFormField', ['label']))
  app.component('UInput', stub('UInput', ['modelValue', 'type', 'size', 'placeholder', 'min', 'max']))
  app.component('USlider', stub('USlider', ['modelValue', 'min', 'max']))
  app.component('UButton', stub('UButton', ['variant', 'color', 'size', 'label']))
  app.component('URadioGroup', stub('URadioGroup', ['modelValue', 'items']))
  app.component('UInputDate', stub('UInputDate', ['modelValue', 'range'], true))
  app.component('UPopover', stub('UPopover', [], true))
  app.component('UCalendar', stub('UCalendar', ['modelValue', 'range', 'numberOfMonths']))
}
