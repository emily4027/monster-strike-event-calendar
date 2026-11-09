// 行事曆的純函式：日期計算、活動整理、月曆排版、抽數彙總。
// 不碰 DOM，瀏覽器裡掛在 window.CalendarCore，Node 測試用 require 載入 (見 tests/)。
(function (root) {
    'use strict';

    const TAGS = ['honke', 'collab', 'free', 'orb'];
    const TAG_LABELS = { honke: '本家', collab: '合作', free: '免費', orb: '寶珠' };

    // ---- 日期 (一律用 'YYYY-MM-DD' 字串，以 UTC 計算，避免時區造成差一天) ----
    function isValidDate(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const [y, m, d] = value.split('-').map(Number);
        const date = new Date(Date.UTC(y, m - 1, d));
        return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
    }

    const pad = (n) => String(n).padStart(2, '0');
    const toDateString = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const parseDate = (s) => {
        const [y, m, d] = s.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d));
    };

    function addDays(dateStr, days) {
        const d = parseDate(dateStr);
        d.setUTCDate(d.getUTCDate() + days);
        return toDateString(d);
    }

    function daysBetween(from, to) {
        return Math.round((parseDate(to) - parseDate(from)) / 86400000);
    }

    // 月份以 { year, month } 表示，month 為 1–12
    function addMonths({ year, month }, delta) {
        const index = year * 12 + (month - 1) + delta;
        return { year: Math.floor(index / 12), month: (index % 12) + 1 };
    }

    const monthKey = ({ year, month }) => `${year}-${pad(month)}`;

    // 本機時間的今天 (使用者看到的日期)
    function todayString(now = new Date()) {
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }

    // 月曆格：從包含 1 號的那週週日開始，到包含月底的那週週六結束
    function monthWeeks({ year, month }) {
        const first = `${year}-${pad(month)}-01`;
        const last = addDays(monthKey(addMonths({ year, month }, 1)) + '-01', -1);
        let cursor = addDays(first, -parseDate(first).getUTCDay());
        const weeks = [];
        while (cursor <= last) {
            const days = [];
            for (let i = 0; i < 7; i++) {
                const date = addDays(cursor, i);
                days.push({ date, day: Number(date.slice(8)), inMonth: date.slice(0, 7) === monthKey({ year, month }) });
            }
            weeks.push(days);
            cursor = addDays(cursor, 7);
        }
        return weeks;
    }

    // ---- 活動 ----
    const normalizeName = (name) => String(name === undefined || name === null ? '' : name)
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

    // 整理活動清單：略過沒有名稱或日期不正確的活動；結束日不正確或早於開始日時當作沒有結束日
    function normalizeEvents(list) {
        if (!Array.isArray(list)) return [];
        const seen = new Set();
        const result = [];
        list.forEach((e) => {
            if (!e || typeof e !== 'object') return;
            const event = normalizeName(e.event);
            if (!event || seen.has(event) || !isValidDate(e.date)) return;
            seen.add(event);
            const item = { event, date: e.date, tag: TAGS.includes(e.tag) ? e.tag : '' };
            if (isValidDate(e.endDate) && e.endDate >= e.date) item.endDate = e.endDate;
            const aliases = Array.isArray(e.aliases)
                ? [...new Set(e.aliases.filter((a) => typeof a === 'string').map(normalizeName).filter((a) => a && a !== event))]
                : [];
            if (aliases.length) item.aliases = aliases;
            if (typeof e.source === 'string' && /^https:\/\//.test(e.source)) item.source = e.source;
            result.push(item);
        });
        return result.sort(compareEvents);
    }

    const endOf = (e) => e.endDate || e.date;

    // 開始日早的在前；同一天時期間長的在前 (長條排在上面比較好看)，再依名稱
    function compareEvents(a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        if (endOf(a) !== endOf(b)) return endOf(a) > endOf(b) ? -1 : 1;
        return a.event.localeCompare(b.event);
    }

    // 活動期間和 [from, to] 有重疊的活動
    function eventsInRange(events, from, to) {
        return events.filter((e) => e.date <= to && endOf(e) >= from);
    }

    // 顯示用名稱：去掉開頭的「YYYY-MM月」
    function displayName(event) {
        return event.replace(/^\d{4}[-年/]\d{1,2}月?\s*/, '').trim() || event;
    }

    // 一週的長條排版：每個活動佔 startCol (0–6) 起 span 格，lane 是第幾列；
    // 同一列的長條不重疊。continuesBefore / After 表示活動在這週之前 / 之後還有。
    function layoutWeek(events, weekStart) {
        const weekEnd = addDays(weekStart, 6);
        const laneEnds = [];   // 每一列目前最後被佔用的欄
        return eventsInRange(events, weekStart, weekEnd).sort(compareEvents).map((e) => {
            const start = e.date < weekStart ? weekStart : e.date;
            const end = endOf(e) > weekEnd ? weekEnd : endOf(e);
            const startCol = daysBetween(weekStart, start);
            const span = daysBetween(start, end) + 1;
            let lane = laneEnds.findIndex((col) => col < startCol);
            if (lane === -1) { lane = laneEnds.length; laneEnds.push(-1); }
            laneEnds[lane] = startCol + span - 1;
            return {
                event: e, startCol, span, lane,
                continuesBefore: e.date < weekStart,
                continuesAfter: endOf(e) > weekEnd
            };
        });
    }

    // 活動期間文字：「11/02」或「11/02 – 11/14」(跨年時加上年份)
    function formatPeriod(e) {
        const short = (s, withYear) => (withYear ? `${s.slice(0, 4)}/` : '') + `${s.slice(5, 7)}/${s.slice(8)}`;
        if (!e.endDate || e.endDate === e.date) return short(e.date, false);
        const crossYear = e.date.slice(0, 4) !== e.endDate.slice(0, 4);
        return `${short(e.date, crossYear)} – ${short(e.endDate, crossYear)}`;
    }

    // ---- 抽卡紀錄 ----
    // 舊名稱 -> 新名稱 (活動改名後，舊名稱的紀錄要算到新名稱)
    function buildAliasMap(events) {
        const names = new Set(events.map((e) => e.event));
        const map = new Map();
        events.forEach((e) => (e.aliases || []).forEach((alias) => {
            if (!names.has(alias)) map.set(alias, e.event);
        }));
        return map;
    }

    function cleanRecords(list) {
        if (!Array.isArray(list)) return [];
        return list.filter((r) => r && typeof r === 'object'
            && typeof r.event === 'string' && normalizeName(r.event)
            && typeof r.account === 'string' && r.account.trim());
    }

    // 依活動彙總抽數：Map<活動名稱, { total, accounts: [{ account, pulls, notes }] }>
    // account 為 'all' 以外的值時只算那個帳號。notes 是該帳號在這個活動的所有「獲得角色」。
    function summarizePulls(records, events, account = 'all') {
        const aliasMap = buildAliasMap(events);
        const summary = new Map();
        cleanRecords(records).forEach((r) => {
            const name = normalizeName(r.event);
            const event = aliasMap.get(name) || name;
            const acc = r.account.trim();
            if (account !== 'all' && acc !== account) return;
            const pulls = Number.isFinite(Number(r.pulls)) ? Math.max(0, Number(r.pulls)) : 0;
            if (!summary.has(event)) summary.set(event, { total: 0, byAccount: new Map() });
            const entry = summary.get(event);
            entry.total += pulls;
            if (!entry.byAccount.has(acc)) entry.byAccount.set(acc, { account: acc, pulls: 0, notes: [] });
            const row = entry.byAccount.get(acc);
            row.pulls += pulls;
            const notes = typeof r.notes === 'string' ? r.notes.trim() : '';
            if (notes) row.notes.push(notes);
        });
        const result = new Map();
        summary.forEach((entry, event) => {
            result.set(event, { total: entry.total, accounts: sortAccounts([...entry.byAccount.values()]) });
        });
        return result;
    }

    // 帳號排序：抽卡統計慣用的三個帳號在前，其他依名稱
    const PREFERRED_ACCOUNT_ORDER = ['羽入', '梨花', '沙都子'];
    function sortAccountNames(names) {
        const rank = (n) => {
            const i = PREFERRED_ACCOUNT_ORDER.indexOf(n);
            return i === -1 ? PREFERRED_ACCOUNT_ORDER.length : i;
        };
        return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    }
    function sortAccounts(rows) {
        const order = sortAccountNames(rows.map((r) => r.account));
        return order.map((name) => rows.find((r) => r.account === name));
    }

    function accountNames(records) {
        return sortAccountNames([...new Set(cleanRecords(records).map((r) => r.account.trim()))]);
    }

    const api = {
        TAGS, TAG_LABELS,
        isValidDate, addDays, daysBetween, addMonths, monthKey, todayString, monthWeeks,
        normalizeEvents, compareEvents, eventsInRange, displayName, layoutWeek, formatPeriod,
        buildAliasMap, summarizePulls, accountNames
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.CalendarCore = api;
})(this);
