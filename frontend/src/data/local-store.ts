import { SEED_ROWS } from './seed'
import { crewOfTester } from './roster'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'substation-protection:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

// 老版本数据没有归属班组/历史试验人/操作日志：读取时就地补齐，归属按「试验人所在班组」回填，查不到统一落到一班。
function migrateRows(data: Record<string, EntryRow[]>): void {
  const rows = data.insulationtest
  if (!Array.isArray(rows)) {
    return
  }
  let changed = false
  for (const row of rows) {
    if (typeof row.所属班组 !== 'string' || !row.所属班组) {
      row.所属班组 = crewOfTester(String(row.试验人 ?? '')) || '保护试验一班'
      changed = true
    }
    if (typeof row.历史试验人 !== 'string') {
      row.历史试验人 = ''
      changed = true
    }
    if (!Array.isArray(row.操作日志)) {
      row.操作日志 = []
      changed = true
    }
  }
  if (changed && typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
    migrateRows(cache)
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
