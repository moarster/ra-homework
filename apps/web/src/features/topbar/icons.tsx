/**
 * Иконки самой полоски (не показателей - те приходят из справочника контрактов).
 * Один стиль: обводка 1.8, viewBox 24, цвет через currentColor.
 */

import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const ClockIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

export const SunIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
  </Svg>
);

export const MoonIcon = () => (
  <Svg>
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
  </Svg>
);

export const TargetIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const LatestIcon = () => (
  <Svg>
    <path d="M5 12h11M12 7l5 5-5 5M20 5v14" />
  </Svg>
);

export const TrackedIcon = () => (
  <Svg>
    <path d="M4 18l4-7 4 3 4-8 4 5" />
  </Svg>
);

export const SimIcon = () => (
  <Svg>
    <path d="M4 7h10M4 12h16M4 17h7" />
    <circle cx="17" cy="7" r="2" />
    <circle cx="14" cy="17" r="2" />
  </Svg>
);

export const SearchIcon = () => (
  <Svg>
    <circle cx="11" cy="11" r="6" />
    <path d="M16 16l4 4" />
  </Svg>
);

export const UserIcon = () => (
  <Svg>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </Svg>
);

export const TruckIcon = () => (
  <Svg>
    <path d="M3 16V8h9l3 4h6v4" />
    <circle cx="7" cy="18" r="2" />
    <circle cx="17" cy="18" r="2" />
  </Svg>
);

export const SpeedIcon = () => (
  <Svg>
    <path d="M12 13l4-4" />
    <path d="M4 17a9 9 0 1 1 16 0" />
  </Svg>
);

export const ChaosIcon = () => (
  <Svg>
    <path d="M3 17c2-6 4 4 6-4s3 7 5 1 3 3 4 1" />
  </Svg>
);

export const InfoIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);

export const ViewersIcon = () => (
  <Svg>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <path d="M16 5.2a3 3 0 0 1 0 5.6M17.5 14a5 5 0 0 1 3 5" />
  </Svg>
);
