// =====================================================
// Firebase 初始化 (兩個頁面共用，<script type="module" src="js/firebase.js">)
// 和其他工具同一個專案 ms-toolbox-web。其他程式透過 window.firebaseFns 使用 SDK 的函式。
//
// 寫入：只有「角色」頁的管理員名稱修正 (shared/characters) 會用到 runTransaction。
// 以及行事曆的管理員編輯活動 (shared/events)。抽卡紀錄 (gacha_records) 在網頁上絕對不寫入。
// =====================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAjpfcNC4ZniqIxYzgYwp5Cs_8gbbmflVY",
    authDomain: "ms-toolbox-web.firebaseapp.com",
    projectId: "ms-toolbox-web",
    storageBucket: "ms-toolbox-web.firebasestorage.app",
    messagingSenderId: "777818785736",
    appId: "1:777818785736:web:880b878f4a510132dfe2fd",
    measurementId: "G-7KV0FSL1RG"
};

const app = initializeApp(firebaseConfig);
window.firebaseAuth = getAuth(app);
window.db = getFirestore(app);
window.envAppId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
window.firebaseFns = {
    GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
    doc, getDoc, runTransaction, serverTimestamp
};
