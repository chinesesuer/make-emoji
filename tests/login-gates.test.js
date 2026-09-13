const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', 'miniprogram');

function loadPage(relativePath, ensureLogin) {
  let definition;
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  vm.runInNewContext(source, {
    Page(value) { definition = value; },
    require(request) {
      if (request === '../../utils/auth') return { ensureLogin };
      if (request === '../../utils/material-loader') return { splitIntoBatches: () => [], applyTemporaryUrls: value => value };
      throw new Error(`unexpected import: ${request}`);
    },
    wx: global.wx,
    console,
    setTimeout
  });
  return definition;
}

function pageContext(definition, data, extra = {}) {
  const updates = [];
  return {
    ...definition,
    ...extra,
    data: { ...definition.data, ...data },
    updates,
    setData(update) {
      updates.push(update);
      Object.assign(this.data, update);
    }
  };
}

function installWx() {
  const calls = [];
  global.wx = {
    showToast(options) { calls.push(['toast', options]); },
    showLoading(options) { calls.push(['loading', options]); },
    hideLoading() { calls.push(['hideLoading']); },
    canvasToTempFilePath(options) { calls.push(['canvasExport']); options.success({ tempFilePath: '/tmp/emoji.png' }); },
    saveImageToPhotosAlbum(options) { calls.push(['saveImage', options.filePath]); options.success(); },
    chooseMedia: async () => { calls.push(['chooseMedia']); return { tempFiles: [] }; },
    cloud: {
      callFunction: async () => { calls.push(['cloudCall']); return { result: { success: true, fileID: 'gif-id' } }; },
      downloadFile: async () => ({ tempFilePath: '/tmp/result.gif' }),
      deleteFile: ({ fileList }) => { calls.push(['deleteFile', fileList]); return Promise.resolve(); }
    }
  };
  return calls;
}

function deferred() {
  let resolve;
  const promise = new Promise(next => { resolve = next; });
  return { promise, resolve };
}

function methodSource(relativePath, method) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const start = source.indexOf(`async ${method}(`) >= 0
    ? source.indexOf(`async ${method}(`)
    : source.indexOf(`${method}(`);
  assert.notEqual(start, -1, `${relativePath} should define ${method}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (!depth) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${relativePath} has an unterminated ${method}`);
}

function assertLoginPrecedes(relativePath, method, sideEffect) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  assert.match(source, /require\('\.\.\/\.\.\/utils\/auth'\)/, `${relativePath} imports auth`);
  const body = methodSource(relativePath, method);
  const login = body.indexOf('await ensureLogin()');
  const effect = body.indexOf(sideEffect);
  assert.notEqual(login, -1, `${method} awaits ensureLogin`);
  assert.notEqual(effect, -1, `${method} performs ${sideEffect}`);
  assert.ok(login < effect, `${method} authenticates before ${sideEffect}`);
  assert.ok(body.indexOf('if (!user)', login) > login, `${method} exits after a cancelled login`);
}

test('其余创作工具在实际副作用前完成登录检查', () => {
  assertLoginPrecedes('pages/gifImages/gifImages.js', 'chooseImages', 'wx.chooseMedia');
  assertLoginPrecedes('pages/gifImages/gifImages.js', 'generateGif', 'generating: true');
  assertLoginPrecedes('pages/gifImages/gifImages.js', 'saveGeneratedGif', 'wx.saveImageToPhotosAlbum');
  assertLoginPrecedes('pages/gifText/gifText.js', 'chooseGif', 'wx.showActionSheet');
  assertLoginPrecedes('pages/gifText/gifText.js', 'generate', 'generating: true');
  assertLoginPrecedes('pages/gifText/gifText.js', 'saveResult', 'wx.saveImageToPhotosAlbum');
  assertLoginPrecedes('pages/emojiMixer/emojiMixer.js', 'saveEmoji', 'saving: true');
  assertLoginPrecedes('pages/diyEmoji/diyEmoji.js', 'chooseMaterial', 'this.snapshot');
  assertLoginPrecedes('pages/diyEmoji/diyEmoji.js', 'save', 'saving: true');
  assertLoginPrecedes('pages/gridSlice/gridSlice.js', 'chooseImage', 'wx.chooseMedia');
  assertLoginPrecedes('pages/gridSlice/gridSlice.js', 'generateTiles', 'generating: true');
  assertLoginPrecedes('pages/gridSlice/gridSlice.js', 'saveAll', 'saving: true');
});

