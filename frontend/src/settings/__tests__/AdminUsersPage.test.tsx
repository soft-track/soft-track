// @vitest-environment jsdom
/**
 * Administration → Users (#122-#124): what people say about themselves,
 * shown on their row; the department, manager and start date a site admin
 * sets inline; and the people left reporting to a deactivated manager.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminUserRead, ListUsersAdminUsersGetParams } from '@/api/generated/models'
import AdminUsersPage from '@/settings/AdminUsersPage'

type Page = { items: unknown[]; total: number; limit: number; offset: number }
const page = (items: unknown[]): Page => ({ items, total: items.length, limit: 25, offset: 0 })

const mocks = vi.hoisted(() => ({
  /** The main list, by whether it is filtered to stranded reports. */
  users: { isPending: false, data: undefined as unknown },
  strandedList: { isPending: false, data: undefined as unknown },
  /** The banner's own query. */
  stranded: { isPending: false, data: undefined as unknown },
  /** The manager picker's search. */
  candidates: { isPending: false, data: undefined as unknown },
  listCalls: [] as unknown[],
  update: { mutateAsync: vi.fn(), isPending: false },
  reset: { mutateAsync: vi.fn(), isPending: false },
  departments: {
    data: [
      { id: 1, name: 'Engineering', description: null, member_count: 3 },
      { id: 2, name: 'Design', description: null, member_count: 0 },
    ],
  },
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { id: 1 } }),
}))

vi.mock('@/api/generated/endpoints/admin/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/admin/admin')>()),
  useListUsersAdminUsersGet: (params: ListUsersAdminUsersGetParams) => {
    mocks.listCalls.push(params)
    if (params.limit === 8) return mocks.candidates
    if (params.reports_to_deactivated && params.limit === 200) return mocks.stranded
    if (params.reports_to_deactivated) return mocks.strandedList
    return mocks.users
  },
  useUpdateUserAdminUsersUserIdPatch: () => mocks.update,
  useResetPasswordAdminUsersUserIdResetPasswordPost: () => mocks.reset,
}))

vi.mock('@/api/generated/endpoints/departments/departments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/departments/departments')>()),
  useListDepartmentsDepartmentsGet: () => mocks.departments,
}))

const BASE: AdminUserRead = {
  id: 0,
  email: '',
  username: '',
  full_name: '',
  avatar_color: '#6366f1',
  is_active: true,
  is_site_admin: false,
  is_finance_admin: false,
  has_password: true,
  created_at: '2026-01-01T00:00:00',
  last_login_at: null,
  team_count: 1,
  report_count: 0,
  job_title: null,
  location: null,
  started_on: null,
  department: null,
  manager: null,
}

const AMINA: AdminUserRead = {
  ...BASE,
  id: 3,
  email: 'amina@northwind.dev',
  username: 'amina',
  full_name: 'Amina Khan',
  job_title: 'Engineering Manager',
}

const DANIEL: AdminUserRead = {
  ...BASE,
  id: 2,
  email: 'daniel@northwind.dev',
  username: 'daniel',
  full_name: 'Daniel Okafor',
  avatar_color: '#14b8a6',
  job_title: 'Senior Backend Engineer',
  location: 'Lagos, Nigeria',
  started_on: '2023-08-14',
  department: { id: 1, name: 'Engineering' },
}

const AS_MANAGER = (person: AdminUserRead) => ({
  id: person.id,
  username: person.username,
  full_name: person.full_name,
  avatar_color: person.avatar_color,
  is_active: person.is_active,
  job_title: person.job_title,
})

function renderPage(rows: AdminUserRead[]) {
  mocks.users.data = page(rows)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AdminUsersPage />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.update.mutateAsync.mockReset().mockResolvedValue(DANIEL)
  mocks.stranded.data = page([])
  mocks.strandedList.data = page([])
  mocks.candidates.data = page([AMINA, DANIEL])
  mocks.listCalls = []
})

afterEach(() => {
  cleanup()
})

