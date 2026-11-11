// 一次性的歷史卡池回補：從官網公告列表往回翻到指定日期，讀每一篇轉蛋公告的卡池角色，
// 對應到活動清單裡的活動後存成卡池資料檔 (格式和 scrape.js --pool-items 相同)，再由 apply-pools.js 開 PR。
//
// 執行：node scraper/backfill.js <卡池資料.json> [--since 2023-09-01] [--cache <資料夾>]
//   --cache：讀過的公告內文存在這個資料夾，重跑時不用再讀 (舊公告的內容不會變；
//            公告列表和活動清單每次都重新讀)。GitHub Actions 用 actions/cache 保存這個資料夾
//   活動清單讀 Firestore shared/events (所有人可讀，用 REST API，不需要金鑰)
//   只讀官網和活動清單，不寫入任何雲端文件
'use strict';

const fs = require('fs');
const path = require('path');
const { SITE, parseNewsList, parseArticle, matchKey } = require('./parse.js');
const { extractPoolData } = require('./pool-parse.js');

const EVENTS_REST_URL = 'https://firestore.googleapis.com/v1/projects/ms-toolbox-web/databases/(default)/documents/shared/events';
const USER_AGENT = 'monster-strike-gacha-data-bot (+https://github.com/emily4027/monster-strike-gacha-data)';
const REQUEST_DELAY_MS = 1000;
const MAX_LIST_PAGES = 200;
// 標題看起來可能是轉蛋公告的才讀內文 (其他公告：維護、商店、冒險…)
const GACHA_TITLE_RE = /轉蛋|祭|合作|×|限定|世代|精選|幻想|遊宴|火焰之星|starlight|midnight|新角色/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cacheIndex = process.argv.indexOf('--cache');
const CACHE_DIR = cacheIndex !== -1 ? process.argv[cacheIndex + 1] : '';
// 只快取公告內文 (/news/20240903_01.html 這種)；列表頁會有新公告，每次都重新讀
const isArticle = (url) => /\/news\/\d{8}_[^/]+\.html$/.test(url);
let lastFetchFromNetwork = false;
async function fetchText(url) {
    const cacheFile = CACHE_DIR && isArticle(url) ? path.join(CACHE_DIR, url.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_')) : '';
    if (cacheFile && fs.existsSync(cacheFile)) {
        lastFetchFromNetwork = false;
        return fs.readFileSync(cacheFile, 'utf8');
    }
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
    const text = await response.text();
    if (cacheFile) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(cacheFile, text);
    }
    lastFetchFromNetwork = true;
    return text;
}
const politeWait = () => (lastFetchFromNetwork ? sleep(REQUEST_DELAY_MS) : Promise.resolve());

// Firestore REST 的型別值 → 一般的值
function fromFirestore(value) {
    if (!value || typeof value !== 'object') return undefined;
    if ('stringValue' in value) return value.stringValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return value.doubleValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('nullValue' in value) return null;
    if ('timestampValue' in value) return value.timestampValue;
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestore);
    if ('mapValue' in value) {
        const out = {};
        Object.entries(value.mapValue.fields || {}).forEach(([k, v]) => { out[k] = fromFirestore(v); });
        return out;
    }
    return undefined;
}

async function loadEvents() {
    const doc = JSON.parse(await fetchText(EVENTS_REST_URL));
    const list = fromFirestore(doc.fields && doc.fields.events);
    if (!Array.isArray(list) || list.length === 0) throw new Error('讀不到雲端活動清單');
    return list.filter((e) => e && typeof e.event === 'string' && typeof e.date === 'string');
}

// 活動清單裡的一場活動 → 它的官網公告：公告網址相同，或開始日相差 7 天內、名稱互相包含，
//   有好幾篇時取開始日最接近的 (清單的開始日有時是手動記的，和公告差一兩天)
const MATCH_DAYS = 7;
function findArticle(parsed, event) {
    const bySource = parsed.find((p) => p.scraped.source === event.source);
    if (bySource) return bySource;
    const key = matchKey(event.event);
    const days = (p) => Math.abs(Date.parse(p.scraped.date) - Date.parse(event.date)) / 86400000;
    return parsed
        .filter((p) => days(p) <= MATCH_DAYS)
        .filter((p) => {
            // 公告判斷出的轉蛋名稱，或公告裡任何一個轉蛋段落的名稱
            const names = [p.scraped.event, ...((p.data && p.data.collab) || []).map((s) => s.gachaName).filter(Boolean)];
            return names.some((n) => {
                const k = matchKey(n);
                return k && key && (k.includes(key) || key.includes(k));
            });
        })
        .sort((x, y) => days(x) - days(y))[0] || null;
}

