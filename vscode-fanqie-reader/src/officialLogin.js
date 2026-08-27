'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE_URL = 'https://fanqienovel.com';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const LOGIN_NAVIGATION_TIMEOUT_MS = 45 * 1000;
const LOGIN_UI_TIMEOUT_MS = 45 * 1000;
const PHONE_ACTION_TIMEOUT_MS = 15 * 1000;
const PHONE_LOGIN_TIMEOUT_MS = 45 * 1000;
const VERIFICATION_TIMEOUT_MS = 3 * 60 * 1000;
const LOGIN_COOKIE_NAMES = new Set([
  'sessionid',
  'sessionid_ss',
  'sid_tt',
  'sid_guard',
  'sid_ucp_v1',
  'ssid_ucp_v1',
]);

class OfficialLoginError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'OfficialLoginError';
    this.code = code;
  }
}

class OfficialLogin {
  constructor(client) {
    this.client = client;
    this.phoneSession = undefined;
  }

  async sendSms(phone, options = {}) {
    const normalizedPhone = normalizePhone(phone);
    if (!isValidPhone(normalizedPhone)) {
      throw new OfficialLoginError('请输入正确的 11 位中国大陆手机号。', 'INVALID_PHONE');
    }
    if (!options.agreed) {
      throw new OfficialLoginError('请先阅读并同意用户协议和隐私政策。', 'TERMS_REQUIRED');
    }

    const session = await this.#getPhoneSession(options);
    try {
      options.onStatus?.('正在通过番茄官方页面发送验证码…');
      await this.#preparePhoneForm(session, normalizedPhone);
      session.phone = normalizedPhone;
      session.verificationPurpose = 'sendSms';
      await clickElement(session.page.getByText('获取验证码', { exact: true }));

      const state = await waitForPhonePageState(session.page, {
        purpose: 'sendSms',
        timeout: PHONE_ACTION_TIMEOUT_MS,
      });
      if (state.status === 'verification_required') {
        if (session.browserName === 'safari') {
          return this.completeSecurityVerification(options);
        }
        options.onStatus?.('需要完成番茄官方安全验证');
        return {
          status: 'verification_required',
          phone: maskPhone(normalizedPhone),
          browser: session.browserName,
        };
      }
      if (state.status === 'error') {
        throw new OfficialLoginError(state.message, 'SMS_SEND_FAILED');
      }
      if (state.status !== 'sms_sent') {
        throw new OfficialLoginError(
          '番茄官方页面未确认验证码已发送，请稍后重试。',
          'SMS_SEND_UNCONFIRMED',
        );
      }

      session.verificationPurpose = undefined;
      await this.#setPhoneWindowVisible(session, false);
      options.onStatus?.(`验证码已发送至 ${maskPhone(normalizedPhone)}`);
      return { status: 'sms_sent', phone: maskPhone(normalizedPhone) };
    } catch (error) {
      throw normalizeLoginError(error, '无法发送验证码');
    }
  }

  async submitSmsCode(code, options = {}) {
    const normalizedCode = String(code || '').trim();
    if (!isValidSmsCode(normalizedCode)) {
      throw new OfficialLoginError('请输入短信中的 4 位验证码。', 'INVALID_SMS_CODE');
    }
    const session = this.#requirePhoneSession();

    try {
      options.onStatus?.('正在由番茄官方页面验证登录…');
      const codeInput = session.page.getByPlaceholder('请输入验证码', { exact: true });
      await codeInput.fill(normalizedCode);
      await this.#acceptTerms(session.page);
      session.verificationPurpose = 'submitCode';
      await clickElement(
        session.page.getByRole('button', { name: '登录/注册', exact: true }),
      );

      const result = await this.#waitForPhoneLogin(session, {
        timeout: PHONE_LOGIN_TIMEOUT_MS,
      });
      if (result.status === 'verification_required') {
        if (session.browserName === 'safari') {
          return this.completeSecurityVerification(options);
        }
        options.onStatus?.('需要完成番茄官方安全验证');
        return { status: 'verification_required', browser: session.browserName };
      }
      if (result.status === 'error') {
        throw new OfficialLoginError(result.message, 'SMS_LOGIN_FAILED');
      }

