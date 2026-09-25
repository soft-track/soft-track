import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  getGetNotificationSettingsNotificationsSettingsGetQueryKey,
  useGetNotificationSettingsNotificationsSettingsGet,
  useUpdateNotificationSettingsNotificationsSettingsPatch,
} from '@/api/generated/endpoints/notifications/notifications'
import { errorDetail } from '@/api/errors'
import { Trans, useTranslation } from '@/i18n'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

/**
 * What SoftTrack tells you about, and whether any of it reaches your inbox.
 *
 * The list of events is deliberately not configurable. Four switches nobody
 * changes is worse than one sentence saying what the four are -- and the
 * per-issue mute (the Watch button) is the control people actually reach for.
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

  const setEmail = async (value: boolean) => {
    setError(null)
    try {
      await update.mutateAsync({ data: { email_notifications: value } })
      queryClient.invalidateQueries({
        queryKey: getGetNotificationSettingsNotificationsSettingsGetQueryKey(),
      })
    } catch (err: unknown) {
      setError(errorDetail(err, t('notifications.errors.save')))
    }
  }

  return (
    <div className="glass-strong sheen rounded-panel p-6">
      <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
        {t('notifications.title')}
      </h1>
      <p className="mt-1 text-sm text-neutral-500">{t('notifications.intro')}</p>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {error}
        </div>
      )}

      <div className="mt-6">
        <p className="eyebrow mb-2">{t('notifications.inApp.heading')}</p>
        <p className="text-sm text-neutral-600">{t('notifications.inApp.body')}</p>
        <p className="mt-2 text-sm text-neutral-500">{t('notifications.inApp.alwaysOn')}</p>
      </div>

      <div className="hairline mt-6 border-t pt-6">
        <p className="eyebrow mb-2">{t('notifications.email.heading')}</p>
        {settings.email_delivery_configured ? (
          <>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={settings.email_notifications}
                onChange={(e) => setEmail(e.target.checked)}
                disabled={update.isPending}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand-600)]"
              />
              <span>
                <span className="block text-sm font-medium text-neutral-700">
                  {t('notifications.email.digest')}
                </span>
                <span className="mt-0.5 block text-xs text-neutral-500">
                  {t('notifications.email.digestHint')}
                </span>
              </span>
            </label>
            {settings.email_notifications && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-neutral-400">
                <Icon name="mail" size={13} />
                {t('notifications.email.destination')}
              </p>
            )}
          </>
        ) : (
          // No switch at all rather than a disabled one: a toggle that cannot
          // change anything reads as a bug in the app rather than a missing
          // setting on the server.
          <p className="text-sm text-neutral-500">
            <Trans
              t={t}
              i18nKey="notifications.email.notConfigured"
              components={{ code: <code className="identifier" /> }}
            />
          </p>
        )}
      </div>
    </div>
  )
}
