<script setup lang="ts">
import { ref, computed } from "vue";
import CategoryTreeNode from "./TreeNode.vue";
import { useListingI18n } from "../../../../../composables/useListingI18n";
import type { CategoryTreeFilterFieldConfig, CategoryFacet } from "../../../../../types/listing";

interface TreeNode {
  id?: string
  categoryId: string
  pathText: string
  name: string
  slug: string
  count?: number
  children: TreeNode[]
}

const props = withDefaults(defineProps<{
  field: CategoryTreeFilterFieldConfig
  filters: Record<string, any>
  facetOptions?: CategoryFacet[]
}>(), {
  facetOptions: undefined
});
const emit = defineEmits<{
  change: [patch: Record<string, any>]
}>();
const { locale, t } = useListingI18n();

function buildTrees(cats: CategoryFacet[] | undefined): Record<string, TreeNode[]> {
  const out: Record<string, TreeNode[]> = {};
  if (!cats?.length) return out;
  const nodeMap = new Map<string, TreeNode>();

  for (const c of cats) {
    const treeKey = c.treeId || "default";
    if (!out[treeKey]) {
      out[treeKey] = [];
    }

    const translation = c.translations?.find((t2: any) => t2.language === locale.value) || c.translations?.[0];
    const name = translation?.name || c.name || '';
    const slug = translation?.slug || c.id;

    // If pathText exists, use path-based tree building
    const path = (c.pathText || "").split(/\s*[>/]\s*/).filter(Boolean);

    if (path.length) {
      let currentPath = treeKey;
      let parentNode: TreeNode | null = null;

      for (let i = 0; i < path.length; i++) {
        const segment = path[i];
        const fullPath = currentPath + "/" + segment;
        let node = nodeMap.get(fullPath);

        if (!node) {
          const isLeaf = i === path.length - 1;
          node = {
            categoryId: isLeaf ? (c.categoryId || c.id) : "",
            pathText: isLeaf ? c.pathText || "" : "",
            name: isLeaf ? name : segment,
            slug: isLeaf ? slug : segment,
            count: isLeaf ? c.count : undefined,
            children: []
          };
          if (isLeaf) {
            node.id = slug;
          }
          nodeMap.set(fullPath, node);
          if (parentNode) {
            parentNode.children.push(node);
          } else {
            out[treeKey].push(node);
          }
        } else {
          if (i === path.length - 1) {
            node.id = slug;
            node.name = name;
            node.slug = slug;
            node.categoryId = c.categoryId || c.id;
            node.pathText = c.pathText || "";
            node.count = c.count;
          }
        }
        parentNode = node;
        currentPath = fullPath;
      }
    } else {
      // No pathText — use children-based tree (flat root node)
      const node: TreeNode = {
        id: slug,
        categoryId: c.categoryId || c.id,
        pathText: '',
        name,
        slug,
        count: c.count,
        children: buildChildNodes(c.children, treeKey)
      };
      out[treeKey].push(node);
    }
  }
  return out;
}

function buildChildNodes(children: any[] | undefined, treeKey: string): TreeNode[] {
  if (!children?.length) return [];
  return children.map((c: any) => {
    const translation = c.translations?.find((t2: any) => t2.language === locale.value) || c.translations?.[0];
    const name = translation?.name || c.name || '';
    const slug = translation?.slug || c.id;
    return {
      id: slug,
      categoryId: c.categoryId || c.id,
      pathText: c.pathText || '',
      name,
      slug,
      count: c.count,
      children: buildChildNodes(c.children, treeKey)
    };
  });
}

const trees = computed(() => buildTrees(props.facetOptions));

const selected = computed({
  get: () => props.filters?.[props.field.field] ?? null,
  set: (val: string | null) => emit("change", { [props.field.field]: val })
});

function selectAll() {
  selected.value = null;
}

function selectUncategorized() {
  selected.value = '__uncategorized__';
}

const expanded = ref<Record<string, boolean>>({});

function onToggle(pathKey: string) {
  expanded.value[pathKey] = !expanded.value[pathKey];
}

function onSelect(slug: string) {
  selected.value = slug;
}
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-3">
      <span class="text-sm font-bold text-gray-900 dark:text-gray-100">
        {{ field.label || t("listing.categories") }}
      </span>
    </div>

    <!-- Empty state; null facets mean unknown (not loaded, or the request failed), not empty -->
    <div v-if="facetOptions && facetOptions.length === 0" class="text-sm text-neutral-500 py-2">
      {{ t("listing.noCategories") }}
    </div>

    <!-- Category list; with facets unknown only "All categories" shows, so a URL-set category can be cleared -->
    <div v-else class="text-sm space-y-0.5">
      <!-- All categories option -->
      <button
        type="button"
        class="w-full flex items-center gap-2 py-1.5 px-2 rounded-lg transition-colors text-start"
        :class="!selected
          ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 font-semibold'
          : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-700 dark:text-gray-300'"
        @click="selectAll"
      >
        <UIcon name="i-lucide-layout-grid" class="size-4 shrink-0"/>
        <span>{{ t("listing.allCategories") }}</span>
      </button>

      <template v-if="facetOptions">
        <!-- Tree nodes -->
        <template v-for="(nodes, treeId) in trees" :key="treeId">
          <ul class="m-0 p-0 list-none">
            <CategoryTreeNode
              v-for="(node, idx) in nodes"
              :key="treeId + '/' + node.slug + '-' + idx"
              :node="node"
              :path-key="treeId + '/' + node.slug + '-' + idx"
              :selected="selected"
              :expanded="expanded"
              @toggle="onToggle"
              @select="onSelect"
            />
          </ul>
        </template>

        <!-- Uncategorized option -->
        <button
          type="button"
          class="w-full flex items-center gap-2 py-1.5 px-2 rounded-lg transition-colors text-start"
          :class="selected === '__uncategorized__'
            ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 font-semibold'
            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-500 dark:text-gray-400'"
          @click="selectUncategorized"
        >
          <UIcon name="i-lucide-circle-off" class="size-4 shrink-0"/>
          <span>{{ t("listing.uncategorized") }}</span>
        </button>
      </template>
    </div>
  </div>
</template>