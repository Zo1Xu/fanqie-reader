'use strict';

const vscode = require('vscode');

const READER_VIEW_ID = 'fanqieReader.readerView';
const READER_CONTAINER_COMMAND = 'workbench.view.extension.fanqieReaderPanel';

class ReaderPanel {
  constructor(context, client, onProgressChanged) {
    this.context = context;
    this.client = client;
    this.onProgressChanged = onProgressChanged;
    this.view = undefined;
    this.currentChapter = undefined;
    this.pendingItemId = undefined;
    this.loadingSequence = 0;
    this.viewWaiters = new Set();
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.currentChapter
      ? getChapterHtml(view.webview, this.currentChapter, {
          terminalPrompt: this.#getTerminalPrompt(),
        })
      : getEmptyHtml(view.webview, {
          terminalPrompt: this.#getTerminalPrompt(),
        });
    view.webview.onDidReceiveMessage(async (message) => {
      try {
        await this.#handleMessage(message);
      } catch (error) {
        vscode.window.showErrorMessage(`番茄阅读：${error.message}`);
      }
    });
    view.onDidChangeVisibility(() => this.#updateVisibilityContext());
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined;
        this.loadingSequence += 1;
        this.#updateVisibilityContext();
      }
    });
    for (const resolve of this.viewWaiters) {
      resolve(view);
    }
    this.viewWaiters.clear();
    this.#updateVisibilityContext();
  }

  async openChapter(itemId) {
    const sequence = ++this.loadingSequence;
    this.pendingItemId = String(itemId || '');
    const view = await this.#showReaderView();
    this.currentChapter = undefined;
    this.#updateVisibilityContext();
    view.title = '小说阅读';
    view.description = '正在载入…';
    const terminalOptions = { terminalPrompt: this.#getTerminalPrompt() };
    view.webview.html = getLoadingHtml(view.webview, terminalOptions);

    try {
      const chapter = await this.client.getChapter(itemId);
      if (sequence !== this.loadingSequence) {
        return;
      }
      this.currentChapter = chapter;
      view.title = '小说阅读';
      view.description = `${chapter.bookName} · ${chapter.title}`;
      view.webview.html = getChapterHtml(view.webview, chapter, terminalOptions);
      this.#updateVisibilityContext();
      await this.#saveProgress(chapter);
    } catch (error) {
      if (sequence !== this.loadingSequence) {
        return;
      }
      this.currentChapter = undefined;
      view.title = '小说阅读';
      view.description = '打开失败';
      view.webview.html = getErrorHtml(view.webview, error.message, terminalOptions);
      this.#updateVisibilityContext();
      throw error;
    }
  }

  async show() {
    await this.#showReaderView();
  }

  async retryRestrictedChapter() {
    if (this.view?.visible && this.currentChapter?.locked) {
      await this.openChapter(this.currentChapter.id);
    }
  }

  async previousChapter() {
    if (!this.currentChapter) {
      await this.show();
      return;
    }
    if (this.currentChapter.previousItemId) {
      await this.openChapter(this.currentChapter.previousItemId);
    }
  }

  async nextChapter() {
    if (!this.currentChapter) {
      await this.show();
      return;
    }
    if (this.currentChapter.nextItemId) {
      await this.openChapter(this.currentChapter.nextItemId);
    }
  }

  async continueBook(book) {
    const history = this.#getHistory()[book.id];
    const historyItemId = history?.itemId;
    const itemId = book.chapters.some((chapter) => chapter.id === historyItemId)
      ? historyItemId
      : book.chapters[0]?.id;
    if (!itemId) {
      throw new Error('这本书暂时没有可读取的章节。');
    }
    await this.openChapter(itemId);
  }

  async #showReaderView() {
    await vscode.commands.executeCommand(READER_CONTAINER_COMMAND);
    if (!this.view) {
      await new Promise((resolve) => {
        const finish = () => {
          clearTimeout(timeout);
          this.viewWaiters.delete(finish);
          resolve();
        };
        const timeout = setTimeout(finish, 2_000);
        this.viewWaiters.add(finish);
      });
    }
    if (!this.view) {
      throw new Error('无法打开底部小说阅读区，请重新加载 VS Code 后重试。');
    }
    this.view.show(false);
    return this.view;
  }

  async #handleMessage(message) {
    if (message.type === 'login' && this.currentChapter?.loginRequired) {
      await vscode.commands.executeCommand('fanqieReader.login');
      return;
    }
    if (message.type === 'retry' && this.pendingItemId) {
      await this.openChapter(this.pendingItemId);
      return;
    }
    if (!this.currentChapter) {
      return;
    }
    if (message.type === 'previous' && this.currentChapter.previousItemId) {
      await this.previousChapter();
    } else if (message.type === 'next' && this.currentChapter.nextItemId) {
      await this.nextChapter();
    } else if (message.type === 'catalog') {
      await this.#showCatalog();
    } else if (message.type === 'openWebsite') {
      await vscode.env.openExternal(
        vscode.Uri.parse(`https://fanqienovel.com/reader/${this.currentChapter.id}`),
      );
    }
  }

  #updateVisibilityContext() {
    void vscode.commands.executeCommand('setContext', 'fanqieReader.hasPreviousChapter',
      Boolean(this.view?.visible && this.currentChapter?.previousItemId));
    void vscode.commands.executeCommand('setContext', 'fanqieReader.hasNextChapter',
      Boolean(this.view?.visible && this.currentChapter?.nextItemId));
    void vscode.commands.executeCommand(
      'setContext',
      'fanqieReader.readerVisible',
      Boolean(this.view?.visible && this.currentChapter),
    );
  }

  async #showCatalog() {
    const book = await this.client.getBook(this.currentChapter.bookId);
    const selected = await vscode.window.showQuickPick(
      book.chapters.map((chapter) => ({
        label: chapter.title,
        description: this.client.getChapterState?.(chapter.id)?.reason || '',
        itemId: chapter.id,
      })),
      {
        title: `${book.name} · 目录`,
        placeHolder: '输入章节名筛选',
        matchOnDescription: true,
      },
    );
    if (selected) {
      await this.openChapter(selected.itemId);
    }
  }

  #getHistory() {
    return this.context.globalState.get('fanqieReader.history', {});
  }

  #getTerminalPrompt() {
    const editorUri = vscode.window.activeTextEditor?.document?.uri;
    const editorFolder = editorUri
      ? vscode.workspace.getWorkspaceFolder?.(editorUri)
      : undefined;
    const folder = editorFolder || vscode.workspace.workspaceFolders?.[0];
    return createTerminalPrompt(folder?.uri?.fsPath);
  }

  async #saveProgress(chapter) {
    if (!chapter.bookId || chapter.locked) {
      return;
    }
    const history = this.#getHistory();
    history[chapter.bookId] = {
      itemId: chapter.id,
      title: chapter.title,
      bookName: chapter.bookName,
      author: chapter.author,
      updatedAt: Date.now(),
    };
    await this.context.globalState.update('fanqieReader.history', history);
    this.onProgressChanged?.(chapter.bookId);
  }
}

