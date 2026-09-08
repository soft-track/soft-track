import { Navigate, Route, Routes } from 'react-router-dom'

import { RequireAuth } from '@/auth/RequireAuth'
import BoardPage from '@/board/BoardPage'
import InvitePage from '@/auth/InvitePage'
import LoginPage from '@/auth/LoginPage'
import NewTeamPage from '@/team/NewTeamPage'
import RegisterPage from '@/auth/RegisterPage'
import TeamsHome from '@/team/TeamsHome'
import AdminUsersPage from '@/settings/AdminUsersPage'
import NotificationSettings from '@/settings/NotificationSettings'
import ProfileSettings from '@/settings/ProfileSettings'
import SecuritySettings from '@/settings/SecuritySettings'
import SettingsLayout from '@/settings/SettingsLayout'
import TeamGeneralSettings from '@/settings/TeamGeneralSettings'
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

        <Route element={<RequireAuth />}>
          <Route path="/" element={<TeamsHome />} />
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
            <Route element={<RequireSiteAdmin />}>
              <Route path="admin/users" element={<AdminUsersPage />} />
            </Route>
          </Route>

          <Route path="/:teamKey" element={<BoardPage />} />
          <Route path="/:teamKey/issue/:issueNumber" element={<BoardPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
