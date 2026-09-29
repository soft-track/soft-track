/** Finance rows for the component tests (#131). */
import type {
  CompensationRecordRead,
  CompensationRow,
  FinancePerson,
  PersonRef,
} from '@/api/generated/models'

export const GRACE: PersonRef = {
  id: 2,
  username: 'grace',
  full_name: 'Grace Mensah',
  avatar_color: '#14b8a6',
  is_active: true,
  job_title: 'Payroll Lead',
}

export function financePerson(
  id: number,
  fullName: string,
  overrides: Partial<FinancePerson> = {},
): FinancePerson {
  return {
    id,
    username: fullName.split(' ')[0].toLowerCase(),
    full_name: fullName,
    avatar_color: '#6366f1',
    is_active: true,
    job_title: null,
    department: null,
    ...overrides,
  }
}

export function payRecord(
  id: number,
  overrides: Partial<CompensationRecordRead> = {},
): CompensationRecordRead {
  return {
    id,
    amount_minor: 725000,
    currency: 'USD',
    pay_schedule: 'monthly',
    effective_on: '2023-08-14',
    kind: 'hire',
    note: null,
    corrects_id: null,
    corrected_by_id: null,
    standing: 'current',
    recorded_by: GRACE,
    created_at: '2023-08-01T09:00:00',
    ...overrides,
  }
}

export function payRow(
  person: FinancePerson,
  current: CompensationRecordRead | null,
  overrides: Partial<CompensationRow> = {},
): CompensationRow {
  return { person, current, change_percent: null, scheduled: [], ...overrides }
}
