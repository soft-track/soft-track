import type { ReactNode } from 'react'

import { useAuthConfigAuthConfigGet } from '@/api/generated/endpoints/auth/auth'
import {
  knownProviders,
  PROVIDERS,
  startProviderFlow,
  type ProviderName,
} from '@/auth/oauth'
import { useTranslation } from '@/i18n'

/**
 * The brand marks, inline.
 *
 * Not entries in `ui/Icon.tsx`: those are one stroked path on a shared `svg`
 * with `fill="none"`, and these are filled multi-path logos that have to look
 * like themselves. A recognisable Google "G" is the point of the button.
 */
const MARKS: Record<ProviderName, ReactNode> = {
  google: (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.55-5.17 3.55-8.87Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.27v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.27a12 12 0 0 0 0 10.76l4-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.18 15.23 0 12 0A12 12 0 0 0 1.27 6.62l4 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.5 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z"
      />
    </svg>
  ),
}

/**
 * "Continue with Google / GitHub", or nothing at all.
 *
 * Nothing at all is the default: an instance that has configured no provider
 * gets the sign-in form it has always had, with no divider, no empty space and
 * no hint that a feature is missing. That is what keeps SoftTrack
 * self-hostable with no external dependency.
 */
export function ProviderButtons({
  next,
  invite,
  action = 'continue',
}: {
  next?: string
  invite?: string
  /** Which sentence the buttons say: "Continue with", "Sign up with" or "Accept with". */
  action?: 'continue' | 'signUp' | 'accept'
}) {
  const { t } = useTranslation(['auth', 'common'])
  const config = useAuthConfigAuthConfigGet()
  const providers = knownProviders(config.data?.oauth_providers)

  if (providers.length === 0) return null

  return (
    <div>
      <div className="grid gap-2">
        {providers.map((provider) => (
          // A button rather than a link, because pressing it has to write the
          // handshake into this tab's sessionStorage first -- and because a
          // sign-in opened in a second tab would not have it.
          <button
            key={provider}
            type="button"
            onClick={() => startProviderFlow(provider, { next, invite })}
            className="btn btn-secondary h-10 w-full text-sm"
          >
            {MARKS[provider]}
            {t(`providers.${action}`, { provider: PROVIDERS[provider] })}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-neutral-200" />
        <span className="text-xs text-neutral-400">{t('providers.or')}</span>
        <span className="h-px flex-1 bg-neutral-200" />
      </div>
    </div>
  )
}
