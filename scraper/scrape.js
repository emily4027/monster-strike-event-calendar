// 抓官網公告裡的轉蛋活動，新增到 Firestore 的 shared/events (抽卡統計和行事曆共用的活動清單)。
//
// 執行：
//   node scraper/scrape.js            正式執行，需要環境變數 FIREBASE_SERVICE_ACCOUNT (service account 金鑰 JSON)
//   node scraper/scrape.js --dry-run  只顯示會新增什麼，不寫入；活動清單改讀抽卡統計網站上的 events.json
//
// GitHub Actions 每天台灣時間中午 12:00 執行 (見 .github/workflows/scrape.yml)。
'use strict';

const fs = require('fs');
const path = require('path');
const { SITE, parseNewsList, parseArticle, mergeEvents } = require('./parse.js');

const NEWS_URL = `${SITE}/news/`;
const FALLBACK_EVENTS_URL = 'https://emily4027.github.io/monster-strike-gacha/events.json';
const LOG_FILE = path.join(__dirname, 'log.md');
// 處理過的轉蛋公告網址。活動被管理員刪掉後，公告還在列表上也不會再加回去
const SEEN_FILE = path.join(__dirname, 'seen.json');
const USER_AGENT = 'monster-strike-event-calendar-bot (+https://github.com/emily4027/monster-strike-event-calendar)';
const REQUEST_DELAY_MS = 1000;   // 每篇公告間隔，避免對官網送太多請求
const TAG_LABELS = { honke: '本家', collab: '合作', free: '免費', orb: '寶珠' };

function readSeen() {
    try {
        const list = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
        return Array.isArray(list) ? list.filter((u) => typeof u === 'string') : [];
    } catch (e) {
        return [];
    }
}

function saveSeen(seen, scraped) {
    const next = [...new Set([...seen, ...scraped.map((e) => e.source)])].sort();
    if (next.length !== seen.length) fs.writeFileSync(SEEN_FILE, JSON.stringify(next, null, 2) + '\n');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url) {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
    return response.text();
}

// 抓列表上還沒處理過的公告，回傳解析出的轉蛋活動
async function scrapeGachaEvents(knownSources) {
    const items = parseNewsList(await fetchText(NEWS_URL));
    // 一篇都讀不到 = 官網版面改了，讓 workflow 失敗，GitHub 會寄信通知
    if (items.length === 0) throw new Error('公告列表一篇都讀不到，官網版面可能改了，請檢查 scraper/parse.js');

    const found = [];
    for (const item of items) {
        if (knownSources.has(item.url)) continue;
        try {
            const event = parseArticle(await fetchText(item.url), item.url, item.title);
            if (event) found.push(event);
        } catch (error) {
            console.warn(`[略過] ${item.url}：${error.message}`);
        }
        await sleep(REQUEST_DELAY_MS);
    }
    console.log(`公告 ${items.length} 篇，轉蛋活動 ${found.length} 篇（已處理過的不重抓）`);
    return found;
}

const taipeiDate = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
const describe = (e) => `${e.event}（${e.date}${e.endDate ? ` ～ ${e.endDate}` : ''}，${TAG_LABELS[e.tag] || '未分類'}）`;

function printResult({ added, updated }) {
    added.forEach((e) => console.log(`[新增] ${describe(e)} ${e.source}`));
    updated.forEach((e) => console.log(`[補上] ${describe(e)} ${e.source || ''}`));
    if (!added.length && !updated.length) console.log('沒有新的轉蛋活動');
}

// 有變動時記到 scraper/log.md (新的在上面)；workflow 會 commit 這個檔案
function appendLog({ added, updated }) {
    if (!added.length && !updated.length) return;
    const lines = [`## ${taipeiDate()}`, ''];
    added.forEach((e) => lines.push(`- 新增：${describe(e)} [公告](${e.source})`));
    updated.forEach((e) => lines.push(`- 補上結束日 / 來源：${describe(e)}${e.source ? ` [公告](${e.source})` : ''}`));
    lines.push('', '');
    const header = '# 爬蟲紀錄\n\n每天自動新增到活動清單的轉蛋活動。名稱、標籤判斷錯誤時，請到抽卡統計的管理員介面修改。\n\n';
    const old = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8').replace(header, '') : '';
    fs.writeFileSync(LOG_FILE, header + lines.join('\n') + old);
}

async function dryRun() {
    const existing = JSON.parse(await fetchText(FALLBACK_EVENTS_URL));
    console.log(`[試跑] 活動清單讀抽卡統計的 events.json（${existing.length} 筆），不會寫入任何地方`);
    const scraped = await scrapeGachaEvents(new Set([...readSeen(), ...existing.map((e) => e.source).filter(Boolean)]));
    printResult(mergeEvents(existing, scraped));
}

async function run() {
    const { initializeApp, cert } = require('firebase-admin/app');
    const { getFirestore, FieldValue } = require('firebase-admin/firestore');
    initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    const db = getFirestore();
    const ref = db.collection('shared').doc('events');

    // 先讀一次清單，已處理過的公告就不用再抓
    const snap = await ref.get();
    const before = snap.exists && Array.isArray(snap.data().events) ? snap.data().events : [];
    if (before.length === 0) throw new Error('雲端活動清單是空的，為避免建立不完整的清單，先不寫入');
    const seen = readSeen();
    const scraped = await scrapeGachaEvents(new Set([...seen, ...before.map((e) => e.source).filter(Boolean)]));
    if (scraped.length === 0) { console.log('沒有新的轉蛋活動'); return; }

    // 寫入時在交易裡重新讀取，以最新的清單合併 (管理員剛好在改也不會被蓋掉)
    const result = await db.runTransaction(async (tx) => {
        const current = await tx.get(ref);
        const events = current.exists && Array.isArray(current.data().events) ? current.data().events : [];
        const merged = mergeEvents(events, scraped);
        if (merged.added.length || merged.updated.length) {
            tx.set(ref, { events: merged.events, updatedAt: FieldValue.serverTimestamp() });
        }
        return merged;
    });
    printResult(result);
    appendLog(result);
    saveSeen(seen, scraped);
}

const main = process.argv.includes('--dry-run') ? dryRun : run;
if (main === run && !process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.error('缺少環境變數 FIREBASE_SERVICE_ACCOUNT。只想看結果請加 --dry-run。');
    process.exit(1);
}
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
