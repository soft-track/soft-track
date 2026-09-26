// Board (#106): the board, the list, and everything around them.
import { page } from '@/i18n/en/board/page'
import { topBar } from '@/i18n/en/board/topBar'
import { arrange } from '@/i18n/en/board/arrange'
import { sidebar } from '@/i18n/en/board/sidebar'
import { filters } from '@/i18n/en/board/filters'
import { list } from '@/i18n/en/board/list'
import { bulk } from '@/i18n/en/board/bulk'
import { kanban } from '@/i18n/en/board/kanban'
import { peek } from '@/i18n/en/board/peek'

export const board = {
  page,
  topBar,
  arrange,
  sidebar,
  filters,
  list,
  bulk,
  kanban,
  peek,
} as const
