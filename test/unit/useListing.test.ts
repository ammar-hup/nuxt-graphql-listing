import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { effectScope, reactive } from 'vue'
import { useListing } from '../../src/runtime/composables/useListing'
import { clearedFilters } from '../../src/runtime/utils/filters'

const nav = vi.hoisted(() => ({ route: null as any, replace: null as any }))

vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => ({ replace: nav.replace }),
}))

// Like vue-router: the route updates a microtask later, with string values (arrays kept).
function resetRouter(query: Record<string, any> = {}) {
  nav.route = reactive({ query, hash: '' })
  nav.replace = vi.fn(async ({ query: next }: { query: Record<string, any> }) => {
    await Promise.resolve()
    nav.route.query = Object.fromEntries(
      Object.entries(next).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : String(v)]),
    )
  })
}

resetRouter()
beforeEach(() => resetRouter())

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

const ok = (items: any[], total = items.length, facets: any = { categoryId: [] }) => ({
  data: { list: { items, total, facets } },
})

function fakeClient(responses: any[]) {
  const query = vi.fn(async () => {
    const next = responses.length > 1 ? responses.shift() : responses[0]
    if (next instanceof Error) throw next
    return next
  })
  return { query }
}

function setup(responses: any[], options: Record<string, any> = {}) {
  const client = fakeClient(responses)
  // Inside a scope, as in a component: outside one the search applies at once.
  const listing = effectScope().run(() =>
    useListing({ query: {} as any, client: client as any, dataPath: 'list', ...options }),
  )!
  return { client, listing }
}

const lastInput = (client: ReturnType<typeof fakeClient>) =>
  (client.query.mock.calls.at(-1) as any)[0].variables.input

describe('useListing errors', () => {
  beforeEach(() => vi.clearAllMocks())

  it('treats an Apollo 4 result error as a failure', async () => {
    const error = Object.assign(new Error('joined'), { errors: [{ message: 'Unknown field categoryId' }] })
    const { listing } = setup([{ data: null, error }])
    await flush()
    expect(listing.error.value?.message).toBe('Unknown field categoryId')
    expect(listing.loading.value).toBe(false)
  })

  it('falls back to the error message when it has no errors array', async () => {
    const { listing } = setup([{ data: undefined, error: new Error('Network down') }])
    await flush()
    expect(listing.error.value?.message).toBe('Network down')
  })

  it('treats an Apollo 3 errors array as a failure', async () => {
    const { listing } = setup([{ data: { list: null }, errors: [{ message: 'Bad price' }] }])
    await flush()
    expect(listing.error.value?.message).toBe('Bad price')
    expect(listing.loading.value).toBe(false)
  })

  it('ignores an empty errors array', async () => {
    const { listing } = setup([{ ...ok([{ id: 1 }]), errors: [] }])
    await flush()
    expect(listing.error.value).toBeNull()
    expect(listing.items.value).toEqual([{ id: 1 }])
  })

  it('keeps the last good data when a later fetch fails', async () => {
    const facets = { categoryId: [{ id: 'c' }] }
    const { listing } = setup([ok([{ id: 1 }], 7, facets), { data: null, errors: [{ message: 'boom' }] }])
    await flush()
    listing.setFilter({ isFree: true } as any)
    await flush()
    expect(listing.error.value?.message).toBe('boom')
    expect(listing.items.value).toEqual([{ id: 1 }])
    expect(listing.total.value).toBe(7)
    expect(listing.facets.value).toEqual(facets)
  })

  it('clears the error and takes the new data when a refetch succeeds', async () => {
    const { listing } = setup([{ data: null, errors: [{ message: 'boom' }] }, ok([{ id: 2 }], 1)])
    await flush()
    expect(listing.error.value).not.toBeNull()
    listing.setOffset(0)
    await flush()
    expect(listing.error.value).toBeNull()
    expect(listing.items.value).toEqual([{ id: 2 }])
    expect(listing.total.value).toBe(1)
  })

  it('still reports a thrown error', async () => {
    const { listing } = setup([new Error('thrown')])
    await flush()
    expect(listing.error.value?.message).toBe('thrown')
  })
})

