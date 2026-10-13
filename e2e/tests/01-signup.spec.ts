import { expect, test } from '@playwright/test'

import { column, teamKey, unique } from './helpers'

/** Journey 1: sign up, create a team from the first page, land on its empty board. */
test('a new person signs up, makes a team, and lands on an empty board', async ({ page }) => {
  const username = unique('new')
  await page.goto('/register')

  await page.getByLabel('Full name').fill('Grace Hopper')
  await page.getByLabel('Email').fill(`${username}@example.com`)
  await page.getByLabel('Password').fill('correct-horse-battery')
  await page.getByRole('button', { name: 'Create account' }).click()

  // With no team yet, a first page: what there is to reach, the teams there
  // are, and making one as an option among them (#318). "The first team" on
  // a stack nobody has used yet.
  await expect(page.getByRole('heading', { name: /Welcome, Grace/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /People/ })).toBeVisible()
  await page.getByRole('link', { name: /^Create (a|the first) team$/ }).click()
  await expect(page).toHaveURL(/\/new-team$/)
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
