import type { CollectibleProject } from './collectible-project.js';

export const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
export function photoProject(name = '월계 도장'): CollectibleProject {
  return {
    schemaVersion: 2, name, campaignId: 'campaign-a', theme: { name: '우리 가게' },
    photo: { originalDataUrl: tinyPng, width: 1, height: 1 }, shape: 'circle', crop: { x: 0, y: 0, zoom: 1 },
    photoEdits: { brightness: 0, contrast: 0, merge: 0, simplify: 0, cartoon: 0, strokes: [] },
    style: 'original', baseColor: '#bf8149', photoColor: 100, relief: 45, stickers: [],
    back: { mode: 'default', color: '#bf8149', stickers: [] },
    grades: [{ id: 'bronze', name: '브론즈', kind: 'basic', enabled: true }, { id: 'custom', name: '가게 특별판', kind: 'special', enabled: true }],
    effects: [{ id: 'effect-1', type: 'glow', target: 'surface', gradeIds: ['custom'], strength: 50, color: '#ffaa00', roughness: 20 }],
    motion: [{ id: 'motion-1', type: 'float', gradeIds: ['custom'], playback: 'loop' }], thickness: 8, angle: 0,
    greeting: '다시 찾아주셔서 고마워요.', greetingOverrides: [], audio: null,
    story: { type: 'zoom', frames: [], cartoon: 0, strength: 50 },
    parallax: { strength: 0, strokes: [] }, living: { periodMs: 2400, items: [] },
    derived: {
      bronze: { imageDataUrl: tinyPng, thumbnailDataUrl: tinyPng, backImageDataUrl: tinyPng },
      custom: { imageDataUrl: tinyPng, thumbnailDataUrl: tinyPng, backImageDataUrl: tinyPng },
    },
    rewardGrades: { '1': 'bronze', '3': 'custom' },
  };
}
