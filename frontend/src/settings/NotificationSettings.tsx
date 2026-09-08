import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  getGetNotificationSettingsNotificationsSettingsGetQueryKey,
  useGetNotificationSettingsNotificationsSettingsGet,
  useUpdateNotificationSettingsNotificationsSettingsPatch,
} from '@/api/generated/endpoints/notifications/notifications'
import { errorDetail } from '@/api/errors'
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
      setError(errorDetail(err, 'Could not save that.'))
    }
  }

  return (
    <div className="glass-strong sheen rounded-panel p-6">
      <h1 className="text-lg font-semibold tracking-tight text-neutral-900">Notifications</h1>
      <p className="mt-1 text-sm text-neutral-500">
        What reaches you, and where.
      </p>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {error}
        </div>
      )}

      <div className="mt-6">
        <p className="eyebrow mb-2">In the app</p>
        <p className="text-sm text-neutral-600">
          You are told when an issue is assigned to you, when someone mentions you, and
          when an issue you are watching gets a comment or changes status. You watch an
          issue automatically once you create it, comment on it, or are assigned it —
          and the Watch button on any issue overrides that either way.
        </p>
        <p className="mt-2 text-sm text-neutral-500">
          This cannot be turned off; the inbox is how the tracker reaches you at all.
        </p>
      </div>

      <div className="hairline mt-6 border-t pt-6">
        <p className="eyebrow mb-2">By email</p>
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
                  Send me a digest
                </span>
                <span className="mt-0.5 block text-xs text-neutral-500">
                  One email gathering up anything you have not already read. Nothing is
                  sent while you are keeping up with the inbox yourself.
                </span>
              </span>
            </label>
            {settings.email_notifications && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-neutral-400">
                <Icon name="mail" size={13} />
                Digests go to the address on your profile.
              </p>
            )}
          </>
        ) : (
          // No switch at all rather than a disabled one: a toggle that cannot
          // change anything reads as a bug in the app rather than a missing
          // setting on the server.
          <p className="text-sm text-neutral-500">
            This SoftTrack has no mail server configured, so nothing is sent by email.
            An administrator can set <code className="identifier">SMTP_HOST</code> to
            turn digests on.
          </p>
        )}
      </div>
    </div>
  )
}
