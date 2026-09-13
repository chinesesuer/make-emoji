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
      if (request === '../../utils/auth') return typeof ensureLogin === 'function' ? { ensureLogin } : ensureLogin;
      if (request === '../../utils/material-loader') return { splitIntoBatches: () => [], applyTemporaryUrls: value => value };
      if (request === '../../utils/creation-fingerprint') return { buildCreationFingerprint: () => '0123456789abcdef' };
      throw new Error(`unexpected import: ${request}`);
    },
    wx: global.wx,
    console,
    setTimeout
  });
  return definition;
}

test('个人中心展示真实登录状态并保护个人功能入口', async () => {
  const calls = installWx();
  let cachedUser = null;
  const loggedInUser = { openid: 'user-1', nickName: '小明', avatarUrl: 'avatar.png' };
  const profile = loadPage('pages/profile/profile.js', {
    getCurrentUser: () => cachedUser,
    ensureLogin: async () => loggedInUser
  });
  const context = pageContext(profile, {}, {
    route: 'pages/profile/profile',
    getTabBar: () => ({ setData(update) { calls.push(['tabBar', update]); } })
  });

  context.onShow();
  assert.equal(context.data.loggedIn, false);
  assert.equal(context.data.user, null);

  await context.login();
  assert.deepEqual(context.data.user, loggedInUser);
  assert.equal(context.data.loggedIn, true);

  cachedUser = loggedInUser;
  context.refreshUser();
  await context.openUserFeature({ currentTarget: { dataset: { name: '我的收藏' } } });
  assert.equal(calls.some(([name, options]) => name === 'toast' && options.title === '我的收藏即将上线'), true);

  const wxml = fs.readFileSync(path.join(root, 'pages/profile/profile.wxml'), 'utf8');
  assert.match(wxml, /user\.avatarUrl/);
  assert.match(wxml, /user\.nickName/);
  assert.match(wxml, /点击登录/);
  assert.equal((wxml.match(/bindtap="openUserFeature"/g) || []).length, 4);
  assert.doesNotMatch(wxml, /用户27674544|UID:\s*27674544/);
});