function getLoadingHtml(webview, options = {}) {
  const nonce = getNonce();
  const prompt = escapeHtml(
    options.terminalPrompt || createTerminalPrompt(),
  );
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
<style nonce="${nonce}">${baseStyles()} ${terminalStateStyles()}</style></head>
<body><main class="terminal-state" role="status" aria-live="polite">
<div>${prompt}</div><div class="blank" aria-hidden="true"></div>
<div><span class="log-info">[INFO]</span> Loading project context...</div>
<div><span class="log-info">[INFO]</span> Fetching chapter content...</div>
<div class="blank" aria-hidden="true"></div><div>${prompt}<span class="cursor" aria-hidden="true"></span></div>
</main></body></html>`;
}

function getEmptyHtml(webview, options = {}) {
  const nonce = getNonce();
  const prompt = escapeHtml(
    options.terminalPrompt || createTerminalPrompt(),
  );
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
<style nonce="${nonce}">${baseStyles()} ${terminalStateStyles()}</style></head>
<body><main class="terminal-state">
<div>${prompt}</div><div class="blank" aria-hidden="true"></div>
<div><span class="log-info">[INFO]</span> fanqieReader ready.</div>
<div><span class="log-info">[INFO]</span> Waiting for chapter selection...</div>
<div><span class="log-dim">[HINT] Select a novel from the sidebar. Alt+PageUp / Alt+PageDown changes chapters.</span></div>
<div class="blank" aria-hidden="true"></div><div>${prompt}<span class="cursor" aria-hidden="true"></span></div>
</main></body></html>`;
}

