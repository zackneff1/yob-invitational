import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useMatchAlerts } from '../alerts';
import { api } from '../api/client';
import { flushQueue, onQueueChanged, onScoresSynced, pendingCount } from '../api/queue';
import { useAuth } from '../auth';
import { useRyderBoard, useTrip } from '../hooks';
import { BoardIcon, FlagIcon, PencilIcon, SlidersIcon, TrophyIcon } from './Icons';

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

type IconFn = (props: { active?: boolean }) => JSX.Element;

const TABS: { to: string; label: string; Icon: IconFn; end?: boolean; adminOnly?: boolean }[] = [
  { to: '/', label: 'Trip', Icon: FlagIcon, end: true },
  { to: '/leaderboard', label: 'Leaderboard', Icon: BoardIcon },
  { to: '/score', label: 'Score', Icon: PencilIcon },
  { to: '/cup', label: 'Cup', Icon: TrophyIcon },
  { to: '/admin', label: 'Admin', Icon: SlidersIcon, adminOnly: true },
];

export function Layout() {
  const { auth, logout } = useAuth();
  const online = useOnline();
  const pending = usePending();
  const queryClient = useQueryClient();

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<{ status: string }>('/api/health'),
    refetchInterval: 60_000,
    retry: false,
  });

  // Whenever queued scores reach the server — from the score page's own flush
  // or the background one — pull fresh leaderboards straight away rather than
  // waiting out the next poll.
  useEffect(
    () =>
      onScoresSynced(() => {
        void queryClient.invalidateQueries({ queryKey: ['scores'] });
        void queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
        void queryClient.invalidateQueries({ queryKey: ['ryder'] });
      }),
    [queryClient],
  );

  // Match-closed banners for everyone, driven by the Cup board poll.
  const trip = useTrip();
  const ryder = useRyderBoard();
  const { alerts, dismiss } = useMatchAlerts(ryder.data, trip.data?.rounds);

  // The phone thinks it has signal but the server isn't answering — worth
  // flagging separately from being plainly offline.
  const serverDown = online && health.isError;
  const tabs = TABS.filter((t) => !t.adminOnly || auth?.player.isAdmin);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-title">
          <span className="logo">⛳ YOB 2026</span>
          <span className="subtitle">St. George, UT · Oct 10–12</span>
        </div>
        <div className="topbar-status">
          {!online && <span className="badge badge-offline">offline</span>}
          {serverDown && <span className="badge badge-offline">no server</span>}
          {pending > 0 && (
            <button className="badge badge-pending" onClick={() => void flushQueue()}>
              {pending} unsynced
            </button>
          )}
          {auth && (
            <button className="badge badge-user" onClick={logout} title="Sign out">
              {auth.player.name.split(' ')[0]} ✕
            </button>
          )}
        </div>
      </header>
      {alerts.length > 0 && (
        <div className="toast-stack" role="status" aria-live="polite">
          {alerts.map((a) => (
            <div
              key={a.id}
              className="toast"
              style={a.color ? { borderLeftColor: a.color } : undefined}
            >
              <Link to="/cup" className="toast-body" onClick={() => dismiss(a.id)}>
                <strong>{a.title}</strong>
                <span>{a.body}</span>
              </Link>
              <button className="toast-close" aria-label="Dismiss" onClick={() => dismiss(a.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <main className="content">
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="Main navigation">
        {tabs.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end}>
            {({ isActive }) => (
              <>
                <Icon active={isActive} />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
