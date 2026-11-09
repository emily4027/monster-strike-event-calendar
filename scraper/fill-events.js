// 一次性：把 scraper/fill-events.json 裡的結束日 (endDate)、公告連結 (source) 補進 Firestore 的活動清單 shared/events。
// 清單是歷史卡池回補時對到官網公告的舊活動，經管理員確認過。
//
// 執行：
//   node scraper/fill-events.js            正式寫入，需要環境變數 FIREBASE_SERVICE_ACCOUNT
//   node scraper/fill-events.js --dry-run  只顯示會補上什麼 (用 REST API 讀雲端清單，不需要金鑰)
//
// 只補空的欄位：活動名稱、開始日、標籤不改，已經有值的欄位不覆蓋。名稱或開始日對不上的活動跳過。
'use strict';

const fs = require('fs');
const path = require('path');
const { isValidDate } = require('../js/calendar.js');

const FILL_FILE = path.join(__dirname, 'fill-events.json');
const EVENTS_REST_URL = 'https://firestore.googleapis.com/v1/projects/ms-toolbox-web/databases/(default)/documents/shared/events';

// 套用到活動清單，回傳 { events, filled: [{ event, fields }], skipped: [{ event, reason }] }
function applyFill(events, fills) {
    const next = events.map((e) => ({ ...e }));
    const filled = [];
    const skipped = [];
    fills.forEach((f) => {
        const target = next.find((e) => e.event === f.event);
        if (!target) return skipped.push({ event: f.event, reason: '活動清單裡找不到這個名稱（可能改名了）' });
        if (target.date !== f.date) return skipped.push({ event: f.event, reason: `開始日不同（清單 ${target.date}，公告 ${f.date}）` });
        const fields = [];
        if (!target.endDate && f.endDate && isValidDate(f.endDate) && f.endDate >= target.date) {
            target.endDate = f.endDate;
            fields.push(`結束日 ${f.endDate}`);
        }
        if (!target.source && typeof f.source === 'string' && f.source.startsWith('https://www.monster-strike.com.tw/')) {
            target.source = f.source;
            fields.push('公告連結');
        }
        if (fields.length) filled.push({ event: f.event, fields });
    });
    return { events: next, filled, skipped };
}

function print({ filled, skipped }) {
    filled.forEach((f) => console.log(`[補上] ${f.event}：${f.fields.join('、')}`));
    skipped.forEach((s) => console.log(`[跳過] ${s.event}：${s.reason}`));
    console.log(`補上 ${filled.length} 場，跳過 ${skipped.length} 場`);
}

async function dryRun(fills) {
    const { fromFirestore } = require('./backfill.js');
    const doc = await (await fetch(EVENTS_REST_URL)).json();
    print(applyFill(fromFirestore(doc.fields.events), fills));
}

async function run(fills) {
    const { initializeApp, cert } = require('firebase-admin/app');
    const { getFirestore, FieldValue } = require('firebase-admin/firestore');
    initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    const db = getFirestore();
    const ref = db.collection('shared').doc('events');
    // 交易裡讀最新的清單再寫回 (管理員剛好在改也不會被蓋掉)
    const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const events = snap.exists && Array.isArray(snap.data().events) ? snap.data().events : [];
        if (events.length === 0) throw new Error('雲端活動清單是空的，先不寫入');
        const applied = applyFill(events, fills);
        if (applied.filled.length) tx.set(ref, { events: applied.events, updatedAt: FieldValue.serverTimestamp() });
        return applied;
    });
    print(result);
}

if (require.main === module) {
    const fills = JSON.parse(fs.readFileSync(FILL_FILE, 'utf8'));
    const dry = process.argv.includes('--dry-run');
    if (!dry && !process.env.FIREBASE_SERVICE_ACCOUNT) {
        console.error('缺少環境變數 FIREBASE_SERVICE_ACCOUNT。只想看結果請加 --dry-run。');
        process.exit(1);
    }
    (dry ? dryRun : run)(fills).catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = { applyFill };
