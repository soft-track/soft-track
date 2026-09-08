import { type FormEvent, useState } from 'react'

import {
  useChangeMyPasswordAuthMePasswordPost,
  useSignOutEverywhereRouteAuthMeSignOutEverywherePost,
} from '@/api/generated/endpoints/auth/auth'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/AuthContext'
import { Icon } from '@/ui/Icon'

export default function SecuritySettings() {
  const { setSession } = useAuth()
  const changePassword = useChangeMyPasswordAuthMePasswordPost()
  const signOutEverywhere = useSignOutEverywhereRouteAuthMeSignOutEverywherePost()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setNotice(null)

    if (next !== confirm) {
      setError('The two new passwords do not match.')
      return
    }

    try {
      const token = await changePassword.mutateAsync({
        data: { current_password: current, new_password: next },
      })
      // The change invalidated every token including this tab's, so adopt the
      // fresh one the API returned rather than being bounced to /login.
      setSession(token.access_token, token.user)
      setCurrent('')
      setNext('')
      setConfirm('')
      setNotice('Password changed. Every other session has been signed out.')
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not change your password.'))
    }
  }

  const onSignOutEverywhere = async () => {
    if (
      !window.confirm(
        'Sign out of every other browser and device? You will stay signed in here.',
      )
    ) {
      return
    }
    setError(null)
    setNotice(null)
    try {
      const token = await signOutEverywhere.mutateAsync()
      setSession(token.access_token, token.user)
      setNotice('Signed out everywhere else.')
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not sign out the other sessions.'))
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="glass-strong sheen rounded-panel p-6">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">Security</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Changing your password signs out every other session.
        </p>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
        )}
        {notice && !error && (
          <p className="mt-4 flex items-center gap-1.5 text-sm text-neutral-500">
            <Icon name="check" size={14} className="text-accent-mint" />
            {notice}
          </p>
        )}

        <div className="mt-6 max-w-sm space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-neutral-700">
              Current password
            </span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="field"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-neutral-700">
              New password
            </span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="field"
              placeholder="At least 8 characters"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-neutral-700">
              Confirm new password
            </span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="field"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end">
          <button type="submit" disabled={changePassword.isPending} className="btn btn-primary">
            {changePassword.isPending ? 'Changing…' : 'Change password'}
          </button>
        </div>
      </form>

      <section className="glass-strong rounded-panel p-6">
        <h2 className="text-base font-semibold tracking-tight text-neutral-900">
          Sign out everywhere
        </h2>
        <p className="mt-1 max-w-prose text-sm text-neutral-500">
          Ends every session on every other browser and device — a laptop left at the
          office, a phone you no longer have. You stay signed in here.
        </p>
        <button
          type="button"
          onClick={onSignOutEverywhere}
          disabled={signOutEverywhere.isPending}
          className="btn btn-secondary mt-4"
        >
          <Icon name="logout" size={15} />
          {signOutEverywhere.isPending ? 'Signing out…' : 'Sign out everywhere'}
        </button>
      </section>
    </div>
  )
}
