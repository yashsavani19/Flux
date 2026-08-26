import { useCallback, useEffect, useState } from 'preact/hooks'
import type { Column } from '@flux/shared'
import { DEFAULT_COLUMNS, sortColumns } from '@flux/shared'
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

  const reload = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const data = await getColumns(projectId)
      setColumns(sortColumns(data))
      setError(null)
    } catch (e) {
      setColumns(DEFAULT_COLUMNS.map(c => ({ ...c })))
      setError(e instanceof Error ? e.message : 'Could not load this board’s columns.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    reload()
  }, [reload])

  // Adopt a list the server has just confirmed, without a second round trip.
  const applySaved = useCallback((saved: Column[]) => {
    setColumns(sortColumns(saved))
    setError(null)
  }, [])

  return { columns, loading, error, reload, applySaved }
}
