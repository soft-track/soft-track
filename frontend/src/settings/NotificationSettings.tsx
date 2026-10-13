import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  getGetNotificationSettingsNotificationsSettingsGetQueryKey,
  useGetNotificationSettingsNotificationsSettingsGet,
  useUpdateNotificationSettingsNotificationsSettingsPatch,
} from '@/api/generated/endpoints/notifications/notifications'
import type {
  NotificationChannel,
  NotificationKindSetting,
  NotificationSettingsUpdate,
} from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { useTranslation } from '@/i18n'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

/**
 * Which notifications reach you, kind by kind, and where (#263).
 *
 * A grid of each kind against each channel, drawn from the list the server
 * registers -- so a kind added later is a new row here without anyone
 * remembering to add it, and a new channel is a new column. Being assigned
 * and being mentioned are always on in the app, and say so. Below the grid,
 * each team you are on can be muted.
 */
export default function NotificationSettings() {
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const settingsQuery = useGetNotificationSettingsNotificationsSettingsGet()
  const update = useUpdateNotificationSettingsNotificationsSettingsPatch()
  const [error, setError] = useState<string | null>(null)

  const settings = settingsQuery.data
  if (settingsQuery.isLoading || !settings) {
    return (
      <div className="glass-strong rounded-panel p-6">
        <Loading />
      </div>
    )
  }

  const save = async (data: NotificationSettingsUpdate) => {
    setError(null)
    try {
      const saved = await update.mutateAsync({ data })
      queryClient.setQueryData(getGetNotificationSettingsNotificationsSettingsGetQueryKey(), saved)
    } catch (err: unknown) {
      setError(errorDetail(err, t('notifications.errors.save')))
    }
  }

  // The server's English is the fallback, for a kind registered without a
  // translation yet.
  const kindName = (kind: NotificationKindSetting) =>
    t(`notifications.kinds.${kind.kind}.name`, { defaultValue: kind.name })
  const kindDescription = (kind: NotificationKindSetting) =>
    t(`notifications.kinds.${kind.kind}.description`, { defaultValue: kind.description })
  const channelLabel = (channel: NotificationChannel) =>
    t(`notifications.channels.${channel}`, { defaultValue: channel })

  const columns = `minmax(0, 1fr) repeat(${settings.channels.length}, clamp(4.5rem, 14vw, 8rem))`

  return (
    <div className="space-y-4">
      <section className="glass-strong rounded-panel p-6" aria-labelledby="notifications-heading">
        <h1 id="notifications-heading" className="text-lg font-semibold tracking-tight text-neutral-900">
          {t('notifications.title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">{t('notifications.intro')}</p>

        {error && (
          <div role="alert" className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {error}
          </div>
        )}

        <div role="table" className="mt-6">
          <div role="row" className="grid items-end pb-2" style={{ gridTemplateColumns: columns }}>
            {/* A grid cell of its own: sr-only alone is positioned out of the grid. */}
            <span role="columnheader">
              <span className="sr-only">{t('notifications.title')}</span>
            </span>
            {settings.channels.map((channel) => (
              <span key={channel} role="columnheader" className="text-center text-xs text-neutral-500">
                {channelLabel(channel)}
              </span>
            ))}
          </div>
          {settings.kinds.map((kind) => {
            const name = kindName(kind)
            const description = kindDescription(kind)
            return (
              <div
                key={kind.kind}
                role="row"
                className="hairline grid items-center border-b py-3 last:border-b-0"
                style={{ gridTemplateColumns: columns }}
              >
                <div role="rowheader" className="min-w-0">
                  <span className="block text-sm text-neutral-800">{name}</span>
                  {description && <span className="block text-xs text-neutral-500">{description}</span>}
                </div>
                {kind.channels.map((cell) => (
                  <div key={cell.channel} role="cell" className="flex justify-center">
                    {cell.locked ? (
                      <span
                        className="flex items-center gap-1 text-xs text-neutral-500"
                        title={t('notifications.alwaysHint')}
                      >
                        <Icon name="lock" size={12} />
                        {t('notifications.always')}
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        role="switch"
                        className="switch shrink-0"
                        aria-label={t('notifications.switchLabel', {
                          kind: name,
                          channel: channelLabel(cell.channel).toLowerCase(),
                        })}
                        checked={cell.enabled}
                        disabled={update.isPending}
                        onChange={(e) =>
                          void save({
                            preferences: [{ kind: kind.kind, channel: cell.channel, enabled: e.target.checked }],
                          })
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        {!settings.email_delivery_configured && (
          // No column at all rather than a disabled one, as the single email
          // switch was hidden before: a switch that cannot send anything reads
          // as a bug in the app rather than a missing setting on the server.
          <p className="hairline mt-1 border-t pt-3 text-xs text-neutral-500">{t('notifications.noMailServer')}</p>
        )}
      </section>

      {settings.teams.length > 0 && (
        <section className="glass-strong rounded-panel p-6" aria-labelledby="notifications-teams-heading">
          <p id="notifications-teams-heading" className="eyebrow">
            {t('notifications.teams.heading')}
          </p>
          {settings.teams.map((team) => {
            const switchId = `notifications-team-${team.team_id}`
            return (
              <div
                key={team.team_id}
                className="hairline flex items-center justify-between gap-4 border-b py-3 last:border-b-0"
              >
                <label htmlFor={switchId} className="min-w-0">
                  <span className="block text-sm text-neutral-800">{team.name}</span>
                  <span className="block text-sm text-neutral-500">
                    {team.muted ? t('notifications.teams.muted') : t('notifications.teams.on')}
                  </span>
                </label>
                <input
                  id={switchId}
                  type="checkbox"
                  role="switch"
                  className="switch shrink-0"
                  checked={!team.muted}
                  disabled={update.isPending}
                  onChange={(e) => void save({ teams: [{ team_id: team.team_id, muted: !e.target.checked }] })}
                />
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}
