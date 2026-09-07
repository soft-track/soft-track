import { useState } from 'react'

/** Plot padding, shared by every chart so their axes line up. */
export const PAD = { top: 12, right: 16, bottom: 26, left: 34 }

/**
 * Crosshair and tooltip for a chart with one row per day.
 *
 * An HTML chart is interactive by default; a reader who wants the number for
 * the ninth should not have to count gridlines. The hit area is the full
 * column, which is far bigger than the mark.
 */
export function useCrosshair(count: number) {
  const [index, setIndex] = useState<number | null>(null)

  const onMove = (event: React.MouseEvent<SVGSVGElement>, width: number) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - box.left) / box.width) * width
    const inner = width - PAD.left - PAD.right
    const ratio = (x - PAD.left) / inner
    const next = Math.round(ratio * (count - 1))
    setIndex(next >= 0 && next < count ? next : null)
  }

  return { index, onMove, onLeave: () => setIndex(null) }
}

