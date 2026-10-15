import type { ApolloClient } from '@apollo/client/core'
import type { DocumentNode } from 'graphql/index'
import type { Component, Ref } from 'vue'

// ============================================
// Sort Types
// ============================================

export type SortDirection = 'ASC' | 'DESC'

export interface SortInput<F extends string = string> {
  field: F
  direction: SortDirection
}

export interface SortOption<F extends string = string> {
  label: string
  field: F
  direction: SortDirection
}

// ============================================
// Facet Types (keyed by field name in API response)
// ============================================

/**
 * Facet for range filters (int-range, decimal-range, datetime-range)
 * Backend should return: { [fieldName]: { min: number, max: number } }
 */
export interface RangeFacet {
  min: number | null
  max: number | null
}

/**
 * Facet for datetime range filters
 * Backend should return: { [fieldName]: { min: string, max: string } } (ISO dates)
 */
export interface DateRangeFacet {
  min: string | null
  max: string | null
}

/**
 * Facet option for select/switch-multi filters
 * Backend should return: { [fieldName]: OptionFacet[] }
 */
export interface OptionFacet {
  value: string | number | boolean
  label?: string
  count?: number
}

/**
 * Facet for category tree filters
 * Backend should return: { [fieldName]: CategoryFacet[] }
 */
export interface CategoryFacet {
  id: string
  name: string
  count?: number
  children?: CategoryFacet[]
  /** For flat lists that need path reconstruction */
  pathText?: string
  /** For multi-tree support */
  treeId?: string
  /** Translations for i18n support */
  translations?: Array<{
    language: string
    name: string
    slug?: string
  }>
}

/**
 * Facet for rating filters
 * Backend should return: { [fieldName]: RatingFacet[] }
 */
export interface RatingFacet {
  value: number
  count?: number
}

/**
 * Type helper to get the expected facet type for a filter kind
 */
export type FacetTypeForKind<K extends FilterControlKind> =
  K extends 'int-range' | 'decimal-range' ? RangeFacet :
  K extends 'datetime-range' | 'datetime-range-group' ? DateRangeFacet :
  K extends 'select' | 'boolean-select' | 'switch-multi' ? OptionFacet[] :
  K extends 'category-tree' ? CategoryFacet[] :
  K extends 'rating' ? RatingFacet[] :
  K extends 'custom' ? unknown :
  never

/**
 * Field-keyed facets object
 * Each key is the field name, value is the facet data for that field's filter type
 */
export type FieldKeyedFacets<Fields extends string = string> = {
  [K in Fields]?: RangeFacet | DateRangeFacet | OptionFacet[] | CategoryFacet[] | RatingFacet[] | unknown
}

// ============================================
// Filter Types
// ============================================

export type FilterControlKind =
  | 'select'
  | 'boolean-select'
  | 'int-range'
  | 'decimal-range'
  | 'datetime-range'
  | 'datetime-range-group'
  | 'switch-group'
  | 'switch-multi'
  | 'rating'
  | 'category-tree'
  | 'separator'
  | 'custom'

export interface BaseFilterFieldConfig<F extends string = string> {
  key: string
  field?: F
  label: string
  kind: FilterControlKind
}

export interface SelectOption {
  label: string
  value: string | number | boolean | null
}

export interface SelectFilterFieldConfig<F extends string = string>
  extends BaseFilterFieldConfig<F> {
  kind: 'select' | 'boolean-select'
  field: F
  options: SelectOption[]
}

export interface RangeFilterFieldConfig<F extends string = string>
  extends BaseFilterFieldConfig<F> {
  kind: 'int-range' | 'decimal-range' | 'datetime-range'
  field: F
}

export interface DateTimeRangeGroupFilterFieldConfig<F extends string = string>
  extends BaseFilterFieldConfig<F> {
  kind: 'datetime-range-group'
  dateFields: Array<{ field: F; label: string }>
}

export type SeparatorFieldConfig = {
  kind: 'separator'
  key: string
  label?: string
}

export interface SwitchGroupFilterFieldConfig<F extends string = string>
  extends BaseFilterFieldConfig<F> {
  kind: 'switch-group'
  switches: Array<{
    field: F
    label: string
  }>
}

