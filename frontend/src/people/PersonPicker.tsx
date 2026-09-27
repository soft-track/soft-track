import { type KeyboardEvent, useId, useState } from 'react'

import type { PersonRef } from '@/api/generated/models'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'

export type PersonOption = Pick<
  PersonRef,
  'id' | 'username' | 'full_name' | 'avatar_color' | 'job_title'
>

/**
 * Pick one person by typing part of their name (#124).
 *
 * A combobox rather than a `<select>`: the people to choose from are every
 * account on the instance, which is not a list to scroll. The parent does the
 * searching -- it knows which endpoint may be asked -- and passes the matches
 * in; this owns the typing, the list and the keyboard. The last option is
 * always "nobody", so clearing is a choice like any other.
 */
export function PersonPicker({
  label,
  value,
  results,
  onSearch,
  onChange,
  noneLabel,
  placeholder,
}: {
  label: string
  value: PersonOption | null
  /** The people matching what was last passed to `onSearch`. */
  results: PersonOption[]
  onSearch: (query: string) => void
  onChange: (person: PersonOption | null) => void
  /** What "nobody" is called: "No manager". */
  noneLabel: string
  placeholder: string
}) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const options: (PersonOption | null)[] = [...results, null]
  const active = Math.min(highlighted, options.length - 1)

  const search = (text: string) => {
    setQuery(text)
    setHighlighted(0)
    onSearch(text)
  }

  const choose = (person: PersonOption | null) => {
    onChange(person)
    setOpen(false)
    setQuery('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        search(query)
        return
      }
      const step = event.key === 'ArrowDown' ? 1 : -1
      setHighlighted((active + step + options.length) % options.length)
    } else if (event.key === 'Enter' && open) {
      // The pick, not the form around it.
      event.preventDefault()
      choose(options[active])
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2">
        {value && !open ? (
          <Avatar user={value} size={16} decorative />
        ) : (
          <Icon name="search" size={13} className="text-neutral-400" />
        )}
      </span>
      <input
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        value={open ? query : (value?.full_name ?? '')}
        placeholder={open ? placeholder : noneLabel}
        onFocus={() => {
          setOpen(true)
          search('')
        }}
        onChange={(e) => {
          if (!open) setOpen(true)
          search(e.target.value)
        }}
        onBlur={() => {
          // Let a click on an option land before the list closes.
          setTimeout(() => {
            setOpen(false)
            setQuery('')
          }, 120)
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        className="field field-sm pl-8"
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="glass-strong pop-in absolute left-0 top-full z-30 mt-1 max-h-64 w-full min-w-56 overflow-y-auto rounded-card p-1"
        >
          {options.map((person, index) => (
            <li
              key={person?.id ?? 'none'}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setHighlighted(index)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(person)}
              className={`flex cursor-pointer items-center gap-2 rounded-control px-2.5 py-1.5 text-sm ${
                index === active ? 'bg-brand-500/12' : ''
              } ${person ? '' : 'hairline mt-1 border-t text-neutral-500'}`}
            >
              {person ? (
                <>
                  <Avatar user={person} size={18} decorative />
                  <span className="truncate font-medium text-neutral-900">{person.full_name}</span>
                  {person.job_title && (
                    <span className="ml-auto truncate pl-2 text-xs text-neutral-400">
                      {person.job_title}
                    </span>
                  )}
                </>
              ) : (
                noneLabel
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
