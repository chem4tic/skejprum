import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Lock, Unlock, MapPin, Star, Plus, Search, X, Edit2, Trash2,
  ExternalLink, Users, Trophy, ListChecks, LayoutDashboard,
  Camera, ChevronLeft, Settings, Check, Clock, Skull, Sparkles, Filter,
  ChevronDown, Upload, ArrowUpDown,
} from "lucide-react";
 
/* ---------------------------------------------------------------
   STORAGE
   Uses Claude's built-in window.storage when running as an artifact.
   Outside Claude (e.g. hosted on GitHub Pages) it syncs shared room
   data through Firebase Firestore instead, so the whole crew sees
   the same live data. Your own "who am I" selection always stays in
   this browser's localStorage — that's meant to be per-device.
 
   To enable the shared backend: create a Firebase project, create a
   Firestore database in it, register a web app, and paste the config
   object it gives you below. See the setup steps you were given
   alongside this file.
--------------------------------------------------------------- */
const hasClaudeStorage = typeof window !== "undefined" && window.storage && typeof window.storage.get === "function";
 
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDd0Z3d95XxKHOo6rGeGpMmgtkpvoxscOA",
  authDomain: "escape-log-90c4c.firebaseapp.com",
  projectId: "escape-log-90c4c",
  storageBucket: "escape-log-90c4c.firebasestorage.app",
  messagingSenderId: "250414337783",
  appId: "1:250414337783:web:b0a65bd54af38702528df2",
};
const FIREBASE_DOC_PATH = ["escapeLog", "shared"]; // collection, document id
 
let firebaseHandlePromise = null;
function getFirebaseHandle() {
  if (!firebaseHandlePromise) {
    firebaseHandlePromise = (async () => {
      const { initializeApp } = await import("https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js");
      const { getFirestore, doc, setDoc, onSnapshot } = await import(
        "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js"
      );
      const { getAuth, signInAnonymously } = await import(
        "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js"
      );
      const app = initializeApp(FIREBASE_CONFIG);
      const db = getFirestore(app);
      // The Firestore rules require a signed-in request (see firestore.rules).
      // Anonymous auth gives every visitor an invisible sign-in with no
      // login screen — it scopes access to just this app, not to any
      // particular person.
      await signInAnonymously(getAuth(app));
      const ref = doc(db, ...FIREBASE_DOC_PATH);
      return { setDoc, onSnapshot, ref };
    })();
  }
  return firebaseHandlePromise;
}
 
/* ---------------------------------------------------------------
   GOOGLE DRIVE (photo storage)
   Photos are stored as files in your own Google Drive, in a folder
   you create — never as public links. The app authenticates once
   (you click "Connect Google Drive"), and the resulting refresh
   token is saved in the same shared Firestore document as
   everything else, so any of the four of you can then upload or
   view photos from any device without personally signing in.
 
   Setup (see the accompanying instructions):
   1. In Google Cloud Console (the same project as Firebase works
      fine), enable the "Google Drive API".
   2. Create an OAuth 2.0 Client ID of type "Web application", with
      this site's URL added as an authorized redirect URI.
   3. Create a folder in your Drive for photos and copy its ID from
      the folder's URL.
   4. Paste the three values below.
 
   Scope is drive.file — the app can only see files it creates
   itself, nothing else in your Drive.
--------------------------------------------------------------- */
const GOOGLE_DRIVE_CONFIG = {
  clientId: "250414337783-9f270fq0b53c2oel5qu40m233v2d08bk.apps.googleusercontent.com",
  clientSecret: "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",
  folderId: "1gWPydSc7SF2EUC7Q_XlTSL6uT0QK7t7y",
};
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const PKCE_VERIFIER_KEY = "escape-room-club-drive-pkce-verifier";
 
function isDriveConfigured() {
  return (
    GOOGLE_DRIVE_CONFIG.clientId &&
    !GOOGLE_DRIVE_CONFIG.clientId.startsWith("YOUR_") &&
    GOOGLE_DRIVE_CONFIG.folderId &&
    !GOOGLE_DRIVE_CONFIG.folderId.startsWith("YOUR_")
  );
}
 