      session.verificationPurpose = undefined;
      options.onStatus?.('登录成功');
      return { status: 'logged_in', user: result.user };
    } catch (error) {
      throw normalizeLoginError(error, '验证码登录失败');
    }
  }

  async completeSecurityVerification(options = {}) {
    const session = this.#requirePhoneSession();
    const purpose = session.verificationPurpose;
    if (!purpose) {
      throw new OfficialLoginError('当前没有待完成的安全验证。', 'VERIFICATION_NOT_REQUIRED');
    }

    await this.#setPhoneWindowVisible(session, true);
    options.onStatus?.(
      session.browserName === 'safari'
        ? '请在 Safari 中手动完成滑块验证，完成后无需关闭窗口'
        : '请在番茄官方小窗口中手动完成滑块验证',
    );
    const deadline = Date.now() + VERIFICATION_TIMEOUT_MS;
    let verificationSeen = false;

    while (Date.now() < deadline) {
      this.#assertPhoneSession(session);
      const state = await inspectPhonePage(session.page);
      if (state.status === 'verification_required') {
        verificationSeen = true;
        await delay(500);
        continue;
      }
      if (state.status === 'error') {
        throw new OfficialLoginError(state.message, 'VERIFICATION_FAILED');
      }

      if (purpose === 'sendSms' && state.status === 'sms_sent') {
        session.verificationPurpose = undefined;
        await this.#setPhoneWindowVisible(session, false);
        options.onStatus?.(`验证码已发送至 ${maskPhone(session.phone)}`);
        return { status: 'sms_sent', phone: maskPhone(session.phone) };
      }

      if (purpose === 'submitCode') {
        const login = await this.#tryCompletePhoneLogin(session);
        if (login) {
          session.verificationPurpose = undefined;
          options.onStatus?.('登录成功');
          return { status: 'logged_in', user: login };
        }
      }

      if (verificationSeen) {
        options.onStatus?.('安全验证已完成，正在等待番茄确认…');
      }
      await delay(500);
    }

    throw new OfficialLoginError('安全验证等待超时，请重新尝试。', 'VERIFICATION_TIMEOUT');
  }

  async cancelPhoneLogin() {
    const session = this.phoneSession;
    this.phoneSession = undefined;
    if (!session) {
      return;
    }
    session.cancelled = true;
    if (session.browser?.isConnected()) {
      await session.browser.close().catch(() => {});
    }
  }

  async login(options = {}) {
    await this.cancelPhoneLogin();
    const executablePath = findBrowserExecutable({ preferredPath: options.browserPath });
    if (!executablePath) {
      throw new OfficialLoginError(
        getBrowserNotFoundMessage(),
        'BROWSER_NOT_FOUND',
      );
    }

    let browser;
    let disconnected = false;
    try {
      options.onStatus?.('正在打开番茄官方登录页…');
      browser = await launchLoginBrowser(executablePath, {
        headless: false,
        args: ['--window-size=520,820'],
      });
      browser.on('disconnected', () => {
        disconnected = true;
      });
      const context = await browser.newContext({
        locale: 'zh-CN',
        viewport: { width: 500, height: 760 },
      });
      const page = await context.newPage();
      await navigateToLoginPage(page);
      if (browser.browserName === 'safari') {
        await clickElement(
          page.getByText('扫码登录', { exact: true }).first(),
          LOGIN_UI_TIMEOUT_MS,
        );
      }
      await page.bringToFront();
      options.onStatus?.(
        browser.browserName === 'safari'
          ? '请使用番茄小说 App 扫描 Safari 中的二维码'
          : '请在浏览器中使用手机验证码或番茄 App 扫码登录',
      );

      const deadline = Date.now() + LOGIN_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (options.cancellationToken?.isCancellationRequested) {
          throw new OfficialLoginError('已取消登录。', 'LOGIN_CANCELLED');
        }
        if (disconnected) {
          throw new OfficialLoginError('登录窗口已关闭。', 'LOGIN_WINDOW_CLOSED');
        }

        const cookies = await context.cookies(BASE_URL);
        if (cookies.some((cookie) => LOGIN_COOKIE_NAMES.has(cookie.name))) {
          const cookieHeader = serializeCookies(cookies);
          try {
            const user = await this.client.saveCookie(cookieHeader);
            return user;
          } catch (error) {
            if (!['NOT_LOGGED_IN', 'API_ERROR'].includes(error.code)) {
              throw error;
            }
          }
        }
        await delay(1_000);
      }
      throw new OfficialLoginError('登录等待超时，请重新尝试。', 'LOGIN_TIMEOUT');
    } catch (error) {
      if (error instanceof OfficialLoginError) {
        throw error;
      }
      throw normalizeLoginError(error, '无法完成官方登录');
    } finally {
      if (browser?.isConnected()) {
        await browser.close().catch(() => {});
      }
    }
  }

  async loginWithQr(options = {}) {
    await this.cancelPhoneLogin();
    const executablePath = findBrowserExecutable({ preferredPath: options.browserPath });
    if (!executablePath) {
      throw new OfficialLoginError(
        getBrowserNotFoundMessage(),
        'BROWSER_NOT_FOUND',
      );
    }

    let browser;
    let disconnected = false;
    try {
      options.onStatus?.('正在创建番茄小说官方账号会话…');
      browser = await launchLoginBrowser(
        executablePath,
        getBackgroundBrowserLaunchOptions(executablePath),
      );
      browser.on('disconnected', () => {
        disconnected = true;
      });
      const context = await browser.newContext({
        locale: 'zh-CN',
        viewport: { width: 480, height: 760 },
      });
      const page = await context.newPage();
      await hideBrowserWindow(context, page);
      let qrCreatedAt = 0;
      let lastQrCode = '';

      const loadQrCode = async () => {
        await navigateToLoginPage(page);
        await clickElement(
          page.getByText('扫码登录', { exact: true }).first(),
          LOGIN_UI_TIMEOUT_MS,
        );
        const qrImage = page
          .locator(
            '.slogin-qrcode-scan-page img, img[class*="qrcode"], img[alt*="二维码"]',
          )
          .first();
        await qrImage.waitFor({ state: 'visible', timeout: LOGIN_UI_TIMEOUT_MS });
        await page.waitForFunction(
          () => {
            const image = document.querySelector(
              '.slogin-qrcode-scan-page img, img[class*="qrcode"], img[alt*="二维码"]',
            );
            return image?.src?.startsWith('data:image/');
          },
          undefined,
          { timeout: LOGIN_UI_TIMEOUT_MS },
        );
        const source = await qrImage.evaluate((image) => image.src);
        if (!source?.startsWith('data:image/')) {
          throw new OfficialLoginError('官方登录页没有返回可显示的二维码。', 'QR_NOT_FOUND');
        }
        qrCreatedAt = Date.now();
        if (source !== lastQrCode) {
          lastQrCode = source;
          options.onQrCode?.(source);
        }
        options.onStatus?.('请使用番茄小说 App 扫码');
      };

      await loadQrCode();
      const deadline = Date.now() + LOGIN_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (options.cancellationToken?.isCancellationRequested) {
          throw new OfficialLoginError('已取消登录。', 'LOGIN_CANCELLED');
        }
        if (disconnected) {
          throw new OfficialLoginError('扫码会话意外关闭。', 'LOGIN_WINDOW_CLOSED');
        }

        const cookies = await context.cookies(BASE_URL);
        if (cookies.some((cookie) => LOGIN_COOKIE_NAMES.has(cookie.name))) {
          const cookieHeader = serializeCookies(cookies);
          try {
            const user = await this.client.saveCookie(cookieHeader);
            options.onStatus?.('登录成功');
            return user;
          } catch (error) {
            if (!['NOT_LOGGED_IN', 'API_ERROR'].includes(error.code)) {
              throw error;
            }
          }
        }

        if (Date.now() - qrCreatedAt >= 100_000) {
          options.onStatus?.('二维码已刷新，请重新扫码');
          await loadQrCode();
        } else {
          const currentSource = await page
            .locator(
              '.slogin-qrcode-scan-page img, img[class*="qrcode"], img[alt*="二维码"]',
            )
            .first()
            .getAttribute('src')
            .catch(() => '');
          if (currentSource?.startsWith('data:image/') && currentSource !== lastQrCode) {
            lastQrCode = currentSource;
            qrCreatedAt = Date.now();
            options.onQrCode?.(currentSource);
          }
        }
        await delay(1_000);
      }
      throw new OfficialLoginError('扫码登录已超时，请重新生成二维码。', 'LOGIN_TIMEOUT');
    } catch (error) {
      if (error instanceof OfficialLoginError) {
        throw error;
      }
      throw normalizeLoginError(error, '无法创建扫码登录');
    } finally {
      if (browser?.isConnected()) {
        await browser.close().catch(() => {});
      }
    }
  }

  async #getPhoneSession(options) {
    if (
      this.phoneSession &&
      !this.phoneSession.cancelled &&
      this.phoneSession.browser?.isConnected() &&
      !this.phoneSession.page?.isClosed()
    ) {
      return this.phoneSession;
    }

    const executablePath = findBrowserExecutable({ preferredPath: options.browserPath });
    if (!executablePath) {
      throw new OfficialLoginError(
        getBrowserNotFoundMessage(),
        'BROWSER_NOT_FOUND',
      );
    }

    let browser;
    try {
      options.onStatus?.('正在后台创建番茄官方登录环境…');
      browser = await launchLoginBrowser(executablePath, {
        headless: false,
        args: ['--start-minimized', '--window-size=520,820'],
      });
      const context = await browser.newContext({
        locale: 'zh-CN',
        viewport: { width: 500, height: 760 },
      });
      const page = await context.newPage();
      const session = {
        browser,
        context,
        page,
        cancelled: false,
        disconnected: false,
        verificationPurpose: undefined,
        phone: '',
        browserName: browser.browserName || 'chromium',
        cdp: undefined,
        windowId: undefined,
      };
      this.phoneSession = session;
      browser.on('disconnected', () => {
        session.disconnected = true;
        if (this.phoneSession === session) {
          this.phoneSession = undefined;
        }
      });

      const cdp = await context.newCDPSession(page).catch(() => undefined);
      if (cdp) {
        session.cdp = cdp;
        const windowInfo = await cdp.send('Browser.getWindowForTarget').catch(() => undefined);
        session.windowId = windowInfo?.windowId;
      }
      await this.#setPhoneWindowVisible(session, false);
      await navigateToLoginPage(page);
      await page.getByText('验证码登录', { exact: true }).waitFor({
        state: 'visible',
        timeout: LOGIN_UI_TIMEOUT_MS,
      });
      return session;
    } catch (error) {
      this.phoneSession = undefined;
      if (browser?.isConnected()) {
        await browser.close().catch(() => {});
      }
      throw normalizeLoginError(error, '无法创建手机号登录环境');
    }
  }

  async #preparePhoneForm(session, phone) {
    this.#assertPhoneSession(session);
    const phoneTab = session.page.getByText('验证码登录', { exact: true });
    if (await phoneTab.isVisible().catch(() => false)) {
      await clickElement(phoneTab);
    }
    await session.page.getByPlaceholder('手机号', { exact: true }).fill(phone);
    await this.#acceptTerms(session.page);
  }

  async #acceptTerms(page) {
    const checkbox = page.locator('input[type="checkbox"]').first();
    if (!(await checkbox.isChecked())) {
      await clickElement(checkbox);
    }
  }

  async #waitForPhoneLogin(session, options = {}) {
    const deadline = Date.now() + (options.timeout || PHONE_LOGIN_TIMEOUT_MS);
    while (Date.now() < deadline) {
      this.#assertPhoneSession(session);
      const user = await this.#tryCompletePhoneLogin(session);
      if (user) {
        return { status: 'logged_in', user };
      }
      const state = await inspectPhonePage(session.page);
      if (state.status === 'verification_required' || state.status === 'error') {
        return state;
      }
      await delay(500);
    }
    throw new OfficialLoginError('番茄官方页面登录确认超时，请重新尝试。', 'PHONE_LOGIN_TIMEOUT');
  }

  async #tryCompletePhoneLogin(session) {
    const cookies = await session.context.cookies(BASE_URL);
    if (!cookies.some((cookie) => LOGIN_COOKIE_NAMES.has(cookie.name))) {
      return undefined;
    }
    try {
      const user = await this.client.saveCookie(serializeCookies(cookies));
      await this.cancelPhoneLogin();
      return user;
    } catch (error) {
      if (['NOT_LOGGED_IN', 'API_ERROR'].includes(error.code)) {
        return undefined;
      }
      throw error;
    }
  }

  async #setPhoneWindowVisible(session, visible) {
    if (session.windowId !== undefined && session.cdp) {
      if (visible) {
        await session.cdp.send('Browser.setWindowBounds', {
          windowId: session.windowId,
          bounds: { windowState: 'normal' },
        }).catch(() => {});
        await session.cdp.send('Browser.setWindowBounds', {
          windowId: session.windowId,
          bounds: getVerificationWindowBounds(session.browserName),
        }).catch(() => {});
      } else {
        await session.cdp.send('Browser.setWindowBounds', {
          windowId: session.windowId,
          bounds: { windowState: 'minimized' },
        }).catch(() => {});
      }
    }
    if (visible) {
      await session.page.bringToFront().catch(() => {});
    }
  }

  #requirePhoneSession() {
    const session = this.phoneSession;
    this.#assertPhoneSession(session);
    return session;
  }

  #assertPhoneSession(session) {
    if (
      !session ||
      session.cancelled ||
      session.disconnected ||
      !session.browser?.isConnected() ||
      session.page?.isClosed()
    ) {
      throw new OfficialLoginError('手机号登录会话已关闭，请重新获取验证码。', 'PHONE_SESSION_CLOSED');
    }
  }
}

