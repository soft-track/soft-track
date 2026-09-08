import { MOD_KEY, SHORTCUT_GROUPS } from '@/keyboard/shortcuts'
import { Icon } from '@/ui/Icon'

export function ShortcutsCheatsheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="scrim fixed inset-0 z-40 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
        className="pop-in glass-strong w-full max-w-md rounded-panel p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight text-neutral-900">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn btn-ghost btn-icon btn-sm text-neutral-400"
          >
            <Icon name="close" size={15} />
          </button>
        </div>

        <div className="space-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="eyebrow mb-2">{group.title}</p>
              <ul className="space-y-1.5">
                {group.shortcuts.map((shortcut) => (
                  <li
                    key={shortcut.description}
                    className="flex items-center justify-between gap-4"
                  >
                    <span className="text-sm text-neutral-700">{shortcut.description}</span>
                    <span className="flex shrink-0 gap-1">
                      {shortcut.keys.map((key) => (
                        <kbd key={key} className="kbd">
                          {key === '⌘' ? MOD_KEY : key}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
