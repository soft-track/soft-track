import { Navigate, Route, Routes } from 'react-router-dom'

import { RequireAuth } from '@/auth/RequireAuth'
import BoardPage from '@/board/BoardPage'
import LoginPage from '@/auth/LoginPage'
import NewTeamPage from '@/team/NewTeamPage'
import RegisterPage from '@/auth/RegisterPage'
import TeamsHome from '@/team/TeamsHome'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/" element={<TeamsHome />} />
        <Route path="/new-team" element={<NewTeamPage />} />
        <Route path="/:teamKey" element={<BoardPage />} />
        <Route path="/:teamKey/issue/:issueNumber" element={<BoardPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
