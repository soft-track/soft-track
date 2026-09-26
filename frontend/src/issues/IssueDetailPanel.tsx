import { useGetIssueIssuesIssueIdGet } from '@/api/generated/endpoints/issues/issues'
import { useTranslation } from '@/i18n'
import { useIssueShortcuts } from '@/issues/detail/useIssueShortcuts'
import { IssueDetailBody } from '@/issues/IssueDetailBody'
import { IssueHeaderActions } from '@/issues/IssueHeaderActions'
import { IssueSurfaceContext } from '@/issues/surface'
import { Icon } from '@/ui/Icon'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * The slide-over for one issue, over the board: a glance, not a place to
 * work (#112). Its own chrome -- the scrim, the close button, the keys -- and
 * the shared body below it.
 */
export function IssueDetailPanel({ issueId, onClose }: { issueId: number; onClose: () => void }) {
  const { t } = useTranslation(['issues', 'common'])
  const dialogRef = useFocusTrap<HTMLDivElement>()
  // The body reads the same query; React Query makes it one request.
  const { data: issue } = useGetIssueIssuesIssueIdGet(issueId)
  useIssueShortcuts(onClose)

  return (
    <IssueSurfaceContext.Provider value="panel">
      <div className="scrim fixed inset-0 z-20 flex justify-end" onClick={onClose}>
        <div
          role="dialog"
          ref={dialogRef}
          aria-modal="true"
          tabIndex={-1}
          aria-label={issue ? `${issue.identifier} ${issue.title}` : t('panel.loading')}
          onClick={(e) => e.stopPropagation()}
          className="slide-in-right glass-strong m-2 flex w-full max-w-xl flex-col overflow-hidden rounded-panel sm:m-3"
        >
          <div className="hairline flex items-center justify-between gap-3 border-b px-4 py-3">
            <span className="flex min-w-0 items-center gap-2">
              {issue && (
                <span
                  className="dot"
                  style={{ ['--dot' as string]: issue.status.color }}
                  title={issue.status.name}
                />
              )}
              <span className="identifier text-xs font-semibold text-neutral-500">
                {issue ? issue.identifier : '…'}
              </span>
              {issue?.external_key && (
                <span
                  className="identifier rounded-full bg-neutral-900/6 px-2 py-0.5 text-[10px] text-neutral-500"
                  title={t('panel.importedKey')}
                >
                  {issue.external_key}
                </span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {issue && <IssueHeaderActions issue={issue} />}
              <button
                type="button"
                onClick={onClose}
                className="btn btn-ghost btn-icon btn-sm text-neutral-500"
                aria-label={t('common:close')}
                title={t('panel.closeHint')}
              >
                <Icon name="close" size={15} />
              </button>
            </span>
          </div>

          <div className="scroll-thin flex flex-1 flex-col overflow-y-auto">
            <IssueDetailBody issueId={issueId} />
          </div>
        </div>
      </div>
    </IssueSurfaceContext.Provider>
  )
}