function getErrorHtml(webview, message, options = {}) {
  const nonce = getNonce();
  const prompt = escapeHtml(
    options.terminalPrompt || createTerminalPrompt(),
  );
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">${baseStyles()} ${terminalStateStyles()} .error{color:var(--vscode-terminal-ansiRed,var(--vscode-errorForeground))}.retry{margin:0;padding:0;border:0;background:transparent;color:var(--vscode-terminal-ansiCyan,var(--vscode-textLink-foreground));font:inherit;text-decoration:underline;cursor:pointer}.retry:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}</style></head>
<body><main class="terminal-state" role="alert">
<div>${prompt}</div><div class="blank" aria-hidden="true"></div>
<div class="error">[ERROR] Failed to open chapter: ${escapeHtml(message)}</div>
<div><span class="log-dim">[HINT]</span> <button class="retry" id="retry" type="button">Run again</button> or select another chapter.</div>
<div class="blank" aria-hidden="true"></div><div>${prompt}<span class="cursor" aria-hidden="true"></span></div>
</main>
<script nonce="${nonce}">const vscode=acquireVsCodeApi();document.getElementById('retry').addEventListener('click',()=>vscode.postMessage({type:'retry'}));</script></body></html>`;
}

function getChapterHtml(webview, chapter, options = {}) {
  const nonce = getNonce();
  const config = vscode.workspace.getConfiguration('fanqieReader');
  const fontSize = config.get('fontSize', 14);
  const lineHeight = config.get('lineHeight', 1.6);
  const contentWidth = config.get('contentWidth', 760);
  const terminalPrompt = escapeHtml(
    options.terminalPrompt || createTerminalPrompt(),
  );
  const content = chapter.locked
    ? `<div class="notice">${escapeHtml(chapter.restrictionReason || '当前网页未提供完整正文，请确认扩展登录账号具有该章节的网页阅读权限。')}${chapter.loginRequired ? ' <button data-action="login">登录后重试</button>' : chapter.retryable ? ' <button data-action="retry">重试</button>' : ''}</div>`
    : sanitizeChapterContent(chapter.content);
  const fontFace = chapter.fontDataUri
    ? `@font-face{font-family:'FanqieChapter';src:url('${chapter.fontDataUri}') format('woff2');font-weight:400;font-style:normal;font-display:block;}`
    : '';
  const previousDisabled = chapter.previousItemId ? '' : 'disabled';
  const nextDisabled = chapter.nextItemId ? '' : 'disabled';

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
${fontFace}
${baseStyles()}
:root{--reader-size:${Number(fontSize)}px;--reader-line:${Number(lineHeight)};--reader-width:${Number(contentWidth)}px}
body{padding:0 12px 58px;background:var(--vscode-terminal-background,var(--vscode-panel-background));color:var(--vscode-terminal-foreground,var(--vscode-foreground));font-family:var(--vscode-editor-font-family),Consolas,'Courier New',monospace}
.toolbar{position:fixed;top:0;right:0;z-index:10;display:flex;align-items:center;gap:4px;min-height:32px;padding:0 8px;background:var(--vscode-terminal-background,var(--vscode-panel-background));border:1px solid transparent;border-top:0;opacity:0;transition:opacity .15s ease}.toolbar:hover,.toolbar:focus-within{border-color:var(--vscode-panel-border,var(--vscode-widget-border));opacity:1}
.toolbar .spacer{flex:1}.toolbar button{border:0;background:transparent;color:inherit;padding:5px 9px;border-radius:4px;cursor:pointer;font:inherit}.toolbar button:hover:not(:disabled){background:var(--vscode-toolbar-hoverBackground)}.toolbar button:focus-visible,.footer-nav button:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:1px}.toolbar button:disabled,.footer-nav button:disabled{opacity:.28;cursor:default}
.terminal-output{max-width:var(--reader-width);font-size:var(--reader-size);line-height:var(--reader-line)}.terminal-header{position:sticky;top:0;z-index:4;padding-top:8px;background:var(--vscode-terminal-background,var(--vscode-panel-background))}.terminal-line{min-height:1em;white-space:pre-wrap;overflow-wrap:anywhere}.blank{height:calc(var(--reader-line) * 1em)}.log-info{color:var(--vscode-terminal-ansiGreen,var(--vscode-terminal-foreground));font-weight:600}.log-dim{color:var(--vscode-descriptionForeground)}
.content{font-family:'FanqieChapter',var(--vscode-editor-font-family),Consolas,'Courier New',monospace;font-size:inherit;line-height:inherit;letter-spacing:0}.content p{margin:0 0 calc(var(--reader-line) * .72em);text-indent:0;white-space:pre-wrap;overflow-wrap:anywhere}.content p:last-child{margin-bottom:0}.notice{padding:0;color:var(--vscode-terminal-ansiYellow,var(--vscode-editorWarning-foreground));font:inherit}
.cursor{display:inline-block;width:.58em;height:1.12em;margin-left:2px;background:currentColor;vertical-align:-.18em;animation:terminal-blink 1s steps(1,end) infinite}@keyframes terminal-blink{0%,48%{opacity:1}49%,100%{opacity:0}}
.footer-nav{position:fixed;z-index:12;left:50%;bottom:0;display:grid;width:min(420px,100%);grid-template-columns:minmax(0,1fr) minmax(0,1.2fr) minmax(0,1fr);align-items:center;gap:8px;min-height:40px;padding:3px 8px;background:var(--vscode-terminal-background,var(--vscode-panel-background));border:1px solid var(--vscode-panel-border,var(--vscode-widget-border));border-bottom:0;opacity:1;transform:translateX(-50%);transition:opacity .15s ease}.footer-nav:hover,.footer-nav:focus-within{border-color:var(--vscode-panel-border,var(--vscode-widget-border));opacity:1}.footer-nav button{min-width:0;white-space:nowrap;padding:5px 8px;border:1px solid var(--vscode-button-border,var(--vscode-panel-border));border-radius:4px;background:transparent;color:inherit;cursor:pointer;font:inherit}.footer-nav button:hover:not(:disabled){background:var(--vscode-toolbar-hoverBackground)}.chapter-index{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;color:var(--vscode-descriptionForeground);font-size:12px}
@media(max-width:640px){body{padding:0 8px 54px}.toolbar{padding-inline:4px}.toolbar .label{display:none}.footer-nav{gap:4px;padding-inline:4px}}
@media(max-height:360px){.terminal-output{line-height:1.5}.blank{height:1em}.content p{margin-bottom:.7em}}
@media(prefers-reduced-motion:reduce){.toolbar,.footer-nav{transition:none}.cursor{animation:none;opacity:.7}}
</style></head>
<body>
<nav class="toolbar" aria-label="阅读工具栏">
  <button data-action="previous" ${previousDisabled} title="上一章（Alt+PageUp）" aria-label="上一章">← <span class="label">上一章</span></button>
  <button data-action="catalog" title="目录" aria-label="打开目录">☷ <span class="label">目录</span></button>
  <button data-action="next" ${nextDisabled} title="下一章（Alt+PageDown）" aria-label="下一章"><span class="label">下一章</span> →</button>
  <span class="spacer"></span>
  <button data-action="smaller" title="缩小字号" aria-label="缩小字号">A−</button>
  <button data-action="larger" title="放大字号" aria-label="放大字号">A+</button>
  <button data-action="openWebsite" title="在番茄小说官网打开" aria-label="在番茄小说官网打开">↗</button>
</nav>
<main class="terminal-output" aria-label="小说阅读终端输出">
  <header class="terminal-header" aria-label="当前章节终端状态">
    <div class="terminal-line">${terminalPrompt}</div>
    <div class="blank" aria-hidden="true"></div>
    <div class="terminal-line"><span class="log-info">[INFO]</span> Loading project context...</div>
    <div class="terminal-line"><span class="log-info">[INFO]</span> Dependency resolution completed.</div>
    <div class="terminal-line"><span class="log-info">[INFO]</span> Chapter resolved: ${escapeHtml(chapter.bookName)} / ${escapeHtml(chapter.title)}${chapter.wordCount ? ` (${chapter.wordCount.toLocaleString('zh-CN')} chars)` : ''}</div>
    <div class="blank" aria-hidden="true"></div>
  </header>
  <article class="content">${content}</article>
  <div class="blank" aria-hidden="true"></div>
  <div class="terminal-line">${terminalPrompt}<span class="cursor" aria-hidden="true"></span></div>
</main>
<nav class="footer-nav" aria-label="章节导航">
  <button data-action="previous" ${previousDisabled} aria-label="上一章">← 上一章</button>
  <span class="chapter-index" aria-live="polite">${chapter.order ? `第 ${chapter.order} 章` : escapeHtml(chapter.title)}</span>
  <button data-action="next" ${nextDisabled} aria-label="下一章">下一章 →</button>
</nav>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const saved = vscode.getState() || {};
if (saved.fontSize) document.documentElement.style.setProperty('--reader-size', saved.fontSize + 'px');
document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'larger' || action === 'smaller') {
    const style = getComputedStyle(document.documentElement);
    const current = parseFloat(style.getPropertyValue('--reader-size')) || ${Number(fontSize)};
    const next = Math.max(12, Math.min(36, current + (action === 'larger' ? 1 : -1)));
    document.documentElement.style.setProperty('--reader-size', next + 'px');
    vscode.setState({fontSize: next});
    return;
  }
  vscode.postMessage({type: action});
});
window.addEventListener('keydown', (event) => {
  if (!event.altKey || (event.key !== 'PageUp' && event.key !== 'PageDown')) return;
  event.preventDefault();
  vscode.postMessage({type: event.key === 'PageUp' ? 'previous' : 'next'});
});
</script></body></html>`;
}

