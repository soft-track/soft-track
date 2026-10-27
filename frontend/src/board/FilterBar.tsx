import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { DateWindow, DueFilter } from '@/api/generated/models'
import { useAuth } from '@/auth/useAuth'
import { describeFilters, fieldName, shiftDay, summarise, valueName } from '@/board/filterLabels'
import {
  activeCount,
  type BoardFilters,
  FILTER_KEYS,
  type FilterKey,
  type FilterValue,
  isEmpty,
  isSet,
  MANY_KEYS,
  type ManyKey,
  MISSING_ORDER,
  NO_FILTERS,
  NO_WHEN,
  ONE_KEYS,
  type OneKey,
  toggleValue,
  type WhenFilter,
  type WhenKey,
  WINDOW_ORDER,
  withoutFilter,
} from '@/board/filters'
import { useTranslation } from '@/i18n'
import { DUE_FILTER_LABEL } from '@/tickets/dueDate'
import { PriorityIcon } from '@/tickets/PriorityIcon'
import {
  PRIORITY_ORDER,
  SEVERITY_META,
  SEVERITY_ORDER,
  TYPE_META,
  TYPE_ORDER,
} from '@/tickets/ticketMeta'
import { activeMembers } from '@/team/members'
import { pickableProjects } from '@/team/projects'
import { pickableReleases } from '@/releases/releases'
import { useTeamContext } from '@/team/useTeamContext'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Select } from '@/ui/Select'

type Section = FilterKey

/** Which section the menu opens on: the first filter already set, else status. */
function firstSet(filters: BoardFilters): Section {
  return FILTER_KEYS.find((key) => isSet(filters, key)) ?? 'status'
}

/** A section's summary with nothing chosen in it: "Any status", "Anyone". */
const ANY_KEY = {
  status: 'status',
  priority: 'priority',
  assignee: 'assignee',
  label: 'label',
  type: 'type',
  projectId: 'project',
  sprintId: 'sprint',
  due: 'due',
  creator: 'creator',
  updated: 'updated',
  created: 'created',
  hasNo: 'hasNo',
  watching: 'watching',
  release: 'release',
  severity: 'severity',
  environment: 'environment',
  foundIn: 'foundIn',
} as const satisfies Record<FilterKey, string>

/**
 * One button for every filter, and a chip for each one that is set.
 *
 * A dropdown per filter across the top bar was never going to fit, and the
 * chips do a job dropdowns cannot: they say what is being hidden. A board
 * narrowed by a filter you cannot see is a board that looks like it has lost
 * your tickets.
 *
 * The filters that take several values (#260) are checkboxes in the menu,
 * one section open at a time, each with a switch that turns it round. In a
 * chip, each chosen value can be removed on its own.
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
  const { t } = useTranslation(['board', 'common'])
  const lookups = useTeamContext()
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<Section>('status')
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
  const chips = describeFilters(filters, lookups)
  // A team that has made no release is not asked about one (#272) -- unless
  // a link has set it, so it can be taken off again.
  const hasReleases = (lookups.releases ?? []).length > 0
  const sections = FILTER_KEYS.filter(
    (key) => !(key === 'release' || key === 'foundIn') || hasReleases || isSet(filters, key),
  )

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (!open) setSection(firstSet(filters))
          setOpen((it) => !it)
        }}
        aria-expanded={open}
        data-active={count > 0}
        className="btn btn-secondary btn-sm data-[active=true]:text-neutral-900"
      >
        <Icon name="filter" size={13} />
        {t('filters.button')}
        {count > 0 && (
          <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold text-white">
            {count}
          </span>
        )}
      </button>

      {chips.map((chip) => (
        <span key={chip.key} className="chip" data-testid={`filter-chip-${chip.key}`}>
          <span className="text-neutral-400">{chip.field}</span>
          {chip.prefix && <span>{chip.prefix}</span>}
          {chip.parts.map((part, index) => (
            <span key={part.label + index} className="inline-flex items-center gap-0.5">
              {index > 0 && <span className="mr-0.5 text-neutral-400">{chip.joiner}</span>}
              {part.label}
              <button
                type="button"
                onClick={() => onChange(part.without)}
                aria-label={t('filters.removeValue', { value: part.label, field: chip.field })}
                className="rounded-full p-0.5 text-neutral-400 hover:text-neutral-800"
              >
                <Icon name="close" size={11} />
              </button>
            </span>
          ))}
        </span>
      ))}

      {!isEmpty(filters) && (
        <>
          <button
            type="button"
            onClick={() => onChange(NO_FILTERS)}
            className="btn btn-ghost btn-xs text-neutral-500"
          >
            {t('filters.clearAll')}
          </button>
          {canSave && (
            <button
              type="button"
              onClick={onSave}
              className="btn btn-ghost btn-xs text-brand-600"
            >
              <Icon name="plus" size={12} />
              {t('filters.saveView')}
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
              aria-label={t('filters.dialogLabel')}
              style={{
                top: anchor.bottom + 8,
                left: Math.max(8, Math.min(anchor.left, window.innerWidth - 328)),
                maxHeight: `calc(100vh - ${anchor.bottom + 24}px)`,
              }}
              className="glass-menu fixed z-50 w-[20rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-panel p-1.5"
            >
              {sections.map((key) => (
                <div key={key} className="border-b border-neutral-900/5 last:border-b-0">
                  <button
                    type="button"
                    aria-expanded={section === key}
                    onClick={() => setSection(key)}
                    className="flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left hover:bg-neutral-900/[0.03]"
                  >
                    <span className="eyebrow shrink-0">{fieldName(key)}</span>
                    <span className="min-w-0 flex-1 truncate text-right text-xs text-neutral-500">
                      {isSet(filters, key)
                        ? summarise(onlyFilter(filters, key), lookups)
                        : t(`filters.any.${ANY_KEY[key]}`)}
                    </span>
                    <Icon
                      name={section === key ? 'chevron-up' : 'chevron-down'}
                      size={12}
                      className="shrink-0 text-neutral-400"
                    />
                  </button>
                  {section === key && (
                    <div className="px-1 pb-2">
                      {(MANY_KEYS as readonly string[]).includes(key) ? (
                        <ManySection
                          name={key as ManyKey}
                          filters={filters}
                          onChange={onChange}
                        />
                      ) : (ONE_KEYS as readonly string[]).includes(key) ? (
                        <OneSection name={key as OneKey} filters={filters} onChange={onChange} />
                      ) : key === 'updated' || key === 'created' ? (
                        <WhenSection name={key} filters={filters} onChange={onChange} />
                      ) : key === 'hasNo' ? (
                        <HasNoSection filters={filters} onChange={onChange} />
                      ) : (
                        <WatchingSection filters={filters} onChange={onChange} />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}

/** Only `key` of the filters, for a menu section's one-line summary. */
function onlyFilter(filters: BoardFilters, key: Section): BoardFilters {
  return { ...NO_FILTERS, [key]: filters[key] }
}

