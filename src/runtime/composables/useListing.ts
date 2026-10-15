import type {FilterFieldConfig, ListingResult, ListingState, SortInput, UseListingOptions, UseListingReturn} from '../types/listing'
import {deepEqual, normalizeQuery} from '../utils'
import {buildListingQuery, parseListingQuery} from '../utils/urlState'
import {computed, getCurrentScope, nextTick, onScopeDispose, type Ref, ref, watch, unref} from 'vue'
import {useRoute, useRouter} from 'vue-router'

/**
 * Check if a value is empty (null, undefined, empty string, empty array, or empty object)
 */
function isEmpty(value: any): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' && value.trim() === '') return true
  if (Array.isArray(value) && value.length === 0) return true
  if (typeof value === 'object' && Object.keys(value).length === 0) return true
  return false
}

/**
 * Remove empty values from filters object
 */
function cleanFilters<Filters>(filters: Filters): Partial<Filters> | null {
  const cleaned: Record<string, any> = {}
  let hasValues = false

  for (const [key, value] of Object.entries(filters as Record<string, any>)) {
    if (!isEmpty(value)) {
      cleaned[key] = value
      hasValues = true
    }
  }

  return hasValues ? cleaned as Partial<Filters> : null
}

/**
 * Default variable builder following the convention:
 * { input: { offset, limit, filters, sort: { fieldName: 'ASC' } } }
 */
function defaultBuildVariables<Filters, Sort>(
  state: ListingState<Filters, Sort>,
  filterKey: string,
  wrapInput: boolean,
  extraFilters: Partial<Filters>,
): any {
  const mergedFilters = {...state.filters, ...extraFilters}
  const cleanedFilters = cleanFilters(mergedFilters)
  const sortKeyed = convertSortToKeyed(state.sort)

  const variables: Record<string, any> = {
    offset: state.offset,
    limit: state.limit,
  }

  if (cleanedFilters) {
    variables[filterKey] = cleanedFilters
  }

  if (Object.keys(sortKeyed).length > 0) {
    variables.sort = sortKeyed
  }

  return wrapInput ? {input: variables} : variables
}

/**
 * Convert array sort to keyed format: [{ field: 'name', direction: 'ASC' }] -> { name: 'ASC' }
 */
function convertSortToKeyed(sort: any): Record<string, string> {
  if (!Array.isArray(sort)) return {}
  const keyed: Record<string, string> = {}
  for (const s of sort) {
    if (s?.field) {
      keyed[s.field] = s.direction ?? 'ASC'
    }
  }
  return keyed
}

/**
 * Default result mapper using dataPath
 */
function defaultMapResult<Item, Facets>(data: any, dataPath: string): ListingResult<Item, Facets> {
  const root = data?.[dataPath]
  return {
    items: root?.items ?? [],
    total: root?.total ?? 0,
    facets: root?.facets ?? null,
  }
}

/**
 * The error a resolved query carries. Under `errorPolicy: 'all'` GraphQL errors
 * come back in the result instead of being thrown: Apollo 4 sets `error`,
 * Apollo 3 sets an `errors` array.
 */
function resultError(result: any): Error | null {
  const errors = Array.isArray(result?.errors) && result.errors.length > 0 ? result.errors : null
  const source = result?.error ?? errors
  if (!source) return null
  const message = result?.error?.errors?.[0]?.message || result?.error?.message || errors?.[0]?.message
  return new Error(message || 'Request failed', {cause: source})
}

/**
 * The query keys buildListingQuery can write for this filterConfig.
 */
function listingQueryKeys(filterConfig: FilterFieldConfig[]): Set<string> {
  const keys = new Set(['offset', 'limit', 'search', 'sort'])
  for (const field of filterConfig as any[]) {
    switch (field.kind) {
      case 'separator':
        break
      case 'switch-group':
        for (const sw of field.switches) keys.add(sw.field)
        break
      case 'int-range':
      case 'decimal-range':
      case 'rating':
        keys.add(`${field.field}Min`).add(`${field.field}Max`)
        break
      case 'datetime-range':
        keys.add(`${field.field}From`).add(`${field.field}To`)
        break
      case 'datetime-range-group':
        for (const df of field.dateFields) keys.add(`${df.field}From`).add(`${df.field}To`)
        break
      default:
        keys.add('field' in field ? field.field : field.key)
    }
  }
  return keys
}

/**
 * The listing's own keys of a query (all keys without `keys`), every value as a string (the form route.query carries).
 */
function ownedQuery(query: Record<string, any>, keys?: Set<string>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(normalizeQuery(query))) {
    if (keys && !keys.has(k)) continue
    out[k] = Array.isArray(v) ? v.map(String) : String(v)
  }
  return out
}

export function useListing<
  Item = any,
  Filters extends Record<string, any> = Record<string, any>,
  Sort extends SortInput[] = SortInput[],
  Facets = Record<string, any>,
