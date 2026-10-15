function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as object).length > 0
  return true
}

/**
 * The patch that clears every filter holding a value. Keys already empty are
 * left out, so an empty result means there is nothing to clear.
 */
export function clearedFilters(filters: Record<string, any> | null | undefined): Record<string, null> {
  const patch: Record<string, null> = {}
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (hasValue(value)) patch[key] = null
  }
  return patch
}
