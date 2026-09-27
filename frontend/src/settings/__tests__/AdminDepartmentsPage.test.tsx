// @vitest-environment jsdom
/**
 * Administration → Departments (#123): create, rename in place, and a delete
 * that asks where the people go before it lets anybody go anywhere.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DepartmentRead } from '@/api/generated/models'
import AdminDepartmentsPage from '@/settings/AdminDepartmentsPage'

const mocks = vi.hoisted(() => ({
  list: { isPending: false, data: [] as unknown[] },
  create: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
  remove: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/api/generated/endpoints/departments/departments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/departments/departments')>()),
  useListDepartmentsDepartmentsGet: () => mocks.list,
  useCreateDepartmentDepartmentsPost: () => mocks.create,
  useUpdateDepartmentDepartmentsDepartmentIdPatch: () => mocks.update,
  useDeleteDepartmentDepartmentsDepartmentIdDelete: () => mocks.remove,
}))

const ENGINEERING: DepartmentRead = {
  id: 1,
  name: 'Engineering',
  description: 'Product and platform engineering',
  member_count: 14,
}
const CUSTOMER_SUCCESS: DepartmentRead = {
  id: 3,
  name: 'Customer Success',
  description: 'Support and onboarding',
  member_count: 6,
}
const RESEARCH: DepartmentRead = { id: 8, name: 'Research', description: null, member_count: 0 }

function renderPage(rows: DepartmentRead[]) {
  mocks.list.data = rows
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AdminDepartmentsPage />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.create.mutateAsync.mockReset().mockResolvedValue(RESEARCH)
  mocks.update.mutateAsync.mockReset().mockResolvedValue(ENGINEERING)
  mocks.remove.mutateAsync.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
})

describe('Departments', () => {
  it('lists each department with its description and how many people are in it', () => {
    renderPage([ENGINEERING, RESEARCH])
    const list = screen.getByRole('region', { name: 'Departments' })
    expect(within(list).getByText('Product and platform engineering')).toBeTruthy()
    expect(within(list).getByText('14 people')).toBeTruthy()
    expect(within(list).getByText('Nobody yet')).toBeTruthy()
  })

  it('creates one with a name and a description', async () => {
    const user = renderPage([])
    await user.click(screen.getByRole('button', { name: 'New department' }))
    const dialog = screen.getByRole('dialog', { name: 'New department' })

    await user.type(within(dialog).getByLabelText('Name'), 'Research')
    await user.type(within(dialog).getByLabelText(/Description/), 'Customer interviews')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
      data: { name: 'Research', description: 'Customer interviews' },
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('names the clash when a name is taken, and keeps the dialog open', async () => {
    mocks.create.mutateAsync.mockRejectedValue({
      response: {
        data: {
          detail: '“Engineering” already exists. Department names are unique, whatever the case.',
          code: 'department_name_taken',
        },
      },
    })
    const user = renderPage([ENGINEERING])
    await user.click(screen.getByRole('button', { name: 'New department' }))
    const dialog = screen.getByRole('dialog', { name: 'New department' })
    await user.type(within(dialog).getByLabelText('Name'), 'engineering')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(within(dialog).getByRole('alert').textContent).toMatch(/“Engineering” already exists/)
    expect(within(dialog).getByLabelText('Name').getAttribute('aria-invalid')).toBe('true')
  })

  it('renames in place', async () => {
    const user = renderPage([ENGINEERING])
    await user.click(screen.getByRole('button', { name: 'Rename Engineering' }))
    const field = screen.getByLabelText('Name of Engineering')
    await user.clear(field)
    await user.type(field, 'Engineering and Data{Enter}')

    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      departmentId: 1,
      data: { name: 'Engineering and Data' },
    })
    expect(screen.queryByLabelText('Name of Engineering')).toBeNull()
  })

  it('leaves the name alone when Escape is pressed', async () => {
    const user = renderPage([ENGINEERING])
    await user.click(screen.getByRole('button', { name: 'Rename Engineering' }))
    await user.type(screen.getByLabelText('Name of Engineering'), ' X{Escape}')

    expect(mocks.update.mutateAsync).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Name of Engineering')).toBeNull()
  })

  it('deletes an empty department with a plain confirm and no body', async () => {
    const user = renderPage([ENGINEERING, RESEARCH])
    await user.click(screen.getByRole('button', { name: 'Delete Research' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete “Research”?' })
    expect(within(dialog).getByText('Nobody is in it.')).toBeTruthy()
    expect(within(dialog).queryByRole('combobox')).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(mocks.remove.mutateAsync).toHaveBeenCalledWith({ departmentId: 8, data: undefined })
  })

  it('will not delete one with people in it until their new place is chosen', async () => {
    const user = renderPage([ENGINEERING, CUSTOMER_SUCCESS])
    await user.click(screen.getByRole('button', { name: 'Delete Customer Success' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete “Customer Success”' })
    expect(within(dialog).getByText(/6 people are in it/)).toBeTruthy()

    const confirm = within(dialog).getByRole('button', { name: 'Delete department' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    // It cannot be moved into itself.
    const options = within(dialog)
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toEqual(['Choose…', 'Engineering', 'No department'])

    await user.selectOptions(within(dialog).getByRole('combobox'), 'Engineering')
    await user.click(confirm)
    expect(mocks.remove.mutateAsync).toHaveBeenCalledWith({
      departmentId: 3,
      data: { move_to_id: 1 },
    })
  })

  it('sends null when its people are to have no department', async () => {
    const user = renderPage([ENGINEERING, CUSTOMER_SUCCESS])
    await user.click(screen.getByRole('button', { name: 'Delete Customer Success' }))
    const dialog = screen.getByRole('dialog')
    await user.selectOptions(within(dialog).getByRole('combobox'), 'No department')
    await user.click(within(dialog).getByRole('button', { name: 'Delete department' }))

    expect(mocks.remove.mutateAsync).toHaveBeenCalledWith({
      departmentId: 3,
      data: { move_to_id: null },
    })
  })
})
