// 官網公告 → 卡池 (pools.json) 的解析與更新：純函式，不連網路、不寫檔 (有自動化測試，見 tests/pool-parse.test.js)
//
// 規則 (使用者確認過)：
//   - 祭典等本家轉蛋：公告表格「「X」限定角色」「轉出對象限定角色」「轉出對象期間限定角色」下面的角色都算這期卡池
//   - 合作活動：標題有「轉蛋「…」」的段落裡的角色表，只收稀有度「★6（獸神化前）」的角色
//   - 卡池依每期公告各自一個版本：限定卡池的版本記下它是哪幾個月 (months)，活動只用自己那個月的版本。
//     名單和某一期相同時把月份加進那個版本；同一個月已經有不同名單的版本時不寫，只標出來
//   - 合作卡池依「年-月月+作品名」對應單一期活動，名單不同時直接改那一筆
//   - 名稱和既有角色相似但不同 (只差一個中文字) 時標出來，不自己判斷成同一隻
//   - 解析不確定 (格式不同、找不到★6、名單黏在一起拆不開、段落不只一個) 時只標出來，不寫入
'use strict';

const { poolKey, readPools, matchingPools, poolsForEvent, eventMonth } = require('../pools.js');
const { differsByOneCjk } = require('../js/catalog.js');
const { matchKey } = require('./parse.js');

// ---- HTML 小工具 ----
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, code) => {
        if (code[0] === '#') {
            const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
            return Number.isFinite(n) ? String.fromCodePoint(n) : m;
        }
        return ENTITIES[code.toLowerCase()] !== undefined ? ENTITIES[code.toLowerCase()] : m;
    });
}
const BR = '\u0001';   // <br> 的暫時記號
const cellText = (html) => decodeEntities(String(html)
    .replace(/<br\s*\/?>/gi, BR)
    .replace(/<[^>]+>/g, ''));
const plainText = (html) => cellText(html).replace(new RegExp(BR, 'g'), ' ').replace(/\s+/g, ' ').trim();

