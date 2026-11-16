import type { StyleOptions } from './render/style'

/** Ready-made styles. Spread one into the options and override what you like. */
export const presets = {
  classic: {},
  soft: { dots: 'rounded', finder: 'rounded', color: '#0f172a' },
  bubbles: { dots: 'dots', dotScale: 0.9, finder: 'circle', color: '#4c1d95', finderColor: '#7c3aed' },
  liquid: { dots: 'fluid', finder: 'extra-rounded', color: { type: 'linear', angle: 45, stops: [{ offset: 0, color: '#1d4ed8' }, { offset: 1, color: '#0f766e' }] } },
  classy: { dots: 'classy-rounded', finder: 'leaf', color: '#7f1d1d', finderColor: '#111827' },
  blueprint: { dots: 'square', dotScale: 0.85, finder: 'square', alignment: 'square', color: '#0c4a6e', background: '#e0f2fe' },
  confetti: { dots: 'dots', finder: 'rounded', color: { type: 'palette', colors: ['#be123c', '#1d4ed8', '#047857', '#6d28d9'] }, finderColor: '#111827' },
  barcode: { dots: 'bars-vertical', finder: 'rounded', color: '#111827' },
  gem: { dots: 'diamond', finder: 'rounded', finderInner: 'diamond', alignment: 'rounded', color: '#155e75', finderColor: '#164e63' },
  badge: { shape: 'circle', dots: 'dots', finder: 'circle', color: '#1e3a8a', background: '#eff6ff' },
  sunset: { dots: 'extra-rounded', finder: 'extra-rounded', finderInner: 'circle', color: { type: 'radial', stops: [{ offset: 0, color: '#9d174d' }, { offset: 1, color: '#7c2d12' }] }, background: '#fff7ed', backgroundRadius: 0.08 },
  love: { dots: 'heart', finder: 'rounded', finderInner: 'heart', color: '#be123c' },
} satisfies Record<string, StyleOptions>

export type PresetName = keyof typeof presets
