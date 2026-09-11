/**
 * The account `backend/seed.py` creates, and the only credentials this app is
 * ever allowed to print on screen.
 *
 * Whether it may be printed is not decided here: `/auth/config` reports
 * `demo_credentials`, which is true only where the seed actually ran with
 * this password. See `Settings.demo_credentials_are_public` in `web.py`.
 */
export const DEMO_EMAIL = 'demo@softtrack.dev'
export const DEMO_PASSWORD = 'password123'
