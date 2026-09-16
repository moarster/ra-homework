/** Префикс публикации стенда за обратным прокси. */

import { describe, expect, it } from 'vitest';
import { normalizeBasePath, stripBasePath } from '../base-path.js';

describe('префикс адреса', () => {
  it('нормализуется к виду /name или пустой строке', () => {
    expect(normalizeBasePath('')).toBe('');
    expect(normalizeBasePath('/')).toBe('');
    expect(normalizeBasePath('ra')).toBe('/ra');
    expect(normalizeBasePath('/ra/')).toBe('/ra');
  });

  it('снимается только со своих адресов', () => {
    expect(stripBasePath('/ra/api/sim?x=1', '/ra')).toBe('/api/sim?x=1');
    expect(stripBasePath('/ra', '/ra')).toBe('/');
    expect(stripBasePath('/ra/', '/ra')).toBe('/');
    expect(stripBasePath('/ra?theme=dark', '/ra')).toBe('/?theme=dark');
    expect(stripBasePath('/rafoo', '/ra')).toBe('/rafoo');
    expect(stripBasePath('/api/health', '/ra')).toBe('/api/health');
    expect(stripBasePath('/api/health', '')).toBe('/api/health');
  });
});
