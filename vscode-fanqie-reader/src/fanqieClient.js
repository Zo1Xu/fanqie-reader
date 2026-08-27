'use strict';

const BASE_URL = 'https://fanqienovel.com';
const COOKIE_SECRET_KEY = 'fanqieReader.cookie';
const USER_AGENT_SECRET_KEY = 'fanqieReader.userAgent';

class FanqieError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'FanqieError';
    this.code = code;
  }
}

class FanqieClient {
  constructor(secretStorage) {
    this.secretStorage = secretStorage;
    this.bookCache = new Map();
    this.fontCache = new Map();
  }

  async hasCookie() {
    return Boolean(await this.secretStorage.get(COOKIE_SECRET_KEY));
  }

  async saveCookie(value, options = {}) {
    const cookie = normalizeCookie(value);
    if (!cookie) {
      throw new FanqieError('Cookie 不能为空。', 'EMPTY_COOKIE');
    }
    const userAgent = normalizeUserAgent(options.userAgent) || getDefaultUserAgent();
    const session = { cookie, userAgent };
    const user = await this.validateCookie(cookie, { userAgent });
    // The user endpoint accepts partially established login sessions. Verify the
    // bookshelf endpoint as well before persisting the isolated browser session.
    await this.#getShelfBookIds(session);
    await this.secretStorage.store(USER_AGENT_SECRET_KEY, userAgent);
    await this.secretStorage.store(COOKIE_SECRET_KEY, cookie);
    return user;
  }

  async clearCookie() {
    await Promise.all([
      this.secretStorage.delete(COOKIE_SECRET_KEY),
      this.secretStorage.delete(USER_AGENT_SECRET_KEY),
    ]);
  }

  clearCache() {
    this.bookCache.clear();
  }

  async getUser() {
    const session = await this.#requireSession();
    return this.validateCookie(session.cookie, { userAgent: session.userAgent });
  }

