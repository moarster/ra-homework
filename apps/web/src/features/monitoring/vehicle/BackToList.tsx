/** Возврат к списку машин. Карта при этом остается там, куда ее отвели. */

import { useAppStore } from '@/shared/store';
import { Button } from '@/shared/ui';
import { BackIcon } from '../icons.js';

export function BackToList() {
  return (
    <Button
      variant="ghost"
      onClick={() => useAppStore.getState().selectVehicle(null)}
      className="-ml-1 w-fit text-fg-muted"
    >
      <BackIcon />
      <span>К списку машин</span>
    </Button>
  );
}
