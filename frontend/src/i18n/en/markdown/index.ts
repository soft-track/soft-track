// Markdown (#106): the renderer and the editor, with its toolbar and help (#118).
import { editor } from '@/i18n/en/markdown/editor'
import { help } from '@/i18n/en/markdown/help'
import { render } from '@/i18n/en/markdown/render'
import { toolbar } from '@/i18n/en/markdown/toolbar'

export const markdown = {
  editor,
  toolbar,
  help,
  render,
} as const
