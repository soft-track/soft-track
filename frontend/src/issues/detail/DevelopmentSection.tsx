import {
  useListCodeLinksIssuesIssueIdCodeLinksGet,
} from '@/api/generated/endpoints/integrations/integrations'
import {
  PullRequestState,
  type CodeLinkRead,
  type CodeLinks,
} from '@/api/generated/models'
import { Icon, type IconName } from '@/ui/Icon'

/**
 * The code that implements this issue: its branches, pull requests and
 * commits.
 *
 * Read-only, and there is nothing to add by hand. Every row here got here
 * because somebody wrote `ENG-42` in a branch name or a commit message, which
 * they were going to do anyway -- a button that asked them to record the link
 * a second time is a button that would not get pressed.
 *
 * The section renders nothing at all when there is nothing linked, rather than
 * an empty state explaining how to link something. An issue nobody has started
 * is the normal case, and a permanent block of instructions on every one of
 * them would be noise on the majority to serve the minority.
 */
export function DevelopmentSection({ issueId }: { issueId: number }) {
  const { data } = useListCodeLinksIssuesIssueIdCodeLinksGet(issueId)
  if (!data) return null

  const groups: Array<{ key: keyof CodeLinks; label: string; icon: IconName }> = [
    // Pull requests first: "has this shipped" is the question this section is
    // most often opened to answer.
    { key: 'pull_requests', label: 'Pull requests', icon: 'pull-request' },
    { key: 'branches', label: 'Branches', icon: 'branch' },
    { key: 'commits', label: 'Commits', icon: 'commit' },
  ]
  // The three arrays default to empty on the server, so the schema marks them
  // optional and the client has to say so.
  const linksIn = (key: keyof CodeLinks): CodeLinkRead[] => data[key] ?? []

  const present = groups.filter((group) => linksIn(group.key).length > 0)
  if (present.length === 0) return null

  return (
    <div className="mt-5">
      <p className="eyebrow mb-2">Development</p>
      <div className="space-y-3">
        {present.map((group) => (
          <div key={group.key}>
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-neutral-400">
              <Icon name={group.icon} size={12} />
              {group.label}
            </p>
            <ul className="space-y-1">
              {linksIn(group.key).map((link) => (
                <CodeLinkRow key={link.id} link={link} kind={group.key} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * How a pull request's state reads, and what colour it carries.
 *
 * Colours come through `--chip`, the same custom property every other chip in
 * the app is tinted by, so these follow the theme in both modes rather than
 * carrying a hard-coded pair of hex values each.
 */
const STATE_META: Record<PullRequestState, { label: string; color: string }> = {
  open: { label: 'Open', color: 'var(--color-brand-500)' },
  // The same green as a Done column, because it means the same thing.
  merged: { label: 'Merged', color: 'var(--color-status-done)' },
  // Not a failure, and not coloured as one: a pull request closed without
  // merging is usually a change of approach, not a mistake.
  closed: { label: 'Closed', color: 'var(--color-neutral-500)' },
}

function CodeLinkRow({ link, kind }: { link: CodeLinkRead; kind: keyof CodeLinks }) {
  return (
    <li>
      <a
        href={link.url}
        target="_blank"
        rel="noreferrer noopener"
        className="well flex items-center gap-2 rounded-control px-2.5 py-1.5 transition hover:bg-neutral-900/4"
        title={`${link.repository.full_name} — open on ${link.repository.provider === 'github' ? 'GitHub' : 'GitLab'}`}
      >
        <span className="min-w-0 flex-1 truncate text-xs text-neutral-800">
          {kind === 'commits' ? (
            <>
              {/* The short sha, the way every git tool shows it. */}
              <span className="identifier text-neutral-500">
                {link.external_id.slice(0, 7)}
              </span>{' '}
              {link.title}
            </>
          ) : kind === 'pull_requests' ? (
            <>
              <span className="identifier text-neutral-500">#{link.external_id}</span>{' '}
              {link.title}
            </>
          ) : (
            <span className="identifier">{link.external_id}</span>
          )}
        </span>

        {link.state && (
          <span
            className="chip shrink-0"
            style={{ ['--chip' as string]: STATE_META[link.state].color }}
          >
            {STATE_META[link.state].label}
          </span>
        )}
        {link.author_name && (
          <span className="shrink-0 text-[11px] text-neutral-400">
            {link.author_name}
          </span>
        )}
      </a>
    </li>
  )
}
