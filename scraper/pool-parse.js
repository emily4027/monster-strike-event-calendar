// 官網公告 → 卡池 (pools.json) 的解析與更新：純函式，不連網路、不寫檔 (有自動化測試，見 tests/pool-parse.test.js)
//
// 規則 (使用者確認過)：
//   - 祭典等本家轉蛋：公告表格「「X」限定角色」「轉出對象限定角色」「轉出對象期間限定角色」下面的角色都算這期卡池
//   - 合作活動：標題有「轉蛋「…」」的段落裡的角色表，只收稀有度「★6（獸神化前）」的角色
//   - 卡池依每期公告各自一個版本：限定卡池加一個 since = 活動年月的版本 (不改舊版本)；
//     名單和這期原本會用的版本一樣時不加。同一個月已經有不同名單的版本時不寫，只標出來
//   - 合作卡池依「年-月月+作品名」對應單一期活動，名單不同時直接改那一筆
//   - 名稱和既有角色相似但不同 (只差一個中文字) 時標出來，不自己判斷成同一隻
//   - 解析不確定 (格式不同、找不到★6、名單黏在一起拆不開、段落不只一個) 時只標出來，不寫入
'use strict';

const { poolKey, readPools, poolsForEvent, eventMonth } = require('../pools.js');
const { differsByOneCjk } = require('../js/catalog.js');

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
const LIMITED_HEADER_RE = /^(?:「([^「」]+)」限定角色|轉出對象(?:期間)?限定角色)$/;

// 限定角色表：[{ header, poolName (「X」限定角色的 X，沒有時空字串), names }]
function parseLimitedLists(html) {
    const lists = [];
    for (const table of String(html).match(/<table\b[\s\S]*?<\/table>/gi) || []) {
        let current = null;
        for (const cells of tableRows(table)) {
            if (cells.length === 0) continue;
            if (cells.every((c) => c.tag === 'th')) {
                const header = plainText(cells.map((c) => c.html).join(''));
                const m = header.match(LIMITED_HEADER_RE);
                current = m ? { header, poolName: m[1] ? m[1].trim() : '', names: [] } : null;
                if (current) lists.push(current);
                continue;
            }
            if (current) cells.forEach((c) => current.names.push(...splitNameCell(c.html)));
        }
    }
    return lists.filter((l) => l.names.length > 0);
}

