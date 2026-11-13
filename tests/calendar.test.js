// 執行：node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calendar.js');

test('日期：驗證與加減', () => {
    assert.ok(C.isValidDate('2026-02-28'));
    assert.ok(!C.isValidDate('2026-02-30'));
    assert.ok(!C.isValidDate('2026/02/01'));
    assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(C.addDays('2024-03-01', -1), '2024-02-29');
    assert.equal(C.daysBetween('2026-11-02', '2026-11-14'), 12);
});

test('月份切換：跨年', () => {
    assert.deepEqual(C.addMonths({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
    assert.deepEqual(C.addMonths({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
    assert.deepEqual(C.addMonths({ year: 2026, month: 11 }, -23), { year: 2024, month: 12 });
});

test('月曆格：從週日開始，整週排滿', () => {
    const weeks = C.monthWeeks({ year: 2026, month: 11 });   // 2026-11-01 是週日
    assert.equal(weeks[0][0].date, '2026-11-01');
    assert.equal(weeks.length, 5);
    assert.equal(weeks[4][6].date, '2026-12-05');
    assert.equal(weeks[4][6].inMonth, false);
    const feb = C.monthWeeks({ year: 2026, month: 2 });      // 2026-02-01 也是週日，剛好 4 週
    assert.equal(feb.length, 4);
    const dec = C.monthWeeks({ year: 2026, month: 12 });     // 12/1 週二
    assert.equal(dec[0][0].date, '2026-11-29');
    assert.ok(weeks.every((w) => w.length === 7));
});

test('整理活動：不正確的結束日當作沒有，排序，保留別名與來源', () => {
    const events = C.normalizeEvents([
        { event: '2026-11月  藍色監獄 ', date: '2026-11-02', tag: 'collab', endDate: '2026-11-14' },
        { event: '倒過來', date: '2026-11-05', endDate: '2026-11-01', tag: 'honke' },
        { event: '沒日期', tag: 'honke' },
        { event: '重複', date: '2026-10-01' },
        { event: '重複', date: '2026-10-09' },
        { event: '新名', date: '2026-10-02', tag: 'xx', aliases: ['舊名', '新名', 3], source: 'https://www.monster-strike.com.tw/news/a.html' },
        { event: '壞來源', date: '2026-10-03', source: 'javascript:alert(1)' }
    ]);
    assert.deepEqual(events.map((e) => e.event), ['重複', '新名', '壞來源', '2026-11月 藍色監獄', '倒過來']);
    assert.equal(events.find((e) => e.event === '倒過來').endDate, undefined);
    assert.equal(events.find((e) => e.event === '2026-11月 藍色監獄').endDate, '2026-11-14');
    const renamed = events.find((e) => e.event === '新名');
    assert.equal(renamed.tag, '');
    assert.deepEqual(renamed.aliases, ['舊名']);
    assert.ok(renamed.source);
    assert.equal(events.find((e) => e.event === '壞來源').source, undefined);
    assert.equal(events.find((e) => e.event === '重複').date, '2026-10-01');
    assert.deepEqual(C.normalizeEvents(null), []);
});

test('期間重疊：沒有結束日的只算開始那天', () => {
    const events = C.normalizeEvents([
        { event: 'A', date: '2026-10-25', endDate: '2026-11-03' },
        { event: 'B', date: '2026-10-31' },
        { event: 'C', date: '2026-11-30' },
        { event: 'D', date: '2026-12-01', endDate: '2026-12-10' }
    ]);
    assert.deepEqual(C.eventsInRange(events, '2026-11-01', '2026-11-30').map((e) => e.event), ['A', 'C']);
});

test('一週排版：長條不重疊、跨週標記', () => {
    const events = C.normalizeEvents([
        { event: '長', date: '2026-10-30', endDate: '2026-11-12' },
        { event: '短', date: '2026-11-03', endDate: '2026-11-04' },
        { event: '單日', date: '2026-11-03' },
        { event: '後面', date: '2026-11-06' }
    ]);
    const bars = C.layoutWeek(events, '2026-11-01');
    const byName = Object.fromEntries(bars.map((b) => [b.event.event, b]));
    assert.deepEqual([byName['長'].startCol, byName['長'].span, byName['長'].lane], [0, 7, 0]);
    assert.ok(byName['長'].continuesBefore && byName['長'].continuesAfter);
    assert.deepEqual([byName['短'].startCol, byName['短'].span, byName['短'].lane], [2, 2, 1]);
    assert.deepEqual([byName['單日'].startCol, byName['單日'].span, byName['單日'].lane], [2, 1, 2]);
    assert.equal(byName['後面'].lane, 1);   // 「短」結束後同一列可以再用
    assert.equal(byName['後面'].continuesAfter, false);
});

test('顯示名稱與期間文字', () => {
    assert.equal(C.displayName('2026-11月 藍色監獄'), '藍色監獄');
    assert.equal(C.displayName('2026年11月 藍色監獄'), '藍色監獄');
    assert.equal(C.displayName('沒有前綴'), '沒有前綴');
    assert.equal(C.displayName('2026-11月'), '2026-11月');
    assert.equal(C.formatPeriod({ date: '2026-11-02' }), '11/02');
    assert.equal(C.formatPeriod({ date: '2026-11-02', endDate: '2026-11-14' }), '11/02 – 11/14');
    assert.equal(C.formatPeriod({ date: '2026-12-28', endDate: '2027-01-05' }), '2026/12/28 – 2027/01/05');
});

test('抽數彙總：別名對應、帳號篩選、角色列出', () => {
    const events = C.normalizeEvents([
        { event: '2026-11月 藍色監獄', date: '2026-11-02', aliases: ['藍色監獄合作'] },
        { event: '2026-10月 黃泉使者', date: '2026-10-16' }
    ]);
    const records = [
        { id: 1, event: '藍色監獄合作', account: '梨花', pulls: 50, notes: '潔 世一*2' },
        { id: 2, event: '2026-11月 藍色監獄', account: '羽入', pulls: '40', notes: '凪 誠士郎' },
        { id: 3, event: '2026-11月 藍色監獄', account: '梨花', pulls: 10, notes: '' },
        { id: 4, event: '2026-10月 黃泉使者', account: '小號', pulls: -5 },
        { id: 5, event: '', account: '梨花', pulls: 99 },
        { id: 6, event: '2026-10月 黃泉使者', account: '', pulls: 99 },
        null
    ];
    const all = C.summarizePulls(records, events);
    const blue = all.get('2026-11月 藍色監獄');
    assert.equal(blue.total, 100);
    assert.deepEqual(blue.accounts.map((a) => [a.account, a.pulls]), [['羽入', 40], ['梨花', 60]]);
    assert.deepEqual(blue.accounts[1].notes, ['潔 世一*2']);
    assert.equal(all.get('2026-10月 黃泉使者').total, 0);
    assert.equal(all.has('藍色監獄合作'), false);

    const onlyRika = C.summarizePulls(records, events, '梨花');
    assert.equal(onlyRika.get('2026-11月 藍色監獄').total, 60);
    assert.equal(onlyRika.has('2026-10月 黃泉使者'), false);

    assert.deepEqual(C.accountNames(records), ['羽入', '梨花', '小號']);
    assert.equal(C.summarizePulls('壞資料', events).size, 0);
});

test('管理員編輯活動：只改這場活動的欄位，改名時記舊名稱，其他活動原樣保留', () => {
    const raw = [
        { event: '2024-09月 激獸神祭', date: '2024-09-11', tag: 'honke', aliases: ['更舊的名稱'], extra: 1 },
        { event: '2024-01月 其他活動', date: '2024-01-05', tag: 'free' }
    ];
    const url = 'https://www.monster-strike.com.tw/news/20240910_01.html';
    const out = C.applyEventEdit(raw, '2024-09月 激獸神祭', { event: '2024-09月 激獸神祭 (新角色)', date: '2024-09-11', endDate: '2024-09-14', tag: 'honke', source: url });
    assert.deepEqual(out[0], { event: '2024-09月 激獸神祭 (新角色)', date: '2024-09-11', tag: 'honke', aliases: ['更舊的名稱', '2024-09月 激獸神祭'], extra: 1, endDate: '2024-09-14', source: url });
    assert.deepEqual(out[1], raw[1]);
    assert.equal(raw[0].event, '2024-09月 激獸神祭');   // 不改動傳入的清單
    // 清掉結束日、標籤、網址；改回舊名稱時從 aliases 拿掉
    const cleared = C.applyEventEdit(out, '2024-09月 激獸神祭 (新角色)', { event: '2024-09月 激獸神祭', date: '2024-09-11', endDate: '', tag: '', source: '' });
    assert.deepEqual(cleared[0], { event: '2024-09月 激獸神祭', date: '2024-09-11', aliases: ['更舊的名稱', '2024-09月 激獸神祭 (新角色)'], extra: 1 });
    // 改開始日後依日期重新排序 (新的在前)
    const moved = C.applyEventEdit(raw, '2024-01月 其他活動', { event: '2024-01月 其他活動', date: '2025-01-05', tag: 'free' });
    assert.equal(moved[0].event, '2024-01月 其他活動');
});

test('管理員編輯活動：不合理的修改會被擋下', () => {
    const raw = [{ event: 'A', date: '2024-01-10' }, { event: 'B', date: '2024-01-11' }];
    const edit = (over, name = 'A') => () => C.applyEventEdit(raw, name, { event: 'A', date: '2024-01-10', ...over });
    assert.throws(edit({}, '不存在'), /找不到這場活動/);
    assert.throws(edit({ event: ' ' }), /不能是空白/);
    assert.throws(edit({ date: '2024-13-01' }), /開始日/);
    assert.throws(edit({ endDate: '2024-01-09' }), /結束日/);
    assert.throws(edit({ tag: 'x' }), /標籤/);
    assert.throws(edit({ source: 'https://example.com/a' }), /官網/);
    assert.throws(edit({ event: 'B' }), /已經有另一場活動/);
});

test('有參與的活動：免費都算，其他要有抽數；進行中和未來的活動一律算', () => {
    const events = C.normalizeEvents([
        { event: '免費', date: '2026-01-01', endDate: '2026-01-05', tag: 'free' },
        { event: '本家有抽', date: '2026-01-01', endDate: '2026-01-05', tag: 'honke' },
        { event: '本家沒抽', date: '2026-01-01', endDate: '2026-01-05', tag: 'honke' },
        { event: '合作零抽', date: '2026-01-01', endDate: '2026-01-05', tag: 'collab' },
        { event: '寶珠沒抽', date: '2026-01-01', tag: 'orb' },
        { event: '沒標籤沒抽', date: '2026-01-01' },
        { event: '進行中', date: '2026-02-01', endDate: '2026-02-10', tag: 'honke' },
        { event: '今天開始', date: '2026-02-05', tag: 'collab' },
        { event: '未來', date: '2026-03-01', tag: 'collab' }
    ]);
    const records = [
        { event: '本家有抽', account: '羽入', pulls: 30 },
        { event: '合作零抽', account: '羽入', pulls: 0 },
        { event: '本家沒抽', account: '梨花', pulls: 10 }
    ];
    const names = (account) => C.joinedEvents(events, C.summarizePulls(records, events, account), '2026-02-05').map((e) => e.event).sort();
    assert.deepEqual(names('羽入'), ['今天開始', '免費', '本家有抽', '未來', '進行中'].sort());
    assert.deepEqual(names('all'), ['今天開始', '免費', '本家有抽', '本家沒抽', '未來', '進行中'].sort());
});
