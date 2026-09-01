'use strict';

const { Browser, Builder } = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');
const { createWebDriverBrowser } = require('./safariBrowser');

async function launchFirefoxBrowser(options = {}) {
  const firefoxOptions = new firefox.Options();
  if (options.executablePath) {
    firefoxOptions.setBinary(options.executablePath);
  }
  firefoxOptions.setPreference('intl.accept_languages', 'zh-CN,zh,en-US,en');
  firefoxOptions.setPreference('browser.shell.checkDefaultBrowser', false);

  let driver;
  try {
    driver = await new Builder()
      .forBrowser(Browser.FIREFOX)
      .setFirefoxOptions(firefoxOptions)
      .disableEnvironmentOverrides()
      .build();
    await driver.manage().setTimeouts({
      implicit: 0,
      pageLoad: options.navigationTimeout || 45_000,
      script: options.scriptTimeout || 45_000,
    });
    await driver.manage().window().setRect({ width: 520, height: 820 }).catch(() => {});
    return createWebDriverBrowser(driver, undefined, 'firefox');
  } catch (error) {
    await driver?.quit().catch(() => {});
    throw enhanceFirefoxLaunchError(error);
  }
}

function enhanceFirefoxLaunchError(error) {
  const message = String(error?.message || error || '');
  if (
    /geckodriver|driver.*(?:not found|unavailable)|Unable to obtain (?:browser )?driver|Selenium Manager/i.test(
      message,
    )
  ) {
    const enhanced = new Error(
      'Firefox 自动化驱动不可用。扩展会优先使用 PATH 中的 geckodriver，否则由 Selenium Manager 自动下载；请检查网络后重试，或手动安装 geckodriver。',
    );
    enhanced.code = 'FIREFOX_DRIVER_UNAVAILABLE';
    return enhanced;
  }
  return error;
}

module.exports = { enhanceFirefoxLaunchError, launchFirefoxBrowser };
