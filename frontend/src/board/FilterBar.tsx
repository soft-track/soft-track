import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { IssuePriority } from '@/api/generated/models'
import { describeFilters, withoutFilter } from '@/board/filterLabels'
import { activeCount, type BoardFilters, isEmpty, NO_FILTERS } from '@/board/filters'
import { PRIORITY_META, PRIORITY_ORDER } from '@/issues/issueMeta'
import { activeMembers } from '@/team/members'
import { useTeamContext } from '@/team/TeamContext'
import { Icon } from '@/ui/Icon'
import { Select } from '@/ui/Select'

/**
 * One button for all six filters, and a chip for each one that is set.
 *
 * Six dropdowns across the top bar was never going to fit, and the chips do a
 * job dropdowns cannot: they say what is being hidden. A board narrowed by a
 * filter you cannot see is a board that looks like it has lost your issues.
 */
export function FilterBar({
  filters,
  onChange,
  onSave,
  canSave,
}: {
  filters: BoardFilters
  onChange: (filters: BoardFilters) => void
  onSave: () => void
  /** False while the current filters already match a saved view. */
  canSave: boolean
}) {
  const { members, labels, projects, cycles, statuses } = useTeamContext()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)

  // Measured after layout: the top bar wraps on narrow viewports, so where
  // this button sits depends on a pass that has not happened at click time.
  useLayoutEffect(() => {
    if (!open) return
    const measure = () => setAnchor(buttonRef.current?.getBoundingClientRect() ?? null)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])

  const count = activeCount(filters)
  const chips = describeFilters(filters, { members, labels, projects, cycles, statuses })
  const set = <K extends keyof BoardFilters>(key: K, value: BoardFilters[K]) =>
    onChange({ ...filters, [key]: value })

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((it) => !it)}
        aria-expanded={open}
        data-active={count > 0}
        className="btn btn-secondary btn-sm data-[active=true]:text-neutral-900"
      >
        <Icon name="filter" size={13} />
        Filter
        {count > 0 && (
          <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold text-white">
            {count}
          </span>
        )}
      </button>

      {chips.map((chip) => (
        <span key={chip.key} className="chip">
          <span className="text-neutral-400">{chip.field}</span>
          {chip.value}
          <button
            type="button"
            onClick={() => onChange(withoutFilter(filters, chip.key))}
            aria-label={`Clear ${chip.field.toLowerCase()} filter`}
            className="-mr-0.5 rounded-full p-0.5 text-neutral-400 hover:text-neutral-800"
          >
            <Icon name="close" size={11} />
          </button>
        </span>
      ))}

      {!isEmpty(filters) && (
        <>
          <button
            type="button"
            onClick={() => onChange(NO_FILTERS)}
            className="btn btn-ghost btn-xs text-neutral-500"
          >
            Clear
          </button>
          {canSave && (
            <button
              type="button"
              onClick={onSave}
              className="btn btn-ghost btn-xs text-brand-600"
            >
              <Icon name="plus" size={12} />
              Save view
            </button>
          )}
        </>
      )}

      {open &&
        anchor &&
        createPortal(
          <>
            {/* Portalled for the same reason the notifications inbox is: the
                top bar is a `.glass` surface, and a backdrop-filter makes it
                both a stacking context and the containing block for fixed
                children, so a popover nested inside it is painted under the
                board and its click-catcher covers only the bar. */}
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
            <div
              role="dialog"
              aria-label="Filter issues"
              style={{
                top: anchor.bottom + 8,
                left: Math.max(8, Math.min(anchor.left, window.innerWidth - 288)),
              }}
              className="glass-menu fixed z-50 w-[17.5rem] max-w-[calc(100vw-1rem)] rounded-panel p-3"
            >
              <div className="space-y-2.5">
                <Field label="Status">
                  <Select
                    block
                    dense
                    value={filters.statusId ?? ''}
                    onChange={(e) =>
                      set('statusId', e.target.value ? Number(e.target.value) : null)
                    }
                  >
                    <option value="">Any status</option>
                    {statuses.map((status) => (
                      <option key={status.id} value={status.id}>
                        {status.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Priority">
                  <Select
                    block
                    dense
                    value={filters.priority ?? ''}
                    onChange={(e) =>
                      set('priority', (e.target.value || null) as IssuePriority | null)
                    }
                  >
                    <option value="">Any priority</option>
                    {PRIORITY_ORDER.map((priority) => (
                      <option key={priority} value={priority}>
                        {PRIORITY_META[priority].label}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Assignee">
                  <Select
                    block
                    dense
                    value={filters.assignee === null ? '' : String(filters.assignee)}
                    onChange={(e) => {
                      const value = e.target.value
                      set(
                        'assignee',
                        value === '' ? null : value === 'unassigned' ? 'unassigned' : Number(value),
                      )
                    }}
                  >
                    <option value="">Anyone</option>
                    <option value="unassigned">Unassigned</option>
                    {activeMembers(members).map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.full_name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Label">
                  <Select
                    block
                    dense
                    value={filters.labelId ?? ''}
                    onChange={(e) => set('labelId', e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Any label</option>
                    {labels.map((label) => (
                      <option key={label.id} value={label.id}>
                        {label.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Project">
                  <Select
                    block
                    dense
                    value={filters.projectId ?? ''}
                    onChange={(e) =>
                      set('projectId', e.target.value ? Number(e.target.value) : null)
                    }
                  >
                    <option value="">Any project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Cycle">
                  <Select
                    block
                    dense
                    value={filters.cycleId ?? ''}
                    onChange={(e) => set('cycleId', e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Any cycle</option>
                    {cycles.map((cycle) => (
                      <option key={cycle.id} value={cycle.id}>
                        {cycle.display_name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="eyebrow mb-1 block">{label}</span>
      {children}
    </label>
  )
}
