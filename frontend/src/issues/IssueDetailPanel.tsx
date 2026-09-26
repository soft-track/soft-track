import { useGetIssueIssuesIssueIdGet } from '@/api/generated/endpoints/issues/issues'
import { useTranslation } from '@/i18n'
import { useIssueShortcuts } from '@/issues/detail/useIssueShortcuts'
import { IssueDetailBody } from '@/issues/IssueDetailBody'
import { IssueHeaderActions } from '@/issues/IssueHeaderActions'
import { IssueSurfaceContext, isPlainClick, issuePath, useOpenIssue } from '@/issues/surface'
import { Icon } from '@/ui/Icon'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * The slide-over for one issue, over the board: a glance, not a place to
 * work (#112). Its own chrome -- the scrim, the close button, the keys, the
 * way out to the issue's page -- and the shared body below it.
 */
export function IssueDetailPanel({
  issueId,
  onClose,
  onOpenAsPage,
}: {
  issueId: number
  onClose: () => void
  /**
   * Trade the glance for the issue's own page. Straight there unless given;
   * the board gives its own, which first keeps its view and search for Back,
   * as it does for the command palette.
   */
  onOpenAsPage?: () => void
}) {
  const { t } = useTranslation(['issues', 'common'])
  const openIssue = useOpenIssue()
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
              {issue && (
                // A link to the page it opens, so a middle click puts that
                // page in a new tab and leaves the panel where it is.
                <a
                  href={issuePath(issue)}
                  onClick={(e) => {
                    if (!isPlainClick(e)) return
                    e.preventDefault()
                    if (onOpenAsPage) onOpenAsPage()
                    else openIssue(issue, 'page')
                  }}
                  className="btn btn-ghost btn-icon btn-sm text-neutral-500"
                  aria-label={t('panel.openAsPage')}
                  title={t('panel.openAsPage')}
                >
                  <Icon name="expand" size={14} />
                </a>
              )}
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
