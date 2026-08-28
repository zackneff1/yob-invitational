/**
 * Tab-bar icons, inline so the app pulls in no icon library and they still
 * render with zero signal. All 24×24, drawn with `currentColor` so the tab's
 * text colour carries the icon, and slightly heavier when the tab is active.
 */
import { ReactNode } from 'react';

interface IconProps {
  active?: boolean;
}

function Svg({ active, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className="tab-icon"
      viewBox="0 0 24 24"
      width="23"
      height="23"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.4 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Trip overview — flagstick on a green, matching the app icon. */
export function FlagIcon({ active }: IconProps) {
  return (
    <Svg active={active}>
      <path d="M7 20.5V3.5" />
      <path d="M7 4.4 17.4 8 7 11.6z" fill="currentColor" stroke="none" />
      <path d="M3.5 20.5h14" />
    </Svg>
  );
}

/** Round leaderboards — a ranked list. */
export function BoardIcon({ active }: IconProps) {
  return (
    <Svg active={active}>
      <circle cx="4.5" cy="6.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="17.5" r="1.3" fill="currentColor" stroke="none" />
      <path d="M9 6.5h11M9 12h8M9 17.5h5" />
    </Svg>
  );
}

/** Score entry — a pencil. */
export function PencilIcon({ active }: IconProps) {
  return (
    <Svg active={active}>
      <path d="M16.4 3.6a2.2 2.2 0 0 1 3.1 3.1L7.3 18.9 3 20l1.1-4.3z" />
      <path d="M15 5.1 18 8.1" />
    </Svg>
  );
}

/** Ryder Cup standings — a trophy. */
export function TrophyIcon({ active }: IconProps) {
  return (
    <Svg active={active}>
      <path d="M8.5 20.5h7" />
      <path d="M12 16.5v4" />
      <path d="M7 3.5h10v5.5a5 5 0 0 1-10 0z" />
      <path d="M7 5.5H4.6a2.4 2.4 0 0 0 2.6 4" />
      <path d="M17 5.5h2.4a2.4 2.4 0 0 1-2.6 4" />
    </Svg>
  );
}

/** Admin — sliders. */
export function SlidersIcon({ active }: IconProps) {
  return (
    <Svg active={active}>
      <path d="M4 8h8M17 8h3M4 16h3M12 16h8" />
      <circle cx="14.5" cy="8" r="2.2" />
      <circle cx="9.5" cy="16" r="2.2" />
    </Svg>
  );
}
