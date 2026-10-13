import { type FormEvent, useId, useState } from 'react'

import {
  useCreateUserAdminUsersPost,
  useListTeamsAdminTeamsGet,
  useListUsersAdminUsersGet,
} from '@/api/generated/endpoints/admin/admin'
import { useListDepartmentsDepartmentsGet } from '@/api/generated/endpoints/departments/departments'
import { type AdminUserCreated, TeamRole } from '@/api/generated/models'
import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { type PersonOption, PersonPicker } from '@/people/PersonPicker'
import { useDebounced } from '@/search/useDebounced'
import { copyText } from '@/settings/inviteLink'
import { ROLE_LABELS } from '@/settings/roles'
import { Icon } from '@/ui/Icon'
import { Select } from '@/ui/Select'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * Creating an account for somebody before they arrive (#303): who they are,
 * and where they belong. No password -- they choose one from the link, which
 * is emailed where the instance can send mail and shown here to copy either
 * way, like an invitation.
 */
export function NewAccountDialog({
  canEmail,
  onClose,
  onCreated,
}: {
  /** Whether this instance can send mail. */
  canEmail: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const dialogRef = useFocusTrap<HTMLDivElement>()
  const titleId = useId()
  const create = useCreateUserAdminUsersPost()
  const departments = useListDepartmentsDepartmentsGet()
  const teams = useListTeamsAdminTeamsGet({ limit: 200 })

  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [startedOn, setStartedOn] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [manager, setManager] = useState<PersonOption | null>(null)
  const [managerSearch, setManagerSearch] = useState('')
  const [teamId, setTeamId] = useState('')
  const [role, setRole] = useState<TeamRole>(TeamRole.member)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<AdminUserCreated | null>(null)
  const [copied, setCopied] = useState(false)

  const managerQuery = useDebounced(managerSearch, 200)
  const candidates = useListUsersAdminUsersGet({
    q: managerQuery || undefined,
    limit: 8,
  })
  const managerResults = (candidates.data?.items ?? []).filter((person) => person.is_active)
  // Archived teams take nobody new.
  const teamOptions = (teams.data?.items ?? []).filter((team) => !team.archived_at)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      const result = await create.mutateAsync({
        data: {
          full_name: fullName,
          email,
          username: username.trim() || null,
          job_title: jobTitle.trim() || null,
          started_on: startedOn || null,
          department_id: departmentId ? Number(departmentId) : null,
          manager_id: manager?.id ?? null,
          teams: teamId ? [{ team_id: Number(teamId), role }] : [],
          send_email: canEmail,
        },
      })
      setCreated(result)
      onCreated()
    } catch (err: unknown) {
      setError(errorDetail(err, t('adminUsers.create.error')))
    }
  }

  const onCopy = async () => {
    if (!created) return
    setCopied(await copyText(created.link))
  }

  const label = 'mb-1 block text-xs font-medium text-neutral-500'

  return (
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center overflow-y-auto px-4 py-[10vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        className="pop-in glass-strong w-full max-w-lg rounded-panel p-5"
      >
        {created ? (
          <div>
            <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
              {t('adminUsers.created.title', { name: created.user.full_name })}
            </h2>
            <p className="mt-2 text-sm text-neutral-600">
              <Trans
                t={t}
                i18nKey={
                  created.welcome_link.emailed_at
                    ? 'adminUsers.created.emailed'
                    : 'adminUsers.created.copy'
                }
                values={{
                  name: created.user.full_name,
                  email: created.user.email,
                  date: formatDate(parseServerDate(created.welcome_link.expires_at), 'd MMMM'),
                }}
                {...userText}
              />
            </p>
            <p className="eyebrow mt-4">
              {canEmail ? t('adminUsers.created.link') : t('adminUsers.created.withoutSmtp')}
            </p>
            <p className="well mt-1.5 break-all rounded-control px-3 py-2 font-mono text-xs text-neutral-700">
              {created.link}
            </p>
            <div className="mt-4 flex items-center justify-between gap-2">
              <button type="button" onClick={onCopy} className="btn btn-secondary btn-sm">
                <Icon name={copied ? 'check' : 'copy'} size={14} />
                {copied ? t('common:copied') : t('adminUsers.created.copyLink')}
              </button>
              <button type="button" onClick={onClose} className="btn btn-primary">
                {t('adminUsers.created.done')}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
              {t('adminUsers.create.title')}
            </h2>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={label}>{t('adminUsers.create.fullName')}</span>
                <input
                  autoFocus
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="field"
                />
              </label>
              <label className="block">
                <span className={label}>{t('adminUsers.create.username')}</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  title={t('adminUsers.create.usernameHint')}
                  className="field"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className={label}>{t('adminUsers.create.email')}</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="field"
                />
              </label>
              <label className="block">
                <span className={label}>{t('adminUsers.create.jobTitle')}</span>
                <input
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  className="field"
                />
              </label>
              <label className="block">
                <span className={label}>{t('adminUsers.create.startDate')}</span>
                <input
                  type="date"
                  value={startedOn}
                  onChange={(e) => setStartedOn(e.target.value)}
                  className="field"
                />
              </label>
              <label className="block">
                <span className={label}>{t('adminUsers.create.department')}</span>
                <Select
                  block
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                >
                  <option value="">{t('adminUsers.create.noDepartment')}</option>
                  {(departments.data ?? []).map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </Select>
              </label>
              <div>
                <span className={label}>{t('adminUsers.create.manager')}</span>
                <PersonPicker
                  label={t('adminUsers.create.managerOf')}
                  value={manager}
                  results={managerResults}
                  onSearch={setManagerSearch}
                  onChange={setManager}
                  noneLabel={t('adminUsers.create.noManager')}
                  placeholder={t('adminUsers.create.searchPeople')}
                />
              </div>
              <label className="block">
                <span className={label}>{t('adminUsers.create.team')}</span>
                <Select block value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                  <option value="">{t('adminUsers.create.noTeam')}</option>
                  {teamOptions.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block">
                <span className={label}>{t('adminUsers.create.role')}</span>
                <Select
                  block
                  value={role}
                  disabled={!teamId}
                  onChange={(e) => setRole(e.target.value as TeamRole)}
                >
                  {Object.values(TeamRole).map((value) => (
                    <option key={value} value={value}>
                      {ROLE_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </label>
            </div>

            <p className="mt-3 text-xs text-neutral-400">{t('adminUsers.create.noPassword')}</p>

            {error && (
              <p
                role="alert"
                className="mt-3 rounded-control bg-danger-50 px-3 py-2 text-xs text-danger-700"
              >
                {error}
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="btn btn-ghost">
                {t('common:cancel')}
              </button>
              <button type="submit" disabled={create.isPending} className="btn btn-primary">
                {create.isPending
                  ? t('adminUsers.create.submitting')
                  : canEmail
                    ? t('adminUsers.create.submitAndSend')
                    : t('adminUsers.create.submit')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
