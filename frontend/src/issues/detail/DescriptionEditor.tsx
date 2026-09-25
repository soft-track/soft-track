import { useState, useMemo } from 'react'

import { useTranslation } from '@/i18n'
import { useTeamContext } from '@/team/useTeamContext'

import { Markdown, MarkdownEditor } from '@/markdown/lazy'
import type { Mentionable } from '@/markdown/mentions'
import { taskProgress } from '@/markdown/tasks'
import { Icon } from '@/ui/Icon'

/**
 * The description in its three states: empty, rendered, being edited.
 *
 * Editing is an explicit mode with Save and Cancel rather than save-on-blur.
 * The editor has tabs and a mention menu, and clicking either would blur the
 * textarea -- so blur cannot mean "done".
 */
export function DescriptionEditor({
  saved,
  draft,
  setDraft,
  people,
  onSave,
  onToggleTask,
  onUploadFiles,
  readOnly = false,
}: {
  /** What the server has. */
  saved: string | null | undefined
  /** What is being typed. */
  draft: string
  setDraft: (value: string) => void
  people: Mentionable[]
  onSave: (description: string) => Promise<void>
  onToggleTask: (offset: number) => void
  onUploadFiles?: (files: File[]) => Promise<Array<{ markdown: string }>>
  /** A guest's view (#104): the description, and no way to change it. */
  readOnly?: boolean
}) {
  const { t } = useTranslation(['issues', 'common'])
  const [editing, setEditing] = useState(false)
  const { team, teams } = useTeamContext()
  const teamKeys = useMemo(
    () => Array.from(new Set([team.key, ...teams.map((other) => other.key)])),
    [team, teams],
  )

  if (editing) {
    return (
      <div className="mt-3">
        <MarkdownEditor
          value={draft}
          onChange={setDraft}
          people={people}
          teamKeys={teamKeys}
          placeholder={t('description.placeholder')}
          rows={8}
          autoFocus
          onUploadFiles={onUploadFiles}
        />
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={async () => {
              if (draft !== (saved ?? '')) await onSave(draft)
              setEditing(false)
            }}
            className="btn btn-primary btn-sm"
          >
            {t('common:save')}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(saved ?? '')
              setEditing(false)
            }}
            className="btn btn-ghost btn-sm"
          >
            {t('common:cancel')}
          </button>
        </div>
      </div>
    )
  }

  if (!saved?.trim()) {
    if (readOnly) return null
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex w-full items-center gap-2 rounded-card border border-dashed border-neutral-900/15 px-3 py-2.5 text-left text-sm text-neutral-500 transition hover:border-brand-400/60 hover:text-neutral-800"
        >
          <Icon name="plus" size={14} className="opacity-70" />
          {t('description.add')}
        </button>
      </div>
    )
  }

  return (
    <div className="mt-3">
      <Markdown
        people={people}
        onToggleTask={readOnly ? undefined : onToggleTask}
        teamKeys={teamKeys}
      >
        {saved}
      </Markdown>
      <div className="mt-2 flex items-center gap-3">
        {!readOnly && (
          <button type="button" onClick={() => setEditing(true)} className="btn btn-ghost btn-xs">
            {t('description.edit')}
          </button>
        )}
        <TaskProgress source={saved} />
      </div>
    </div>
  )
}

/** "3 of 7 tasks" plus a thin bar, shown only when there are tasks. */
function TaskProgress({ source }: { source: string }) {
  const { t } = useTranslation('issues')
  const { done, total } = taskProgress(source)
  if (total === 0) return null

  return (
    <span className="flex items-center gap-2 text-xs text-neutral-500">
      <span className="h-1 w-16 overflow-hidden rounded-full bg-neutral-900/8">
        <span
          className="block h-full rounded-full bg-linear-to-r from-brand-500 to-accent-sky transition-all"
          style={{ width: `${(done / total) * 100}%` }}
        />
      </span>
      {t('description.tasks', { done, count: total })}
    </span>
  )
}