// 公告網址裡的日期：/news/20240903_01.html → 2024-09-03
const urlDate = (url) => {
    const m = url.match(/\/(\d{4})(\d{2})(\d{2})_[^/]*\.html$/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};

// 公告列表往回翻，直到整頁都比 cutoff 早
async function listArticles(cutoff) {
    const all = [];
    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
        const url = page === 1 ? `${SITE}/news/` : `${SITE}/news/index_${page}.html`;
        const items = parseNewsList(await fetchText(url));
        if (items.length === 0) break;
        all.push(...items);
        const dates = items.map((i) => urlDate(i.url)).filter(Boolean);
        process.stdout.write(`\r公告列表第 ${page} 頁 (${dates[dates.length - 1] || '?'})`);
        if (dates.length > 0 && dates.every((d) => d < cutoff)) break;
        await politeWait();
    }
    process.stdout.write('\n');
    return all.filter((i) => (urlDate(i.url) || '9999') >= cutoff);
}

async function main() {
    const out = process.argv[2];
    const sinceIndex = process.argv.indexOf('--since');
    const since = sinceIndex !== -1 ? process.argv[sinceIndex + 1] : '2023-09-01';
    if (!out || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
        console.error('用法：node scraper/backfill.js <卡池資料.json> [--since YYYY-MM-DD]');
        process.exit(1);
    }
    // 公告通常比活動早幾天發，列表往前多翻一點
    const cutoff = new Date(Date.parse(since) - 14 * 86400000).toISOString().slice(0, 10);

    const events = (await loadEvents()).filter((e) => e.date >= since && (e.tag === 'honke' || e.tag === 'collab'));
    console.log(`活動清單：${since} 起的本家 / 合作活動 ${events.length} 場`);

    const articles = (await listArticles(cutoff)).filter((a) => GACHA_TITLE_RE.test(a.title));
    console.log(`可能是轉蛋公告的有 ${articles.length} 篇，逐篇讀取（每篇間隔 ${REQUEST_DELAY_MS / 1000} 秒）`);

    // 先讀完所有轉蛋公告，再幫每場活動找開始日最接近的那篇
    const parsed = [];
    for (const [i, article] of articles.entries()) {
        process.stdout.write(`\r${i + 1}/${articles.length}`);
        try {
            const html = await fetchText(article.url);
            const scraped = parseArticle(html, article.url, article.title);
            if (scraped) parsed.push({ scraped, data: extractPoolData(html) });
        } catch (error) {
            console.warn(`\n[略過] ${article.url}：${error.message}`);
        }
        await politeWait();
    }
    process.stdout.write('\n');
    console.log(`轉蛋公告 ${parsed.length} 篇`);

    const items = [];
    const matched = new Set();
    events.forEach((event) => {
        const found = findArticle(parsed, event);
        if (!found) return;
        matched.add(event.event);
        items.push({ event: { event: event.event, date: event.date, tag: event.tag, source: found.scraped.source }, data: found.data });
    });

    // 活動清單裡沒有的本家祭典也記下那期的名單 (只加進已經有的卡池，不新增卡池、不標出來)，
    // 之後的合作祭典公告漏寫本家限定角色時，才有「之前最近一期」的名單可以沿用
    const used = new Set(items.map((i) => i.event.source));
    parsed.filter((p) => p.scraped.tag === 'honke' && p.scraped.date >= since && !used.has(p.scraped.source) && p.data.limited.length > 0)
        .forEach((p) => items.push({
            event: { event: p.scraped.event, date: p.scraped.date, tag: 'honke', source: p.scraped.source, unlogged: true },
            data: p.data
        }));

    // 對不上公告的活動列出來，不用猜的
    const flags = events.filter((e) => !matched.has(e.event))
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((e) => ({ event: e.event, source: '', message: '找不到對應的官網公告（名稱或開始日和公告不同，或官網沒有另外發公告），卡池沒有更新' }));
    fs.writeFileSync(out, JSON.stringify({ items, flags }, null, 2));
    console.log(`對應到 ${matched.size} 場活動，對不上 ${flags.length} 場；另外記下清單沒有的祭典 ${items.length - matched.size} 篇；存到 ${out}`);
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = { fromFirestore };
