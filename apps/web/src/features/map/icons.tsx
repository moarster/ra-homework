/** Иконки области карты. Уникальные рисунки - этап 6, здесь простые контурные. */

const COMMON = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '1.8',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function PitIcon() {
  return (
    <svg {...COMMON} aria-hidden="true" strokeWidth="1.5">
      <path d="M3 7h18l-3 5h-12Z" />
      <path d="M6 12h12l-3 5H9Z" />
      <path d="M9 17h6l-1.5 4h-3Z" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg {...COMMON} aria-hidden="true" className="size-4">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function MinusIcon() {
  return (
    <svg {...COMMON} aria-hidden="true" className="size-4">
      <path d="M5 12h14" />
    </svg>
  );
}

/** Возврат к обзору: рамка с уголками, как «показать все». */
export function OverviewIcon() {
  return (
    <svg {...COMMON} aria-hidden="true" className="size-4">
      <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />
      <circle cx="12" cy="12" r="2.2" />
    </svg>
  );
}

/** Автономный режим карты: облако перечеркнуто, подложка локальная. */
export function OfflineMapIcon() {
  return (
    <svg {...COMMON} aria-hidden="true" className="size-4">
      <path d="M7 18h10.5a3.5 3.5 0 0 0 .6-6.95A6 6 0 0 0 6.6 9.1 4.5 4.5 0 0 0 7 18Z" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

/** Нет связи с подложкой. */
export function NoImageryIcon() {
  return (
    <svg {...COMMON} aria-hidden="true" strokeWidth="1.5">
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M3 14l4-3.5 3 2.5 3.5-4L21 14" />
      <path d="M4 4l16 14" />
    </svg>
  );
}