// 合作活動的角色表：標題含「轉蛋「X」」的段落裡，表頭有「角色…」和「稀有度」的表格
//   → [{ heading, gachaName, rows: [{ name, rarity }] }] (一個段落一筆)
function parseCollabSections(html) {
    const tokens = [...String(html).matchAll(/<(h[2-6])\b[^>]*>([\s\S]*?)<\/\1>|<table\b[\s\S]*?<\/table>/gi)];
    // 段落標題的層級：第一個「轉蛋「」標題的層級 (目錄那種有換行的標題不算)
    const isGachaHeading = (inner) => !/<br/i.test(inner) && /轉蛋「[^「」]+」/.test(plainText(inner)) && !/INDEX/i.test(plainText(inner));
    const first = tokens.find((t) => t[1] && isGachaHeading(t[2]));
    if (!first) return [];
    const level = Number(first[1][1]);

    const sections = [];
    let section = null;
    for (const t of tokens) {
        if (t[1]) {
            if (Number(t[1][1]) > level) continue;   // 小標題不換段落
            section = null;
            if (isGachaHeading(t[2])) {
                const heading = plainText(t[2]);
                section = { heading, gachaName: heading.match(/轉蛋「([^「」]+)」/)[1].trim(), rows: [] };
                sections.push(section);
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

const isStar6Base = (rarity) => /★6\(獸神化前\)/.test(String(rarity).normalize('NFKC').replace(/\s+/g, ''));

// 公告 → 卡池需要的資料 (存起來，之後再和 pools.json 比對)
function extractPoolData(html) {
    return { limited: parseLimitedLists(html), collab: parseCollabSections(html) };
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
    // 限定卡池的新版本接在同名卡池的最後一個版本後面 (同名卡池依 since 排序)
    const same = next.map((p, i) => [p, i]).filter(([p]) => p.pool === entry.pool && p.kind === entry.kind);
    if (same.length === 0) return [...next, entry];
    const after = same.filter(([p]) => !p.since || p.since < entry.since).pop();
    next.splice(after ? after[1] + 1 : same[0][1], 0, entry);
    return next;
}

// 同名卡池的版本中，這個月要用的版本 (和 pools.js 的 pickVersion 相同規則)
function versionFor(versions, month) {
    const usable = versions.filter((v) => v.since && v.since <= month).sort((a, b) => (a.since < b.since ? 1 : -1));
    return usable[0] || versions.find((v) => !v.since) || null;
}

// 一期活動 → 卡池的變動。回傳 { data, change, flags }，data 是套用後的 pools.json 內容
//   item：{ event: { event, date, tag, source }, data: extractPoolData(...) }
function planOne(poolsData, item) {
    const { event, data } = item;
    const flags = [];
    const flag = (message) => flags.push({ event: event.event, source: event.source, message });
    const month = eventMonth(event.event);
    const raw = Array.isArray(poolsData.pools) ? poolsData.pools : [];
    const parsed = readPools(poolsData);
    const known = knownNames(poolsData);
    const none = { data: poolsData, change: null, flags };

    if (event.tag === 'collab') {
        const sections = data.collab
            .map((s) => ({ ...s, star6: s.rows.filter((r) => isStar6Base(r.rarity)).map((r) => r.name) }))
            .filter((s) => s.star6.length > 0);
        if (sections.length === 0) {
            if (data.collab.length > 0) flag('轉蛋段落的角色表裡沒有「★6（獸神化前）」的角色，需要手動處理');
            else flag('找不到轉蛋段落的角色表（公告格式可能不同），需要手動處理');
            return none;
        }
        if (sections.length > 1) {
            flag('公告裡有好幾個轉蛋段落，不確定這期是哪一個，需要手動處理：'
                + sections.map((s) => `「${s.heading}」→ ${s.star6.join('、')}`).join('；'));
            return none;
        }
        const { names, notes } = cleanNames(sections[0].star6, known);
        // 名稱的提醒只在這期真的有變動時列出
        const withNotes = (result) => { if (result.change) notes.forEach(flag); return result; };
        const existing = poolsForEvent(parsed, event.event).filter((p) => p.kind === 'collab');
        if (existing.length > 1) {
            flag(`活動名稱對到好幾個合作卡池（${existing.map((p) => p.pool).join('、')}），需要手動處理`);
            return none;
        }
        if (existing.length === 1) {
            const target = existing[0];
            if (sameSet(names, target.chars)) return none;
            const index = raw.findIndex((p) => p.pool === target.pool && p.kind === 'collab');
            const pools = raw.map((p, i) => (i === index ? { ...p, ...(p.source ? {} : { source: event.source }), chars: names } : p));
            return withNotes({
                data: { ...poolsData, pools },
                change: { type: 'update-collab', pool: target.pool, event: event.event, source: event.source, chars: names, ...diffNames(names, target.chars) },
                flags
            });
        }
        if (!month) {
            flag('活動名稱沒有年月，無法建立合作卡池，需要手動處理');
            return none;
        }
        const name = sections[0].gachaName;
        const entry = { pool: name, kind: 'collab', match: [`${month}月+${name}`], source: event.source, chars: names };
        flag(`新的合作卡池「${name}」（比對關鍵字 ${entry.match[0]}），請確認卡池名稱`);
        return withNotes({
            data: { ...poolsData, pools: insertEntry(raw, entry) },
            change: { type: 'new-collab', pool: name, event: event.event, source: event.source, chars: names, added: names, removed: [] },
            flags
        });
    }

    // 本家 (祭典等)：限定角色表
    if (data.limited.length === 0) return none;
    if (!month) {
        flag('活動名稱沒有年月，無法決定卡池版本，需要手動處理');
        return none;
    }
    const { names, notes } = cleanNames(data.limited.flatMap((l) => l.names), known);
    const withNotes = (result) => { if (result.change) notes.forEach(flag); return result; };
    let current = poolsForEvent(parsed, event.event).filter((p) => p.kind === 'limited');
    if (current.length === 0) {
        // 活動名稱對不到時，用表頭「「X」限定角色」的 X 找同名卡池
        const header = data.limited.map((l) => l.poolName).find(Boolean);
        const versions = header ? parsed.filter((p) => p.kind === 'limited' && poolKey(p.pool) === poolKey(header)) : [];
        const picked = versionFor(versions, month);
        if (picked) current = [picked];
    }
    if (current.length > 1) {
        flag(`活動名稱對到好幾個限定卡池（${current.map((p) => p.pool).join('、')}），需要手動處理`);
        return none;
    }
    if (current.length === 0) {
        const name = data.limited.map((l) => l.poolName).find(Boolean) || event.event.replace(/^\d{4}-\d{2}月\s*/, '');
        const entry = { pool: name, kind: 'limited', since: month, source: event.source, chars: names };
        flag(`新的限定卡池「${name}」（比對關鍵字用卡池名稱），請確認卡池名稱`);
        return withNotes({
            data: { ...poolsData, pools: insertEntry(raw, entry) },
            change: { type: 'new-limited', pool: name, since: month, event: event.event, source: event.source, chars: names, added: names, removed: [] },
            flags
        });
    }
    const target = current[0];
    if (sameSet(names, target.chars)) return none;
    if (target.since === month) {
        const d = diffNames(names, target.chars);
        flag(`「${target.pool}」${month} 已經有一個版本，這期公告的名單不同（多了：${d.added.join('、') || '無'}；少了：${d.removed.join('、') || '無'}），需要手動處理`);
        return none;
    }
    const template = raw.find((p) => p.pool === target.pool && p.kind === 'limited' && Array.isArray(p.match));
    const entry = { pool: target.pool, kind: 'limited', ...(template ? { match: template.match } : {}), since: month, source: event.source, chars: names };
    return withNotes({
        data: { ...poolsData, pools: insertEntry(raw, entry) },
        change: { type: 'add-version', pool: target.pool, since: month, event: event.event, source: event.source, chars: names, ...diffNames(names, target.chars), previous: target.since || '預設版本' },
        flags
    });
}

// 好幾期活動依開始日由舊到新套用 (後面的期數會和前面剛加的版本比較)
function planPoolChanges(poolsData, items) {
    let data = poolsData;
    const changes = [];
    const flags = [];
    [...items].sort((a, b) => String(a.event.date).localeCompare(String(b.event.date))).forEach((item) => {
        const result = planOne(data, item);
        data = result.data;
        if (result.change) changes.push(result.change);
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
    'new-limited': '新的限定卡池',
    'update-collab': '修改合作卡池',
    'new-collab': '新的合作卡池'
};
function describePoolChanges({ changes, flags }) {
    const lines = [];
    if (changes.length) {
        lines.push('### 卡池變動', '');
        changes.forEach((c) => {
            const since = c.since ? `（${c.since} 起${c.previous ? `，前一版：${c.previous}` : ''}）` : '';
            lines.push(`- **${TYPE_LABELS[c.type]}「${c.pool}」**${since} ← ${c.event} [公告](${c.source})`);
            if (c.added.length) lines.push(`  - 多了：${c.added.join('、')}`);
            if (c.removed.length) lines.push(`  - 少了：${c.removed.join('、')}`);
            lines.push(`  - 名單：${c.chars.join('、')}`);
        });
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
    splitNameCell, parseLimitedLists, parseCollabSections, isStar6Base, extractPoolData,
    splitGlued, knownNames, cleanNames, planPoolChanges, formatPoolsJson, describePoolChanges
};
