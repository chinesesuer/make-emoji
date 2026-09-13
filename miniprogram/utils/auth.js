const USER_SESSION_KEY = 'emojiUserSession';

let loginPromise = null;

function getCurrentUser() {
  const user = wx.getStorageSync(USER_SESSION_KEY);
  return user && typeof user === 'object' ? user : null;
}

function isLoggedIn() {
  return Boolean(getCurrentUser());
}

function showLoginRequired() {
  wx.showToast({ title: '登录后才能使用该功能', icon: 'none' });
}

function showLoginFailed() {
  wx.showToast({ title: '登录失败，请稍后重试', icon: 'none' });
}

function isAuthorizationDenied(error) {
  const message = error && (error.errMsg || error.message || String(error));
  return /cancel|deny|denied|取消|拒绝/i.test(message);
}

async function startLogin() {
  const cachedUser = getCurrentUser();
  if (cachedUser) {
    try {
      await wx.checkSession();
      return cachedUser;
    } catch (error) {
      wx.removeStorageSync(USER_SESSION_KEY);
    }
  }

  let profileResult;
  try {
    profileResult = await wx.getUserProfile({ description: '用于登录并展示头像昵称' });
  } catch (error) {
    if (isAuthorizationDenied(error)) {
      showLoginRequired();
    } else {
      showLoginFailed();
    }
    return null;
  }

  try {
    await wx.login();
    const response = await wx.cloud.callFunction({
      name: 'quickstartFunctions',
      data: { type: 'login', profile: profileResult.userInfo || {} }
    });
    const result = response && response.result;
    if (!result || result.success !== true || !result.user || !result.user.openid) {
      throw new Error('Invalid login response');
    }
    wx.setStorageSync(USER_SESSION_KEY, result.user);
    return result.user;
  } catch (error) {
    showLoginFailed();
    return null;
  }
}

function ensureLogin() {
  if (loginPromise) {
    return loginPromise;
  }
  loginPromise = Promise.resolve()
    .then(startLogin)
    .catch(() => {
      showLoginFailed();
      return null;
    })
    .finally(() => {
      loginPromise = null;
    });
  return loginPromise;
}

function requireLogin(action) {
  return async function guardedAction(...args) {
    const user = await ensureLogin();
    if (!user) {
      return null;
    }
    return action.apply(this, args);
  };
}

function logout() {
  wx.removeStorageSync(USER_SESSION_KEY);
}

module.exports = { getCurrentUser, isLoggedIn, ensureLogin, requireLogin, logout };
