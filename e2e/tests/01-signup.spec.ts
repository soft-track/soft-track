import { expect, test } from '@playwright/test'

import { column, teamKey, unique } from './helpers'

/** Journey 1: sign up, create a team, land on its empty board. */
test('a new person signs up, makes a team, and lands on an empty board', async ({ page }) => {
  const username = unique('new')
  await page.goto('/register')

  await page.getByLabel('Full name').fill('Grace Hopper')
  await page.getByLabel('Email').fill(`${username}@example.com`)
  await page.getByLabel('Password').fill('correct-horse-battery')
  await page.getByRole('button', { name: 'Create account' }).click()

  // With no team yet, the app sends a new account straight on to make one.
  await expect(page).toHaveURL(/\/new-team$/)
  await expect(page.getByRole('heading', { name: /Welcome, Grace/ })).toBeVisible()
  // Signing up is followed by the app re-reading the session, which can
  // re-render this page once more; typing before that settles would be lost.
  await page.waitForLoadState('networkidle')

  const key = teamKey()
  await page.getByLabel('Team name').fill(`Team ${key}`)
  await page.getByLabel(/^Key/).fill(key)
  await expect(page.getByLabel(/^Key/)).toHaveValue(key)
  await page.getByRole('button', { name: 'Create team' }).click()

  await expect(page).toHaveURL(new RegExp(`/${key}$`))
  // The team's default columns, all empty.
  for (const status of ['Backlog', 'Todo', 'In Progress', 'Done']) {
    await expect(column(page, status)).toBeVisible()
  }
  await expect(page.locator('[data-card]')).toHaveCount(0)
})
