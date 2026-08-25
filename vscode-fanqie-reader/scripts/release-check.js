'use strict';

const fs = require('fs');
const path = require('path');

const extensionRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(extensionRoot, '..');
const packagePath = path.join(extensionRoot, 'package.json');
const lockPath = path.join(extensionRoot, 'package-lock.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const errors = [];

function failWhen(condition, message) {
  if (condition) {
    errors.push(message);
  }
}

function containsPlaceholder(value) {
  return typeof value !== 'string' || /YOUR_|example\.com|github\.com\/OWNER\//i.test(value);
}

failWhen(!/^[a-z0-9][a-z0-9-]*$/i.test(pkg.publisher || ''), 'publisher 格式无效。');
failWhen(!pkg.publisher || pkg.publisher === 'local' || /^YOUR_/i.test(pkg.publisher), '请把 publisher 从 local/占位符替换为真实 Marketplace Publisher ID。');
failWhen(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version || ''), 'package.json version 不是有效的 SemVer。');
failWhen(pkg.license !== 'AGPL-3.0-only', 'package.json license 必须是 AGPL-3.0-only。');
failWhen(lock.version !== pkg.version, 'package-lock.json 顶层版本与 package.json 不一致。');
failWhen(lock.packages?.['']?.version !== pkg.version, 'package-lock.json 根包版本与 package.json 不一致。');

const repositoryUrl = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
failWhen(containsPlaceholder(repositoryUrl), 'repository.url 仍是占位符或缺失。');
failWhen(containsPlaceholder(pkg.homepage), 'homepage 仍是占位符或缺失。');
failWhen(containsPlaceholder(pkg.bugs?.url), 'bugs.url 仍是占位符或缺失。');

for (const file of ['README.md', 'LICENSE', 'CHANGELOG.md', 'PRIVACY.md', 'SECURITY.md']) {
  failWhen(!fs.existsSync(path.join(extensionRoot, file)), `扩展包缺少 ${file}。`);
}

const licenseText = fs.readFileSync(path.join(extensionRoot, 'LICENSE'), 'utf8');
failWhen(!licenseText.includes('GNU AFFERO GENERAL PUBLIC LICENSE'), 'LICENSE 不是 GNU AGPL 正文。');
failWhen(!licenseText.includes('Version 3, 19 November 2007'), 'LICENSE 不是 AGPL v3 正文。');

const iconPath = path.join(extensionRoot, pkg.icon || '');
failWhen(!pkg.icon || path.extname(pkg.icon).toLowerCase() !== '.png', 'Marketplace icon 必须是 PNG。');
if (fs.existsSync(iconPath)) {
  const icon = fs.readFileSync(iconPath);
  const isPng = icon.length >= 24 && icon.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  failWhen(!isPng, 'resources/icon.png 不是有效 PNG。');
  if (isPng) {
    const width = icon.readUInt32BE(16);
    const height = icon.readUInt32BE(20);
    failWhen(width < 128 || height < 128, `Marketplace icon 至少需要 128x128，当前是 ${width}x${height}。`);
  }
} else {
  errors.push(`找不到 Marketplace icon：${pkg.icon || '(未配置)'}`);
}

const rootIgnore = fs.readFileSync(path.join(repositoryRoot, '.gitignore'), 'utf8');
failWhen(!rootIgnore.includes('fanqie-api-capture/output/*'), '根 .gitignore 没有排除抓包输出。');
failWhen(!rootIgnore.includes('**/node_modules/'), '根 .gitignore 没有排除 node_modules。');
failWhen(!rootIgnore.includes('**/*.vsix'), '根 .gitignore 没有排除 VSIX。');

const tag = process.env.GITHUB_REF_NAME || process.argv.find((arg) => /^v\d+\.\d+\.\d+/.test(arg));
if (tag) {
  failWhen(tag !== `v${pkg.version}`, `Git 标签 ${tag} 与 package.json 版本 v${pkg.version} 不一致。`);
}

if (errors.length > 0) {
  console.error('发布前检查失败：');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`发布前检查通过：${pkg.publisher}.${pkg.name} v${pkg.version}`);
}
