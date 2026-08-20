import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../api/client';
import { flushQueue, onQueueChanged, pendingCount } from '../api/queue';
import { useAuth } from '../auth';

function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
  );
}

function usePending(): number {
  return useSyncExternalStore(onQueueChanged, pendingCount);
}

export function Layout() {
  const { auth, logout } = useAuth();
  const online = useOnline();
  const pending = usePending();

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<{ status: string }>('/api/health'),
    refetchInterval: 60_000,
    retry: false,
  });

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-title">
          <span className="logo">⛳ YOB 2026</span>
          <span className="subtitle">St. George, UT</span>
        </div>
        <div className="topbar-status">
          {!online && <span className="badge badge-offline">offline</span>}
          {pending > 0 && (
            <button className="badge badge-pending" onClick={() => void flushQueue()}>
              {pending} unsynced
            </button>
          )}
          {auth && (
            <button className="badge badge-user" onClick={logout} title="Sign out">
              {auth.player.name} ✕
            </button>
          )}
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <nav className="tabbar">
        <NavLink to="/">Trip</NavLink>
        <NavLink to="/leaderboard">Rounds</NavLink>
        <NavLink to="/score">Score</NavLink>
        <NavLink to="/cup">Cup</NavLink>
        {auth?.player.isAdmin && <NavLink to="/admin">Admin</NavLink>}
      </nav>
      <footer className="statusline">
        API: {health.isError ? 'unreachable' : (health.data?.status ?? '…')}
        {' · '}
        {online ? 'online' : 'offline — scores saved locally'}
      </footer>
    </div>
  );
}
