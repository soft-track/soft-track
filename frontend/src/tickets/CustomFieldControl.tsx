import { useState } from 'react'

import type { CustomFieldRead } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import {
  type FieldInput,
  type FieldValue,
  isPerson,
  shortUrl,
} from '@/tickets/customFields'
import { activeMembers } from '@/team/members'
import { useTeamContext } from '@/team/useTeamContext'
import { Icon } from '@/ui/Icon'
import { Select } from '@/ui/Select'

/**
 * The editor for one of the team's own fields (#117), whatever its kind.
 *
 * Native controls, like the built-in properties beside it: a select for a
 * person or an option, chips for several options, a date, a checkbox, and
 * text boxes for the rest. `live` is the form's way of working -- every
 * keystroke is the value -- where the ticket panel saves a typed value when
 * the box is left or Enter is pressed, so a half-typed link is not a PATCH.
 */
export function CustomFieldControl({
  field,
  value,
  onChange,
  label,
  placeholder,
  live = false,
  invalid = false,
}: {
  field: CustomFieldRead
  /** As the ticket reads it, or -- in a form -- as it will be sent. */
  value: FieldValue | FieldInput | undefined
  onChange: (value: FieldInput) => void
  /** The control's accessible name. */
  label: string
  /** The empty choice's words; the panel's "None" when left out. */
  placeholder?: string
  live?: boolean
  /** A required field left empty: drawn in the danger colour. */
  invalid?: boolean
}) {
  const { t } = useTranslation('tickets')
  const { members } = useTeamContext()
  const invalidProps = invalid ? { 'aria-invalid': true as const } : {}

  switch (field.kind) {
    case 'user': {
      // A ticket's value is the person; a form's is who was picked, by id.
      const current = isPerson(value) ? value : null
      const currentId = current?.id ?? (typeof value === 'number' ? value : null)
      const people = activeMembers(members, currentId)
      return (
        <Select
          dense
          aria-label={label}
          value={currentId ?? ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          {...invalidProps}
        >
          <option value="">{placeholder ?? t('customFields.nobody')}</option>
          {/* Somebody who has since left the team is still who it says. */}
          {current && !people.some((person) => person.id === current.id) && (
            <option value={current.id}>{current.full_name}</option>
          )}
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.full_name}
            </option>
          ))}
        </Select>
      )
    }

    case 'select':
      return (
        <Select
          dense
          aria-label={label}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || null)}
          {...invalidProps}
        >
          <option value="">{placeholder ?? t('customFields.none')}</option>
          {field.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      )

    case 'multi_select': {
      const chosen = Array.isArray(value) ? value : []
      return (
        <span
          role="group"
          aria-label={label}
          className={`flex flex-wrap gap-1.5 ${invalid ? 'rounded-full ring-2 ring-danger-500/40' : ''}`}
        >
          {field.options.map((option) => {
            const active = chosen.includes(option.id)
            return (
              <button
                key={option.id}
                type="button"
                data-active={active}
                aria-pressed={active}
                onClick={() => {
                  const next = active
                    ? chosen.filter((id) => id !== option.id)
                    : [...chosen, option.id]
                  // In the field's own order, the way the API stores it.
                  onChange(field.options.map((o) => o.id).filter((id) => next.includes(id)))
                }}
                className="chip chip-toggle"
                style={{ ['--chip' as string]: 'var(--color-brand-500)' }}
              >
                {option.name}
              </button>
            )
          })}
        </span>
      )
    }

    case 'date':
      return (
        <input
          type="date"
          aria-label={label}
          title={label}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || null)}
          className="field field-sm w-auto"
          {...invalidProps}
        />
      )

    case 'checkbox':
      return (
        <input
          type="checkbox"
          aria-label={label}
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 shrink-0 accent-[var(--color-brand-600)]"
          {...invalidProps}
        />
      )

    default:
      return (
        <TypedValue
          field={field}
          value={value}
          onChange={onChange}
          label={label}
          placeholder={placeholder}
          live={live}
          invalid={invalid}
        />
      )
  }
}

/** Text, a number or a link: typed, and saved as a whole value. */
function TypedValue({
  field,
  value,
  onChange,
  label,
  placeholder,
  live,
  invalid,
}: {
  field: CustomFieldRead
  value: FieldValue | FieldInput | undefined
  onChange: (value: FieldInput) => void
  label: string
  placeholder?: string
  live: boolean
  invalid: boolean
}) {
  const { t } = useTranslation('tickets')
  const saved = value === undefined || value === null || isPerson(value) ? '' : String(value)
  const [draft, setDraft] = useState(saved)
  // A link is shown as one, and edited on request -- a box is a poor way to
  // read an address and no way at all to follow it.
  const [editing, setEditing] = useState(false)

  // Take the ticket's value again whenever it changes underneath: after a
  // save, or when someone else changes it. Done in render, as in
  // useTicketEditor, rather than an effect that would show the old one first.
  // Not in a form, which owns what is typed: "2." read back would be "2".
  const [seededFrom, setSeededFrom] = useState(saved)
  if (!live && saved !== seededFrom) {
    setSeededFrom(saved)
    setDraft(saved)
  }

  const parse = (text: string): FieldInput => {
    const trimmed = text.trim()
    if (!trimmed) return null
    if (field.kind === 'number') {
      const number = Number(trimmed)
      return Number.isFinite(number) ? number : trimmed
    }
    return trimmed
  }

  const commit = () => {
    setEditing(false)
    if (draft.trim() !== saved) onChange(parse(draft))
  }

  if (field.kind === 'url' && !live && saved && !editing) {
    return (
      <span className="flex min-w-0 items-center gap-1">
        <a
          href={saved}
          target="_blank"
          rel="noopener noreferrer"
          title={saved}
          className="flex min-w-0 items-center gap-1 text-sm text-brand-600 hover:underline"
        >
          <span className="truncate">{shortUrl(saved)}</span>
          <Icon name="external" size={12} className="shrink-0" />
        </a>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={t('customFields.editLink', { field: field.name })}
          title={t('customFields.editLink', { field: field.name })}
          className="btn btn-ghost btn-icon btn-xs shrink-0 text-neutral-400"
        >
          <Icon name="pencil" size={12} />
        </button>
      </span>
    )
  }

  return (
    <input
      type={field.kind === 'number' ? 'number' : field.kind === 'url' ? 'url' : 'text'}
      step={field.kind === 'number' ? 'any' : undefined}
      aria-label={label}
      value={draft}
      autoFocus={editing}
      placeholder={placeholder ?? (field.kind === 'url' ? 'https://' : undefined)}
      maxLength={field.kind === 'text' ? 500 : undefined}
      onChange={(e) => {
        setDraft(e.target.value)
        if (live) onChange(parse(e.target.value))
      }}
      onBlur={live ? undefined : commit}
      onKeyDown={(e) => {
        if (live) return
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
        // The first Escape puts the value back; the next one reaches the panel.
        if (e.key === 'Escape' && (draft !== saved || editing)) {
          e.stopPropagation()
          setDraft(saved)
          setEditing(false)
        }
      }}
      className={`field field-sm min-w-0 max-w-full ${field.kind === 'number' ? 'w-28' : 'w-48'} ${
        live ? '' : 'field-quiet text-right'
      }`}
      {...(invalid ? { 'aria-invalid': true as const } : {})}
    />
  )
}
