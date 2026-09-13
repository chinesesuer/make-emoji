const test = require('node:test');
const assert = require('node:assert/strict');

const AUTH_PATH = require.resolve('../miniprogram/utils/auth.js');

function createWx(overrides = {}) {
  const storage = new Map();
  const calls = { checkSession: 0, showModal: 0, modalOptions: null, getUserProfile: 0, login: 0, callFunction: 0, showToast: [], profileOptions: null, cloudOptions: null };
  const wx = {
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    removeStorageSync(key) { storage.delete(key); },
    checkSession() { calls.checkSession += 1; return Promise.resolve(); },
    showModal(options) { calls.showModal += 1; calls.modalOptions = options; options.success({ confirm: true, cancel: false }); },
    getUserProfile(options) { calls.getUserProfile += 1; calls.profileOptions = options; return Promise.resolve({ userInfo: { nickName: '小明' } }); },
    login() { calls.login += 1; return Promise.resolve({ code: 'login-code' }); },
    cloud: { callFunction(options) { calls.callFunction += 1; calls.cloudOptions = options; return Promise.resolve({ result: { success: true, user: { openid: 'openid-1', nickName: '小明' } } }); } },
    showToast(options) { calls.showToast.push(options); },
    ...overrides
  };
  return { wx, storage, calls };
}

function loadAuth(wx) {
  delete require.cache[AUTH_PATH];
  global.wx = wx;
  return require('../miniprogram/utils/auth.js');
}

test.afterEach(() => {
  delete require.cache[AUTH_PATH];
  delete global.wx;
});

test('有效缓存会直接返回用户且不请求授权或云函数', async () => {
  const { wx, storage, calls } = createWx();
  const cachedUser = { openid: 'cached-openid', nickName: '缓存用户' };
  storage.set('emojiUserSession', cachedUser);
  const auth = loadAuth(wx);

  const user = await auth.ensureLogin();

  assert.equal(user, cachedUser);
  assert.equal(calls.checkSession, 1);
  assert.equal(calls.showModal, 0);
  assert.equal(calls.getUserProfile, 0);
  assert.equal(calls.callFunction, 0);
});

test('首次登录会先询问用户，确认后才请求微信授权', async () => {
  const { wx, calls } = createWx();
  const auth = loadAuth(wx);

  const user = await auth.ensureLogin();

  assert.equal(user.openid, 'openid-1');
  assert.equal(calls.showModal, 1);
  assert.equal(calls.modalOptions.title, '登录提示');
  assert.equal(calls.modalOptions.content, '该功能需要登录，是否立即登录？');
  assert.equal(calls.modalOptions.cancelText, '取消');
  assert.equal(calls.modalOptions.confirmText, '立即登录');
  assert.equal(calls.getUserProfile, 1);
});

test('用户取消登录询问时不会请求授权或执行云端登录', async () => {
  const { wx, calls } = createWx({
    showModal(options) { calls.showModal += 1; calls.modalOptions = options; options.success({ confirm: false, cancel: true }); }
  });
  const auth = loadAuth(wx);

  const user = await auth.ensureLogin();

  assert.equal(user, null);
  assert.equal(calls.getUserProfile, 0);
  assert.equal(calls.login, 0);
  assert.equal(calls.callFunction, 0);
});

test('失效缓存会清除后完成新的授权登录', async () => {
  const { wx, storage, calls } = createWx({
    checkSession() { calls.checkSession += 1; return Promise.reject(new Error('expired')); }
  });
  storage.set('emojiUserSession', { openid: 'expired-openid' });
  const auth = loadAuth(wx);

  const user = await auth.ensureLogin();

  assert.deepEqual(user, { openid: 'openid-1', nickName: '小明' });
  assert.deepEqual(storage.get('emojiUserSession'), user);
  assert.equal(calls.getUserProfile, 1);
  assert.equal(calls.login, 1);
  assert.equal(calls.callFunction, 1);
});

