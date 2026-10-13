import { useLayoutEffect, useRef, useState } from 'react'

/** Plot padding, shared by every chart so their axes line up. */
export const PAD = { top: 12, right: 16, bottom: 26, left: 34 }

/**
 * Crosshair and tooltip for a chart with one row per day.
 *
 * An HTML chart is interactive by default; a reader who wants the number for
 * the ninth should not have to count gridlines. The hit area is the full
 * column, which is far bigger than the mark.
 */
export function useCrosshair(count: number, pad: { left: number; right: number } = PAD) {
  const [index, setIndex] = useState<number | null>(null)

  const onMove = (event: React.MouseEvent<SVGSVGElement>, width: number) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - box.left) / box.width) * width
    const inner = width - pad.left - pad.right
    const ratio = (x - pad.left) / inner
    const next = Math.round(ratio * (count - 1))
    setIndex(next >= 0 && next < count ? next : null)
  }

  return { index, onMove, onLeave: () => setIndex(null) }
}

/**
 * The width a chart is drawn at, so it can draw at its real size.
 *
 * A fixed viewBox scales with its box, text included: 640 units in a
 * 400-pixel column turn 10px labels into 6px ones. A chart that measures
 * its box and draws that many units keeps its type the size it was set in,
 * whatever column it lands in. Measured before the first paint, and again
 * whenever the box changes; `fallback` where there is no layout to measure,
 * as in a test.
 */
export function useChartWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(fallback)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      const next = Math.round(element.getBoundingClientRect().width)
      if (next > 0) setWidth(next)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, width }
}