describe('useListing retry and reset', () => {
  const failing = { data: null, errors: [{ message: 'boom' }] }

  it('refetches on every Retry on page 1', async () => {
    const { client, listing } = setup([failing])
    await flush()
    expect(client.query).toHaveBeenCalledTimes(1)
    listing.setOffset(0)
    await flush()
    listing.setOffset(0)
    await flush()
    expect(client.query).toHaveBeenCalledTimes(3)
  })

  it('goes to offset 0 with one request on Retry from page 3', async () => {
    const { client, listing } = setup([failing], { initialOffset: 40 })
    await flush()
    expect(client.query).toHaveBeenCalledTimes(1)
    listing.setOffset(0)
    await flush()
    expect(listing.offset.value).toBe(0)
    expect(client.query).toHaveBeenCalledTimes(2)
    expect(lastInput(client).offset).toBe(0)
  })

  it('Reset clears visitor filters and keeps the forced ones, with one request', async () => {
    const { client, listing } = setup([ok([])], {
      initialFilters: { categoryId: 'c', isFree: true },
      extraFilters: { status: 'published' },
      initialOffset: 20,
    })
    await flush()
    expect(lastInput(client).filters).toEqual({ categoryId: 'c', isFree: true, status: 'published' })

    const patch = clearedFilters(listing.filters.value)
    expect(patch).toEqual({ categoryId: null, isFree: null })
    listing.setFilter(patch as any)
    await flush()
    expect(client.query).toHaveBeenCalledTimes(2)
    expect(lastInput(client).filters).toEqual({ status: 'published' })
    expect(lastInput(client).offset).toBe(0)
  })

  it('Reset with nothing set still issues one request', async () => {
    const { client, listing } = setup([ok([])])
    await flush()
    expect(Object.keys(clearedFilters(listing.filters.value))).toHaveLength(0)
    listing.setOffset(0)
    await flush()
    expect(client.query).toHaveBeenCalledTimes(2)
  })
})

describe('useListing setFilter and setOffset in the same tick', () => {
  it('issues one request for setFilter then setOffset(0) at offset 0', async () => {
    const { client, listing } = setup([ok([])])
    await flush()
    expect(client.query).toHaveBeenCalledTimes(1)
    listing.setFilter({ isFree: true } as any)
    listing.setOffset(0)
    await flush()
    expect(client.query).toHaveBeenCalledTimes(2)
    expect(lastInput(client).filters).toEqual({ isFree: true })
  })

  it('issues one request for setOffset(0) then setFilter at offset 0', async () => {
    const { client, listing } = setup([ok([])])
    await flush()
    listing.setOffset(0)
    listing.setFilter({ isFree: true } as any)
    await flush()
    expect(client.query).toHaveBeenCalledTimes(2)
  })
})

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

const filterConfig = [{ kind: 'select', key: 'categoryId', field: 'categoryId', label: 'Category', options: [] }]

function deferredClient() {
  const calls: Array<{ resolve: (v: any) => void, reject: (e: any) => void }> = []
  const query = vi.fn(() => new Promise((resolve, reject) => {
    calls.push({ resolve, reject })
  }))
  return { query, calls }
}

describe('useListing debounced search', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends one request and one URL update after typing through setSearch', async () => {
    const { client, listing } = setup([ok([])], { filterConfig, initialOffset: 40 })
    await settle()
    expect(client.query).toHaveBeenCalledTimes(1)

    for (const value of ['a', 'ab', 'abc']) {
      listing.setSearch(value)
      expect(listing.search.value).toBe(value)
      await settle()
      vi.advanceTimersByTime(100)
    }
    await settle()
    expect(client.query).toHaveBeenCalledTimes(1)
    expect(nav.replace).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)
    await settle()
    expect(client.query).toHaveBeenCalledTimes(2)
    expect(lastInput(client).search).toBe('abc')
    expect(lastInput(client).offset).toBe(0)
    expect(listing.offset.value).toBe(0)
    expect(nav.replace).toHaveBeenCalledTimes(1)
  })

  it('debounces a direct write to search (v-model)', async () => {
    const { client, listing } = setup([ok([])], { filterConfig })
    await settle()
    listing.search.value = 'x'
    await settle()
    vi.advanceTimersByTime(100)
    listing.search.value = 'xy'
    await settle()
    vi.advanceTimersByTime(299)
    await settle()
    expect(client.query).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    await settle()
    expect(client.query).toHaveBeenCalledTimes(2)
    expect(lastInput(client).search).toBe('xy')
    expect(nav.replace).toHaveBeenCalledTimes(1)
  })

  it('sends one request without search after clearing it', async () => {
    const { client, listing } = setup([ok([])])
    await settle()
    listing.setSearch('a')
    vi.advanceTimersByTime(300)
    await settle()
    expect(client.query).toHaveBeenCalledTimes(2)

    listing.setSearch('')
    await settle()
    expect(client.query).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(300)
    await settle()
    expect(client.query).toHaveBeenCalledTimes(3)
    expect(lastInput(client)).not.toHaveProperty('search')
  })

  it('sends one request when the commit and a same-offset setOffset share a tick', async () => {
    const { client, listing } = setup([ok([])])
    await settle()
    listing.setSearch('a')
    vi.advanceTimersByTime(300)
    listing.setOffset(0)
    await settle()
    expect(client.query).toHaveBeenCalledTimes(2)
    expect(lastInput(client).search).toBe('a')
  })

  it('applies at once with searchDebounce 0', async () => {
    const { client, listing } = setup([ok([])], { searchDebounce: 0, initialOffset: 20 })
    await settle()
    listing.setSearch('a')
    expect(listing.offset.value).toBe(0)
    await settle()
    expect(client.query).toHaveBeenCalledTimes(2)
    expect(lastInput(client)).toMatchObject({ search: 'a', offset: 0 })

    listing.search.value = 'ab'
    await settle()
    expect(client.query).toHaveBeenCalledTimes(3)
    expect(lastInput(client).search).toBe('ab')
  })

  it('keeps what is being typed when its own URL update lands', async () => {
    const { client, listing } = setup([ok([])], { filterConfig })
    await settle()
    listing.setSearch('abc')
    vi.advanceTimersByTime(300)
    listing.search.value = 'abcd'
    await settle()
    expect(nav.route.query.search).toBe('abc')
    expect(listing.search.value).toBe('abcd')

    vi.advanceTimersByTime(300)
    await settle()
    expect(client.query).toHaveBeenCalledTimes(3)
    expect(lastInput(client).search).toBe('abcd')
  })
})

