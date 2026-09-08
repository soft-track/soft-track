import { useState } from 'react'

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
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <div className="mt-3">
        <MarkdownEditor
          value={draft}
          onChange={setDraft}
          people={people}
          placeholder="Add a description… Markdown works here."
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
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(saved ?? '')
              setEditing(false)
            }}
            className="btn btn-ghost btn-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (!saved?.trim()) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex w-full items-center gap-2 rounded-card border border-dashed border-neutral-900/15 px-3 py-2.5 text-left text-sm text-neutral-500 transition hover:border-brand-400/60 hover:text-neutral-800"
        >
          <Icon name="plus" size={14} className="opacity-70" />
          Add a description
        </button>
      </div>
    )
  }

  return (
    <div className="mt-3">
      <Markdown people={people} onToggleTask={onToggleTask}>
        {saved}
      </Markdown>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" onClick={() => setEditing(true)} className="btn btn-ghost btn-xs">
          Edit description
        </button>
        <TaskProgress source={saved} />
      </div>
    </div>
  )
}

/** "3 of 7 tasks" plus a thin bar, shown only when there are tasks. */
function TaskProgress({ source }: { source: string }) {
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
      {done} of {total} tasks
    </span>
  )
}
