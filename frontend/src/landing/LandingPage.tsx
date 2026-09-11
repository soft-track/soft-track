import { Link } from 'react-router-dom'

import { useAuthConfigAuthConfigGet } from '@/api/generated/endpoints/auth/auth'
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/auth/demo'
import { Icon, type IconName } from '@/ui/Icon'
import { Logo } from '@/ui/Logo'
import { useTheme } from '@/ui/theme'

const REPOSITORY_URL = 'https://github.com/soft-track/soft-track'

/**
 * What is in the tracker, in the order someone evaluating it would ask.
 *
 * Every line describes something that exists. A landing page for a
 * self-hosted tool is read by the person who will have to run it, and one
 * overstated claim here is discovered on day one.
 */
const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'board',
    title: 'A board and a list',
    body: 'Drag-and-drop kanban over statuses each team defines for itself, or the same issues as a dense sortable list. Filters are shareable, and worth saving as a view.',
  },
  {
    icon: 'calendar',
    title: 'Cycles and estimates',
    body: 'Timeboxed cycles with points on issues, so a burndown has something real to burn down. Sub-issues and issue links for the work that does not fit in one card.',
  },
  {
    icon: 'chart',
    title: 'Reports from real history',
    body: 'Burndown, velocity, cumulative flow and created-versus-resolved, all built from the recorded issue events rather than from whatever the board looks like today.',
  },
  {
    icon: 'bell',
    title: 'Notifications that batch',
    body: 'An in-app inbox, explicit watching that survives the next thing you do, and an optional email digest that gathers up what you have not already read.',
  },
  {
    icon: 'command',
    title: 'Built for the keyboard',
    body: 'A command palette, full-text search across issues and comments, and markdown with @mentions everywhere text is written.',
  },
  {
    icon: 'upload',
    title: 'A way in and a way out',
    body: 'Import the Jira board you are leaving, attach files to issues and comments, and link branches and pull requests from GitHub or GitLab.',
  },
]

export default function LandingPage() {
  const config = useAuthConfigAuthConfigGet()
  const { theme, toggle: toggleTheme } = useTheme()

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
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
            </button>
            <a
              href={REPOSITORY_URL}
              className="btn btn-ghost btn-sm hidden sm:inline-flex"
              target="_blank"
              rel="noreferrer"
            >
              Source
            </a>
            <Link to="/login" className="btn btn-primary btn-sm">
              Sign in
            </Link>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4">
        <section className="pop-in py-16 text-center sm:py-24">
          <h1 className="mx-auto max-w-3xl text-balance text-4xl font-semibold tracking-tight text-neutral-900 sm:text-5xl">
            An issue tracker your team can <span className="text-gradient">actually host</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-balance text-base text-neutral-500 sm:text-lg">
            Teams, projects and cycles; a kanban board with drag-and-drop; reports built from
            real issue history. Open source, self-hosted, and up in one command.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
            <Link to="/login" className="btn btn-primary h-10 px-5 text-sm">
              Sign in
            </Link>
            {openRegistration && (
              <Link to="/register" className="btn btn-secondary h-10 px-5 text-sm">
                Create an account
              </Link>
            )}
          </div>

          {demoCredentials && (
            <p className="mt-4 text-xs text-neutral-400">
              Demo login: {DEMO_EMAIL} / {DEMO_PASSWORD}
            </p>
          )}
        </section>

        <section aria-labelledby="features-heading" className="pb-16 sm:pb-24">
          <h2 id="features-heading" className="sr-only">
            What is in SoftTrack
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
            Run it yourself
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-500">
            Your issues stay in your database. Postgres, the API and the app come up together,
            seeded with a demo team so there is something to look at before you commit to it.
          </p>
          <pre className="well mt-5 overflow-x-auto rounded-control p-4 text-xs text-neutral-700">
            <code>
              git clone {REPOSITORY_URL}.git{'\n'}
              cd soft-track{'\n'}
              docker compose up
            </code>
          </pre>
        </section>
      </main>

      <footer className="border-t px-4 py-8 hairline">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 text-xs text-neutral-400">
          <span>SoftTrack — MIT licensed, and yours to run.</span>
          <a href={REPOSITORY_URL} className="link" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
      </footer>
    </div>
  )
}
