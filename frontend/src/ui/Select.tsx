import type { SelectHTMLAttributes } from 'react'

import { Icon } from '@/ui/Icon'

/**
 * A native `<select>` dressed as a glass pill.
 *
 * Native on purpose: it is keyboard-accessible, screen-reader friendly and
 * works on every platform for free. Only the chrome is ours -- the arrow is
 * drawn here so it matches the rest of the controls in both themes.
 */
export function Select({
  dense = false,
  block = false,
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  /** The compact size used in dense rows such as the issue properties. */
  dense?: boolean
  /** Stretch to the container's width. */
  block?: boolean
}) {
  return (
    <span className={`select-wrap ${block ? 'w-full' : ''} ${className}`}>
      <select
        {...props}
        className={`select ${dense ? 'select-sm' : ''} ${block ? 'select-block' : ''}`}
      >
        {children}
      </select>
      <Icon name="chevron-down" size={dense ? 12 : 14} className="select-chevron" />
    </span>
  )
}