describe('The admin user directory', () => {
  it('shows title, department, location and start date on the row', () => {
    renderPage([DANIEL])
    expect(
      screen.getByText(
        'Senior Backend Engineer · Engineering · Lagos, Nigeria · started 14 Aug 2023',
      ),
    ).toBeTruthy()
  })

  it('shows who someone reports to, and how many report to them', () => {
    renderPage([
      { ...AMINA, report_count: 2 },
      { ...DANIEL, location: null, started_on: null, manager: AS_MANAGER(AMINA) },
    ])
    expect(screen.getByText('Engineering Manager · 2 direct reports')).toBeTruthy()
    expect(
      screen.getByText('Senior Backend Engineer · Engineering · reports to Amina Khan'),
    ).toBeTruthy()
  })

  it('shows no line at all for someone with nothing filled in', () => {
    renderPage([{ ...DANIEL, job_title: null, location: null, started_on: null, department: null }])
    expect(screen.queryByText(/started/)).toBeNull()
    expect(screen.queryByText(/Lagos/)).toBeNull()
  })

  it('sets a department and a start date inline, and not the title or location', async () => {
    const user = renderPage([{ ...DANIEL, started_on: null, department: null }])

    await user.click(screen.getByRole('button', { name: 'Edit Daniel Okafor' }))
    const editor = screen.getByRole('form', { name: 'Organisation details for Daniel Okafor' })
    expect(within(editor).queryByLabelText(/Job title/)).toBeNull()

    await user.selectOptions(within(editor).getByLabelText('Department'), 'Design')
    await user.type(within(editor).getByLabelText('Start date'), '2023-08-14')
    await user.click(within(editor).getByRole('button', { name: 'Save' }))

    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      userId: 2,
      data: { department_id: 2, manager_id: null, started_on: '2023-08-14' },
    })
    // Closed once it has saved.
    expect(screen.queryByRole('form', { name: /Organisation details/ })).toBeNull()
  })

  it('clears a department and a start date with explicit nulls', async () => {
    const user = renderPage([DANIEL])

    await user.click(screen.getByRole('button', { name: 'Edit Daniel Okafor' }))
    const editor = screen.getByRole('form', { name: /Organisation details/ })
    // Starts on what they have.
    expect((within(editor).getByLabelText('Department') as HTMLSelectElement).value).toBe('1')
    await user.selectOptions(within(editor).getByLabelText('Department'), 'No department')
    await user.clear(within(editor).getByLabelText('Start date'))
    await user.click(within(editor).getByRole('button', { name: 'Save' }))

    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      userId: 2,
      data: { department_id: null, manager_id: null, started_on: null },
    })
  })

  it('picks a manager by typing part of their name', async () => {
    const user = renderPage([DANIEL])
    await user.click(screen.getByRole('button', { name: 'Edit Daniel Okafor' }))

    const picker = screen.getByRole('combobox', { name: 'Manager of Daniel Okafor' })
    await user.type(picker, 'ami')
    // Searched as typed, once the typing pauses.
    await waitFor(() => expect(mocks.listCalls).toContainEqual({ q: 'ami', limit: 8 }))
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    // Not Daniel himself, and "nobody" last.
    expect(options).toHaveLength(2)
    expect(within(options[0]).getByText('Amina Khan')).toBeTruthy()
    expect(within(options[0]).getByText('Engineering Manager')).toBeTruthy()
    expect(options[1].textContent).toBe('No manager')

    await user.click(options[0])
    expect((picker as HTMLInputElement).value).toBe('Amina Khan')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      userId: 2,
      data: expect.objectContaining({ manager_id: 3 }),
    })
  })

  it('picks from the keyboard, and "No manager" clears it', async () => {
    const user = renderPage([{ ...DANIEL, manager: AS_MANAGER(AMINA) }])
    await user.click(screen.getByRole('button', { name: 'Edit Daniel Okafor' }))

    const picker = screen.getByRole('combobox', { name: 'Manager of Daniel Okafor' })
    expect((picker as HTMLInputElement).value).toBe('Amina Khan')
    await user.click(picker)
    // Amina, then "No manager".
    await user.keyboard('{ArrowDown}{Enter}')
    expect((picker as HTMLInputElement).value).toBe('')

    // Enter chose the option; it did not submit the form around it.
    expect(mocks.update.mutateAsync).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      userId: 2,
      data: expect.objectContaining({ manager_id: null }),
    })
  })

  it('offers nobody deactivated as a new manager', async () => {
    mocks.candidates.data = page([{ ...AMINA, is_active: false }])
    const user = renderPage([DANIEL])
    await user.click(screen.getByRole('button', { name: 'Edit Daniel Okafor' }))
    await user.click(screen.getByRole('combobox', { name: 'Manager of Daniel Okafor' }))

    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['No manager'])
  })

  it('shows a refused loop in the editor, and keeps it open', async () => {
    mocks.update.mutateAsync.mockRejectedValue({
      response: {
        data: {
          detail:
            'Amina Khan can’t report to Daniel Okafor: Daniel Okafor already reports to Amina Khan',
          code: 'manager_cycle',
        },
      },
    })
    const user = renderPage([AMINA])

    await user.click(screen.getByRole('button', { name: 'Edit Amina Khan' }))
    const editor = screen.getByRole('form', { name: /Organisation details/ })
    await user.click(within(editor).getByRole('button', { name: 'Save' }))

    expect(within(editor).getByRole('alert').textContent).toMatch(
      /Daniel Okafor already reports to Amina Khan/,
    )
    expect(screen.getByRole('form', { name: /Organisation details/ })).toBeTruthy()
  })

  it('says when people report to a deactivated manager, and lists them', async () => {
    const jonas = { ...AS_MANAGER(AMINA), full_name: 'Jonas Berg', is_active: false }
    const reports = [
      { ...DANIEL, manager: jonas },
      { ...AMINA, id: 7, username: 'hana', full_name: 'Hana Sato', manager: jonas },
    ]
    mocks.stranded.data = page(reports)
    mocks.strandedList.data = page(reports)
    const user = renderPage([DANIEL])

    const banner = screen.getByText(/report to a deactivated manager/).closest('div')!
    expect(banner.textContent).toMatch('2 people report to a deactivated manager (Jonas Berg).')

    await user.click(within(banner).getByRole('button', { name: 'Show them' }))
    expect(mocks.listCalls).toContainEqual({
      q: undefined,
      limit: 25,
      offset: 0,
      reports_to_deactivated: true,
    })
    expect(screen.getByText('Reports of a deactivated manager')).toBeTruthy()
    expect(screen.getAllByText(/reports to Jonas Berg \(deactivated\)/)).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Show everyone' }))
    expect(screen.queryByText('Reports of a deactivated manager')).toBeNull()
  })

  it('shows no banner when nobody is stranded', () => {
    renderPage([DANIEL])
    expect(screen.queryByText(/deactivated manager/)).toBeNull()
  })
})

