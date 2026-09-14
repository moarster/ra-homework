/** Затухание кометного хвоста: правила раздела 4 этапа, выраженные числами. */

import { describe, expect, it } from 'vitest';
import { alphaFactor, bandCount, widthFactor } from './draw-tail.js';

describe('затухание кометного хвоста', () => {
  it('ширина падает только в последней трети', () => {
    // У головы и до двух третей длины хвост одинаково широкий.
    expect(widthFactor(0)).toBe(1);
    expect(widthFactor(0.5)).toBe(1);
    expect(widthFactor(2 / 3)).toBe(1);
    // Дальше начинается сужение, к самому краю - заметное.
    expect(widthFactor(0.8)).toBeLessThan(1);
    expect(widthFactor(1)).toBeLessThan(0.3);
    // Сужение монотонное: на хвосте не должно быть утолщений.
    let previous = 1;
    for (let age = 2 / 3; age <= 1; age += 0.02) {
      const current = widthFactor(age);
      expect(current).toBeLessThanOrEqual(previous + 1e-9);
      previous = current;
    }
  });

  it('прозрачность падает начиная с середины', () => {
    expect(alphaFactor(0)).toBe(1);
    expect(alphaFactor(0.5)).toBe(1);
    expect(alphaFactor(0.75)).toBeLessThan(1);
    expect(alphaFactor(1)).toBeLessThan(0.2);
    // Хвост не должен становиться полностью невидимым: иначе его край просто исчезает.
    expect(alphaFactor(1)).toBeGreaterThan(0);
    let previous = 1;
    for (let age = 0.5; age <= 1; age += 0.02) {
      const current = alphaFactor(age);
      expect(current).toBeLessThanOrEqual(previous + 1e-9);
      previous = current;
    }
  });

  it('у головы хвост самый яркий и широкий', () => {
    expect(widthFactor(0)).toBeGreaterThan(widthFactor(1));
    expect(alphaFactor(0)).toBeGreaterThan(alphaFactor(1));
  });

  it('на большом парке полос меньше: число вызовов отрисовки важнее плавности', () => {
    expect(bandCount(3)).toBeGreaterThan(bandCount(60));
    expect(bandCount(60)).toBeGreaterThan(1);
  });
});
