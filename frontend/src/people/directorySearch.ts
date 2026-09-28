import type { ListPeopleUsersGetParams } from '@/api/generated/models'

/**
 * The people directory's filters (#125), kept in the URL like the board's:
 * a filtered directory is a link somebody can paste.
 *
 * `?q=` is the search, `?department=` a department's id -- so a link
 * survives the department being renamed -- and `?manager=` a username, the
 * same handle a profile's address uses.
 */
export type DirectoryFilters = {
  q: string
  departmentId: number | null
  manager: string | null
}

export const NO_DIRECTORY_FILTERS: DirectoryFilters = { q: '', departmentId: null, manager: null }

export function fromSearchParams(params: URLSearchParams): DirectoryFilters {
  const department = Number(params.get('department'))
  return {
    q: (params.get('q') ?? '').trim(),
    departmentId: Number.isInteger(department) && department > 0 ? department : null,
    manager: params.get('manager')?.trim() || null,
  }
}

export function toSearchParams(filters: DirectoryFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.departmentId !== null) params.set('department', String(filters.departmentId))
  if (filters.manager) params.set('manager', filters.manager)
  return params
}

export function toQueryParams(
  filters: DirectoryFilters,
  page: { limit: number; offset: number },
): ListPeopleUsersGetParams {
  return {
    q: filters.q || undefined,
    department_id: filters.departmentId ?? undefined,
    manager: filters.manager ?? undefined,
    ...page,
  }
}

export function hasFilters(filters: DirectoryFilters): boolean {
  return filters.q !== '' || filters.departmentId !== null || filters.manager !== null
}
