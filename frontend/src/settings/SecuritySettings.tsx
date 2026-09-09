import { type FormEvent, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

import {
  useChangeMyPasswordAuthMePasswordPost,
  useSignOutEverywhereRouteAuthMeSignOutEverywherePost,
} from '@/api/generated/endpoints/auth/auth'
import { errorDetail } from '@/api/errors'
import { AXIOS_INSTANCE } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { Icon } from '@/ui/Icon'

interface EnrolData {
  provisioning_uri: string
  manual_key: string
}

export default function SecuritySettings() {
  const { user, setSession } = useAuth()
  const changePassword = useChangeMyPasswordAuthMePasswordPost()
  const signOutEverywhere = useSignOutEverywhereRouteAuthMeSignOutEverywherePost()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [enrolData, setEnrolData] = useState<EnrolData | null>(null)
  const [confirmCode, setConfirmCode] = useState('')
  const [enrolError, setEnrolError] = useState<string | null>(null)
  const [enrolLoading, setEnrolLoading] = useState(false)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [copiedCodes, setCopiedCodes] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)

  const [showDisableModal, setShowDisableModal] = useState(false)
  const [disableCode, setDisableCode] = useState('')
  const [disableError, setDisableError] = useState<string | null>(null)
  const [disableLoading, setDisableLoading] = useState(false)

  const onPasswordSubmit = async (event: FormEvent) => {
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

  const startEnrolment = async () => {
    setEnrolError(null)
    setEnrolLoading(true)
    try {
      const res = await AXIOS_INSTANCE.post<EnrolData>('/auth/totp/enrol')
      setEnrolData(res.data)
      setConfirmCode('')
      setCopiedKey(false)
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not begin two-factor setup.'))
    } finally {
      setEnrolLoading(false)
    }
  }

  const onConfirmEnrolment = async (event: FormEvent) => {
    event.preventDefault()
    setEnrolError(null)
    setEnrolLoading(true)
    try {
      const res = await AXIOS_INSTANCE.post<{
        recovery_codes: string[]
        token: { access_token: string; user: Parameters<typeof setSession>[1] }
      }>('/auth/totp/confirm', { code: confirmCode.trim() })
      setEnrolData(null)
      setRecoveryCodes(res.data.recovery_codes)
      if (res.data.token) {
        setSession(res.data.token.access_token, res.data.token.user)
      }
    } catch (err: unknown) {
      setEnrolError(errorDetail(err, 'Invalid code. Check your authenticator app.'))
    } finally {
      setEnrolLoading(false)
    }
  }

  const onFinishEnrolment = () => {
    setRecoveryCodes(null)
    setNotice('Two-factor authentication enabled successfully.')
  }

  const onDisableSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setDisableError(null)
    setDisableLoading(true)
    try {
      const res = await AXIOS_INSTANCE.post<{
        access_token: string
        user: Parameters<typeof setSession>[1]
      }>('/auth/totp/disable', {
        code: disableCode.trim(),
      })
      if (res.data.access_token) {
        setSession(res.data.access_token, res.data.user)
      }
      setShowDisableModal(false)
      setDisableCode('')
      setNotice('Two-factor authentication disabled.')
    } catch (err: unknown) {
      setDisableError(
        errorDetail(err, 'Invalid code. Enter a code from your authenticator or a recovery code.'),
      )
    } finally {
      setDisableLoading(false)
    }
  }

  const copyRecoveryCodes = async () => {
    if (!recoveryCodes) return
    await navigator.clipboard.writeText(recoveryCodes.join('\n'))
    setCopiedCodes(true)
    setTimeout(() => setCopiedCodes(false), 2000)
  }

  const copyManualKey = async (key: string) => {
    await navigator.clipboard.writeText(key)
    setCopiedKey(true)
    setTimeout(() => setCopiedKey(false), 2000)
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onPasswordSubmit} className="glass-strong sheen rounded-panel p-6">
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

      {/* Two-Factor Authentication (TOTP) */}
      <section className="glass-strong rounded-panel p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-neutral-900">
              Two-factor authentication
            </h2>
            <p className="mt-1 max-w-prose text-sm text-neutral-500">
              Protect your account with a time-based one-time password (TOTP) app like
              Google Authenticator, 1Password, or Authy.
            </p>
          </div>
          {user?.totp_enabled ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              <Icon name="check" size={14} className="text-emerald-600" />
              Active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-600">
              Off
            </span>
          )}
        </div>

        <div className="mt-4">
          {user?.totp_enabled ? (
            <button
              type="button"
              onClick={() => {
                setShowDisableModal(true)
                setDisableCode('')
                setDisableError(null)
              }}
              className="btn btn-danger"
            >
              Disable 2FA
            </button>
          ) : (
            <button
              type="button"
              onClick={startEnrolment}
              disabled={enrolLoading}
              className="btn btn-primary"
            >
              <Icon name="shield" size={15} />
              {enrolLoading ? 'Setting up…' : 'Set up two-factor authentication'}
            </button>
          )}
        </div>
      </section>

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

      {enrolData && (
        <div className="scrim fixed inset-0 z-30 flex items-start justify-center px-4 pt-[8vh] overflow-y-auto pb-8">
          <form
            role="dialog"
            aria-label="Set up two-factor authentication"
            onSubmit={onConfirmEnrolment}
            onClick={(e) => e.stopPropagation()}
            className="pop-in glass-strong w-full max-w-md rounded-panel p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold tracking-tight text-neutral-900">
                Set up two-factor authentication
              </h2>
              <button
                type="button"
                onClick={() => setEnrolData(null)}
                className="text-neutral-400 hover:text-neutral-600"
                aria-label="Close"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <p className="text-xs text-neutral-500">
              1. Scan this QR code with your authenticator app (Google Authenticator, 1Password, etc.):
            </p>

            <div className="flex justify-center rounded-control bg-white p-4 shadow-sm border border-neutral-200">
              <QRCodeSVG value={enrolData.provisioning_uri} size={180} />
            </div>

            <div className="space-y-1">
              <span className="text-xs font-medium text-neutral-600">
                Or enter this manual key:
              </span>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-control bg-neutral-100 px-2 py-1 font-mono text-xs text-neutral-800 break-all select-all">
                  {enrolData.manual_key}
                </code>
                <button
                  type="button"
                  onClick={() => copyManualKey(enrolData.manual_key)}
                  className="btn btn-secondary h-8 px-2 text-xs"
                >
                  <Icon name="copy" size={13} />
                  {copiedKey ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            <div className="pt-2 border-t border-neutral-200">
              <label htmlFor="confirm-totp" className="mb-1.5 block text-xs font-medium text-neutral-700">
                2. Enter the 6-digit code shown in your authenticator app:
              </label>
              <input
                id="confirm-totp"
                type="text"
                required
                autoFocus
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                placeholder="000000"
                className="field text-center font-mono tracking-widest text-lg"
              />
            </div>

            {enrolError && (
              <div
                role="alert"
                className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
              >
                {enrolError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEnrolData(null)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={enrolLoading || confirmCode.trim().length === 0}
                className="btn btn-primary"
              >
                {enrolLoading ? 'Verifying…' : 'Activate 2FA'}
              </button>
            </div>
          </form>
        </div>
      )}

      {recoveryCodes && (
        <div className="scrim fixed inset-0 z-30 flex items-start justify-center px-4 pt-[10vh]">
          <div
            role="dialog"
            aria-label="Recovery codes"
            onClick={(e) => e.stopPropagation()}
            className="pop-in glass-strong w-full max-w-md rounded-panel p-6 space-y-4"
          >
            <div className="flex items-center gap-2 text-amber-600">
              <Icon name="shield" size={20} />
              <h2 className="text-base font-semibold text-neutral-900">
                Save your recovery codes
              </h2>
            </div>

            <p className="text-xs text-neutral-500">
              These codes can be used to sign in if you lose access to your authenticator app.
              Each code can only be used once. <strong>These will not be shown again.</strong>
            </p>

            <div className="grid grid-cols-2 gap-2 rounded-control bg-neutral-100 p-3 font-mono text-xs text-neutral-800">
              {recoveryCodes.map((c, i) => (
                <div key={i} className="py-0.5 select-all">
                  {c}
                </div>
              ))}
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                type="button"
                onClick={copyRecoveryCodes}
                className="btn btn-secondary text-xs"
              >
                <Icon name="copy" size={14} />
                {copiedCodes ? 'Copied to clipboard!' : 'Copy recovery codes'}
              </button>
              <button
                type="button"
                onClick={onFinishEnrolment}
                className="btn btn-primary text-xs"
              >
                I have saved my codes
              </button>
            </div>
          </div>
        </div>
      )}

      {showDisableModal && (
        <div className="scrim fixed inset-0 z-30 flex items-start justify-center px-4 pt-[15vh]">
          <form
            role="dialog"
            aria-label="Disable two-factor authentication"
            onSubmit={onDisableSubmit}
            onClick={(e) => e.stopPropagation()}
            className="pop-in glass-strong w-full max-w-sm rounded-panel p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-900">
                Disable two-factor authentication
              </h2>
              <button
                type="button"
                onClick={() => setShowDisableModal(false)}
                className="text-neutral-400 hover:text-neutral-600"
                aria-label="Close"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <p className="text-xs text-neutral-500">
              Enter a code from your authenticator app, or a recovery code, to confirm disabling 2FA.
            </p>

            {disableError && (
              <div
                role="alert"
                className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
              >
                {disableError}
              </div>
            )}

            <div>
              <label htmlFor="disable-totp-code" className="mb-1.5 block text-xs font-medium text-neutral-700">
                Code
              </label>
              <input
                id="disable-totp-code"
                type="text"
                required
                autoFocus
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
                placeholder="6-digit code or recovery code"
                className="field text-center font-mono tracking-wider"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDisableModal(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={disableLoading || disableCode.trim().length === 0}
                className="btn btn-danger"
              >
                {disableLoading ? 'Disabling…' : 'Disable 2FA'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