async function waitForPhonePageState(page, options = {}) {
  const deadline = Date.now() + (options.timeout || PHONE_ACTION_TIMEOUT_MS);
  while (Date.now() < deadline) {
    const state = await inspectPhonePage(page);
    if (
      state.status === 'verification_required' ||
      state.status === 'error' ||
      (options.purpose === 'sendSms' && state.status === 'sms_sent')
    ) {
      return state;
    }
    await delay(250);
  }
  return { status: 'waiting' };
}

async function inspectPhonePage(page) {
  const texts = [];
  for (const frame of page.frames()) {
    const text = await frame.locator('body').innerText({ timeout: 1_000 }).catch(() => '');
    if (text) {
      texts.push(text);
    }
  }
  const combinedText = texts.join('\n');
  if (classifyPhonePageText(combinedText) === 'verification_required') {
    return { status: 'verification_required' };
  }

  for (const frame of page.frames()) {
    const verification = frame.locator(
      'iframe[src*="captcha"], iframe[src*="verify"], [class*="captcha"], [id*="captcha"]',
    );
    const count = await verification.count().catch(() => 0);
    for (let index = 0; index < Math.min(count, 6); index += 1) {
      if (await verification.nth(index).isVisible().catch(() => false)) {
        return { status: 'verification_required' };
      }
    }
  }

  const messageSelectors = [
    '.arco-message-content',
    '.arco-form-message',
    '.slogin-form-error',
    '[role="alert"]',
    '[class*="error-message"]',
  ];
  const messages = [];
  for (const selector of messageSelectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < Math.min(count, 8); index += 1) {
      const item = locator.nth(index);
      if (await item.isVisible().catch(() => false)) {
        const message = String(await item.innerText().catch(() => '')).trim();
        if (message) {
          messages.push(message);
        }
      }
    }
  }
  const errorMessage = messages.find((message) =>
    /错误|失败|无效|不正确|过期|频繁|稍后(?:再试|重试)|请输入.*(?:手机号|验证码)/.test(message),
  );
  if (errorMessage) {
    return { status: 'error', message: errorMessage };
  }

  if (classifyPhonePageText(combinedText) === 'sms_sent') {
    return { status: 'sms_sent' };
  }
  return { status: 'waiting' };
}

