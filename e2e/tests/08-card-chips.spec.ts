import { type Locator, expect } from '@playwright/test'

import { api, card, makeTeam, signIn, test } from './helpers'

type Box = { x: number; y: number; width: number; height: number }

/** Whether two boxes share any pixels. Touching edges do not count. */
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox()
  expect(found, `${locator} has no box`).not.toBeNull()
  return found!
}

/**
 * Journey 8: an epic's name and a due date share the bottom row of a card
 * without being drawn over each other (#319). The overlap only happens on a
 * narrow card, so the board is drawn at each width that changes a card's
 * size, down to the narrowest a column gets (208px, from 1024px wide).
 * Layout, which jsdom does not do: it has to be measured in a browser.
 */
test("an epic's name shortens beside a due date instead of running under it", async ({
  page,
  request,
  owner,
}) => {
  const team = await makeTeam(request, owner)
  const statuses = await api(request, owner, 'get', `/teams/${team.id}/statuses`)
  const todo = statuses.find((s: { name: string }) => s.name === 'Todo')
  const epic = await api(request, owner, 'post', `/teams/${team.id}/projects`, {
    name: 'Customer portal redesign',
    color: '#0ea5e9',
  })
  const label = await api(request, owner, 'post', `/teams/${team.id}/labels`, {
    name: 'customer-escalation-follow-up',
    color: '#f97316',
  })
  await api(request, owner, 'post', `/teams/${team.id}/tickets`, {
    title: 'Portal sign-in page',
    status_id: todo.id,
    project_id: epic.id,
    label_ids: [label.id],
    // Overdue: the date that most needs reading, and the widest one.
    due_date: '2025-12-31',
  })
  await signIn(page, owner)

  for (const width of [1920, 1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`/${team.key}`)
    const ticket = card(page, 'Portal sign-in page')
    const epicChip = ticket.getByTitle('Epic: Customer portal redesign')
    const labelChip = ticket.getByText('customer-escalation-follow-up')
    const due = ticket.getByTitle(/^Due .* overdue$/)
    await expect(due).toBeVisible()

    const date = await box(due)
    const edge = await box(ticket)
    for (const [name, chip] of [
      ['epic', epicChip],
      ['label', labelChip],
    ] as const) {
      const drawn = await box(chip)
      expect(overlap(drawn, date), `the ${name} chip is drawn under the date at ${width}px`).toBe(
        false,
      )
      // Inside the card too: shortened, not pushed out past its edge.
      expect(
        drawn.x + drawn.width,
        `the ${name} chip runs out of the card at ${width}px`,
      ).toBeLessThanOrEqual(edge.x + edge.width)
    }

    // Shortened on screen, whole for a screen reader.
    await expect(epicChip).toContainText('Customer portal redesign (epic)')
  }
})
