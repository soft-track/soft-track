import { type ComponentProps, Suspense, lazy } from 'react'

import type { Markdown as MarkdownComponent } from './Markdown'
import type { MarkdownEditor as MarkdownEditorComponent } from './MarkdownEditor'

/**
 * The markdown renderer and its editor, split out of the initial bundle.
 *
 * react-markdown and remark-gfm are about 160 kB raw, and nothing on the board
 * needs them until someone opens an issue or starts writing one. Loading them
 * on that interaction keeps the first paint the size it was before markdown
 * existed.
 *
 * The fallback for the renderer is the raw source as preformatted text, which
 * is what descriptions looked like before this feature: readable, correctly
 * sized, and no layout jump when the real renderer replaces it.
 */

const MarkdownImpl = lazy(() => import('./Markdown').then((m) => ({ default: m.Markdown })))
const MarkdownEditorImpl = lazy(() =>
  import('./MarkdownEditor').then((m) => ({ default: m.MarkdownEditor })),
)

export function Markdown(props: ComponentProps<typeof MarkdownComponent>) {
  return (
    <Suspense
      fallback={
        <div className={`text-sm leading-relaxed text-neutral-700 ${props.className ?? ''}`}>
          <p className="whitespace-pre-wrap">{props.children}</p>
        </div>
      }
    >
      <MarkdownImpl {...props} />
    </Suspense>
  )
}

export function MarkdownEditor(props: ComponentProps<typeof MarkdownEditorComponent>) {
  return (
    <Suspense
      fallback={
        <div className={props.className}>
          <div className="mb-1.5 h-6 w-32 rounded-lg bg-neutral-100" />
          <div
            className="w-full rounded-md border border-neutral-200 bg-neutral-50"
            style={{ height: `${(props.rows ?? 5) * 1.5 + 1}rem` }}
          />
        </div>
      }
    >
      <MarkdownEditorImpl {...props} />
    </Suspense>
  )
}
