import { expect } from '@playwright/test'

import { api, makeTeam, signIn, test } from './helpers'

/** Journey 4: an @mention in a comment reaches the mentioned person's inbox. */
test('a mention in a comment shows up in the mentioned person’s inbox', async ({
  browser,
  request,
  owner: author,
  teammate: mentioned,
}) => {
  const team = await makeTeam(request, author)
  await api(request, author, 'post', `/teams/${team.id}/members`, { email: mentioned.email })
  const issue = await api(request, author, 'post', `/teams/${team.id}/issues`, {
    title: 'Needs a second pair of eyes',
  })

  // The author comments, as themselves, in their own browser.
  const authorContext = await browser.newContext()
  const authorPage = await authorContext.newPage()
  await signIn(authorPage, author)
  await authorPage.goto(`/${team.key}/issue/${issue.number}`)
  const composer = authorPage.getByPlaceholder('Leave a comment…')
  await composer.fill(`@${mentioned.username} could you take a look?`)
  await authorPage.getByRole('button', { name: 'Send' }).click()
  await expect(authorPage.getByText('could you take a look?')).toBeVisible()
  await authorContext.close()

  // The mentioned person, in a browser of their own, finds it in the inbox.
  const theirContext = await browser.newContext()
  const theirPage = await theirContext.newPage()
  await signIn(theirPage, mentioned)
  await theirPage.goto(`/${team.key}`)
  await theirPage.getByRole('button', { name: /Notifications \(1 unread\)/ }).click()
  const inbox = theirPage.getByRole('dialog', { name: 'Notifications' })
  await expect(inbox.getByText(/Ada Author mentioned you/)).toBeVisible()
  await expect(inbox.getByText('Needs a second pair of eyes')).toBeVisible()
  await theirContext.close()
})
