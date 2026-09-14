/**
 * Элементы управления картой в стеклянной панели: зум и возврат к обзору карьера.
 * Штатные контролы MapLibre скрыты, эти - из дизайн-системы (раздел 1 этапа).
 *
 * Панель прижата к правому верхнему углу: чаша карьера на стартовом виде занимает центр
 * и левую часть области, поэтому справа она ничего не перекрывает (раздел 8 этапа).
 */

import { IconButton, Panel, Tooltip } from '@/shared/ui';
import { MinusIcon, OverviewIcon, PlusIcon } from '../icons.js';

export interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

export function MapControls({ onZoomIn, onZoomOut, onReset }: MapControlsProps) {
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
    </Panel>
  );
}
