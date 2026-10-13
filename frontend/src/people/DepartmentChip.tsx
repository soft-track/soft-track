import type { DepartmentRef } from '@/api/generated/models'
import { departmentColor } from '@/people/departmentColor'

/** A department, where it is a fact about somebody (#123). */
export function DepartmentChip({ department }: { department: DepartmentRef }) {
  return (
    <span className="chip" style={{ ['--chip' as string]: departmentColor(department.id) }}>
      {department.name}
    </span>
  )
}

/** The dot beside a department's name in a list of them. */
export function DepartmentDot({ id }: { id: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: departmentColor(id) }}
    />
  )
}
