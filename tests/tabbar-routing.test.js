const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../miniprogram/app.json');
const fs = require('node:fs');
const path = require('node:path');
const mainPaths = [
  'pages/index/index',
  'pages/gifTools/gifTools',
  'pages/moreTools/moreTools',
  'pages/profile/profile'
];

test('主入口配置为自定义原生 tabBar', () => {
  assert.equal(config.tabBar.custom, true);
  assert.deepEqual(config.tabBar.list.map(item => item.pagePath), mainPaths);
});

test('主入口页面不保留重复的本地底部导航', () => {
  const pages = ['index/index.wxml', 'gifTools/gifTools.wxml', 'moreTools/moreTools.wxml', 'profile/profile.wxml'];
  pages.forEach(page => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'pages', page), 'utf8');
    assert.doesNotMatch(source, /<(?:view )?class="(?:gif-|profile-)?tabbar"/);
  });
});

test('自定义导航保留五项视觉入口，表情仓库为提示入口', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'custom-tab-bar', 'index.js'), 'utf8');
  assert.match(source, /text: '表情仓库'/);
  assert.match(source, /disabled: true/);
});

test('主入口页面不再通过普通页面栈跳转彼此', () => {
  const scripts = ['index/index.js', 'gifTools/gifTools.js', 'moreTools/moreTools.js', 'profile/profile.js'];
  scripts.forEach(script => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'pages', script), 'utf8');
    assert.doesNotMatch(source, /(?:navigateTo|redirectTo|reLaunch)\(\{\s*url:\s*['"]\/pages\/(?:index\/index|gifTools\/gifTools|moreTools\/moreTools|profile\/profile)/);
  });
});

test('主入口页面显示时会将当前路由同步给共享 TabBar', () => {
  const scripts = ['index/index.js', 'gifTools/gifTools.js', 'moreTools/moreTools.js', 'profile/profile.js'];
  scripts.forEach(script => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'pages', script), 'utf8');
    assert.match(source, /onShow\(\)\s*\{[\s\S]*?getTabBar\(\)[\s\S]*?selected:\s*this\.route/);
  });
});
