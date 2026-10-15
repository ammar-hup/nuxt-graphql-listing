import { describe, it, expect, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { i18nMock, registerStubs } from './stubs'
import Tree from '../../../src/runtime/components/Listing/Filters/Field/Category/Tree.vue'

vi.mock('../../../src/runtime/composables/useListingI18n', () => i18nMock())

async function render(facetOptions: any) {
  const app = createSSRApp({
    render: () => h(Tree as any, {
      field: { field: 'categoryId', kind: 'category-tree', label: 'Category' },
      filters: { categoryId: 'from-url' },
      facetOptions,
    }),
  })
  registerStubs(app)
  return renderToString(app)
}

describe('Category Tree', () => {
  it.each([null, undefined])('with facets unknown (%s): All categories, no "No categories", no rows', async (facets) => {
    const html = await render(facets)
    expect(html).not.toContain('listing.noCategories')
    expect(html).toContain('listing.allCategories')
    expect(html).not.toContain('listing.uncategorized')
  })

  it('with no categories ([]): "No categories"', async () => {
    const html = await render([])
    expect(html).toContain('listing.noCategories')
    expect(html).not.toContain('listing.allCategories')
  })

  it('with categories: All, the rows and Uncategorized', async () => {
    const html = await render([{ id: 'c1', name: 'Math', pathText: 'math', treeId: 't' }])
    expect(html).toContain('listing.allCategories')
    expect(html).toContain('Math')
    expect(html).toContain('listing.uncategorized')
  })
})