describe('useListing response order', () => {
  it('keeps the newest response when an older one arrives later', async () => {
    const client = deferredClient()
    const listing = useListing({ query: {} as any, client: client as any, dataPath: 'list' })
    client.calls[0]!.resolve(ok([{ id: 0 }]))
    await settle()

    void listing.refetch()
    void listing.refetch()
    const [a, b] = client.calls.slice(1)
    b!.resolve(ok([{ id: 'b' }]))
    await settle()
    expect(listing.items.value).toEqual([{ id: 'b' }])
    expect(listing.loading.value).toBe(false)

    a!.resolve(ok([{ id: 'a' }]))
    await settle()
    expect(listing.items.value).toEqual([{ id: 'b' }])
  })

  it('stays loading until the newest request ends, and drops an older error', async () => {
    const client = deferredClient()
    const listing = useListing({ query: {} as any, client: client as any, dataPath: 'list' })
    client.calls[0]!.resolve(ok([{ id: 0 }]))
    await settle()

    void listing.refetch()
    void listing.refetch()
    const [a, b] = client.calls.slice(1)
    a!.reject(new Error('old'))
    await settle()
    expect(listing.loading.value).toBe(true)
    expect(listing.error.value).toBeNull()

    b!.resolve(ok([{ id: 'b' }]))
    await settle()
    expect(listing.loading.value).toBe(false)
    expect(listing.items.value).toEqual([{ id: 'b' }])
  })

  it('keeps the newest error when an older request succeeds later', async () => {
    const client = deferredClient()
    const listing = useListing({ query: {} as any, client: client as any, dataPath: 'list' })
    client.calls[0]!.resolve(ok([{ id: 0 }]))
    await settle()

    void listing.refetch()
    void listing.refetch()
    const [a, b] = client.calls.slice(1)
    b!.resolve({ data: null, errors: [{ message: 'newest' }] })
    await settle()
    a!.resolve(ok([{ id: 'a' }]))
    await settle()
    expect(listing.error.value?.message).toBe('newest')
    expect(listing.items.value).toEqual([{ id: 0 }])
    expect(listing.loading.value).toBe(false)
  })
})

