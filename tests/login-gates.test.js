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
      deleteFile: () => Promise.resolve()
    }
  };
  return calls;
}

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

test('更换视频复用受保护的 chooseVideo 入口', async () => {
  installWx();
  const video = loadPage('pages/gifVideo/gifVideo.js', async () => null);
  let chooseCalls = 0;
  const context = pageContext(video, {}, { chooseVideo: async () => { chooseCalls += 1; } });

  await context.changeVideo();

  assert.equal(chooseCalls, 1);
});
