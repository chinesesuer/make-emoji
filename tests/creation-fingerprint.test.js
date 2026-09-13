const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCreationFingerprint } = require('../miniprogram/utils/creation-fingerprint.js');

function sample(overrides = {}) {
  return {
    bodyFileUrl: 'cloud://body.png',
    expressionFileUrl: 'cloud://face.png',
    accessoryFileUrl: '',
    text: '你好',
    bodyPosition: { x: 50, y: 50 },
    expressionPosition: { x: 42, y: 56 },
    accessoryPosition: { x: 62, y: 38 },
    textPositionData: { x: 50, y: 84 },
    bodyTransform: { scale: 1, rotate: 0, flip: false },
    expressionTransform: { scale: 3, rotate: 0, flip: false },
    accessoryTransform: { scale: 2.5, rotate: 0, flip: false },
    textTransform: { scale: 1, rotate: 0, flip: false },
    textColor: '#111111', strokeColor: '#ffffff', textBold: false, textStroke: true,
    transparentBackground: false, saveSize: 'large', qualityMode: 'compressed',
    generatedImage: '/tmp/a.png', generating: true, resultVisible: true,
    ...overrides
  };
}

test('临时状态和对象键顺序不影响作品指纹', () => {
  const first = sample();
  const second = { ...sample({ generatedImage: '/tmp/b.png', generating: false, resultVisible: false }) };
  second.bodyPosition = { y: 50, x: 50 };

  assert.equal(buildCreationFingerprint(first), buildCreationFingerprint(second));
  assert.match(buildCreationFingerprint(first), /^[0-9a-f]{16}$/);
});

test('任一视觉内容变化都会改变作品指纹', () => {
  const original = buildCreationFingerprint(sample());
  const variants = [
    sample({ bodyFileUrl: 'cloud://other.png' }),
    sample({ text: '再见' }),
    sample({ bodyPosition: { x: 51, y: 50 } }),
    sample({ expressionTransform: { scale: 4, rotate: 0, flip: false } }),
    sample({ textColor: '#ff0000' }),
    sample({ transparentBackground: true }),
    sample({ saveSize: 'medium' }),
    sample({ qualityMode: 'lossless' })
  ];

  variants.forEach(value => assert.notEqual(buildCreationFingerprint(value), original));
});
