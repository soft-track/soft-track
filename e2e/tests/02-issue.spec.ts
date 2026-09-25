import { expect } from '@playwright/test'

import { card, makeTeam, signIn, test } from './helpers'

/** Journey 2: create an issue, see it on the board, open it, edit its title. */
test('an issue is created, shown on the board, and retitled', async ({ page, request, owner }) => {
  const team = await makeTeam(request, owner)
  await signIn(page, owner)
  await page.goto(`/${team.key}`)

  await page.getByRole('button', { name: 'New issue' }).click()
  const dialog = page.getByRole('dialog', { name: 'New issue' })
  await dialog.getByPlaceholder('Issue title').fill('Checkout button does nothing')
  await dialog.getByRole('button', { name: 'Create issue' }).click()
  await expect(dialog).toBeHidden()

  await expect(card(page, 'Checkout button does nothing')).toBeVisible()
  await card(page, 'Checkout button does nothing').click()

  const panel = page.getByRole('dialog', { name: /Checkout button does nothing/ })
  const title = panel.getByLabel('Title')
  await title.fill('Checkout button does nothing on Safari')
  await title.blur()

  // Saved: the board shows the new title after the panel is closed and the
  // page reloaded -- not just the text still sitting in the input.
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(card(page, 'Checkout button does nothing on Safari')).toBeVisible()
})
