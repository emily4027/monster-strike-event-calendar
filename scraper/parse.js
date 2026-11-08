// 官網公告的解析與合併：純函式，不連網路、不碰資料庫 (有自動化測試，見 tests/scraper.test.js)
'use strict';

const SITE = 'https://www.monster-strike.com.tw';

// 標題或轉蛋名稱有這些字的公告不算轉蛋活動 (送給好友的轉蛋、集能量召喚之類)
const EXCLUDE_KEYWORDS = ['禮物轉蛋', '轉蛋小龍'];

// ---- HTML → 純文字 ----
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, code) => {
        if (code[0] === '#') {
            const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
            return Number.isFinite(n) ? String.fromCodePoint(n) : m;
        }
        return ENTITIES[code.toLowerCase()] !== undefined ? ENTITIES[code.toLowerCase()] : m;
    });
}

// 區塊元素換行，行內元素 (span、strong…) 直接拿掉，同一句話才不會被拆開
function htmlToLines(html) {
    const body = String(html)
        .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?(p|div|li|ul|ol|h[1-6]|tr|td|th|table|section|article|header|footer|dt|dd|dl)\b[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, '');
    return decodeEntities(body)
        .split('\n')
        .map((line) => line.replace(/[ \t　]+/g, ' ').trim())
        .filter(Boolean);
}

// ---- 公告列表 ----
// <a href="/news/xxx.html" class="news-item__link" data-tracking="公告,お知らせ一覧,標題">
function parseNewsList(html) {
    const items = [];
    const seen = new Set();
    const re = /<a\b[^>]*class="news-item__link"[^>]*>/g;
    let m;
    while ((m = re.exec(html))) {
        const tag = m[0];
        const href = (tag.match(/href="([^"]+)"/) || [])[1];
        const tracking = (tag.match(/data-tracking="([^"]*)"/) || [])[1] || '';
        if (!href) continue;
        const url = new URL(decodeEntities(href), SITE + '/news/').href;
        if (!url.startsWith(SITE + '/news/') || seen.has(url)) continue;
        seen.add(url);
        const title = decodeEntities(tracking).split(',').slice(2).join(',').trim();
        items.push({ url, title });
    }
    return items;
}

// ---- 公告內容 ----
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// 「2026年11月2日（一）12:00～11月14日（六）11:59」→ { date, endDate }
// 結束日沒寫年份時沿用開始的年份；結束月份比開始小代表跨年
const PERIOD_RE = /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日[^～〜~\n]*?[～〜~]\s*(?:(\d{4})年\s*)?(\d{1,2})月\s*(\d{1,2})日/;
function parsePeriod(line) {
    const m = String(line).match(PERIOD_RE);
    if (!m) return null;
    const [, y1, m1, d1, y2, m2, d2] = m.map((v) => (v === undefined ? v : Number(v)));
    let endYear = y2 || y1;
    if (!y2 && m2 < m1) endYear += 1;
    const date = ymd(y1, m1, d1);
    const endDate = ymd(endYear, m2, d2);
    if (endDate < date) return null;
    return { date, endDate };
}

// 期間：優先找「▼轉蛋活動期間」，其次「▼活動期間」(販售期間、BGM 變更期間等不算)
function findPeriod(lines) {
    const labels = [/^▼?轉蛋(活動)?期間/, /^▼?活動期間/];
    for (const label of labels) {
        for (let i = 0; i < lines.length; i++) {
            if (!label.test(lines[i])) continue;
            for (let j = i; j < Math.min(i + 3, lines.length); j++) {
                const period = parsePeriod(lines[j]);
                if (period) return period;
            }
        }
    }
    return null;
}

const quoted = (s) => [...String(s).matchAll(/「([^「」]+)」/g)].map((m) => m[1].trim()).filter(Boolean);