/** The values a filter offers, in the order the menu lists them. */
function useOptions<K extends ManyKey>(name: K): FilterValue<K>[] {
  const { team, members, labels, statuses, releases } = useTeamContext()
  switch (name) {
    case 'status':
      return statuses.map((status) => status.id) as FilterValue<K>[]
    case 'priority':
      return PRIORITY_ORDER as FilterValue<K>[]
    case 'assignee':
      // "Me" first: whoever is looking, which is what a shared view about
      // oneself needs (#261).
      return [
        'me',
        'unassigned',
        ...activeMembers(members).map((user) => user.id),
      ] as FilterValue<K>[]
    case 'creator':
      return ['me', ...activeMembers(members).map((user) => user.id)] as FilterValue<K>[]
    case 'label':
      return labels.map((label) => label.id) as FilterValue<K>[]
    case 'release':
    case 'foundIn':
      // An archived release is not offered, like an archived epic.
      return pickableReleases(releases ?? []).map((release) => release.id) as FilterValue<K>[]
    case 'severity':
      return SEVERITY_ORDER as FilterValue<K>[]
    case 'environment':
      return (team.environments ?? []) as FilterValue<K>[]
    default:
      return TYPE_ORDER as FilterValue<K>[]
  }
}

/** A multi-value filter: a checkbox per value, and its switches. */
function ManySection<K extends ManyKey>({
  name,
  filters,
  onChange,
}: {
  name: K
  filters: BoardFilters
  onChange: (filters: BoardFilters) => void
}) {
  const { t } = useTranslation('board')
  const lookups = useTeamContext()
  const offered = useOptions(name)
  const chosen = filters[name].values as FilterValue<K>[]
  // Something chosen that the menu no longer offers -- a person who left,
  // a label deleted -- is still listed, so it can be unticked.
  const options = [...offered, ...chosen.filter((value) => !offered.includes(value))]
  const switchId = `filter-except-${name}`

  return (
    <div>
      <ul className="max-h-60 overflow-y-auto">
        {options.map((value) => (
          <li key={String(value)}>
            <label className="nav-item cursor-pointer gap-2.5">
              <input
                type="checkbox"
                checked={chosen.includes(value)}
                onChange={() => onChange(toggleValue(filters, name, value, offered))}
                className="h-3.5 w-3.5 shrink-0 accent-[var(--color-brand-600)]"
              />
              <OptionMark name={name} value={value} />
              {name === 'label' ? (
                <span
                  className="chip"
                  style={{
                    ['--chip' as string]: lookups.labels.find((label) => label.id === value)?.color,
                  }}
                >
                  {valueName(name, value, lookups)}
                </span>
              ) : (
                <span className="min-w-0 truncate">{valueName(name, value, lookups)}</span>
              )}
            </label>
          </li>
        ))}
      </ul>

      <div className="mt-1.5 space-y-2 border-t border-neutral-900/5 px-2.5 pt-2.5">
        {name === 'label' && (
          <div className="segmented" role="radiogroup" aria-label={t('filters.labelMatch.label')}>
            {(['any', 'all'] as const).map((match) => (
              <button
                key={match}
                type="button"
                role="radio"
                aria-checked={filters.label.match === match}
                data-active={filters.label.match === match}
                onClick={() => onChange({ ...filters, label: { ...filters.label, match } })}
                className="segmented-item"
              >
                {t(`filters.labelMatch.${match}`)}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={switchId} className="text-sm text-neutral-600">
            {t(`filters.except.${name}`)}
          </label>
          <input
            id={switchId}
            type="checkbox"
            role="switch"
            className="switch"
            checked={filters[name].exclude}
            onChange={(e) =>
              onChange({ ...filters, [name]: { ...filters[name], exclude: e.target.checked } })
            }
          />
        </div>
      </div>
    </div>
  )
}

/** The small mark before a value: an avatar, a status dot, an icon. */
function OptionMark<K extends ManyKey>({ name, value }: { name: K; value: FilterValue<K> }) {
  const { members, statuses } = useTeamContext()
  const { user: me } = useAuth()
  if (name === 'assignee' || name === 'creator') {
    if (value === 'me') return me ? <Avatar user={me} size={20} decorative /> : null
    if (value === 'unassigned') {
      return (
        <span
          aria-hidden="true"
          className="h-5 w-5 shrink-0 rounded-full border border-dashed border-neutral-400"
        />
      )
    }
    const user = members.find((member) => member.user.id === value)?.user
    return user ? <Avatar user={user} size={20} decorative /> : null
  }
  if (name === 'status') {
    const color = statuses.find((status) => status.id === value)?.color
    return (
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: color }}
      />
    )
  }
  if (name === 'priority') {
    return <PriorityIcon priority={value as FilterValue<'priority'>} size={13} />
  }
  if (name === 'type') {
    const meta = TYPE_META[value as FilterValue<'type'>]
    return <Icon name={meta.icon} size={13} style={{ color: meta.color }} />
  }
  if (name === 'severity') {
    const color = SEVERITY_META[value as FilterValue<'severity'>].color
    return (
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: color }}
      />
    )
  }
  return null
}

/** The filters that still take one value: a select, as before. */
function OneSection({
  name,
  filters,
  onChange,
}: {
  name: OneKey
  filters: BoardFilters
  onChange: (filters: BoardFilters) => void
}) {
  const { t } = useTranslation('board')
  const { projects, sprints } = useTeamContext()
  const set = (value: string) =>
    onChange(
      value === ''
        ? withoutFilter(filters, name)
        : {
            ...filters,
            [name]: name === 'due' ? (value as DueFilter) : Number(value),
          },
    )

  return (
    <div className="px-1.5 pt-0.5">
      <Select
        block
        dense
        aria-label={fieldName(name)}
        value={filters[name] ?? ''}
        onChange={(e) => set(e.target.value)}
      >
        {name === 'projectId' && (
          <>
            <option value="">{t('filters.any.project')}</option>
            {pickableProjects(projects, filters.projectId).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </>
        )}
        {name === 'sprintId' && (
          <>
            <option value="">{t('filters.any.sprint')}</option>
            {sprints.map((sprint) => (
              <option key={sprint.id} value={sprint.id}>
                {sprint.display_name}
              </option>
            ))}
          </>
        )}
        {name === 'due' && (
          <>
            <option value="">{t('filters.any.due')}</option>
            {(Object.keys(DUE_FILTER_LABEL) as DueFilter[]).map((due) => (
              <option key={due} value={due}>
                {DUE_FILTER_LABEL[due]}
              </option>
            ))}
          </>
        )}
      </Select>
    </div>
  )
}

/**
 * When a ticket was updated or created (#261): the common windows, or dates.
 *
 * The API's range includes both its days, so "before" a day is up to the day
 * before it and "after" a day from the day after -- the chip names the day
 * that was picked.
 */
type WhenMode = DateWindow | 'before' | 'after' | 'between'

function modeOf(when: WhenFilter): WhenMode | null {
  if (when.window) return when.window
  if (when.from && when.to) return 'between'
  if (when.to) return 'before'
  if (when.from) return 'after'
  return null
}

function WhenSection({
  name,
  filters,
  onChange,
}: {
  name: WhenKey
  filters: BoardFilters
  onChange: (filters: BoardFilters) => void
}) {
  const { t } = useTranslation('board')
  const when = filters[name]
  // A choice of dates is open before a date has been picked for it.
  const [mode, setMode] = useState<WhenMode | null>(() => modeOf(when))
  const set = (next: WhenFilter) => onChange({ ...filters, [name]: next })
  const choose = (next: WhenMode) => {
    if (mode === next) {
      setMode(null)
      set(NO_WHEN)
      return
    }
    setMode(next)
    if ((WINDOW_ORDER as readonly string[]).includes(next)) {
      set({ window: next as DateWindow, from: null, to: null })
    } else {
      set(NO_WHEN)
    }
  }
  const modes: WhenMode[] = [...WINDOW_ORDER, 'before', 'after', 'between']

  return (
    <div>
      <ul role="listbox" aria-label={fieldName(name)}>
        {modes.map((option) => (
          <li key={option}>
            <button
              type="button"
              role="option"
              aria-selected={mode === option}
              data-active={mode === option}
              onClick={() => choose(option)}
              className="nav-item w-full justify-between"
            >
              {t(`filters.when.${option}`)}
              {mode === option && <Icon name="check" size={13} className="text-brand-600" />}
            </button>
          </li>
        ))}
      </ul>
      {(mode === 'before' || mode === 'after') && (
        <label className="mt-1.5 block px-2.5">
          <span className="mb-1 block text-xs text-neutral-500">{t('filters.when.date')}</span>
          <input
            type="date"
            className="field"
            value={
              mode === 'before'
                ? when.to
                  ? shiftDay(when.to, 1)
                  : ''
                : when.from
                  ? shiftDay(when.from, -1)
                  : ''
            }
            onChange={(e) => {
              const day = e.target.value
              if (!day) return set(NO_WHEN)
              set(
                mode === 'before'
                  ? { window: null, from: null, to: shiftDay(day, -1) }
                  : { window: null, from: shiftDay(day, 1), to: null },
              )
            }}
          />
        </label>
      )}
      {mode === 'between' && (
        <div className="mt-1.5 flex gap-2 px-2.5">
          {(['from', 'to'] as const).map((end) => (
            <label key={end} className="min-w-0 flex-1">
              <span className="mb-1 block text-xs text-neutral-500">{t(`filters.when.${end}`)}</span>
              <input
                type="date"
                className="field"
                value={when[end] ?? ''}
                min={end === 'to' ? (when.from ?? undefined) : undefined}
                max={end === 'from' ? (when.to ?? undefined) : undefined}
                onChange={(e) => set({ ...when, window: null, [end]: e.target.value || null })}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

/** No estimate, no epic, no sprint (#261): a box for each. */
function HasNoSection({
  filters,
  onChange,
}: {
  filters: BoardFilters
  onChange: (filters: BoardFilters) => void
}) {
  const { t } = useTranslation('board')
  const { releases } = useTeamContext()
  // "No release" only for a team that has releases (#272), or a link that asks.
  const offered = MISSING_ORDER.filter(
    (field) =>
      field !== 'fix_version' || (releases ?? []).length > 0 || filters.hasNo.includes(field),
  )
  return (
    <ul>
      {offered.map((field) => (
        <li key={field}>
          <label className="nav-item cursor-pointer gap-2.5">
            <input
              type="checkbox"
              checked={filters.hasNo.includes(field)}
              onChange={() =>
                onChange({
                  ...filters,
                  hasNo: MISSING_ORDER.filter(
                    (other) => (other === field) !== filters.hasNo.includes(other),
                  ),
                })
              }
              className="h-3.5 w-3.5 shrink-0 accent-[var(--color-brand-600)]"
            />
            {t(`filters.hasNo.${field}`)}
          </label>
        </li>
      ))}
    </ul>
  )
}

/** Only what the viewer watches (#261). */
function WatchingSection({
  filters,
  onChange,
}: {
  filters: BoardFilters
  onChange: (filters: BoardFilters) => void
}) {
  const { t } = useTranslation('board')
  return (
    <label className="nav-item cursor-pointer gap-2.5">
      <input
        type="checkbox"
        checked={filters.watching}
        onChange={(e) => onChange({ ...filters, watching: e.target.checked })}
        className="h-3.5 w-3.5 shrink-0 accent-[var(--color-brand-600)]"
      />
      {t('filters.watching.option')}
    </label>
  )
}
