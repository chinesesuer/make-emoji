const VISUAL_FIELDS = [
  'bodyFileUrl', 'expressionFileUrl', 'accessoryFileUrl', 'text',
  'bodyPosition', 'expressionPosition', 'accessoryPosition', 'textPositionData',
  'bodyTransform', 'expressionTransform', 'accessoryTransform', 'textTransform',
  'textColor', 'strokeColor', 'textBold', 'textStroke',
  'transparentBackground', 'saveSize', 'qualityMode'
];

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value === undefined ? null : value;
}

function buildComposition(data = {}) {
  return VISUAL_FIELDS.reduce((result, field) => {
    result[field] = stableValue(data[field]);
    return result;
  }, {});
}

function fnv1a(text, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function fingerprintComposition(composition) {
  const serialized = JSON.stringify(stableValue(composition));
  return fnv1a(serialized, 0x811c9dc5) + fnv1a(serialized, 0x9e3779b9);
}

function buildCreationFingerprint(data) {
  return fingerprintComposition(buildComposition(data));
}

module.exports = { buildComposition, fingerprintComposition, buildCreationFingerprint };
