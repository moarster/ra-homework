/**
 * Элементы управления картой в стеклянной панели: зум, возврат к обзору карьера и ручной
 * переключатель автономного режима (чтобы на защите показать оба варианта подложки).
 * Штатные контролы MapLibre скрыты, эти - из дизайн-системы (раздел 1 этапа 3).
 *
 * Панель прижата к правому верхнему углу: чаша карьера на стартовом виде занимает центр
 * и левую часть области, поэтому справа она ничего не перекрывает (раздел 8 этапа 3).
 */

import { IconButton, Panel, Tooltip } from '@/shared/ui';
import { MinusIcon, OfflineMapIcon, OverviewIcon, PlusIcon } from '../icons.js';

export interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  /** Включен ли сейчас автономный режим (вручную или автоматически). */
  offline: boolean;
  onToggleOffline: () => void;
}

export function MapControls({
  onZoomIn,
  onZoomOut,
  onReset,
  offline,
  onToggleOffline,
}: MapControlsProps) {
  const offlineLabel = offline
    ? 'Автономный режим включен: вернуть живые тайлы'
    : 'Автономный режим: сохраненный снимок без интернета';
  return (
    <Panel
      tone="float"
      overImagery
      className="pointer-events-auto absolute top-3 right-3 flex flex-col gap-1 p-1"
    >
      <Tooltip content="Приблизить" placement="bottom">
        <IconButton label="Приблизить" icon={<PlusIcon />} onClick={onZoomIn} />
      </Tooltip>
      <Tooltip content="Отдалить" placement="bottom">
        <IconButton label="Отдалить" icon={<MinusIcon />} onClick={onZoomOut} />
      </Tooltip>
      <Tooltip content="Вернуться к обзору карьера" placement="bottom">
        <IconButton label="Вернуться к обзору карьера" icon={<OverviewIcon />} onClick={onReset} />
      </Tooltip>
      <Tooltip content={offlineLabel} placement="bottom">
        <IconButton
          label={offlineLabel}
          icon={<OfflineMapIcon />}
          active={offline}
          onClick={onToggleOffline}
        />
      </Tooltip>
    </Panel>
  );
}