function classifyPhonePageText(text) {
  const value = String(text || '');
  if (/请完成下列验证后继续|拖动.*(?:拼图|滑块)|安全验证|完成验证/.test(value)) {
    return 'verification_required';
  }
  if (/验证码(?:已|发送)成功|验证码已发送|\d{1,3}\s*(?:秒|s)后.*(?:重试|重新|获取)|重新获取验证码/.test(value)) {
    return 'sms_sent';
  }
  return 'waiting';
}

function normalizePhone(phone) {
  return String(phone || '')
    .trim()
    .replace(/[\s-]/g, '')
    .replace(/^\+?86/, '');
}

function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(normalizePhone(phone));
}

function isValidSmsCode(code) {
  return /^\d{4}$/.test(String(code || '').trim());
}

function maskPhone(phone) {
  const normalized = normalizePhone(phone);
  return isValidPhone(normalized)
    ? `${normalized.slice(0, 3)}****${normalized.slice(-4)}`
    : '';
}

function normalizeLoginError(error, prefix) {
  if (error instanceof OfficialLoginError) {
    return error;
  }
  if (error?.code === 'SAFARI_AUTOMATION_DISABLED' || error?.code === 'SAFARI_SESSION_BUSY') {
    return new OfficialLoginError(error.message, error.code);
  }
  return new OfficialLoginError(
    `${prefix}：${cleanAutomationMessage(error)}`,
    'LOGIN_FAILED',
  );
}