test('取消登录不会启动其余创作工具的选择、生成或保存', async () => {
  const calls = installWx();
  const gifImages = loadPage('pages/gifImages/gifImages.js', async () => null);
  const gifText = loadPage('pages/gifText/gifText.js', async () => null);
  const mixer = loadPage('pages/emojiMixer/emojiMixer.js', async () => null);
  const diy = loadPage('pages/diyEmoji/diyEmoji.js', async () => null);
  const grid = loadPage('pages/gridSlice/gridSlice.js', async () => null);

  const imageChoose = pageContext(gifImages, { images: [] });
  const imageGenerate = pageContext(gifImages, { images: [{ path: 'a' }, { path: 'b' }], generating: false });
  const imageSave = pageContext(gifImages, { generatedGif: '/tmp/result.gif' });
  const textChoose = pageContext(gifText, {});
  const textGenerate = pageContext(gifText, { text: 'hi', generating: false });
  const textSave = pageContext(gifText, { generatedGif: '/tmp/result.gif' });
  const mixSave = pageContext(mixer, { resultType: 'fallback', saving: false });
  const diyChoose = pageContext(diy, { category: 0 }, { history: [] });
  const diySave = pageContext(diy, { saving: false, facesLoading: false }, { state: { face: 0 } });
  const gridChoose = pageContext(grid, {});
  const gridGenerate = pageContext(grid, { imagePath: '/tmp/image.png', generating: false });
  const gridSave = pageContext(grid, { tiles: [{ path: '/tmp/tile.png' }], saving: false });

  await imageChoose.chooseImages(); await imageGenerate.generateGif(); await imageSave.saveGeneratedGif();
  await textChoose.chooseGif(); await textGenerate.generate(); await textSave.saveResult();
  await mixSave.saveEmoji(); await diyChoose.chooseMaterial({ currentTarget: { dataset: { index: 0 } } }); await diySave.save();
  await gridChoose.chooseImage(); await gridGenerate.generateTiles(); await gridSave.saveAll();

  assert.equal(calls.some(([name]) => ['chooseMedia', 'cloudCall', 'canvasExport', 'saveImage'].includes(name)), false);
  assert.equal(imageGenerate.updates.some(update => update.generating === true), false);
  assert.equal(textGenerate.updates.some(update => update.generating === true), false);
  assert.equal(mixSave.updates.some(update => update.saving === true), false);
  assert.equal(gridGenerate.updates.some(update => update.generating === true), false);
  assert.equal(gridSave.updates.some(update => update.saving === true), false);
  assert.deepEqual(diyChoose.updates, []);
});

test('成功登录会在同次创作点击中继续选择、生成和保存', async () => {
  const calls = installWx();
  global.wx.cloud.uploadFile = async () => ({ fileID: 'overlay-id' });
  const gifImages = loadPage('pages/gifImages/gifImages.js', async () => ({ openid: 'user-1' }));
  const gifText = loadPage('pages/gifText/gifText.js', async () => ({ openid: 'user-1' }));
  const mixer = loadPage('pages/emojiMixer/emojiMixer.js', async () => ({ openid: 'user-1' }));

  const choose = pageContext(gifImages, { images: [] });
  const generate = pageContext(gifText, { text: 'hi', generating: false }, { createOverlay: async () => '/tmp/overlay.png' });
  const save = pageContext(mixer, { resultType: 'fallback', saving: false }, { renderFallbackImage: async () => '/tmp/mix.png' });

  await choose.chooseImages();
  await generate.generate();
  await save.saveEmoji();

  assert.equal(calls.some(([name]) => name === 'chooseMedia'), true);
  assert.equal(generate.updates.some(update => update.generating === true), true);
  assert.equal(calls.some(([name]) => name === 'cloudCall'), true);
  assert.equal(calls.some(([name]) => name === 'saveImage'), true);
});

