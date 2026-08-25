'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractChapterFont,
  normalizeCookie,
  parseFanqieInput,
  parseInitialState,
} = require('../src/fanqieClient');

test('parseInitialState reads nested JSON and escaped braces', () => {
  const html = '<script>window.__INITIAL_STATE__={"page":{"bookName":"示例}书"},"reader":{}};</script>';
  assert.equal(parseInitialState(html).page.bookName, '示例}书');
});

test('parseFanqieInput recognizes book IDs and links', () => {
  assert.deepEqual(parseFanqieInput('7665193065501445145'), {
    type: 'book',
    id: '7665193065501445145',
  });
  assert.deepEqual(parseFanqieInput('https://fanqienovel.com/page/7665193065501445145?x=1'), {
    type: 'book',
    id: '7665193065501445145',
  });
  assert.deepEqual(parseFanqieInput('https://fanqienovel.com/reader/7670031790517518872'), {
    type: 'chapter',
    id: '7670031790517518872',
  });
  assert.equal(parseFanqieInput('not-a-link'), null);
});

test('normalizeCookie strips copied header prefix and line breaks', () => {
  assert.equal(normalizeCookie(' Cookie: a=1;\r\n b=2 '), 'a=1; b=2');
});

test('extractChapterFont selects the reader regular woff2 font', () => {
  const html = [
    '<style>@font-face{font-family:abc123;font-display:block;',
    'src:url(https://font.example/chapter.woff2)format("woff2");font-weight:400;}</style>',
    '<div class="muye-reader-box font-abc123 muye-reader-content-16"></div>',
  ].join('');
  assert.deepEqual(extractChapterFont(html), {
    family: 'abc123',
    url: 'https://font.example/chapter.woff2',
  });
});
