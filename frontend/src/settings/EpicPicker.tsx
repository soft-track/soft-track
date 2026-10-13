import type { EpicRef, ProjectRead } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { formatList } from '@/i18n/format'
import { Icon } from '@/ui/Icon'
import { Select } from '@/ui/Select'

/**
 * The epics somebody from outside the organisation may see (#243): the ones
 * chosen, each removable, and the team's others to add. No epic means no
 * tickets, and the picker says so rather than leaving an empty row.
 */
export function EpicPicker({
  epics,
  chosen,
  onChange,
  disabled = false,
}: {
  /** The team's epics. Archived ones are offered only if already chosen. */
  epics: ProjectRead[]
  chosen: number[]
  onChange: (next: number[]) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('settings')
  const byId = new Map(epics.map((epic) => [epic.id, epic]))
  const picked = chosen.map((id) => byId.get(id)).filter((epic) => epic !== undefined)
  const addable = epics.filter((epic) => !epic.archived && !chosen.includes(epic.id))

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {picked.map((epic) => (
        <span
          key={epic.id}
          className="chip"
          style={{ ['--chip' as string]: epic.color }}
        >
          {epic.name}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(chosen.filter((id) => id !== epic.id))}
            aria-label={t('members.epics.remove', { name: epic.name })}
            className="-mr-1 ml-0.5 rounded-full p-0.5 hover:bg-neutral-900/10"
          >
            <Icon name="close" size={11} />
          </button>
        </span>
      ))}
      {addable.length > 0 && (
        <Select
          dense
          value=""
          disabled={disabled}
          onChange={(e) => {
            if (e.target.value) onChange([...chosen, Number(e.target.value)])
          }}
          aria-label={t('members.epics.add')}
        >
          <option value="">{t('members.epics.add')}</option>
          {addable.map((epic) => (
            <option key={epic.id} value={epic.id}>
              {epic.name}
            </option>
          ))}
        </Select>
      )}
      {chosen.length === 0 && (
        <span className="text-xs text-neutral-500">{t('members.epics.none')}</span>
      )}
    </div>
  )
}

/** What a membership from outside reaches, in a few words (#243). */
export function EpicScope({ epics }: { epics: EpicRef[] }) {
  const { t } = useTranslation('settings')
  return (
    <span className="text-xs text-neutral-500">
      {epics.length === 0
        ? t('members.scope.nothing')
        : t('members.scope.only', { names: formatList(epics.map((epic) => epic.name)) })}
    </span>
  )
}