test('登录等待期间重复点击不会重复打开选择器、生成或保存', async () => {
  const calls = installWx();
  const login = deferred();
  const gifImages = loadPage('pages/gifImages/gifImages.js', () => login.promise);
  const gifText = loadPage('pages/gifText/gifText.js', () => login.promise);
  const mixer = loadPage('pages/emojiMixer/emojiMixer.js', () => login.promise);
  const choose = pageContext(gifImages, { images: [] });
  const generate = pageContext(gifText, { text: 'hi', generating: false }, { createOverlay: async () => '/tmp/overlay.png' });
  const save = pageContext(mixer, { resultType: 'fallback', saving: false }, { renderFallbackImage: async () => '/tmp/mix.png' });
  global.wx.cloud.uploadFile = async () => ({ fileID: 'overlay-id' });

  const pending = [choose.chooseImages(), choose.chooseImages(), generate.generate(), generate.generate(), save.saveEmoji(), save.saveEmoji()];
  login.resolve({ openid: 'user-1' });
  await Promise.all(pending);

  assert.equal(calls.filter(([name]) => name === 'chooseMedia').length, 1);
  assert.equal(generate.updates.filter(update => update.generating === true).length, 1);
  assert.equal(calls.filter(([name]) => name === 'saveImage').length, 1);
});

test('取消登录会阻止首页生成和保存的副作用', async () => {
  const calls = installWx();
  const index = loadPage('pages/index/index.js', async () => null);
  const generate = pageContext(index, { body: 'body' });
  const save = pageContext(index, { generatedImage: '/tmp/emoji.png' });

  await generate.generateEmoji();
  await save.saveGeneratedImage();

  assert.equal(generate.updates.some(update => update.generating === true), false);
  assert.equal(calls.some(([name]) => name === 'canvasExport' || name === 'saveImage'), false);
});

test('成功登录会在同次首页生成和保存操作中继续执行', async () => {
  const calls = installWx();
  const index = loadPage('pages/index/index.js', async () => ({ openid: 'user-1' }));
  const ctx = { clearRect() {}, fillRect() {} };
  const generate = pageContext(index, { body: 'body' }, {
    createSelectorQuery() {
      return { select: () => ({ fields: () => ({ exec: callback => callback([{ node: { width: 0, height: 0, getContext: () => ctx } }]) }) }) };
    }
  });
  const save = pageContext(index, { generatedImage: '/tmp/emoji.png' });

  await generate.generateEmoji();
  await save.saveGeneratedImage();

  assert.equal(generate.updates.some(update => update.generating === true), true);
  assert.equal(calls.some(([name]) => name === 'canvasExport'), true);
  assert.deepEqual(calls.filter(([name]) => name === 'saveImage'), [['saveImage', '/tmp/emoji.png']]);
});

test('取消登录会阻止视频选择、转换和保存的副作用', async () => {
  const calls = installWx();
  const video = loadPage('pages/gifVideo/gifVideo.js', async () => null);
  const choose = pageContext(video, {});
  const convert = pageContext(video, { video: { auditFileID: 'audit', width: 10, height: 10 } });
  const save = pageContext(video, { generatedGif: '/tmp/result.gif' });

  await choose.chooseVideo();
  await convert.startConvert();
  await save.saveGif();

  assert.equal(calls.some(([name]) => name === 'chooseMedia' || name === 'cloudCall' || name === 'saveImage'), false);
  assert.equal(convert.updates.some(update => update.converting === true), false);
});

test('成功登录会在同次视频入口中继续选择、转换和保存', async () => {
  const calls = installWx();
  const video = loadPage('pages/gifVideo/gifVideo.js', async () => ({ openid: 'user-1' }));
  const choose = pageContext(video, {});
  const convert = pageContext(video, { video: { auditFileID: 'audit', width: 10, height: 10 } });
  const save = pageContext(video, { generatedGif: '/tmp/result.gif' });

  await choose.chooseVideo();
  await convert.startConvert();
  await save.saveGif();

  assert.equal(calls.some(([name]) => name === 'chooseMedia'), true);
  assert.equal(convert.updates.some(update => update.converting === true), true);
  assert.equal(calls.some(([name]) => name === 'cloudCall'), true);
  assert.equal(calls.some(([name]) => name === 'saveImage'), true);
});

test('登录等待期间同一首页生成只会继续一次', async () => {
  const calls = installWx();
  const login = deferred();
  const index = loadPage('pages/index/index.js', () => login.promise);
  const ctx = { clearRect() {}, fillRect() {} };
  const context = pageContext(index, { body: 'body' }, {
    createSelectorQuery() {
      return { select: () => ({ fields: () => ({ exec: callback => callback([{ node: { getContext: () => ctx } }]) }) }) };
    }
  });

  const first = context.generateEmoji();
  const second = context.generateEmoji();
  const third = context.generateEmoji();
  login.resolve({ openid: 'user-1' });
  await Promise.all([first, second, third]);

  assert.equal(calls.filter(([name]) => name === 'canvasExport').length, 1);
  assert.equal(context.updates.filter(update => update.generating === true).length, 1);
});

