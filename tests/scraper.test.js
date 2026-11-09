// 執行：node --test tests/
// 官網公告的解析與合併 (scraper/parse.js)。範例 HTML 是照官網的結構簡化的。
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../scraper/parse.js');

const article = (title, bodyLines) => `<!DOCTYPE html><html><head>
<meta property="og:title" content="${title}｜怪物彈珠">
<script>var x = "轉蛋「腳本裡的字」";</script></head><body><main>
<h1>${title}</h1>
${bodyLines.map((l) => `<p>${l}</p>`).join('\n')}
</main></body></html>`;

test('公告列表：網址、標題、去除重複', () => {
    const html = `
      <a href="/news/20261029_bl.html" class="news-item__link" data-tracking="公告,お知らせ一覧,【藍色監獄×怪物彈珠】合作活動將於11月2日起開跑！">x</a>
      <a href="/news/覇者の塔.html" class="news-item__link" data-tracking="公告,お知らせ一覧,「霸者之塔」A,B">y</a>
      <a href="/news/20261029_bl.html" class="news-item__link" data-tracking="公告,お知らせ一覧,重複">z</a>
      <a href="https://evil.example.com/news/a.html" class="news-item__link" data-tracking="公告,お知らせ一覧,外站">w</a>
      <a class="footerRecommendedBanner__link" href="/news/20261101_01.html">banner</a>`;
    const items = P.parseNewsList(html);
    assert.equal(items.length, 2);
    assert.deepEqual(items[0], { url: 'https://www.monster-strike.com.tw/news/20261029_bl.html', title: '【藍色監獄×怪物彈珠】合作活動將於11月2日起開跑！' });
    assert.equal(items[1].title, '「霸者之塔」A,B');
    assert.ok(items[1].url.startsWith('https://www.monster-strike.com.tw/news/%E8%A6%87'));
});

test('HTML 轉文字：行內標籤不拆行、跳脫字元還原、略過 script', () => {
    const lines = P.htmlToLines('<p>轉蛋「<span>藍色監獄</span>」開跑！</p><div>A&amp;B&#12288;C</div><script>x</script>');
    assert.deepEqual(lines, ['轉蛋「藍色監獄」開跑！', 'A&B C']);
});

test('期間：各種寫法', () => {
    assert.deepEqual(P.parsePeriod('2026年11月2日（一）12:00～11月14日（六）11:59'), { date: '2026-11-02', endDate: '2026-11-14' });
    assert.deepEqual(P.parsePeriod('2026年10月30日 12:00〜11月05日 11:59'), { date: '2026-10-30', endDate: '2026-11-05' });
    assert.deepEqual(P.parsePeriod('2026年11月03日 18:00～2027年01月02日 11:59'), { date: '2026-11-03', endDate: '2027-01-02' });
    assert.deepEqual(P.parsePeriod('2026年12月28日 12:00～1月4日 11:59'), { date: '2026-12-28', endDate: '2027-01-04' });
    assert.equal(P.parsePeriod('版本更新完成後〜2026年11月15日 03:59'), null);
    assert.equal(P.parsePeriod('2026年11月11日 12:00～'), null);
});

test('期間：優先轉蛋活動期間，販售期間不算', () => {
    const lines = ['▼販售期間：', '2026年10月29日 19:00～11月05日 11:59', '▼活動期間：', '2026年10月30日 12:00〜11月05日 11:59'];
    assert.deepEqual(P.findPeriod(lines), { date: '2026-10-30', endDate: '2026-11-05' });
    const collab = ['▼活動期間：', '2026年11月01日 00:00～11月08日 23:59', '▼轉蛋活動期間：', '2026年11月2日（一）12:00～11月14日（六）11:59'];
    assert.deepEqual(P.findPeriod(collab), { date: '2026-11-02', endDate: '2026-11-14' });
    assert.equal(P.findPeriod(['▼販售期間：', '2026年11月01日 04:00～11月10日 03:59']), null);
});

test('轉蛋名稱：標題角色名不會被選到', () => {
    assert.equal(P.findGachaName('全新限定角色「馬克士威」登場！　「彩獸神祭」11月7日', '舉辦「彩獸神祭」轉蛋活動！'), '彩獸神祭');
    assert.equal(P.findGachaName('全新限定角色「卡古雅」登場！　「超獸神祭」10月30日', '可抽轉蛋「超獸神祭 -特別版-」10連×3次'), '超獸神祭');
    assert.equal(P.findGachaName('【藍色監獄×怪物彈珠】合作活動將於11月2日起開跑！', '轉蛋「藍色監獄」開跑！'), '藍色監獄');
    assert.equal(P.findGachaName('新活動', '全新「銀河冒險 II」轉蛋活動，將於…'), '銀河冒險 II');
    assert.equal(P.findGachaName('「蒲公英」11月11日真獸神化解禁', '蒲公英將解禁'), null);
});

test('標籤判斷', () => {
    assert.equal(P.guessTag('【藍色監獄×怪物彈珠】合作活動', '藍色監獄'), 'collab');
    assert.equal(P.guessTag('【怪物彈珠×黃泉使者】', '黃泉使者'), 'collab');
    assert.equal(P.guessTag('登入就送！免費10連', '免費10連轉蛋'), 'free');
    assert.equal(P.guessTag('「彩獸神祭」11月7日', '彩獸神祭'), 'honke');
});

