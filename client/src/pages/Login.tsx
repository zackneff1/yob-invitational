import { useQuery } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { AuthResponse } from '../api/types';
import { useAuth } from '../auth';

interface ClaimablePlayer {
  id: string;
  name: string;
  claimed: boolean;
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'claim'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const players = useQuery({
    queryKey: ['claimable-players'],
    queryFn: () => api<ClaimablePlayer[]>('/api/auth/players'),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res =
        mode === 'login'
          ? await api<AuthResponse>('/api/auth/login', {
              method: 'POST',
              body: JSON.stringify({ email, password }),
            })
          : await api<AuthResponse>('/api/auth/claim', {
              method: 'POST',
              body: JSON.stringify({ playerId, email, password, inviteCode }),
            });
      login({
        token: res.token,
        player: { id: res.player.id, name: res.player.name, isAdmin: res.player.isAdmin },
      });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const unclaimed = players.data?.filter((p) => !p.claimed) ?? [];

  return (
    <div className="login-page">
      <h1>⛳ Yob Invitational 2026</h1>
      <p className="subtitle">St. George, Utah · Oct 10–12</p>
      <div className="login-tabs">
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
          Sign in
        </button>
        <button className={mode === 'claim' ? 'active' : ''} onClick={() => setMode('claim')}>
          First time here
        </button>
      </div>
      <form onSubmit={submit} className="card">
        {mode === 'claim' && (
          <>
            <label>
              Who are you?
              <select value={playerId} onChange={(e) => setPlayerId(e.target.value)} required>
                <option value="">Pick your name…</option>
                {unclaimed.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Invite code
              <input
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Ask Neffy or Aaron"
                required
              />
            </label>
          </>
        )}
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={6}
            required
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? '…' : mode === 'login' ? 'Sign in' : 'Claim profile & sign in'}
        </button>
      </form>
    </div>
  );
}