test('登录等待期间同一视频选择和转换各只会继续一次', async () => {
  const chooseCalls = installWx();
  const chooseLogin = deferred();
  const video = loadPage('pages/gifVideo/gifVideo.js', () => chooseLogin.promise);
  const choose = pageContext(video, {});
  const firstChoose = choose.chooseVideo();
  const secondChoose = choose.chooseVideo();
  chooseLogin.resolve({ openid: 'user-1' });
  await Promise.all([firstChoose, secondChoose]);
  assert.equal(chooseCalls.filter(([name]) => name === 'chooseMedia').length, 1);

  const convertCalls = installWx();
  const convertLogin = deferred();
  const convertDefinition = loadPage('pages/gifVideo/gifVideo.js', () => convertLogin.promise);
  const convert = pageContext(convertDefinition, { video: { auditFileID: 'audit', width: 10, height: 10 } });
  const firstConvert = convert.startConvert();
  const secondConvert = convert.startConvert();
  convertLogin.resolve({ openid: 'user-1' });
  await Promise.all([firstConvert, secondConvert]);
  assert.equal(convertCalls.filter(([name]) => name === 'cloudCall').length, 1);
  assert.equal(convert.updates.filter(update => update.converting === true).length, 1);
});

test('更换视频在登录取消时不触发任何选择、状态或云删除副作用', async () => {
  const calls = installWx();
  const video = loadPage('pages/gifVideo/gifVideo.js', async () => null);
  const old = { auditFileID: 'old-audit' };
  const context = pageContext(video, { video: old, crop: { left: 1 } });

  await context.changeVideo();

  assert.equal(calls.some(([name]) => name === 'chooseMedia'), false);
  assert.equal(calls.some(([name]) => name === 'deleteFile'), false);
  assert.deepEqual(context.updates, []);
  assert.equal(context.data.video, old);
});

test('更换视频在选择取消或审核失败时保留旧视频和旧云文件', async () => {
  const selectionCalls = installWx();
  const definition = loadPage('pages/gifVideo/gifVideo.js', async () => ({ openid: 'user-1' }));
  const old = { auditFileID: 'old-audit' };
  const cancelled = pageContext(definition, { video: old });
  global.wx.chooseMedia = async () => { throw new Error('chooseMedia:fail cancel'); };
  global.wx.cloud.deleteFile = ({ fileList }) => { selectionCalls.push(['deleteFile', fileList]); return Promise.resolve(); };

  await cancelled.changeVideo();

  assert.equal(cancelled.data.video, old);
  assert.equal(selectionCalls.some(([name]) => name === 'deleteFile'), false);

  const auditCalls = installWx();
  const auditDefinition = loadPage('pages/gifVideo/gifVideo.js', async () => ({ openid: 'user-1' }));
  const auditOld = { auditFileID: 'old-audit' };
  const auditFailed = pageContext(auditDefinition, { video: auditOld }, { prepareVideo: async () => false });
  global.wx.chooseMedia = async () => ({ tempFiles: [{ tempFilePath: '/tmp/new.mp4' }] });
  global.wx.cloud.deleteFile = ({ fileList }) => { auditCalls.push(['deleteFile', fileList]); return Promise.resolve(); };

  await auditFailed.changeVideo();

  assert.equal(auditFailed.data.video, auditOld);
  assert.equal(auditCalls.some(([name]) => name === 'deleteFile'), false);
});

test('更换视频仅在新视频审核成功替换后删除旧云文件', async () => {
  const calls = installWx();
  const video = loadPage('pages/gifVideo/gifVideo.js', async () => ({ openid: 'user-1' }));
  const old = { auditFileID: 'old-audit' };
  const replacement = { auditFileID: 'new-audit' };
  const context = pageContext(video, { video: old }, {
    async prepareVideo() {
      this.setData({ video: replacement, crop: null });
      return true;
    }
  });
  global.wx.chooseMedia = async () => ({ tempFiles: [{ tempFilePath: '/tmp/new.mp4' }] });
  global.wx.cloud.deleteFile = ({ fileList }) => { calls.push(['deleteFile', fileList]); return Promise.resolve(); };

  await context.changeVideo();

  const deletions = calls.filter(([name]) => name === 'deleteFile');
  assert.equal(deletions.length, 1);
  assert.equal(deletions[0][1][0], 'old-audit');
  assert.equal(context.data.video, replacement);
});
