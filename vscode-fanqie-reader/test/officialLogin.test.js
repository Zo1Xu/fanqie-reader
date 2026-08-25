'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildLoginUrl,
  classifyPhonePageText,
  cleanAutomationMessage,
  clickElement,
  findBrowserExecutable,
  getBackgroundBrowserLaunchOptions,
  isValidPhone,
  isValidSmsCode,
  maskPhone,
  navigateToLoginPage,
  normalizePhone,
  serializeCookies,
} = require('../src/officialLogin');

test('buildLoginUrl uses Fanqie unified SSO and returns to the reader bookshelf', () => {
  const url = new URL(buildLoginUrl());
  assert.equal(url.origin, 'https://fanqienovel.com');
  assert.equal(url.pathname, '/main/writer/login');
  const loginData = JSON.parse(url.searchParams.get('_login_data'));
  assert.equal(loginData.needRedirect, true);
  assert.equal(loginData.redirectURLs.login, 'https://fanqienovel.com/bookshelf');
});

test('login navigation continues after the document commits instead of waiting for DOMContentLoaded', async () => {
  let navigation;
  await navigateToLoginPage({
    goto: async (url, options) => {
      navigation = { url, options };
    },
  });
  assert.equal(navigation.url, buildLoginUrl());
  assert.equal(navigation.options.waitUntil, 'commit');
  assert.equal(navigation.options.timeout, 45_000);
});

test('QR login keeps its real browser off-screen without background throttling', () => {
  const options = getBackgroundBrowserLaunchOptions('C:\\Browser\\msedge.exe');
  assert.equal(options.executablePath, 'C:\\Browser\\msedge.exe');
  assert.equal(options.headless, false);
  assert.equal(options.args.includes('--window-position=-10000,-10000'), true);
  assert.equal(options.args.includes('--start-minimized'), false);
  assert.equal(options.args.includes('--disable-background-timer-throttling'), true);
  assert.equal(options.args.includes('--disable-renderer-backgrounding'), true);
});

test('serializeCookies keeps only Fanqie cookies and removes duplicates', () => {
  const result = serializeCookies([
    { name: 'sessionid', value: 'old', domain: '.fanqienovel.com' },
    { name: 'sessionid', value: 'new', domain: 'fanqienovel.com' },
    { name: 'csrf', value: 'safe', domain: 'sub.fanqienovel.com' },
    { name: 'foreign', value: 'no', domain: 'example.com' },
  ]);
  assert.equal(result, 'csrf=safe; sessionid=new');
});

test('findBrowserExecutable prefers an explicitly configured path', () => {
  const result = findBrowserExecutable({
    preferredPath: 'D:\\Browser\\chrome.exe',
    platform: 'win32',
    env: {},
    existsSync: (candidate) => candidate === 'D:\\Browser\\chrome.exe',
  });
  assert.equal(result, 'D:\\Browser\\chrome.exe');
});

test('findBrowserExecutable detects Chrome under LOCALAPPDATA on Windows', () => {
  const expected = 'C:\\Users\\demo\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
  const result = findBrowserExecutable({
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\Users\\demo\\AppData\\Local' },
    existsSync: (candidate) => candidate === expected,
  });
  assert.equal(result, expected);
});

test('findBrowserExecutable detects Chrome in Applications on macOS', () => {
  const expected = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const result = findBrowserExecutable({
    platform: 'darwin',
    env: {},
    existsSync: (candidate) => candidate === expected,
  });
  assert.equal(result, expected);
});

test('phone login validates and masks ephemeral credentials', () => {
  assert.equal(normalizePhone('+86 138-1234-5678'), '13812345678');
  assert.equal(isValidPhone('13812345678'), true);
  assert.equal(isValidPhone('12812345678'), false);
  assert.equal(maskPhone('13812345678'), '138****5678');
  assert.equal(isValidSmsCode('1234'), true);
  assert.equal(isValidSmsCode('123456'), false);
});

test('phone page text recognizes SMS success and manual verification states', () => {
  assert.equal(
    classifyPhonePageText('请完成下列验证后继续，按住左边按钮拖动完成上方拼图'),
    'verification_required',
  );
  assert.equal(classifyPhonePageText('59 秒后重新获取'), 'sms_sent');
  assert.equal(classifyPhonePageText('获取验证码'), 'waiting');
});

test('background login clicks attached DOM elements without viewport actionability', async () => {
  let waitOptions;
  let clicked = false;
  await clickElement({
    waitFor: async (options) => {
      waitOptions = options;
    },
    evaluate: async (callback) => callback({ click: () => { clicked = true; } }),
  });
  assert.deepEqual(waitOptions, { state: 'attached', timeout: 15_000 });
  assert.equal(clicked, true);
});

test('Playwright call logs are reduced to a readable sidebar error', () => {
  const result = cleanAutomationMessage({
    message: '\u001b[2mlocator.check: Element is outside of the viewport\u001b[22m\nCall log:\n - waiting',
  });
  assert.equal(result, 'locator.check: Element is outside of the viewport');
});
