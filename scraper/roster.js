// 角色名冊 (characters.json)：純函式，不連網路、不寫檔 (測試見 tests/roster.test.js)
//
// characters.json：
//   { "說明": "...", "characters": [
//       { "id": "c0001", "name": "瑪娜", "element": "光",
//         "aliases": ["別的寫法"],                       // 選填：同一隻角色的其他寫法 (管理員確認過)
//         "poolAliases": { "卡池名稱": ["公告上的寫法"] },  // 選填：只在那個卡池才算這隻角色的寫法
//         "forms": [{ "no": 1234, "name": "慈愛天使 瑪娜", "form": "獸神化" }] }  // 選填：各形態與遊戲的圖鑑編號
//   ] }
//   id：內部編號，編了就不改、不重複使用。pools.json 的 chars 寫的是這個編號。
//   name：台版官網的寫法 (轉蛋抽到的那個形態)。名稱、別名、各形態的名稱都能找到這隻角色。
//
// 爬蟲 (pool-parse.js) 內部仍然用名稱比對；讀檔時把編號換成名稱、寫檔時換回編號 (見 apply-pools.js)。
'use strict';

const { poolKey } = require('../pools.js');

const ID_RE = /^c\d{4,}$/;
const ELEMENT_RE = /^[火水木光闇]$/;
const NOTE = '角色名冊。id：內部編號，編了就不改、不重複使用，pools.json 的 chars 寫的是這個編號。name：台版官網的寫法。element：屬性 (火水木光闇)，網頁用來替名稱上色。aliases：同一隻角色的其他寫法。poolAliases：只在那個卡池才算這隻角色的寫法 { 卡池名稱: [寫法] }。forms：各形態 [{ no: 遊戲的圖鑑編號, name: 名稱, form: 形態 }]。爬蟲讀到名冊沒有的名稱時會編新的編號；已經有的資料不會被爬蟲覆蓋。';

const listOf = (data) => (data && Array.isArray(data.characters) ? data.characters : []);
const clean = (s) => (typeof s === 'string' ? s.trim() : '');

// 這隻角色所有的名稱 (名稱、別名、各形態的名稱)；不含只在某個卡池才算的寫法
function namesOf(c) {
    return [c.name, ...(Array.isArray(c.aliases) ? c.aliases : []),
        ...(Array.isArray(c.forms) ? c.forms.map((f) => f && f.name) : [])].map(clean).filter(Boolean);
}

// 名冊 → { byId: Map<編號, 角色>, byKey: Map<比對用名稱, 角色>, problems: [說明] }
//   problems：重複的編號、格式不對的編號、兩隻角色用到同一個名稱
function indexRoster(data) {
    const byId = new Map();
    const byKey = new Map();
    const problems = [];
    listOf(data).forEach((c) => {
        if (!c || !ID_RE.test(c.id) || !clean(c.name)) { problems.push(`格式不對：${JSON.stringify(c)}`); return; }
        if (byId.has(c.id)) { problems.push(`編號重複：${c.id}`); return; }
        byId.set(c.id, c);
        namesOf(c).forEach((n) => {
            const key = poolKey(n);
            const other = byKey.get(key);
            if (other && other !== c) problems.push(`「${n}」同時是 ${other.id}（${other.name}）和 ${c.id}（${c.name}）的名稱`);
            else byKey.set(key, c);
        });
    });
    return { byId, byKey, problems };
}

// 名稱 → 角色 (找不到回傳 null)。pool：卡池名稱，有給時先看只在那個卡池才算的寫法
function findCharacter(data, name, pool) {
    const key = poolKey(name);
    if (!key) return null;
    if (pool) {
        const scoped = listOf(data).find((c) => Object.entries(c.poolAliases || {})
            .some(([p, list]) => poolKey(p) === poolKey(pool) && list.some((n) => poolKey(n) === key)));
        if (scoped) return scoped;
    }
    return indexRoster(data).byKey.get(key) || null;
}

function nextId(data) {
    const max = listOf(data).reduce((m, c) => Math.max(m, ID_RE.test(c.id) ? Number(c.id.slice(1)) : 0), 0);
    return 'c' + String(max + 1).padStart(4, '0');
}

// 加一隻新角色 (不改動傳入的物件)。回傳 { data, character }
function addCharacter(data, name, element) {
    const character = { id: nextId(data), name: clean(name) };
    if (!character.name) throw new Error('角色名稱不能是空白');
    if (ELEMENT_RE.test(element || '')) character.element = element;
    return { data: { ...data, characters: [...listOf(data), character] }, character };
}

