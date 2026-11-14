// 把管理員在角色頁編輯模式做的修改 (Firestore shared/roster) 寫回 characters.json 和 pools.json。
// GitHub Actions 每天執行爬蟲時跑一次，改到的檔案直接 commit 到 main (管理員自己的修改，不用再開 PR)。
//
// 執行：FIREBASE_SERVICE_ACCOUNT='<金鑰 JSON>' node scraper/fold-roster.js [--skip-adds] [--dry-run]
//   --skip-adds：還沒有編號的新角色這次先不編號。有開著的卡池 PR 時用：PR 裡可能也替新角色編了號，
//                兩邊各編各的會撞號，等 PR 處理完再編
//   --dry-run：只印出會改什麼，不寫檔、不改 Firestore
//
// 流程 (中途失敗重跑也不會出錯)：
//   1. 修改檔裡「已經在 characters.json 裡」的部分 (上次寫回並 commit 的) 從 Firestore 清掉
//   2. 剩下的修改寫回檔案。這次寫回的部分留在 Firestore，等下次執行、確定已經 commit 了才清掉
'use strict';

const fs = require('fs');
const path = require('path');
const R = require('../roster.js');
const { formatPoolsJson } = require('./pool-parse.js');

const POOLS_FILE = path.join(__dirname, '..', 'pools.json');
const ROSTER_FILE = path.join(__dirname, '..', 'characters.json');
const readText = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const skipAdds = process.argv.includes('--skip-adds');
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('沒有設定 FIREBASE_SERVICE_ACCOUNT');
    const { initializeApp, cert } = require('firebase-admin/app');
    const { getFirestore, FieldValue } = require('firebase-admin/firestore');
    initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    const ref = getFirestore().collection('shared').doc('roster');

    const rosterText = readText(ROSTER_FILE);
    const poolsText = readText(POOLS_FILE);
    const committed = JSON.parse(rosterText);
    const committedPools = JSON.parse(poolsText);
    const snap = await ref.get();
    if (!snap.exists) { console.log('名冊：沒有管理員的修改'); return; }
    const edits = R.readEdits(snap.data());

    // 1. 已經寫回並 commit 的部分清掉 (transaction：不會蓋掉管理員剛好在這時候存的修改)
    if (!dryRun) {
        await getFirestore().runTransaction(async (tx) => {
            const latest = await tx.get(ref);
            const now = R.readEdits(latest.exists ? latest.data() : null);
            const pruned = R.pruneEdits(committed, now, committedPools);
            if (!same(pruned, now)) tx.set(ref, { ...pruned, updatedAt: FieldValue.serverTimestamp() });
        });
    }

    // 2. 剩下的寫回檔案
    const out = R.foldEdits(committed, committedPools, R.pruneEdits(committed, edits, committedPools), { skipAdds });
    const newRoster = R.formatRoster(out.data);
    const newPools = formatPoolsJson(out.pools);
    console.log(`名冊：寫回 ${out.changed} 項修改${out.skipped ? `，${out.skipped} 隻新角色等卡池 PR 處理完再編號` : ''}`);
    if (dryRun) return;
    if (newRoster !== rosterText) fs.writeFileSync(ROSTER_FILE, newRoster);
    if (newPools !== poolsText) fs.writeFileSync(POOLS_FILE, newPools);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
