import { type APIRequestContext, type Page, expect, test as base } from '@playwright/test'

/** Where the API is. The frontend is built to call this origin too. */
export const API = process.env.E2E_API_URL ?? 'http://localhost:8000'

/** Unique per run, so journeys never collide with each other or a rerun. */
export const unique = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`

export type Account = {
  email: string
  username: string
  password: string
  name: string
  token: string
  id: number
}

/**
 * An account made through the API. For journeys whose subject is not
 * signing up -- journey 1 signs up through the UI.
 */
export async function register(request: APIRequestContext, name = 'E2E User'): Promise<Account> {
  const username = unique('e2e')
  const email = `${username}@example.com`
  const password = 'correct-horse-battery'
  const response = await request.post(`${API}/auth/register`, {
    data: { email, password, full_name: name, username },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const body = await response.json()
  return { email, username, password, name, token: body.access_token, id: body.user.id }
}

export async function api(
  request: APIRequestContext,
  account: Account,
  method: 'get' | 'post' | 'patch',
  path: string,
  data?: unknown,
) {
  const response = await request[method](`${API}${path}`, {
    data,
    headers: { Authorization: `Bearer ${account.token}` },
  })
  expect(response.ok(), `${method.toUpperCase()} ${path}: ${await response.text()}`).toBeTruthy()
  return response.json()
}

/**
 * A team key: 2 to 6 letters, and random enough that runs against the same
 * stack do not collide (26^6 is about 300 million).
 */
export function teamKey(): string {
  return Array.from({ length: 6 }, () =>
    String.fromCharCode(65 + Math.floor(Math.random() * 26)),
  ).join('')
}

/** A team owned by `account`. */
export async function makeTeam(request: APIRequestContext, account: Account) {
  const key = teamKey()
  return api(request, account, 'post', '/teams', { name: `Team ${key}`, key })
}

/**
 * Sign in by putting the session where the app keeps it, before any page
 * script runs. Signing in through the form is journey 1's business; the
 * others start already signed in.
 */
export async function signIn(page: Page, account: Account) {
  await page.addInitScript((token) => {
    window.localStorage.setItem('softtrack.token', token)
  }, account.token)
}

/** A board column, found by its status name. */
export const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

/** A card on the board, found by its title. */
export const card = (page: Page, title: string) =>
  page.locator('[data-card]').filter({ hasText: title })

/**
 * Two accounts shared by every journey in a run, made once per worker.
 *
 * Registration is rate-limited per address -- every sign-up counts, on
 * purpose -- so a suite that registered a fresh account per journey would
 * eventually be refused by the very limit it runs against. Journeys still
 * never step on each other: each one makes its own team.
 */
export const test = base.extend<object, { owner: Account; teammate: Account }>({
  owner: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext()
      await use(await register(request, 'Ada Author'))
      await request.dispose()
    },
    { scope: 'worker' },
  ],
  teammate: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext()
      await use(await register(request, 'Mo Mentioned'))
      await request.dispose()
    },
    { scope: 'worker' },
  ],
})
