/** Переключатель темы. Переключение мгновенное: меняется только атрибут на `html`. */

import { useAppStore, useTheme } from '@/shared/store';
import { IconButton, Tooltip } from '@/shared/ui';
import { MoonIcon, SunIcon } from './icons.js';

export function ThemeSwitch() {
  const theme = useTheme();
  const next = theme === 'dark' ? 'светлую' : 'темную';
  return (
    <Tooltip content={`Переключить на ${next} тему`} placement="bottom-end">
      <IconButton
        label={`Переключить на ${next} тему`}
        icon={theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        onClick={() => useAppStore.getState().toggleTheme()}
      />
    </Tooltip>
  );
}
