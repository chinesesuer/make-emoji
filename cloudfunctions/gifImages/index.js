const cloud = require('wx-server-sdk');
const { PNG } = require('pngjs');
const { GifWriter } = require('omggif');
const iq = require('image-q');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const runFile = promisify(execFile);

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

async function auditVideo(fileID) {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) throw Object.assign(new Error('无法识别当前微信用户，请退出小程序后重新进入'), { code: 'MISSING_OPENID' });
  const temp = await cloud.getTempFileURL({ fileList: [fileID] });
  const item = temp.fileList && temp.fileList[0];
  if (!item || !item.tempFileURL) throw new Error('无法获取待审核视频');
  const result = await cloud.openapi.security.mediaCheckAsync({
    media_url: item.tempFileURL,
    media_type: 2,
    version: 2,
    scene: 1,
    openid: OPENID
  });
  if (result.errCode && result.errCode !== 0) {
    throw Object.assign(new Error(result.errMsg || '视频内容安全接口异常'), { errCode: result.errCode });
  }
  // 异步接口成功受理即允许进入编辑页；最终结论由微信内容安全回调继续处置。
  return { success: true, traceId: result.trace_id || result.traceId || '', suggest: 'submitted' };
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

async function generateVideo(event) {
  if (!event.fileID) throw new Error('缺少视频文件');
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    throw Object.assign(new Error('云函数缺少 FFmpeg，请重新上传并选择“云端安装依赖”'), { code: 'FFMPEG_MISSING' });
  }
  const fps = Math.max(1, Math.min(30, Number(event.fps) || 10));
  const resolution = Math.max(0, Math.min(480, Number(event.resolution) || 0));
  const loop = Math.max(0, Math.min(99, Number(event.loop) || 0));
  const sourceWidth = Math.max(1, Number(event.sourceWidth) || 1);
  const sourceHeight = Math.max(1, Number(event.sourceHeight) || 1);
  const crop = event.crop;
  const filters = [`fps=${fps}`];
  let workingWidth = sourceWidth; let workingHeight = sourceHeight;
  if (crop) {
    const w = Math.max(1, Math.min(sourceWidth, Math.round(Number(crop.width) || sourceWidth)));
    const h = Math.max(1, Math.min(sourceHeight, Math.round(Number(crop.height) || sourceHeight)));
    const x = Math.max(0, Math.min(sourceWidth - w, Math.round(Number(crop.x) || 0)));
    const y = Math.max(0, Math.min(sourceHeight - h, Math.round(Number(crop.y) || 0)));
    filters.push(`crop=${w}:${h}:${x}:${y}`); workingWidth = w; workingHeight = h;
  }
  if (resolution) {
    filters.push(workingWidth >= workingHeight ? `scale=${resolution}:-2:flags=lanczos` : `scale=-2:${resolution}:flags=lanczos`);
  } else if (Math.max(workingWidth, workingHeight) > 480) {
    filters.push(workingWidth >= workingHeight ? 'scale=480:-2:flags=lanczos' : 'scale=-2:480:flags=lanczos');
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inputPath = path.join(os.tmpdir(), `${id}.mp4`);
  const outputPath = path.join(os.tmpdir(), `${id}.gif`);
  try {
    const download = await cloud.downloadFile({ fileID: event.fileID });
    fs.writeFileSync(inputPath, download.fileContent);
    const chain = `${filters.join(',')},split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=sierra2_4a`;
    await runFile(ffmpegPath, ['-y', '-i', inputPath, '-t', '10', '-filter_complex', chain, '-loop', String(loop), outputPath], { timeout: 55000, maxBuffer: 2 * 1024 * 1024 });
    const uploaded = await cloud.uploadFile({ cloudPath: `generated-gifs/${id}.gif`, fileContent: fs.readFileSync(outputPath) });
    return { success: true, fileID: uploaded.fileID };
  } finally {
    [inputPath, outputPath].forEach(file => { try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (_) {} });
  }
}

exports.main = async event => {
  try {
    if (event.action === 'audit') return await audit(event.fileID, event.contentType);
    if (event.action === 'auditVideo') return await auditVideo(event.fileID);
    if (event.action === 'generate') return await generate(event);
    if (event.action === 'generateVideo') return await generateVideo(event);
    return { success: false, message: 'unknown action' };
  } catch (error) {
    console.error(error);
    return {
      success: false,
      type: event.action === 'audit' || event.action === 'auditVideo' ? 'system_error' : 'generate_error',
      retryable: event.action === 'audit' || event.action === 'auditVideo',
      message: error.message || '云函数内部错误',
      errCode: error.errCode || error.code || ''
    };
  }
};