// 轉蛋名稱：
//   1. 標題裡「X」，而且內文有「X」轉蛋 或 轉蛋「X…」 (彩獸神祭、銀河冒險 II…；標題前面的角色名不會被選到。
//      內文寫 轉蛋「超獸神祭 -特別版-」時，用標題的「超獸神祭」)
//   2. 內文的 轉蛋「X」 (合作活動常見的寫法：轉蛋「藍色監獄」)
//   3. 內文的「X」轉蛋活動
function findGachaName(title, text) {
    const fromTitle = quoted(title).find((x) => text.includes(`「${x}」轉蛋`) || text.includes(`轉蛋「${x}`));
    if (fromTitle) return fromTitle;
    const m2 = text.match(/轉蛋「([^「」]+)」/);
    if (m2) return m2[1].trim();
    const m3 = text.match(/「([^「」]+)」轉蛋活動/);
    if (m3) return m3[1].trim();
    return null;
}

const COLLAB_RE = /×\s*怪物彈珠|怪物彈珠\s*×|合作/;
const FREE_RE = /免費|登入|無料/;
function guessTag(title, name) {
    if (COLLAB_RE.test(title)) return 'collab';
    if (FREE_RE.test(title) || FREE_RE.test(name)) return 'free';
    return 'honke';
}

// 解析一篇公告：是轉蛋活動就回傳 { event, date, endDate, tag, source }，不是就回傳 null
function parseArticle(html, url, listTitle = '') {
    const lines = htmlToLines(html);
    const text = lines.join('\n');
    const ogTitle = (String(html).match(/<meta\s+property="og:title"\s+content="([^"]*)"/) || [])[1];
    const title = listTitle || (ogTitle ? decodeEntities(ogTitle) : '');
    const name = findGachaName(title, text);
    if (!name) return null;
    if (EXCLUDE_KEYWORDS.some((k) => title.includes(k) || name.includes(k))) return null;
    const period = findPeriod(lines);
    if (!period) return null;
    return {
        event: `${period.date.slice(0, 4)}-${period.date.slice(5, 7)}月 ${name}`,
        date: period.date,
        endDate: period.endDate,
        tag: guessTag(title, name),
        source: url
    };
}

// ---- 合併到活動清單 ----
// 比對用的名稱：去掉「YYYY-MM月」、括號、空白與標點，英文轉小寫，全形英數轉半形
function matchKey(name) {
    return String(name)
        .replace(/^\d{4}[-年/]\d{1,2}月?\s*/, '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s「」『』《》【】()（）・･\-‐－—~〜～!！?？.,，、:：]/g, '');
}

function sameEvent(existing, scraped) {
    if (existing.date !== scraped.date) return false;
    const a = matchKey(existing.event);
    const b = matchKey(scraped.event);
    return !!a && !!b && (a.includes(b) || b.includes(a));
}

// 只新增、不刪除，也不改你手動設定的名稱、日期、標籤。
// 已經抓過的公告 (source 相同) 跳過；同一天開始、名稱互相包含的活動視為同一場，只補上缺少的 endDate / source。
function mergeEvents(existing, scrapedList) {
    const events = existing.map((e) => ({ ...e }));
    const added = [];
    const updated = [];
    for (const s of scrapedList) {
        if (!s) continue;
        if (events.some((e) => e.source === s.source)) continue;
        const match = events.find((e) => e.event === s.event || sameEvent(e, s));
        if (match) {
            let changed = false;
            if (!match.endDate && s.endDate) { match.endDate = s.endDate; changed = true; }
            if (!match.source) { match.source = s.source; changed = true; }
            if (changed) updated.push(match);
            continue;
        }
        const entry = { event: s.event, date: s.date, endDate: s.endDate, tag: s.tag, source: s.source };
        events.push(entry);
        added.push(entry);
    }
    // 和抽卡統計一樣，新的活動排前面
    events.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    return { events, added, updated };
}

module.exports = {
    SITE, EXCLUDE_KEYWORDS,
    htmlToLines, parseNewsList, parsePeriod, findPeriod, findGachaName, guessTag, parseArticle,
    matchKey, sameEvent, mergeEvents
};
