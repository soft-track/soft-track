import { describe, expect, it } from 'vitest'

import { stoppingParts } from '@/settings/archivePreview'
import { activeTeams, isArchived, switchableTeams } from '@/team/archived'

const ENG = { id: 1, key: 'ENG', archived_at: null }
const OLD = { id: 2, key: 'OLD', archived_at: '2026-09-30T10:00:00Z' }
const OPS = { id: 3, key: 'OPS', archived_at: undefined }

describe('archived teams (#322)', () => {
  it('knows one by its date', () => {
    expect(isArchived(ENG)).toBe(false)
    expect(isArchived(OLD)).toBe(true)
    expect(isArchived(OPS)).toBe(false)
    expect(isArchived(undefined)).toBe(false)
  })

  it('leaves them out of what is offered', () => {
    expect(activeTeams([ENG, OLD, OPS])).toEqual([ENG, OPS])
  })

  it('keeps the archived team that is open in the switcher, and no other', () => {
    expect(switchableTeams([ENG, OLD, OPS], ENG.id)).toEqual([ENG, OPS])
    expect(switchableTeams([ENG, OLD, OPS], OLD.id)).toEqual([ENG, OLD, OPS])
  })
})

describe('what stops while it is archived', () => {
  const t = (key: string, { count }: { count: number }) => `${count} ${key.split('.').pop()}`

  it('names only what there is some of, in order', () => {
    expect(
      stoppingParts(
        {
          members: 8,
          automation_rules: 3,
          webhooks: 0,
          repository_links: 2,
          recurring_tickets: 0,
          open_tickets: 14,
          tickets: 214,
        },
        t,
      ),
    ).toEqual(['3 automationRules', '2 repositoryLinks'])
  })
})
