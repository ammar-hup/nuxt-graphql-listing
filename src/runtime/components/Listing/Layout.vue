<script setup lang="ts">
import { computed, ref, useSlots } from "vue";
import Topbar from "./Topbar.vue";
import { useListingI18n } from "../../composables/useListingI18n";
import { clearedFilters } from "../../utils/filters";
import type { SortOption, SortInput, FilterFieldConfig, FieldKeyedFacets } from "../../types/listing";

interface EmptyAction {
  icon?: string
  label: string
  color?: string
  variant?: string
  onClick?: () => void
}

const props = withDefaults(defineProps<{
  filters: Record<string, any>
  filtersConfig: FilterFieldConfig[]
  facets?: FieldKeyedFacets | null
  sortConfig: SortOption[]
  sort: SortInput[] | null
  total: number
  limit: number
  offset: number
  items: any[]
  loading: boolean
  error: Error | null
  filtersTitle?: string
  sortLabel?: string
  hasGridSwitch?: boolean
  viewMode?: string
  condensed?: boolean
  emptyTitle?: string
  emptyDescription?: string
  emptyIcon?: string
  emptyAvatar?: Record<string, any>
  emptyActions?: EmptyAction[]
  errorRedirect?: string
  errorClear?: boolean | Record<string, any>
}>(), {
  facets: undefined,
  filtersTitle: undefined,
  sortLabel: undefined,
  hasGridSwitch: false,
  viewMode: undefined,
  condensed: false,
  emptyTitle: undefined,
  emptyDescription: undefined,
  emptyIcon: undefined,
  emptyAvatar: undefined,
  emptyActions: undefined,
  errorRedirect: undefined,
  errorClear: undefined
});
const slots = useSlots();
const emit = defineEmits<{
  'update:sort': [value: SortInput[]]
  'update:filters': [value: Record<string, any>]
  'update:offset': [value: number]
}>();
const { t } = useListingI18n();
const viewMode = ref(props.viewMode || "grid");
const showSidebar = computed(() => !props.condensed && props.filtersConfig.length > 0);
const page = computed({
  get() {
    return Math.floor(props.offset / props.limit) + 1;
  },
  set(newPage) {
    const safePage = newPage < 1 ? 1 : newPage;
    const nextOffset = (safePage - 1) * props.limit;
    // UPagination re-emits the current page; that is not a page change.
    if (nextOffset !== props.offset) emit("update:offset", nextOffset);
  }
});
const pageCount = computed(() => {
  if (!props.limit || props.limit <= 0) return 1;
  if (!props.total || props.total <= 0) return 1;
  return Math.ceil(props.total / props.limit);
});
const from = computed(() => {
  if (!props.total || props.total === 0) return 0;
  return props.offset + 1;
});
const to = computed(() => {
  if (!props.total || props.total === 0) return 0;
  return Math.min(props.offset + props.items.length, props.total);
});
function onFilterChange(patch: Record<string, any>): void {
  emit("update:filters", patch);
}
// setFilter also resets the offset, so one emit is one request; with nothing to clear, the offset emit refetches.
function resetFilters(): void {
  const patch = clearedFilters(props.filters);
  if (Object.keys(patch).length > 0) {
    emit("update:filters", patch);
  } else {
    emit("update:offset", 0);
  }
}
</script>

