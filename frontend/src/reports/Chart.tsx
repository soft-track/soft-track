import { type ReactNode } from 'react'

import { PAD } from '@/reports/chartGeometry'
import { INK } from '@/reports/chartTokens'

/** A figure: title, optional note, legend, and the plot itself. */
export function Figure({
  title,
  note,
  legend,
  children,
  empty,
}: {
  title: string
  note?: string
  legend?: ReactNode
  children: ReactNode
  /** Shown instead of the plot when there is nothing to draw. */
  empty?: string
}) {
  return (
    <figure className="rounded-lg border border-neutral-200 bg-white p-4">
      <figcaption className="mb-3">
        <h3 className="text-sm font-medium text-neutral-900">{title}</h3>
        {note && <p className="mt-0.5 text-xs text-neutral-500">{note}</p>}
      </figcaption>
      {empty ? (
        <p className="py-10 text-center text-sm text-neutral-400">{empty}</p>
      ) : (
        <>
          {legend && <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">{legend}</div>}
          {children}
        </>
      )}
    </figure>
  )
}

/** A legend entry. Identity is never colour alone -- the swatch has a label. */
export function Key({
  colour,
  label,
  dashed = false,
}: {
  colour: string
  label: string
  dashed?: boolean
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-neutral-600">
      {dashed ? (
        <span
          className="h-0 w-3 border-t-2 border-dashed"
          style={{ borderColor: colour }}
        />
      ) : (
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colour }} />
      )}
      {label}
    </span>
  )
}

/** Horizontal gridlines with value labels. Recessive by design. */
export function YAxis({
  max,
  width,
  height,
  ticks = 4,
}: {
  max: number
  width: number
  height: number
  ticks?: number
}) {
  const step = max / ticks
  return (
    <g>
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const value = step * i
        const y = PAD.top + (height - PAD.top - PAD.bottom) * (1 - i / ticks)
        return (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y}
              y2={y}
              stroke={INK.grid}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y + 3}
              textAnchor="end"
              className="fill-neutral-400"
              style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}
            >
              {Math.round(value)}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/** Date labels, thinned so they never collide. */
export function XAxis({
  labels,
  width,
  height,
}: {
  labels: string[]
  width: number
  height: number
}) {
  const inner = width - PAD.left - PAD.right
  const every = Math.max(1, Math.ceil(labels.length / Math.floor(inner / 52)))
  return (
    <g>
      {labels.map((label, i) => {
        if (i % every !== 0 && i !== labels.length - 1) return null
        const x =
          PAD.left + (labels.length === 1 ? inner / 2 : (inner * i) / (labels.length - 1))
        return (
          <text
            key={i}
            x={x}
            y={height - PAD.bottom + 14}
            textAnchor="middle"
            className="fill-neutral-400"
            style={{ fontSize: 10 }}
          >
            {label}
          </text>
        )
      })}
    </g>
  )
}

export function Tooltip({
  x,
  width,
  rows,
  title,
}: {
  x: number
  width: number
  rows: Array<{ colour?: string; label: string; value: string }>
  title: string
}) {
  // Flip to the left of the crosshair near the right edge so it never runs off.
  const flip = x > width * 0.6
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 min-w-32 rounded-md border border-neutral-200 bg-white px-2 py-1.5 shadow-lg"
      style={
        flip
          ? { right: `${((width - x) / width) * 100}%`, marginRight: 8 }
          : { left: `${(x / width) * 100}%`, marginLeft: 8 }
      }
    >
      <p className="mb-0.5 text-[11px] font-medium text-neutral-700">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          {row.colour && (
            <span className="h-2 w-2 rounded-sm" style={{ background: row.colour }} />
          )}
          {row.label}
          <span className="identifier ml-auto text-neutral-800">{row.value}</span>
        </p>
      ))}
    </div>
  )
}
