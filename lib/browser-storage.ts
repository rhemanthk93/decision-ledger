type ItemWithId = {
  id: string
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined'
}

export function readStoredArray<T>(key: string): T[] {
  if (!canUseStorage()) return []

  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function writeStoredArray<T>(
  key: string,
  items: T[],
  entityLabel: string
): void {
  if (!canUseStorage()) return

  try {
    localStorage.setItem(key, JSON.stringify(items))
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      console.error(`localStorage quota exceeded — ${entityLabel} not saved`)
    }
  }
}

export function mergeStoredRecords<T extends ItemWithId>(
  key: string,
  incoming: T[],
  entityLabel: string
): T[] {
  const existing = readStoredArray<T>(key)
  const merged = new Map(existing.map(item => [item.id, item]))

  incoming.forEach(item => merged.set(item.id, item))

  const next = Array.from(merged.values())
  writeStoredArray(key, next, entityLabel)
  return next
}

export function upsertStoredRecord<T extends ItemWithId>(
  key: string,
  incoming: T,
  entityLabel: string
): T[] {
  return mergeStoredRecords(key, [incoming], entityLabel)
}

export function updateStoredRecord<T extends ItemWithId>(
  key: string,
  id: string,
  updater: (item: T) => T,
  entityLabel: string
): T[] {
  const existing = readStoredArray<T>(key)
  const index = existing.findIndex(item => item.id === id)

  if (index === -1) return existing

  const next = [...existing]
  next[index] = updater(next[index])
  writeStoredArray(key, next, entityLabel)
  return next
}

export function removeStoredKeys(keys: string[]): void {
  if (!canUseStorage()) return

  keys.forEach(key => localStorage.removeItem(key))
}
