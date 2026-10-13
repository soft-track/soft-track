import { describe, expect, it } from 'vitest'

import { resources } from '@/i18n/resources'

/**
 * The interface says ticket, epic and sprint (#211, #214, #215). The code
 * still calls an epic a project, and people arrive from trackers that say
 * issue and cycle, which is why the old words keep trying to come back: this
 * fails when new text in the catalog uses them.
 *
 * Other products' words stay theirs -- Jira's issues and its Issue key
 * column, GitHub issues, GitLab projects -- and "Issues a new secret" is a
 * verb. Placeholders and tag names are code, so `{{project}}` is left alone
 * too.
 */
const THEIRS = [
  /\bIssue key\b/g,
  /\b(?:Jira|GitHub|GitLab)(?:’s|'s)? (?:issues?|projects?)\b/gi,
  /\bIssues a new secret\b/g,
]

function usesOldWords(text: string): boolean {
  let prose = text.replace(/\{\{[^}]*\}\}|<[^>]*>/g, '')
  for (const theirs of THEIRS) prose = prose.replace(theirs, '')
  return /\b(?:issues?|projects?|cycles?)\b/i.test(prose)
}

function* strings(node: unknown, path: string): Generator<[string, string]> {
  if (typeof node === 'string') {
    yield [path, node]
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      yield* strings(value, path.includes(':') ? `${path}.${key}` : `${path}:${key}`)
    }
  }
}

describe('what the interface calls things (#211, #214, #215)', () => {
  it('says ticket, epic and sprint, not issue, project and cycle', () => {
    const offenders = Object.entries(resources.en)
      .flatMap(([namespace, catalog]) => [...strings(catalog, namespace)])
      .filter(([, text]) => usesOldWords(text))
      .map(([path, text]) => `${path}: ${text}`)

    expect(offenders).toEqual([])
  })

  it('catches the old words however they are written', () => {
    expect(usesOldWords('New issue')).toBe(true)
    expect(usesOldWords('Sub-issues')).toBe(true)
    expect(usesOldWords('Add {{count}} issues to {{project}}')).toBe(true)
    expect(usesOldWords('Group by Project')).toBe(true)
    expect(usesOldWords('Complete {{count}} cycles')).toBe(true)
  })

  it('leaves code and other products’ words alone', () => {
    expect(usesOldWords('Add tickets to {{project}}')).toBe(false)
    expect(usesOldWords('Put <issue>{{key}}-42</issue> in a branch name')).toBe(false)
    expect(usesOldWords('Export with the <em>Issue key</em> column')).toBe(false)
    expect(usesOldWords('That file has no Jira issues in it.')).toBe(false)
    expect(usesOldWords('Issues a new secret and a new URL.')).toBe(false)
    expect(usesOldWords('Every sprint has a lifecycle')).toBe(false)
  })
})
