import type {
  ProjectRead,
  ReleaseRead,
  TicketBulkChanges,
  TicketGrouping,
  TicketRead,
} from '@/api/generated/models'
import { releaseStateMeta } from '@/releases/releases'

/**
 * How the board is arranged: by status, as it always was, or by project (#63).
 *
 * Kept apart from `BoardFilters` on purpose. A filter narrows the ticket list
 * and is sent to the API; a grouping only arranges what came back. Folding it
 * into the filters would put it in the ticket query and count it as an active
 * filter, neither of which is true.
 */
export type BoardGrouping = TicketGrouping

/**
 * The query-string key, beside the filter keys in `filters.ts`.
 *
 * Status is the default and is left out of the URL entirely, so every link
 * sent before grouping existed still means exactly what it meant -- and
 * `project`, the filter's key, keeps its meaning too.
 */
const KEY = 'group'

/** Every grouping but status, which is the board's own columns. */
const GROUPINGS: readonly string[] = ['project', 'release'] satisfies BoardGrouping[]

export function groupingFromSearchParams(params: URLSearchParams): BoardGrouping {
  const asked = params.get(KEY) ?? ''
  return GROUPINGS.includes(asked) ? (asked as BoardGrouping) : 'status'
}

/** `params` with the grouping set, or removed when it is the default. */
export function withGrouping(params: URLSearchParams, grouping: BoardGrouping): URLSearchParams {
  const next = new URLSearchParams(params)
  if (grouping === 'status') next.delete(KEY)
  else next.set(KEY, grouping)
  return next
}

/** One project's tickets, or the tickets in no project (`project: null`). */
export type ProjectGroup = {
  /** `project:5`, or `project:none`. Also the board column's drop target id. */
  key: string
  project: ProjectRead | null
  tickets: TicketRead[]
}

export const NO_PROJECT_KEY = 'project:none'

/**
 * Tickets arranged by project, in a stable order: projects by name, then the
 * tickets in none.
 *
 * `includeEmpty` is for the board, where an empty column is somewhere to drop
 * a card. Even then an archived project only appears if it still holds one of
 * these tickets -- it was retired from pickers, and a column is a picker. The
 * list has no use for empty sections and leaves them all out.
 */
export function groupByProject(
  tickets: TicketRead[],
  projects: ProjectRead[],
  { includeEmpty }: { includeEmpty: boolean },
): ProjectGroup[] {
  const known = new Set(projects.map((project) => project.id))
  const groups: ProjectGroup[] = [...projects]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((project) => ({
      key: `project:${project.id}`,
      project,
      tickets: tickets.filter((ticket) => ticket.project_id === project.id),
    }))
    .filter((group) =>
      group.tickets.length > 0 ? true : includeEmpty && !group.project!.archived,
    )

  // A ticket whose project the team list does not know -- deleted a moment
  // ago, say -- is shown as in no project rather than dropped off the board.
  const loose = tickets.filter(
    (ticket) => ticket.project_id == null || !known.has(ticket.project_id),
  )
  if (loose.length > 0 || includeEmpty) {
    groups.push({ key: NO_PROJECT_KEY, project: null, tickets: loose })
  }
  return groups
}

/** The project a board column's drop target id stands for, or undefined if it is not one. */
export function projectForDropTarget(id: string): number | null | undefined {
  if (id === NO_PROJECT_KEY) return null
  const match = /^project:(\d+)$/.exec(id)
  return match ? Number(match[1]) : undefined
}

/** One release's tickets, or the tickets in none (`release: null`) (#272). */
export type ReleaseGroup = {
  /** `release:5`, or `release:none`. Also the board column's drop target id. */
  key: string
  release: ReleaseRead | null
  tickets: TicketRead[]
}

export const NO_RELEASE_KEY = 'release:none'

/**
 * Tickets arranged by the release they ship in (#272), in the team's order
 * of releases -- planned, then released -- then the tickets in none.
 *
 * As with projects, `includeEmpty` is for the board, where an empty column
 * is somewhere to drop a card, and an archived release only appears while
 * it still holds one of these tickets.
 */
export function groupByRelease(
  tickets: TicketRead[],
  releases: readonly ReleaseRead[],
  { includeEmpty }: { includeEmpty: boolean },
): ReleaseGroup[] {
  const known = new Set(releases.map((release) => release.id))
  const groups: ReleaseGroup[] = releases
    .map((release) => ({
      key: `release:${release.id}`,
      release,
      tickets: tickets.filter((ticket) => ticket.fix_version_id === release.id),
    }))
    .filter((group) =>
      group.tickets.length > 0 ? true : includeEmpty && group.release!.state !== 'archived',
    )
  const loose = tickets.filter(
    (ticket) => ticket.fix_version_id == null || !known.has(ticket.fix_version_id),
  )
  if (loose.length > 0 || includeEmpty) {
    groups.push({ key: NO_RELEASE_KEY, release: null, tickets: loose })
  }
  return groups
}

/**
 * One column of the board, or section of the list, under any grouping but
 * status: what it is called, its colour, its tickets, and what a card
 * dropped on it changes -- the same change a bulk edit sends.
 */
export type TicketGroup = {
  key: string
  /** Null for the group of tickets with none: "No epic", "No release". */
  name: string | null
  color: string | null
  tickets: TicketRead[]
  change: TicketBulkChanges
}

/** What the groupings name things from. */
export type GroupLookups = {
  projects: ProjectRead[]
  releases?: readonly ReleaseRead[]
}

/** The groups for any grouping but status, which has the board's own columns. */
export function groupTickets(
  grouping: Exclude<BoardGrouping, 'status'>,
  tickets: TicketRead[],
  lookups: GroupLookups,
  options: { includeEmpty: boolean },
): TicketGroup[] {
  if (grouping === 'release') {
    return groupByRelease(tickets, lookups.releases ?? [], options).map((group) => ({
      key: group.key,
      name: group.release?.name ?? null,
      color: group.release ? releaseStateMeta(group.release.state).colour : null,
      tickets: group.tickets,
      change: { fix_version_id: group.release?.id ?? null },
    }))
  }
  return groupByProject(tickets, lookups.projects, options).map((group) => ({
    key: group.key,
    name: group.project?.name ?? null,
    color: group.project?.color ?? null,
    tickets: group.tickets,
    change: { project_id: group.project?.id ?? null },
  }))
}
