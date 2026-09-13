const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'miniprogram');

function loadPage(relativePath, wx, auth) {
  let definition;
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  vm.runInNewContext(source, {
    Page(value) { definition = value; },
    wx,
    console: { error() {} },
    require(request) {
      if (request === '../../utils/auth') return auth;
      throw new Error(`unexpected import ${request}`);
    }
  });
  return definition;
}

function createContext(definition) {
  return {
    ...definition,
    data: { ...definition.data },
    setData(update) { Object.assign(this.data, update); }
  };
}

test('作品页加载作品、转换临时地址并支持预览', async () => {
  const calls = [];
  const wx = {
    cloud: {
      async callFunction(options) {
        calls.push(['call', options]);
        return { result: { success: true, creations: [
          { _id: '1', fileID: 'cloud://one.png' },
          { _id: '2', fileID: 'cloud://two.png' }
        ] } };
      },
      async getTempFileURL(options) {
        calls.push(['urls', options]);
        return { fileList: options.fileList.map(fileID => ({ fileID, tempFileURL: `https://temp/${fileID.slice(-7)}` })) };
      }
    },
    previewImage(options) { calls.push(['preview', options]); }
  };
  const definition = loadPage('pages/myCreations/myCreations.js', wx, { ensureLogin: async () => ({ openid: 'u1' }) });
  const page = createContext(definition);

  await page.loadCreations();
  page.previewCreation({ currentTarget: { dataset: { url: page.data.creations[1].tempFileURL } } });

  assert.equal(calls[0][1].data.type, 'listCreations');
  assert.deepEqual(Array.from(calls[1][1].fileList), ['cloud://one.png', 'cloud://two.png']);
  assert.equal(page.data.creations.length, 2);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.error, '');
  assert.equal(calls[2][1].current, page.data.creations[1].tempFileURL);
  assert.equal(calls[2][1].urls.length, 2);
});

test('作品页加载失败显示可重试状态', async () => {
  const wx = { cloud: { async callFunction() { throw new Error('network'); } } };
  const definition = loadPage('pages/myCreations/myCreations.js', wx, { ensureLogin: async () => ({ openid: 'u1' }) });
  const page = createContext(definition);

  await page.loadCreations();

  assert.equal(page.data.loading, false);
  assert.equal(page.data.error, '加载失败，点击重试');
});

test('个人中心我的制作登录后跳转，取消登录时不跳转', async () => {
  const navigations = [];
  const wx = { navigateTo({ url }) { navigations.push(url); }, showToast() {} };
  const success = createContext(loadPage('pages/profile/profile.js', wx, {
    getCurrentUser: () => null,
    ensureLogin: async () => ({ openid: 'u1' })
  }));
  await success.openUserFeature({ currentTarget: { dataset: { action: 'creations', name: '我的制作' } } });
  assert.deepEqual(navigations, ['/pages/myCreations/myCreations']);

  const cancelled = createContext(loadPage('pages/profile/profile.js', wx, {
    getCurrentUser: () => null,
    ensureLogin: async () => null
  }));
  await cancelled.openUserFeature({ currentTarget: { dataset: { action: 'creations', name: '我的制作' } } });
  assert.equal(navigations.length, 1);
});

test('页面模板包含空状态、错误重试和作品网格', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/myCreations/myCreations.wxml'), 'utf8');
  assert.match(wxml, /还没有作品，去制作一个吧/);
  assert.match(wxml, /retryLoad/);
  assert.match(wxml, /previewCreation/);
});
