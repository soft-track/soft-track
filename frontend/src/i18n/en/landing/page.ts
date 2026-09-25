/** The landing page, around the feature list: nav, hero, self-hosting, footer. */
export const page = {
  nav: {
    toLight: 'Switch to light theme',
    toDark: 'Switch to dark theme',
    lightTheme: 'Light theme',
    darkTheme: 'Dark theme',
    source: 'Source',
    signIn: 'Sign in',
  },
  hero: {
    title: 'An issue tracker your team can <highlight>actually host</highlight>',
    lede: 'Teams, projects and cycles; a kanban board with drag-and-drop; reports built from real issue history. Open source, self-hosted, and up in one command.',
    signIn: 'Sign in',
    register: 'Create an account',
    demo: 'Demo login: {{email}} / {{password}}',
  },
  featuresHeading: 'What is in SoftTrack',
  selfHost: {
    title: 'Run it yourself',
    body: 'Your issues stay in your database. Postgres, the API and the app come up together, seeded with a demo team so there is something to look at before you commit to it.',
  },
  footer: {
    licence: 'SoftTrack — MIT licensed, and yours to run.',
    github: 'GitHub',
  },
} as const