>(
  options: UseListingOptions<Item, Filters, Sort, Facets>,
): UseListingReturn<Item, Filters, Sort, Facets> {
  const {
    query,
    client,
    dataPath,
    initialOffset = 0,
    initialLimit = 20,
    initialFilters = {} as Partial<Filters>,
    initialSort = [] as unknown as Sort,
    filterConfig,
    key = 'listing',
    filterKey = 'filters',
    wrapInput = true,
    extraFilters = {} as Partial<Filters>,
    searchKey = 'search',
    searchInFilters = false,
    searchDebounce = 300,
    mapResult: customMapResult,
  } = options

  const route = useRoute()
  const router = useRouter()

  // Validate required options
  if (!client) {
    throw new Error('[useListing] client is required')
  }
  if (!dataPath && !customMapResult) {
    throw new Error('[useListing] dataPath is required (or provide custom mapResult)')
  }

  // URL binding is enabled when filterConfig is provided
  const urlBinding = !!filterConfig

  // ---------- Hydrate state from URL ----------
  let hydratedState: Partial<ListingState<Filters, Sort>> = {}
  if (urlBinding && filterConfig) {
    hydratedState =
      parseListingQuery<string, Filters, Sort>(
        route.query as Record<string, any>,
        filterConfig,
      ) || {}
  }

  const offset = ref<number>(hydratedState.offset ?? initialOffset)
  const limit = ref<number>(hydratedState.limit ?? initialLimit)

  const filters = ref<Filters>(
    structuredClone(hydratedState.filters ?? initialFilters) as Filters,
  )

  const sort = ref<Sort>(
    structuredClone(hydratedState.sort ?? initialSort) as Sort,
  )

  // `search` echoes the input; `appliedSearch` is what the query and the URL use.
  const search = ref<string>(hydratedState.search ?? '')
  const appliedSearch = ref<string>(search.value)

  // No timers on the server or outside an effect scope: nothing would clear them.
  const debounceSearch = searchDebounce > 0 && !import.meta.server && !!getCurrentScope()
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let pendingSearch: string | null = null
  let pendingOffsetReset = false

  function cancelSearchCommit() {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = null
    pendingSearch = null
    pendingOffsetReset = false
  }

  // Search and setSearch's offset reset land in one tick, so a pause sends one request.
  // A search equal to the applied one once trimmed is not re-applied: it would refetch the same query.
  function commitSearch() {
    const resetOffset = pendingOffsetReset
    cancelSearchCommit()
    const next = search.value ?? ''
    if (next.trim() !== appliedSearch.value.trim()) appliedSearch.value = next
    if (resetOffset) offset.value = 0
  }

  function scheduleSearchCommit(resetOffset: boolean) {
    if (resetOffset) pendingOffsetReset = true
    if (searchTimer) clearTimeout(searchTimer)
    pendingSearch = search.value
    if (debounceSearch) {
      searchTimer = setTimeout(commitSearch, searchDebounce)
    } else {
      commitSearch()
    }
  }

  if (getCurrentScope()) onScopeDispose(cancelSearchCommit)

  // A direct write to `search` (v-model) is debounced like setSearch.
  watch(search, (value) => {
    if (value == null) {
      search.value = ''
      return
    }
    if (value === pendingSearch) return
    if (searchTimer == null && value.trim() === appliedSearch.value.trim()) return
    scheduleSearchCommit(false)
  })

  const state = computed<ListingState<Filters, Sort>>(() => ({
    offset: offset.value,
    limit: limit.value,
    filters: filters.value,
    sort: sort.value,
    search: appliedSearch.value,
  }))

  // ---------- Build variables ----------
  const variables = computed(() => {
    const resolvedExtraFilters = unref(extraFilters) ?? ({} as Partial<Filters>)
    const vars = defaultBuildVariables(state.value, filterKey, wrapInput, resolvedExtraFilters)

    // Add search to variables
    const searchValue = appliedSearch.value?.trim()
    if (searchValue) {
      const target = wrapInput ? vars.input : vars
      if (searchInFilters) {
        target[filterKey] = {...(target[filterKey] ?? {}), [searchKey]: searchValue}
      } else {
        target[searchKey] = searchValue
      }
    }

    return vars
  })

  // ---------- Map result ----------
  const mapResult = customMapResult
    ? customMapResult
    : (data: any) => defaultMapResult<Item, Facets>(data, dataPath)

  // ---------- Fetch ----------
  const data = ref<ListingResult<Item, Facets> | null>(null)
  const pending = ref(true)
  const error = ref<Error | null>(null)

  let fetchCount = 0

  // Only the newest request writes state; an older, slower response is dropped.
  const fetchData = async () => {
    const id = ++fetchCount
    pending.value = true
    error.value = null
    try {
      const result = await client.query({
        query,
        variables: variables.value,
        fetchPolicy: 'network-only',
      })
      if (id !== fetchCount) return
      const failure = resultError(result)
      if (failure) {
        error.value = failure
      } else {
        data.value = mapResult(result.data)
      }
    } catch (e) {
      if (id === fetchCount) error.value = e as Error
    } finally {
      if (id === fetchCount) pending.value = false
    }
  }

  // Initial fetch
  fetchData()

  // Refetch on variable changes
  watch(variables, () => fetchData(), {deep: true})

  const items = computed<Item[]>(() => (data.value?.items ?? []) as Item[])
  const total = computed<number>(() => data.value?.total ?? 0)
  const facets = computed<Facets | null | undefined>(
    () => data.value?.facets as Facets | null | undefined,
  )

  // ---------- URL binding ----------
  let internalUpdate = false

  if (urlBinding && filterConfig) {
    const ownedKeys = listingQueryKeys(filterConfig)
    // Queries sent to the router whose route update has not landed yet, oldest first.
    let pendingEchoes: Record<string, any>[] = []
    // The owned query the route watcher last restored (Back/forward); the state watcher writes exactly that state with replace.
    let restoring: Record<string, any> | null = null

    // State → URL
    watch(
      state,
      (newState) => {
        internalUpdate = true
        const nextQuery = buildListingQuery(newState as any, filterConfig)
        const current = route.query as Record<string, any>

        const fromUrl = restoring !== null && deepEqual(ownedQuery(nextQuery, ownedKeys), restoring)
        restoring = null

        // Compared as strings: a restored `limit=20` matches the state's 20 and writes nothing.
        if (!deepEqual(ownedQuery(current), ownedQuery(nextQuery))) {
          pendingEchoes.push(ownedQuery(nextQuery, ownedKeys))
          const location = {query: nextQuery, hash: route.hash}
          void (fromUrl ? router.replace(location) : router.push(location))
        }

        internalUpdate = false
      },
      {deep: true},
    )

    // URL → State
    watch(
      () => route.query,
      (q) => {
        if (internalUpdate) return
        // Our own router.replace landing, even after state has moved on: applying it would undo newer state.
        const owned = ownedQuery(q as Record<string, any>, ownedKeys)
        const echo = pendingEchoes.findIndex(sent => deepEqual(sent, owned))
        if (echo !== -1) {
          pendingEchoes = pendingEchoes.slice(echo + 1)
          return
        }

        // An absent offset or sort means the default (buildListingQuery omits them); limit is kept.
        const parsed = parseListingQuery(q as Record<string, any>, filterConfig) || {}
        const target = {
          offset: parsed.offset ?? initialOffset,
          limit: parsed.limit ?? limit.value,
          filters: (parsed.filters ?? {}) as Filters,
          sort: (parsed.sort ?? initialSort) as Sort,
          search: parsed.search ?? '',
        }
        // Nothing of ours changed (e.g. only a foreign key like ?tab=): keep a search still being typed.
        const asQuery = (s: ListingState<Filters, Sort>) => ownedQuery(buildListingQuery(s as any, filterConfig), ownedKeys)
        if (deepEqual(asQuery(target), asQuery(state.value))) return
        pendingEchoes = []
        let changed = false

        if (target.offset !== offset.value) {
          offset.value = target.offset
          changed = true
        }
        if (target.limit !== limit.value) {
          limit.value = target.limit
          changed = true
        }
        if (parsed.filters && !deepEqual(parsed.filters, filters.value)) {
          filters.value = parsed.filters as Filters
          changed = true
        }
        if (!deepEqual(target.sort, sort.value)) {
          sort.value = structuredClone(target.sort) as Sort
          changed = true
        }
        cancelSearchCommit()
        if (target.search !== appliedSearch.value) {
          appliedSearch.value = target.search
          changed = true
        }
        // Only a state change reaches the state watcher, which consumes the token.
        restoring = changed ? asQuery(target) : null
        if (target.search !== search.value) {
          search.value = target.search
        }
      },
    )
  }

  // ---------- API helpers ----------
  function setFilter(patch: Partial<Filters>) {
    const next: any = {...(filters.value as any)}

    for (const [k, value] of Object.entries(patch)) {
      next[k] = value === undefined ? null : value
    }

    filters.value = next
    offset.value = 0
  }

  function setSort(newSort: Sort) {
    sort.value = newSort
    offset.value = 0
  }

  function setOffset(newOffset: number) {
    const next = newOffset < 0 ? 0 : newOffset
    // An unchanged offset fires no watcher, so a Retry on the current page refetches here.
    // Two ticks let a same-tick setFilter's watcher run first (in either call order); its fetch counts.
    if (next === offset.value) {
      const seen = fetchCount
      void nextTick()
        .then(() => nextTick())
        .then(() => {
          if (fetchCount === seen) void fetchData()
        })
      return
    }
    offset.value = next
  }

  function setLimit(newLimit: number) {
    limit.value = newLimit
    offset.value = 0
  }

  function setSearch(value: string) {
    search.value = value
    scheduleSearchCommit(true)
  }

  return {
    items,
    total,
    facets,
    offset,
    limit,
    filters,
    sort,
    search,
    loading: pending as Ref<boolean>,
    error: computed(() => (error.value as any) ?? null),
    setFilter,
    setSort,
    setOffset,
    setLimit,
    setSearch,
    refetch: fetchData,
  } as UseListingReturn<Item, Filters, Sort, Facets>
}
