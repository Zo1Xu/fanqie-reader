'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SAFARI_DRIVER,
  SAFARI_TECHNOLOGY_PREVIEW_DRIVER,
  enhanceSafariLaunchError,
  normalizeSafariDriverPath,
  toXPathLiteral,
} = require('../src/safariBrowser');

test('Safari app and driver paths resolve to the built-in safaridriver', () => {
  assert.equal(
    normalizeSafariDriverPath('/Applications/Safari.app/Contents/MacOS/Safari'),
    DEFAULT_SAFARI_DRIVER,
  );
  assert.equal(normalizeSafariDriverPath('/usr/bin/safaridriver'), DEFAULT_SAFARI_DRIVER);
});

test('Safari Technology Preview keeps its matching driver', () => {
  assert.equal(
    normalizeSafariDriverPath(
      '/Applications/Safari Technology Preview.app/Contents/MacOS/Safari Technology Preview',
    ),
    SAFARI_TECHNOLOGY_PREVIEW_DRIVER,
  );
});

test('Safari remote automation errors include actionable setup instructions', () => {
  const result = enhanceSafariLaunchError(
    new Error("Safari's Allow Remote Automation option is disabled"),
  );
  assert.equal(result.code, 'SAFARI_AUTOMATION_DISABLED');
  assert.match(result.message, /允许远程自动化/);
  assert.match(result.message, /safaridriver --enable/);
});

test('XPath string literals preserve mixed quote characters', () => {
  const result = toXPathLiteral(`番茄's "Safari"`);
  assert.equal(result, `concat('番茄', "'", 's "Safari"')`);
});
