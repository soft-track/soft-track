import { useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import type { PluggableList } from 'unified'
import remarkGfm from 'remark-gfm'

import { AttachmentImage } from '@/attachments/AttachmentImage'
import { isAttachmentUrl } from '@/attachments/urls'
import type { Mentionable } from '@/markdown/mentions'
import { remarkMentions } from '@/markdown/remarkMentions'

/**
 * Rendered markdown.
 *
 * Safety: react-markdown does not render raw HTML unless `rehype-raw` is added
 * to the pipeline, and it is deliberately not added here -- a `<script>` or an
 * `onerror` attribute in a description is text, not markup. Link URLs go
 * through react-markdown's default transform, which drops `javascript:` and
 * other non-http protocols, so `[click](javascript:...)` renders inert.
 */
export function Markdown({
  children,
  people = [],
  onToggleTask,
  className = '',
}: {
  children: string
  people?: Mentionable[]
  /**
   * Called with the source offset of the task item that was clicked. Omit to
   * render checkboxes read-only -- which is right anywhere the viewer has no
   * way to save the change back, such as someone else's comment.
   */
  onToggleTask?: (offset: number) => void
  className?: string
}) {
  const plugins = useMemo(
    () => [remarkGfm, [remarkMentions, { people }]] as PluggableList,
    [people],
  )

  const components: Components = {
    a: ({ node, className: linkClass, children: linkChildren, ...props }) => {
      void node
      if (linkClass === 'mention') {
        return (
          <span className="mention" title={props.title}>
            {linkChildren}
          </span>
        )
      }
      return (
        <a {...props} target="_blank" rel="noopener noreferrer nofollow" className="link">
          {linkChildren}
        </a>
      )
    },

    li: ({ node, children, className: liClass, ...props }) => {
      const offset = node?.position?.start?.offset
      const isTask = typeof liClass === 'string' && liClass.includes('task-list-item')

      if (!isTask || offset === undefined) {
        return (
          <li {...props} className="my-0.5">
            {children}
          </li>
        )
      }

      // remark-gfm renders the checkbox as a disabled <input>; replace it with
      // one wired to the toggle so the state can be written back to the source.
      const [checkbox, ...rest] = Array.isArray(children) ? children : [children]
      const checked = isCheckedInput(checkbox)

      return (
        <li {...props} className="my-0.5 flex list-none items-start gap-2 -ml-5">
          <input
            type="checkbox"
            checked={checked}
            disabled={!onToggleTask}
            onChange={() => onToggleTask?.(offset)}
            className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-neutral-300 accent-brand-600 disabled:opacity-60"
            aria-label={checked ? 'Mark task as not done' : 'Mark task as done'}
          />
          <span className={checked ? 'text-neutral-400 line-through' : undefined}>{rest}</span>
        </li>
      )
    },

    // remark-gfm's own checkbox never reaches the DOM -- `li` above replaces it.
    input: () => null,

    h1: ({ children }) => <h1 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h1>,
    h2: ({ children }) => <h2 className="mt-4 mb-2 text-sm font-semibold first:mt-0">{children}</h2>,
    h3: ({ children }) => <h3 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0">{children}</h3>,
    p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
    ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal pl-5">{children}</ol>,
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-neutral-200 pl-3 text-neutral-500">
        {children}
      </blockquote>
    ),
    code: ({ className: codeClass, children }) => {
      // A fenced block gets a language class; inline code does not.
      const fenced = typeof codeClass === 'string' && codeClass.startsWith('language-')
      if (!fenced) {
        return (
          <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[0.85em] text-neutral-800">
            {children}
          </code>
        )
      }
      return <code className="font-mono text-xs leading-relaxed">{children}</code>
    },
    pre: ({ children }) => (
      <pre className="well scroll-thin my-2 overflow-x-auto rounded-card p-3">{children}</pre>
    ),
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto">
        <table className="w-full border-collapse text-left">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border-b border-neutral-200 px-2 py-1 font-medium">{children}</th>
    ),
    td: ({ children }) => <td className="border-b border-neutral-100 px-2 py-1">{children}</td>,
    hr: () => <hr className="my-3 border-neutral-100" />,
    // An attachment is behind the same bearer token as everything else, and
    // an <img> sends no Authorization header, so ours are fetched through the
    // API client and shown as blob URLs. Anything else is an ordinary image.
    img: ({ src, alt }) =>
      isAttachmentUrl(src) ? (
        <AttachmentImage src={src} alt={alt} />
      ) : (
        <img src={src} alt={alt} className="my-2 max-w-full rounded-md" loading="lazy" />
      ),
  }

  return (
    <div className={`text-sm leading-relaxed text-neutral-700 ${className}`}>
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

/** Read the checked state off the `<input>` react-markdown handed us. */
function isCheckedInput(node: unknown): boolean {
  const props = (node as { props?: { checked?: boolean } })?.props
  return props?.checked === true
}
