import { Navigate, Route, Routes } from 'react-router-dom'

import { RequireAuth } from '@/auth/RequireAuth'
import BoardPage from '@/board/BoardPage'
import HomeRoute from '@/landing/HomeRoute'
import InvitePage from '@/auth/InvitePage'
import LoginPage from '@/auth/LoginPage'
import NewTeamPage from '@/team/NewTeamPage'
import RegisterPage from '@/auth/RegisterPage'
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
            <Route
              path="teams/:teamKey/automation"
              element={<TeamAutomationSettings />}
            />
            <Route
              path="teams/:teamKey/repositories"
              element={<TeamIntegrationSettings />}
            />
            <Route element={<RequireSiteAdmin />}>
              <Route path="admin/users" element={<AdminUsersPage />} />
            </Route>
          </Route>

          <Route path="/:teamKey" element={<BoardPage />} />
          <Route path="/:teamKey/issue/:issueNumber" element={<BoardPage />} />
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
