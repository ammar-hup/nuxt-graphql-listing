import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive } from 'vue'
import { useListing } from '../../src/runtime/composables/useListing'
import { clearedFilters } from '../../src/runtime/utils/filters'

vi.mock('vue-router', () => ({
  useRoute: () => reactive({ query: {}, hash: '' }),
  useRouter: () => ({ replace: vi.fn() }),
}))

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
  const listing = useListing({ query: {} as any, client: client as any, dataPath: 'list', ...options })
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
