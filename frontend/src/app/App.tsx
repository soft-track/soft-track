import { Navigate, Route, Routes } from 'react-router-dom'

import TeamRoute from '@/app/TeamRoute'
import { RequireAuth } from '@/auth/RequireAuth'
import HomeRoute from '@/landing/HomeRoute'
import ForgotPasswordPage from '@/auth/ForgotPasswordPage'
import InvitePage from '@/auth/InvitePage'
import LoginPage from '@/auth/LoginPage'
import OAuthCallbackPage from '@/auth/OAuthCallbackPage'
import NewTeamPage from '@/team/NewTeamPage'
import RegisterPage from '@/auth/RegisterPage'
import ResetPasswordPage from '@/auth/ResetPasswordPage'
import AdminUsersPage from '@/settings/AdminUsersPage'
import NotificationSettings from '@/settings/NotificationSettings'
import ProfileSettings from '@/settings/ProfileSettings'
import SecuritySettings from '@/settings/SecuritySettings'
import SettingsLayout from '@/settings/SettingsLayout'
import TeamAutomationSettings from '@/settings/TeamAutomationSettings'
import TeamGeneralSettings from '@/settings/TeamGeneralSettings'
import TeamIntegrationSettings from '@/settings/TeamIntegrationSettings'
import TeamMembersSettings from '@/settings/TeamMembersSettings'
import TeamStatusSettings from '@/settings/TeamStatusSettings'
import TeamTemplateSettings from '@/settings/TeamTemplateSettings'
import TeamWebhookSettings from '@/settings/TeamWebhookSettings'
import { RequireSiteAdmin } from '@/settings/RequireSiteAdmin'

export default function App() {
  return (
    <>
      {/* The aurora sits behind every route; the glass surfaces above it are
          what give the interface its depth. */}
      <div className="aurora" aria-hidden="true" />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        {/* Signed-out pages: a forgotten password is the one thing that
            cannot wait for a session (#83). */}
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        {/* Where a sign-in with Google or GitHub comes back to. Outside
            RequireAuth by necessity: the ticket it is carrying is what the
            person is about to become authenticated with, and it has not been
            redeemed yet when this route matches.

            Not /auth/callback, though the API's identity router is the only
            thing that answers /auth: a single-domain deployment proxies /auth
            to FastAPI, and this page would 404 on every sign-in. The SPA's
            first path segments have to stay disjoint from the API's. */}
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        {/* Outside RequireAuth: most people opening an invitation link do not
            have an account yet, and the page has to say what they were
            invited to before asking them to sign in. */}
        <Route path="/invite/:token" element={<InvitePage />} />
        {/* The one route that answers differently depending on who is
            asking: signed out it is the landing page, signed in it is
            TeamsHome exactly as when this lived inside RequireAuth below.
            HomeRoute makes that call. */}
        <Route path="/" element={<HomeRoute />} />

        <Route element={<RequireAuth />}>
          <Route path="/new-team" element={<NewTeamPage />} />

          {/* Above /:teamKey in the ranking React Router gives static
              segments, and team keys are at most six characters, so no team
              can shadow these. */}
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="/settings/profile" replace />} />
            <Route path="profile" element={<ProfileSettings />} />
            <Route path="security" element={<SecuritySettings />} />
            <Route path="notifications" element={<NotificationSettings />} />
            <Route
              path="teams/:teamKey"
              element={<Navigate to="members" replace />}
            />
            <Route path="teams/:teamKey/members" element={<TeamMembersSettings />} />
            <Route path="teams/:teamKey/general" element={<TeamGeneralSettings />} />
            <Route path="teams/:teamKey/statuses" element={<TeamStatusSettings />} />
            <Route path="teams/:teamKey/templates" element={<TeamTemplateSettings />} />
            <Route
              path="teams/:teamKey/automation"
              element={<TeamAutomationSettings />}
            />
            <Route
              path="teams/:teamKey/repositories"
              element={<TeamIntegrationSettings />}
            />
            <Route path="teams/:teamKey/webhooks" element={<TeamWebhookSettings />} />
            <Route element={<RequireSiteAdmin />}>
              <Route path="admin/users" element={<AdminUsersPage />} />
            </Route>
          </Route>

          {/* The same element for all three, so the board survives an issue
              panel opening over it; see TeamRoute. */}
          <Route path="/:teamKey" element={<TeamRoute />} />
          <Route path="/:teamKey/issue/:issueNumber" element={<TeamRoute />} />
          <Route path="/:teamKey/projects/:projectId" element={<TeamRoute />} />
        </Route>

        {/* Still "/", which no longer means "go to login" for a signed-out
            visitor. That is the right destination all the same: this route
            catches stale and truncated links, and a page saying what SoftTrack
            is with a way in recovers better than a dead end. Signed in it is
            unchanged -- their board, as always. Note that a deep link to a
            real issue never reaches here; it matches /:teamKey/issue/... and
            is handled by RequireAuth. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
