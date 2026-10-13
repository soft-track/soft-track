import { expect } from '@playwright/test'

import { api, card, makeTeam, signIn, test } from './helpers'

/**
 * Journey 7: answer a question about the ticket you are reading without
 * leaving it (#114). A blocker opens in a modal over the panel, is ticked to
 * Done there, and closing it leaves the panel as it was with the row caught
 * up. Two modals deep a link opens the page, and Back walks all of it back.
 * Real key events throughout: Escape, S and ? are window listeners, and
 * which of them hears a key is the whole question.
 */
test('a linked ticket opens over the one you are reading, and closes back to it', async ({
  page,
  request,
  owner,
}) => {
  const team = await makeTeam(request, owner)
  const create = (data: Record<string, unknown>) =>
    api(request, owner, 'post', `/teams/${team.id}/tickets`, data)
  const reading = await create({ title: 'Import a Jira CSV export' })
  const blocker = await create({ title: 'Per-team custom statuses' })
  const child = await create({ title: 'Status categories in the burndown', parent_id: blocker.id })
  const related = await create({ title: 'Burndown flat-lines with no estimates' })
  await api(request, owner, 'post', `/tickets/${blocker.id}/links`, {
    target_id: reading.id,
    type: 'blocks',
  })
  await api(request, owner, 'post', `/tickets/${child.id}/links`, {
    target_id: related.id,
    type: 'relates_to',
  })

  await signIn(page, owner)
  await page.goto(`/${team.key}`)
  await card(page, 'Import a Jira CSV export').click()
  const panel = page.getByRole('dialog', { name: /Import a Jira CSV export/ })
  const address = new RegExp(`/${team.key}/ticket/${reading.number}$`)
  await expect(page).toHaveURL(address)

  // The blocker opens over the panel, which stays, at the same address.
  const blockedBy = panel.getByRole('button', { name: /Per-team custom statuses/ })
  await blockedBy.click()
  const first = page.getByRole('dialog', { name: /Per-team custom statuses/ })
  await expect(first).toBeVisible()
  await expect(first.getByRole('button', { name: `from ${reading.identifier}` })).toBeVisible()
  await expect(panel).toBeVisible()
  await expect(page).toHaveURL(address)

  // Editable, from the keyboard: S reaches the modal's status, not the panel's.
  await page.keyboard.press('s')
  const status = first.locator('[data-field="status"]')
  await expect(status).toBeFocused()
  await status.selectOption({ label: 'Done' })

  // Escape closes the modal and nothing else, back on the row, which catches up.
  await page.keyboard.press('Escape')
  await expect(first).toBeHidden()
  await expect(panel).toBeVisible()
  await expect(blockedBy).toBeFocused()
  await expect(blockedBy.locator('.line-through')).toBeVisible()

  // Two deep, the trail is named, and Back closes the top one only.
  await blockedBy.click()
  await first.getByRole('button', { name: /Status categories in the burndown/ }).click()
  const second = page.getByRole('dialog', { name: /Status categories in the burndown/ })
  await expect(
    second.getByRole('button', { name: `${reading.identifier} › ${blocker.identifier}` }),
  ).toBeVisible()
  await page.goBack()
  await expect(second).toBeHidden()
  await expect(first).toBeVisible()
  await expect(page).toHaveURL(address)

  // From the second, a link opens the page rather than a third modal.
  await first.getByRole('button', { name: /Status categories in the burndown/ }).click()
  const toPage = second.getByRole('button', { name: /Burndown flat-lines/ })
  await toPage.hover()
  await expect(toPage.getByText('Opens the page')).toHaveCSS('opacity', '1')
  await toPage.click()
  await expect(page).toHaveURL(new RegExp(`/${team.key}/ticket/${related.number}$`))
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('Title')).toHaveValue('Burndown flat-lines with no estimates')

  // Back is the panel again, with both modals over it; Escape takes them off.
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(3)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(panel).toBeVisible()

  // A dialog opened over the stack keeps its own Escape: the cheatsheet
  // closes, and the panel under it stays.
  await page.keyboard.press('?')
  const cheatsheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(cheatsheet).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(cheatsheet).toBeHidden()
  await expect(panel).toBeVisible()
})
