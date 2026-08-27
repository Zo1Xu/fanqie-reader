'use strict';

const { Browser, Builder, By } = require('selenium-webdriver');
const safari = require('selenium-webdriver/safari');

const DEFAULT_SAFARI_DRIVER = '/usr/bin/safaridriver';
const SAFARI_TECHNOLOGY_PREVIEW_DRIVER =
  '/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver';

async function launchSafariBrowser(options = {}) {
  const executablePath = normalizeSafariDriverPath(options.executablePath);
  const safariOptions = new safari.Options();
  if (executablePath === SAFARI_TECHNOLOGY_PREVIEW_DRIVER) {
    safariOptions.setTechnologyPreview(true);
  }

  const service = new safari.ServiceBuilder(executablePath).build();
  let driver;
  try {
    const serverUrl = await service.start();
    driver = await new Builder()
      .forBrowser(Browser.SAFARI)
      .setSafariOptions(safariOptions)
      .usingServer(serverUrl)
      .disableEnvironmentOverrides()
      .build();
    await driver.manage().setTimeouts({
      implicit: 0,
      pageLoad: options.navigationTimeout || 45_000,
      script: options.scriptTimeout || 45_000,
    });
    return new SafariBrowser(driver, service);
  } catch (error) {
    await driver?.quit().catch(() => {});
    await service.kill().catch(() => {});
    throw enhanceSafariLaunchError(error);
  }
}

class SafariBrowser {
  constructor(driver, service) {
    this.driver = driver;
    this.service = service;
    this.browserName = 'safari';
    this.connected = true;
    this.listeners = new Set();
    this.context = new SafariContext(this, driver);
  }

  async newContext() {
    return this.context;
  }

  isConnected() {
    return this.connected;
  }

  on(event, listener) {
    if (event === 'disconnected' && typeof listener === 'function') {
      this.listeners.add(listener);
    }
  }

  async close() {
    if (!this.connected) return;
    this.connected = false;
    await this.driver.quit().catch(() => {});
    await this.service.kill().catch(() => {});
    for (const listener of this.listeners) {
      listener();
    }
    this.listeners.clear();
  }
}

class SafariContext {
  constructor(browser, driver) {
    this.browser = browser;
    this.driver = driver;
    this.page = new SafariPage(browser, driver);
  }

  async newPage() {
    return this.page;
  }

  async cookies() {
    return this.driver.manage().getCookies();
  }

  async newCDPSession() {
    return new SafariWindowSession(this.driver);
  }
}

class SafariWindowSession {
  constructor(driver) {
    this.driver = driver;
  }

  async send(method, parameters = {}) {
    if (method === 'Browser.getWindowForTarget') {
      return { windowId: 1 };
    }
    if (method !== 'Browser.setWindowBounds') return undefined;

    const bounds = parameters.bounds || {};
    const window = this.driver.manage().window();
    if (bounds.windowState === 'minimized') {
      await window.minimize();
      return undefined;
    }
    if (bounds.windowState === 'normal' && bounds.width === undefined) {
      await window.maximize();
      return undefined;
    }
    await window.setRect({
      x: bounds.left,
      y: bounds.top,
      width: bounds.width,
      height: bounds.height,
    });
    return undefined;
  }
}

class SafariPage {
  constructor(browser, driver) {
    this.browser = browser;
    this.driver = driver;
  }

  async goto(url, options = {}) {
    if (options.timeout) {
      await this.driver.manage().setTimeouts({ pageLoad: options.timeout });
    }
    await this.driver.get(url);
  }

  async bringToFront() {
    const handle = await this.driver.getWindowHandle();
    await this.driver.switchTo().window(handle);
    await this.driver.executeScript(() => window.focus()).catch(() => {});
  }

  async evaluate(callback, argument) {
    const args = argument === undefined ? [] : [argument];
    return this.driver.executeScript(callback, ...args);
  }

  isClosed() {
    return !this.browser.isConnected();
  }

  frames() {
    return [this];
  }

  locator(selector) {
    return new SafariLocator(this.driver, By.css(selector));
  }

  getByText(text, options = {}) {
    const literal = toXPathLiteral(String(text));
    const comparison = options.exact
      ? `normalize-space(.) = ${literal}`
      : `contains(normalize-space(.), ${literal})`;
    return new SafariLocator(
      this.driver,
      By.xpath(`//*[${comparison} and not(.//*[${comparison}])]`),
    );
  }

