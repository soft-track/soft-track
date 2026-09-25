import { expect } from '@playwright/test'

import { api, makeTeam, signIn, test, unique } from './helpers'

/** Journey 5: search finds an issue by a word only its description holds. */
test('search finds an issue by a word in its description', async ({ page, request, owner }) => {
  const team = await makeTeam(request, owner)
  const word = unique('zeppelin')
  await api(request, owner, 'post', `/teams/${team.id}/issues`, {
    title: 'Opaque title',
    description: `Traced the outage to the ${word} cache layer.`,
  })
  await api(request, owner, 'post', `/teams/${team.id}/issues`, { title: 'Unrelated' })
  await signIn(page, owner)
  await page.goto(`/${team.key}`)

  await page.getByPlaceholder('Search issues…').fill(word)

  const hit = page.getByText('Opaque title')
  await expect(hit).toBeVisible()
  await expect(page.getByText('Unrelated')).toBeHidden()
})
