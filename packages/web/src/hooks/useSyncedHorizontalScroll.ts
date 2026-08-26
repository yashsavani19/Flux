import { useCallback, useRef } from 'preact/hooks'

/**
 * Keeps several horizontally scrolling panes at the same position.
 *
 * The board draws one lane per epic plus one for unassigned tasks. Left to
 * themselves each lane would scroll on its own, so with enough columns one lane
 * could be showing "Done" while the lane below still shows the first column -
 * and the two can no longer be read against each other. Pass the returned
 * callback as the scroll container's `ref` in every lane.
 */
export function useSyncedHorizontalScroll() {
  const panes = useRef<HTMLElement[]>([])
  const position = useRef(0)
  const syncing = useRef(false)

  const handleScroll = useCallback((event: Event) => {
    // Ignore the scroll events our own writes below trigger.
    if (syncing.current) return
    const source = event.currentTarget as HTMLElement
    position.current = source.scrollLeft
    syncing.current = true
    for (const pane of panes.current) {
      if (pane !== source && pane.scrollLeft !== source.scrollLeft) {
        pane.scrollLeft = source.scrollLeft
      }
    }
    requestAnimationFrame(() => {
      syncing.current = false
    })
  }, [])

  const register = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return
      if (panes.current.includes(node)) return
      panes.current = [...panes.current.filter(pane => pane.isConnected), node]
      node.addEventListener('scroll', handleScroll, { passive: true })
      // A lane that appears after the others have scrolled starts level with them.
      if (position.current !== 0) node.scrollLeft = position.current
    },
    [handleScroll]
  )

  return register
}