// <table> → [[{ tag: 'th'|'td', html }]]
function tableRows(tableHtml) {
    return [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
        [...row[1].matchAll(/<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((c) => ({ tag: c[1].toLowerCase(), html: c[2] })));
}

// 一格角色名單 → 名稱陣列
//   官網用全形空白或換行分隔；名稱本身可能有半形空白 (「新年魔術王 所羅門」)，
//   所以有全形空白或換行時只用它們切，都沒有時才用半形空白切
function splitNameCell(html) {
    const text = cellText(html).replace(/ /g, ' ');
    const wide = /[　\u0001]/.test(text);
    return text.split(wide ? /[　\u0001]+/ : /\s+/)
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
}

// ---- 解析公告 ----
const LIMITED_HEADER_RE = /^(?:「([^「」]+)」(?:期間)?限定角色|轉出對象(?:期間)?限定角色)$/;
const ELEMENT_HEADER_RE = /^([火水木光闇])屬性$/;

// 限定角色表：
//   limited：[{ header, poolName (「X」限定角色的 X，沒有時空字串), names }]
//   elements：{ 木: [...], 闇: [...] }，「木屬性」「闇屬性」這種依屬性分的名單
//             (合作祭典的公告有時只用屬性分，例如「綠色幻想×MIDNIGHT PARTY×藥師少女的獨語」)
function parseLimitedTables(html) {
    const limited = [];
    const elements = {};
    for (const table of String(html).match(/<table\b[\s\S]*?<\/table>/gi) || []) {
        let current = null;
        for (const cells of tableRows(table)) {
            if (cells.length === 0) continue;
            if (cells.every((c) => c.tag === 'th')) {
                const header = plainText(cells.map((c) => c.html).join(''));
                const m = header.match(LIMITED_HEADER_RE);
                const e = header.match(ELEMENT_HEADER_RE);
                if (m) {
                    current = { header, poolName: m[1] ? m[1].trim() : '', names: [] };
                    limited.push(current);
                } else if (e) {
                    elements[e[1]] = elements[e[1]] || [];
                    current = { names: elements[e[1]] };
                } else {
                    current = null;
                }
                continue;
            }
            if (current) cells.forEach((c) => current.names.push(...splitNameCell(c.html)));
        }
    }
    return { limited: limited.filter((l) => l.names.length > 0), elements };
}
const parseLimitedLists = (html) => parseLimitedTables(html).limited;

// 轉蛋段落的標題：「轉蛋「X」」「轉蛋《X》」，或沒有名稱的「…轉蛋開跑」(目錄那種有換行的標題不算)
const GACHA_NAME_RE = /轉蛋(?:「([^「」]+)」|《([^《》]+)》)/;
function gachaHeading(inner) {
    if (/<br/i.test(inner)) return null;
    const text = plainText(inner);
    if (/INDEX/i.test(text)) return null;
    const named = text.match(GACHA_NAME_RE);
    if (named) return { heading: text, gachaName: (named[1] || named[2]).trim() };
    if (/轉蛋[^「《]*開跑/.test(text)) return { heading: text, gachaName: '' };
    return null;
}

// 合作活動的角色表：轉蛋段落裡，表頭有「角色…」和「稀有度」的表格
//   → [{ heading, gachaName, rows: [{ name, rarity }] }] (一個段落一筆)
//   轉蛋標題 (任何層級) 開始新的段落；其他標題只有層級不深於第一個轉蛋標題時才結束段落
function parseCollabSections(html) {
    const tokens = [...String(html).matchAll(/<(h[2-6])\b[^>]*>([\s\S]*?)<\/\1>|<table\b[\s\S]*?<\/table>/gi)];
    const first = tokens.find((t) => t[1] && gachaHeading(t[2]));
    if (!first) return [];
    const level = Number(first[1][1]);

    const sections = [];
    let section = null;
    for (const t of tokens) {
        if (t[1]) {
            const g = gachaHeading(t[2]);
            if (g) {
                section = { ...g, rows: [] };
                sections.push(section);
            } else if (Number(t[1][1]) <= level) {
                section = null;
            }
            continue;
        }
        if (!section) continue;
        const rows = tableRows(t[0]);
        const head = rows.findIndex((cells) => cells.some((c) => c.tag === 'th' && /^角色/.test(plainText(c.html)))
            && cells.some((c) => /稀有度/.test(plainText(c.html))));
        if (head === -1) continue;
        const nameCol = rows[head].findIndex((c) => /^角色/.test(plainText(c.html)));
        const rarityCol = rows[head].findIndex((c) => /稀有度/.test(plainText(c.html)));
        rows.slice(head + 1).forEach((cells) => {
            const name = cells[nameCol] ? plainText(cells[nameCol].html) : '';
            const rarity = cells[rarityCol] ? plainText(cells[rarityCol].html) : '';
            if (name) section.rows.push({ name, rarity });
        });
    }
    return sections.filter((s) => s.rows.length > 0);
}

// 「★6（獸神化前）」「（獸神化前）★6」「獸神化前（★6）」都算
const isStar6Base = (rarity) => {
    const s = String(rarity).normalize('NFKC').replace(/[\s()]/g, '');
    return /★6/.test(s) && /獸神化前/.test(s);
};

// 公告 → 卡池需要的資料 (存起來，之後再和 pools.json 比對)
function extractPoolData(html) {
    const { limited, elements } = parseLimitedTables(html);
    return { limited, elements, collab: parseCollabSections(html) };
}

// ---- 名稱比對 ----
// 黏在一起的名稱 (「麻穗呂芭波菈里絲」) 用已知的角色名稱拆開；拆不開回傳 null
function splitGlued(name, known) {
    const key = poolKey(name);
    if (!key || known.has(key)) return null;
    const best = new Array(key.length + 1).fill(null);
    best[0] = [];
    for (let i = 0; i < key.length; i++) {
        if (!best[i]) continue;
        known.forEach((original, k) => {
            if (k.length >= 2 && key.startsWith(k, i) && !best[i + k.length]) best[i + k.length] = [...best[i], original];
        });
    }
    const parts = best[key.length];
    return parts && parts.length >= 2 ? parts : null;
}

// 所有卡池出現過的角色：比對用名稱 → 原本的寫法
function knownNames(data) {
    const map = new Map();
    readPools(data).forEach((p) => p.chars.forEach((c) => {
        const k = poolKey(c);
        if (k && !map.has(k)) map.set(k, c);
    }));
    return map;
}

// 整理一期的名單：拆開黏在一起的名稱、去掉重複；標出新名稱和相似的名稱
function cleanNames(names, known) {
    const result = [];
    const notes = [];
    const seen = new Set();
    names.forEach((raw) => {
        const parts = splitGlued(raw, known);
        if (parts) notes.push(`「${raw}」看起來是 ${parts.map((p) => `「${p}」`).join('')} 黏在一起，已拆開`);
        (parts || [raw]).forEach((n) => {
            const k = poolKey(n);
            if (!k || seen.has(k)) return;
            seen.add(k);
            result.push(known.get(k) || n);
            if (known.has(k)) return;
            const similar = [...known.values()].filter((o) => differsByOneCjk(n, o));
            notes.push(similar.length
                ? `「${n}」和既有的 ${similar.map((s) => `「${s}」`).join('')} 只差一個字，請確認是不是同一隻`
                : `「${n}」是卡池裡沒出現過的名稱（新角色，或官網寫法不同）`);
        });
    });
    return { names: result, notes };
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.some((y) => poolKey(y) === poolKey(x)));
const diffNames = (next, prev) => ({
    added: next.filter((n) => !prev.some((p) => poolKey(p) === poolKey(n))),
    removed: prev.filter((p) => !next.some((n) => poolKey(n) === poolKey(p)))
});

// ---- 寫回 pools.json ----
// pools.json 一筆卡池的月份 (舊格式的 since 當成一個月)
const rawMonths = (p) => (Array.isArray(p.months) ? p.months : (typeof p.since === 'string' && p.since ? [p.since] : []));
const maxMonth = (p) => rawMonths(p).slice().sort().pop() || '';

const monthOfMatch = (entry) => {
    const m = (entry.match || []).map((x) => String(x).match(/^(\d{4}-\d{2})月/)).find(Boolean);
    return m ? m[1] : '';
};

function insertEntry(list, entry) {
    const next = [...list];
    if (entry.kind === 'collab') {
        // 合作卡池依年月由新到舊
        const month = monthOfMatch(entry);
        const at = next.findIndex((p) => p.kind === 'collab' && monthOfMatch(p) < month);
        const lastCollab = next.reduce((idx, p, i) => (p.kind === 'collab' ? i : idx), -1);
        next.splice(at === -1 ? lastCollab + 1 : at, 0, entry);
        return next;
    }
    // 限定卡池的新版本接在同名卡池裡月份比它早的最後一個版本後面 (同名卡池依月份排序，預設版本在最前面)
    const same = next.map((p, i) => [p, i]).filter(([p]) => p.pool === entry.pool && p.kind === entry.kind);
    if (same.length === 0) return [...next, entry];
    const first = rawMonths(entry)[0];
    const after = same.filter(([p]) => rawMonths(p).length === 0 || rawMonths(p)[0] < first).pop();
    next.splice(after ? after[1] + 1 : same[0][1], 0, entry);
    return next;
}

// 管理員確認過的名稱對應 (scraper/name-overrides.json)：公告上的寫法 → 卡池裡的寫法
let overrides = { global: {}, pools: {} };
function applyOverrides(names, pool) {
    const own = (overrides.pools && overrides.pools[pool]) || {};
    const all = overrides.global || {};
    return names.map((n) => own[n] || all[n] || n);
}

// 合作祭典公告只用屬性分限定角色時，屬性對應的本家卡池
const ELEMENT_OF_POOL = { '綠色幻想': '木', 'Midnight Party': '闇', '水之遊宴': '水', '火焰之星': '火', 'Starlight Mirage': '光' };

// 一篇公告有好幾個轉蛋段落時，挑這場活動的段落：
//   名稱和活動名稱相同的那段 → 名稱包含在活動名稱裡的那幾段 (活動同時包含好幾個轉蛋，例如
//   「咒術迴戰 & STARLIGHT MIRAGE×劇場版 咒術迴戰 0」) → 唯一一個沒有名稱的段落；都不符合時回傳 null
function pickSections(sections, eventName) {
    if (sections.length <= 1) return sections;
    const key = matchKey(eventName);
    const exact = sections.filter((s) => s.gachaName && matchKey(s.gachaName) === key);
    if (exact.length) return exact.slice(0, 1);
    const contained = sections.filter((s) => s.gachaName && key.includes(matchKey(s.gachaName)));
    if (contained.length) return contained;
    const unnamed = sections.filter((s) => !s.gachaName);
    return unnamed.length === 1 ? unnamed : null;
}

const result = (data, change, flags) => ({ data, changes: change ? [change] : [], flags });

// 合作卡池：轉蛋段落裡「★6（獸神化前）」的角色
function planCollab(poolsData, item) {
    const { event, data } = item;
    const flags = [];
    const flag = (message) => flags.push({ event: event.event, source: event.source, message });
    const month = eventMonth(event.event);
    const raw = Array.isArray(poolsData.pools) ? poolsData.pools : [];
    const parsed = readPools(poolsData);
    const none = result(poolsData, null, flags);

    const all = data.collab
        .map((s) => ({ ...s, star6: s.rows.filter((r) => isStar6Base(r.rarity)).map((r) => r.name) }))
        .filter((s) => s.star6.length > 0);
    if (all.length === 0) {
        if (data.collab.length > 0) flag('轉蛋段落的角色表裡沒有「★6（獸神化前）」的角色，需要手動處理');
        else flag('找不到轉蛋段落的角色表（公告格式可能不同），需要手動處理');
        return none;
    }
    const sections = pickSections(all, event.event);
    if (!sections) {
        flag('公告裡有好幾個轉蛋段落，不確定這期是哪一個，需要手動處理：'
            + all.map((s) => `「${s.heading}」→ ${s.star6.join('、')}`).join('；'));
        return none;
    }
    const existing = poolsForEvent(parsed, event.event).filter((p) => p.kind === 'collab');
    if (existing.length > 1) {
        flag(`活動名稱對到好幾個合作卡池（${existing.map((p) => p.pool).join('、')}），需要手動處理`);
        return none;
    }
    const poolName = existing.length === 1 ? existing[0].pool : (sections.map((s) => s.gachaName).find(Boolean) || '');
    const { names, notes } = cleanNames(applyOverrides(sections.flatMap((s) => s.star6), poolName), knownNames(poolsData));
    // 名稱的提醒只在這期真的有變動時列出
    const done = (data2, change) => {
        if (change) notes.forEach(flag);
        return result(data2, change, flags);
    };
    if (existing.length === 1) {
        const target = existing[0];
        if (sameSet(names, target.chars)) return none;
        const index = raw.findIndex((p) => p.pool === target.pool && p.kind === 'collab');
        const pools = raw.map((p, i) => (i === index ? { ...p, ...(p.source ? {} : { source: event.source }), chars: names } : p));
        return done({ ...poolsData, pools },
            { type: 'update-collab', pool: target.pool, event: event.event, source: event.source, chars: names, ...diffNames(names, target.chars) });
    }
    if (!month) {
        flag('活動名稱沒有年月，無法建立合作卡池，需要手動處理');
        return none;
    }
    const name = sections.map((s) => s.gachaName).find(Boolean) || event.event.replace(/^\d{4}-\d{2}月\s*/, '');
    const entry = { pool: name, kind: 'collab', match: [`${month}月+${name}`], source: event.source, chars: names };
    flag(`新的合作卡池「${name}」（比對關鍵字 ${entry.match[0]}），請確認卡池名稱`);
    return done({ ...poolsData, pools: insertEntry(raw, entry) },
        { type: 'new-collab', pool: name, event: event.event, source: event.source, chars: names, added: names, removed: [] });
}

// 本家限定卡池的一期名單 → 變動 (pool 不存在時新增卡池)
function planLimitedList(poolsData, event, pool, rawNames) {
    const flags = [];
    const flag = (message) => flags.push({ event: event.event, source: event.source, message });
    const month = eventMonth(event.event);
    const raw = Array.isArray(poolsData.pools) ? poolsData.pools : [];
    const none = result(poolsData, null, flags);
    const { names, notes } = cleanNames(applyOverrides(rawNames, pool), knownNames(poolsData));
    const done = (data2, change) => {
        if (change) notes.forEach(flag);
        return result(data2, change, flags);
    };

    const versions = raw.map((p, i) => [p, i]).filter(([p]) => p.pool === pool && p.kind === 'limited');
    if (versions.length === 0) {
        const entry = { pool, kind: 'limited', months: [month], source: event.source, chars: names };
        flag(`新的限定卡池「${pool}」（比對關鍵字用卡池名稱），請確認卡池名稱`);
        return done({ ...poolsData, pools: insertEntry(raw, entry) },
            { type: 'new-limited', pool, month, event: event.event, source: event.source, chars: names, added: names, removed: [] });
    }
    const own = versions.find(([p]) => rawMonths(p).includes(month));
    if (own) {
        if (sameSet(names, own[0].chars)) return none;
        const d = diffNames(names, own[0].chars);
        flag(`「${pool}」${month} 已經有一個版本，這期公告的名單不同（多了：${d.added.join('、') || '無'}；少了：${d.removed.join('、') || '無'}），需要手動處理`);
        return none;
    }
    // 和前一期的名單比較 (報告用)：月份比這期早的最後一個版本，沒有時用預設版本
    const earlier = latestBefore(versions, month);
    const base = versions.find(([p]) => rawMonths(p).length === 0);
    const previous = earlier || base;
    const diff = previous ? diffNames(names, previous[0].chars) : { added: names, removed: [] };

    // 名單和某一期相同 → 把這個月加進那個版本
    const same = versions.find(([p]) => rawMonths(p).length > 0 && sameSet(names, p.chars));
    if (same) {
        return done(addMonth(poolsData, same[1], month),
            { type: 'add-month', pool, month, event: event.event, source: event.source, chars: names, added: [], removed: [], previous: rawMonths(same[0]).join('、') });
    }
    const template = raw.find((p) => p.pool === pool && p.kind === 'limited' && Array.isArray(p.match));
    const entry = { pool, kind: 'limited', ...(template ? { match: template.match } : {}), months: [month], source: event.source, chars: names };
    return done({ ...poolsData, pools: insertEntry(raw, entry) },
        { type: 'add-version', pool, month, event: event.event, source: event.source, chars: names, ...diff,
            previous: earlier ? `${maxMonth(earlier[0])} 的版本` : '預設版本' });
}

// 同名卡池裡，月份比 month 早的最後一個版本 ([entry, index])
function latestBefore(versions, month) {
    return versions.filter(([p]) => rawMonths(p).some((m) => m < month))
        .sort(([a], [b]) => maxBefore(a, month).localeCompare(maxBefore(b, month))).pop() || null;
}
const maxBefore = (p, month) => rawMonths(p).filter((m) => m < month).sort().pop() || '';

function addMonth(poolsData, index, month) {
    const pools = poolsData.pools.map((p, i) => (i === index ? { ...p, months: [...rawMonths(p), month].sort() } : p));
    return { ...poolsData, pools };
}

// 合作祭典的公告沒列出本家限定角色時 (官網漏寫)：沿用這個卡池在這期之前最近一期的名單
function inheritEarlier(poolsData, event, pool) {
    const flags = [];
    const month = eventMonth(event.event);
    const raw = poolsData.pools;
    const versions = raw.map((p, i) => [p, i]).filter(([p]) => p.pool === pool && p.kind === 'limited');
    if (versions.some(([p]) => rawMonths(p).includes(month))) return result(poolsData, null, flags);
    const earlier = latestBefore(versions, month);
    if (!earlier) {
        flags.push({ event: event.event, source: event.source,
            message: `公告沒有列出「${pool}」的本家限定角色，之前也沒有可以沿用的名單，本家限定的部分需要手動處理` });
        return result(poolsData, null, flags);
    }
    const from = maxBefore(earlier[0], month);
    return result(addMonth(poolsData, earlier[1], month),
        { type: 'inherit', pool, month, event: event.event, source: event.source, chars: earlier[0].chars, added: [], removed: [], previous: from },
        flags);
}

// 合作祭典 (「超獸神祭×孤獨搖滾！」)：活動名稱對到的每個本家限定卡池
//   公告有「「超獸神祭」限定角色」表 → 用那張表；只用屬性分 → 用那個屬性的名單；都沒有 → 沿用之前最近一期
function planComboLimited(poolsData, item) {
    const { event, data } = item;
    const pools = [...new Set(matchingPools(readPools(poolsData), event.event).filter((p) => p.kind === 'limited').map((p) => p.pool))];
    let current = poolsData;
    const changes = [];
    const flags = [];
    pools.forEach((pool) => {
        let tables = data.limited.filter((t) => t.poolName && poolKey(t.poolName) === poolKey(pool));
        if (tables.length === 0 && pools.length === 1) tables = data.limited;
        const element = ELEMENT_OF_POOL[pool];
        const elementNames = element && data.elements ? data.elements[element] : null;
        const r = tables.length > 0 ? planLimitedList(current, event, pool, tables.flatMap((t) => t.names))
            : elementNames && elementNames.length ? planLimitedList(current, event, pool, elementNames)
                : inheritEarlier(current, event, pool);
        current = r.data;
        changes.push(...r.changes);
        flags.push(...r.flags);
    });
    return { data: current, changes, flags };
}

// 本家 (祭典等)：限定角色表 → 活動名稱對到的限定卡池
function planHonke(poolsData, item) {
    const { event, data } = item;
    const flags = [];
    const flag = (message) => flags.push({ event: event.event, source: event.source, message });
    if (data.limited.length === 0) return result(poolsData, null, flags);
    if (!eventMonth(event.event)) {
        flag('活動名稱沒有年月，無法決定卡池版本，需要手動處理');
        return result(poolsData, null, flags);
    }
    const parsed = readPools(poolsData);
    const header = data.limited.map((l) => l.poolName).find(Boolean) || '';
    const byHeader = header ? parsed.find((p) => p.kind === 'limited' && poolKey(p.pool) === poolKey(header)) : null;
    let poolNames = [...new Set(matchingPools(parsed, event.event).filter((p) => p.kind === 'limited').map((p) => p.pool))];
    if (poolNames.length > 1) {
        // 好幾個卡池都對到 (「怪物彈珠世代 2013＆2014＆2017」)：表頭寫的是哪個就用哪個，都不是時當成新的卡池
        if (byHeader && poolNames.includes(byHeader.pool)) poolNames = [byHeader.pool];
        else if (header && !byHeader) poolNames = [header];
        else {
            flag(`活動名稱對到好幾個限定卡池（${poolNames.join('、')}），需要手動處理`);
            return result(poolsData, null, flags);
        }
    }
    if (poolNames.length === 0) poolNames = [byHeader ? byHeader.pool : (header || event.event.replace(/^\d{4}-\d{2}月\s*/, ''))];
    return planLimitedList(poolsData, event, poolNames[0], data.limited.flatMap((l) => l.names));
}

// 一期活動 → 卡池的變動 { data, changes, flags }
//   本家活動：本家限定卡池
//   合作活動：合作卡池；活動名稱也對到本家限定卡池時 (合作祭典) 再更新本家限定卡池，兩種卡池分開
function planOne(poolsData, item) {
    if (item.event.unlogged) {
        // 活動清單沒有的本家祭典 (回補用)：只加進已經有的卡池，不新增卡池、不標出來
        const parsed = readPools(poolsData);
        const header = item.data.limited.map((l) => l.poolName).find(Boolean) || '';
        const exists = matchingPools(parsed, item.event.event).some((p) => p.kind === 'limited')
            || (header && parsed.some((p) => p.kind === 'limited' && poolKey(p.pool) === poolKey(header)));
        if (!exists) return { data: poolsData, changes: [], flags: [] };
        const r = planHonke(poolsData, item);
        if (r.changes.some((c) => c.type === 'new-limited')) return { data: poolsData, changes: [], flags: [] };
        return { data: r.data, changes: r.changes.map((c) => ({ ...c, unlogged: true })), flags: [] };
    }
    if (item.event.tag !== 'collab') return planHonke(poolsData, item);
    const collab = planCollab(poolsData, item);
    const limited = planComboLimited(collab.data, item);
    return { data: limited.data, changes: [...collab.changes, ...limited.changes], flags: [...collab.flags, ...limited.flags] };
}

// 好幾期活動依開始日由舊到新套用 (後面的期數會和前面剛加的版本比較)
//   nameOverrides：scraper/name-overrides.json 的內容 (選填)
function planPoolChanges(poolsData, items, nameOverrides) {
    overrides = { global: {}, pools: {}, ...(nameOverrides || {}) };
    let data = poolsData;
    const changes = [];
    const flags = [];
    [...items].sort((a, b) => String(a.event.date).localeCompare(String(b.event.date))).forEach((item) => {
        const result = planOne(data, item);
        data = result.data;
        changes.push(...result.changes);
        flags.push(...result.flags);
    });
    return { data, changes, flags };
}

// pools.json 的寫法：一個卡池一行，欄位順序照原本
function formatPoolsJson(data) {
    const value = (v) => (Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(', ')}]` : JSON.stringify(v));
    const line = (p) => `{${Object.entries(p).map(([k, v]) => `${JSON.stringify(k)}: ${value(v)}`).join(', ')}}`;
    const head = Object.entries(data).filter(([k]) => k !== 'pools').map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
    return ['{', ...head, '  "pools": [', (data.pools || []).map((p) => `    ${line(p)}`).join(',\n'), '  ]', '}', ''].join('\n');
}

// PR 說明 / 紀錄用的 Markdown
const TYPE_LABELS = {
    'add-version': '新增限定卡池版本',
    'add-month': '限定卡池加上這個月',
    'inherit': '限定卡池沿用之前的名單',
    'new-limited': '新的限定卡池',
    'update-collab': '修改合作卡池',
    'new-collab': '新的合作卡池'
};
function describePoolChanges({ changes, flags }) {
    const lines = [];
    const describe = (c) => {
        const since = c.type === 'inherit' ? `（${c.month}，公告沒列出本家限定角色，沿用 ${c.previous} 的名單）`
            : c.type === 'add-month' ? `（${c.month}，名單和 ${c.previous} 相同）`
            : c.month ? `（${c.month}${c.previous ? `，和前一期（${c.previous}）比較` : ''}）` : '';
        lines.push(`- **${TYPE_LABELS[c.type]}「${c.pool}」**${since} ← ${c.event} [公告](${c.source})`);
        if (c.added.length) lines.push(`  - 多了：${c.added.join('、')}`);
        if (c.removed.length) lines.push(`  - 少了：${c.removed.join('、')}`);
        lines.push(`  - 名單：${c.chars.join('、')}`);
    };
    const logged = changes.filter((c) => !c.unlogged);
    const unlogged = changes.filter((c) => c.unlogged);
    if (logged.length) {
        lines.push('### 卡池變動', '');
        logged.forEach(describe);
        lines.push('');
    }
    if (unlogged.length) {
        lines.push('### 活動清單沒有的祭典（只記下那期名單，之後的合作祭典公告漏寫本家限定角色時沿用）', '');
        unlogged.forEach(describe);
        lines.push('');
    }
    if (flags.length) {
        lines.push('### 需要確認或手動處理', '');
        flags.forEach((f) => lines.push(`- ${f.event}${f.source ? ` [公告](${f.source})` : ''}：${f.message}`));
        lines.push('');
    }
    return lines.join('\n');
}

module.exports = {
    splitNameCell, parseLimitedLists, parseLimitedTables, pickSections, parseCollabSections, isStar6Base, extractPoolData,
    splitGlued, knownNames, cleanNames, planPoolChanges, formatPoolsJson, describePoolChanges
};