  async validateCookie(cookie, options = {}) {
    const result = await this.#getJson('/api/user/info/v2', {
      cookie,
      userAgent: options.userAgent,
      accept: 'application/json, text/plain, */*',
    });
    assertApiSuccess(result, 'Cookie 已失效或账号未登录');
    if (!result.data?.id) {
      throw new FanqieError('Cookie 已失效或账号未登录。', 'NOT_LOGGED_IN');
    }
    return result.data;
  }

  async getShelfBookIds() {
    const session = await this.#requireSession();
    return this.#getShelfBookIds(session);
  }

  async #getShelfBookIds(session) {
    const path =
      '/reading/bookapi/bookshelf/info/v:version/' +
      '?aid=1967&iid=0&version_code=57700&update_version_code=57700';
    const result = await this.#getJson(path, {
      cookie: session.cookie,
      userAgent: session.userAgent,
      accept: 'application/json, text/plain, */*',
      referer: `${BASE_URL}/bookshelf`,
    });
    assertApiSuccess(result, '读取书架失败');
    return parseShelfBookIds(result);
  }

  async getBook(bookId, options = {}) {
    const id = requireNumericId(bookId, '书籍 ID');
    if (!options.refresh && this.bookCache.has(id)) {
      return this.bookCache.get(id);
    }

    const html = await this.#getText(`/page/${id}`);
    const state = parseInitialState(html);
    const page = state.page;
    if (!page?.bookId || !page?.bookName) {
      throw new FanqieError('书籍详情页中没有找到可读取的数据。', 'BOOK_NOT_FOUND');
    }

    const volumeNames = Array.isArray(page.volumeNameList) ? page.volumeNameList : [];
    const volumeRows = Array.isArray(page.chapterListWithVolume)
      ? page.chapterListWithVolume
      : [];
    const volumes = volumeRows.map((chapters, index) => ({
      name: volumeNames[index] || `第 ${index + 1} 卷`,
      chapters: (Array.isArray(chapters) ? chapters : []).map(normalizeChapterSummary),
    }));
    const allChapters = volumes.flatMap((volume) => volume.chapters);
    const book = {
      id: String(page.bookId),
      name: String(page.bookName),
      author: String(page.authorName || page.author || ''),
      abstract: String(page.abstract || ''),
      cover: String(page.thumbUrl || page.thumbUri || ''),
      wordCount: Number(page.wordNumber || 0),
      chapterCount: Number(page.chapterTotal || allChapters.length),
      lastChapterItemId: String(page.lastChapterItemId || ''),
      lastChapterTitle: String(page.lastChapterTitle || ''),
      volumes,
      chapters: allChapters,
    };
    this.bookCache.set(id, book);
    return book;
  }

  async getChapter(itemId) {
    const id = requireNumericId(itemId, '章节 ID');
    const html = await this.#getText(`/reader/${id}`);
    const state = parseInitialState(html);
    const data = state.reader?.chapterData;
    if (!data?.itemId) {
      throw new FanqieError('章节页中没有找到正文数据。', 'CHAPTER_NOT_FOUND');
    }

    const locked = isApiFlag(
      data.isChapterLock,
      data.needPay,
      data.isPaidPublication,
      data.isPaidStory,
    );
    let fontDataUri = '';
    const font = extractChapterFont(html);
    if (font?.url && data.content) {
      fontDataUri = await this.#getFontDataUri(font.url);
    }

    return {
      id: String(data.itemId),
      bookId: String(data.bookId || ''),
      bookName: String(data.bookName || ''),
      author: String(data.author || ''),
      title: String(data.title || `章节 ${id}`),
      wordCount: Number(data.chapterWordNumber || 0),
      content: String(data.content || ''),
      previousItemId: String(data.preItemId || ''),
      nextItemId: String(data.nextItemId || ''),
      order: Number(data.realChapterOrder || data.order || 0),
      locked,
      fontDataUri,
    };
  }

  async #requireSession() {
    const cookie = await this.secretStorage.get(COOKIE_SECRET_KEY);
    if (!cookie) {
      throw new FanqieError('请先设置番茄小说登录 Cookie。', 'COOKIE_REQUIRED');
    }
    const storedUserAgent = await this.secretStorage.get(USER_AGENT_SECRET_KEY);
    return {
      cookie,
      userAgent: normalizeUserAgent(storedUserAgent) || getDefaultUserAgent(),
    };
  }

  async #getJson(path, options = {}) {
    const text = await this.#getText(path, options);
    try {
      return JSON.parse(text);
    } catch {
      throw new FanqieError('番茄小说返回了无法解析的数据。', 'INVALID_JSON');
    }
  }

  async #getText(path, options = {}) {
    const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
    const headers = {
      Accept: options.accept || 'text/html,application/xhtml+xml,application/json',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: options.referer || `${BASE_URL}/`,
      'User-Agent': normalizeUserAgent(options.userAgent) || getDefaultUserAgent(),
    };
    if (options.cookie) {
      headers.Cookie = options.cookie;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new FanqieError(
          `番茄小说请求失败（HTTP ${response.status}）。`,
          `HTTP_${response.status}`,
        );
      }
      // fetch transparently decodes gzip/deflate/Brotli responses before text().
      return await response.text();
    } catch (error) {
      if (error instanceof FanqieError) {
        throw error;
      }
      if (error?.name === 'AbortError') {
        throw new FanqieError('连接番茄小说超时，请稍后重试。', 'TIMEOUT');
      }
      throw new FanqieError(`无法连接番茄小说：${error.message}`, 'NETWORK_ERROR');
    } finally {
      clearTimeout(timeout);
    }
  }

  async #getFontDataUri(url) {
    if (this.fontCache.has(url)) {
      return this.fontCache.get(url);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        headers: { Referer: `${BASE_URL}/`, 'User-Agent': getDefaultUserAgent() },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const dataUri = `data:font/woff2;base64,${bytes.toString('base64')}`;
      this.fontCache.set(url, dataUri);
      return dataUri;
    } catch {
      // The chapter still opens. Its encrypted glyphs may look unusual until retried.
      return '';
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeCookie(value) {
  return String(value || '')
    .trim()
    .replace(/^cookie\s*:\s*/i, '')
    .replace(/[\r\n]+/g, '');
}

function normalizeUserAgent(value) {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 512);
}

