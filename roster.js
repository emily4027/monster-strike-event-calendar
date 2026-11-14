// =====================================================
// 角色名冊 (characters.json)：純函式，不連網路、不寫檔、不碰 DOM (測試見 tests/roster.test.js)
// 瀏覽器：window.Roster (要先載入 pools.js)；Node (爬蟲、測試)：require('./roster.js')
//
// characters.json：
//   { "說明": "...", "characters": [
//       { "id": "c0001", "name": "瑪娜", "no": 1234, "element": "光",   // no：選填，轉蛋抽到的這個形態的圖鑑編號
//         "kind": "period",                              // 選填：類別，只在角色不屬於任何卡池時才用 (見 KINDS)
//         "new": true,                                   // 選填：爬蟲新編的編號，管理員還沒確認
//         "aliases": ["別的寫法"],                       // 選填：同一隻角色的其他寫法 (管理員確認過)
//         "poolAliases": { "卡池名稱": ["公告上的寫法"] },  // 選填：只在那個卡池才算這隻角色的寫法
//         "forms": [{ "no": 1234, "name": "慈愛天使 瑪娜", "form": "獸神化" }] }  // 選填：各形態與遊戲的圖鑑編號
//     ],
//     "distinct": [["c0001", "c0002"]] }                 // 選填：名稱只差一個字、管理員確認是不同角色的兩隻
//   id：內部編號，編了就不改、不重複使用。pools.json 的 chars 寫的是這個編號。
//   name：台版官網的寫法 (轉蛋抽到的那個形態)。名稱、別名、各形態的名稱都能找到這隻角色。
//
// 管理員在角色頁的編輯模式做的修改，先存在 Firestore shared/roster (「修改檔」)：
//   { chars: { 編號: 整筆角色資料 }, merged: { 被合併的編號: 併進去的編號 },
//     adds: [還沒有編號的新角色], distinct: ["編號|編號"],
//     pools: [{ id, pool, month, source }]：把角色加進那個月的限定卡池 (管理員手動補的，多半是 2023-09 以前的卡池)，
//     unpools: [{ id, pool, month }]：把角色從那個月的限定卡池拿掉 }
//   網頁讀 characters.json 後套上修改檔 (applyEdits)，所以修改立刻生效；
//   爬蟲每天把修改檔寫回 characters.json 和 pools.json (foldEdits)，寫回去的部分下次執行時從修改檔清掉 (pruneEdits)。
//
// 爬蟲 (pool-parse.js) 內部仍然用名稱比對；讀檔時把編號換成名稱、寫檔時換回編號 (見 scraper/apply-pools.js)。
// =====================================================
(function (root) {
    'use strict';

    const { poolKey } = (typeof module !== 'undefined' && module.exports) ? require('./pools.js') : root.CharacterPools;

    const ID_RE = /^c\d{4,}$/;
    const ELEMENT_RE = /^[火水木光闇]$/;
    // 類別：由管理員指定。期間限定在卡池裡也套用 (祭典裡的特別造型標「期間限定：激獸神祭」)；其他只在角色不屬於任何卡池時才用
    const KINDS = { limited: '限定', period: '期間限定', collab: '合作', regular: '常駐' };
    const FORMS = ['進化前', '進化', '神化', '獸神化', '獸神化・改', '真獸神化'];
    const NOTE = '角色名冊。id：內部編號，編了就不改、不重複使用，pools.json 的 chars 寫的是這個編號。name：台版官網的寫法。no：轉蛋抽到的這個形態在遊戲裡的圖鑑編號。element：屬性 (火水木光闇)，網頁用來替名稱上色。kind：類別 (limited 限定 / period 期間限定 / collab 合作 / regular 常駐)。期間限定在卡池裡也套用 (祭典裡的特別造型)，其他只在角色不屬於任何卡池時才用。new：爬蟲新編的編號，管理員還沒確認。aliases：同一隻角色的其他寫法。poolAliases：只在那個卡池才算這隻角色的寫法 { 卡池名稱: [寫法] }。forms：各形態 [{ no: 遊戲的圖鑑編號, name: 名稱, form: 形態 }]。distinct：名稱只差一個字、確認是不同角色的兩隻。平常在角色頁的編輯模式修改 (爬蟲每天寫回這個檔案)；爬蟲讀到名冊沒有的名稱時會編新的編號，已經有的資料不會被爬蟲覆蓋。';

    const listOf = (data) => (data && Array.isArray(data.characters) ? data.characters : []);
    const clean = (s) => (typeof s === 'string' ? s.trim() : '');
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const pairKey = (a, b) => [a, b].sort().join('|');

    // 這隻角色所有的名稱 (名稱、別名、各形態的名稱)；不含只在某個卡池才算的寫法
    function namesOf(c) {
        return [c.name, ...(Array.isArray(c.aliases) ? c.aliases : []),
            ...(Array.isArray(c.forms) ? c.forms.map((f) => f && f.name) : [])].map(clean).filter(Boolean);
    }

    // 錯誤訊息裡的角色：編號，名稱和衝突的名稱不同時再附上名稱 (「c0390」、「c0282「無敵的…」」)
    const charLabel = (c, n) => `${c.pending || !c.id ? '新角色' : c.id}${poolKey(c.name) === poolKey(n) ? '' : `「${c.name}」`}`;

    // 名冊 → { byId: Map<編號, 角色>, byKey: Map<比對用名稱, 角色>, problems: [說明] }
    //   problems：重複的編號、格式不對的編號、兩隻角色用到同一個名稱
    //   還沒有編號的新角色 (修改檔的 adds，pending: true) 不檢查編號
    function indexRoster(data) {
        const byId = new Map();
        const byKey = new Map();
        const problems = [];
        listOf(data).forEach((c) => {
            if (!c || !clean(c.name) || (!c.pending && !ID_RE.test(c.id))) { problems.push(`格式不對：${JSON.stringify(c)}`); return; }
            if (!c.pending) {
                if (byId.has(c.id)) { problems.push(`編號重複：${c.id}`); return; }
                byId.set(c.id, c);
            }
            namesOf(c).forEach((n) => {
                const key = poolKey(n);
                const other = byKey.get(key);
                if (other && other !== c) problems.push(`「${n}」同時是 ${charLabel(other, n)} 和 ${charLabel(c, n)} 的名稱`);
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
    //   extra：其他欄位 (爬蟲新增的角色帶 { new: true })
    function addCharacter(data, name, element, extra) {
        const character = { id: nextId(data), name: clean(name) };
        if (!character.name) throw new Error('角色名稱不能是空白');
        if (ELEMENT_RE.test(element || '')) character.element = element;
        Object.assign(character, extra || {});
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
    //   名冊沒有的名稱編新的編號 (標 new，等管理員確認)。回傳 { pools, data (名冊), added: [{ id, name, pool }] }
    //   names 是給直接讀 pools.json 的程式用的 (抽卡統計的角色按鈕)，每次寫檔時從名冊重新產生
    function poolsToIds(namePools, data) {
        let roster = { ...data, characters: [...listOf(data)] };
        const { byKey } = indexRoster(roster);
        const added = [];
        const used = new Map();
        const pools = ((namePools && namePools.pools) || []).map((p) => ({
            ...p,
            chars: (p.chars || []).map((name) => {
                let c = byKey.get(poolKey(name));
                if (!c) {
                    const result = addCharacter(roster, name, '', { new: true });
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

    // 屬性表寫回名冊：名冊沒有的名稱編新的編號 (標 new)；已經有屬性的不覆蓋。回傳 { data, added: [{ id, name }], filled }
    function applyElements(data, elements) {
        let roster = { ...data, characters: listOf(data).map((c) => ({ ...c })) };
        const { byKey } = indexRoster(roster);
        const added = [];
        let filled = 0;
        Object.entries(elements || {}).forEach(([name, element]) => {
            if (!ELEMENT_RE.test(element) || !poolKey(name)) return;
            const c = byKey.get(poolKey(name));
            if (!c) {
                const result = addCharacter(roster, name, element, { new: true });
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
        const order = ['id', 'name', 'no', 'element', 'kind', 'new', 'aliases', 'poolAliases', 'forms'];
        const line = (c) => {
            const keys = [...order.filter((k) => k in c), ...Object.keys(c).filter((k) => !order.includes(k))];
            return `{${keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(c[k])}`).join(', ')}}`;
        };
        const chars = [...listOf(data)].sort((a, b) => String(a.id).localeCompare(String(b.id)));
        const distinct = data && Array.isArray(data.distinct) && data.distinct.length
            ? [`  "distinct": ${JSON.stringify(data.distinct)}`] : [];
        return ['{', `  "說明": ${JSON.stringify((data && data['說明']) || NOTE)},`, '  "characters": [',
            chars.map((c) => `    ${line(c)}`).join(',\n'), distinct.length ? '  ],' : '  ]', ...distinct, '}', ''].join('\n');
    }

    // =====================================================
    // 管理員的修改檔 (Firestore shared/roster)
    // =====================================================
    function readEdits(raw) {
        const o = raw && typeof raw === 'object' ? raw : {};
        const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
        return {
            chars: isObj(o.chars) ? Object.fromEntries(Object.entries(o.chars).filter(([id, c]) => ID_RE.test(id) && isObj(c) && clean(c.name))) : {},
            merged: isObj(o.merged) ? Object.fromEntries(Object.entries(o.merged).filter(([a, b]) => ID_RE.test(a) && ID_RE.test(b) && a !== b)) : {},
            adds: Array.isArray(o.adds) ? o.adds.filter((c) => isObj(c) && clean(c.name)) : [],
            distinct: Array.isArray(o.distinct) ? o.distinct.filter((k) => typeof k === 'string' && /^c\d{4,}\|c\d{4,}$/.test(k)) : [],
            pools: Array.isArray(o.pools) ? o.pools.filter(isPoolEdit).map((p) => ({ id: p.id, pool: clean(p.pool), month: p.month, ...(cleanSource(p.source) ? { source: cleanSource(p.source) } : {}) })) : [],
            unpools: Array.isArray(o.unpools) ? o.unpools.filter(isPoolEdit).map((p) => ({ id: p.id, pool: clean(p.pool), month: p.month })) : []
        };
    }

    // =====================================================
    // 管理員手動補的卡池 (修改檔的 pools / unpools)
    // =====================================================
    const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
    const isPoolEdit = (p) => p && typeof p === 'object' && ID_RE.test(p.id || '') && clean(p.pool) && MONTH_RE.test(p.month || '');
    const cleanSource = (s) => (/^https:\/\/\S+$/.test(clean(s)) ? clean(s) : '');
    const poolEditKey = (p) => `${p.id}|${poolKey(p.pool)}|${p.month}`;
    const monthsOf = (p) => (Array.isArray(p.months) ? p.months : typeof p.since === 'string' ? [p.since] : []);
    // pools.json 裡那個月的限定卡池版本 (卡池名稱比對時忽略空白、全形半形)
    const findVersion = (list, pool, month) => list.findIndex((p) => p && p.kind === 'limited'
        && poolKey(p.pool) === poolKey(pool) && monthsOf(p).includes(month));

    // pools.json (chars 是編號) 套上修改檔的 pools / unpools，回傳新的 pools.json (不改動傳入的物件)
    //   加：那個月已經有這個卡池的版本 → 加進它的名單；沒有 → 新增一個版本 (卡池名稱沿用既有的寫法)
    //   拿掉：從那個月的版本的名單拿掉；名單空了就整個版本拿掉
    function applyPoolEdits(poolsData, rawEdits) {
        const edits = readEdits(rawEdits);
        if (!edits.pools.length && !edits.unpools.length) return poolsData;
        const list = ((poolsData && poolsData.pools) || []).map((p) => ({ ...p, chars: [...(p.chars || [])] }));
        edits.unpools.forEach((u) => {
            const i = findVersion(list, u.pool, u.month);
            if (i < 0) return;
            list[i].chars = list[i].chars.filter((c) => c !== u.id);
            if (!list[i].chars.length) list.splice(i, 1);
        });
        edits.pools.forEach((a) => {
            const i = findVersion(list, a.pool, a.month);
            if (i >= 0) {
                if (!list[i].chars.includes(a.id)) list[i].chars.push(a.id);
                if (!list[i].source && a.source) list[i].source = a.source;
                return;
            }
            const known = list.find((p) => p && p.kind === 'limited' && poolKey(p.pool) === poolKey(a.pool));
            list.push({ pool: known ? known.pool : a.pool, kind: 'limited', months: [a.month], ...(a.source ? { source: a.source } : {}), chars: [a.id] });
        });
        return { ...poolsData, pools: list };
    }

    // 被合併的編號最後併到哪一隻 (A 併到 B、B 又併到 C → C)
    function mergeTarget(merged, id) {
        const seen = new Set();
        let current = id;
        while (merged[current] && !seen.has(current)) { seen.add(current); current = merged[current]; }
        return current;
    }

    // 整理一筆角色資料：去掉空白與空欄位、重複的別名；格式不對時丟出錯誤 (訊息可以直接顯示)
    function cleanCharacter(c, keepNew) {
        const name = clean(c && c.name);
        if (!name) throw new Error('名稱不能是空白');
        const out = {};
        if (c.id) out.id = c.id;
        out.name = name;
        const dexNo = (v) => {
            if (v === undefined || v === null || v === '') return null;
            const n = Number(v);
            if (!Number.isInteger(n) || n < 1) throw new Error('圖鑑編號要是正整數');
            return n;
        };
        if (dexNo(c.no) !== null) out.no = dexNo(c.no);
        if (c.element) {
            if (!ELEMENT_RE.test(c.element)) throw new Error('屬性要是火、水、木、光、闇其中一個');
            out.element = c.element;
        }
        if (c.kind) {
            if (!KINDS[c.kind]) throw new Error('類別不正確');
            out.kind = c.kind;
        }
        if (keepNew && c.new === true) out.new = true;
        const seen = new Set([poolKey(name)]);
        const uniq = (n) => { const k = poolKey(n); if (!k || seen.has(k)) return false; seen.add(k); return true; };
        const aliases = (Array.isArray(c.aliases) ? c.aliases : []).map(clean).filter(uniq);
        if (aliases.length) out.aliases = aliases;
        const poolAliases = {};
        Object.entries((c.poolAliases && typeof c.poolAliases === 'object') ? c.poolAliases : {}).forEach(([pool, list]) => {
            const names = (Array.isArray(list) ? list : []).map(clean).filter(Boolean);
            if (clean(pool) && names.length) poolAliases[clean(pool)] = names;
        });
        if (Object.keys(poolAliases).length) out.poolAliases = poolAliases;
        const forms = (Array.isArray(c.forms) ? c.forms : []).map((f) => {
            const form = {};
            const no = f && f.no !== undefined && f.no !== null && f.no !== '' ? Number(f.no) : null;
            if (no !== null) {
                if (!Number.isInteger(no) || no < 1) throw new Error('圖鑑編號要是正整數');
                form.no = no;
            }
            const formName = clean(f && f.name);
            // 形態的名稱和角色名稱相同時 (進化前) 可以留著，不算重複
            if (formName) form.name = formName;
            if (clean(f && f.form)) form.form = clean(f.form);
            return form;
        }).filter((f) => f.name || f.no);
        if (forms.length) out.forms = forms;
        return out;
    }

    // characters.json 套上修改檔 → 網頁用的名冊
    //   回傳 { data, names: { 編號: 名稱 } (含被合併的編號，給 pools.js 的 readPools 用) }
    //   還沒有編號的新角色：id 是空字串、pending: true
    function applyEdits(data, rawEdits) {
        const edits = readEdits(rawEdits);
        const gone = new Set(Object.keys(edits.merged));
        const characters = listOf(data).filter((c) => !gone.has(c.id)).map((c) => edits.chars[c.id] ? { ...edits.chars[c.id], id: c.id } : c);
        const { byKey } = indexRoster({ characters });
        edits.adds.forEach((c) => {
            if (byKey.has(poolKey(c.name))) return;   // 已經寫回名冊了
            characters.push({ ...c, id: '', pending: true });
        });
        const distinct = [...new Set([...((data && data.distinct) || []).map(([a, b]) => pairKey(a, b)), ...edits.distinct])];
        const names = Object.fromEntries(characters.filter((c) => c.id).map((c) => [c.id, c.name]));
        gone.forEach((id) => { const to = mergeTarget(edits.merged, id); if (names[to]) names[id] = names[to]; });
        return { data: { ...data, characters, distinct: distinct.map((k) => k.split('|')) }, names };
    }

    // 在修改檔上套用一個修改，回傳新的修改檔 (不改動傳入的物件)。data：characters.json
    //   { type: 'save', id, character }：存這隻角色 (同時當成確認過，拿掉 new)
    //   { type: 'add', character, original }：加一隻還沒有編號的新角色 (original：要取代的那筆還沒編號的角色名稱)
    //   { type: 'merge', from, fromName, into, as }：from (編號；還沒編號的角色給 fromName) 其實是 into 這隻，
    //        名稱併成 into 的別名 (as: 'alias') 或形態 (as: 'form')
    //   { type: 'distinct', a, b }：確認是不同角色 (不再提示)
    // 不合理的修改會丟出錯誤，訊息可以直接顯示給使用者
    function applyOp(data, rawEdits, op) {
        const edits = readEdits(rawEdits);
        const next = { chars: { ...edits.chars }, merged: { ...edits.merged }, adds: [...edits.adds], distinct: [...edits.distinct],
            pools: [...edits.pools], unpools: [...edits.unpools] };
        const current = applyEdits(data, edits).data;
        const check = (candidate) => {
            const problems = indexRoster(applyEdits(data, candidate).data).problems;
            if (problems.length) throw new Error(problems[0] + (/同時是/.test(problems[0]) ? '。如果是同一隻角色，請用「這隻其實是另一隻角色」合併過去' : ''));
        };
        const type = op && op.type;
        if (type === 'save') {
            const old = listOf(current).find((c) => c.id === op.id && !c.pending);
            if (!old) throw new Error('找不到這隻角色（可能已經被合併）');
            next.chars[op.id] = cleanCharacter({ ...op.character, id: op.id }, false);
        } else if (type === 'add') {
            const character = cleanCharacter({ ...op.character, id: undefined }, false);
            const others = indexRoster({ characters: listOf(current).filter((c) => !(c.pending && poolKey(c.name) === poolKey(op.original || character.name))) }).byKey;
            const taken = namesOf(character).find((n) => others.has(poolKey(n)));
            if (taken) {
                const owner = others.get(poolKey(taken));
                throw new Error(poolKey(owner.name) === poolKey(taken)
                    ? `「${taken}」已經在名冊裡。是同一隻的話請用「合併過去」`
                    : `「${taken}」已經是「${owner.name}」的名稱。是同一隻的話請用「合併過去」`);
            }
            next.adds = next.adds.filter((c) => poolKey(c.name) !== poolKey(op.original || character.name));
            next.adds.push(character);
        } else if (type === 'merge') {
            const target = listOf(current).find((c) => c.id === op.into && !c.pending);
            const source = op.from ? listOf(current).find((c) => c.id === op.from && !c.pending)
                : (listOf(current).find((c) => c.pending && poolKey(c.name) === poolKey(op.fromName)) || { name: clean(op.fromName) });
            if (!target) throw new Error('找不到要併進去的角色');
            if (!source || !clean(source.name)) throw new Error('找不到要合併的角色');
            if (source === target) throw new Error('不能和自己合併');
            const merged = { ...target };
            if (op.as === 'form') {
                merged.forms = [...(target.forms || []), { name: source.name }, ...(source.forms || [])];
                merged.aliases = [...(target.aliases || []), ...(source.aliases || [])];
            } else {
                merged.aliases = [...(target.aliases || []), source.name, ...(source.aliases || [])];
                merged.forms = [...(target.forms || []), ...(source.forms || [])];
            }
            if (!merged.element && source.element) merged.element = source.element;
            if (source.poolAliases) merged.poolAliases = { ...source.poolAliases, ...(target.poolAliases || {}) };
            if (op.from) {
                delete next.chars[op.from];
                next.merged[op.from] = op.into;
            } else {
                next.adds = next.adds.filter((c) => poolKey(c.name) !== poolKey(source.name));
            }
            next.chars[op.into] = cleanCharacter({ ...merged, id: op.into }, false);
        } else if (type === 'distinct') {
            if (!ID_RE.test(op.a || '') || !ID_RE.test(op.b || '') || op.a === op.b) throw new Error('要選兩隻有編號的角色');
            if (!next.distinct.includes(pairKey(op.a, op.b))) next.distinct.push(pairKey(op.a, op.b));
            return next;
        } else if (type === 'pool' || type === 'unpool') {
            const c = listOf(current).find((x) => x.id === op.id && !x.pending);
            if (!c) throw new Error(op.id ? '找不到這隻角色（可能已經被合併）' : '新角色要等爬蟲編號後才能加卡池');
            const entry = { id: op.id, pool: clean(op.pool), month: clean(op.month) };
            if (!entry.pool) throw new Error('要填卡池名稱');
            if (!MONTH_RE.test(entry.month)) throw new Error('要選哪一年哪個月');
            const key = poolEditKey(entry);
            next.pools = next.pools.filter((p) => poolEditKey(p) !== key);
            next.unpools = next.unpools.filter((p) => poolEditKey(p) !== key);
            if (type === 'pool') {
                const source = clean(op.source);
                if (source && !cleanSource(source)) throw new Error('公告網址要是 https:// 開頭的網址');
                next.pools.push({ ...entry, ...(source ? { source } : {}) });
            } else if (!edits.pools.some((p) => poolEditKey(p) === key)) {
                // 修改檔裡還沒寫回的「加」直接取消就好；已經在 pools.json 裡的才要記一筆「拿掉」
                next.unpools.push(entry);
            }
            return next;
        } else {
            throw new Error('不認得的修改');
        }
        check(next);
        return next;
    }

    // 爬蟲：把修改檔寫回 characters.json 和 pools.json (chars 是編號)
    //   還沒有編號的新角色在這裡編號；被合併的角色從名冊拿掉，卡池裡的編號換成併進去的那隻
    //   options.skipAdds：還沒有編號的新角色這次先不編號 (有開著的卡池 PR 時，免得兩邊撞號)
    //   回傳 { data, pools, changed: 幾項修改, skipped: 先不編號的新角色數 }
    function foldEdits(data, poolsData, rawEdits, options = {}) {
        const edits = readEdits(rawEdits);
        const applied = applyEdits(data, edits).data;
        let roster = { ...data, characters: listOf(applied).filter((c) => !c.pending) };
        const { byKey } = indexRoster(roster);
        let added = 0;
        let skipped = 0;
        listOf(applied).filter((c) => c.pending).forEach((c) => {
            if (byKey.has(poolKey(c.name))) return;
            if (options.skipAdds) { skipped += 1; return; }
            const { pending, id, ...rest } = c;
            const result = addCharacter(roster, c.name, '', rest);
            roster = result.data;
            byKey.set(poolKey(c.name), result.character);
            added += 1;
        });
        if (applied.distinct.length) roster.distinct = applied.distinct.map(([a, b]) => [a, b].sort()).sort();
        else delete roster.distinct;
        const problems = indexRoster(roster).problems;
        if (problems.length) throw new Error('套用管理員的修改後名冊有問題：\n' + problems.join('\n'));

        const { byId } = indexRoster(roster);
        const withPools = applyPoolEdits(poolsData, edits);
        const remapped = {
            ...withPools,
            pools: ((withPools && withPools.pools) || []).map((p) => {
                const chars = [];
                (p.chars || []).forEach((id) => {
                    const to = ID_RE.test(id) ? mergeTarget(edits.merged, id) : id;
                    if (!chars.includes(to)) chars.push(to);
                });
                return { ...p, chars };
            })
        };
        const names = {};
        remapped.pools.forEach((p) => p.chars.forEach((id) => {
            if (!byId.has(id)) throw new Error(`pools.json「${p.pool}」用到名冊沒有的編號 ${id}`);
            names[id] = byId.get(id).name;
        }));
        remapped.names = Object.fromEntries(Object.entries(names).sort(([a], [b]) => a.localeCompare(b)));
        const changed = Object.keys(edits.chars).length + Object.keys(edits.merged).length + added + edits.distinct.length
            + edits.pools.length + edits.unpools.length;
        return { data: roster, pools: remapped, changed, skipped };
    }

    // 修改檔裡已經寫回 characters.json 的部分拿掉。data：已經 commit 的 characters.json
    //   poolsData：已經 commit 的 pools.json (有給時，手動補的卡池也清掉已經寫回的部分)
    function pruneEdits(data, rawEdits, poolsData) {
        const edits = readEdits(rawEdits);
        const { byId, byKey } = indexRoster(data);
        const have = new Set(((data && data.distinct) || []).map(([a, b]) => pairKey(a, b)));
        const list = (poolsData && poolsData.pools) || [];
        const inPool = (p) => { const i = findVersion(list, p.pool, p.month); return i >= 0 && (list[i].chars || []).includes(p.id); };
        // 角色已經被合併掉 (名冊沒有這個編號) 的也清掉：寫回時已經換成併進去的那隻
        return {
            chars: Object.fromEntries(Object.entries(edits.chars).filter(([id, c]) => byId.has(id) && !same(cleanCharacter({ ...c, id }, true), cleanCharacter(byId.get(id), true)))),
            merged: Object.fromEntries(Object.entries(edits.merged).filter(([from]) => byId.has(from))),
            adds: edits.adds.filter((c) => !byKey.has(poolKey(c.name))),
            distinct: edits.distinct.filter((k) => !have.has(k)),
            pools: poolsData ? edits.pools.filter((p) => byId.has(p.id) && !inPool(p)) : edits.pools,
            unpools: poolsData ? edits.unpools.filter((p) => byId.has(p.id) && inPool(p)) : edits.unpools
        };
    }

    // =====================================================
    // 編輯模式：有狀況的角色
    // =====================================================
    // 每隻角色的狀況，依嚴重程度排序。回傳 [{ character, issues: [{ type, text }] }]，有狀況的在前
    //   options.inPool(name)：這個名稱在不在任何卡池裡
    //   options.similarOf：Map<名稱, [只差一個字的其他名稱]> (catalog.js 的 findSimilarNames)
    //   options.recordNames：抽卡紀錄裡的角色名稱 (名冊沒有的會另外列出來，character.id 是空字串、missing: true)
    const ISSUE_ORDER = ['new', 'missing', 'nopool', 'noelement', 'similar'];
    function rosterIssues(data, options = {}) {
        const { byKey } = indexRoster(data);
        const distinct = new Set(((data && data.distinct) || []).map(([a, b]) => pairKey(a, b)));
        const inPool = options.inPool || (() => false);
        const similarOf = options.similarOf || new Map();
        const rows = listOf(data).map((c) => {
            const issues = [];
            if (c.new) issues.push({ type: 'new', text: '爬蟲新增，請確認不是既有角色的另一種寫法' });
            if (c.pending) issues.push({ type: 'pending', text: '已加進名冊，等爬蟲下次執行時編號' });
            if ((c.kind === 'limited' || c.kind === 'period') && !namesOf(c).some((n) => inPool(n))) {
                issues.push({ type: 'nopool', text: `${KINDS[c.kind]}，還沒有卡池資料` });
            }
            if (!c.element) issues.push({ type: 'noelement', text: '沒有屬性，名稱不會上色' });
            const others = (similarOf.get(c.name) || []).map((n) => byKey.get(poolKey(n)))
                .filter((o) => o && o !== c && !(c.id && o.id && distinct.has(pairKey(c.id, o.id))));
            if (others.length) issues.push({ type: 'similar', text: `和「${others.map((o) => o.name).join('」「')}」只差一個字，請確認是不是同一隻`, others: others.map((o) => o.id).filter(Boolean) });
            return { character: c, issues };
        });
        const seen = new Set();
        (options.recordNames || []).forEach((name) => {
            const key = poolKey(name);
            if (!key || seen.has(key) || byKey.has(key)) return;
            seen.add(key);
            rows.push({ character: { id: '', name: clean(name), missing: true }, issues: [{ type: 'missing', text: '抽卡紀錄裡有這個名稱，名冊沒有（可能是打錯字或漏收）' }] });
        });
        const rank = (r) => {
            const ranks = r.issues.map((i) => ISSUE_ORDER.indexOf(i.type)).filter((i) => i >= 0);
            return ranks.length ? Math.min(...ranks) : ISSUE_ORDER.length;
        };
        return rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
    }

    const hasDexNumbers = (c) => !!c.no || (Array.isArray(c.forms) && c.forms.some((f) => f && f.no));

    const api = {
        ID_RE, KINDS, FORMS, NOTE, namesOf, indexRoster, findCharacter, nextId, addCharacter,
        poolsToNames, poolsToIds, rosterOverrides, rosterElements, applyElements, formatRoster,
        readEdits, mergeTarget, cleanCharacter, applyEdits, applyOp, foldEdits, pruneEdits, rosterIssues, hasDexNumbers,
        applyPoolEdits
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Roster = api;
})(this);
