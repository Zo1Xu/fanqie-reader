'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OfficialLogin,
  buildLoginUrl,
  classifyPhonePageText,
  cleanAutomationMessage,
  clickElement,
  findBrowserExecutable,
  getBackgroundBrowserLaunchOptions,
  getBrowserNotFoundMessage,
  getBrowserUserAgent,
  isSafariExecutable,
  isValidPhone,
  isValidSmsCode,
  maskPhone,
  navigateToLoginPage,
  normalizePhone,
  saveBrowserSession,
  serializeCookies,
  showBrowserWindow,
} = require('../src/officialLogin');

test('Safari manual verification ends the unusable automation session with guidance', async () => {
  const login = new OfficialLogin({});
  let closed = false;
  login.phoneSession = {
    browserName: 'safari',
    verificationPurpose: 'sendSms',
    cancelled: false,
    disconnected: false,
    browser: {
      isConnected: () => true,
      close: async () => { closed = true; },
    },
    page: { isClosed: () => false },
  };

  await assert.rejects(
    login.completeSecurityVerification(),
    (error) => {
      assert.equal(error.code, 'SAFARI_VERIFICATION_UNSUPPORTED');
      assert.match(error.message, /Continue Session/);
      assert.match(error.message, /扫码登录/);
      return true;
    },
  );
  assert.equal(closed, true);
  assert.equal(login.phoneSession, undefined);
});

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

test('Safari QR login restores a visible official window without user interaction', async () => {
  const commands = [];
  let broughtToFront = false;
  await showBrowserWindow(
    {
      newCDPSession: async () => ({
        send: async (method, parameters) => {
          commands.push({ method, parameters });
          if (method === 'Browser.getWindowForTarget') return { windowId: 7 };
          return undefined;
        },
      }),
    },
    { bringToFront: async () => { broughtToFront = true; } },
    { left: 80, top: 80, width: 720, height: 820 },
  );

  assert.deepEqual(commands, [
    { method: 'Browser.getWindowForTarget', parameters: undefined },
    {
      method: 'Browser.setWindowBounds',
      parameters: { windowId: 7, bounds: { windowState: 'normal' } },
    },
    {
      method: 'Browser.setWindowBounds',
      parameters: {
        windowId: 7,
        bounds: { left: 80, top: 80, width: 720, height: 820 },
      },
    },
  ]);
  assert.equal(broughtToFront, true);
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

test('browser login preserves its real platform user agent after cookies settle', async () => {
  const events = [];
  let cookieRead = 0;
  const context = {
    cookies: async () => {
      cookieRead += 1;
      return [{
        name: cookieRead === 1 ? 'sessionid' : 'ttwid',
        value: String(cookieRead),
        domain: '.fanqienovel.com',
      }];
    },
  };
  const page = {
    evaluate: async () => 'Mozilla/5.0 (Macintosh) Safari/18.0',
  };
  const client = {
    validateCookie: async (cookie, options) => {
      events.push(['validate', cookie, options]);
    },
    saveCookie: async (cookie, options) => {
      events.push(['save', cookie, options]);
      return { id: 'account-1' };
    },
  };

  assert.equal(await getBrowserUserAgent(page), 'Mozilla/5.0 (Macintosh) Safari/18.0');
  const user = await saveBrowserSession(client, context, page, {
    cookieHeader: 'sessionid=1',
    delay: async () => {},
  });
  assert.equal(user.id, 'account-1');
  assert.deepEqual(events, [
    [
      'validate',
      'sessionid=1',
      { userAgent: 'Mozilla/5.0 (Macintosh) Safari/18.0' },
    ],
    [
      'save',
      'sessionid=1',
      { userAgent: 'Mozilla/5.0 (Macintosh) Safari/18.0' },
    ],
  ]);
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

test('findBrowserExecutable detects a per-user Chrome installation on macOS', () => {
  const expected = '/Users/demo/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const result = findBrowserExecutable({
    platform: 'darwin',
    env: { HOME: '/Users/demo' },
    existsSync: (candidate) => candidate === expected,
  });
  assert.equal(result, expected);
});

test('findBrowserExecutable accepts a macOS app bundle as the configured path', () => {
  const expected = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  const result = findBrowserExecutable({
    preferredPath: '/Applications/Microsoft Edge.app',
    platform: 'darwin',
    env: {},
    existsSync: (candidate) => candidate === expected,
  });
  assert.equal(result, expected);
});

test('findBrowserExecutable expands a configured home-relative path on macOS', () => {
  const expected = '/Users/demo/Applications/Chromium.app/Contents/MacOS/Chromium';
  const result = findBrowserExecutable({
    preferredPath: '~/Applications/Chromium.app',
    platform: 'darwin',
    env: { HOME: '/Users/demo' },
    existsSync: (candidate) => candidate === expected,
  });
  assert.equal(result, expected);
});

test('findBrowserExecutable falls back to the built-in Safari driver on macOS', () => {
  const expected = '/usr/bin/safaridriver';
  const result = findBrowserExecutable({
    platform: 'darwin',
    env: { HOME: '/Users/demo' },
    existsSync: (candidate) => candidate === expected,
  });
  assert.equal(result, expected);
  assert.equal(isSafariExecutable(result), true);
});

test('Safari is only advertised as a built-in browser on macOS', () => {
  assert.match(getBrowserNotFoundMessage('darwin'), /Safari、Chrome/);
  assert.doesNotMatch(getBrowserNotFoundMessage('linux'), /Safari/);
  assert.equal(
    isSafariExecutable(
      '/Applications/Safari Technology Preview.app/Contents/MacOS/Safari Technology Preview',
    ),
    true,
  );
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
