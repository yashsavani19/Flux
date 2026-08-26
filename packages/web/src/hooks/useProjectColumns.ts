import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { Column } from '@flux/shared'
import { columnsEqual, DEFAULT_COLUMNS, sortColumns } from '@flux/shared'
import { getColumns } from '../stores'

/**
 * The board's column set for one project.
 *
 * If the columns cannot be read the board still needs something to draw, so it
 * falls back to the four defaults - but `error` is set, and the board shows the
 * failure rather than pretending the fallback is the real configuration.
 */
export function useProjectColumns(projectId: string) {
  const [columns, setColumns] = useState<Column[]>(() => DEFAULT_COLUMNS.map(c => ({ ...c })))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestGeneration = useRef(0)

  const reload = useCallback(async () => {
    const generation = ++requestGeneration.current
    if (!projectId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const data = await getColumns(projectId)
      if (generation !== requestGeneration.current) return
      const sorted = sortColumns(data)
      setColumns(current => (columnsEqual(current, sorted) ? current : sorted))
      setError(null)
    } catch (e) {
      if (generation !== requestGeneration.current) return
      setColumns(DEFAULT_COLUMNS.map(c => ({ ...c })))
      setError(e instanceof Error ? e.message : 'Could not load this board’s columns.')
    } finally {
      if (generation === requestGeneration.current) setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    reload()
    return () => {
      requestGeneration.current += 1
    }
  }, [reload])

  // Adopt a list the server has just confirmed, without a second round trip.
  const applySaved = useCallback((saved: Column[]) => {
    requestGeneration.current += 1
    const sorted = sortColumns(saved)
    setColumns(current => (columnsEqual(current, sorted) ? current : sorted))
    setError(null)
    setLoading(false)
  }, [])

  return { columns, loading, error, reload, applySaved }
}
