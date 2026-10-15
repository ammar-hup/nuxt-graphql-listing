import type {ListingResult, ListingState, SortInput, UseListingOptions, UseListingReturn} from '../types/listing'
import {deepEqual, normalizeQuery} from '../utils'
import {buildListingQuery, parseListingQuery} from '../utils/urlState'
import {computed, nextTick, type Ref, ref, watch, unref} from 'vue'
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

  const search = ref<string>(hydratedState.search ?? '')

  const state = computed<ListingState<Filters, Sort>>(() => ({
    offset: offset.value,
    limit: limit.value,
    filters: filters.value,
    sort: sort.value,
    search: search.value,
  }))

  // ---------- Build variables ----------
  const variables = computed(() => {
    const resolvedExtraFilters = unref(extraFilters) ?? ({} as Partial<Filters>)
    const vars = defaultBuildVariables(state.value, filterKey, wrapInput, resolvedExtraFilters)

    // Add search to variables
    const searchValue = search.value?.trim()
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

  const fetchData = async () => {
    fetchCount++
    pending.value = true
    error.value = null
    try {
      const result = await client.query({
        query,
        variables: variables.value,
        fetchPolicy: 'network-only',
      })
      const failure = resultError(result)
      if (failure) {
        error.value = failure
      } else {
        data.value = mapResult(result.data)
      }
    } catch (e) {
      error.value = e as Error
    } finally {
      pending.value = false
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
    // State → URL
    watch(
      state,
      (newState) => {
        internalUpdate = true
        const nextQuery = buildListingQuery(newState as any, filterConfig)
        const current = route.query as Record<string, any>

        if (!deepEqual(normalizeQuery(current), normalizeQuery(nextQuery))) {
          void router.replace({query: nextQuery, hash: route.hash})
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
        const parsed = parseListingQuery(q as Record<string, any>, filterConfig) || {}

        if (parsed.offset != null && parsed.offset !== offset.value) {
          offset.value = parsed.offset
        }
        if (parsed.limit != null && parsed.limit !== limit.value) {
          limit.value = parsed.limit
        }
        if (parsed.filters && !deepEqual(parsed.filters, filters.value)) {
          filters.value = parsed.filters as Filters
        }
        if (parsed.sort && !deepEqual(parsed.sort, sort.value)) {
          sort.value = parsed.sort as Sort
        }
        const parsedSearch = parsed.search ?? ''
        if (parsedSearch !== search.value) {
          search.value = parsedSearch
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
    offset.value = 0
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
