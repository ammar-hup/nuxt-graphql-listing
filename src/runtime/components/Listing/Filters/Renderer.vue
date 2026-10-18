<script setup lang="ts">
import type { Component } from "vue";
import Select from "./Field/Select.vue";
import DateRangeGroup from "./Field/DateRangeGroup.vue";
import DateRange from "./Field/DateRange.vue";
import NumberRange from "./Field/NumberRange.vue";
import SwitchGroup from "./Field/SwitchGroup.vue";
import SwitchMulti from "./Field/SwitchMulti.vue";
import Rating from "./Field/Rating.vue";
import CategoryTree from "./Field/Category/Tree.vue";
import type { FilterFieldConfig, FieldKeyedFacets } from "../../../types/listing";
const props = withDefaults(defineProps<{
  filters: Record<string, any>
  config: FilterFieldConfig[]
  facets?: FieldKeyedFacets | null
  draft?: boolean
}>(), {
  facets: undefined,
  draft: false
});
const emit = defineEmits<{
  change: [patch: Record<string, any>]
}>();
function resolveComponent(field: FilterFieldConfig): Component | undefined {
  if (field.kind === "custom" && "component" in field) {
    return field.component;
  }
  switch (field.kind) {
    case "select":
    case "boolean-select":
      return Select;
    case "datetime-range-group":
      return DateRangeGroup;
    case "datetime-range":
      return DateRange;
    case "int-range":
    case "decimal-range":
      return NumberRange;
    case "switch-group":
      return SwitchGroup;
    case "switch-multi":
      return SwitchMulti;
    case "rating":
      return Rating;
    case "category-tree":
      return CategoryTree;
  }
}
function getCustomProps(field: FilterFieldConfig): Record<string, any> {
  if (field.kind === "custom" && "props" in field) {
    return field.props ?? {};
  }
  return {};
}
function getFacetProps(field: FilterFieldConfig): Record<string, any> {
  if (!props.facets) return {};
  const fieldName = "field" in field ? field.field : null;
  if (!fieldName) return {};
  const facetData = props.facets[fieldName] as any;
  if (facetData === void 0 || facetData === null) return {};
  if (field.kind === "decimal-range" || field.kind === "int-range") {
    return {
      facetMin: facetData.min ?? null,
      facetMax: facetData.max ?? null
    };
  }
  if (field.kind === "datetime-range") {
    return {
      facetMin: facetData.min ?? null,
      facetMax: facetData.max ?? null
    };
  }
  if (field.kind === "category-tree") {
    return { facetOptions: Array.isArray(facetData) ? facetData : null };
  }
  if (field.kind === "rating") {
    return { facetOptions: Array.isArray(facetData) ? facetData : null };
  }
  if (field.kind === "select" || field.kind === "boolean-select" || field.kind === "switch-multi") {
    return { facetOptions: Array.isArray(facetData) ? facetData : null };
  }
  if (field.kind === "custom") {
    return { facet: facetData };
  }
  return {};
}
// Only range fields (int-range/decimal-range/datetime-range-group) learn the
// host keeps a draft; other fields and custom components get no new attribute.
const DRAFT_KINDS = new Set(["int-range", "decimal-range", "datetime-range-group"]);
function getDraftProps(field: FilterFieldConfig): Record<string, any> {
  if (!props.draft) return {};
  return DRAFT_KINDS.has(field.kind) ? { draft: true } : {};
}
function onFieldChange(patch: Record<string, any>): void {
  emit("change", patch);
}
</script>

<template>
  <div class="space-y-4">
    <template v-for="field in config" :key="field.key">
      <div
        v-if="field.kind === 'separator'"
        class="flex items-center gap-2 "
        role="separator"
      >
        <span
          v-if="field.label"
          class="font-semibold uppercase text-muted-foreground whitespace-nowrap"
        >
          {{ field.label }}
        </span>
        <div class="flex-1 border-t-3 border-t-neutral-100 dark:border-neutral-800"/>
      </div>

      <component
        :is="resolveComponent(field)"
        v-else
        :field="field"
        :filters="filters"
        v-bind="{ ...getFacetProps(field), ...getDraftProps(field), ...getCustomProps(field) }"
        @change="onFieldChange"
      />
    </template>
  </div>
</template>