async function clickElement(locator, timeout = PHONE_ACTION_TIMEOUT_MS) {
  await locator.waitFor({ state: 'attached', timeout });
  await locator.evaluate((element) => element.click());
}

async function navigateToLoginPage(page, options = {}) {
  const timeout = options.timeout || LOGIN_NAVIGATION_TIMEOUT_MS;
  const url = options.url || buildLoginUrl();
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'commit', timeout });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 0 && isRetryableNavigationError(error)) {
        await (options.delay || delay)(options.retryDelay ?? 750);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function isRetryableNavigationError(error) {
  return /Timeout|ERR_(?:SSL|CONNECTION|NETWORK|TIMED_OUT|HTTP2)/i.test(
    String(error?.message || ''),
  );
}

function getBackgroundBrowserLaunchOptions(executablePath) {
  return {
    executablePath,
    headless: false,
    args: [
      '--window-position=-10000,-10000',
      '--window-size=520,820',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  };
}

function getVerificationWindowBounds(browserName) {
  return browserName === 'safari'
    ? { left: 100, top: 80, width: 900, height: 800 }
    : { left: 80, top: 80, width: 520, height: 820 };
}

async function launchLoginBrowser(executablePath, options = {}) {
  if (isSafariExecutable(executablePath)) {
    const { launchSafariBrowser } = require('./safariBrowser');
    return launchSafariBrowser({
      executablePath,
      navigationTimeout: LOGIN_NAVIGATION_TIMEOUT_MS,
      scriptTimeout: LOGIN_UI_TIMEOUT_MS,
    });
  }
  return chromium.launch({ ...options, executablePath });
}

function isSafariExecutable(executablePath) {
  return /(?:^|[\\/])(?:safaridriver|Safari(?: Technology Preview)?)$/i.test(
    String(executablePath || ''),
  );
}

function getBrowserNotFoundMessage(platform = process.platform) {
  return platform === 'darwin'
    ? '未找到 Safari、Chrome、Edge 或 Chromium。请确认 Safari 可用，或在设置中填写 fanqieReader.browserPath。'
    : '未找到 Chrome、Edge 或 Chromium。请安装其中一个浏览器，或在设置中填写 fanqieReader.browserPath。';
}

async function hideBrowserWindow(context, page) {
  const cdp = await context.newCDPSession(page).catch(() => undefined);
  if (!cdp) {
    return;
  }
  const windowInfo = await cdp
    .send('Browser.getWindowForTarget')
    .catch(() => undefined);
  if (windowInfo?.windowId === undefined) {
    return;
  }
  await cdp
    .send('Browser.setWindowBounds', {
      windowId: windowInfo.windowId,
      bounds: {
        windowState: 'normal',
        left: -10000,
        top: -10000,
        width: 520,
        height: 820,
      },
    })
    .catch(() => {});
}

function cleanAutomationMessage(error) {
  const message = String(error?.message || '未知错误')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split(/\nCall log:/i)[0]
    .replace(/\s+/g, ' ')
    .trim();
  return message.length > 180 ? `${message.slice(0, 177)}…` : message;
}

function buildLoginUrl() {
  const loginData = encodeURIComponent(
    JSON.stringify({
      needRedirect: true,
      redirectURLs: { login: `${BASE_URL}/bookshelf` },
    }),
  );
  return `${BASE_URL}/main/writer/login?_login_data=${loginData}`;
}

function serializeCookies(cookies) {
  const values = new Map();
  for (const cookie of cookies || []) {
    const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
    if (
      cookie.name &&
      (domain === 'fanqienovel.com' || domain.endsWith('.fanqienovel.com'))
    ) {
      values.set(cookie.name, cookie.value);
    }
  }
  return [...values]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function findBrowserExecutable(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const existsSync = options.existsSync || fs.existsSync;
  const preferredPath = String(
    options.preferredPath || env.FANQIE_READER_BROWSER || env.CHROME_PATH || '',
  ).trim();
  const candidates = getPreferredBrowserCandidates(preferredPath, platform, env);

  if (platform === 'win32') {
    const joinWindowsPath = path.win32.join;
    for (const root of [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)']]) {
      if (!root) continue;
      candidates.push(
        joinWindowsPath(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        joinWindowsPath(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        joinWindowsPath(root, 'Chromium', 'Application', 'chrome.exe'),
      );
    }
  } else if (platform === 'darwin') {
    const applicationRoots = ['/Applications'];
    if (env.HOME) {
      applicationRoots.push(path.posix.join(env.HOME, 'Applications'));
    }
    const browserAppNames = [
      'Google Chrome',
      'Google Chrome Beta',
      'Google Chrome Dev',
      'Google Chrome Canary',
      'Microsoft Edge',
      'Microsoft Edge Beta',
      'Microsoft Edge Dev',
      'Microsoft Edge Canary',
      'Chromium',
    ];
    for (const root of applicationRoots) {
      for (const appName of browserAppNames) {
        candidates.push(
          path.posix.join(root, `${appName}.app`, 'Contents', 'MacOS', appName),
        );
      }
    }
    candidates.push(
      '/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver',
      '/usr/bin/safaridriver',
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    );
  }
  return [...new Set(candidates)].find((candidate) => candidate && existsSync(candidate));
}

function getPreferredBrowserCandidates(preferredPath, platform, env) {
  if (!preferredPath) return [];
  if (platform !== 'darwin') return [preferredPath];

  let normalizedPath = preferredPath;
  if (env.HOME && (normalizedPath === '~' || normalizedPath.startsWith('~/'))) {
    normalizedPath = path.posix.join(env.HOME, normalizedPath.slice(2));
  }

  normalizedPath = normalizedPath.replace(/\/+$/, '');
  if (!normalizedPath.toLowerCase().endsWith('.app')) return [normalizedPath];

  const appName = path.posix.basename(normalizedPath, '.app');
  return [path.posix.join(normalizedPath, 'Contents', 'MacOS', appName)];
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

module.exports = {
  OfficialLogin,
  OfficialLoginError,
  buildLoginUrl,
  classifyPhonePageText,
  cleanAutomationMessage,
  clickElement,
  findBrowserExecutable,
  getBackgroundBrowserLaunchOptions,
  getBrowserNotFoundMessage,
  getVerificationWindowBounds,
  isSafariExecutable,
  isValidPhone,
  isValidSmsCode,
  maskPhone,
  navigateToLoginPage,
  normalizePhone,
  serializeCookies,
};
