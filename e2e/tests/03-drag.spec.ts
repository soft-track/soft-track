import { expect } from '@playwright/test'

import { api, card, column, makeTeam, signIn, test } from './helpers'

/** Journey 3: drag a card to another column; the status survives a reload. */
test('dragging a card to another column changes its status for good', async ({
  page,
  request,
  owner,
}) => {
  const team = await makeTeam(request, owner)
  const statuses = await api(request, owner, 'get', `/teams/${team.id}/statuses`)
  const todo = statuses.find((s: { name: string }) => s.name === 'Todo')
  await api(request, owner, 'post', `/teams/${team.id}/issues`, {
    title: 'Move me along',
    status_id: todo.id,
  })
  await signIn(page, owner)
  await page.goto(`/${team.key}`)

  const moving = card(page, 'Move me along')
  const target = column(page, 'In Progress')
  await expect(moving).toBeVisible()

  // A real pointer drag, in steps: dnd-kit only starts a drag after 8px of
  // movement, and a single jump would never cross that threshold.
  const from = (await moving.boundingBox())!
  const to = (await target.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 5 })
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 15 })
  await page.mouse.up()

  await expect(column(page, 'In Progress').locator('[data-card]')).toContainText(['Move me along'])
  await page.reload()
  await expect(column(page, 'In Progress').locator('[data-card]')).toContainText(['Move me along'])
  await expect(column(page, 'Todo').locator('[data-card]')).toHaveCount(0)
})
