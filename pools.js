// =====================================================
// 卡池：活動 → 可以抽到的角色 (純函式，不碰 DOM)
// 瀏覽器：window.CharacterPools；Node (測試)：require('./pools.js')
//
// 抽卡統計會從 /monster-strike-gacha-data/pools.js 載入這支檔案和 pools.json (舊網址 /monster-strike-character-catalog/ 過渡期間也保留一份)，
// 選好活動後把卡池角色列成按鈕。改動函式名稱或 pools.json 格式時，抽卡統計要一起確認。
// =====================================================
(function (root) {
    'use strict';

    // 比對用的名稱：全形英數轉半形、去掉空白與間隔號、不分大小寫、拿掉結尾標點
    //   「彩・獸神祭」→「彩獸神祭」、「惠比天少女組。」→「惠比天少女組」、「Midnight Party」→「midnightparty」
    function poolKey(name) {
        return String(name || '')
            .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
            .replace(/[\s·・‧•.]/g, '')
            .toLowerCase()
            .replace(/[。，,、!?]+$/, '');
    }

    // pools.json → [{ pool, kind, match: [[關鍵字...]], since, chars }]
    //   kind：limited (常設轉蛋活動的限定角色) | collab (合作活動的角色)
    //   match：活動名稱含有其中一組的「全部」關鍵字就算這個卡池，例如 "世代+2015"；省略時用卡池名稱
    //   since：選填，"YYYY-MM"。同一個卡池的角色會隨時間變動 (新增限定角色、移到別的卡池)，
    //          所以同名卡池可以有好幾個版本，每期活動用「since 不晚於活動年月」中最新的版本；
    //          沒有 since 的是預設版本，活動比所有版本都早、或活動名稱沒有年月時使用
    const SINCE_RE = /^\d{4}-\d{2}$/;
    function readPools(data) {
        const list = data && Array.isArray(data.pools) ? data.pools : [];
        return list
            .filter((p) => p && typeof p.pool === 'string' && Array.isArray(p.chars)
                && (p.kind === 'limited' || p.kind === 'collab'))
            .map((p) => ({
                pool: p.pool,
                kind: p.kind,
                match: (Array.isArray(p.match) && p.match.length > 0 ? p.match : [p.pool])
                    .map((m) => String(m).split('+').map(poolKey).filter(Boolean))
                    .filter((parts) => parts.length > 0),
                since: typeof p.since === 'string' && SINCE_RE.test(p.since) ? p.since : '',
                chars: p.chars.filter((c) => typeof c === 'string' && c.trim()).map((c) => c.trim())
            }));
    }

    // 活動名稱開頭的年月：「2026-11月 彩獸神祭」→ "2026-11"；沒有時回傳空字串
    function eventMonth(eventName) {
        const m = String(eventName || '').trim().match(/^(\d{4})-(\d{1,2})月/);
        return m ? `${m[1]}-${m[2].padStart(2, '0')}` : '';
    }

    // 同名卡池的版本中，挑這期活動要用的那個 (見 readPools 的 since 說明)
    function pickVersion(versions, month) {
        const base = versions.find((v) => !v.since);
        if (!month) return base || versions[versions.length - 1];
        const usable = versions.filter((v) => v.since && v.since <= month)
            .sort((a, b) => (a.since < b.since ? 1 : -1));
        return usable[0] || base || null;
    }

    // 活動名稱 → 符合的卡池 (合作在前，同類依 pools.json 的順序；同名卡池只取這期的版本)
    //   「2025-10月 超獸神祭×鬼滅之刃」→ [鬼滅之刃 (collab), 超獸神祭 (limited)]
    function poolsForEvent(pools, eventName) {
        const key = poolKey(eventName);
        if (!key) return [];
        const month = eventMonth(eventName);
        const byName = new Map();
        pools.forEach((p) => {
            if (!p.match.some((parts) => parts.every((part) => key.includes(part)))) return;
            if (!byName.has(p.pool)) byName.set(p.pool, []);
            byName.get(p.pool).push(p);
        });
        const found = [...byName.values()].map((versions) => pickVersion(versions, month)).filter(Boolean);
        return [...found.filter((p) => p.kind === 'collab'), ...found.filter((p) => p.kind === 'limited')];
    }

    // 角色名稱 → 它所在的限定卡池 (不在名單上回傳空字串)
    //   先看預設版本 (官網限定角色名單，每隻角色只屬於一個卡池)；
    //   預設版本沒有的角色 (之後才登場) 再看 since 版本：最早出現的版本優先，同時出現時名單短的優先。
    //   since 版本是「那期轉蛋抽得到的角色」，可能包含其他祭典的限定角色，所以不能先看
    function buildLimitedLookup(pools) {
        const byKey = new Map();
        const limited = pools.filter((p) => p.kind === 'limited');
        const add = (p) => p.chars.forEach((name) => {
            const key = poolKey(name);
            if (key && !byKey.has(key)) byKey.set(key, p.pool);
        });
        limited.filter((p) => !p.since).forEach(add);
        limited.filter((p) => p.since)
            .sort((a, b) => a.since.localeCompare(b.since) || a.chars.length - b.chars.length)
            .forEach(add);
        return (name) => byKey.get(poolKey(name)) || '';
    }

    // =====================================================
    // 名稱修正 (Firestore shared/characters，管理員維護，所有人可讀)
    //   { renames: [{ from, to }], distinct: [{ a, b }] }
    //   renames：抽卡紀錄裡寫錯的名稱 → 正確名稱 (只影響顯示，不改寫紀錄)
    //   distinct：「疑似相同」但確認是不同角色的兩個名稱，不再提示
    // =====================================================
    const cleanName = (n) => (typeof n === 'string' ? n.trim() : '');
    const pairKey = (a, b) => [a, b].sort().join('\u0000');

    function readNameFixes(data) {
        const renames = new Map();
        const distinct = new Set();
        (data && Array.isArray(data.renames) ? data.renames : []).forEach((r) => {
            const from = cleanName(r && r.from);
            const to = cleanName(r && r.to);
            if (from && to && from !== to) renames.set(from, to);
        });
        (data && Array.isArray(data.distinct) ? data.distinct : []).forEach((d) => {
            const a = cleanName(d && d.a);
            const b = cleanName(d && d.b);
            if (a && b && a !== b) distinct.add(pairKey(a, b));
        });
        return { renames, distinct };
    }

    // 名稱 → 修正後的名稱 (可以連續修正 A→B→C；繞回自己時停在原本的名稱)
    function resolveName(fixes, name) {
        let current = name;
        const seen = new Set([current]);
        while (fixes && fixes.renames.has(current)) {
            const next = fixes.renames.get(current);
            if (seen.has(next)) return name;
            seen.add(next);
            current = next;
        }
        return current;
    }

    const isDistinct = (fixes, a, b) => !!fixes && fixes.distinct.has(pairKey(a, b));

    // 在 shared/characters 的資料上套用一個修改，回傳新的資料 (不改動傳入的物件)
    //   { type: 'rename', from, to }：from 改顯示成 to
    //   { type: 'unrename', from }：取消 from 的修正
    //   { type: 'distinct', a, b } / { type: 'undistinct', a, b }：標記 / 取消「不同角色」
    // 不合理的修改 (空白名稱、改成自己、會繞回自己) 會丟出錯誤，訊息可以直接顯示給使用者
    function applyNameFix(data, op) {
        const renames = (data && Array.isArray(data.renames) ? data.renames : [])
            .filter((r) => r && cleanName(r.from) && cleanName(r.to)).map((r) => ({ from: cleanName(r.from), to: cleanName(r.to) }));
        let distinct = (data && Array.isArray(data.distinct) ? data.distinct : [])
            .filter((d) => d && cleanName(d.a) && cleanName(d.b)).map((d) => ({ a: cleanName(d.a), b: cleanName(d.b) }));
        const type = op && op.type;

        if (type === 'rename') {
            const from = cleanName(op.from);
            const to = cleanName(op.to);
            if (!from || !to) throw new Error('名稱不能是空白');
            if (from === to) throw new Error('新名稱和原本的名稱一樣');
            const next = renames.filter((r) => r.from !== from);
            next.push({ from, to });
            // from 有修正卻解析回自己 = 形成循環 (例如原本就有 to → from)
            if (resolveName(readNameFixes({ renames: next }), from) === from) {
                throw new Error(`「${to}」已經被修正成其他名稱，會繞回「${from}」`);
            }
            // 兩個名稱合併成同一隻後，「不同角色」的標記就沒有意義了
            distinct = distinct.filter((d) => pairKey(d.a, d.b) !== pairKey(from, to));
            return { renames: next, distinct };
        }
        if (type === 'unrename') {
            const from = cleanName(op.from);
            return { renames: renames.filter((r) => r.from !== from), distinct };
        }
        if (type === 'distinct' || type === 'undistinct') {
            const a = cleanName(op.a);
            const b = cleanName(op.b);
            if (!a || !b || a === b) throw new Error('要選兩個不同的名稱');
            const rest = distinct.filter((d) => pairKey(d.a, d.b) !== pairKey(a, b));
            return { renames, distinct: type === 'distinct' ? [...rest, { a, b }] : rest };
        }
        throw new Error('不認得的修改');
    }

    const api = {
        poolKey, readPools, eventMonth, poolsForEvent, buildLimitedLookup,
        readNameFixes, resolveName, isDistinct, applyNameFix
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.CharacterPools = api;
})(this);
