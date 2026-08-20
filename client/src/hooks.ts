import { useQuery } from '@tanstack/react-query';
import { api } from './api/client';
import { RoundLeaderboard, RyderBoard, Score, Trip } from './api/types';

export function useTrip() {
  return useQuery({
    queryKey: ['trip'],
    queryFn: () => api<Trip>('/api/trip'),
    refetchInterval: 60_000,
  });
}

export function useRoundLeaderboard(roundId: string | undefined) {
  return useQuery({
    queryKey: ['leaderboard', roundId],
    queryFn: () => api<RoundLeaderboard>(`/api/leaderboard/round/${roundId}`),
    enabled: Boolean(roundId),
    refetchInterval: 15_000,
  });
}

export function useRyderBoard() {
  return useQuery({
    queryKey: ['ryder'],
    queryFn: () => api<RyderBoard>('/api/leaderboard/ryder'),
    refetchInterval: 15_000,
  });
}

export function useScores(roundId: string | undefined) {
  return useQuery({
    queryKey: ['scores', roundId],
    queryFn: () => api<Score[]>(`/api/scores?roundId=${roundId}`),
    enabled: Boolean(roundId),
    refetchInterval: 15_000,
  });
}