test('个人中心登录取消时不打开个人功能', async () => {
  const calls = installWx();
  const profile = loadPage('pages/profile/profile.js', {
    getCurrentUser: () => null,
    ensureLogin: async () => null
  });
  const context = pageContext(profile, {});

  await context.openUserFeature({ currentTarget: { dataset: { name: '我的制作' } } });

  assert.equal(context.data.loggedIn, false);
  assert.equal(calls.some(([name]) => name === 'toast'), false);
});

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
    showModal(options) { calls.push(['modal', options]); },
    showLoading(options) { calls.push(['loading', options]); },
    hideLoading() { calls.push(['hideLoading']); },
    canvasToTempFilePath(options) { calls.push(['canvasExport']); options.success({ tempFilePath: '/tmp/emoji.png' }); },
    saveImageToPhotosAlbum(options) { calls.push(['saveImage', options.filePath]); options.success(); },
    chooseMedia: async () => { calls.push(['chooseMedia']); return { tempFiles: [] }; },
    cloud: {
      uploadFile: async () => ({ fileID: 'cloud://creation.png' }),
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
  const cancelled = body.indexOf('if (!user)', login);
  assert.ok(cancelled > login && cancelled < effect, `${method} exits after a cancelled login before ${sideEffect}`);
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

test('DIY 选择在登录等待期间使用点击时快照的分类和素材索引', async () => {
  installWx();
  const login = deferred();
  const diy = loadPage('pages/diyEmoji/diyEmoji.js', () => login.promise);
  const context = pageContext(diy, { category: 0 }, {
    history: [],
    state: { face: 0, eyes: 1, pupil: 0, mouth: 0, decorations: [] },
    refresh() {}
  });

  const selecting = context.chooseMaterial({ currentTarget: { dataset: { index: 3 } } });
  context.data.category = 1;
  login.resolve({ openid: 'user-1' });
  await selecting;

  assert.equal(context.state.face, 3);
  assert.equal(context.state.eyes, 1);
});

test('代表性选择、生成和保存锁会在取消、登录异常和完成后释放', async () => {
  const calls = installWx();
  const from = outcomes => async () => {
    const outcome = outcomes.shift();
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  const gifImages = loadPage('pages/gifImages/gifImages.js', from([null, { openid: 'user-1' }, { openid: 'user-1' }]));
  const gifText = loadPage('pages/gifText/gifText.js', from([new Error('login failed'), { openid: 'user-1' }, { openid: 'user-1' }]));
  const mixer = loadPage('pages/emojiMixer/emojiMixer.js', from([null, { openid: 'user-1' }, { openid: 'user-1' }]));
  const choose = pageContext(gifImages, { images: [] });
  const generate = pageContext(gifText, { text: 'hi', generating: false }, { createOverlay: async () => '/tmp/overlay.png' });
  const save = pageContext(mixer, { resultType: 'fallback', saving: false }, { renderFallbackImage: async () => '/tmp/mix.png' });
  global.wx.cloud.uploadFile = async () => ({ fileID: 'overlay-id' });

  await choose.chooseImages();
  await generate.generate();
  await save.saveEmoji();
  await choose.chooseImages();
  await generate.generate();
  await save.saveEmoji();
  await choose.chooseImages();
  await generate.generate();
  await save.saveEmoji();

  assert.equal(calls.filter(([name]) => name === 'chooseMedia').length, 2);
  assert.equal(generate.updates.filter(update => update.generating === true).length, 2);
  assert.equal(calls.filter(([name]) => name === 'saveImage').length, 2);
});

test('GIF 生成在登录取消或异常时不隐藏未显示的加载框', async () => {
  const cancelledCalls = installWx();
  const imagesCancelled = loadPage('pages/gifImages/gifImages.js', async () => null);
  const textCancelled = loadPage('pages/gifText/gifText.js', async () => null);
  await pageContext(imagesCancelled, { images: [{ path: 'a' }, { path: 'b' }], generating: false }).generateGif();
  await pageContext(textCancelled, { text: 'hi', generating: false }).generate();
  assert.equal(cancelledCalls.some(([name]) => name === 'hideLoading'), false);

  const failedCalls = installWx();
  const failed = async () => { throw new Error('login failed'); };
  const imagesFailed = loadPage('pages/gifImages/gifImages.js', failed);
  const textFailed = loadPage('pages/gifText/gifText.js', failed);
  await pageContext(imagesFailed, { images: [{ path: 'a' }, { path: 'b' }], generating: false }).generateGif();
  await pageContext(textFailed, { text: 'hi', generating: false }).generate();
  assert.equal(failedCalls.some(([name]) => name === 'hideLoading'), false);
});

test('GIF 选择在登录取消或异常时不隐藏未显示的加载框', async () => {
  const cancelledCalls = installWx();
  const imagesCancelled = loadPage('pages/gifImages/gifImages.js', async () => null);
  const textCancelled = loadPage('pages/gifText/gifText.js', async () => null);
  await pageContext(imagesCancelled, { images: [] }).chooseImages();
  await pageContext(textCancelled, {}).chooseGif();
  assert.equal(cancelledCalls.some(([name]) => name === 'hideLoading'), false);

  const failedCalls = installWx();
  const failed = async () => { throw new Error('login failed'); };
  const imagesFailed = loadPage('pages/gifImages/gifImages.js', failed);
  const textFailed = loadPage('pages/gifText/gifText.js', failed);
  await pageContext(imagesFailed, { images: [] }).chooseImages();
  await pageContext(textFailed, {}).chooseGif();
  assert.equal(failedCalls.some(([name]) => name === 'hideLoading'), false);
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
