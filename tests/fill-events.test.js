// 執行：node --test tests/
// 一次性補上舊活動的結束日與公告連結 (scraper/fill-events.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyFill } = require('../scraper/fill-events.js');

const URL_A = 'https://www.monster-strike.com.tw/news/a.html';

test('只補空的欄位：名稱、開始日、已有的值都不改', () => {
    const events = [
        { event: '2024-09月 激獸神祭', date: '2024-09-11', tag: 'honke' },
        { event: '2024-09月 超獸神祭', date: '2024-09-21', endDate: '2024-09-30', source: 'https://www.monster-strike.com.tw/news/old.html' }
    ];
    const r = applyFill(events, [
        { event: '2024-09月 激獸神祭', date: '2024-09-11', endDate: '2024-09-14', source: URL_A },
        { event: '2024-09月 超獸神祭', date: '2024-09-21', endDate: '2024-10-02', source: URL_A }
    ]);
    assert.deepEqual(r.events[0], { event: '2024-09月 激獸神祭', date: '2024-09-11', tag: 'honke', endDate: '2024-09-14', source: URL_A });
    assert.deepEqual(r.events[1], events[1]);
    assert.equal(r.filled.length, 1);
    assert.equal(events[0].endDate, undefined);   // 不改動傳入的清單
});

test('名稱或開始日對不上、結束日比開始日早、不是官網網址 → 不補', () => {
    const events = [{ event: 'A', date: '2024-01-10' }, { event: 'B', date: '2024-01-10' }];
    const r = applyFill(events, [
        { event: '改過名的活動', date: '2024-01-10', endDate: '2024-01-12', source: URL_A },
        { event: 'A', date: '2024-01-11', endDate: '2024-01-12', source: URL_A },
        { event: 'B', date: '2024-01-10', endDate: '2024-01-09', source: 'https://example.com/x' }
    ]);
    assert.equal(r.skipped.length, 2);
    assert.equal(r.filled.length, 0);
    assert.deepEqual(r.events, events);
});