test('解析公告：轉蛋活動', () => {
    const html = article('【藍色監獄×怪物彈珠】合作活動將於11月2日起開跑！', [
        '▼活動期間：', '2026年11月01日 00:00～11月08日 23:59',
        '轉蛋「<strong>藍色監獄</strong>」開跑！',
        '▼轉蛋活動期間：', '2026年11月2日（一）12:00～11月14日（六）11:59'
    ]);
    assert.deepEqual(P.parseArticle(html, 'https://www.monster-strike.com.tw/news/20261029_bl.html'), {
        event: '2026-11月 藍色監獄',
        date: '2026-11-02',
        endDate: '2026-11-14',
        tag: 'collab',
        source: 'https://www.monster-strike.com.tw/news/20261029_bl.html'
    });
});

test('解析公告：不是轉蛋活動、排除的活動、沒有期間', () => {
    const quest = article('「霸者之塔」11月7日登場', ['▼活動期間：', '2026年11月07日 12:00～12月01日 11:59']);
    assert.equal(P.parseArticle(quest, 'u'), null);
    const gift = article('11月「禮物轉蛋」活動登場', ['「禮物轉蛋」轉蛋活動', '▼活動期間：', '2026年11月01日 04:00～12月01日 03:59']);
    assert.equal(P.parseArticle(gift, 'u'), null);
    const noPeriod = article('「新轉蛋」登場', ['「新轉蛋」轉蛋活動即將舉辦']);
    assert.equal(P.parseArticle(noPeriod, 'u'), null);
});

test('合併：新增、補結束日、不重複、不改手動設定', () => {
    const existing = [
        { event: '2026-11月 藍色監獄', date: '2026-11-02', tag: 'collab' },
        { event: '2026-11月 彩獸神祭', date: '2026-11-07', endDate: '2026-11-10', tag: 'honke', aliases: ['舊名'] },
        { event: '2026-10月 黃泉使者', date: '2026-10-16', tag: 'collab', source: 'https://x/tk' }
    ];
    const scraped = [
        { event: '2026-11月 藍色監獄', date: '2026-11-02', endDate: '2026-11-14', tag: 'collab', source: 'https://x/bl' },
        { event: '2026-11月 彩・獸神祭', date: '2026-11-07', endDate: '2026-11-09', tag: 'free', source: 'https://x/sai' },
        { event: '2026-10月 黃泉使者', date: '2026-10-16', endDate: '2026-11-05', tag: 'collab', source: 'https://x/tk' },
        { event: '2026-11月 銀河冒險 II', date: '2026-11-02', endDate: '2026-11-15', tag: 'honke', source: 'https://x/ga' },
        null
    ];
    const { events, added, updated } = P.mergeEvents(existing, scraped);
    assert.deepEqual(added.map((e) => e.event), ['2026-11月 銀河冒險 II']);
    assert.deepEqual(updated.map((e) => e.event), ['2026-11月 藍色監獄', '2026-11月 彩獸神祭']);
    const blue = events.find((e) => e.event === '2026-11月 藍色監獄');
    assert.equal(blue.endDate, '2026-11-14');
    assert.equal(blue.source, 'https://x/bl');
    const sai = events.find((e) => e.event === '2026-11月 彩獸神祭');
    assert.equal(sai.endDate, '2026-11-10');     // 已有結束日，不改
    assert.equal(sai.tag, 'honke');              // 手動設定的標籤不改
    assert.deepEqual(sai.aliases, ['舊名']);
    assert.equal(events.find((e) => e.event === '2026-10月 黃泉使者').endDate, undefined);   // 抓過的公告跳過
    assert.equal(events.length, 4);
    assert.equal(events[0].date, '2026-11-07');   // 新的在前
    assert.equal(existing[0].endDate, undefined); // 不改到傳入的陣列
    assert.ok(added.every((e) => Object.values(e).every((v) => v !== undefined)));   // Firestore 不接受 undefined
});

test('比對名稱：同一天、名稱互相包含', () => {
    assert.ok(!P.sameEvent({ event: '2026-11月 銀河冒險 II', date: '2026-11-02' }, { event: '2026-11月 藍色監獄', date: '2026-11-02' }));
    assert.ok(P.sameEvent({ event: '2026-10月 《Re:從零開始的異世界生活》第2彈', date: '2026-10-01' }, { event: '2026-10月 Re：從零開始的異世界生活', date: '2026-10-01' }));
    assert.ok(!P.sameEvent({ event: '2026-11月 藍色監獄', date: '2026-11-02' }, { event: '2026-11月 藍色監獄', date: '2026-11-03' }));
});

test('轉蛋名稱：標題只有祭典名稱的公告、機率說明不是名稱', () => {
    const lines = ['▼活動期間：', '2023年10月30日（一）12:00～11月3日（五）11:59', '「超獸神祭」限定角色登場'];
    const html = lines.map((l) => `<p>${l}</p>`).join('');
    const a = P.parseArticle(html, 'https://www.monster-strike.com.tw/news/x.html', '充填魔力實現純白心願！　10月30日「超獸神祭」全新限定震撼登場');
    assert.equal(a.event, '2023-10月 超獸神祭');
    const b = P.parseArticle(html.replace('「超獸神祭」限定角色登場', '初次單抽・10連轉蛋「★5或以上角色的出現機率」24％！'),
        'https://www.monster-strike.com.tw/news/y.html', '初次單抽・10連轉蛋「★5或以上角色的出現機率」24％！　「MIDNIGHT PARTY」4月21日隆重登場');
    assert.equal(b.event, '2023-10月 MIDNIGHT PARTY');
});

test('比對名稱：第二彈和第2彈視為相同', () => {
    assert.equal(P.matchKey('2026-01月 葬送的芙莉蓮第二彈'), P.matchKey('2026-01月 葬送的芙莉蓮第2彈'));
});
