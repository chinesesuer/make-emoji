const cloud = require('wx-server-sdk');
const { PNG } = require('pngjs');
const { GifWriter } = require('omggif');
const iq = require('image-q');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

async function audit(fileID, contentType) {
  const { fileContent } = await cloud.downloadFile({ fileID });
  try {
    const result = await cloud.openapi.security.imgSecCheck({ media: { contentType: contentType || 'image/jpeg', value: fileContent } });
    const suggest = result.result && result.result.suggest;
    if (result.errCode && result.errCode !== 0) throw Object.assign(new Error(result.errMsg || '内容安全接口异常'), { errCode: result.errCode });
    return { success: !suggest || suggest === 'pass', suggest: suggest || 'pass' };
  } catch (error) {
    // 87014 是旧版图片安全接口给出的明确违规结论，不属于网络或系统故障。
    if (Number(error.errCode || error.code) === 87014 || /87014/.test(String(error.message))) return { success: false, suggest: 'risky', errCode: 87014 };
    throw error;
  }
}

async function generate(event) {
  const width = Number(event.width); const height = Number(event.height);
  if (!Array.isArray(event.fileIDs) || event.fileIDs.length < 2) throw new Error('至少需要两帧图片');
  if (!width || !height || width > 480 || height > 480) throw new Error('输出尺寸无效');
  // 逐帧处理，避免一次性把全部图片展开成数百万个 Point 对象导致云函数内存溢出。
  const estimated = width * height * event.fileIDs.length * 3 + 64 * 1024;
  const output = Buffer.alloc(Math.max(estimated, 1024 * 1024));
  const writer = new GifWriter(output, width, height, { loop: Number(event.loop) || 0 });
  for (const fileID of event.fileIDs) {
    const download = await cloud.downloadFile({ fileID });
    const frame = PNG.sync.read(download.fileContent);
    if (frame.width !== width || frame.height !== height) throw new Error(`帧尺寸不一致：${frame.width}x${frame.height}`);
    const points = iq.utils.PointContainer.fromUint8Array(frame.data, width, height);
    const palette = iq.buildPaletteSync([points], { colors: 256, colorDistanceFormula: 'euclidean-bt709', paletteQuantization: 'wuquant' });
    const colors = palette.getPointContainer().getPointArray();
    const colorIndexes = new Map(colors.map((p, index) => [`${p.r},${p.g},${p.b},${p.a}`, index]));
    const quantized = iq.applyPaletteSync(points, palette, { colorDistanceFormula: 'euclidean-bt709', imageQuantization: 'nearest' });
    const pixels = quantized.getPointArray();
    const indexes = new Uint8Array(pixels.length);
    pixels.forEach((p, index) => { indexes[index] = colorIndexes.get(`${p.r},${p.g},${p.b},${p.a}`) || 0; });
    let gifPalette = colors.map(p => (p.r << 16) | (p.g << 8) | p.b);
    let paletteSize = 2; while (paletteSize < gifPalette.length) paletteSize *= 2;
    gifPalette = gifPalette.concat(new Array(paletteSize - gifPalette.length).fill(0));
    writer.addFrame(0, 0, width, height, indexes, { palette: gifPalette, delay: Math.max(2, Number(event.delay) || 20) });
  }
  const length = writer.end();
  const cloudPath = `generated-gifs/${Date.now()}-${Math.random().toString(36).slice(2)}.gif`;
  const uploaded = await cloud.uploadFile({ cloudPath, fileContent: output.slice(0, length) });
  return { success: true, fileID: uploaded.fileID };
}

exports.main = async event => {
  try {
    if (event.action === 'audit') return await audit(event.fileID, event.contentType);
    if (event.action === 'generate') return await generate(event);
    return { success: false, message: 'unknown action' };
  } catch (error) {
    console.error(error);
    return {
      success: false,
      type: event.action === 'audit' ? 'system_error' : 'generate_error',
      retryable: event.action === 'audit',
      message: error.message || '云函数内部错误',
      errCode: error.errCode || error.code || ''
    };
  }
};
