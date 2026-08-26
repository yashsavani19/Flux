import { useState, useEffect, useCallback } from 'preact/hooks'

interface BoardPreferences {
  viewMode: 'normal' | 'condensed'
  collapsedColumns: string[]
  collapsedEpics: string[]
}

const STORAGE_KEY_PREFIX = 'flux-board-preferences'

function getStorageKey(projectId: string): string {
  return `${STORAGE_KEY_PREFIX}-${projectId}`
}

const DEFAULTS: BoardPreferences = {
  viewMode: 'normal',
  collapsedColumns: [],
  collapsedEpics: [],
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function getInitialPreferences(projectId: string): BoardPreferences {
  if (typeof window === 'undefined') return { ...DEFAULTS }

  try {
    const stored = localStorage.getItem(getStorageKey(projectId))
    if (stored) {
      const parsed = JSON.parse(stored)
      // Boards saved before columns were configurable only knew how to collapse
      // Planning. Carry that choice forward rather than silently losing it.
      const collapsedColumns = Array.isArray(parsed.collapsedColumns)
        ? toStringArray(parsed.collapsedColumns)
        : parsed.planningCollapsed
        ? ['planning']
        : []
      return {
        viewMode: parsed.viewMode === 'condensed' ? 'condensed' : 'normal',
        collapsedColumns,
        collapsedEpics: toStringArray(parsed.collapsedEpics),
      }
    }
  } catch {
    // Invalid JSON, return defaults
  }

  return { ...DEFAULTS }
}

export function useBoardPreferences(projectId: string) {
  const [preferences, setPreferences] = useState<BoardPreferences>(() =>
    getInitialPreferences(projectId)
  )

  // Reload preferences when projectId changes
  useEffect(() => {
    setPreferences(getInitialPreferences(projectId))
  }, [projectId])

  // Persist to localStorage whenever preferences change
  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(getStorageKey(projectId), JSON.stringify(preferences))
  }, [projectId, preferences])

  const setViewMode = useCallback((viewMode: 'normal' | 'condensed') => {
    setPreferences(prev => ({ ...prev, viewMode }))
  }, [])

  const toggleColumnCollapse = useCallback((columnId: string) => {
    setPreferences(prev => {
      const collapsedColumns = prev.collapsedColumns.includes(columnId)
        ? prev.collapsedColumns.filter(id => id !== columnId)
        : [...prev.collapsedColumns, columnId]
      return { ...prev, collapsedColumns }
    })
  }, [])

  const expandAllColumns = useCallback(() => {
    setPreferences(prev => (prev.collapsedColumns.length === 0 ? prev : { ...prev, collapsedColumns: [] }))
  }, [])

  // Drop remembered ids for columns that no longer exist, so a deleted column
  // cannot keep a slot reserved in localStorage forever.
  const pruneCollapsedColumns = useCallback((existingIds: string[]) => {
    setPreferences(prev => {
      const kept = prev.collapsedColumns.filter(id => existingIds.includes(id))
      return kept.length === prev.collapsedColumns.length ? prev : { ...prev, collapsedColumns: kept }
    })
  }, [])

  const toggleEpicCollapse = useCallback((epicId: string) => {
    setPreferences(prev => {
      const collapsedEpics = prev.collapsedEpics.includes(epicId)
        ? prev.collapsedEpics.filter(id => id !== epicId)
        : [...prev.collapsedEpics, epicId]
      return { ...prev, collapsedEpics }
    })
  }, [])

  const isEpicCollapsed = useCallback(
    (epicId: string) => preferences.collapsedEpics.includes(epicId),
    [preferences.collapsedEpics]
  )

  return {
    viewMode: preferences.viewMode,
    collapsedColumns: new Set(preferences.collapsedColumns),
    collapsedEpics: new Set(preferences.collapsedEpics),
    setViewMode,
    toggleColumnCollapse,
    expandAllColumns,
    pruneCollapsedColumns,
    toggleEpicCollapse,
    isEpicCollapsed,
  }
}
