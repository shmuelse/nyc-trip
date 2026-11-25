/* חיבור ל־Firebase: התחברות עם גוגל + Firestore משותף לכל המשפחה.
 * מבנה הנתונים:
 *   meta/access                       { emails: [...] }  — מי מורשה (רק הבעלים כותב)
 *   trips/main                        { trip, updatedAt, by }
 *   trips/main/state/{checks|priv|expSettings}
 *   trips/main/expenses/{id}
 *   trips/main/docs/{id}              פרטי מסמך
 *   trips/main/docs/{id}/chunks/{i}   תוכן המסמך בחלקים (base64)
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut as fbSignOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, collection, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const app = initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(app);
let db;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch {
  db = initializeFirestore(app, { localCache: memoryLocalCache() });
}

const TRIP = 'main';
const tripRef = () => doc(db, 'trips', TRIP);
const sub = (...p) => doc(db, 'trips', TRIP, ...p);
const col = (...p) => collection(db, 'trips', TRIP, ...p);
const CHUNK = 700000; // bytes per chunk (base64 stays under the 1 MiB document limit)
const who = () => auth.currentUser?.email || '';

function b64(buf) {
  let s = ''; const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s); const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

const unsubs = [];
let ownerFlag = false;
const Cloud = {
  get user() { return auth.currentUser; },
  isOwner() { return ownerFlag; },

  onAuth(cb) {
    return onAuthStateChanged(auth, async (user) => {
      ownerFlag = false;
      if (user && user.email && crypto.subtle) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(user.email.toLowerCase()));
        const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
        ownerFlag = hex === window.TRIP_OWNER_HASH;
      }
      cb(user);
    });
  },
  async signIn() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try { await signInWithPopup(auth, provider); }
    catch (e) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) await signInWithRedirect(auth, provider);
      else throw e;
    }
  },
  async signOut() { unsubs.splice(0).forEach((u) => u()); await fbSignOut(auth); },

  /** one-time check: can this user read the trip? returns 'ok' | 'empty' | 'denied' */
  async probe() {
    try { const s = await getDoc(tripRef()); return s.exists() ? 'ok' : 'empty'; }
    catch (e) { return e.code === 'permission-denied' ? 'denied' : 'error:' + (e.code || e.message); }
  },

  /** live listeners. h = { trip, checks, priv, expSettings, expenses, docs, error } */
  subscribe(h) {
    unsubs.splice(0).forEach((u) => u());
    const err = (e) => h.error && h.error(e);
    unsubs.push(onSnapshot(tripRef(), (s) => h.trip && h.trip(s.exists() ? s.data().trip : null, s.metadata.hasPendingWrites), err));
    ['checks', 'priv', 'expSettings'].forEach((k) => unsubs.push(onSnapshot(sub('state', k), (s) => h[k] && h[k](s.exists() ? s.data().value : null), err)));
    unsubs.push(onSnapshot(col('expenses'), (qs) => h.expenses && h.expenses(qs.docs.map((d) => d.data())), err));
    unsubs.push(onSnapshot(col('docs'), (qs) => h.docs && h.docs(qs.docs.map((d) => d.data())), err));
  },

  saveTrip(trip) { return setDoc(tripRef(), { trip: JSON.parse(JSON.stringify(trip)), updatedAt: serverTimestamp(), by: who() }); },
  saveState(key, value) { return setDoc(sub('state', key), { value: JSON.parse(JSON.stringify(value)), updatedAt: serverTimestamp(), by: who() }); },
  putExpense(e) { return setDoc(sub('expenses', e.id), { ...JSON.parse(JSON.stringify(e)), by: e.by || who() }); },
  delExpense(id) { return deleteDoc(sub('expenses', id)); },

  async putDoc(meta, arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const n = Math.max(1, Math.ceil(bytes.length / CHUNK));
    for (let i = 0; i < n; i++) {
      await setDoc(sub('docs', meta.id, 'chunks', String(i)), { d: b64(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)) });
    }
    await setDoc(sub('docs', meta.id), { ...meta, chunks: n, by: who(), uploadedAt: serverTimestamp() });
  },
  updateDocMeta(id, patch) { return updateDoc(sub('docs', id), patch); },
  async getDocData(id) {
    const m = await getDoc(sub('docs', id));
    if (!m.exists()) return null;
    const meta = m.data();
    const parts = [];
    for (let i = 0; i < meta.chunks; i++) {
      const c = await getDoc(sub('docs', id, 'chunks', String(i)));
      parts.push(unb64(c.data().d));
    }
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0; parts.forEach((p) => { out.set(p, o); o += p.length; });
    return { ...meta, data: out.buffer };
  },
  async delDoc(id) {
    const cs = await getDocs(collection(db, 'trips', TRIP, 'docs', id, 'chunks'));
    await deleteDoc(sub('docs', id));
    await Promise.all(cs.docs.map((d) => deleteDoc(d.ref)));
  },

  async getAccess() {
    try { const s = await getDoc(doc(db, 'meta', 'access')); return s.exists() ? (s.data().emails || []) : []; }
    catch { return []; }
  },
  setAccess(emails) { return setDoc(doc(db, 'meta', 'access'), { emails, updatedAt: serverTimestamp() }); }
};

getRedirectResult(auth).catch(() => {});
window.Cloud = Cloud;
window.dispatchEvent(new Event('cloud-ready'));