export interface SwitchMultiFilterFieldConfig<F extends string = string>
  extends BaseFilterFieldConfig<F> {
  kind: 'switch-multi'
  field: F
  options: Array<{ value: string | number | boolean; label: string }>
}

export interface RatingFilterFieldConfig<F extends string = string>
  extends BaseFilterFieldConfig<F> {
  kind: 'rating'
  field: F
  steps?: number[]
}

export interface CategoryTreeFilterFieldConfig<F extends string = string>
  extends BaseFilterFieldConfig<F> {
  kind: 'category-tree'
  field: F
}

export interface CustomFilterFieldConfig<F extends string = string>
  extends BaseFilterFieldConfig<F> {
  kind: 'custom'
  field: F
  component: Component
  props?: Record<string, any>
}

export type FilterFieldConfig<F extends string = string> =
  | SelectFilterFieldConfig<F>
  | RangeFilterFieldConfig<F>
  | DateTimeRangeGroupFilterFieldConfig<F>
  | SwitchGroupFilterFieldConfig<F>
  | SwitchMultiFilterFieldConfig<F>
  | RatingFilterFieldConfig<F>
  | CategoryTreeFilterFieldConfig<F>
  | CustomFilterFieldConfig<F>
  | SeparatorFieldConfig

// ============================================
// Listing Types
// ============================================

export type RangeValue<T> = {
  eq?: T | null
  gt?: T | null
  gte?: T | null
  lt?: T | null
  lte?: T | null
}

export interface ListingState<Filters, Sort> {
  offset: number
  limit: number
  filters: Filters
  sort: Sort
  search?: string
}

export interface ListingResult<Item, Facets = Record<string, any>> {
  items: Item[]
  total: number
  facets?: Facets | null
}

export interface UseListingOptions<
  Item = any,
  Filters = Record<string, any>,
  Sort = SortInput[],
  Facets = Record<string, any>,
> {
  /** GraphQL query document */
  query: DocumentNode

  /** Apollo client instance */
  client: ApolloClient

  /**
   * Path to the data in GraphQL response (e.g., 'products' for { products: { items, total } })
   * The response at this path should have: items, total, and optionally facets
   */
  dataPath: string

  /** Initial filter values */
  initialFilters?: Partial<Filters>

  /** Initial sort configuration */
  initialSort?: Sort

  /** Initial offset for pagination (default: 0) */
  initialOffset?: number

  /** Initial limit for pagination (default: 20) */
  initialLimit?: number

  /**
   * Filter field configurations for URL binding
   * When provided, enables automatic URL sync
   */
  filterConfig?: FilterFieldConfig[]

  /** Unique key for useAsyncData (default: 'listing') */
  key?: string

  /** Key name for filters in GraphQL variables (default: 'filters') */
  filterKey?: string

  /** Wrap variables in { input: ... } (default: true) */
  wrapInput?: boolean

  /** Extra filters to merge with state filters (not synced to URL) */
  extraFilters?: Partial<Filters> | Ref<Partial<Filters>>

  /** GraphQL variable name for search (default: 'search') */
  searchKey?: string

  /** If true, search is sent inside filters[searchKey] instead of as a top-level variable (default: false) */
  searchInFilters?: boolean

  /**
   * Milliseconds to wait after the last change to `search` (or `setSearch`) before it is applied
   * to the query and the URL; `search` itself updates at once (default: 300, 0 = off)
   */
  searchDebounce?: number

  /**
   * Custom result mapper (advanced)
   * Override auto-mapping from dataPath
   */
  mapResult?: (data: any) => ListingResult<Item, Facets>
}

export interface UseListingReturn<Item, Filters, Sort, Facets = Record<string, any>> {
  items: Ref<Item[]>
  total: Ref<number>
  facets: Ref<Facets | null | undefined>
  offset: Ref<number>
  limit: Ref<number>
  filters: Ref<Filters>
  sort: Ref<Sort>
  loading: Ref<boolean>
  error: Ref<Error | null>
  search: Ref<string>
  setFilter: (patch: Partial<Filters>) => void
  setSort: (sort: Sort) => void
  setOffset: (offset: number) => void
  setLimit: (limit: number) => void
  setSearch: (value: string) => void
  refetch: () => Promise<void>
}