test('首次登录请求资料、登录和云函数并缓存返回用户', async () => {
  const { wx, storage, calls } = createWx();
  const auth = loadAuth(wx);

  const user = await auth.ensureLogin();

  assert.deepEqual(user, { openid: 'openid-1', nickName: '小明' });
  assert.deepEqual(storage.get('emojiUserSession'), user);
  assert.equal(calls.getUserProfile, 1);
  assert.equal(calls.login, 1);
  assert.equal(calls.callFunction, 1);
  assert.deepEqual(calls.profileOptions, { desc: '用于登录并展示头像昵称' });
  assert.deepEqual(calls.cloudOptions, {
    name: 'quickstartFunctions',
    data: { type: 'login', profile: { nickName: '小明' } }
  });
});

test('读取用户缓存异常会返回 null、提示失败且不产生未处理拒绝', async () => {
  const { wx, calls } = createWx({
    getStorageSync() { throw new Error('storage unavailable'); }
  });
  const auth = loadAuth(wx);
  const unhandled = [];
  const onUnhandled = reason => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);

  try {
    const user = await auth.ensureLogin();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(user, null);
    assert.deepEqual(calls.showToast, [{ title: '登录失败，请稍后重试', icon: 'none' }]);
    assert.equal(unhandled.length, 0);
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

test('取消授权会返回 null、提示登录要求且不调用云函数', async () => {
  const { wx, calls } = createWx({
    getUserProfile() { calls.getUserProfile += 1; return Promise.reject(new Error('deny')); }
  });
  const auth = loadAuth(wx);

  const user = await auth.ensureLogin();

  assert.equal(user, null);
  assert.equal(calls.callFunction, 0);
  assert.deepEqual(calls.showToast, [{ title: '登录后才能使用该功能', icon: 'none' }]);
});

test('云函数失败会返回 null 并提示稍后重试', async () => {
  const { wx, calls } = createWx({
    cloud: { callFunction() { calls.callFunction += 1; return Promise.resolve({ result: { success: false } }); } }
  });
  const auth = loadAuth(wx);

  const user = await auth.ensureLogin();

  assert.equal(user, null);
  assert.deepEqual(calls.showToast, [{ title: '登录失败，请稍后重试', icon: 'none' }]);
});

test('并发登录请求共享同一 Promise，结算后会释放锁以启动新请求', async () => {
  let resolveProfile;
  const profilePromise = new Promise(resolve => { resolveProfile = resolve; });
  const { wx, calls } = createWx({
    getUserProfile() { calls.getUserProfile += 1; return profilePromise; }
  });
  const auth = loadAuth(wx);

  const first = auth.ensureLogin();
  const second = auth.ensureLogin();
  assert.equal(first, second);
  resolveProfile({ userInfo: { nickName: '小明' } });
  const [firstUser, secondUser] = await Promise.all([first, second]);

  assert.deepEqual(firstUser, { openid: 'openid-1', nickName: '小明' });
  assert.equal(secondUser, firstUser);
  assert.equal(calls.getUserProfile, 1);
  assert.equal(calls.callFunction, 1);

  auth.logout();
  const nextUser = await auth.ensureLogin();
  assert.deepEqual(nextUser, { openid: 'openid-1', nickName: '小明' });
  assert.equal(calls.getUserProfile, 2);
  assert.equal(calls.callFunction, 2);
});

test('requireLogin 仅在成功后执行原操作并保留 this 和参数', async () => {
  const { wx } = createWx();
  const auth = loadAuth(wx);
  const context = { prefix: '结果：' };
  function action(left, right) { return this.prefix + left + right; }

  const guardedAction = auth.requireLogin(action);
  const result = await guardedAction.call(context, 'A', 'B');

  assert.equal(result, '结果：AB');
});

test('requireLogin 登录失败时不执行原操作', async () => {
  const { wx } = createWx({
    getUserProfile() { return Promise.reject(new Error('deny')); }
  });
  const auth = loadAuth(wx);
  let invoked = false;

  const result = await auth.requireLogin(() => { invoked = true; })();

  assert.equal(result, null);
  assert.equal(invoked, false);
});

test('logout 只清除普通用户缓存', () => {
  const { wx, storage } = createWx();
  storage.set('emojiUserSession', { openid: 'openid-1' });
  storage.set('adminToken', 'admin-secret');
  const auth = loadAuth(wx);

  auth.logout();

  assert.equal(storage.has('emojiUserSession'), false);
  assert.equal(storage.get('adminToken'), 'admin-secret');
});
