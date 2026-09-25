import { describe, expect, it } from 'vitest'

import type { ProjectRead } from '@/api/generated/models'
import { pickableProjects } from '@/team/projects'

function project(id: number, archived: boolean): ProjectRead {
  return {
    id,
    team_id: 1,
    name: `Project ${id}`,
    color: '#6366f1',
    state: 'planned',
    archived,
    created_at: '2026-01-01T00:00:00Z',
  }
}

const projects = [project(1, false), project(2, true), project(3, false)]
const ids = (list: ProjectRead[]) => list.map((p) => p.id)

describe('pickableProjects', () => {
  it('leaves archived projects out of a picker', () => {
    expect(ids(pickableProjects(projects))).toEqual([1, 3])
  })

  it('keeps an archived project that is already the selection', () => {
    // Otherwise the dropdown renders blank and the next save clears it.
    expect(ids(pickableProjects(projects, 2))).toEqual([1, 2, 3])
  })

  it('treats a null selection as no selection', () => {
    expect(ids(pickableProjects(projects, null))).toEqual([1, 3])
  })
})