function randomPKCEVerifier() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function pkceChallengeFromVerifier(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let str = "";
  new Uint8Array(digest).forEach((b) => { str += String.fromCharCode(b); });
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function currentRedirectUri() {
  return window.location.origin + window.location.pathname;
}
 
// Kicks off the one-time "Connect Google Drive" flow by redirecting to
// Google's consent screen. On return, handleDriveOAuthRedirect() picks up
// the ?code= param and finishes the exchange.
async function startDriveConnect() {
  const verifier = randomPKCEVerifier();
  window.sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  const challenge = await pkceChallengeFromVerifier(verifier);
  const params = new URLSearchParams({
    client_id: GOOGLE_DRIVE_CONFIG.clientId,
    redirect_uri: currentRedirectUri(),
    response_type: "code",
    scope: GOOGLE_DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  window.location.href = `${GOOGLE_AUTH_URL}?${params.toString()}`;
}
 
// Call once on app load. If Google just redirected back with a ?code=,
// exchanges it for tokens and returns the refresh token to persist.
async function handleDriveOAuthRedirect() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) return null;
  const verifier = window.sessionStorage.getItem(PKCE_VERIFIER_KEY);
  window.sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  url.searchParams.delete("code");
  url.searchParams.delete("scope");
  window.history.replaceState({}, "", url.toString());
  if (!verifier) return null;
 
  const body = new URLSearchParams({
    client_id: GOOGLE_DRIVE_CONFIG.clientId,
    client_secret: GOOGLE_DRIVE_CONFIG.clientSecret,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: currentRedirectUri(),
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Google Drive authorization failed");
  const json = await res.json();
  if (!json.refresh_token) {
    throw new Error("Google didn't return a refresh token — try connecting again (Google only issues one on first consent).");
  }
  return json.refresh_token;
}
 
// In-memory access-token cache (never persisted — short-lived by design).
let driveAccessTokenCache = null; // { token, expiresAt }
 
async function getDriveAccessToken(refreshToken) {
  if (!refreshToken) throw new Error("Google Drive isn't connected yet.");
  if (driveAccessTokenCache && driveAccessTokenCache.expiresAt > Date.now() + 30000) {
    return driveAccessTokenCache.token;
  }
  const body = new URLSearchParams({
    client_id: GOOGLE_DRIVE_CONFIG.clientId,
    client_secret: GOOGLE_DRIVE_CONFIG.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Couldn't refresh Google Drive access — it may need reconnecting.");
  const json = await res.json();
  driveAccessTokenCache = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}
 
async function uploadPhotoToDrive(file, accessToken) {
  const metadata = { name: file.name, parents: [GOOGLE_DRIVE_CONFIG.folderId] };
  const boundary = "escapelog" + Math.random().toString(36).slice(2);
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const encoder = new TextEncoder();
  const pre = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`
  );
  const post = encoder.encode(`\r\n--${boundary}--`);
  const body = new Blob([pre, fileBytes, post]);
 
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error("Photo upload to Google Drive failed.");
  return res.json(); // { id, name, mimeType }
}
 
async function deletePhotoFromDrive(fileId, accessToken) {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => {}); // best-effort — a failed remote delete shouldn't block removing it from the room
}
 
const driveBlobCache = new Map(); // fileId -> object URL, so re-opening a room doesn't re-fetch
 
async function fetchDrivePhotoUrl(fileId, accessToken) {
  if (driveBlobCache.has(fileId)) return driveBlobCache.get(fileId);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Couldn't load that photo from Google Drive.");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  driveBlobCache.set(fileId, url);
  return url;
}
 
// Personal, per-device value (e.g. "who am I") — never goes through Firebase.
async function storageGet(key, shared) {
  if (hasClaudeStorage) return window.storage.get(key, shared);
  const raw = window.localStorage.getItem(key);
  if (raw === null) throw new Error("not found");
  return { key, value: raw, shared };
}
async function storageSet(key, value, shared) {
  if (hasClaudeStorage) return window.storage.set(key, value, shared);
  window.localStorage.setItem(key, value);
  return { key, value, shared };
}
 
/* ---------------------------------------------------------------
   PASSWORDS
   Each crew member's password is hashed (SHA-256, salted) with the
   Web Crypto API before it's ever written anywhere — only the salt
   and resulting hash are stored, in the same shared data doc as the
   rooms. The plaintext password never leaves the browser it was
   typed in, and never appears in the app's code.
--------------------------------------------------------------- */
function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hashPassword(password, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
 
/* ---------------------------------------------------------------
   TOKENS
   Palette: a dim, brass-lit "room" rather than a generic dark UI —
   charcoal-blue walls, a brass key accent (the thing everyone's
   hunting for), and a UV-teal accent for "clue" moments.
--------------------------------------------------------------- */
const TOKENS = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
 
  .ert-root {
    --bg: #14161c;
    --surface: #1c1f28;
    --surface-raised: #252a35;
    --border: #343a4a;
    --border-soft: #2a2f3b;
    --text: #ece8dd;
    --text-dim: #8d92a3;
    --brass: #c89b4a;
    --brass-bright: #e3bd72;
    --teal: #48a99e;
    --danger: #c1594c;
    --success: #6a9d74;
    font-family: 'Inter', sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100%;
  }
  .ert-display { font-family: 'Space Grotesk', sans-serif; }
  .ert-mono { font-family: 'IBM Plex Mono', monospace; }
  .ert-root ::selection { background: var(--brass); color: #14161c; }
 
  .ert-card {
    background: var(--surface);
    border: 1px solid var(--border-soft);
    border-radius: 10px;
  }
  .ert-card-raised {
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .ert-input, .ert-select, .ert-textarea {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 7px;
    padding: 8px 11px;
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    width: 100%;
    outline: none;
  }
  .ert-input:focus, .ert-select:focus, .ert-textarea:focus {
    border-color: var(--brass);
  }
  .ert-input::placeholder, .ert-textarea::placeholder { color: var(--text-dim); }
 
  .ert-btn {
    display: inline-flex; align-items: center; gap: 6px;
    border-radius: 7px; padding: 8px 14px; font-size: 13.5px;
    font-weight: 600; cursor: pointer; border: 1px solid transparent;
    transition: filter 0.15s, transform 0.1s;
  }
  .ert-btn:active { transform: scale(0.98); }
  .ert-btn-brass { background: var(--brass); color: #17140c; }
  .ert-btn-brass:hover { filter: brightness(1.1); }
  .ert-btn-ghost { background: transparent; color: var(--text); border-color: var(--border); }
  .ert-btn-ghost:hover { border-color: var(--brass); color: var(--brass-bright); }
  .ert-btn-danger { background: transparent; color: var(--danger); border-color: var(--danger); }
  .ert-btn-danger:hover { background: var(--danger); color: #fff; }
 
  .ert-tab {
    display: flex; align-items: center; gap: 7px;
    padding: 9px 13px; border-radius: 7px; font-size: 13.5px; font-weight: 600;
    color: var(--text-dim); cursor: pointer; white-space: nowrap;
  }
  .ert-tab:hover { color: var(--text); }
  .ert-tab-active { color: #17140c; background: var(--brass); }
  .ert-tab-active:hover { color: #17140c; }
 
  .ert-plaque-num {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px; letter-spacing: 0.08em; color: var(--brass);
  }
 
  .ert-scrollbar::-webkit-scrollbar { height: 6px; width: 6px; }
  .ert-scrollbar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
 
  .ert-star-btn { cursor: pointer; transition: transform 0.1s; }
  .ert-star-btn:hover { transform: scale(1.15); }
 
  @keyframes ert-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  .ert-fade-in { animation: ert-fade-in 0.2s ease-out; }
`;
 
/* ---------------------------------------------------------------
   HELPERS
--------------------------------------------------------------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const STORAGE_KEY = "escape-room-club-data-v1";
const MEMBER_KEY = "escape-room-club-current-member";
const MEMBERS = ["Karol", "Asia", "Jano", "Jaćka"];
 
const CATEGORIES = ["Horror", "Adventure", "Mystery/Detective", "Sci-Fi", "Historical", "Fantasy", "Comedy", "Other"];
const DIFFICULTY_LEVELS = ["Beginner-friendly", "Easy", "Medium", "Hard", "Very hard", "Extreme"];
 
function emptyRoom(addedBy) {
  return {
    id: uid(),
    name: "",
    venue: "",
    city: "",
    country: "Poland",
    category: "Adventure",
    difficulty: "Medium",
    lockmeUrl: "",
    status: "wishlist", // 'wishlist' | 'played'
    datePlayed: "",
    result: "escaped", // 'escaped' | 'not-escaped'
    timeNote: "",
    photos: [],
    ratings: {},
    notes: {},
    walkthrough: "",
    addedBy: addedBy || null,
    createdAt: Date.now(),
  };
}
 
/* ---------------------------------------------------------------
   CSV IMPORT
   Batch-add rooms from a CSV file -- the same column layout this app
   exports (see "lockme-top-80-poland.csv"): name, venue, city,
   country, category, difficulty, lockmeUrl, status, datePlayed,
   result, timeNote. Only "name" is required; everything else falls
   back to sensible defaults. Ratings, notes, photos and walkthrough
   aren't part of the format -- those are added per-room afterward.
--------------------------------------------------------------- */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
 
function roomsFromCSV(text, addedBy) {
  const rows = parseCSV(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const get = (row, name) => {
    const i = idx(name);
    return i === -1 ? "" : (row[i] || "").trim();
  };
 
  return rows
    .slice(1)
    .map((row) => {
      const name = get(row, "name");
      if (!name) return null;
      const room = emptyRoom(addedBy);
      room.name = name;
      room.venue = get(row, "venue");
      room.city = get(row, "city");
      room.country = get(row, "country") || "Poland";
      const category = get(row, "category");
      room.category = CATEGORIES.includes(category) ? category : "Other";
      const difficulty = get(row, "difficulty");
      room.difficulty = DIFFICULTY_LEVELS.includes(difficulty) ? difficulty : "Medium";
      room.lockmeUrl = get(row, "lockmeurl") || get(row, "lockme link") || get(row, "lock.me link");
      room.status = get(row, "status").toLowerCase() === "played" ? "played" : "wishlist";
      room.datePlayed = get(row, "dateplayed") || get(row, "date played");
      const result = get(row, "result").toLowerCase();
      room.result = result === "not-escaped" || result === "not escaped" ? "not-escaped" : "escaped";
      room.timeNote = get(row, "timenote") || get(row, "time note");
      return room;
    })
    .filter(Boolean);
}
 
function avgRating(room) {
  const vals = Object.values(room.ratings || {}).filter((v) => typeof v === "number");
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
 
function fmtRating(n) {
  return n === null || n === undefined ? "—" : n.toFixed(1);
}
 
/* ---------------------------------------------------------------
   MAIN APP
--------------------------------------------------------------- */
export default function EscapeRoomTracker() {
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(null);
  const [importMessage, setImportMessage] = useState(null);
  const [data, setData] = useState({ rooms: [], auth: {}, driveAuth: null });
  const [currentMember, setCurrentMember] = useState(null);
  const [view, setView] = useState("dashboard");
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [returnView, setReturnView] = useState("rooms");
  const [editingRoom, setEditingRoom] = useState(null); // room object being added/edited, or null
 
  // ---- load ----
  useEffect(() => {
    let unsubscribeFirestore = null;
 
    // Shared room/rating data: Claude storage inside Claude, live
    // Firestore sync everywhere else.
    if (hasClaudeStorage) {
      (async () => {
        try {
          let loaded = { rooms: [], auth: {}, driveAuth: null };
          try {
            const res = await storageGet(STORAGE_KEY, true);
            if (res && res.value) loaded = JSON.parse(res.value);
          } catch (e) {
            // key doesn't exist yet — fine, use default
          }
          setData(loaded);
        } catch (e) {
          setSaveError("Couldn't load your group's data. Try reloading.");
        } finally {
          setLoading(false);
        }
      })();
    } else {
      (async () => {
        try {
          const { onSnapshot, ref } = await getFirebaseHandle();
          unsubscribeFirestore = onSnapshot(
            ref,
            (snap) => {
              setData(snap.exists() ? snap.data() : { rooms: [], auth: {}, driveAuth: null });
              setLoading(false);
              setSaveError(null);
            },
            () => {
              setSaveError("Couldn't reach the shared backend. Check the Firebase setup in the code and your Firestore rules.");
              setLoading(false);
            }
          );
        } catch (e) {
          setSaveError("Couldn't connect to the shared backend. Check the Firebase setup in the code.");
          setLoading(false);
        }
      })();
    }
 
    // Personal, per-device value — always local, regardless of backend.
    (async () => {
      try {
        const memberRes = await storageGet(MEMBER_KEY, false);
        if (memberRes && memberRes.value) setCurrentMember(memberRes.value);
      } catch (e) {
        // no member selected yet on this device
      }
    })();
 
    return () => {
      if (unsubscribeFirestore) unsubscribeFirestore();
    };
  }, []);
 
  const persist = useCallback(async (next) => {
    setData(next);
    try {
      if (hasClaudeStorage) {
        const res = await storageSet(STORAGE_KEY, JSON.stringify(next), true);
        if (!res) setSaveError("Save failed — your last change may not be stored.");
        else setSaveError(null);
      } else {
        const { setDoc, ref } = await getFirebaseHandle();
        await setDoc(ref, next);
        setSaveError(null);
      }
    } catch (e) {
      setSaveError("Save failed — your last change may not be stored.");
    }
  }, []);
 
  const chooseMember = async (name) => {
    setCurrentMember(name);
    try {
      await storageSet(MEMBER_KEY, name, false);
    } catch (e) {
      /* non-fatal */
    }
  };
 
  const createPassword = async (name, password) => {
    const salt = randomSalt();
    const hash = await hashPassword(password, salt);
    await persist({ ...data, auth: { ...(data.auth || {}), [name]: { salt, hash } } });
  };
 
  const verifyPassword = async (name, password) => {
    const record = data.auth && data.auth[name];
    if (!record) return false;
    const hash = await hashPassword(password, record.salt);
    return hash === record.hash;
  };
 
  const changePassword = async (name, currentPassword, newPassword) => {
    const record = data.auth && data.auth[name];
    if (!record) return false;
    const currentHash = await hashPassword(currentPassword, record.salt);
    if (currentHash !== record.hash) return false;
    const salt = randomSalt();
    const hash = await hashPassword(newPassword, salt);
    await persist({ ...data, auth: { ...(data.auth || {}), [name]: { salt, hash } } });
    return true;
  };
 
  const [driveMessage, setDriveMessage] = useState(null);
 
  // Pick up an in-progress "Connect Google Drive" flow returning from Google.
  // Waits for the real shared data to finish loading first, so this can't
  // clobber it with the empty initial state.
  const driveRedirectHandled = React.useRef(false);
  useEffect(() => {
    if (loading || driveRedirectHandled.current) return;
    if (hasClaudeStorage || !isDriveConfigured()) return;
    if (!window.location.search.includes("code=")) return;
    driveRedirectHandled.current = true;
    (async () => {
      try {
        const refreshToken = await handleDriveOAuthRedirect();
        if (refreshToken) {
          await persist({ ...data, driveAuth: { refreshToken } });
          setDriveMessage({ type: "success", text: "Google Drive connected — photos will now upload there." });
        }
      } catch (e) {
        setDriveMessage({ type: "error", text: e.message || "Couldn't connect Google Drive." });
      }
      setTimeout(() => setDriveMessage(null), 6000);
    })();
  }, [loading, data]);
 
  const connectGoogleDrive = () => {
    startDriveConnect().catch((e) => setDriveMessage({ type: "error", text: e.message || "Couldn't start the connection." }));
  };
 
  const getRoomsAccessToken = () => getDriveAccessToken(data.driveAuth && data.driveAuth.refreshToken);
 
  const saveRoom = (room) => {
    const exists = data.rooms.some((r) => r.id === room.id);
    const rooms = exists ? data.rooms.map((r) => (r.id === room.id ? room : r)) : [room, ...data.rooms];
    persist({ ...data, rooms });
    setEditingRoom(null);
    setView("room-detail");
    setSelectedRoomId(room.id);
  };
  const deleteRoom = (id) => {
    persist({ ...data, rooms: data.rooms.filter((r) => r.id !== id) });
    setView("rooms");
    setSelectedRoomId(null);
  };
  const updateRoomField = (id, patch) => {
    const rooms = data.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r));
    persist({ ...data, rooms });
  };
 
  const importRoomsFromFile = async (file) => {
    try {
      const text = await file.text();
      const parsed = roomsFromCSV(text, currentMember);
      if (!parsed.length) {
        setImportMessage({ type: "error", text: "No rooms found in that file — make sure it has a 'name' column." });
        setTimeout(() => setImportMessage(null), 6000);
        return;
      }
      const key = (r) => `${r.name.trim().toLowerCase()}|${(r.city || "").trim().toLowerCase()}`;
      const existingKeys = new Set(data.rooms.map(key));
      const toAdd = parsed.filter((r) => !existingKeys.has(key(r)));
      if (toAdd.length) await persist({ ...data, rooms: [...data.rooms, ...toAdd] });
      const skipped = parsed.length - toAdd.length;
      setImportMessage({
        type: "success",
        text: `Imported ${toAdd.length} room${toAdd.length === 1 ? "" : "s"}${skipped ? `, skipped ${skipped} already on the list` : ""}.`,
      });
    } catch (e) {
      setImportMessage({ type: "error", text: "Couldn't read that file — make sure it's a CSV in the format this app exports." });
    }
    setTimeout(() => setImportMessage(null), 6000);
  };
 
  const selectedRoom = useMemo(
    () => data.rooms.find((r) => r.id === selectedRoomId) || null,
    [data.rooms, selectedRoomId]
  );
 
  const playedRooms = useMemo(() => data.rooms.filter((r) => r.status === "played"), [data.rooms]);
  const wishlistRooms = useMemo(() => data.rooms.filter((r) => r.status === "wishlist"), [data.rooms]);
 
  if (loading) {
    return (
      <div className="ert-root" style={{ minHeight: 480, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{TOKENS}</style>
        <div className="ert-mono" style={{ color: "var(--text-dim)", fontSize: 13 }}>opening the door…</div>
      </div>
    );
  }
 
  // ---- device hasn't picked "who am I" ----
  if (!currentMember || !MEMBERS.includes(currentMember)) {
    return (
      <WhoAmI
        members={MEMBERS}
        authRecords={data.auth}
        onChoose={chooseMember}
        onCreatePassword={createPassword}
        onVerifyPassword={verifyPassword}
      />
    );
  }
 
  return (
    <div className="ert-root" style={{ minHeight: 600, borderRadius: 14, overflow: "hidden" }}>
      <style>{TOKENS}</style>
 
      <Header
        currentMember={currentMember}
        onSwitchMember={() => chooseMember(null)}
        onAdd={() => { setEditingRoom(emptyRoom(currentMember)); setView("edit-room"); }}
        onImportFile={importRoomsFromFile}
      />
 
      {saveError && (
        <div style={{ background: "var(--danger)", color: "#fff", fontSize: 12.5, padding: "6px 20px" }}>
          {saveError}
        </div>
      )}
 
      {importMessage && (
        <div style={{ background: importMessage.type === "error" ? "var(--danger)" : "var(--success)", color: "#fff", fontSize: 12.5, padding: "6px 20px" }}>
          {importMessage.text}
        </div>
      )}
 
      {driveMessage && (
        <div style={{ background: driveMessage.type === "error" ? "var(--danger)" : "var(--success)", color: "#fff", fontSize: 12.5, padding: "6px 20px" }}>
          {driveMessage.text}
        </div>
      )}
 
      <Nav view={view} setView={(v) => { setView(v); setSelectedRoomId(null); setEditingRoom(null); }} />
 
      <div style={{ padding: "20px 24px 32px" }} className="ert-fade-in">
        {view === "dashboard" && (
          <Dashboard rooms={data.rooms} members={MEMBERS} onOpenRoom={(id) => { setSelectedRoomId(id); setReturnView("dashboard"); setView("room-detail"); }} />
        )}
 
        {view === "rooms" && (
          <RoomsView
            rooms={playedRooms}
            onOpen={(id) => { setSelectedRoomId(id); setReturnView("rooms"); setView("room-detail"); }}
          />
        )}
 
        {view === "wishlist" && (
          <RoomsView
            rooms={wishlistRooms}
            emptyLabel="No rooms on the wishlist yet. Add one and mark it 'wishlist'."
            onOpen={(id) => { setSelectedRoomId(id); setReturnView("wishlist"); setView("room-detail"); }}
          />
        )}
 
        {view === "ranking" && <RankingView rooms={playedRooms} members={MEMBERS} onOpen={(id) => { setSelectedRoomId(id); setReturnView("ranking"); setView("room-detail"); }} />}
 
        {view === "settings" && (
          <SettingsView members={MEMBERS} currentMember={currentMember} onChangePassword={changePassword} rooms={data.rooms} />
        )}
 
        {view === "edit-room" && editingRoom && (
          <RoomForm
            room={editingRoom}
            onCancel={() => { setEditingRoom(null); setView(selectedRoom ? "room-detail" : returnView); }}
            onSave={saveRoom}
          />
        )}
 
        {view === "room-detail" && selectedRoom && (
          <RoomDetail
            room={selectedRoom}
            members={MEMBERS}
            currentMember={currentMember}
            onBack={() => { setView(returnView); setSelectedRoomId(null); }}
            onEdit={() => { setEditingRoom(selectedRoom); setView("edit-room"); }}
            onDelete={() => deleteRoom(selectedRoom.id)}
            onUpdate={(patch) => updateRoomField(selectedRoom.id, patch)}
            driveConnected={!hasClaudeStorage && !!(data.driveAuth && data.driveAuth.refreshToken)}
            driveAvailable={!hasClaudeStorage && isDriveConfigured()}
            onConnectDrive={connectGoogleDrive}
            getDriveAccessToken={getRoomsAccessToken}
          />
        )}
      </div>
    </div>
  );
}
 
/* ---------------------------------------------------------------
   WHO AM I
--------------------------------------------------------------- */
function WhoAmI({ members, authRecords, onChoose, onCreatePassword, onVerifyPassword }) {
  const [selected, setSelected] = useState(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
 
  const hasPassword = (name) => !!(authRecords && authRecords[name]);
 
  const selectMember = (name) => {
    setSelected(name);
    setPassword("");
    setConfirmPassword("");
    setError("");
  };
  const cancel = () => {
    setSelected(null);
    setPassword("");
    setConfirmPassword("");
    setError("");
  };
 
  const submitCreate = async () => {
    if (password.length < 4) { setError("Use at least 4 characters."); return; }
    if (password !== confirmPassword) { setError("Passwords don't match."); return; }
    setBusy(true);
    setError("");
    try {
      await onCreatePassword(selected, password);
      onChoose(selected);
    } catch (e) {
      setError("Couldn't set the password — try again.");
    } finally {
      setBusy(false);
    }
  };
 
  const submitVerify = async () => {
    setBusy(true);
    setError("");
    try {
      const ok = await onVerifyPassword(selected, password);
      if (ok) onChoose(selected);
      else setError("Wrong password.");
    } catch (e) {
      setError("Couldn't check the password — try again.");
    } finally {
      setBusy(false);
    }
  };
 
  if (selected) {
    const isNew = !hasPassword(selected);
    return (
      <div className="ert-root" style={{ minHeight: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <style>{TOKENS}</style>
        <div className="ert-card" style={{ padding: 28, maxWidth: 380, width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <Lock size={20} color="var(--brass)" />
            <div className="ert-display" style={{ fontSize: 20, fontWeight: 700 }}>
              {isNew ? `Set a password, ${selected}` : `Welcome back, ${selected}`}
            </div>
          </div>
          <p style={{ fontSize: 13.5, color: "var(--text-dim)", marginTop: 4, marginBottom: 18 }}>
            {isNew
              ? "First time logging in as you — pick a password you'll use each time."
              : "Enter your password to continue."}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <input
              type="password"
              className="ert-input"
              placeholder="Password"
              value={password}
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !isNew) submitVerify(); }}
            />
            {isNew && (
              <input
                type="password"
                className="ert-input"
                placeholder="Repeat password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitCreate(); }}
              />
            )}
          </div>
          {error && <div style={{ color: "var(--danger)", fontSize: 12.5, marginTop: 8 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              className="ert-btn ert-btn-brass"
              disabled={busy}
              style={{ flex: 1, justifyContent: "center", opacity: busy ? 0.6 : 1 }}
              onClick={isNew ? submitCreate : submitVerify}
            >
              <Check size={15} /> {isNew ? "Set password" : "Unlock"}
            </button>
            <button className="ert-btn ert-btn-ghost" onClick={cancel}>Back</button>
          </div>
        </div>
      </div>
    );
  }
 
  return (
    <div className="ert-root" style={{ minHeight: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{TOKENS}</style>
      <div className="ert-card" style={{ padding: 28, maxWidth: 380, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <Users size={20} color="var(--brass)" />
          <div className="ert-display" style={{ fontSize: 20, fontWeight: 700 }}>Who's playing?</div>
        </div>
        <p style={{ fontSize: 13.5, color: "var(--text-dim)", marginTop: 4, marginBottom: 18 }}>
          Pick your name — first time, you'll set a password; after that, you'll enter it each time.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {members.map((m) => (
            <button
              key={m}
              className="ert-btn ert-btn-ghost"
              style={{ justifyContent: "flex-start" }}
              onClick={() => selectMember(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
 
/* ---------------------------------------------------------------
   HEADER / NAV
--------------------------------------------------------------- */
function Header({ currentMember, onSwitchMember, onAdd, onImportFile }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
 
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);
 
  const triggerFilePicker = () => {
    setMenuOpen(false);
    fileInputRef.current?.click();
  };
  const handleFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) onImportFile(file);
    e.target.value = "";
  };
 
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px 10px", borderBottom: "1px solid var(--border-soft)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: "var(--surface-raised)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Lock size={17} color="var(--brass)" />
        </div>
        <div>
          <div className="ert-display" style={{ fontSize: 17, fontWeight: 700, letterSpacing: "0.01em" }}>The Escape Log</div>
          <div className="ert-mono" style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: -2 }}>playing as {currentMember}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="ert-btn ert-btn-ghost" onClick={onSwitchMember} style={{ padding: "8px 10px" }}>
          <Users size={14} />
        </button>
 
        <div style={{ display: "flex", position: "relative" }} ref={menuRef}>
          <button
            className="ert-btn ert-btn-brass"
            onClick={onAdd}
            style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
          >
            <Plus size={15} /> Add room
          </button>
          <button
            className="ert-btn ert-btn-brass"
            onClick={() => setMenuOpen((v) => !v)}
            title="More ways to add rooms"
            style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: "1px solid rgba(0,0,0,0.18)", padding: "8px 9px" }}
          >
            <ChevronDown size={14} />
          </button>
 
          {menuOpen && (
            <div
              className="ert-card-raised"
              style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: 210, zIndex: 20, padding: 6, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
            >
              <button
                className="ert-btn ert-btn-ghost"
                style={{ width: "100%", justifyContent: "flex-start", border: "none" }}
                onClick={triggerFilePicker}
              >
                <Upload size={14} /> Upload from file (CSV)
              </button>
            </div>
          )}
        </div>
 
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={handleFileChange} />
      </div>
    </div>
  );
}
 
function Nav({ view, setView }) {
  const tabs = [
    { id: "dashboard", label: "Overview", icon: LayoutDashboard },
    { id: "ranking", label: "Ranking", icon: Trophy },
    { id: "rooms", label: "Completed", icon: ListChecks },
    { id: "wishlist", label: "Wishlist", icon: Sparkles },
    { id: "settings", label: "Crew", icon: Settings },
  ];
  return (
    <div className="ert-scrollbar" style={{ display: "flex", gap: 6, padding: "12px 24px", overflowX: "auto", borderBottom: "1px solid var(--border-soft)" }}>
      {tabs.map((t) => (
        <div key={t.id} className={`ert-tab ${view === t.id || (view === "room-detail" && false) ? (view === t.id ? "ert-tab-active" : "") : ""}`} onClick={() => setView(t.id)}>
          <t.icon size={14} /> {t.label}
        </div>
      ))}
    </div>
  );
}
 
/* ---------------------------------------------------------------
   DASHBOARD
--------------------------------------------------------------- */
function StatBlock({ label, value, sub }) {
  return (
    <div className="ert-card" style={{ padding: "14px 16px", flex: "1 1 140px", minWidth: 140 }}>
      <div className="ert-mono" style={{ fontSize: 10.5, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div className="ert-display" style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
 
function Dashboard({ rooms, members, onOpenRoom }) {
  const played = rooms.filter((r) => r.status === "played");
  const wishlist = rooms.filter((r) => r.status === "wishlist");
  const escaped = played.filter((r) => r.result === "escaped").length;
  const escapeRate = played.length ? Math.round((escaped / played.length) * 100) : null;
  const overallAvg = useMemo(() => {
    const vals = played.map(avgRating).filter((v) => v !== null);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [played]);
 
  const byCity = useMemo(() => {
    const map = {};
    played.forEach((r) => { if (r.city) map[r.city] = (map[r.city] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [played]);
 
  const byCategory = useMemo(() => {
    const map = {};
    played.forEach((r) => { map[r.category] = (map[r.category] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [played]);
 
  const recent = [...played].sort((a, b) => (b.datePlayed || "").localeCompare(a.datePlayed || "")).slice(0, 5);
  const topRated = [...played]
    .map((r) => ({ ...r, _avg: avgRating(r) }))
    .filter((r) => r._avg !== null)
    .sort((a, b) => b._avg - a._avg)
    .slice(0, 5);
 
  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 22 }}>
        <StatBlock label="Rooms played" value={played.length} />
        <StatBlock label="Escape rate" value={escapeRate === null ? "—" : `${escapeRate}%`} sub={played.length ? `${escaped}/${played.length} escaped` : null} />
        <StatBlock label="Group avg rating" value={fmtRating(overallAvg)} sub="out of 10" />
        <StatBlock label="Wishlist" value={wishlist.length} />
        <StatBlock label="Crew" value={members.length} />
      </div>
 
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="ert-card" style={{ padding: 18 }}>
            <div className="ert-display" style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Top rooms</div>
            {topRated.length === 0 && <EmptyNote text="No ratings yet — rate a room to build your ranking." />}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {topRated.map((r, i) => (
                <div key={r.id} onClick={() => onOpenRoom(r.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 11px", background: "var(--surface-raised)", borderRadius: 7, cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="ert-display" style={{ fontSize: 14, fontWeight: 700, color: i === 0 ? "var(--brass-bright)" : "var(--text-dim)", width: 16 }}>{i + 1}</span>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.name}</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{r.venue}{r.city ? ` · ${r.city}` : ""}</div>
                    </div>
                  </div>
                  <div className="ert-mono" style={{ fontSize: 13, color: "var(--brass)" }}>{fmtRating(r._avg)}</div>
                </div>
              ))}
            </div>
          </div>
 
          <div className="ert-card" style={{ padding: 18 }}>
            <div className="ert-display" style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Recently played</div>
            {recent.length === 0 && <EmptyNote text="Nothing logged yet — add your first room." />}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recent.map((r) => (
                <div key={r.id} onClick={() => onOpenRoom(r.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 11px", background: "var(--surface-raised)", borderRadius: 7, cursor: "pointer" }}>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{r.venue}{r.city ? ` · ${r.city}` : ""}</div>
                  </div>
                  <div className="ert-mono" style={{ fontSize: 13, color: "var(--brass)" }}>{fmtRating(avgRating(r))}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
 
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="ert-card" style={{ padding: 18 }}>
            <div className="ert-display" style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Top cities</div>
            {byCity.length === 0 && <EmptyNote text="No played rooms yet." />}
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {byCity.map(([city, count]) => (
                <BarRow key={city} label={city} count={count} max={byCity[0][1]} />
              ))}
            </div>
          </div>
          <div className="ert-card" style={{ padding: 18 }}>
            <div className="ert-display" style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>By genre</div>
            {byCategory.length === 0 && <EmptyNote text="No played rooms yet." />}
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {byCategory.map(([cat, count]) => (
                <BarRow key={cat} label={cat} count={count} max={byCategory[0][1]} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
 
function BarRow({ label, count, max }) {
  const pct = Math.max(8, Math.round((count / max) * 100));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
        <span>{label}</span>
        <span className="ert-mono" style={{ color: "var(--text-dim)" }}>{count}</span>
      </div>
      <div style={{ height: 5, background: "var(--surface-raised)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--teal)" }} />
      </div>
    </div>
  );
}
 
function EmptyNote({ text }) {
  return <div style={{ fontSize: 12.5, color: "var(--text-dim)", fontStyle: "italic" }}>{text}</div>;
}
 
/* ---------------------------------------------------------------
   STAR ROW
   A 1-10 rating control that supports half-point precision -- click
   the left half of a star for a .5, the right half for a whole
   number. Read-only (no onChange) when used just for display.
--------------------------------------------------------------- */
function StarRow({ value, onChange, size }) {
  const starSize = size || 17;
  const handleClick = (e, starIndex) => {
    if (!onChange) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const isHalf = clickX < rect.width / 2;
    onChange(starIndex + (isHalf ? 0.5 : 1));
  };
 
  return (
    <>
      {Array.from({ length: 10 }).map((_, idx) => {
        const full = value >= idx + 1;
        const half = !full && value >= idx + 0.5;
        const Icon = half ? StarHalf : Star;
        const lit = full || half;
        return (
          <span
            key={idx}
            className={onChange ? "ert-star-btn" : undefined}
            onClick={onChange ? (e) => handleClick(e, idx) : undefined}
            style={{ display: "inline-flex", lineHeight: 0, cursor: onChange ? "pointer" : "default" }}
          >
            <Icon size={starSize} fill={lit ? "var(--brass)" : "none"} color={lit ? "var(--brass)" : "var(--border)"} />
          </span>
        );
      })}
    </>
  );
}
 
/* ---------------------------------------------------------------
   ROOMS LIST (played or wishlist)
--------------------------------------------------------------- */
function FilterPopover({ cities, cats, countries, selectedCities, selectedGenres, selectedCountries, onToggleCity, onToggleGenre, onToggleCountry, onClear }) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState(null);
  const ref = React.useRef(null);
  const btnRef = React.useRef(null);
 
  // Positioned in real screen pixels measured from the button itself at the
  // moment it opens (and kept in sync on resize/scroll) rather than guessed
  // from CSS percentages of the viewport -- that keeps it correct regardless
  // of window size, browser zoom, or display scaling.
  const recomputePosition = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const panelWidth = Math.min(260, window.innerWidth - 24);
    let left = rect.right - panelWidth;
    left = Math.max(12, Math.min(left, window.innerWidth - panelWidth - 12));
    const top = rect.bottom + 6;
    setPanelStyle({ position: "fixed", top, left, width: panelWidth, maxHeight: Math.min(360, window.innerHeight - top - 12) });
  }, []);
 
  useEffect(() => {
    if (!open) return;
    recomputePosition();
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const handleReposition = () => recomputePosition();
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [open, recomputePosition]);
 
  const activeCount = selectedCities.length + selectedGenres.length + selectedCountries.length;
 
  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        ref={btnRef}
        type="button"
        className="ert-btn ert-btn-ghost"
        onClick={() => setOpen((o) => !o)}
        style={{ borderColor: activeCount ? "var(--brass)" : "var(--border)", color: activeCount ? "var(--brass-bright)" : "var(--text)" }}
      >
        <Filter size={14} />
        Filters
        {activeCount > 0 && (
          <span className="ert-mono" style={{ background: "var(--brass)", color: "#17140c", borderRadius: 9, fontSize: 10.5, padding: "1px 6px", marginLeft: 2 }}>
            {activeCount}
          </span>
        )}
      </button>
 
      {open && panelStyle && (
        <div
          className="ert-card-raised ert-scrollbar"
          style={{ ...panelStyle, overflowY: "auto", zIndex: 20, padding: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span className="ert-mono" style={{ fontSize: 10.5, color: "var(--text-dim)", textTransform: "uppercase" }}>Filters</span>
            {activeCount > 0 && (
              <span onClick={onClear} style={{ fontSize: 11.5, color: "var(--brass)", cursor: "pointer" }}>Clear all</span>
            )}
          </div>
 
          {countries.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div className="ert-mono" style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 5 }}>COUNTRY</div>
              {countries.map((c) => (
                <label key={c} style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 0", fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={selectedCountries.includes(c)} onChange={() => onToggleCountry(c)} />
                  {c}
                </label>
              ))}
            </div>
          )}
 
          {cities.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div className="ert-mono" style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 5 }}>CITY</div>
              {cities.map((c) => (
                <label key={c} style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 0", fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={selectedCities.includes(c)} onChange={() => onToggleCity(c)} />
                  {c}
                </label>
              ))}
            </div>
          )}
 
          {cats.length > 0 && (
            <div>
              <div className="ert-mono" style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 5 }}>GENRE</div>
              {cats.map((c) => (
                <label key={c} style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 0", fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={selectedGenres.includes(c)} onChange={() => onToggleGenre(c)} />
                  {c}
                </label>
              ))}
            </div>
          )}
 
          {cities.length === 0 && cats.length === 0 && countries.length === 0 && <EmptyNote text="Nothing to filter yet." />}
        </div>
      )}
    </div>
  );
}
 
const SORT_OPTIONS = [
  { id: "date-desc", label: "Date added (newest)" },
  { id: "date-asc", label: "Date added (oldest)" },
  { id: "rating-desc", label: "Rating (high to low)" },
  { id: "alpha", label: "Alphabetical (A\u2013Z)" },
];
 
function sortRooms(rooms, sortBy) {
  const arr = [...rooms];
  switch (sortBy) {
    case "date-asc":
      return arr.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    case "rating-desc":
      return arr.sort((a, b) => {
        const av = avgRating(a);
        const bv = avgRating(b);
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return bv - av;
      });
    case "alpha":
      return arr.sort((a, b) => a.name.localeCompare(b.name));
    case "date-desc":
    default:
      return arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
}
 
function SortPopover({ sortBy, onChange }) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState(null);
  const ref = React.useRef(null);
  const btnRef = React.useRef(null);
 
  const recomputePosition = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const panelWidth = Math.min(220, window.innerWidth - 24);
    let left = rect.right - panelWidth;
    left = Math.max(12, Math.min(left, window.innerWidth - panelWidth - 12));
    const top = rect.bottom + 6;
    setPanelStyle({ position: "fixed", top, left, width: panelWidth });
  }, []);
 
  useEffect(() => {
    if (!open) return;
    recomputePosition();
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const handleReposition = () => recomputePosition();
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [open, recomputePosition]);
 
  const current = SORT_OPTIONS.find((o) => o.id === sortBy) || SORT_OPTIONS[0];
 
  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        ref={btnRef}
        type="button"
        className="ert-btn ert-btn-ghost"
        onClick={() => setOpen((o) => !o)}
      >
        <ArrowUpDown size={14} />
        Sort
      </button>
 
      {open && panelStyle && (
        <div
          className="ert-card-raised"
          style={{ ...panelStyle, zIndex: 20, padding: 6, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
        >
          {SORT_OPTIONS.map((opt) => (
            <div
              key={opt.id}
              onClick={() => { onChange(opt.id); setOpen(false); }}
              style={{
                padding: "8px 10px", borderRadius: 6, fontSize: 13, cursor: "pointer",
                color: opt.id === current.id ? "var(--brass-bright)" : "var(--text)",
                background: opt.id === current.id ? "var(--surface-raised)" : "transparent",
                fontWeight: opt.id === current.id ? 600 : 400,
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
 
function RoomsView({ rooms, onOpen, emptyLabel }) {
  const [search, setSearch] = useState("");
  const [selectedCities, setSelectedCities] = useState([]);
  const [selectedGenres, setSelectedGenres] = useState([]);
  const [selectedCountries, setSelectedCountries] = useState([]);
  const [sortBy, setSortBy] = useState("date-desc");
 
  const cities = useMemo(() => Array.from(new Set(rooms.map((r) => r.city).filter(Boolean))).sort(), [rooms]);
  const cats = useMemo(() => Array.from(new Set(rooms.map((r) => r.category).filter(Boolean))).sort(), [rooms]);
  const countries = useMemo(() => Array.from(new Set(rooms.map((r) => r.country).filter(Boolean))).sort(), [rooms]);
 
  const toggleCity = (c) => setSelectedCities((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  const toggleGenre = (c) => setSelectedGenres((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  const toggleCountry = (c) => setSelectedCountries((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  const clearFilters = () => { setSelectedCities([]); setSelectedGenres([]); setSelectedCountries([]); };
 
  const filtered = rooms.filter((r) => {
    if (search && !`${r.name} ${r.venue}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (selectedCountries.length && !selectedCountries.includes(r.country)) return false;
    if (selectedCities.length && !selectedCities.includes(r.city)) return false;
    if (selectedGenres.length && !selectedGenres.includes(r.category)) return false;
    return true;
  });
  const sorted = sortRooms(filtered, sortBy);
 
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 160, maxWidth: 600 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--text-dim)" }} />
          <input className="ert-input" style={{ paddingLeft: 30 }} placeholder="Search rooms or venues…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <FilterPopover
          cities={cities}
          cats={cats}
          countries={countries}
          selectedCities={selectedCities}
          selectedGenres={selectedGenres}
          selectedCountries={selectedCountries}
          onToggleCity={toggleCity}
          onToggleGenre={toggleGenre}
          onToggleCountry={toggleCountry}
          onClear={clearFilters}
        />
        <SortPopover sortBy={sortBy} onChange={setSortBy} />
      </div>
 
      {sorted.length === 0 ? (
        <EmptyNote text={emptyLabel || "No rooms match those filters."} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
          {sorted.map((r, i) => <RoomCard key={r.id} room={r} index={i} onOpen={() => onOpen(r.id)} />)}
        </div>
      )}
    </div>
  );
}
 
function RoomCard({ room, index, onOpen }) {
  const avg = avgRating(room);
  return (
    <div className="ert-card" onClick={onOpen} style={{ padding: 15, cursor: "pointer", position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span className="ert-plaque-num">No. {String(index + 1).padStart(3, "0")}</span>
        {room.status === "played" ? <Unlock size={15} color="var(--success)" /> : <Lock size={15} color="var(--text-dim)" />}
      </div>
      <div className="ert-display" style={{ fontSize: 15.5, fontWeight: 700, marginTop: 8, lineHeight: 1.25 }}>{room.name || "Untitled room"}</div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 3 }}>{room.venue}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--text-dim)", marginTop: 6 }}>
        <MapPin size={11} /> {room.city || "—"}{room.country ? `, ${room.country}` : ""}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "var(--surface-raised)", color: "var(--text-dim)" }}>{room.category}</span>
        {room.status === "played" && (
          <span className="ert-mono" style={{ fontSize: 13, color: "var(--brass)", display: "flex", alignItems: "center", gap: 3 }}>
            <Star size={12} fill="var(--brass)" color="var(--brass)" /> {fmtRating(avg)}
          </span>
        )}
      </div>
    </div>
  );
}
 
/* ---------------------------------------------------------------
   RANKING
--------------------------------------------------------------- */
function RankingView({ rooms, members, onOpen }) {
  const ranked = useMemo(
    () => [...rooms].map((r) => ({ ...r, _avg: avgRating(r) })).sort((a, b) => (b._avg ?? -1) - (a._avg ?? -1)),
    [rooms]
  );
  if (!ranked.length) return <EmptyNote text="No completed rooms yet — the ranking fills in once you log one." />;
 
  return (
    <div className="ert-card" style={{ overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "42px 1.6fr 1fr repeat(auto-fit, minmax(0,0))", padding: "10px 16px", borderBottom: "1px solid var(--border-soft)" }}>
        <span className="ert-mono" style={{ fontSize: 10.5, color: "var(--text-dim)" }}>#</span>
        <span className="ert-mono" style={{ fontSize: 10.5, color: "var(--text-dim)" }}>ROOM</span>
        <span className="ert-mono" style={{ fontSize: 10.5, color: "var(--text-dim)", textAlign: "right" }}>AVG</span>
      </div>
      {ranked.map((r, i) => (
        <div
          key={r.id}
          onClick={() => onOpen(r.id)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px",
            borderBottom: i < ranked.length - 1 ? "1px solid var(--border-soft)" : "none", cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span className="ert-display" style={{ fontSize: 16, fontWeight: 700, color: i === 0 ? "var(--brass-bright)" : "var(--text-dim)", width: 24 }}>{i + 1}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{r.venue}{r.city ? ` · ${r.city}` : ""}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", gap: 4 }}>
              {members.map((m) =>
                typeof r.ratings[m] === "number" ? (
                  <span key={m} title={m} className="ert-mono" style={{ fontSize: 10.5, color: "var(--text-dim)", background: "var(--surface-raised)", padding: "2px 5px", borderRadius: 4 }}>
                    {r.ratings[m]}
                  </span>
                ) : null
              )}
            </div>
            <span className="ert-mono" style={{ fontSize: 15, fontWeight: 600, color: "var(--brass)", minWidth: 34, textAlign: "right" }}>{fmtRating(r._avg)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
 
/* ---------------------------------------------------------------
   ROOM DETAIL
--------------------------------------------------------------- */
function RoomDetail({ room, members, currentMember, onBack, onEdit, onDelete, onUpdate, driveConnected, driveAvailable, onConnectDrive, getDriveAccessToken }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [myRating, setMyRating] = useState(room.ratings[currentMember] || 0);
  const [myNote, setMyNote] = useState(room.notes[currentMember] || "");
  const [noteSaved, setNoteSaved] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState(null);
  const [walkthrough, setWalkthrough] = useState(room.walkthrough || "");
  const [walkthroughSaved, setWalkthroughSaved] = useState(false);
  const [editingWalkthrough, setEditingWalkthrough] = useState(false);
 
  useEffect(() => {
    setMyRating(room.ratings[currentMember] || 0);
    setMyNote(room.notes[currentMember] || "");
    setWalkthrough(room.walkthrough || "");
    setNoteSaved(false);
    setWalkthroughSaved(false);
    setEditingNote(false);
    setEditingWalkthrough(false);
  }, [room.id, currentMember]);
 
  const saveMyRating = (val) => {
    setMyRating(val);
    onUpdate({ ratings: { ...room.ratings, [currentMember]: val } });
  };
  const noteDirty = myNote !== (room.notes[currentMember] || "");
  const saveMyNote = () => {
    onUpdate({ notes: { ...room.notes, [currentMember]: myNote } });
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 1500);
  };
  const walkthroughDirty = walkthrough !== (room.walkthrough || "");
  const saveWalkthrough = () => {
    onUpdate({ walkthrough });
    setWalkthroughSaved(true);
    setTimeout(() => setWalkthroughSaved(false), 1500);
  };
  const handlePhotoSelected = async (file) => {
    if (!file) return;
    setPhotoError(null);
    setUploadingPhoto(true);
    try {
      const token = await getDriveAccessToken();
      const uploaded = await uploadPhotoToDrive(file, token);
      const photo = {
        id: uid(),
        driveFileId: uploaded.id,
        name: uploaded.name,
        mimeType: uploaded.mimeType,
        addedBy: currentMember,
      };
      onUpdate({ photos: [...(room.photos || []), photo] });
    } catch (e) {
      setPhotoError(e.message || "Couldn't upload that photo.");
    } finally {
      setUploadingPhoto(false);
    }
  };
  const removePhoto = async (photo) => {
    onUpdate({ photos: room.photos.filter((p) => p.id !== photo.id) });
    try {
      const token = await getDriveAccessToken();
      await deletePhotoFromDrive(photo.driveFileId, token);
    } catch (e) {
      /* the room's photo list is already updated; a failed remote delete just leaves an orphaned Drive file */
    }
  };
  const markPlayed = () => {
    onUpdate({
      status: "played",
      datePlayed: room.datePlayed || new Date().toISOString().slice(0, 10),
      result: room.result === "not-escaped" ? "not-escaped" : "escaped",
    });
  };
 
  const avg = avgRating(room);
 
  return (
    <div>
      <button className="ert-btn ert-btn-ghost" onClick={onBack} style={{ marginBottom: 14 }}>
        <ChevronLeft size={14} /> Back
      </button>
 
      <div className="ert-card" style={{ padding: 22, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {room.status === "played" ? <Unlock size={16} color="var(--success)" /> : <Lock size={16} color="var(--text-dim)" />}
              <span className="ert-mono" style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase" }}>{room.status === "played" ? "Completed" : "Wishlist"}</span>
            </div>
            <div className="ert-display" style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{room.name}</div>
            <div style={{ fontSize: 13.5, color: "var(--text-dim)", marginTop: 3 }}>{room.venue}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="ert-btn ert-btn-ghost" onClick={onEdit}><Edit2 size={13} /> Edit</button>
            {confirmDelete ? (
              <button className="ert-btn ert-btn-danger" onClick={onDelete}>Confirm delete</button>
            ) : (
              <button className="ert-btn ert-btn-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={13} /></button>
            )}
          </div>
        </div>
 
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 16, fontSize: 12.5, color: "var(--text-dim)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><MapPin size={13} /> {room.city}{room.country ? `, ${room.country}` : ""}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Skull size={13} /> {room.difficulty}</span>
          {room.status === "played" && room.datePlayed && (
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Clock size={13} /> {room.datePlayed}</span>
          )}
          {room.status === "played" && room.result !== "unknown" && (
            <span style={{ color: room.result === "escaped" ? "var(--success)" : "var(--danger)" }}>
              {room.result === "escaped" ? "Escaped" : "Not escaped"}{room.timeNote ? ` · ${room.timeNote}` : ""}
            </span>
          )}
          <span style={{ padding: "2px 8px", borderRadius: 10, background: "var(--surface-raised)" }}>{room.category}</span>
          {room.lockmeUrl && (
            <a href={room.lockmeUrl} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--brass)" }}>
              lock.me <ExternalLink size={12} />
            </a>
          )}
        </div>
 
        {room.status === "wishlist" && (
          <button className="ert-btn ert-btn-brass" style={{ marginTop: 16 }} onClick={markPlayed}>
            <Unlock size={14} /> Mark as played
          </button>
        )}
 
        {room.status === "played" && (
          <div style={{ marginTop: 16, display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="ert-mono" style={{ fontSize: 26, fontWeight: 600, color: "var(--brass)" }}>{fmtRating(avg)}</span>
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>group average out of 10</span>
          </div>
        )}
      </div>
 
      {room.status === "played" && (
        <div className="ert-card" style={{ padding: 22, marginBottom: 16 }}>
          <div className="ert-display" style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Rating &amp; notes</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 12, color: "var(--text-dim)", width: 72 }}>Your rating</span>
            <StarRow value={myRating} onChange={saveMyRating} size={17} />
            <span className="ert-mono" style={{ fontSize: 12.5, color: "var(--text-dim)", marginLeft: 4 }}>{myRating || "—"}/10</span>
          </div>
 
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {members.map((m) => {
              const isMe = m === currentMember;
              const isEditingThis = isMe && editingNote;
              return (
                <div key={m} style={{ background: "var(--surface-raised)", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isEditingThis ? 8 : 4 }}>
                    <span
                      className={isMe ? "ert-star-btn" : undefined}
                      onClick={isMe ? () => setEditingNote((v) => !v) : undefined}
                      title={isMe ? "Click to edit your note" : undefined}
                      style={{ fontSize: 12.5, fontWeight: 600, cursor: isMe ? "pointer" : "default", color: isMe ? "var(--brass-bright)" : "var(--text)" }}
                    >
                      {m}{isMe ? "  (you)" : ""}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {typeof room.ratings[m] === "number" && (
                        <span className="ert-mono" style={{ fontSize: 12, color: "var(--brass)" }}>{room.ratings[m]}/10</span>
                      )}
                      {isMe && !isEditingThis && (
                        <button
                          className="ert-btn ert-btn-ghost"
                          style={{ padding: "2px 8px", fontSize: 11.5 }}
                          onClick={() => setEditingNote(true)}
                        >
                          <Edit2 size={11} /> Edit
                        </button>
                      )}
                    </div>
                  </div>
 
                  {isEditingThis ? (
                    <>
                      <textarea
                        className="ert-textarea"
                        rows={4}
                        placeholder="Your impressions — puzzle quality, story, scares, whether it's worth recommending…"
                        value={myNote}
                        autoFocus
                        onChange={(e) => setMyNote(e.target.value)}
                      />
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                        <button
                          className="ert-btn ert-btn-brass"
                          disabled={!noteDirty}
                          style={{ opacity: noteDirty ? 1 : 0.5 }}
                          onClick={() => { saveMyNote(); setEditingNote(false); }}
                        >
                          <Check size={14} /> Save note
                        </button>
                        <button
                          className="ert-btn ert-btn-ghost"
                          onClick={() => { setMyNote(room.notes[currentMember] || ""); setEditingNote(false); }}
                        >
                          Cancel
                        </button>
                        {noteSaved && <span style={{ fontSize: 12, color: "var(--success)" }}>Saved.</span>}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 12.5, color: room.notes[m] ? "var(--text)" : "var(--text-dim)", fontStyle: room.notes[m] ? "normal" : "italic", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                      {room.notes[m] || (isMe ? "No notes yet — click your name above to add some." : "No notes yet.")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
 
      {room.status === "played" && (
        <div className="ert-card" style={{ padding: 22, marginBottom: 16 }}>
          <div className="ert-display" style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Walkthrough</div>
          <p style={{ fontSize: 11.5, color: "var(--text-dim)", marginBottom: 10 }}>
            Shared by the whole crew — click to add or edit the solve path, hints used, or tips for a replay.
          </p>
 
          {editingWalkthrough ? (
            <>
              <textarea
                className="ert-textarea"
                rows={6}
                placeholder="Step through how you solved it — puzzle order, hint usage, anything worth remembering next time…"
                value={walkthrough}
                autoFocus
                onChange={(e) => setWalkthrough(e.target.value)}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <button
                  className="ert-btn ert-btn-brass"
                  disabled={!walkthroughDirty}
                  style={{ opacity: walkthroughDirty ? 1 : 0.5 }}
                  onClick={() => { saveWalkthrough(); setEditingWalkthrough(false); }}
                >
                  <Check size={14} /> Save walkthrough
                </button>
                <button
                  className="ert-btn ert-btn-ghost"
                  onClick={() => { setWalkthrough(room.walkthrough || ""); setEditingWalkthrough(false); }}
                >
                  Cancel
                </button>
                {walkthroughSaved && <span style={{ fontSize: 12, color: "var(--success)" }}>Saved.</span>}
              </div>
            </>
          ) : (
            <div
              onClick={() => setEditingWalkthrough(true)}
              title="Click to edit"
              style={{
                fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", cursor: "pointer",
                background: "var(--surface-raised)", borderRadius: 8, padding: "12px 14px", minHeight: 60,
                color: room.walkthrough ? "var(--text)" : "var(--text-dim)",
                fontStyle: room.walkthrough ? "normal" : "italic",
              }}
            >
              {room.walkthrough || "No walkthrough yet — click here to add one."}
            </div>
          )}
        </div>
      )}
 
      <div className="ert-card" style={{ padding: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
          <Camera size={15} color="var(--brass)" />
          <div className="ert-display" style={{ fontSize: 15, fontWeight: 700 }}>Photos</div>
        </div>
 
        {!driveAvailable ? (
          <EmptyNote text="Photo upload uses Google Drive and only works on the hosted site, not in this preview." />
        ) : !driveConnected ? (
          <div>
            <p style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 10 }}>
              Photos upload straight to a Google Drive folder — not a public link. One of you needs to connect it once; after that, everyone can upload and view from any device.
            </p>
            <button className="ert-btn ert-btn-brass" onClick={onConnectDrive}>
              <Upload size={14} /> Connect Google Drive
            </button>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <input
                id={`photo-input-${room.id}`}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => { handlePhotoSelected(e.target.files && e.target.files[0]); e.target.value = ""; }}
              />
              <label
                htmlFor={`photo-input-${room.id}`}
                className="ert-btn ert-btn-ghost"
                style={{ cursor: "pointer", opacity: uploadingPhoto ? 0.6 : 1, pointerEvents: uploadingPhoto ? "none" : "auto" }}
              >
                <Upload size={14} /> {uploadingPhoto ? "Uploading…" : "Upload photo"}
              </label>
              {photoError && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 6 }}>{photoError}</div>}
            </div>
 
            {(!room.photos || room.photos.length === 0) ? (
              <EmptyNote text="No photos yet — upload one from the room." />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                {room.photos.map((p) => (
                  <DrivePhoto key={p.id} photo={p} getDriveAccessToken={getDriveAccessToken} onRemove={() => removePhoto(p)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
 
function DrivePhoto({ photo, getDriveAccessToken, onRemove }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
 
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    (async () => {
      try {
        const token = await getDriveAccessToken();
        const url = await fetchDrivePhotoUrl(photo.driveFileId, token);
        if (!cancelled) setSrc(url);
      } catch (e) {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [photo.driveFileId]);
 
  return (
    <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", aspectRatio: "1", background: "var(--surface-raised)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {failed ? (
        <span style={{ fontSize: 11, color: "var(--text-dim)", padding: 8, textAlign: "center" }}>Couldn't load</span>
      ) : !src ? (
        <span className="ert-mono" style={{ fontSize: 10.5, color: "var(--text-dim)" }}>loading…</span>
      ) : (
        <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      )}
      <button
        onClick={onRemove}
        style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.6)", border: "none", borderRadius: 5, padding: 3, cursor: "pointer" }}
      >
        <X size={12} color="#fff" />
      </button>
    </div>
  );
}
 
/* ---------------------------------------------------------------
   ADD / EDIT ROOM FORM
--------------------------------------------------------------- */
function RoomForm({ room, onCancel, onSave }) {
  const [form, setForm] = useState(room);
  const set = (patch) => setForm({ ...form, ...patch });
 
  const canSave = form.name.trim().length > 0;
 
  return (
    <div className="ert-card" style={{ padding: 22, maxWidth: 640 }}>
      <div className="ert-display" style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>
        {room.name ? "Edit room" : "Add a room"}
      </div>
 
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Room name *"><input className="ert-input" value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Venue / company"><input className="ert-input" value={form.venue} onChange={(e) => set({ venue: e.target.value })} /></Field>
        <Field label="City"><input className="ert-input" value={form.city} onChange={(e) => set({ city: e.target.value })} /></Field>
        <Field label="Country"><input className="ert-input" value={form.country} onChange={(e) => set({ country: e.target.value })} /></Field>
        <Field label="Genre">
          <select className="ert-select" value={form.category} onChange={(e) => set({ category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Difficulty">
          <select className="ert-select" value={form.difficulty} onChange={(e) => set({ difficulty: e.target.value })}>
            {DIFFICULTY_LEVELS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="LockMe link (or other listing)">
          <input className="ert-input" placeholder="https://lock.me/pl/..." value={form.lockmeUrl} onChange={(e) => set({ lockmeUrl: e.target.value })} />
        </Field>
        <Field label="Status">
          <select className="ert-select" value={form.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="wishlist">Wishlist</option>
            <option value="played">Played</option>
          </select>
        </Field>
 
        {form.status === "played" && (
          <>
            <Field label="Date played"><input type="date" className="ert-input" value={form.datePlayed} onChange={(e) => set({ datePlayed: e.target.value })} /></Field>
            <Field label="Result">
              <select className="ert-select" value={form.result === "unknown" ? "escaped" : form.result} onChange={(e) => set({ result: e.target.value })}>
                <option value="escaped">Escaped</option>
                <option value="not-escaped">Not escaped</option>
              </select>
            </Field>
            <Field label="Time note (e.g. '4:12 left')">
              <input className="ert-input" value={form.timeNote} onChange={(e) => set({ timeNote: e.target.value })} />
            </Field>
          </>
        )}
      </div>
 
      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button className="ert-btn ert-btn-brass" disabled={!canSave} style={{ opacity: canSave ? 1 : 0.5 }} onClick={() => canSave && onSave(form)}>
          <Check size={14} /> Save room
        </button>
        <button className="ert-btn ert-btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
 
function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
 
/* ---------------------------------------------------------------
   SETTINGS
--------------------------------------------------------------- */
function SettingsView({ members, currentMember, onChangePassword, rooms }) {
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
 
  const openChange = () => {
    setChanging(true);
    setCurrent(""); setNext(""); setConfirm(""); setError(""); setSuccess(false);
  };
  const closeChange = () => {
    setChanging(false);
    setCurrent(""); setNext(""); setConfirm(""); setError(""); setSuccess(false);
  };
 
  const stats = useMemo(() => {
    const byMember = {};
    members.forEach((m) => { byMember[m] = { added: 0, rated: 0, noted: 0 }; });
    (rooms || []).forEach((r) => {
      if (r.addedBy && byMember[r.addedBy]) byMember[r.addedBy].added += 1;
      members.forEach((m) => {
        if (typeof r.ratings?.[m] === "number") byMember[m].rated += 1;
        if (r.notes?.[m] && r.notes[m].trim().length > 0) byMember[m].noted += 1;
      });
    });
    return byMember;
  }, [members, rooms]);
 
  const submit = async () => {
    setError("");
    setSuccess(false);
    if (next.length < 4) { setError("New password must be at least 4 characters."); return; }
    if (next !== confirm) { setError("New passwords don't match."); return; }
    setBusy(true);
    try {
      const ok = await onChangePassword(currentMember, current, next);
      if (ok) {
        setSuccess(true);
        setCurrent(""); setNext(""); setConfirm("");
      } else {
        setError("Current password is incorrect.");
      }
    } catch (e) {
      setError("Couldn't update the password — try again.");
    } finally {
      setBusy(false);
    }
  };
 
  return (
    <div className="ert-card" style={{ padding: 22, maxWidth: 420 }}>
      <div className="ert-display" style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Crew</div>
      <p style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 14 }}>Everyone here shares this log and can add rooms, ratings and notes.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {members.map((m) => (
          <div key={m} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface-raised)", padding: "9px 12px", borderRadius: 7 }}>
            <span style={{ fontSize: 13.5 }}>{m}{m === currentMember ? "  (you)" : ""}</span>
            {m === currentMember && !changing && (
              <button className="ert-btn ert-btn-ghost" style={{ padding: "4px 8px", fontSize: 12 }} onClick={openChange}>
                Change password
              </button>
            )}
          </div>
        ))}
      </div>
 
      <div style={{ marginTop: 18 }}>
        <div className="ert-display" style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>Crew stats</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr repeat(3, 56px)", gap: "6px 4px", alignItems: "center" }}>
          <span></span>
          <span className="ert-mono" style={{ fontSize: 10, color: "var(--text-dim)", textAlign: "center" }}>ADDED</span>
          <span className="ert-mono" style={{ fontSize: 10, color: "var(--text-dim)", textAlign: "center" }}>RATED</span>
          <span className="ert-mono" style={{ fontSize: 10, color: "var(--text-dim)", textAlign: "center" }}>NOTED</span>
          {members.map((m) => (
            <React.Fragment key={m}>
              <span style={{ fontSize: 13 }}>{m}</span>
              <span className="ert-mono" style={{ fontSize: 13, textAlign: "center", color: "var(--brass)" }}>{stats[m].added}</span>
              <span className="ert-mono" style={{ fontSize: 13, textAlign: "center", color: "var(--brass)" }}>{stats[m].rated}</span>
              <span className="ert-mono" style={{ fontSize: 13, textAlign: "center", color: "var(--brass)" }}>{stats[m].noted}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
 
      {changing && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border-soft)" }}>
          <div className="ert-display" style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>Change your password</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input type="password" className="ert-input" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            <input type="password" className="ert-input" placeholder="New password" value={next} onChange={(e) => setNext(e.target.value)} />
            <input type="password" className="ert-input" placeholder="Repeat new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {error && <div style={{ color: "var(--danger)", fontSize: 12.5, marginTop: 8 }}>{error}</div>}
          {success && <div style={{ color: "var(--success)", fontSize: 12.5, marginTop: 8 }}>Password updated.</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="ert-btn ert-btn-brass" disabled={busy} style={{ opacity: busy ? 0.6 : 1 }} onClick={submit}>
              <Check size={14} /> Save
            </button>
            <button className="ert-btn ert-btn-ghost" onClick={closeChange}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
