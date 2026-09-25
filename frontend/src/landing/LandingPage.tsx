import { Link } from 'react-router-dom'

import { useAuthConfigAuthConfigGet } from '@/api/generated/endpoints/auth/auth'
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/auth/demo'
import { i18n, Trans, useTranslation } from '@/i18n'
import { Icon, type IconName } from '@/ui/Icon'
import { Logo } from '@/ui/Logo'
import { useTheme } from '@/ui/theme'

const REPOSITORY_URL = 'https://github.com/soft-track/soft-track'

/** Shell commands, the same in every language. */
const INSTALL_COMMANDS = `git clone ${REPOSITORY_URL}.git\ncd soft-track\ndocker compose up`

type FeatureKey = 'board' | 'cycles' | 'reports' | 'notifications' | 'keyboard' | 'moving'

/**
 * What is in the tracker, in the order someone evaluating it would ask.
 *
 * Every line describes something that exists. A landing page for a
 * self-hosted tool is read by the person who will have to run it, and one
 * overstated claim here is discovered on day one.
 */
const FEATURES: { icon: IconName; title: string; body: string }[] = [
  feature('board', 'board'),
  feature('calendar', 'cycles'),
  feature('chart', 'reports'),
  feature('bell', 'notifications'),
  feature('command', 'keyboard'),
  feature('upload', 'moving'),
]

// Title and body are getters over the catalog (#106), read when the page renders.
function feature(icon: IconName, key: FeatureKey) {
  return {
    icon,
    get title() {
      return i18n.t(`landing:features.${key}.title`)
    },
    get body() {
      return i18n.t(`landing:features.${key}.body`)
    },
  }
}

export default function LandingPage() {
  const config = useAuthConfigAuthConfigGet()
  const { theme, toggle: toggleTheme } = useTheme()
  const { t } = useTranslation(['landing', 'common'])

  // Same rule the sign-in page follows: never link to a form that will refuse.
  const openRegistration = config.data?.open_registration !== false
  const demoCredentials = config.data?.demo_credentials === true

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 px-4 pt-4">
        <nav className="glass mx-auto flex max-w-5xl items-center justify-between rounded-panel px-4 py-2.5">
          <Logo size={26} withWordmark />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleTheme}
              className="btn btn-ghost btn-icon btn-sm"
              aria-label={theme === 'dark' ? t('page.nav.toLight') : t('page.nav.toDark')}
              title={theme === 'dark' ? t('page.nav.lightTheme') : t('page.nav.darkTheme')}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
            </button>
            <a
              href={REPOSITORY_URL}
              className="btn btn-ghost btn-sm hidden sm:inline-flex"
              target="_blank"
              rel="noreferrer"
            >
              {t('page.nav.source')}
            </a>
            <Link to="/login" className="btn btn-primary btn-sm">
              {t('page.nav.signIn')}
            </Link>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4">
        <section className="pop-in py-16 text-center sm:py-24">
          <h1 className="mx-auto max-w-3xl text-balance text-4xl font-semibold tracking-tight text-neutral-900 sm:text-5xl">
            <Trans
              t={t}
              i18nKey="page.hero.title"
              components={{ highlight: <span className="text-gradient" /> }}
            />
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-balance text-base text-neutral-500 sm:text-lg">
            {t('page.hero.lede')}
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
            <Link to="/login" className="btn btn-primary h-10 px-5 text-sm">
              {t('page.hero.signIn')}
            </Link>
            {openRegistration && (
              <Link to="/register" className="btn btn-secondary h-10 px-5 text-sm">
                {t('page.hero.register')}
              </Link>
            )}
          </div>

          {demoCredentials && (
            <p className="mt-4 text-xs text-neutral-400">
              {t('page.hero.demo', { email: DEMO_EMAIL, password: DEMO_PASSWORD })}
            </p>
          )}
        </section>

        <section aria-labelledby="features-heading" className="pb-16 sm:pb-24">
          <h2 id="features-heading" className="sr-only">
            {t('page.featuresHeading')}
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="glass-card rounded-card p-5">
                <span className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-control bg-brand-50 text-brand-600">
                  <Icon name={feature.icon} size={18} />
                </span>
                <h3 className="text-sm font-semibold text-neutral-900">{feature.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-neutral-500">{feature.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="self-host-heading"
          className="glass-strong sheen mb-16 rounded-panel p-6 sm:mb-24 sm:p-8"
        >
          <h2
            id="self-host-heading"
            className="text-xl font-semibold tracking-tight text-neutral-900"
          >
            {t('page.selfHost.title')}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-500">
            {t('page.selfHost.body')}
          </p>
          <pre className="well mt-5 overflow-x-auto rounded-control p-4 text-xs text-neutral-700">
            <code>{INSTALL_COMMANDS}</code>
          </pre>
        </section>
      </main>

      <footer className="border-t px-4 py-8 hairline">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 text-xs text-neutral-400">
          <span>{t('page.footer.licence')}</span>
          <a href={REPOSITORY_URL} className="link" target="_blank" rel="noreferrer">
            {t('page.footer.github')}
          </a>
        </div>
      </footer>
    </div>
  )
}
