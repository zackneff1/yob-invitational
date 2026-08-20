import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { AdminPage } from './pages/Admin';
import { LoginPage } from './pages/Login';
import { MatchesPage } from './pages/Matches';
import { OverviewPage } from './pages/Overview';
import { RyderPage } from './pages/Ryder';
import { ScoreEntryPage } from './pages/ScoreEntry';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { auth } = useAuth();
  const location = useLocation();
  if (!auth) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

export default function App() {
  const { auth } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={auth ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<OverviewPage />} />
        <Route path="/leaderboard" element={<MatchesPage />} />
        <Route path="/leaderboard/:roundId" element={<MatchesPage />} />
        <Route path="/score" element={<ScoreEntryPage />} />
        <Route path="/cup" element={<RyderPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