<template>
  <div class="grid grid-cols-1 gap-4 md:grid-cols-12 w-full">
    <!-- Sidebar column: optional slot above + desktop filters -->
    <div v-if="showSidebar" class="hidden md:flex md:flex-col md:col-span-3 gap-4">
      <slot name="sidebar-above"/>
      <LazyListingFiltersAsidePanel
        :filters="filters"
        :config="filtersConfig"
        :facets="facets"
        @change="onFilterChange"
      />
      <slot name="sidebar-below"/>
    </div>

    <!-- Content -->
    <div :class="['space-y-4', showSidebar ? 'md:col-span-9' : 'md:col-span-12']">
      <!-- Title / Toolbar -->
      <slot name="header"/>

      <Topbar
        :sort-config="sortConfig"
        :sort="sort"
        :sort-label="sortLabel"
        :has-grid-switch="hasGridSwitch"
        :condensed="condensed"
        v-model:view-mode="viewMode"
        :filters="filters"
        :filters-config="filtersConfig"
        :facets="facets"
        @update:sort="emit('update:sort', $event)"
        @update:filters="emit('update:filters', $event)"
      >
        <template #start>
          <slot name="top-bar-start"/>
        </template>

        <template #before-end>
          <slot name="top-bar-before-end"/>
        </template>

        <template #end>
          <slot name="top-bar-end"/>
        </template>
      </Topbar>

      <!-- Content placeholder -->
      <div class="my-6">
        <!-- Error state -->
        <template v-if="error">
          <slot name="error" :error="error">
            <UError
              :error="{ message: error?.message || t('listing.errorTitle') }"
              :redirect="errorRedirect"
              :clear="errorClear ?? { label: t('listing.retry'), onClick: () => $emit('update:offset', 0) }"
            >
              <!-- Forward UError slots -->
              <template v-if="slots['error-default']" #default>
                <slot name="error-default" :error="error" />
              </template>
              <template v-if="slots['error-status-code']" #statusCode>
                <slot name="error-status-code" :error="error" />
              </template>
              <template v-if="slots['error-status-message']" #statusMessage>
                <slot name="error-status-message" :error="error" />
              </template>
              <template v-if="slots['error-message']" #message>
                <slot name="error-message" :error="error" />
              </template>
              <template v-if="slots['error-links']" #links>
                <slot name="error-links" :error="error" />
              </template>
            </UError>
          </slot>
        </template>

        <!-- Loading state -->
        <template v-else-if="loading">
          <slot name="loading">
            <ListingLoading/>
          </slot>
        </template>

        <!-- Empty state -->
        <template v-else-if="items.length === 0">
          <slot name="empty">
            <UEmpty
              :title="emptyTitle ?? t('listing.empty.title')"
              :description="emptyDescription ?? t('listing.empty.description')"
              :icon="emptyIcon ?? 'i-heroicons-exclamation-triangle'"
              :avatar="emptyAvatar"
              :actions="emptyActions ?? [
  {
    icon: 'i-lucide-refresh-cw',
    label: t('listing.empty.resetFilters'),
    color: 'neutral',
    variant: 'subtle',
    onClick: resetFilters
  }
]"
            >
              <!-- Forward UEmpty slots -->
              <template v-if="slots['empty-header']" #header>
                <slot name="empty-header" />
              </template>
              <template v-if="slots['empty-leading']" #leading>
                <slot name="empty-leading" />
              </template>
              <template v-if="slots['empty-title']" #title>
                <slot name="empty-title" />
              </template>
              <template v-if="slots['empty-description']" #description>
                <slot name="empty-description" />
              </template>
              <template v-if="slots['empty-body']" #body>
                <slot name="empty-body" />
              </template>
              <template v-if="slots['empty-actions']" #actions>
                <slot name="empty-actions" />
              </template>
              <template v-if="slots['empty-footer']" #footer>
                <slot name="empty-footer" />
              </template>
            </UEmpty>
          </slot>
        </template>

        <!-- Normal content -->
        <template v-else>
          <slot
            name="content"
            :items="items"
            :total="total"
            :view-mode="viewMode"
          />
        </template>

        <div class="flex items-center justify-between gap-2 mt-6" v-if="!loading && !error && items.length > 0">
          <div class="flex flex-wrap gap-2 text-sm text-neutral dark:text-gray-300 font-medium">
            <span v-text="t('listing.pagination', { page, pageCount })"/>
            <span class="">•</span>
            <span v-if="!loading" v-text="t('listing.results', { from, to, total })"/>
          </div>
          <div class="flex gap-2">
            <UPagination
              v-model:page="page"
              :total="total"
              :items-per-page="limit"
              size="lg"
            />
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
