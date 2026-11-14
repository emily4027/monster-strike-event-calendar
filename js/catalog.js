// =====================================================
// 角色頁的資料計算 (純函式，不碰 DOM 與 Firebase)；行事曆的「這期卡池」也用 charactersInNotes
// 瀏覽器：window.Catalog；Node (測試)：require('./js/catalog.js')
//
// 這裡只「讀」抽卡統計的紀錄，絕對不寫入。
// 解析規則必須和果實分配一致 (monster-strike-fruit-assign/script.js 的
// parseGachaCharacters、CHARACTER_TAG_RE、baseNameOf)，三邊解析方式不同會對不起來。
// =====================================================
(function (root) {
    'use strict';

    // 寶珠紀錄的「獲得角色」是寶珠數量，不是角色
    const SKIP_TAGS = ['orb'];

    // 果實分配加在角色名稱最後的註記「(同族)」「（戰型）」「(擊種)」「(雙削)」
    const CHARACTER_TAG_RE = /\s*[(（](?:同族|戰型|擊種|雙削)[)）]$/;
    const stripTag = (name) => String(name).replace(CHARACTER_TAG_RE, '');
    // 「虹夏-2(同族)」→「虹夏」(拿掉註記與果實分配的同名編號)
    const baseNameOf = (name) => stripTag(name).replace(/-\d+$/, '').trim();

    // 「虹夏*3、麒麟兒*2」→ [{ name: '虹夏', count: 3 }, { name: '麒麟兒', count: 2 }]
    //   照抄果實分配的 parseGachaCharacters，改動時兩邊要一起改
    const GACHA_NOT_CHARACTER = /^(?:[\d?？]+\s*抽|\d+\s*顆|\d+|無)$/;
    function parseGachaCharacters(notes) {
        const counts = new Map();
        let last = '';
        String(notes || '').split(/[,，、\s+]+/).forEach((part) => {
            const p = part.trim();
            if (!p) return;
            if (GACHA_NOT_CHARACTER.test(p)) {
                last = '';
                return;
            }

            const bare = p.match(/^[*xX×](\d+)$/);   // 單獨的「*2」：上一隻角色 ×2
            if (bare) {
                if (last) counts.set(last, counts.get(last) + Math.min(parseInt(bare[1], 10), 99) - 1);
                return;
            }

            const m = p.match(/^(.+?)(?:[ *xX×]+(\d+)[隻體]?|(\d+)[隻體])?$/);
            if (!m) return;
            let name = m[1].trim();
            let count = parseInt(m[2] || m[3] || '1', 10);
            const lead = !m[2] && !m[3] && name.match(/^(\d+)(\D{2,}.*)$/);
            if (lead) {
                count = parseInt(lead[1], 10);
                name = lead[2].trim();
            }
            count = Math.min(count, 99);
            if (!name || count <= 0) return;
            counts.set(name, (counts.get(name) || 0) + count);
            last = name;
        });
        return [...counts].map(([name, count]) => ({ name, count }));
    }

    // 活動名稱整理：和抽卡統計的 normalizeName 相同
    function normalizeName(name) {
        return String(name === undefined || name === null ? '' : name)
            .replace(/[ \t]{2,}/g, ' ')
            .trim();
    }

    // 活動清單 → 舊名稱對應新名稱 (和抽卡統計的 buildAliasMap 相同)
    function buildAliasMap(events) {
        const list = Array.isArray(events) ? events.filter((e) => e && typeof e.event === 'string') : [];
        const names = new Set(list.map((e) => normalizeName(e.event)));
        const map = new Map();
        list.forEach((e) => {
            (Array.isArray(e.aliases) ? e.aliases : []).forEach((alias) => {
                const a = normalizeName(alias);
                if (a && !names.has(a)) map.set(a, normalizeName(e.event));
            });
        });
        return map;
    }

    const isValidRecord = (r) => r && typeof r === 'object' && typeof r.notes === 'string';

    // 所有帳號名稱 (有角色的紀錄才算)，依名稱排序
    function listAccounts(records) {
        const set = new Set();
        (records || []).forEach((r) => {
            if (!isValidRecord(r) || SKIP_TAGS.includes(r.tag)) return;
            const account = normalizeName(r.account);
            if (account) set.add(account);
        });
        return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    }

    // 抽卡紀錄 → 圖鑑
    //   options.aliasMap：活動舊名稱 → 新名稱
    //   options.account：只看某個帳號 (省略 = 全部帳號合計)
    //   options.tags：只算這些活動類型 (省略或空陣列 = 全部)
    //   options.rename：角色名稱 → 修正後的名稱 (管理員的名稱修正，只影響顯示)
    // 回傳 [{ name, total, lastDate, oldNames: [被修正成這個名稱的原名稱], accounts: [{ account, count, entries: [{ date, event, tag, count, rawName }] }] }]
    function buildCatalog(records, options = {}) {
        const aliasMap = options.aliasMap || new Map();
        const rename = typeof options.rename === 'function' ? options.rename : (n) => n;
        const onlyAccount = options.account ? normalizeName(options.account) : '';
        const tags = Array.isArray(options.tags) && options.tags.length > 0 ? options.tags : null;
        const byName = new Map();

        (records || []).forEach((r) => {
            if (!isValidRecord(r) || SKIP_TAGS.includes(r.tag)) return;
            const account = normalizeName(r.account) || '(未命名帳號)';
            if (onlyAccount && account !== onlyAccount) return;
            if (tags && !tags.includes(r.tag)) return;

            const rawEvent = normalizeName(r.event);
            const event = aliasMap.get(rawEvent) || rawEvent;
            const date = typeof r.date === 'string' ? r.date : '';

            parseGachaCharacters(r.notes).forEach(({ name: raw, count }) => {
                const rawName = baseNameOf(raw);
                if (!rawName) return;
                const name = rename(rawName) || rawName;
                let entry = byName.get(name);
                if (!entry) {
                    entry = { name, total: 0, lastDate: '', oldNames: new Set(), accounts: new Map() };
                    byName.set(name, entry);
                }
                if (rawName !== name) entry.oldNames.add(rawName);
                entry.total += count;
                if (date > entry.lastDate) entry.lastDate = date;

                let acc = entry.accounts.get(account);
                if (!acc) {
                    acc = { account, count: 0, entries: [] };
                    entry.accounts.set(account, acc);
                }
                acc.count += count;
                acc.entries.push({ date, event, tag: r.tag || '', count, rawName });
            });
        });

        return [...byName.values()].map((e) => ({
            name: e.name,
            total: e.total,
            lastDate: e.lastDate,
            oldNames: [...e.oldNames].sort((a, b) => a.localeCompare(b, 'zh-Hant')),
            accounts: [...e.accounts.values()]
                .map((a) => ({ ...a, entries: a.entries.sort((x, y) => y.date.localeCompare(x.date)) }))
                .sort((a, b) => b.count - a.count || a.account.localeCompare(b.account, 'zh-Hant'))
        }));
    }

    // 排序：recent (最近抽到，預設)、name (名稱)、count (數量)
    function sortCatalog(list, mode = 'recent') {
        const byName = (a, b) => a.name.localeCompare(b.name, 'zh-Hant');
        const compare = {
            name: byName,
            count: (a, b) => b.total - a.total || byName(a, b),
            recent: (a, b) => b.lastDate.localeCompare(a.lastDate) || byName(a, b)
        }[mode] || ((a, b) => b.lastDate.localeCompare(a.lastDate) || byName(a, b));
        return [...list].sort(compare);
    }

    // 名稱搜尋 (不分大小寫、忽略空白)
    function filterByQuery(list, query) {
        const q = String(query || '').replace(/\s+/g, '').toLowerCase();
        if (!q) return list;
        return list.filter((e) => e.name.toLowerCase().includes(q));
    }

    // 「疑似相同」：字數相同、只差一個中文字，例如「羌廆」和「羌瘣」。
    // 「杏子α / 杏子β」這種差在符號或英數字的是不同角色，不算。
    const CJK_RE = /[㐀-鿿豈-﫿]/;
    function differsByOneCjk(a, b) {
        const x = [...a];
        const y = [...b];
        if (x.length !== y.length || x.length < 2) return false;
        let diff = -1;
        for (let i = 0; i < x.length; i++) {
            if (x[i] === y[i]) continue;
            if (diff !== -1) return false;
            diff = i;
        }
        return diff !== -1 && CJK_RE.test(x[diff]) && CJK_RE.test(y[diff]);
    }

    // 名稱 → 疑似相同的其他名稱 (Map<string, string[]>)
    function findSimilarNames(names) {
        const unique = [...new Set(names)];
        const result = new Map();
        // 依字數分組，只比對同字數的名稱
        const groups = new Map();
        unique.forEach((n) => {
            const len = [...n].length;
            if (!groups.has(len)) groups.set(len, []);
            groups.get(len).push(n);
        });
        groups.forEach((group) => {
            for (let i = 0; i < group.length; i++) {
                for (let j = i + 1; j < group.length; j++) {
                    if (!differsByOneCjk(group[i], group[j])) continue;
                    if (!result.has(group[i])) result.set(group[i], []);
                    if (!result.has(group[j])) result.set(group[j], []);
                    result.get(group[i]).push(group[j]);
                    result.get(group[j]).push(group[i]);
                }
            }
        });
        return result;
    }

    // 卡池標記
    //   limitedOf：角色名稱 → 限定卡池 (pools.js 的 buildLimitedLookup)，沒有時不標限定
    //   { kind: 'limited', pools: ['激獸神祭'] }：官網名單上的限定角色
    //   { kind: 'collab', pools: [活動名稱...] }：在合作活動抽到的角色 (活動名稱來自抽卡紀錄)
    //   null：常駐角色，不標
    //   options.isPeriodPool(卡池名稱)：是不是期間限定的卡池 → 加上 period: true (期間限定也是限定)
    //   options.kindOf(角色名稱)：名冊裡管理員指定的類別。period (期間限定) 在卡池裡也套用 (祭典裡的特別造型)；
    //     其他類別只在沒有卡池資料時才用：
    //     limited / period → { kind: 'limited', pools: [], period }（卡池未知）；collab → { kind: 'collab', pools: [] }
    function poolOf(entry, limitedOf, options = {}) {
        const limited = limitedOf ? limitedOf(entry.name) : '';
        const kind = options.kindOf ? options.kindOf(entry.name) : '';
        if (limited) return { kind: 'limited', pools: [limited], ...((options.isPeriodPool && options.isPeriodPool(limited)) || kind === 'period' ? { period: true } : {}) };
        const events = [];
        (entry.accounts || []).forEach((a) => a.entries.forEach((e) => {
            if (e.tag === 'collab' && e.event && !events.includes(e.event)) events.push(e.event);
        }));
        if (events.length > 0) return { kind: 'collab', pools: events };
        if (kind === 'limited' || kind === 'period') return { kind: 'limited', pools: [], ...(kind === 'period' ? { period: true } : {}) };
        if (kind === 'collab') return { kind: 'collab', pools: [] };
        return null;
    }

    // 好幾筆紀錄的「獲得角色」→ 角色名稱 → 數量 (拿掉註記與同名編號、套用名稱修正)
    //   行事曆的活動詳細用這個標出卡池裡抽到了哪些角色
    function charactersInNotes(notesList, rename) {
        const fix = typeof rename === 'function' ? rename : (n) => n;
        const counts = new Map();
        (notesList || []).forEach((notes) => parseGachaCharacters(notes).forEach(({ name: raw, count }) => {
            const base = baseNameOf(raw);
            if (!base) return;
            const name = fix(base) || base;
            counts.set(name, (counts.get(name) || 0) + count);
        }));
        return counts;
    }

    const api = {
        SKIP_TAGS, stripTag, baseNameOf, parseGachaCharacters, normalizeName, buildAliasMap,
        listAccounts, buildCatalog, sortCatalog, filterByQuery, differsByOneCjk, findSimilarNames,
        poolOf, charactersInNotes
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Catalog = api;
})(this);
