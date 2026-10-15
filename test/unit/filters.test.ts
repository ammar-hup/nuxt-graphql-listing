import { describe, it, expect } from 'vitest'
import { clearedFilters } from '../../src/runtime/utils/filters'

describe('clearedFilters', () => {
  it('nulls every key that holds a value', () => {
    expect(clearedFilters({ categoryId: 'c', isFree: true, price: { gte: 1 }, tags: ['a'], rating: 0 }))
      .toEqual({ categoryId: null, isFree: null, price: null, tags: null, rating: null })
  })

  it('keeps false as a value to clear', () => {
    expect(clearedFilters({ isFree: false })).toEqual({ isFree: null })
  })

  it('leaves out keys that are already empty', () => {
    expect(clearedFilters({ a: null, b: undefined, c: '', d: '  ', e: [], f: {}, g: 'x' })).toEqual({ g: null })
  })

  it('returns an empty patch when nothing is set', () => {
    expect(clearedFilters({})).toEqual({})
    expect(clearedFilters({ a: null })).toEqual({})
    expect(clearedFilters(null)).toEqual({})
    expect(clearedFilters(undefined)).toEqual({})
  })
})
