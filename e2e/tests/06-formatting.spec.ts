import { expect } from '@playwright/test'

import { api, makeTeam, signIn, test } from './helpers'

/**
 * Journey 6: format a description from the keyboard and the toolbar (#118),
 * and take a step back with the browser's own undo. The toolbar writes
 * through execCommand precisely so that ⌘Z keeps working, and jsdom has no
 * execCommand -- a real browser is the only place to check it.
 */
test('the toolbar formats a description, and undo takes each step back', async ({
  page,
  request,
  owner,
}) => {
  const team = await makeTeam(request, owner)
  const ticket = await api(request, owner, 'post', `/teams/${team.id}/tickets`, {
    title: 'Safari drag ghost offset',
  })
  await signIn(page, owner)
  await page.goto(`/${team.key}/ticket/${ticket.number}`)

  await page.getByRole('button', { name: 'Add a description' }).click()
  const editor = page.getByPlaceholder('Add a description… Markdown works here.')
  // The description's, which comes before the comment box's.
  const toolbar = page.getByRole('toolbar', { name: 'Formatting' }).first()
  await editor.fill('The ghost is off by offset math on Safari.')

  await editor.evaluate((el: HTMLTextAreaElement) => {
    const start = el.value.indexOf('offset math')
    el.setSelectionRange(start, start + 'offset math'.length)
  })
  await page.keyboard.press('ControlOrMeta+B')
  await expect(editor).toHaveValue('The ghost is off by **offset math** on Safari.')
  await expect(toolbar.getByRole('button', { name: /^Bold/ })).toHaveAttribute('aria-pressed', 'true')

  // The bold is one step on the browser's undo stack, both ways.
  await page.keyboard.press('ControlOrMeta+Z')
  await expect(editor).toHaveValue('The ghost is off by offset math on Safari.')
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await expect(editor).toHaveValue('The ghost is off by **offset math** on Safari.')

  // A button does what its shortcut does, and leaves the caret for typing.
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length))
  await page.keyboard.press('Enter')
  await toolbar.getByRole('button', { name: 'Checklist' }).click()
  await page.keyboard.type('Regression test on Safari')
  await expect(editor).toHaveValue(
    'The ghost is off by **offset math** on Safari.\n- [ ] Regression test on Safari',
  )

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('strong', { hasText: 'offset math' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Mark task as done' })).toBeVisible()

  // A mention from the menu is undoable too: it used to replace the whole
  // value, which cleared the undo history.
  const composer = page.getByPlaceholder('Leave a comment…')
  await composer.click()
  await page.keyboard.type(`Thanks @${owner.username.slice(0, 6)}`)
  await page.getByRole('listbox', { name: 'Team members' }).getByRole('option', { name: /Ada Author/ }).waitFor()
  await page.keyboard.press('Enter')
  await expect(composer).toHaveValue(`Thanks @${owner.username} `)
  await page.keyboard.press('ControlOrMeta+Z')
  await expect(composer).toHaveValue(`Thanks @${owner.username.slice(0, 6)}`)
})