function sanitizeChapterContent(html) {
  const source = String(html || '');
  const blocks = source
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\u0000')
    .replace(/<[^>]*>/g, '')
    .split('\u0000')
    .map((block) => decodeHtmlEntities(block).trim())
    .filter(Boolean);
  if (!blocks.length) {
    return '<div class="notice">本章没有可显示的正文。</div>';
  }
  return blocks.map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`).join('');
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function baseStyles() {
  return `*{box-sizing:border-box}html,body{min-height:100%;margin:0}body{font-family:var(--vscode-editor-font-family),Consolas,'Courier New',monospace;background:var(--vscode-terminal-background,var(--vscode-panel-background));color:var(--vscode-terminal-foreground,var(--vscode-foreground))}`;
}

function terminalStateStyles() {
  return `.terminal-state{padding:8px 12px;font-size:14px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}.terminal-state .blank{height:1.6em}.log-info{color:var(--vscode-terminal-ansiGreen,var(--vscode-terminal-foreground));font-weight:600}.log-dim{color:var(--vscode-descriptionForeground)}.cursor{display:inline-block;width:.58em;height:1.12em;margin-left:2px;background:currentColor;vertical-align:-.18em;animation:terminal-blink 1s steps(1,end) infinite}@keyframes terminal-blink{0%,48%{opacity:1}49%,100%{opacity:0}}@media(prefers-reduced-motion:reduce){.cursor{animation:none;opacity:.7}}`;
}

function createTerminalPrompt(workspacePath = '', platform = process.platform) {
  const path = String(workspacePath || '').trim();
  if (platform === 'win32') {
    return `PS ${path || 'C:\\'}>`;
  }
  return `${path || '~'} $`;
}

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

module.exports = {
  READER_CONTAINER_COMMAND,
  READER_VIEW_ID,
  ReaderPanel,
  createTerminalPrompt,
  getChapterHtml,
  getEmptyHtml,
  sanitizeChapterContent,
};
