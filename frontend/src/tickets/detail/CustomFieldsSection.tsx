import { useState } from 'react'

import { errorDetail } from '@/api/errors'
import type { CustomFieldRead, TicketRead, TicketUpdate } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { CustomFieldControl } from '@/tickets/CustomFieldControl'
import {
  type FieldInput,
  appliesTo,
  displayValue,
  isFilled,
  useCustomFields,
} from '@/tickets/customFields'
import { useTeamContext } from '@/team/useTeamContext'

/**
 * The team's own fields on a ticket (#117), below the built-in properties
 * and in the order the team's admins set.
 *
 * A field the ticket can take is editable. One it cannot -- archived, or
 * bound to another type of ticket -- still shows the value it holds, read
 * only, and is left out when it holds nothing: "values stay readable" is
 * the promise archiving makes.
 */
export function CustomFieldsSection({
  ticket,
  patch,
  readOnly = false,
}: {
  ticket: TicketRead
  patch: (data: TicketUpdate) => Promise<void>
  /** A guest's view (#104). */
  readOnly?: boolean
}) {
  const { t } = useTranslation('tickets')
  const { team } = useTeamContext()
  const fields = useCustomFields(team.id)
  const [error, setError] = useState<string | null>(null)

  const editable = (field: CustomFieldRead) =>
    !field.archived_at && appliesTo(field, ticket.type)
  const shown = fields.filter(
    (field) => editable(field) || isFilled(ticket.custom_fields[field.key]),
  )
  if (shown.length === 0) return null

  const save = async (field: CustomFieldRead, value: FieldInput) => {
    setError(null)
    try {
      await patch({ custom_fields: { [field.key]: value } })
    } catch (err: unknown) {
      // The server's own sentence when it has one: it names the field and
      // says what it takes.
      setError(errorDetail(err, t('customFields.errors.save', { field: field.name })))
    }
  }

  return (
    <fieldset disabled={readOnly} className="well mt-3 min-w-0 rounded-card border-0 p-3">
      {/* Floated so it sits inside the well like any heading, rather than
          on its top edge where a fieldset puts its legend. */}
      <legend className="eyebrow float-left mb-2.5 w-full p-0">
        {t('customFields.heading', { team: team.name })}
      </legend>
      <div className="clear-left grid min-w-0 gap-x-4 gap-y-3 @md:grid-cols-2">
        {shown.map((field) => {
          const value = ticket.custom_fields[field.key]
          const wide = field.kind === 'multi_select'
          return (
            <div
              key={field.id}
              className={`flex min-w-0 items-center justify-between gap-3 ${wide ? '@md:col-span-2' : ''}`}
            >
              <span className="flex shrink-0 items-center gap-1 text-xs text-neutral-500">
                {field.name}
                {field.required && editable(field) && (
                  <span className="text-danger-500" title={t('customFields.requiredMark')}>
                    *
                  </span>
                )}
              </span>
              {editable(field) ? (
                <CustomFieldControl
                  field={field}
                  value={value}
                  label={field.name}
                  onChange={(next) => save(field, next)}
                />
              ) : (
                <span
                  className="truncate text-sm text-neutral-500"
                  title={
                    field.archived_at
                      ? t('customFields.archivedHint')
                      : t('customFields.otherTypeHint')
                  }
                >
                  {value === undefined ? '' : displayValue(field, value)}
                </span>
              )}
            </div>
          )
        })}
        {error && (
          <p role="alert" className="text-xs text-danger-600 @md:col-span-2">
            {error}
          </p>
        )}
      </div>
    </fieldset>
  )
}