  getByPlaceholder(text, options = {}) {
    const literal = toXPathLiteral(String(text));
    const comparison = options.exact
      ? `@placeholder = ${literal}`
      : `contains(@placeholder, ${literal})`;
    return new SafariLocator(this.driver, By.xpath(`//*[${comparison}]`));
  }

  getByRole(role, options = {}) {
    const literal = toXPathLiteral(String(options.name || ''));
    const semanticRole = role === 'button'
      ? `(self::button or @role = 'button' or self::input[@type = 'button' or @type = 'submit'])`
      : `@role = ${toXPathLiteral(String(role))}`;
    const nameComparison = options.exact
      ? `normalize-space(.) = ${literal}`
      : `contains(normalize-space(.), ${literal})`;
    return new SafariLocator(
      this.driver,
      By.xpath(`//*[${semanticRole} and ${nameComparison}]`),
    );
  }

  async waitForFunction(callback, argument, options = {}) {
    const timeout = options.timeout || 30_000;
    const args = argument === undefined ? [] : [argument];
    await this.driver.wait(
      () => this.driver.executeScript(callback, ...args),
      timeout,
      '等待 Safari 页面状态超时',
      200,
    );
  }
}

class SafariLocator {
  constructor(driver, by, index = undefined) {
    this.driver = driver;
    this.by = by;
    this.index = index;
  }

  first() {
    return this.nth(0);
  }

  nth(index) {
    return new SafariLocator(this.driver, this.by, index);
  }

  async waitFor(options = {}) {
    const timeout = options.timeout || 30_000;
    const visible = options.state === 'visible';
    await this.driver.wait(async () => {
      const element = await this.#find();
      if (!element) return false;
      return visible ? element.isDisplayed().catch(() => false) : true;
    }, timeout, '等待 Safari 页面元素超时', 200);
  }

  async evaluate(callback) {
    const element = await this.#requireElement();
    return this.driver.executeScript(callback, element);
  }

  async getAttribute(name) {
    const element = await this.#requireElement();
    return element.getAttribute(name);
  }

  async fill(value) {
    const element = await this.#requireElement();
    await element.clear();
    await element.sendKeys(String(value));
  }

  async isVisible() {
    const element = await this.#find();
    return element ? element.isDisplayed().catch(() => false) : false;
  }

  async isChecked() {
    const element = await this.#requireElement();
    return element.isSelected();
  }

  async innerText(options = {}) {
    if (options.timeout) {
      await this.waitFor({ state: 'attached', timeout: options.timeout });
    }
    const element = await this.#requireElement();
    return element.getText();
  }

  async count() {
    const elements = await this.driver.findElements(this.by);
    return elements.length;
  }

  async #find() {
    const elements = await this.driver.findElements(this.by);
    const index = this.index ?? 0;
    return elements[index];
  }

  async #requireElement() {
    const element = await this.#find();
    if (!element) {
      throw new Error('Safari 页面中未找到目标元素。');
    }
    return element;
  }
}

function normalizeSafariDriverPath(executablePath) {
  const value = String(executablePath || '');
  if (
    /Safari Technology Preview\.app\/Contents\/MacOS\/(?:Safari Technology Preview|safaridriver)$/.test(
      value,
    )
  ) {
    return SAFARI_TECHNOLOGY_PREVIEW_DRIVER;
  }
  return DEFAULT_SAFARI_DRIVER;
}

function enhanceSafariLaunchError(error) {
  const message = String(error?.message || error || '');
  if (/Allow Remote Automation|remote automation.*(?:disabled|not enabled)|safaridriver --enable/i.test(message)) {
    const enhanced = new Error(
      'Safari 尚未允许远程自动化。请打开 Safari → 设置 → 高级，启用“在菜单栏中显示开发菜单”，再在“开发”菜单中启用“允许远程自动化”；也可在终端运行 safaridriver --enable。',
    );
    enhanced.code = 'SAFARI_AUTOMATION_DISABLED';
    return enhanced;
  }
  if (/already paired|already.*WebDriver session|session.*already (?:exists|active)/i.test(message)) {
    const enhanced = new Error('Safari 已被其他自动化会话占用，请关闭该会话后重试。');
    enhanced.code = 'SAFARI_SESSION_BUSY';
    return enhanced;
  }
  return error;
}

function toXPathLiteral(value) {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value
    .split("'")
    .map((part) => `'${part}'`)
    .join(', "\'", ')})`;
}

module.exports = {
  DEFAULT_SAFARI_DRIVER,
  SAFARI_TECHNOLOGY_PREVIEW_DRIVER,
  enhanceSafariLaunchError,
  launchSafariBrowser,
  normalizeSafariDriverPath,
  toXPathLiteral,
};