describe('useListing Back and forward', () => {
  const initialSort = [{ field: 'createdAt', direction: 'DESC' }]

  it('restores the default offset and sort when the URL has neither', async () => {
    resetRouter({ offset: '20', sort: 'title:DESC' })
    const { client, listing } = setup([ok([])], { filterConfig, initialSort })
    await settle()
    expect(listing.offset.value).toBe(20)
    expect(listing.sort.value).toEqual([{ field: 'title', direction: 'DESC' }])

    nav.route.query = {}
    await settle()
    expect(listing.offset.value).toBe(0)
    expect(listing.sort.value).toEqual(initialSort)
    expect(listing.sort.value).not.toBe(initialSort)
    expect(client.query).toHaveBeenCalledTimes(2)
    expect(lastInput(client)).toMatchObject({ offset: 0, sort: { createdAt: 'DESC' } })
  })

  it('applies the offset and sort the URL has', async () => {
    const { client, listing } = setup([ok([])], { filterConfig })
    await settle()
    nav.route.query = { offset: '20', sort: 'title:DESC' }
    await settle()
    expect(listing.offset.value).toBe(20)
    expect(listing.sort.value).toEqual([{ field: 'title', direction: 'DESC' }])
    expect(client.query).toHaveBeenCalledTimes(2)
    expect(lastInput(client)).toMatchObject({ offset: 20, sort: { title: 'DESC' } })
  })

  it('cancels a pending search commit and takes the URL search', async () => {
    vi.useFakeTimers()
    try {
      const { client, listing } = setup([ok([])], { filterConfig })
      await settle()
      listing.setSearch('ab')
      await settle()
      nav.route.query = { search: 'zz' }
      await settle()
      expect(listing.search.value).toBe('zz')
      expect(client.query).toHaveBeenCalledTimes(2)
      expect(lastInput(client).search).toBe('zz')

      vi.advanceTimersByTime(1000)
      await settle()
      expect(client.query).toHaveBeenCalledTimes(2)
      expect(nav.replace.mock.calls.every(([arg]: any) => arg.query.search === 'zz')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('useListing search edge cases', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('keeps the page and the URL search when Back lands while a setSearch commit is pending', async () => {
    const { client, listing } = setup([ok([])], { filterConfig })
    await settle()
    listing.setSearch('ab')
    await settle()
    nav.route.query = { search: 'zz', offset: '20' }
    await settle()
    expect(listing.offset.value).toBe(20)
    expect(listing.search.value).toBe('zz')
    expect(client.query).toHaveBeenCalledTimes(2)
    expect(lastInput(client)).toMatchObject({ search: 'zz', offset: 20 })
    const replaces = nav.replace.mock.calls.length

    vi.advanceTimersByTime(1000)
    await settle()
    expect(listing.offset.value).toBe(20)
    expect(client.query).toHaveBeenCalledTimes(2)
    expect(nav.replace).toHaveBeenCalledTimes(replaces)
  })

  it('keeps what is being typed when a key the listing does not own changes', async () => {
    resetRouter({ tab: 'info' })
    const { client, listing } = setup([ok([])], { filterConfig })
    await settle()
    listing.setSearch('ab')
    await settle()
    nav.route.query = { ...nav.route.query, tab: 'other', utm_source: ['a', 'b'] }
    await settle()
    expect(listing.search.value).toBe('ab')
    expect(client.query).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(300)
    await settle()
    expect(client.query).toHaveBeenCalledTimes(2)
    expect(lastInput(client).search).toBe('ab')
  })

  it('ignores its own URL update landing after state moved on', async () => {
    const { client, listing } = setup([ok([])], { filterConfig })
    await settle()
    listing.setSearch('abc')
    vi.advanceTimersByTime(300)
    await Promise.resolve()
    expect(nav.replace).toHaveBeenCalledTimes(1)
    listing.setOffset(20)
    listing.search.value = 'abcd'
    await settle()
    expect(listing.offset.value).toBe(20)
    expect(listing.search.value).toBe('abcd')

    vi.advanceTimersByTime(300)
    await settle()
    expect(lastInput(client)).toMatchObject({ search: 'abcd', offset: 20 })
  })

  it('clears the search when v-model writes null', async () => {
    resetRouter({ search: 'abc' })
    const { client, listing } = setup([ok([])], { filterConfig })
    await settle()
    expect(lastInput(client).search).toBe('abc')
    ;(listing.search as any).value = null
    await settle()
    expect(listing.search.value).toBe('')
    vi.advanceTimersByTime(300)
    await settle()
    expect(client.query).toHaveBeenCalledTimes(2)
    expect(lastInput(client)).not.toHaveProperty('search')
  })

  it('sends no request for a search that only adds whitespace', async () => {
    const { client, listing } = setup([ok([])], { filterConfig })
    await settle()
    listing.setSearch('abc')
    vi.advanceTimersByTime(300)
    await settle()
    expect(client.query).toHaveBeenCalledTimes(2)

    listing.search.value = 'abc '
    await settle()
    vi.advanceTimersByTime(300)
    await settle()
    expect(client.query).toHaveBeenCalledTimes(2)
    expect(listing.search.value).toBe('abc ')
  })

  it('still resets the page when setSearch only adds whitespace', async () => {
    const { client, listing } = setup([ok([])], { filterConfig })
    await settle()
    listing.setSearch('abc')
    vi.advanceTimersByTime(300)
    await settle()
    listing.setOffset(20)
    await settle()
    expect(client.query).toHaveBeenCalledTimes(3)

    listing.setSearch('abc ')
    vi.advanceTimersByTime(300)
    await settle()
    expect(listing.offset.value).toBe(0)
    expect(client.query).toHaveBeenCalledTimes(4)
    expect(lastInput(client)).toMatchObject({ search: 'abc', offset: 0 })
  })

  it('applies at once outside an effect scope', async () => {
    const client = fakeClient([ok([])])
    const listing = useListing({ query: {} as any, client: client as any, dataPath: 'list' })
    await settle()
    listing.setSearch('a')
    await settle()
    expect(client.query).toHaveBeenCalledTimes(2)
    expect(lastInput(client).search).toBe('a')
  })
})
