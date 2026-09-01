'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

class TreeItem {}

const vscodeMock = {
  EventEmitter: class {},
  ThemeIcon: class {},
  TreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') return vscodeMock;
  return originalLoad.call(this, request, parent, isMain);
};
const {
  createShelfTree,
  guardAgainstLegacyInstallation,
  runLogout,
} = require('../src/extension');
Module._load = originalLoad;

test('shelf tree exposes the native collapse-all action', () => {
  const shelfProvider = {};
  let registration;
  const disposable = {};
  const api = {
    window: {
      createTreeView: (id, options) => {
        registration = { id, options };
        return disposable;
      },
    },
  };

  assert.equal(createShelfTree(shelfProvider, api), disposable);
  assert.deepEqual(registration, {
    id: 'fanqieReader.shelf',
    options: { treeDataProvider: shelfProvider, showCollapseAll: true },
  });
});

test('logout reconciles stale logged-in UI when the cookie is already absent', async () => {
  const calls = [];
  const result = await runLogout({
    client: {
      hasCookie: async () => false,
      clearCookie: async () => { calls.push('clearCookie'); },
    },
    confirm: async () => {
      throw new Error('confirmation should not be shown without a cookie');
    },
    onLoggedOut: async () => { calls.push('onLoggedOut'); },
  });

  assert.deepEqual(result, { completed: true, hadCookie: false });
  assert.deepEqual(calls, ['clearCookie', 'onLoggedOut']);
});

test('logout leaves the session unchanged when confirmation is cancelled', async () => {
  let cleared = false;
  let reconciled = false;
  const result = await runLogout({
    client: {
      hasCookie: async () => true,
      clearCookie: async () => { cleared = true; },
    },
    confirm: async () => false,
    onLoggedOut: async () => { reconciled = true; },
  });

  assert.deepEqual(result, { completed: false, hadCookie: true });
  assert.equal(cleared, false);
  assert.equal(reconciled, false);
});

test('legacy installation guard hides current actions and opens extension management', async () => {
  const commands = [];
  const api = {
    extensions: {
      getExtension: (id) => id === 'local.fanqie-reader' ? { id } : undefined,
    },
    commands: {
      executeCommand: async (...args) => { commands.push(args); },
    },
    window: {
      showWarningMessage: async () => '管理旧测试版',
    },
  };

  assert.equal(await guardAgainstLegacyInstallation(api), true);
  assert.deepEqual(commands, [
    ['setContext', 'fanqieReader.currentExtensionActive', false],
    ['workbench.extensions.search', '@id:local.fanqie-reader'],
  ]);
});

test('legacy installation guard enables current actions when there is no conflict', async () => {
  const commands = [];
  const api = {
    extensions: { getExtension: () => undefined },
    commands: {
      executeCommand: async (...args) => { commands.push(args); },
    },
    window: {
      showWarningMessage: async () => {
        throw new Error('warning should not be shown without a legacy extension');
      },
    },
  };

  assert.equal(await guardAgainstLegacyInstallation(api), false);
  assert.deepEqual(commands, [
    ['setContext', 'fanqieReader.currentExtensionActive', true],
  ]);
});
