// =====================================================
// 兩個頁面 (行事曆、角色) 共用的程式：window.Shared
//   - 建立元素、localStorage
//   - 讀取資料：活動清單、抽卡紀錄、卡池、名稱修正 (都只讀)
//   - 登入 / 登出、管理員判斷、雲端狀態
//   - 懸浮工具箱選單
// 需要先載入 firebase.js (module) 和 pools.js。
// =====================================================
(function (root) {
    'use strict';

    // 資料位置 (抽卡統計改了路徑或欄位時，這裡也要一起改)
    const EVENTS_DOC = ['shared', 'events'];                // 活動清單 (所有人可讀)
    const EVENTS_FALLBACK_URL = '/monster-strike-gacha/events.json';   // 同網域，讀不到雲端時的備援
    const NAME_FIXES_DOC = ['shared', 'characters'];        // 名稱修正 (所有人可讀、管理員可寫)
    const ADMINS_COLLECTION = 'admins';                     // admins/{uid} 存在即為管理員 (和抽卡統計共用)
    const GACHA_LOCAL_KEY = 'gachaRecords';                 // 抽卡統計的本機紀錄 (同網域共用)
    const POOLS_URL = 'pools.json';
    const ELEMENTS_URL = 'elements.json';                   // 角色名稱 → 屬性 (名稱上色用)
    const ELEMENT_CLASS = { '火': 'el-fire', '水': 'el-water', '木': 'el-wood', '光': 'el-light', '闇': 'el-dark' };

    const TOOLBOX_TOOLS_URL = 'https://emily4027.github.io/monster-strike-toolbox/tools.js';
    const THIS_TOOL = {
        id: 'gacha-data',
        name: '轉蛋資料庫',
        url: 'https://emily4027.github.io/monster-strike-gacha-data/',
        emoji: '🗂️'
    };

    const FIREBASE_WAIT_RETRIES = 50;   // 每次間隔 100ms

    // 建立元素：文字一律用 textContent，不拼 HTML 字串
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    const storage = {
        get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
        set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* 無痕模式等情況可忽略 */ } }
    };

    async function waitForFirebase() {
        for (let i = 0; i < FIREBASE_WAIT_RETRIES; i++) {
            if (root.firebaseFns && root.db && root.firebaseAuth) return true;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return false;
    }

    const fns = () => root.firebaseFns;
    const docRef = (...path) => fns().doc(root.db, ...path);

    // no-cache：每次都向伺服器確認有沒有新版 (GitHub Pages 預設快取 10 分鐘)
    async function fetchJson(url) {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    // =====================================================
    // 讀取資料 (只讀)
    // =====================================================

    // 活動清單：雲端優先，讀不到時用抽卡統計的 events.json
    //   → { events: [...原始資料], source: 'cloud' | 'fallback' | '' }
    async function loadEvents() {
        try {
            if (!(await waitForFirebase())) throw new Error('Firebase SDK 沒有載入');
            const snap = await fns().getDoc(docRef(...EVENTS_DOC));
            const list = snap.exists() ? snap.data().events : null;
            if (Array.isArray(list) && list.length > 0) return { events: list, source: 'cloud' };
            throw new Error('雲端還沒有活動清單');
        } catch (e) {
            console.warn('[EVENTS] 讀不到雲端活動清單，改用 events.json', e);
        }
        try {
            const list = await fetchJson(EVENTS_FALLBACK_URL);
            if (Array.isArray(list)) return { events: list, source: 'fallback' };
        } catch (e) {
            console.error('[EVENTS] 讀不到備援活動清單', e);
        }
        return { events: [], source: '' };
    }

    function readLocalRecords() {
        try {
            const list = JSON.parse(storage.get(GACHA_LOCAL_KEY) || '[]');
            return Array.isArray(list) ? list : [];
        } catch (e) {
            console.warn('[RECORDS] 本機抽卡紀錄格式不正確', e);
            return [];
        }
    }

    // 只讀取，不寫入 (抽卡統計和果實分配有版本檢查規則，這裡不碰)
    async function readCloudRecords(uid) {
        const snap = await fns().getDoc(docRef('artifacts', root.envAppId || 'default-app-id', 'users', uid, 'data', 'gacha_records'));
        const list = snap.exists() ? snap.data().records : [];
        return Array.isArray(list) ? list : [];
    }

    // 卡池讀不到時回傳空陣列 (只是不標卡池)
    async function loadPools() {
        try {
            return root.CharacterPools.readPools(await fetchJson(POOLS_URL));
        } catch (e) {
            console.warn('[DATA] 讀不到 pools.json', e);
            return [];
        }
    }

    // 屬性表 → 查詢函式：角色名稱 → CSS class (el-fire…)，不知道屬性時回傳空字串 (照一般顏色顯示)
    //   比對時忽略空白、間隔號、全形半形 (和卡池相同)
    async function loadElementClasses() {
        const { poolKey } = root.CharacterPools;
        try {
            const data = await fetchJson(ELEMENTS_URL);
            const map = new Map(Object.entries((data && data.elements) || {}).map(([name, e]) => [poolKey(name), ELEMENT_CLASS[e] || '']));
            return (name) => map.get(poolKey(name)) || '';
        } catch (e) {
            console.warn('[DATA] 讀不到 elements.json，角色名稱不上色', e);
            return () => '';
        }
    }

    // 名稱修正讀不到時，照紀錄原樣顯示
    async function loadNameFixes() {
        const { readNameFixes } = root.CharacterPools;
        try {
            if (!(await waitForFirebase())) return readNameFixes(null);
            const snap = await fns().getDoc(docRef(...NAME_FIXES_DOC));
            return readNameFixes(snap.exists() ? snap.data() : null);
        } catch (e) {
            console.warn('[CLOUD] 讀不到名稱修正', e);
            return readNameFixes(null);
        }
    }

    // 管理員的名稱修正：transaction 裡讀最新的 shared/characters，套用修改後寫回
    // (不會蓋掉其他管理員剛存的修改)。回傳存好的資料。
    async function saveNameFix(op) {
        const { applyNameFix } = root.CharacterPools;
        const ref = docRef(...NAME_FIXES_DOC);
        let saved = null;
        await fns().runTransaction(root.db, async (tx) => {
            const snap = await tx.get(ref);
            saved = applyNameFix(snap.exists() ? snap.data() : null, op);
            tx.set(ref, { ...saved, updatedAt: fns().serverTimestamp() });
        });
        return saved;
    }

    // admins/{uid} 存在即為管理員；真正的寫入權限由 Firestore 規則把關
    async function checkAdmin(user) {
        if (!user) return false;
        try {
            const snap = await fns().getDoc(docRef(ADMINS_COLLECTION, user.uid));
            return snap.exists();
        } catch (e) {
            return false;
        }
    }

    // =====================================================
    // 狀態列與登入
    // =====================================================
    function setStatus(state, text) {
        const dot = document.getElementById('statusDot');
        const label = document.getElementById('cloudStatusText');
        if (dot) dot.className = 'status-dot' + (state ? ` status-${state}` : '');
        if (label) label.textContent = text;
    }

    function renderAuthUI(user) {
        const $ = (id) => document.getElementById(id);
        $('google-login-btn').hidden = !!user;
        $('user-info').hidden = !user;
        $('user-display-name').textContent = user ? (user.displayName || '已登入') : '';
        const avatar = $('user-avatar');
        if (user && user.photoURL) avatar.src = user.photoURL; else avatar.removeAttribute('src');
        avatar.hidden = !(user && user.photoURL);
    }

    // 登入狀態改變時呼叫 onUser(user)；Firebase 沒有載入時回傳 false
    async function initAuth(onUser) {
        const loginBtn = document.getElementById('google-login-btn');
        if (!(await waitForFirebase())) {
            loginBtn.disabled = true;
            return false;
        }
        const { onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } = fns();
        onAuthStateChanged(root.firebaseAuth, (user) => {
            renderAuthUI(user);
            onUser(user);
        });
        loginBtn.addEventListener('click', async () => {
            try {
                await signInWithPopup(root.firebaseAuth, new GoogleAuthProvider());
            } catch (e) {
                if (e && e.code === 'auth/popup-closed-by-user') return;
                console.error('[AUTH] 登入失敗', e);
                setStatus('offline', `登入失敗 (${(e && e.code) || '未知錯誤'})`);
            }
        });
        document.getElementById('logout-btn').addEventListener('click', async () => {
            if (!confirm('登出後，同網域的其他工具 (抽卡統計、果實分配) 也會一起登出。確定要登出嗎？')) return;
            try {
                await signOut(root.firebaseAuth);
            } catch (e) {
                console.error('[AUTH] 登出失敗', e);
            }
        });
        return true;
    }

    // =====================================================
    // 懸浮工具箱：讀取工具箱的 tools.js (window.MS_TOOLS) 後重建連結；
    // 讀不到時維持 HTML 裡的連結。清單裡還沒有這個工具時補在最後。
    // =====================================================
    function renderToolboxMenu() {
        const list = document.querySelector('.toolbox-items-list');
        const tools = Array.isArray(root.MS_TOOLS) ? root.MS_TOOLS : [];
        const valid = tools.filter((t) => t && typeof t.name === 'string' && t.name
            && typeof t.url === 'string' && /^https:\/\//.test(t.url));
        if (!list || valid.length === 0) return;
        if (!valid.some((t) => t.id === THIS_TOOL.id)) valid.push(THIS_TOOL);

        const home = list.querySelector('.toolbox-home');
        const links = valid.map((t) => {
            const active = t.id === THIS_TOOL.id;
            const a = el('a', 'toolbox-item' + (active ? ' active' : ''),
                (typeof t.emoji === 'string' ? t.emoji + ' ' : '') + t.name + (active ? ' (現行)' : ''));
            a.href = t.url;
            return a;
        });
        list.replaceChildren(...(home ? [home] : []), ...links);
    }

    function loadToolboxMenu() {
        const script = document.createElement('script');
        script.src = TOOLBOX_TOOLS_URL;
        script.async = true;
        script.onload = renderToolboxMenu;
        script.onerror = () => console.warn('[TOOLBOX] 讀不到工具箱的 tools.js，使用內建連結');
        document.head.appendChild(script);
    }

    root.Shared = {
        GACHA_LOCAL_KEY, THIS_TOOL,
        el, storage, waitForFirebase,
        loadEvents, readLocalRecords, readCloudRecords, loadPools, loadElementClasses, loadNameFixes, saveNameFix, checkAdmin,
        setStatus, initAuth, loadToolboxMenu
    };
})(this);
