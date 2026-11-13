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

    // pools.json → [{ pool, kind, match: [[關鍵字...]], months: ['YYYY-MM'...], chars }]
    //   kind：limited (常設轉蛋活動的限定角色) | collab (合作活動的角色)
    //   match：活動名稱含有其中一組的「全部」關鍵字就算這個卡池，例如 "世代+2015"；省略時用卡池名稱
    //          "=名稱" 表示活動名稱 (去掉開頭的年月) 要和它完全相同。一篇公告同時開好幾個卡池時用
    //          (「怪物彈珠世代」同時開 2019、2018…各年份的卡池：各年份那個月的版本都加上 "=怪物彈珠世代")
    //   months：限定卡池用。這個名單是哪幾個月的活動 (取自那期官網公告)，例如 ["2024-09"]。
    //           同一個卡池每期的角色不同 (新增限定角色、移到別的卡池)，所以每期公告各自一個版本；
    //           名單相同的期數共用一個版本。活動只用「自己那個月」的版本，不會沿用別期的名單，
    //           沒有那個月的版本時不顯示這個卡池 (寧可沒有，也不要顯示錯的)。
    //           沒有 months 的是預設版本 (官網限定角色名單)，只用來標出角色屬於哪個限定卡池。
    //           舊格式的 since ("YYYY-MM") 當成 months: [since] 讀
    //   rerun：合作卡池用。true = 那期合作活動同時複刻的前幾彈 (卡池名稱是「主卡池・複刻 N」)，畫面上和這期的新角色分開顯示
    //   label：選填。複刻的卡池在畫面上的標題 (「第1彈」，或那個轉蛋自己的名稱)，沒有時顯示卡池名稱
    //   variant：選填。同一個月有兩個名單不同的同名轉蛋時，活動名稱含有這段文字的才用這個版本
    //   chars：角色名冊 (characters.json) 的編號，例如 "c0012"。讀進來時換成名稱：
    //          用傳入的 names ({ 編號: 名稱 })，沒有傳時用 pools.json 自己附的 names (寫檔時從名冊產生)。
    //          查不到名稱的編號會略過；不是編號的字串當成名稱 (舊格式)
    const ID_RE = /^c\d{4,}$/;
    const MONTH_RE = /^\d{4}-\d{2}$/;
    function readMonths(p) {
        const list = Array.isArray(p.months) ? p.months : (typeof p.since === 'string' ? [p.since] : []);
        return [...new Set(list.filter((m) => typeof m === 'string' && MONTH_RE.test(m)))].sort();
    }
    function readPools(data, names) {
        const list = data && Array.isArray(data.pools) ? data.pools : [];
        const nameOf = names || (data && data.names) || {};
        const toName = (c) => (ID_RE.test(c) ? String(nameOf[c] || '').trim() : c);
        return list
            .filter((p) => p && typeof p.pool === 'string' && Array.isArray(p.chars)
                && (p.kind === 'limited' || p.kind === 'collab'))
            .map((p) => ({
                pool: p.pool,
                kind: p.kind,
                match: (Array.isArray(p.match) && p.match.length > 0 ? p.match : [p.pool])
                    .map((m) => (String(m).startsWith('=') ? ['=' + poolKey(String(m).slice(1))] : String(m).split('+').map(poolKey).filter(Boolean)))
                    .filter((parts) => parts.length > 0),
                months: readMonths(p),
                variant: typeof p.variant === 'string' ? p.variant.trim() : '',
                rerun: p.rerun === true,
                label: typeof p.label === 'string' ? p.label.trim() : '',
                chars: p.chars.filter((c) => typeof c === 'string' && c.trim()).map((c) => toName(c.trim())).filter(Boolean)
            }));
    }

    // 活動名稱開頭的年月：「2026-11月 彩獸神祭」→ "2026-11"；沒有時回傳空字串
    function eventMonth(eventName) {
        const m = String(eventName || '').trim().match(/^(\d{4})-(\d{1,2})月/);
        return m ? `${m[1]}-${m[2].padStart(2, '0')}` : '';
    }

    // 活動名稱對到的所有卡池 (含每個版本)，依 pools.json 的順序
    function matchingPools(pools, eventName) {
        const key = poolKey(eventName);
        if (!key) return [];
        // "=名稱"：活動名稱 (去掉開頭的年月) 要和它完全相同
        const bare = poolKey(String(eventName || '').trim().replace(/^\d{4}-\d{1,2}月\s*/, ''));
        return pools.filter((p) => p.match.some((parts) => (parts[0][0] === '='
            ? parts[0].slice(1) === bare
            : parts.every((part) => key.includes(part)))));
    }

    // 限定卡池在這個月、這場活動要用的版本 (沒有時回傳 null)
    //   同一個月有兩個名單不同的同名轉蛋時 (一般的激獸神祭和「怪物彈珠動畫 特別版！激獸神祭」)，
    //   其中一個版本會有 variant：活動名稱含有 variant 的用那個版本，其他活動用沒有 variant 的版本
    function limitedVersion(pools, pool, month, eventName) {
        if (!month) return null;
        const key = poolKey(eventName);
        const versions = pools.filter((v) => v.pool === pool && v.kind === 'limited' && v.months.includes(month));
        const special = versions.filter((v) => v.variant && key.includes(poolKey(v.variant)))
            .sort((a, b) => b.variant.length - a.variant.length)[0];
        return special || versions.find((v) => !v.variant) || null;
    }

    // 活動名稱 → 這期的卡池 (合作在前，同類依 pools.json 的順序)
    //   合作卡池：match 本身帶年月，對到就算
    //   限定卡池：只用 months 含有活動年月的版本 (見 readPools 的說明)
    //   「2025-10月 超獸神祭×鬼滅之刃」→ [鬼滅之刃 (collab), 超獸神祭 (limited，有 2025-10 的版本時)]
    function poolsForEvent(pools, eventName) {
        const month = eventMonth(eventName);
        const found = [];
        const seen = new Set();
        matchingPools(pools, eventName).forEach((p) => {
            if (seen.has(p.kind + '\u0000' + p.pool)) return;
            const use = p.kind === 'collab' ? p : limitedVersion(pools, p.pool, month, eventName);
            if (!use) return;
            seen.add(p.kind + '\u0000' + p.pool);
            found.push(use);
        });
        return [...found.filter((p) => p.kind === 'collab'), ...found.filter((p) => p.kind === 'limited')];
    }

    // 角色名稱 → 它所在的限定卡池 (不在名單上回傳空字串)
    //   先看預設版本 (官網限定角色名單，每隻角色只屬於一個卡池)；
    //   預設版本沒有的角色 (之後才登場) 再看各期版本：常設祭典 (有預設版本) 優先，再來是最早的月份、名單短的。
    //   各期版本是「那期轉蛋抽得到的角色」，可能包含其他祭典的限定角色，所以不能先看
    function buildLimitedLookup(pools) {
        const byKey = new Map();
        const limited = pools.filter((p) => p.kind === 'limited');
        const add = (p) => p.chars.forEach((name) => {
            const key = poolKey(name);
            if (key && !byKey.has(key)) byKey.set(key, p.pool);
        });
        limited.filter((p) => p.months.length === 0).forEach(add);
        // 有預設版本的常設祭典優先 (新祭典的名單常混著別的祭典的角色)，再來是最早的月份、名單短的
        const regular = new Set(limited.filter((p) => p.months.length === 0).map((p) => p.pool));
        limited.filter((p) => p.months.length > 0)
            .sort((a, b) => (regular.has(b.pool) - regular.has(a.pool))
                || a.months[0].localeCompare(b.months[0]) || a.chars.length - b.chars.length)
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
        poolKey, readPools, eventMonth, matchingPools, poolsForEvent, buildLimitedLookup,
        readNameFixes, resolveName, isDistinct, applyNameFix
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.CharacterPools = api;
})(this);