describe('Finance access (#130)', () => {
  const GRACE: AdminUserRead = {
    ...BASE,
    id: 4,
    email: 'grace@northwind.dev',
    username: 'grace',
    full_name: 'Grace Mensah',
    is_finance_admin: true,
    finance_admin_since: '2026-01-02T09:00:00',
    finance_admin_granted_by: AS_MANAGER({ ...AMINA, full_name: 'Sofia Marquez' }),
  }

  it('is its own chip, with when it was granted and by whom', () => {
    renderPage([GRACE, DANIEL])
    expect(screen.getAllByText('Finance')).toHaveLength(1)
    expect(
      screen.getByText('finance access since 2 Jan 2026, granted by Sofia Marquez'),
    ).toBeTruthy()
  })

  it('is its own filter', async () => {
    const user = renderPage([GRACE])
    await user.click(screen.getByRole('button', { name: 'Finance admins' }))
    expect(mocks.listCalls).toContainEqual({
      q: undefined,
      limit: 25,
      offset: 0,
      role: 'finance_admin',
    })
    expect(
      screen.getByRole('button', { name: 'Finance admins' }).getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('asks before granting it, and says what it gives', async () => {
    const user = renderPage([DANIEL])
    await user.click(screen.getByRole('button', { name: 'Grant finance access' }))

    const dialog = screen.getByRole('dialog', { name: 'Give Daniel Okafor finance access?' })
    expect(dialog.textContent).toMatch(
      'Daniel Okafor will see every salary, payroll run, expense claim and budget',
    )
    expect(dialog.textContent).toMatch('Neither one includes the other.')
    expect(mocks.update.mutateAsync).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Grant finance access' }))
    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      userId: 2,
      data: { is_finance_admin: true },
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cancels a grant with Escape', async () => {
    const user = renderPage([DANIEL])
    await user.click(screen.getByRole('button', { name: 'Grant finance access' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.update.mutateAsync).not.toHaveBeenCalled()
  })

  it('revokes it without asking', async () => {
    const user = renderPage([GRACE])
    await user.click(screen.getByRole('button', { name: 'Revoke finance access' }))
    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      userId: 4,
      data: { is_finance_admin: false },
    })
  })

  it('is not offered to a deactivated account', () => {
    renderPage([{ ...DANIEL, is_active: false }])
    expect(screen.queryByRole('button', { name: 'Grant finance access' })).toBeNull()
  })
})
