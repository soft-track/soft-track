import type { TestResult } from '@/api/generated/models'
import { RESULT_META } from '@/testcases/runs'

/** A result as a chip: Passed, Failed, Blocked, Skipped, or Not run. */
export function ResultChip({ result }: { result: TestResult | null | undefined }) {
  const meta = RESULT_META[result ?? 'not_run']
  return (
    <span className="chip shrink-0" style={{ ['--chip' as string]: meta.colour }}>
      {meta.label}
    </span>
  )
}
