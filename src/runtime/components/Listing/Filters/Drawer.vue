<script setup lang="ts">
import Renderer from "./Renderer.vue";
import {ref, toRaw, watch} from "vue";
import type {FieldKeyedFacets, FilterFieldConfig} from "../../../types/listing";
import {useListingI18n} from "../../../composables/useListingI18n";

interface DrawerResult {
  applied: boolean
  filters: Record<string, any> | null
}

const props = withDefaults(defineProps<{
  filters: Record<string, any>
  config: FilterFieldConfig[]
  facets?: FieldKeyedFacets | null
}>(), {
  facets: undefined
});
const emit = defineEmits<{
  close: [result: DrawerResult]
}>();
const close = () => emit("close", {applied: false, filters: null});
const submit = () => {
  const nextFilters = cloneFilters(localFilters.value);
  emit("close", {applied: true, filters: nextFilters});
};
const cloneFilters = (value: Record<string, any>): Record<string, any> => {
  const raw = toRaw(value);
  try {
    return structuredClone(raw);
  } catch {
    return JSON.parse(JSON.stringify(raw));
  }
};
const localFilters = ref(cloneFilters(props.filters));
const {t} = useListingI18n();
watch(
  () => props.filters,
  () => {
    localFilters.value = cloneFilters(props.filters);
  }
);

function onFieldChange(patch: Record<string, any>): void {
  localFilters.value = {
    ...localFilters.value,
    ...patch
  };
}
</script>

<template>
  <USlideover
    :close="{ onClick: () => emit('close', { applied: false, filters: null }) }"
    :title="t('listing.filters')"
  >
    <template #description/>
    <template #body>
      <Renderer
        :filters="localFilters"
        :config="props.config"
        :facets="props.facets"
        draft
        @change="onFieldChange"
      />
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" :label="t('listing.cancel')" @click="close"/>
        <UButton :label="t('listing.apply')" color="primary" @click="submit"/>
      </div>
    </template>
  </USlideover>
</template>