function getDefaultUserAgent(platform = process.platform) {
  const system = platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : 'X11; Linux x86_64';
  return (
    `Mozilla/5.0 (${system}) AppleWebKit/537.36 ` +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );
}

function parseShelfBookIds(result) {
  const rows = result?.data?.book_shelf_info;
  return Array.isArray(rows)
    ? [...new Set(rows.map((row) => String(row?.book_id || '')).filter(Boolean))]
    : [];
}

function assertApiSuccess(result, fallbackMessage) {
  if (!result || Number(result.code) !== 0) {
    throw new FanqieError(
      String(result?.message || fallbackMessage || '番茄小说接口调用失败。'),
      'API_ERROR',
    );
  }
}

function requireNumericId(value, label) {
  const id = String(value || '').trim();
  if (!/^\d{10,}$/.test(id)) {
    throw new FanqieError(`${label}格式不正确。`, 'INVALID_ID');
  }
  return id;
}

function normalizeChapterSummary(chapter) {
  return {
    id: String(chapter?.itemId || ''),
    title: String(chapter?.title || ''),
    order: Number(chapter?.realChapterOrder || 0),
    locked: isApiFlag(
      chapter?.isChapterLock,
      chapter?.needPay,
      chapter?.isPaidPublication,
      chapter?.isPaidStory,
    ),
  };
}

function parseInitialState(html) {
  const marker = 'window.__INITIAL_STATE__';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) {
    throw new FanqieError('页面结构已变化：未找到初始数据。', 'STATE_NOT_FOUND');
  }
  const start = html.indexOf('{', markerIndex + marker.length);
  if (start < 0) {
    throw new FanqieError('页面结构已变化：初始数据不完整。', 'STATE_NOT_FOUND');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, index + 1));
        } catch {
          throw new FanqieError('页面中的初始数据无法解析。', 'INVALID_STATE');
        }
      }
    }
  }
  throw new FanqieError('页面结构已变化：初始数据未闭合。', 'INVALID_STATE');
}

function extractChapterFont(html) {
  const family = html.match(/muye-reader-box\s+font-([A-Za-z0-9_-]+)/)?.[1];
  if (!family) {
    return null;
  }
  const escapedFamily = family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = html.match(
    new RegExp(
      `@font-face\\s*\\{\\s*font-family\\s*:\\s*${escapedFamily}[^}]*font-weight\\s*:\\s*400\\s*;?\\s*\\}`,
    ),
  )?.[0];
  const url = rule?.match(/url\(["']?(https:[^)"']+?\.woff2(?:\?[^)"']*)?)["']?\)/)?.[1];
  return url ? { family, url } : null;
}

function isApiFlag(...values) {
  return values.some((value) => value === true || value === 1 || value === '1');
}

function parseFanqieInput(value) {
  const input = String(value || '').trim();
  if (/^\d{10,}$/.test(input)) {
    return { type: 'book', id: input };
  }
  const reader = input.match(/fanqienovel\.com\/reader\/(\d{10,})/i);
  if (reader) {
    return { type: 'chapter', id: reader[1] };
  }
  const page = input.match(/fanqienovel\.com\/page\/(\d{10,})/i);
  if (page) {
    return { type: 'book', id: page[1] };
  }
  return null;
}

module.exports = {
  FanqieClient,
  FanqieError,
  extractChapterFont,
  getDefaultUserAgent,
  normalizeCookie,
  normalizeUserAgent,
  parseFanqieInput,
  parseInitialState,
  parseShelfBookIds,
};
