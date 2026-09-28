// @vitest-environment jsdom
/**
 * People (#125): the directory's filters come from the URL and go to the
 * server; chips say what is filtered; nobody matching says so.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ListPeopleUsersGetParams, PeoplePage, PersonRead } from '@/api/generated/models'
import DirectoryPage from '@/people/DirectoryPage'

const mocks = vi.hoisted(() => ({
  pages: new Map<string, unknown>(),
  calls: [] as unknown[],
  departments: [
    { id: 1, name: 'Engineering', description: null, member_count: 3 },
    { id: 2, name: 'Design', description: null, member_count: 0 },
  ],
}))

vi.mock('@/api/generated/endpoints/people/people', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/people/people')>()),
  useListPeopleUsersGet: (params: ListPeopleUsersGetParams) => {
    mocks.calls.push(params)
    if (params.limit === 1) return { isPending: false, data: page([], 48) }
    const key = JSON.stringify(params)
    return { isPending: false, isError: false, data: mocks.pages.get(key) ?? page([]) }
  },
}))

vi.mock('@/api/generated/endpoints/departments/departments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/departments/departments')>()),
  useListDepartmentsDepartmentsGet: () => ({ data: mocks.departments }),
}))

vi.mock('@/notifications/NotificationsBell', () => ({ NotificationsBell: () => null }))

const AMINA_REF = {
  id: 3,
  username: 'amina',
  full_name: 'Amina Khan',
  avatar_color: '#6366f1',
  is_active: true,
  job_title: 'Engineering Manager',
}

function person(id: number, overrides: Partial<PersonRead> = {}): PersonRead {
  return {
    id,
    username: `p${id}`,
    full_name: `Person ${id}`,
    avatar_color: '#14b8a6',
    is_active: true,
    job_title: null,
    location: null,
    started_on: null,
    department: null,
    manager: null,
    ...overrides,
  }
}

function page(items: PersonRead[], total = items.length, extra = {}): PeoplePage {
  return { items, total, limit: 50, offset: 0, manager: null, ...extra }
}

function answer(params: ListPeopleUsersGetParams, result: PeoplePage) {
  mocks.pages.set(JSON.stringify(params), result)
}

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.search}</output>
}

function renderAt(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/people" element={<Outlet context={{}} />}>
            <Route
              index
              element={
                <>
                  <DirectoryPage />
                  <Where />
                </>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const where = () => screen.getByTestId('where').textContent

beforeEach(() => {
  mocks.pages.clear()
  mocks.calls = []
})

afterEach(() => {
  cleanup()
})

describe('The people directory', () => {
  it('lists everyone with their title, department, manager and location', () => {
    answer(
      { limit: 50, offset: 0 },
      page([
        person(2, {
          full_name: 'Daniel Okafor',
          username: 'daniel',
          job_title: 'Senior Backend Engineer',
          department: { id: 1, name: 'Engineering' },
          manager: AMINA_REF,
          location: 'Lagos',
        }),
      ]),
    )
    renderAt('/people')

    const row = screen.getByText('Daniel Okafor').closest('tr')!
    expect(within(row).getByText('@daniel')).toBeTruthy()
    expect(within(row).getByText('Senior Backend Engineer')).toBeTruthy()
    expect(within(row).getByText('Engineering')).toBeTruthy()
    expect(within(row).getByText('Amina Khan')).toBeTruthy()
    expect(within(row).getByText('Lagos')).toBeTruthy()
    // The count beside the title is everyone, whatever is filtered.
    expect(screen.getByRole('heading', { name: /People/ }).textContent).toContain('48')
  })

  it('asks the server for exactly the filters in the URL', () => {
    renderAt('/people?q=staff&department=1&manager=amina')
    expect(mocks.calls).toContainEqual({
      q: 'staff',
      department_id: 1,
      manager: 'amina',
      limit: 50,
      offset: 0,
    })
  })

  it('says in one sentence who the list is, and names the filters as chips', () => {
    answer(
      { department_id: 1, manager: 'amina', limit: 50, offset: 0 } as ListPeopleUsersGetParams,
      page([person(2), person(4)], 2, { manager: AMINA_REF }),
    )
    renderAt('/people?department=1&manager=amina')

    expect(screen.getByText(/in Engineering who report to Amina Khan/).textContent).toBe(
      '2 people in Engineering who report to Amina Khan',
    )
    expect(screen.getByText('Department: Engineering')).toBeTruthy()
    expect(screen.getByText('Manager: Amina Khan')).toBeTruthy()
  })

  it('takes a filter off with its chip, keeping the others', async () => {
    const user = renderAt('/people?q=staff&department=1&manager=amina')
    await user.click(
      screen.getByRole('button', { name: 'Remove the Department: Engineering filter' }),
    )
    expect(where()).toBe('?q=staff&manager=amina')
  })

  it('puts a chosen department in the URL', async () => {
    const user = renderAt('/people')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Department' }), 'Design')
    expect(where()).toBe('?department=2')
  })

  it('puts a chosen manager in the URL by username', async () => {
    answer({ q: undefined, limit: 8 } as ListPeopleUsersGetParams, page([person(3, AMINA_REF)]))
    const user = renderAt('/people')
    await user.click(screen.getByRole('combobox', { name: 'Manager' }))
    await user.click(within(screen.getByRole('listbox')).getByText('Amina Khan'))
    expect(where()).toBe('?manager=amina')
  })

  it('searches once the typing pauses, replacing the URL rather than adding to it', async () => {
    const user = renderAt('/people')
    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), 'kenji')
    await waitFor(() => expect(where()).toBe('?q=kenji'))
    expect(mocks.calls).toContainEqual({ q: 'kenji', limit: 50, offset: 0 })
  })

  it('says what was filtered when nobody matches, and clears it', async () => {
    const user = renderAt('/people?q=paris&department=2')
    expect(screen.getByText('No one in Design matches “paris”.')).toBeTruthy()
    expect(screen.getByText('Search covers name, username and job title.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(where()).toBe('')
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
  })

  it('pages on the server, and starts over when the filters change', async () => {
    answer(
      { limit: 50, offset: 0 },
      page(
        Array.from({ length: 50 }, (_, i) => person(i + 1)),
        120,
      ),
    )
    const user = renderAt('/people')
    expect(screen.getByText('1–50 of 120')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(mocks.calls).toContainEqual({ limit: 50, offset: 50 })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Department' }), 'Design')
    expect(mocks.calls).toContainEqual({ department_id: 2, limit: 50, offset: 0 })
  })
})