// pools.json (chars 是編號) → 爬蟲用的格式 (chars 是名稱)。名冊沒有的編號會丟出錯誤
function poolsToNames(poolsData, data) {
    const { byId } = indexRoster(data);
    const { names, ...rest } = poolsData || {};
    return {
        ...rest,
        pools: ((poolsData && poolsData.pools) || []).map((p) => ({
            ...p,
            chars: (p.chars || []).map((c) => {
                if (!ID_RE.test(c)) return c;   // 舊格式：直接寫名稱
                if (!byId.has(c)) throw new Error(`pools.json「${p.pool}」用到名冊沒有的編號 ${c}`);
                return byId.get(c).name;
            })
        }))
    };
}

// 爬蟲用的格式 (chars 是名稱) → pools.json (chars 是編號，另外附上 names：編號 → 名稱)
//   名冊沒有的名稱編新的編號。回傳 { pools, data (名冊), added: [{ id, name, pool }] }
//   names 是給直接讀 pools.json 的程式用的 (抽卡統計的角色按鈕)，每次寫檔時從名冊重新產生
function poolsToIds(namePools, data) {
    let roster = { ...data, characters: [...listOf(data)] };
    let { byKey } = indexRoster(roster);
    const added = [];
    const used = new Map();
    const pools = ((namePools && namePools.pools) || []).map((p) => ({
        ...p,
        chars: (p.chars || []).map((name) => {
            let c = byKey.get(poolKey(name));
            if (!c) {
                const result = addCharacter(roster, name);
                roster = result.data;
                c = result.character;
                byKey.set(poolKey(name), c);
                added.push({ id: c.id, name: c.name, pool: p.pool });
            }
            used.set(c.id, c.name);
            return c.id;
        })
    }));
    const names = Object.fromEntries([...used.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const { names: old, pools: oldPools, ...head } = namePools || {};
    return { pools: { ...head, pools, names }, data: roster, added };
}

// 名冊的別名 → 爬蟲的名稱對應 { global: { 寫法: 名稱 }, pools: { 卡池: { 寫法: 名稱 } } }
function rosterOverrides(data) {
    const global = {};
    const pools = {};
    listOf(data).forEach((c) => {
        (c.aliases || []).forEach((a) => { if (clean(a)) global[clean(a)] = c.name; });
        Object.entries(c.poolAliases || {}).forEach(([pool, list]) => list.forEach((a) => {
            if (!clean(a)) return;
            pools[pool] = pools[pool] || {};
            pools[pool][clean(a)] = c.name;
        }));
    });
    return { global, pools };
}

// 名冊 → 屬性表 { 名稱: 屬性 }
function rosterElements(data) {
    return Object.fromEntries(listOf(data).filter((c) => ELEMENT_RE.test(c.element || '')).map((c) => [c.name, c.element]));
}

// 屬性表寫回名冊：名冊沒有的名稱編新的編號；已經有屬性的不覆蓋。回傳 { data, added: [{ id, name }], filled }
function applyElements(data, elements) {
    let roster = { ...data, characters: listOf(data).map((c) => ({ ...c })) };
    const { byKey } = indexRoster(roster);
    const added = [];
    let filled = 0;
    Object.entries(elements || {}).forEach(([name, element]) => {
        if (!ELEMENT_RE.test(element) || !poolKey(name)) return;
        const c = byKey.get(poolKey(name));
        if (!c) {
            const result = addCharacter(roster, name, element);
            roster = result.data;
            byKey.set(poolKey(name), result.character);
            added.push({ id: result.character.id, name: result.character.name });
        } else if (!c.element) {
            c.element = element;
            filled += 1;
        }
    });
    return { data: roster, added, filled };
}

// characters.json 的寫法：一隻角色一行，依編號排序
function formatRoster(data) {
    const order = ['id', 'name', 'element', 'aliases', 'poolAliases', 'forms'];
    const line = (c) => {
        const keys = [...order.filter((k) => k in c), ...Object.keys(c).filter((k) => !order.includes(k))];
        return `{${keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(c[k])}`).join(', ')}}`;
    };
    const chars = [...listOf(data)].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return ['{', `  "說明": ${JSON.stringify((data && data['說明']) || NOTE)},`, '  "characters": [',
        chars.map((c) => `    ${line(c)}`).join(',\n'), '  ]', '}', ''].join('\n');
}

module.exports = {
    ID_RE, NOTE, namesOf, indexRoster, findCharacter, nextId, addCharacter,
    poolsToNames, poolsToIds, rosterOverrides, rosterElements, applyElements, formatRoster
};
