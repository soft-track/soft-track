import { type FormEvent, type KeyboardEvent, useId, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

import { errorDetail } from '@/api/errors'
import {
  useTotpConfirmAuthTotpConfirmPost,
  useTotpDisableAuthTotpDisablePost,
  useTotpEnrolAuthTotpEnrolPost,
} from '@/api/generated/endpoints/auth/auth'
import type { Token, TotpEnrolmentResult, TotpEnrolmentStart } from '@/api/generated/models'
import { useAuth } from '@/auth/useAuth'
import { useTranslation } from '@/i18n'
import { Icon } from '@/ui/Icon'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * Two-factor authentication with an authenticator app (TOTP).
 *
 * Turning it on and turning it off both sign out every other session, and
 * both hand back a fresh token for this tab -- adopted here, or the person
 * who just secured their account would be the one thrown out of it.
 */
export function TwoFactorAuth() {
  const { user, setSession } = useAuth()
  const { t } = useTranslation(['settings', 'common'])
  const enrol = useTotpEnrolAuthTotpEnrolPost()

  const [setup, setSetup] = useState<TotpEnrolmentStart | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [disabling, setDisabling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const enabled = user?.totp_enabled === true

  const onStart = async () => {
    setError(null)
    setNotice(null)
    try {
      setSetup(await enrol.mutateAsync())
    } catch (err: unknown) {
      setError(errorDetail(err, t('twoFactor.errors.start')))
    }
  }

  return (
    <section className="glass-strong rounded-panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-neutral-900">
            {t('twoFactor.title')}
          </h2>
          <p className="mt-1 max-w-prose text-sm text-neutral-500">{t('twoFactor.body')}</p>
        </div>
        <span
          className={
            enabled
              ? 'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700'
              : 'inline-flex shrink-0 items-center rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-600'
          }
        >
          {enabled && <Icon name="check" size={14} className="text-emerald-600" />}
          {enabled ? t('twoFactor.on') : t('twoFactor.off')}
        </span>
      </div>

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

      <div className="mt-4">
        {enabled ? (
          <button
            type="button"
            onClick={() => {
              setNotice(null)
              setDisabling(true)
            }}
            className="btn btn-danger-ghost"
          >
            {t('twoFactor.turnOff')}
          </button>
        ) : (
          <button
            type="button"
            onClick={onStart}
            disabled={enrol.isPending}
            className="btn btn-primary"
          >
            <Icon name="shield" size={15} />
            {enrol.isPending ? t('twoFactor.settingUp') : t('twoFactor.setUp')}
          </button>
        )}
      </div>

      {setup && (
        <SetupDialog
          setup={setup}
          onClose={() => setSetup(null)}
          onEnabled={(result) => {
            setSession(result.token.access_token, result.token.user)
            setSetup(null)
            setRecoveryCodes(result.recovery_codes)
          }}
        />
      )}

      {recoveryCodes && (
        <RecoveryCodesDialog
          codes={recoveryCodes}
          onDone={() => {
            setRecoveryCodes(null)
            setNotice(t('twoFactor.notices.enabled'))
          }}
        />
      )}

      {disabling && (
        <DisableDialog
          onClose={() => setDisabling(false)}
          onDisabled={(token) => {
            setSession(token.access_token, token.user)
            setDisabling(false)
            setNotice(t('twoFactor.notices.disabled'))
          }}
        />
      )}
    </section>
  )
}

/** Escape closes, as every other dialog here does; the scrim does too. */
const closeOnEscape = (onClose: () => void) => (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.stopPropagation()
    onClose()
  }
}

function SetupDialog({
  setup,
  onClose,
  onEnabled,
}: {
  setup: TotpEnrolmentStart
  onClose: () => void
  onEnabled: (result: TotpEnrolmentResult) => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const confirm = useTotpConfirmAuthTotpConfirmPost()
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      onEnabled(await confirm.mutateAsync({ data: { code: code.trim() } }))
    } catch (err: unknown) {
      setError(errorDetail(err, t('twoFactor.errors.confirm')))
      setCode('')
    }
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(setup.manual_key)
      setCopied(true)
    } catch {
      // No clipboard (an insecure origin, or permission refused): the key is
      // selectable, so copying by hand still works.
    }
  }

  return (
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center overflow-y-auto px-4 pb-8 pt-[8vh]"
      onClick={onClose}
    >
      <form
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onSubmit={onSubmit}
        onKeyDown={closeOnEscape(onClose)}
        onClick={(e) => e.stopPropagation()}
        className="pop-in glass-strong w-full max-w-md space-y-4 rounded-panel p-6"
      >
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
            {t('twoFactor.setup.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600"
            aria-label={t('common:close')}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <p className="text-xs text-neutral-500">{t('twoFactor.setup.scan')}</p>
        <div className="flex justify-center rounded-control border border-neutral-200 bg-white p-4">
          <QRCodeSVG
            value={setup.provisioning_uri}
            size={180}
            role="img"
            aria-label={t('twoFactor.setup.qrLabel')}
          />
        </div>

        <div className="space-y-1">
          <span className="text-xs font-medium text-neutral-600">{t('twoFactor.setup.manual')}</span>
          <div className="flex items-center gap-2">
            <code className="flex-1 select-all break-all rounded-control bg-neutral-100 px-2 py-1 font-mono text-xs text-neutral-800">
              {setup.manual_key}
            </code>
            <button type="button" onClick={onCopy} className="btn btn-secondary btn-sm">
              <Icon name="copy" size={13} />
              {copied ? t('twoFactor.setup.copied') : t('twoFactor.setup.copy')}
            </button>
          </div>
        </div>

        <div className="hairline border-t pt-3">
          <label
            htmlFor="confirm-totp"
            className="mb-1.5 block text-xs font-medium text-neutral-700"
          >
            {t('twoFactor.setup.code')}
          </label>
          <input
            id="confirm-totp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            autoFocus
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="000000"
            className="field text-center font-mono text-lg tracking-widest"
          />
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            {t('common:cancel')}
          </button>
          <button
            type="submit"
            disabled={confirm.isPending || code.trim().length === 0}
            className="btn btn-primary"
          >
            {confirm.isPending ? t('twoFactor.setup.submitting') : t('twoFactor.setup.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * Shown once, straight after two-factor is turned on. No scrim click and no
 * Escape: these are the only copy, and dismissing them by accident loses them.
 */
function RecoveryCodesDialog({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation(['settings', 'common'])
  const dialogRef = useFocusTrap<HTMLDivElement>()
  const titleId = useId()
  const bodyId = useId()
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      setCopied(true)
    } catch {
      // As for the key: the codes are selectable text.
    }
  }

  return (
    <div className="scrim fixed inset-0 z-30 flex items-start justify-center px-4 pt-[10vh]">
      <div
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="pop-in glass-strong w-full max-w-md space-y-4 rounded-panel p-6"
      >
        <div className="flex items-center gap-2">
          <Icon name="shield" size={20} className="text-amber-600" />
          <h2 id={titleId} className="text-base font-semibold text-neutral-900">
            {t('twoFactor.recovery.title')}
          </h2>
        </div>
        <p id={bodyId} className="text-xs text-neutral-500">
          {t('twoFactor.recovery.body')}
        </p>

        <ul className="grid grid-cols-2 gap-2 rounded-control bg-neutral-100 p-3 font-mono text-xs text-neutral-800">
          {codes.map((code) => (
            <li key={code} className="select-all py-0.5">
              {code}
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between">
          <button type="button" onClick={onCopy} className="btn btn-secondary btn-sm">
            <Icon name="copy" size={14} />
            {copied ? t('twoFactor.recovery.copied') : t('twoFactor.recovery.copy')}
          </button>
          <button type="button" onClick={onDone} className="btn btn-primary">
            {t('twoFactor.recovery.done')}
          </button>
        </div>
      </div>
    </div>
  )
}

function DisableDialog({
  onClose,
  onDisabled,
}: {
  onClose: () => void
  onDisabled: (token: Token) => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const disable = useTotpDisableAuthTotpDisablePost()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      onDisabled(await disable.mutateAsync({ data: { code: code.trim() } }))
    } catch (err: unknown) {
      setError(errorDetail(err, t('twoFactor.errors.disable')))
    }
  }

  return (
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center px-4 pt-[15vh]"
      onClick={onClose}
    >
      <form
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onSubmit={onSubmit}
        onKeyDown={closeOnEscape(onClose)}
        onClick={(e) => e.stopPropagation()}
        className="pop-in glass-strong w-full max-w-sm space-y-4 rounded-panel p-5"
      >
        <div>
          <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
            {t('twoFactor.disable.title')}
          </h2>
          <p className="mt-1 text-xs text-neutral-500">{t('twoFactor.disable.body')}</p>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('twoFactor.disable.label')}
          </span>
          <input
            type="text"
            required
            autoFocus
            autoComplete="one-time-code"
            spellCheck={false}
            maxLength={64}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t('twoFactor.disable.placeholder')}
            className="field text-center font-mono tracking-wider"
          />
        </label>

        {error && <p className="text-xs text-danger-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            {t('common:cancel')}
          </button>
          <button
            type="submit"
            disabled={disable.isPending || code.trim().length === 0}
            className="btn btn-danger"
          >
            {disable.isPending ? t('twoFactor.disable.submitting') : t('twoFactor.disable.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
