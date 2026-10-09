import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Lock, Unlock, MapPin, Star, StarHalf, Plus, Search, X, Edit2, Trash2,
  ExternalLink, Users, User, Trophy, ListChecks, LayoutDashboard,
  Camera, ChevronLeft, Settings, Check, Clock, Skull, Sparkles, Filter, FilterX,
  ChevronDown, ChevronUp, ChevronRight, Upload, ArrowUpDown, Plane, Calendar, Image as ImageIcon, Wallet, Ghost, Dumbbell, SlidersHorizontal, Ban, CornerUpRight,
  Home, DoorOpen, PanelLeft, PanelTop, Tag, Minus, KeyRound, ListOrdered,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
 
/* ---------------------------------------------------------------
   STORAGE
   Uses Claude's built-in window.storage when running as an artifact.
   Outside Claude (e.g. hosted on GitHub Pages) it syncs shared room
   data through Firebase Firestore instead, so the whole crew sees
   the same live data. Your own "who am I" selection always stays in
   this browser's localStorage. That's meant to be per-device.
 
   To enable the shared backend: create a Firebase project, create a
   Firestore database in it, register a web app, and paste the config
   object it gives you below. See the setup steps you were given
   alongside this file.
--------------------------------------------------------------- */
const hasClaudeStorage = typeof window !== "undefined" && window.storage && typeof window.storage.get === "function";

// In-app browsers (Facebook/Messenger, Instagram, TikTok, LinkedIn, etc.)
// often run in a sandboxed WebView that blocks IndexedDB, which Firestore
// needs to sync data. This is a heuristic, not a guarantee -- it just lets
// the app warn people to open the real link in Safari/Chrome instead of
// silently losing changes.
function isKnownInAppBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /FBAN|FBAV|Instagram|Messenger|Line\/|MicroMessenger|TikTok|LinkedInApp/i.test(ua);
}
 
// Loaded from config.js (see that file) so credentials never need to be
// re-pasted into this file on every update. Falls back to placeholders if
// config.js hasn't been set up yet (or isn't present, e.g. in this preview).
const FIREBASE_CONFIG = (typeof window !== "undefined" && window.ESCAPE_LOG_CONFIG && window.ESCAPE_LOG_CONFIG.FIREBASE_CONFIG) || {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
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
      // login screen. It scopes access to just this app, not to any
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
   you create, never as public links. The app authenticates once
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
   4. Paste the three values into config.js (not this file).

   Scope is drive.file. The app can only see files it creates
   itself, nothing else in your Drive.
--------------------------------------------------------------- */
// Also loaded from config.js -- see the note above FIREBASE_CONFIG.
const GOOGLE_DRIVE_CONFIG = (typeof window !== "undefined" && window.ESCAPE_LOG_CONFIG && window.ESCAPE_LOG_CONFIG.GOOGLE_DRIVE_CONFIG) || {
  clientId: "YOUR_CLIENT_ID.apps.googleusercontent.com",
  clientSecret: "YOUR_CLIENT_SECRET",
  folderId: "YOUR_DRIVE_FOLDER_ID",
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
    throw new Error("Google didn't return a refresh token. Try connecting again (Google only issues one on first consent).");
  }
  return json.refresh_token;
}

// In-memory access-token cache (never persisted, short-lived by design).
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
  if (!res.ok) throw new Error("Couldn't refresh Google Drive access. It may need reconnecting.");
  const json = await res.json();
  driveAccessTokenCache = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function uploadBlobToDrive(blob, name, mimeType, accessToken, parentId) {
  const metadata = { name, parents: [parentId || GOOGLE_DRIVE_CONFIG.folderId] };
  const boundary = "escapelog" + Math.random().toString(36).slice(2);
  const fileBytes = new Uint8Array(await blob.arrayBuffer());
  const encoder = new TextEncoder();
  const pre = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`
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

// Finds (or creates, the first time) a "thumbnails" subfolder inside the
// main photo folder, so thumbnail files don't clutter the same listing as
// the originals if someone browses the Drive folder directly. Cached for
// the session so repeat uploads don't re-query Drive every time.
let thumbFolderIdPromise = null;
async function getThumbnailFolderId(accessToken) {
  if (thumbFolderIdPromise) return thumbFolderIdPromise;
  thumbFolderIdPromise = (async () => {
    const parentId = GOOGLE_DRIVE_CONFIG.folderId;
    const q = encodeURIComponent(`name='thumbnails' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`);
    const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (listRes.ok) {
      const data = await listRes.json();
      if (data.files && data.files.length) return data.files[0].id;
    }
    const createRes = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "thumbnails", mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
    });
    if (!createRes.ok) throw new Error("Couldn't create the thumbnails folder.");
    const created = await createRes.json();
    return created.id;
  })();
  try {
    return await thumbFolderIdPromise;
  } catch (e) {
    thumbFolderIdPromise = null; // let the next upload retry instead of staying stuck on a failed attempt
    throw e;
  }
}

async function uploadPhotoToDrive(file, accessToken) {
  const uploaded = await uploadBlobToDrive(file, file.name, file.type, accessToken);
  // Also generate and upload a small thumbnail so future grid views never
  // need to download the full original just to show a preview. Resizing
  // happens on the file already sitting in memory here, so this adds no
  // extra download, only a small extra upload.
  let thumbId = null;
  try {
    const thumbBlob = await resizeImageBlob(file, 240);
    const thumbName = "thumb_" + file.name.replace(/\.[^.]+$/, "") + ".jpg";
    const thumbFolderId = await getThumbnailFolderId(accessToken);
    const thumbUploaded = await uploadBlobToDrive(thumbBlob, thumbName, "image/jpeg", accessToken, thumbFolderId);
    thumbId = thumbUploaded.id;
  } catch (e) {
    // A failed thumbnail upload shouldn't block the photo itself -- the
    // thumbnail fetch path falls back to the full original when absent.
  }
  return { ...uploaded, thumbId };
}

async function deletePhotoFromDrive(fileId, accessToken) {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => {}); // best-effort: a failed remote delete shouldn't block removing it from the room
}

// Two caches, both bounded with LRU eviction so a growing gallery can't
// grow memory use without limit:
//  - driveThumbCache: small, canvas-compressed previews, used for every
//    grid thumbnail. Cheap enough to keep a lot of.
//  - driveBlobCache: full-resolution originals, used only by the lightbox
//    when a photo is actually opened full-size. Kept smaller since each
//    one is much heavier.
const THUMB_CACHE_LIMIT = 300;
const FULL_CACHE_LIMIT = 20;
const driveThumbCache = new Map(); // fileId -> object URL (compressed)
const driveBlobCache = new Map(); // fileId -> object URL (original), so re-opening a room doesn't re-fetch

function touchCache(cache, key) {
  // Re-inserting moves the key to the end, which is what makes "delete the
  // first entries" below equivalent to "evict the least recently used".
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
}
function evictIfNeeded(cache, limit) {
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    const oldestUrl = cache.get(oldestKey);
    URL.revokeObjectURL(oldestUrl);
    cache.delete(oldestKey);
  }
}

async function fetchDriveBytes(fileId, accessToken) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Couldn't load that photo from Google Drive.");
  return res.blob();
}

// Downloads already under way, keyed by file id. If the viewer asks for a
// photo that is being prefetched, it waits on the same download instead of
// starting a second one.
const driveBlobInflight = new Map();

async function fetchDrivePhotoUrl(fileId, accessToken) {
  if (driveBlobCache.has(fileId)) {
    touchCache(driveBlobCache, fileId);
    return driveBlobCache.get(fileId);
  }
  if (driveBlobInflight.has(fileId)) return driveBlobInflight.get(fileId);
  const job = (async () => {
    const blob = await fetchDriveBytes(fileId, accessToken);
    const url = URL.createObjectURL(blob);
    driveBlobCache.set(fileId, url);
    evictIfNeeded(driveBlobCache, FULL_CACHE_LIMIT);
    return url;
  })();
  driveBlobInflight.set(fileId, job);
  const clear = () => { if (driveBlobInflight.get(fileId) === job) driveBlobInflight.delete(fileId); };
  job.then(clear, clear);
  return job;
}

// Quietly downloads a photo (and decodes it) ahead of time so the viewer can
// show it the instant someone swipes to it. Never throws: a failed prefetch
// just means the photo loads normally when it's actually opened.
async function prefetchDrivePhoto(fileId, accessToken) {
  try {
    const url = await fetchDrivePhotoUrl(fileId, accessToken);
    const img = new Image();
    img.src = url;
    if (img.decode) await img.decode();
  } catch (e) { /* ignore */ }
}

// A small, compressed preview for grid thumbnails -- downloads the same
// original (there's no separate small file on Drive's side to ask for) but
// only keeps a shrunk, recompressed copy in memory afterward.
// Shrinks any image Blob/File to a compressed JPEG no larger than maxDim on
// its longest side. Used both to make upload-time thumbnail files and, for
// photos uploaded before that existed, as the on-demand fallback below.
async function resizeImageBlob(blob, maxDim, quality = 0.72) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const resized = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  return resized || blob;
}

// Loads a photo's grid thumbnail. Photos uploaded after thumbnail files
// were introduced carry their own small `thumbFileId` on Drive -- fetching
// that is a tiny download with no client-side work needed. Older photos
// have no such file, so this falls back to downloading the full original
// once and shrinking it locally, same as before.
async function fetchDriveThumbnailUrl(photo, accessToken, maxDim = 240) {
  const cacheKey = photo.thumbFileId || photo.driveFileId;
  if (driveThumbCache.has(cacheKey)) {
    touchCache(driveThumbCache, cacheKey);
    return driveThumbCache.get(cacheKey);
  }
  let url;
  if (photo.thumbFileId) {
    const blob = await fetchDriveBytes(photo.thumbFileId, accessToken);
    url = URL.createObjectURL(blob);
  } else {
    const blob = await fetchDriveBytes(photo.driveFileId, accessToken);
    const thumbBlob = await resizeImageBlob(blob, maxDim);
    url = URL.createObjectURL(thumbBlob);
  }
  driveThumbCache.set(cacheKey, url);
  evictIfNeeded(driveThumbCache, THUMB_CACHE_LIMIT);
  return url;
}

// Personal, per-device value (e.g. "who am I"). Never goes through Firebase.
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
   Web Crypto API before it's ever written anywhere. Only the salt
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
   Palette: a dim, brass-lit "room" rather than a generic dark UI,
   charcoal-blue walls, a brass key accent (the thing everyone's
   hunting for), and a UV-teal accent for "clue" moments.
--------------------------------------------------------------- */
const TOKENS = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');

  .ert-root, .ert-root *, .ert-root *::before, .ert-root *::after { box-sizing: border-box; }
  .ert-root {
    --bg: #14161c;
    --surface: #1b1e27;
    --surface-raised: #252a35;
    --border: #3a4152;
    --border-soft: #2a2f3b;
    --text: #ece8dd;
    --text-dim: #9aa0b1;
    --brass: #c89b4a;
    --brass-bright: #e3bd72;
    --teal: #48a99e;
    --danger: #d0675a;
    --success: #6a9d74;
    --brass-hover: #e3bd72;
    --on-brass: #17140c;
    --topbar-bg: rgba(20,22,28,.93);
    --hover: rgba(236,232,221,.06);
    --hover-soft: rgba(236,232,221,.04);
    --tile-hover: #1f232d;
    --step-hover: #303644;
    --brass-wash: rgba(200,155,74,.16);
    --brass-ring: rgba(200,155,74,.22);
    --brass-edge: rgba(200,155,74,.5);
    --rail: 79px;
    --bar: 57px;
    font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }
  /* Light theme: warm paper rather than white. Cards sit a step lighter than the page so they still lift. */
  .ert-root[data-theme="light"] {
    color-scheme: light;
    --bg: #e4dfd3;
    --surface: #efebe1;
    --surface-raised: #f6f3eb;
    --border: #bfb8a6;
    --border-soft: #d3cdbd;
    --text: #25272e;
    --text-dim: #5d6272;
    --brass: #b4832b;
    --brass-bright: #7d5614;
    --brass-hover: #c4953a;
    --teal: #2f857b;
    --danger: #b94a3d;
    --success: #4d8559;
    --topbar-bg: rgba(228,223,211,.93);
    --hover: rgba(37,39,46,.07);
    --hover-soft: rgba(37,39,46,.045);
    --tile-hover: #f6f3eb;
    --step-hover: #e2ddcf;
    --brass-wash: rgba(180,131,43,.17);
    --brass-ring: rgba(180,131,43,.30);
    --brass-edge: rgba(150,105,28,.5);
  }
  .ert-root[data-theme="light"] .ert-select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%235d6272' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  }
  .ert-root[data-theme="light"] .ert-card-raised[role=menu], .ert-root[data-theme="light"] .ert-card-raised[role=dialog] { box-shadow: 0 10px 28px rgba(60,50,30,.18) !important; }
  .ert-root[data-theme="light"] .ert-modal { box-shadow: 0 20px 50px rgba(60,50,30,.28); }
  .ert-root[data-theme="light"] .ert-sw i { box-shadow: 0 1px 2px rgba(0,0,0,.3); }
  /* The combination dial is a physical object: it stays dark in both themes. */
  .ert-dial { --brass-bright: #e3bd72; --text: #ece8dd; }
  .ert-display { font-family: 'Space Grotesk', 'Inter', sans-serif; }
  .ert-mono { font-family: 'Space Grotesk', 'Inter', sans-serif; font-variant-numeric: tabular-nums; }
  .ert-root ::selection { background: var(--brass); color: var(--on-brass); }
  .ert-root button { font-family: inherit; }
  .ert-root :focus-visible { outline: 2px solid var(--brass-bright); outline-offset: 2px; }

  /* ---- surfaces, inputs, buttons ---- */
  .ert-card { background: var(--surface); border: 1px solid var(--border-soft); border-radius: 14px; }
  .ert-card-raised { background: var(--surface-raised); border: 1px solid var(--border); border-radius: 10px; }
  .ert-input, .ert-select, .ert-textarea {
    background: var(--surface); border: 1px solid var(--border-soft); color: var(--text);
    border-radius: 10px; padding: 9px 12px; font-family: inherit; font-size: 14px; width: 100%; outline: none;
  }
  .ert-select {
    -webkit-appearance: none; appearance: none; padding-right: 33px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%239aa0b1' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 12px center;
  }
  .ert-textarea { line-height: 1.55; }
  .ert-input:focus, .ert-select:focus, .ert-textarea:focus { border-color: var(--brass); box-shadow: 0 0 0 3px var(--brass-ring); }
  .ert-input::placeholder, .ert-textarea::placeholder { color: var(--text-dim); }

  .ert-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    border-radius: 10px; padding: 9px 14px; font-size: 13.5px; line-height: 1.2;
    font-weight: 600; cursor: pointer; border: 1px solid transparent; white-space: nowrap;
  }
  .ert-btn[disabled] { cursor: default; }
  .ert-btn-brass { background: var(--brass); color: var(--on-brass); }
  .ert-btn-brass:hover:not([disabled]) { background: var(--brass-hover); }
  .ert-btn-ghost { background: var(--surface); color: var(--text); border-color: var(--border-soft); }
  .ert-btn-ghost:hover { background: var(--surface-raised); border-color: var(--border); }
  .ert-btn-ghost:not([style*="padding"]) { min-height: 38px; font-weight: 500; }
  .ert-btn-danger { background: transparent; color: var(--danger); border-color: rgba(208,103,90,.55); }
  .ert-btn-danger:hover { background: rgba(208,103,90,.1); }
  .ert-ibtn { width: 38px; height: 34px; display: flex; align-items: center; justify-content: center; border-radius: 9px; color: var(--text-dim); background: none; border: 0; cursor: pointer; }
  .ert-ibtn:hover { color: var(--text); background: var(--hover); }
  .ert-avatar { width: 33px; height: 33px; border-radius: 50%; border: 1.5px solid var(--brass); background: var(--surface-raised); color: var(--brass-bright); display: flex; align-items: center; justify-content: center; font-weight: 600; cursor: pointer; font-size: 14px; padding: 0; }
  .ert-link { background: none; border: 0; padding: 0; color: var(--text-dim); text-decoration: underline; text-decoration-color: var(--border); text-underline-offset: 4px; cursor: pointer; font-size: inherit; }
  .ert-link:hover { color: var(--text); text-decoration-color: var(--brass); }
  .ert-back { display: inline-flex; align-items: center; gap: 6px; color: var(--text-dim); height: 34px; margin-left: -9px; padding: 0 12px 0 6px; border-radius: 17px; background: none; border: 0; cursor: pointer; font-size: 14px; }
  .ert-back:hover { color: var(--text); background: var(--surface); }
  .ert-scrollbar::-webkit-scrollbar { height: 6px; width: 6px; }
  .ert-scrollbar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
  .ert-star-btn { cursor: pointer; }

  /* ---- layout: one navigation, two possible homes for it ---- */
  .ert-app.ert-nav-side { display: grid; grid-template-columns: var(--rail) minmax(0, 1fr); }
  .ert-col { min-width: 0; }
  .ert-main { padding: 28px 44px 80px; max-width: 1240px; }
  .ert-nav-top .ert-main { margin: 0 auto; padding-top: 28px; }
  .ert-ph { display: flex; align-items: center; justify-content: space-between; gap: 21px; margin-bottom: 21px; min-height: 40px; }
  .ert-ph h1 { font: 700 30px/1.1 'Space Grotesk', sans-serif; letter-spacing: -.02em; margin: 0; }

  .ert-rail { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; border-right: 1px solid var(--border-soft); padding: 17px 0 14px; }
  .ert-logo { display: flex; justify-content: center; padding: 4px 0 22px; color: var(--brass); }
  .ert-rail nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
  .ert-rtab { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 11px 4px; font-size: 11.5px; font-weight: 500; color: var(--text-dim); text-align: center; background: none; border: 0; cursor: pointer; }
  .ert-rtab:hover { color: var(--text); background: var(--hover-soft); }
  .ert-rtab[aria-current=page] { color: var(--brass-bright); }
  .ert-rtab[aria-current=page]::before { content: ""; position: absolute; left: 0; top: 10px; bottom: 10px; width: 3px; border-radius: 0 3px 3px 0; background: var(--brass); }
  .ert-rail-foot { display: flex; flex-direction: column; align-items: center; gap: 4px; padding-top: 10px; margin: 0 12px; border-top: 1px solid var(--border-soft); }
  .ert-rail-foot .ert-avatar { margin-top: 6px; }

  .ert-topbar { position: sticky; top: 0; z-index: 20; height: var(--bar); display: flex; align-items: center; padding: 0 24px; background: var(--topbar-bg); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); border-bottom: 1px solid var(--border-soft); }
  .ert-brand { display: flex; align-items: center; gap: 9px; font: 700 18px 'Space Grotesk', sans-serif; letter-spacing: -.01em; margin-right: 26px; white-space: nowrap; }
  .ert-brand svg { color: var(--brass); }
  .ert-ttabs { display: flex; height: 100%; }
  .ert-ttab { position: relative; display: flex; align-items: center; gap: 8px; padding: 0 15px; color: var(--text-dim); font-weight: 500; font-size: 14px; white-space: nowrap; background: none; border: 0; cursor: pointer; }
  .ert-ttab:hover { color: var(--text); }
  .ert-ttab[aria-current=page] { color: var(--brass-bright); }
  .ert-ttab[aria-current=page]::after { content: ""; position: absolute; left: 10px; right: 10px; bottom: -1px; height: 3px; border-radius: 3px 3px 0 0; background: var(--brass); }
  .ert-tright { margin-left: auto; display: flex; align-items: center; gap: 6px; }
  .ert-tright .ert-addwrap { margin-right: 8px; }
  .ert-tright .ert-avatar { width: 31px; height: 31px; margin-left: 4px; }

  /* ---- Home ---- */
  .ert-hero { display: flex; align-items: center; gap: 48px; padding: 6px 0 33px; border-bottom: 1px solid var(--border-soft); }
  .ert-dial { display: inline-flex; gap: 8px; padding: 12px; border-radius: 20px; background: #0e1015; border: 1px solid #4a3d22; box-shadow: 0 0 0 1px #000, 0 14px 40px rgba(0,0,0,.5), inset 0 1px 0 rgba(227,189,114,.12); position: relative; flex: none; }
  .ert-dial::before { content: ""; position: absolute; top: -8px; left: 50%; margin-left: -8px; border: 8px solid transparent; border-top-color: var(--brass); border-bottom: 0; }
  .ert-wheel { width: 66px; height: 96px; overflow: hidden; position: relative; border-radius: 10px; background: #20252f; box-shadow: inset 0 0 0 1px #3a4152; }
  .ert-wheel::after { content: ""; position: absolute; inset: 0; border-radius: 10px; pointer-events: none; background: linear-gradient(#000c, #0000 28%, #0000 72%, #000c); box-shadow: inset 0 0 14px rgba(0,0,0,.7); }
  .ert-strip { transition: transform 1.4s cubic-bezier(.22,.9,.24,1); }
  .ert-strip span { display: block; height: 96px; line-height: 96px; text-align: center; font: 700 60px 'Space Grotesk', sans-serif; color: var(--brass-bright); font-variant-numeric: tabular-nums; }
  .ert-hero-copy .big { font: 600 28px/1.15 'Space Grotesk', sans-serif; letter-spacing: -.015em; }
  .ert-hero-copy p { margin: 6px 0 0; color: var(--text-dim); font-size: 15px; }
  .ert-stats { margin-left: auto; display: flex; }
  .ert-stats > div, .ert-stats > button { padding: 2px 33px; border: 0; border-left: 1px solid var(--border-soft); min-width: 129px; background: none; text-align: left; color: inherit; }
  .ert-stats > button { cursor: pointer; }
  .ert-stats > button:hover b { color: var(--brass-bright); }
  .ert-stats b { display: block; font: 700 37px/1.1 'Space Grotesk', sans-serif; font-variant-numeric: tabular-nums; }
  .ert-stats span { color: var(--text-dim); font-size: 13px; }
  .ert-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 62px; margin-top: 38px; }
  .ert-sh { display: flex; align-items: baseline; justify-content: space-between; margin: 0 0 4px; font: 600 19px 'Space Grotesk', sans-serif; }
  .ert-sh small { font: 400 13px 'Inter', sans-serif; color: var(--text-dim); }
  .ert-lrow { display: grid; grid-template-columns: 29px minmax(0, 1fr) auto; align-items: center; gap: 17px; width: 100%; padding: 13px 0; border: 0; border-bottom: 1px solid var(--border-soft); text-align: left; background: none; color: inherit; cursor: pointer; }
  .ert-lrow.no-rank { grid-template-columns: minmax(0, 1fr) auto; }
  .ert-lrow:hover { background: var(--surface); box-shadow: -12px 0 0 var(--surface), 12px 0 0 var(--surface); }
  .ert-rank { font: 700 19px 'Space Grotesk', sans-serif; color: var(--text-dim); }
  .ert-rank.top { color: var(--brass-bright); }
  .ert-rkcell { position: relative; display: block; min-height: 22px; }
  .ert-rkcell .sc { display: block; text-align: left; transition: opacity .12s; }
  .ert-rkcell .pos { position: absolute; left: 0; top: 0; bottom: 0; display: flex; align-items: center; opacity: 0; transition: opacity .12s; font: 700 19px 'Space Grotesk', sans-serif; color: var(--text-dim); }
  .ert-rkcell .pos.top { color: var(--brass-bright); }
  .ert-lrow:hover .ert-rkcell .sc, .ert-lrow:focus-visible .ert-rkcell .sc { opacity: 0; }
  .ert-lrow:hover .ert-rkcell .pos, .ert-lrow:focus-visible .ert-rkcell .pos { opacity: 1; }
  .ert-r-title { font: 600 16px/1.25 'Space Grotesk', sans-serif; display: block; }
  .ert-r-sub { color: var(--text-dim); font-size: 13px; display: block; }
  .ert-score { font: 700 21px 'Space Grotesk', sans-serif; color: var(--brass-bright); font-variant-numeric: tabular-nums; text-align: right; line-height: 1; }
  .ert-bar { display: grid; grid-template-columns: 129px 1fr 22px; align-items: center; gap: 12px; padding: 8px 0; }
  .ert-bar i { display: block; height: 8px; border-radius: 4px; background: var(--surface-raised); overflow: hidden; }
  .ert-bar i b { display: block; height: 100%; background: var(--brass); border-radius: 4px; }
  .ert-bar span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ert-bar span:last-child { text-align: right; color: var(--text-dim); font-variant-numeric: tabular-nums; }
  .ert-stack { display: flex; flex-direction: column; gap: 40px; min-width: 0; }
  .ert-yearchart { display: flex; align-items: flex-end; gap: 12px; height: 200px; padding-top: 6px; }
  .ert-yearchart.dense { gap: 4px; }
  .ert-ycol { flex: 1 1 0; min-width: 0; max-width: 88px; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 6px; }
  .ert-ycol .n { font-size: 12.5px; color: var(--text-dim); font-variant-numeric: tabular-nums; line-height: 1; }
  .ert-ycol .col { width: 100%; border-radius: 4px 4px 0 0; background: var(--brass); min-height: 3px; }
  .ert-ycol .col.zero { background: var(--surface-raised); }
  .ert-ycol .y { font-size: 12.5px; color: var(--text-dim); font-variant-numeric: tabular-nums; line-height: 1; padding-top: 2px; border-top: 1px solid var(--surface-raised); width: 100%; text-align: center; margin-top: -2px; }
  .ert-ycol .plot { flex: 1 1 auto; width: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 6px; min-height: 0; padding-top: 20px; box-sizing: border-box; }

  /* ---- Rooms: one tab, a toggle, tiles ---- */
  .ert-seg { display: inline-flex; background: var(--surface); border: 1px solid var(--border-soft); border-radius: 10px; padding: 3px; gap: 3px; flex: none; }
  .ert-seg button { height: 31px; padding: 0 15px; border-radius: 8px; font-weight: 600; font-size: 13.5px; color: var(--text-dim); display: inline-flex; align-items: center; gap: 8px; background: none; border: 0; cursor: pointer; }
  .ert-seg button .n { font-weight: 500; }
  .ert-seg button[aria-pressed=true] { background: var(--surface-raised); color: var(--text); box-shadow: inset 0 0 0 1px var(--border); }
  /* Two-way toggle (Rooms, Ranking): one button, the brass highlight slides to the other side when clicked. */
  .ert-tgl { position: relative; display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr; flex: none; padding: 3px; background: var(--surface); border: 1px solid var(--border-soft); border-radius: 10px; cursor: pointer; font-family: inherit; color: var(--text-dim); }
  .ert-tgl .thumb { position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc((100% - 6px) / 2); border-radius: 8px; background: var(--brass-wash); box-shadow: inset 0 0 0 1px var(--brass-edge); transition: transform .26s cubic-bezier(.4, .05, .2, 1); }
  .ert-tgl[data-i="1"] .thumb { transform: translateX(100%); }
  .ert-tgl > span { position: relative; height: 31px; padding: 0 15px; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 13.5px; white-space: nowrap; transition: color .2s; }
  .ert-tgl > span.on { color: var(--brass-bright); }
  .ert-tgl:hover > span:not(.on) { color: var(--text); }
  @media (prefers-reduced-motion: reduce) { .ert-tgl .thumb, .ert-tgl > span { transition: none; } }
  .ert-yr { display: flex; align-items: baseline; justify-content: space-between; padding: 26px 0 9px; border-bottom: 1px solid var(--border); }
  .ert-yr b { font: 700 19px 'Space Grotesk', sans-serif; }
  .ert-yr span { color: var(--text-dim); font-size: 13px; }
  .ert-tgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(225px, 1fr)); gap: 14px; margin-top: 14px; }
  .ert-tile { display: flex; flex-direction: column; text-align: left; padding: 15px 15px 14px; min-height: 158px; background: var(--surface); border: 1px solid var(--border-soft); border-radius: 14px; color: inherit; cursor: pointer; font-family: inherit; }
  .ert-tilewrap { position: relative; display: flex; }
  .ert-tilewrap .ert-tile, .ert-tgrid .ert-tile { width: 100%; }
  .ert-tile-x { position: absolute; top: -8px; right: -8px; width: 26px; height: 26px; border-radius: 50%; background: var(--surface-raised); border: 1px solid var(--border); color: var(--text-dim); display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; z-index: 1; }
  .ert-tile-x:hover, .ert-tile-x.armed { color: #fff; background: var(--danger); border-color: var(--danger); }
  .ert-tile-x.armed { width: auto; padding: 0 11px 0 8px; border-radius: 13px; gap: 5px; font-size: 12px; font-weight: 600; font-family: inherit; }
  .ert-tile:hover { border-color: var(--border); background: var(--tile-hover); }
  .ert-tile-top { display: flex; justify-content: space-between; align-items: center; gap: 9px; color: var(--text-dim); font-size: 13px; min-height: 19px; }
  .ert-tile-nm { font: 600 18px/1.2 'Space Grotesk', sans-serif; margin-top: 10px; letter-spacing: -.005em; }
  .ert-tile-vn { color: var(--text-dim); font-size: 13.5px; margin-top: 2px; }
  .ert-tile-loc { display: flex; align-items: center; gap: 6px; color: var(--text-dim); font-size: 13px; margin-top: 9px; }
  .ert-tile-bot { display: flex; align-items: center; justify-content: space-between; margin-top: auto; padding-top: 14px; gap: 9px; }
  .ert-pill { font-size: 12.5px; padding: 4px 10px; border-radius: 859px; background: var(--surface-raised); color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ert-tile-sc { display: flex; align-items: center; gap: 7px; font: 700 22px/1 'Space Grotesk', sans-serif; color: var(--brass-bright); font-variant-numeric: tabular-nums; }
  .ert-tile-sc svg { color: var(--brass); fill: var(--brass); }

  /* ---- room page: identity pinned left, interaction given room on the right ---- */
  .ert-room-top { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 6px; }
  .ert-room { display: grid; grid-template-columns: minmax(292px, 361px) minmax(0, 1fr); gap: 69px; align-items: start; margin-top: 9px; }
  .ert-room-aside { position: sticky; top: 31px; }
  .ert-nav-top .ert-room-aside { top: calc(var(--bar) + 26px); }
  .ert-status { display: flex; align-items: center; gap: 8px; color: var(--text-dim); }
  .ert-room h1 { font: 700 40px/1.06 'Space Grotesk', sans-serif; letter-spacing: -.025em; margin: 9px 0 6px; overflow-wrap: anywhere; }
  .ert-facts { margin-top: 17px; display: grid; }
  .ert-fact { display: flex; align-items: center; gap: 9px; min-height: 30px; color: var(--text-dim); }
  .ert-who { display: flex; gap: 9px; margin-top: 22px; flex-wrap: wrap; }
  .ert-pchip { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 62px; font-size: 12.5px; color: var(--text); text-align: center; line-height: 1.25; }
  .ert-pchip .c { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--brass); color: #17140c; }
  .ert-pchip.off { color: var(--text-dim); }
  .ert-pchip.off .c { background: var(--surface-raised); color: var(--text-dim); border: 1px solid var(--border); }
  .ert-avgs { display: flex; align-items: center; gap: 29px; margin-top: 26px; padding-top: 22px; border-top: 1px solid var(--border-soft); }
  .ert-avg-big { font: 700 60px/1 'Space Grotesk', sans-serif; color: var(--brass-bright); font-variant-numeric: tabular-nums; }
  .ert-avg-cap { color: var(--text-dim); font-size: 13px; margin-top: 6px; }
  .ert-avg-small { display: flex; align-items: center; gap: 8px; font: 600 19px 'Space Grotesk', sans-serif; font-variant-numeric: tabular-nums; }
  .ert-avg-small small { font: 400 13px 'Inter', sans-serif; color: var(--text-dim); }
  .ert-rsec { padding-bottom: 36px; }
  .ert-rsec > h2 { font: 600 21px 'Space Grotesk', sans-serif; margin: 0 0 12px; display: flex; align-items: baseline; justify-content: space-between; }
  .ert-rsec > h2 small { font: 400 13px 'Inter', sans-serif; color: var(--text-dim); }
  .ert-panel { background: var(--surface); border: 1px solid var(--border-soft); border-radius: 15px; padding: 4px 24px; }
  .ert-panel-rate { padding: 2px 24px; }
  .ert-rate { display: grid; grid-template-columns: 96px 76px minmax(0, 1fr) 48px; align-items: center; column-gap: 16px; padding: 11px 0; border-bottom: 1px solid var(--border-soft); }
  .ert-rate:last-child { border-bottom: 0; }
  .ert-rate-l { font-weight: 600; font-size: 14px; }
  .ert-stars { width: 100%; display: flex; align-items: center; height: 36px; cursor: pointer; user-select: none; -webkit-user-select: none; touch-action: pan-y; border-radius: 8px; }
  .ert-stars.ro { cursor: default; }
  .ert-star { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; }
  .ert-star .ico { position: relative; flex: none; }
  .ert-star .base { color: var(--border); }
  .ert-star .fillclip { position: absolute; inset: 0; pointer-events: none; transition: opacity .1s; }
  .ert-stars.pv .fillclip { opacity: .72; }
  .ert-rate-val { justify-self: start; font: 700 21px 'Space Grotesk', sans-serif; color: var(--brass-bright); font-variant-numeric: tabular-nums; line-height: 1; white-space: nowrap; }
  .ert-rate-val small { font-size: 12.5px; color: var(--text-dim); font-weight: 500; }
  .ert-rate-val.empty { color: var(--text-dim); }
  .ert-clear { justify-self: end; }
  @media (max-width: 640px) { .ert-rate { grid-template-columns: 70px 62px minmax(0, 1fr) 40px; column-gap: 10px; } }
  .ert-step { width: 31px; height: 31px; border-radius: 50%; background: var(--surface-raised); display: flex; align-items: center; justify-content: center; border: 0; color: inherit; cursor: pointer; }
  .ert-step:hover { background: var(--step-hover); }
  .ert-clear { color: var(--text-dim); font-size: 13px; text-decoration: underline; text-underline-offset: 3px; padding: 4px; background: none; border: 0; cursor: pointer; }
  .ert-clear:hover { color: var(--text); }
  .ert-note { display: grid; grid-template-columns: 1fr auto; gap: 2px 17px; padding: 15px 0; border-bottom: 1px solid var(--border-soft); }
  .ert-note b { font-weight: 600; }
  .ert-note.me b { color: var(--brass-bright); }
  .ert-note .n { font: 700 16px 'Space Grotesk', sans-serif; color: var(--brass-bright); font-variant-numeric: tabular-nums; display: flex; align-items: center; gap: 10px; }
  .ert-note p { grid-column: 1 / -1; margin: 2px 0 0; max-width: 68ch; white-space: pre-wrap; line-height: 1.55; }
  .ert-note .full { grid-column: 1 / -1; }
  .ert-unplayed { padding: 34px 28px; border: 1.5px dashed var(--border); border-radius: 15px; text-align: center; margin-bottom: 36px; }
  .ert-unplayed h3 { margin: 0 0 6px; font: 600 19px 'Space Grotesk', sans-serif; }
  .ert-unplayed p { margin: 0 0 17px; color: var(--text-dim); }

  .ert-split { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 72px; align-items: start; }
  .ert-sidehead { display: flex; align-items: baseline; justify-content: space-between; padding: 26px 0 9px; border-bottom: 1px solid var(--border); }
  .ert-sidehead b { font: 700 19px 'Space Grotesk', sans-serif; }

  /* trip detail, gallery, settings */
  .ert-aside-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 20px 28px; margin-top: 26px; padding-top: 24px; border-top: 1px solid var(--border-soft); }
  .ert-aside-stats b { display: block; font: 700 30px/1.1 'Space Grotesk', sans-serif; font-variant-numeric: tabular-nums; }
  .ert-aside-stats span { color: var(--text-dim); font-size: 13.5px; }
  .ert-hint { margin: -6px 0 12px; color: var(--text-dim); font-size: 13px; max-width: 62ch; }
  .ert-frow { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border-soft); }
  .ert-step[disabled] { opacity: .3; cursor: default; }
  .ert-step[disabled]:hover { background: var(--surface-raised); }
  .ert-srow { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 10px 0; border-bottom: 1px solid var(--border-soft); }
  .ert-ibtn.sm { width: 34px; height: 34px; }
  .ert-modal-bg { position: fixed; inset: 0; background: rgba(10,11,15,.72); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .ert-modal { width: 100%; max-width: 480px; max-height: 80vh; display: flex; flex-direction: column; padding: 20px 22px 12px; box-shadow: 0 20px 60px rgba(0,0,0,.55); border-radius: 16px; }
  .ert-pgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 18px 16px; margin-top: 16px; }
  .ert-photo-x { position: absolute; top: 8px; right: 8px; min-width: 26px; height: 26px; padding: 0; border-radius: 13px; background: rgba(20,22,28,.78); border: 1px solid rgba(255,255,255,.16); color: #fff; display: flex; align-items: center; justify-content: center; gap: 5px; cursor: pointer; font-size: 12px; font-weight: 600; font-family: inherit; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
  .ert-photo-x:hover, .ert-photo-x.armed { background: var(--danger); border-color: var(--danger); }
  .ert-photo-x.armed { padding: 0 11px 0 8px; }
  .ert-pick { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--border-soft); background: var(--surface); display: flex; align-items: center; justify-content: center; color: var(--text); cursor: pointer; padding: 0; }
  .ert-pick:hover { border-color: var(--border); }
  .ert-pick[aria-pressed=true] { border-color: var(--brass); background: var(--brass-wash); color: var(--brass-bright); }
  .ert-swatch { width: 26px; height: 26px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; }
  .ert-swatch[aria-pressed=true] { border-color: var(--text); box-shadow: inset 0 0 0 2px var(--bg); }

  /* overview row icons, and the row you came back from */
  .ert-rside { display: flex; align-items: center; justify-content: flex-end; gap: 16px; }
  .ert-rowicons { display: flex; align-items: center; gap: 9px; color: var(--text-dim); }
  .ert-lrow.ert-last { background: var(--surface); box-shadow: -12px 0 0 var(--surface), 12px 0 0 var(--surface); }
  .ert-lrow.ert-last .ert-rkcell .sc { opacity: 0; }
  .ert-lrow.ert-last .ert-rkcell .pos { opacity: 1; }

  /* settings switch rows */
  .ert-swrow { display: flex; align-items: center; justify-content: space-between; gap: 20px; width: 100%; padding: 16px 0; border: 0; border-bottom: 1px solid var(--border-soft); background: none; color: var(--text); text-align: left; cursor: pointer; font-family: inherit; }
  .ert-gsrow { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 16px 0; border-bottom: 1px solid var(--border-soft); }
  .ert-gsrow b { display: block; font-size: 15px; font-weight: 600; }
  .ert-gsrow small { display: block; margin-top: 4px; max-width: 58ch; color: var(--text-dim); font-size: 13px; line-height: 1.5; }
  .ert-gsrow > :last-child { flex: none; }
  @media (max-width: 640px) { .ert-gsrow { flex-direction: column; align-items: stretch; } .ert-gsrow > :last-child { width: 100% !important; } }
  .ert-swrow b { display: block; font-size: 15px; font-weight: 600; }
  .ert-swrow small { display: block; margin-top: 4px; max-width: 58ch; color: var(--text-dim); font-size: 13px; line-height: 1.5; }
  .ert-sw { flex: none; width: 44px; height: 26px; border-radius: 13px; background: var(--border); position: relative; transition: background .15s; }
  .ert-sw i { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform .15s; }
  .ert-swrow[aria-checked=true] .ert-sw { background: var(--brass); }
  .ert-swrow[aria-checked=true] .ert-sw i { transform: translateX(18px); }
  .ert-swrow:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; }

  /* toolbar count + filter chips and menus */
  .ert-count { margin-left: auto; flex-shrink: 0; color: var(--text-dim); font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ert-chips { display: flex; flex-wrap: wrap; gap: 7px; }
  .ert-chip { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 15px; background: var(--surface); border: 1px solid var(--border-soft); color: var(--text); font-size: 13px; cursor: pointer; font-family: inherit; }
  .ert-chip:hover { border-color: var(--border); }
  .ert-chip[aria-pressed=true] { background: var(--brass-wash); border-color: var(--brass); color: var(--brass-bright); }
  .ert-pop-h { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; font: 600 16px 'Space Grotesk', sans-serif; }
  .ert-fsec { margin-bottom: 16px; }
  .ert-flabel { font-size: 12.5px; color: var(--text-dim); margin: 0 0 8px; }
  .ert-fbadge { background: var(--brass); color: var(--on-brass); border-radius: 9px; font-size: 12px; font-weight: 700; padding: 0 7px; line-height: 18px; }
  .ert-menu-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; padding: 8px 10px; border-radius: 8px; border: 0; background: none; color: var(--text); font-size: 14px; cursor: pointer; text-align: left; }
  .ert-menu-item:hover { background: var(--surface); }
  .ert-menu-item[aria-checked=true] { color: var(--brass-bright); font-weight: 600; }

  /* sub-tabs inside a screen (App settings) */
  .ert-tab { display: flex; align-items: center; gap: 7px; padding: 8px 13px; border-radius: 9px; font-size: 13.5px; font-weight: 600; color: var(--text-dim); cursor: pointer; white-space: nowrap; }
  .ert-tab:hover { color: var(--text); }
  .ert-tab-active, .ert-tab-active:hover { color: var(--text); background: var(--surface-raised); box-shadow: inset 0 0 0 1px var(--border); }

  @keyframes ert-fade-in { from { opacity: 0; } to { opacity: 1; } }
  .ert-fade-in { animation: ert-fade-in 0.2s ease-out; }
  @keyframes ert-slide-from-right { from { opacity: 0; transform: translateX(36px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes ert-slide-from-left { from { opacity: 0; transform: translateX(-36px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes ert-photo-fade { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
  .ert-slide-next { animation: ert-slide-from-right 0.24s ease-out; }
  .ert-slide-prev { animation: ert-slide-from-left 0.24s ease-out; }
  .ert-slide-fade { animation: ert-photo-fade 0.18s ease-out; }

  @media (prefers-reduced-motion: reduce) { .ert-strip, .ert-fade-in, .ert-rkcell .sc, .ert-rkcell .pos { transition: none; animation: none; } }
  @media (max-width: 1180px) {
    .ert-room { grid-template-columns: 1fr; gap: 31px; }
    .ert-room-aside { position: static !important; }
    .ert-stats > div, .ert-stats > button { padding: 2px 19px; min-width: 0; }
    .ert-hero { gap: 31px; flex-wrap: wrap; row-gap: 24px; }
    .ert-brand span { display: none; }
    .ert-ttab { padding: 0 10px; }
    .ert-cols { gap: 34px; }
  }
  @media (max-width: 1040px) {
    .ert-split { grid-template-columns: minmax(0, 1fr); gap: 28px; }
    .ert-ttab .lbl { display: none; }
    .ert-ttab { padding: 0 12px; }
  }
  @media (max-width: 860px) {
    .ert-main { padding: 21px 17px 69px; }
    .ert-hero { flex-wrap: wrap; }
    .ert-stats { margin-left: 0; }
    .ert-cols { grid-template-columns: 1fr; }
    .ert-topbar { padding: 0 10px; overflow-x: auto; }
    .ert-ph h1 { font-size: 25px; }
  }
`;
 
/* ---------------------------------------------------------------
   HELPERS
--------------------------------------------------------------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const STORAGE_KEY = "escape-room-club-data-v1";
const MEMBER_KEY = "escape-room-club-current-member";
// Per-device switch read by index.html / mobile.html to open the previous version of the app.
const LEGACY_MODE_KEY = "escape-room-club-legacy-mode";
function readLegacyMode() {
  try { return window.localStorage.getItem(LEGACY_MODE_KEY) === "1"; } catch (e) { return false; }
}
function writeLegacyMode(on) {
  try {
    if (on) window.localStorage.setItem(LEGACY_MODE_KEY, "1");
    else window.localStorage.removeItem(LEGACY_MODE_KEY);
  } catch (e) { /* storage blocked: the switch simply won't stick */ }
}
// Per-device appearance and date settings (App settings > General).
const THEME_KEY = "escape-room-club-theme";
const DATE_FORMAT_KEY = "escape-room-club-date-format";
const DEFAULT_CREW_NAME = "The Escape Log";
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATE_FORMATS = [
  { id: "auto", label: "Automatic (browser setting)" },
  { id: "mdy-text", label: "Oct 7, 2026" },
  { id: "dmy-text", label: "7 Oct 2026" },
  { id: "dmy-dots", label: "07.10.2026" },
  { id: "dmy-slash", label: "07/10/2026" },
  { id: "mdy-slash", label: "10/07/2026" },
  { id: "iso", label: "2026-10-07" },
];
// fmtDate is a plain helper used all over the app, so the chosen format lives here and the
// root component re-renders everything when it changes.
let activeDateFormat = "auto";
function formatDateAs(d, fmt) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  switch (fmt) {
    case "mdy-text": return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${yyyy}`;
    case "dmy-text": return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${yyyy}`;
    case "dmy-dots": return `${dd}.${mm}.${yyyy}`;
    case "dmy-slash": return `${dd}/${mm}/${yyyy}`;
    case "mdy-slash": return `${mm}/${dd}/${yyyy}`;
    case "iso": return `${yyyy}-${mm}-${dd}`;
    default: return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
}
const MEMBERS = ["Karol", "Asia", "Jano", "Jaćka"];
const GUEST_NAME = "Guest"; // read-only visitor: no password, can browse/filter/search/sort but never writes data
 
const DEFAULT_CATEGORIES = ["Horror", "Thriller", "Adventure", "Mystery/Detective", "Sci-Fi", "Historical", "Fantasy", "Comedy", "Other"];
const DIFFICULTY_LEVELS = ["Beginner-friendly", "Easy", "Medium", "Hard", "Very hard", "Extreme"];

// Small fixed set of status flags a room can carry, each with its own
// pictogram shown on the room card next to the photo indicator.
// Default flags, stored using icon *names* (strings) rather than component
// references, so the set can be edited from Settings and saved as plain
// data. Any lucide-react icon name works -- resolveFlagIcon() looks it up.
const DEFAULT_FLAGS = [
  { id: "closed", label: "Permanently closed", icon: "Ban", color: "var(--danger)" },
  { id: "moved", label: "Moved", icon: "CornerUpRight", color: "var(--teal)" },
  { id: "separately", label: "Visited separately", icon: "Split", color: "var(--brass)" },
];

// A curated set of icons offered in the Settings picker -- broad enough to
// cover common flag ideas without listing lucide's entire (huge) icon set.
const FLAG_ICON_CHOICES = [
  "Ban", "CornerUpRight", "AlertTriangle", "Flag", "Star", "Heart", "ThumbsUp",
  "ThumbsDown", "Flame", "Snowflake", "Sun", "Moon", "Clock", "Wrench",
  "Construction", "PartyPopper", "Sparkles", "Zap", "Trophy", "Building2",
  "MapPin", "Lock", "Unlock", "Check", "X", "Info", "Users", "Drama",
  "Split", "Divide", "Shuffle", "Waypoints",
];
const FLAG_COLOR_CHOICES = [
  { label: "Red", value: "var(--danger)" },
  { label: "Teal", value: "var(--teal)" },
  { label: "Brass", value: "var(--brass)" },
  { label: "Green", value: "var(--success)" },
  { label: "Gray", value: "var(--text-dim)" },
  { label: "Purple", value: "#a78bfa" },
  { label: "Pink", value: "#f472b6" },
  { label: "Orange", value: "#fb923c" },
  { label: "Blue", value: "#60a5fa" },
];

function resolveFlagIcon(name) {
  return (LucideIcons && LucideIcons[name]) || LucideIcons.Flag;
}
 
function emptyRoom(addedBy) {
  return {
    id: uid(),
    name: "",
    venue: "",
    city: "",
    country: "Polska",
    category: "Adventure",
    difficulty: "Medium",
    lockmeUrl: "",
    status: "wishlist", // 'wishlist' | 'played'
    flags: [], // e.g. "closed", "moved" -- see DEFAULT_FLAGS
    participants: [...MEMBERS], // who actually played this room -- defaults to everyone
    datePlayed: "",
    result: "escaped", // 'escaped' | 'not-escaped'
    timeNote: "",
    price: "", // amount paid, as a string so the input can stay blank
    currency: "PLN",
    photos: [],
    ratings: {},
    difficultyRatings: {}, // personal 1-5 "how hard did this feel" per member
    scaryRatings: {}, // personal 1-5 "how scary was this" per member
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

function roomsFromCSV(text, addedBy, categories) {
  const validCategories = categories && categories.length ? categories : DEFAULT_CATEGORIES;
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
      room.country = get(row, "country") || "Polska";
      const category = get(row, "category");
      room.category = validCategories.includes(category) ? category : "Other";
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

// Backfills any fields missing from previously-saved data (e.g. accounts
// that saved before "trips" existed) so the rest of the app never has to
// null-check the shared data shape.
function normalizeData(raw) {
  const safe = raw && typeof raw === "object" ? raw : {};
  return {
    rooms: Array.isArray(safe.rooms) ? safe.rooms : [],
    auth: safe.auth && typeof safe.auth === "object" ? safe.auth : {},
    driveAuth: safe.driveAuth || null,
    trips: Array.isArray(safe.trips) ? safe.trips : [],
    categories: Array.isArray(safe.categories) && safe.categories.length ? [...safe.categories].sort((a, b) => a.localeCompare(b, "pl")) : [...DEFAULT_CATEGORIES].sort((a, b) => a.localeCompare(b, "pl")),
    flags: Array.isArray(safe.flags) && safe.flags.length ? safe.flags : DEFAULT_FLAGS,
    crewName: typeof safe.crewName === "string" ? safe.crewName.trim().slice(0, 40) : "",
  };
}

function emptyTrip(createdBy) {
  return {
    id: uid(),
    name: "",
    city: "",
    startDate: "",
    endDate: "",
    roomIds: [],
    notes: "",
    votes: {}, // { [memberName]: [roomId, roomId, ...] } favorite-to-least-favorite order
    createdBy: createdBy || null,
    createdAt: Date.now(),
  };
}

function tripStats(trip, rooms) {
  const included = rooms.filter((r) => trip.roomIds.includes(r.id));
  const ratedAvgs = included.map(avgRating).filter((v) => v !== null);
  const avg = ratedAvgs.length ? ratedAvgs.reduce((a, b) => a + b, 0) / ratedAvgs.length : null;
  const escaped = included.filter((r) => r.result === "escaped").length;
  const priced = included.filter((r) => r.price !== "" && r.price !== undefined && r.price !== null && !isNaN(parseFloat(r.price)));
  const totalSpent = priced.length ? priced.reduce((sum, r) => sum + parseFloat(r.price), 0) : null;
  const spentCurrency = priced.length ? (priced[0].currency || "PLN") : null;
  return {
    rooms: included,
    count: included.length,
    avg,
    escapeRate: included.length ? Math.round((escaped / included.length) * 100) : null,
    totalSpent,
    spentCurrency,
  };
}

// Reconciles a saved favorite-order against the trip's current room list:
// keeps the existing order for rooms still on the trip, and appends any
// rooms added since (or not yet ranked) at the end.
function reconcileRanking(savedOrder, tripRoomIds) {
  const valid = (savedOrder || []).filter((id) => tripRoomIds.includes(id));
  const missing = tripRoomIds.filter((id) => !valid.includes(id));
  return [...valid, ...missing];
}

// Combines every crew member's personal favorite-to-least-favorite order
// into one group ranking, by averaging each room's rank position across
// whoever has ranked it. Lower average rank = more favored.
function groupFavoritesForTrip(trip, tripRooms) {
  const votes = trip.votes || {};
  const tripRoomIds = tripRooms.map((r) => r.id);
  const rankSums = {};
  const rankCounts = {};
  Object.values(votes).forEach((order) => {
    if (!Array.isArray(order)) return;
    const valid = order.filter((id) => tripRoomIds.includes(id));
    valid.forEach((roomId, idx) => {
      rankSums[roomId] = (rankSums[roomId] || 0) + (idx + 1);
      rankCounts[roomId] = (rankCounts[roomId] || 0) + 1;
    });
  });
  return tripRooms
    .map((room) => ({
      room,
      avgRank: rankCounts[room.id] ? rankSums[room.id] / rankCounts[room.id] : null,
      voters: rankCounts[room.id] || 0,
    }))
    .filter((entry) => entry.avgRank !== null)
    .sort((a, b) => a.avgRank - b.avgRank);
}

function avgRating(room) {
  const vals = Object.values(room.ratings || {}).filter((v) => typeof v === "number");
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// Tie-breaker for "best first" ordering, used everywhere rooms are ranked.
// When the main score is equal (group average, or your own rating on the
// personal ranking) it falls through, in order, to:
//   1. group average (only matters on the personal ranking)
//   2. the lowest single rating -- a room nobody scored badly beats one with a dud
//   3. how many people rated it -- more votes is a more trustworthy score
//   4. the highest single rating
//   5. the more recently played room
//   6. name, so the order never jumps around between loads
// Unrated rooms (null) always sort below rated ones. Reverse the result for "worst first".
function ratingValues(room) {
  return Object.values((room && room.ratings) || {}).filter((v) => typeof v === "number");
}
function compareRoomsBest(a, b, primary = avgRating) {
  const pa = primary(a) ?? -1;
  const pb = primary(b) ?? -1;
  if (pa !== pb) return pb - pa;
  if (primary !== avgRating) {
    const ga = avgRating(a) ?? -1;
    const gb = avgRating(b) ?? -1;
    if (ga !== gb) return gb - ga;
  }
  const va = ratingValues(a);
  const vb = ratingValues(b);
  const minA = va.length ? Math.min(...va) : -1;
  const minB = vb.length ? Math.min(...vb) : -1;
  if (minA !== minB) return minB - minA;
  if (va.length !== vb.length) return vb.length - va.length;
  const maxA = va.length ? Math.max(...va) : -1;
  const maxB = vb.length ? Math.max(...vb) : -1;
  if (maxA !== maxB) return maxB - maxA;
  const d = String(b.datePlayed || "").localeCompare(String(a.datePlayed || ""));
  if (d) return d;
  return String(a.name || "").localeCompare(String(b.name || ""), "pl");
}

// Position numbers for an already-sorted list where equal scores share a
// position and the next one skips ahead (1, 1, 3, 4, 4, 6 ...). "Equal" means
// the score as displayed (one decimal), so two rooms that both read 9.3 never
// get different positions.
function tiedPositions(values) {
  const key = (v) => (v === null || v === undefined ? "-" : v.toFixed(2));
  const pos = [];
  values.forEach((v, i) => { pos.push(i > 0 && key(v) === key(values[i - 1]) ? pos[i - 1] : i + 1); });
  return pos;
}

// Generic version for other per-member rating maps (difficulty, scariness)
// that don't affect the main star rating above.
function avgOfMap(map) {
  const vals = Object.values(map || {}).filter((v) => typeof v === "number");
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// Rooms saved before "who played" existed have no participants field --
// treat those as "everyone played" rather than "no one played".
function roomParticipants(room) {
  return room.participants && room.participants.length ? room.participants : MEMBERS;
}

// Orange pictogram shown on a room's row/card when not everyone in the crew
// played it. Derived from the "who played" list, so there is nothing to flag by hand.
const PARTIAL_GROUP_COLOR = "#fb923c";
function missingPlayers(room) {
  if (!room || room.status !== "played" || !room.participants || !room.participants.length) return [];
  return MEMBERS.filter((m) => !room.participants.includes(m));
}
function PartialGroupIcon({ room, size = 16 }) {
  const missing = missingPlayers(room);
  if (!missing.length) return null;
  const Icon = LucideIcons.UserMinus || LucideIcons.Users;
  const label = `Not everyone played (missing: ${missing.join(", ")})`;
  return <span role="img" aria-label={label} title={label} style={{ display: "inline-flex" }}><Icon size={size} color={PARTIAL_GROUP_COLOR} /></span>;
}
 
function fmtRating(n) {
  return n === null || n === undefined ? "-" : n.toFixed(1);
}
// Group averages are shown to two decimals so close rooms don't look tied.
function fmtAvg(n) {
  return n === null || n === undefined ? "-" : n.toFixed(2);
}
 
/* ---------------------------------------------------------------
   MAIN APP
--------------------------------------------------------------- */
export default function EscapeRoomTracker() {
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(null);
  const [importMessage, setImportMessage] = useState(null);
  const [data, setData] = useState({ rooms: [], auth: {}, driveAuth: null, trips: [], categories: DEFAULT_CATEGORIES, flags: DEFAULT_FLAGS });
  const [currentMember, setCurrentMember] = useState(null);
  const isGuest = currentMember === GUEST_NAME;
  const [view, setViewRaw] = useState("dashboard");
  // Scroll memory. Opening something starts it at the top; pressing Back puts the page you came
  // from back exactly where you left it. The position is recorded at the moment you leave.
  const viewRef = React.useRef(view);
  const scrollMemory = React.useRef({});
  const pendingScroll = React.useRef(0);
  const setView = useCallback((next, opts) => {
    scrollMemory.current[viewRef.current] = window.scrollY;
    pendingScroll.current = opts && opts.back ? scrollMemory.current[next] || 0 : 0;
    setViewRaw(next);
  }, []);
  React.useLayoutEffect(() => {
    viewRef.current = view;
    window.scrollTo(0, pendingScroll.current);
  }, [view]);
  const [rankOpenedId, setRankOpenedId] = useState(null); // the Ranking row to highlight when you come back
  const [navMode, setNavMode] = useState("top"); // "top" (default) or "side"; remembered per device
  const [theme, setThemeState] = useState("dark"); // "dark" (default) or "light"; remembered per device
  const [dateFormat, setDateFormatState] = useState("auto"); // remembered per device
  activeDateFormat = dateFormat; // read by fmtDate during this render

  // Guests can browse/filter everything but never reach a mutation-only
  // view, even if some other path tried to send them there.
  useEffect(() => {
    if (isGuest && (view === "edit-room" || view === "edit-trip" || view === "app-settings")) {
      setView("dashboard");
    }
  }, [isGuest, view]);

  // Filter/sort state per browsable tab, kept here (not inside the view
  // components) so it survives navigating into a room/trip and back --
  // those views unmount and remount, which would otherwise reset it.
  const [roomsFilters, setRoomsFilters] = useState(() => defaultRoomFilters(false));
  const [wishlistFilters, setWishlistFilters] = useState(() => defaultRoomFilters(true));
  const [tripsFilters, setTripsFilters] = useState(() => defaultTripFilters());
  const [galleryFilters, setGalleryFilters] = useState(() => defaultGalleryFilters());
  const [rankingMode, setRankingMode] = useState("group"); // "group" | "personal"
  const [rankingFilters, setRankingFilters] = useState(() => defaultRankingFilters());

  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [returnView, setReturnView] = useState("rooms");
  const [editingRoom, setEditingRoom] = useState(null); // room object being added/edited, or null
  const [selectedTripId, setSelectedTripId] = useState(null);
  const [editingTrip, setEditingTrip] = useState(null); // trip object being added/edited, or null
 
  // ---- load ----
  useEffect(() => {
    let unsubscribeFirestore = null;
 
    // Shared room/rating data: Claude storage inside Claude, live
    // Firestore sync everywhere else.
    if (hasClaudeStorage) {
      (async () => {
        try {
          let loaded = { rooms: [], auth: {}, driveAuth: null, trips: [], categories: DEFAULT_CATEGORIES, flags: DEFAULT_FLAGS };
          try {
            const res = await storageGet(STORAGE_KEY, true);
            if (res && res.value) loaded = JSON.parse(res.value);
          } catch (e) {
            // key doesn't exist yet, fine, use default
          }
          setData(normalizeData(loaded));
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
              setData(normalizeData(snap.exists() ? snap.data() : null));
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
 
    // Personal, per-device value. Always local, regardless of backend.
    (async () => {
      try {
        const memberRes = await storageGet(MEMBER_KEY, false);
        if (memberRes && memberRes.value) setCurrentMember(memberRes.value);
      } catch (e) {
        // no member selected yet on this device
      }
    })();
 
    (async () => {
      try {
        const themeRes = await storageGet(THEME_KEY, false);
        if (themeRes && (themeRes.value === "light" || themeRes.value === "dark")) setThemeState(themeRes.value);
        const dfRes = await storageGet(DATE_FORMAT_KEY, false);
        if (dfRes && DATE_FORMATS.some((f) => f.id === dfRes.value)) setDateFormatState(dfRes.value);
      } catch (e) {
        // defaults
      }
    })();

    (async () => {
      try {
        const navRes = await storageGet(NAV_MODE_KEY, false);
        if (navRes && (navRes.value === "side" || navRes.value === "top")) setNavMode(navRes.value);
      } catch (e) {
        // no preference saved yet: stay on the top bar
      }
    })();

    return () => {
      if (unsubscribeFirestore) unsubscribeFirestore();
    };
  }, []);
 
  const persist = useCallback(async (next) => {
    if (currentMember === GUEST_NAME) return; // hard backstop: guests never write, no matter what called this
    setData(next);
    try {
      if (hasClaudeStorage) {
        const res = await storageSet(STORAGE_KEY, JSON.stringify(next), true);
        if (!res) setSaveError("Save failed. Your last change may not be stored.");
        else setSaveError(null);
      } else {
        const { setDoc, ref } = await getFirebaseHandle();
        await setDoc(ref, next);
        setSaveError(null);
      }
    } catch (e) {
      setSaveError("Save failed. Your last change may not be stored.");
    }
  }, [currentMember]);
 
  const chooseMember = async (name) => {
    setCurrentMember(name);
    try {
      await storageSet(MEMBER_KEY, name, false);
    } catch (e) {
      /* non-fatal */
    }
  };
  const setTheme = async (next) => {
    setThemeState(next);
    try { await storageSet(THEME_KEY, next, false); } catch (e) { /* non-fatal */ }
  };
  const setDateFormat = async (next) => {
    setDateFormatState(next);
    try { await storageSet(DATE_FORMAT_KEY, next, false); } catch (e) { /* non-fatal */ }
  };
  const crewName = (data.crewName || "").trim() || DEFAULT_CREW_NAME;
  const changeCrewName = (name) => {
    const next = (name || "").trim().slice(0, 40);
    if (next === (data.crewName || "")) return;
    persist({ ...data, crewName: next });
  };
  // Browser tab title and the color of the page behind the app follow the settings.
  useEffect(() => {
    try { document.title = crewName; } catch (e) { /* no document */ }
  }, [crewName]);
  useEffect(() => {
    try {
      const bg = theme === "light" ? "#e4dfd3" : "#14161c";
      document.documentElement.style.background = bg;
      document.body.style.background = bg;
      document.documentElement.style.colorScheme = theme;
    } catch (e) { /* no document */ }
  }, [theme]);
  const toggleNav = async () => {
    const next = navMode === "top" ? "side" : "top";
    setNavMode(next);
    try {
      await storageSet(NAV_MODE_KEY, next, false);
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
          setDriveMessage({ type: "success", text: "Google Drive connected. Photos will now upload there." });
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
 
  const searchByVenue = (venue, status) => {
    if (status === "played") {
      setRoomsFilters({ ...defaultRoomFilters(false), search: venue });
      setView("rooms");
    } else {
      setWishlistFilters({ ...defaultRoomFilters(true), search: venue });
      setView("wishlist");
    }
    setSelectedRoomId(null);
  };
  const filterByCity = (city, status) => {
    if (status === "played") {
      setRoomsFilters({ ...defaultRoomFilters(false), selectedCities: [city] });
      setView("rooms");
    } else {
      setWishlistFilters({ ...defaultRoomFilters(true), selectedCities: [city] });
      setView("wishlist");
    }
    setSelectedRoomId(null);
  };
  const filterByCountry = (country, status) => {
    if (status === "played") {
      setRoomsFilters({ ...defaultRoomFilters(false), selectedCountries: [country] });
      setView("rooms");
    } else {
      setWishlistFilters({ ...defaultRoomFilters(true), selectedCountries: [country] });
      setView("wishlist");
    }
    setSelectedRoomId(null);
  };
  const saveRoom = (room) => {
    const existing = data.rooms.find((r) => r.id === room.id);
    const exists = !!existing;
    // Moving a room back to the wishlist clears the played-specific data
    // that no longer applies once it's not "done" anymore.
    const movedToWishlist = existing && existing.status === "played" && room.status === "wishlist";
    const roomToSave = movedToWishlist
      ? { ...room, datePlayed: "", result: "escaped", timeNote: "", price: "", currency: "PLN", ratings: {}, flags: [] }
      : room;
    const rooms = exists ? data.rooms.map((r) => (r.id === room.id ? roomToSave : r)) : [roomToSave, ...data.rooms];
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

  const saveTrip = (trip) => {
    const exists = data.trips.some((t) => t.id === trip.id);
    const trips = exists ? data.trips.map((t) => (t.id === trip.id ? trip : t)) : [trip, ...data.trips];
    persist({ ...data, trips });
    setEditingTrip(null);
    setView("trip-detail");
    setSelectedTripId(trip.id);
  };
  const deleteTrip = (id) => {
    persist({ ...data, trips: data.trips.filter((t) => t.id !== id) });
    setView("trips");
    setSelectedTripId(null);
  };
  const updateTripField = (id, patch) => {
    const trips = data.trips.map((t) => (t.id === id ? { ...t, ...patch } : t));
    persist({ ...data, trips });
  };

  const addCategory = (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const current = data.categories && data.categories.length ? data.categories : DEFAULT_CATEGORIES;
    if (current.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return;
    const categories = [...current, trimmed].sort((a, b) => a.localeCompare(b, "pl"));
    persist({ ...data, categories });
  };
  const removeCategory = (name) => {
    const current = data.categories && data.categories.length ? data.categories : DEFAULT_CATEGORIES;
    persist({ ...data, categories: current.filter((c) => c !== name) });
  };
  const renameCategory = (oldName, newName) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    const current = data.categories && data.categories.length ? data.categories : DEFAULT_CATEGORIES;
    if (current.some((c) => c !== oldName && c.toLowerCase() === trimmed.toLowerCase())) return;
    const categories = current.map((c) => (c === oldName ? trimmed : c)).sort((a, b) => a.localeCompare(b, "pl"));
    const rooms = data.rooms.map((r) => (r.category === oldName ? { ...r, category: trimmed } : r));
    persist({ ...data, categories, rooms });
  };

  const currentFlags = () => (data.flags && data.flags.length ? data.flags : DEFAULT_FLAGS);
  const addFlag = ({ label, icon, color }) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const id = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || uid();
    const flags = [...currentFlags(), { id, label: trimmed, icon, color }];
    persist({ ...data, flags });
  };
  const updateFlag = (id, patch) => {
    const flags = currentFlags().map((f) => (f.id === id ? { ...f, ...patch } : f));
    persist({ ...data, flags });
  };
  const removeFlag = (id) => {
    const flags = currentFlags().filter((f) => f.id !== id);
    const rooms = data.rooms.map((r) => (r.flags && r.flags.includes(id) ? { ...r, flags: r.flags.filter((x) => x !== id) } : r));
    persist({ ...data, flags, rooms });
  };
 
  const importRoomsFromFile = async (file) => {
    try {
      const text = await file.text();
      const parsed = roomsFromCSV(text, currentMember, data.categories);
      if (!parsed.length) {
        setImportMessage({ type: "error", text: "No rooms found in that file. Make sure it has a 'name' column." });
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
      setImportMessage({ type: "error", text: "Couldn't read that file. Make sure it's a CSV in the format this app exports." });
    }
    setTimeout(() => setImportMessage(null), 6000);
  };
 
  const selectedRoom = useMemo(
    () => data.rooms.find((r) => r.id === selectedRoomId) || null,
    [data.rooms, selectedRoomId]
  );
 
  const playedRooms = useMemo(() => data.rooms.filter((r) => r.status === "played"), [data.rooms]);
  const wishlistRooms = useMemo(() => data.rooms.filter((r) => r.status === "wishlist"), [data.rooms]);
  const selectedTrip = useMemo(
    () => data.trips.find((t) => t.id === selectedTripId) || null,
    [data.trips, selectedTripId]
  );
 
  if (loading) {
    return (
      <div className="ert-root" data-theme={theme} style={{ minHeight: 480, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{TOKENS}</style>
        <div className="ert-mono" style={{ color: "var(--text-dim)", fontSize: 13 }}>opening the door…</div>
      </div>
    );
  }
 
  // ---- device hasn't picked "who am I" ----
  if (!currentMember || (!MEMBERS.includes(currentMember) && currentMember !== GUEST_NAME)) {
    return (
      <WhoAmI
        members={MEMBERS}
        authRecords={data.auth}
        onChoose={chooseMember}
        onCreatePassword={createPassword}
        onVerifyPassword={verifyPassword}
        theme={theme}
      />
    );
  }
 
  const activeTab = activeTabFor(view, returnView);
  const goTab = (v) => {
    setView(v);
    setSelectedRoomId(null);
    setEditingRoom(null);
    setSelectedTripId(null);
    setEditingTrip(null);
    // Deliberately switching tabs (as opposed to opening a room/trip
    // and hitting Back) starts each tab fresh rather than carrying
    // over whatever was filtered/sorted last time.
    setRoomsFilters(defaultRoomFilters(false));
    setWishlistFilters(defaultRoomFilters(true));
    setTripsFilters(defaultTripFilters());
    setGalleryFilters(defaultGalleryFilters());
    setRankingFilters(defaultRankingFilters());
    setRankingMode("group");
    setRankOpenedId(null);
  };
  const goSegment = (seg) => goTab(seg === "wishlist" ? "wishlist" : "rooms");
  const addRoom = () => { setEditingRoom(emptyRoom(currentMember)); setView("edit-room"); };
  const pageTitle =
    view === "dashboard" ? (navMode === "side" ? crewName : "Overview")
    : view === "rooms" || view === "wishlist" ? "Rooms"
    : view === "ranking" ? "Ranking"
    : view === "trips" ? "Trips"
    : view === "gallery" ? "Gallery"
    : view === "settings" ? "Crew"
    : null;
  const chromeProps = {
    activeTab,
    onNav: goTab,
    currentMember,
    isGuest,
    onSwitchMember: () => chooseMember(null),
    onOpenAppSettings: () => setView("app-settings"),
    onToggleNav: toggleNav,
    crewName,
  };

  return (
    <div className={`ert-root ert-app ert-nav-${navMode}`} data-theme={theme}>
      <style>{TOKENS}</style>

      {navMode === "side" && <SideRail {...chromeProps} />}

      <div className="ert-col">
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

      {isKnownInAppBrowser() && (
        <div style={{ background: "var(--danger)", color: "#fff", fontSize: 12.5, padding: "6px 20px" }}>
          This looks like an in-app browser (e.g. Messenger, Instagram). These often block the storage this app needs, so changes may not save. Open this link in Safari or Chrome instead.
        </div>
      )}
 

        {navMode === "top" && <TopBar {...chromeProps} onAdd={addRoom} onImportFile={importRoomsFromFile} />}

        <main className="ert-main">
      <div className="ert-fade-in">
        {pageTitle && <PageHeader title={pageTitle} navMode={navMode} isGuest={isGuest} onAdd={addRoom} onImportFile={importRoomsFromFile} />}
        {view === "dashboard" && (
          <Dashboard rooms={data.rooms} members={MEMBERS} flags={currentFlags()} onOpenRoom={(id) => { setSelectedRoomId(id); setReturnView("dashboard"); setView("room-detail"); }} onOpenWishlist={() => goTab("wishlist")} />
        )}
 
        {(view === "rooms" || view === "wishlist") && (
          // One element for both sides, so the segment toggle keeps its place and its highlight can slide.
          <RoomsView
            key="rooms-and-wishlist"
            rooms={view === "wishlist" ? wishlistRooms : playedRooms}
            emptyLabel={view === "wishlist" ? "No rooms on the wishlist yet. Add one and mark it 'wishlist'." : undefined}
            onOpen={(id) => { setSelectedRoomId(id); setReturnView(view); setView("room-detail"); }}
            hideVisitedSort={view === "wishlist"}
            flags={currentFlags()}
            currentMember={view === "wishlist" ? undefined : currentMember}
            filters={view === "wishlist" ? wishlistFilters : roomsFilters}
            onFiltersChange={view === "wishlist" ? setWishlistFilters : setRoomsFilters}
            segment={view === "wishlist" ? "wishlist" : "completed"}
            counts={{ played: playedRooms.length, wishlist: wishlistRooms.length }}
            onSegment={goSegment}
          />
        )}

        {view === "ranking" && <RankingView rooms={playedRooms} members={MEMBERS} currentMember={currentMember} onOpen={(id) => { setRankOpenedId(id); setSelectedRoomId(id); setReturnView("ranking"); setView("room-detail"); }} highlightId={rankOpenedId} onClearHighlight={() => setRankOpenedId(null)} mode={rankingMode} onModeChange={setRankingMode} filters={rankingFilters} onFiltersChange={setRankingFilters} flags={currentFlags()} />}

        {view === "settings" && (
          <SettingsView members={MEMBERS} currentMember={currentMember} onChangePassword={changePassword} rooms={data.rooms} />
        )}

        {view === "app-settings" && (
          <AppSettingsView
            crewName={data.crewName || ""}
            onChangeCrewName={changeCrewName}
            dateFormat={dateFormat}
            onChangeDateFormat={setDateFormat}
            theme={theme}
            onChangeTheme={setTheme}
            categories={data.categories}
            onBack={() => setView("dashboard", { back: true })}
            onAddCategory={addCategory}
            onRemoveCategory={removeCategory}
            onRenameCategory={renameCategory}
            flags={data.flags && data.flags.length ? data.flags : DEFAULT_FLAGS}
            onAddFlag={addFlag}
            onUpdateFlag={updateFlag}
            onRemoveFlag={removeFlag}
            driveConnected={!hasClaudeStorage && !!(data.driveAuth && data.driveAuth.refreshToken)}
            driveAvailable={!hasClaudeStorage && isDriveConfigured()}
            onConnectDrive={connectGoogleDrive}
          />
        )}

        {view === "edit-room" && editingRoom && (
          <RoomForm
            room={editingRoom}
            existingRooms={data.rooms}
            categories={data.categories}
            flags={currentFlags()}
            onCancel={() => { setEditingRoom(null); setView(selectedRoom ? "room-detail" : "dashboard", { back: true }); }}
            onSave={saveRoom}
          />
        )}

        {view === "room-detail" && selectedRoom && (
          <RoomDetail
            room={selectedRoom}
            members={MEMBERS}
            currentMember={currentMember}
            isGuest={isGuest}
            onBack={() => { setView(returnView, { back: true }); setSelectedRoomId(null); }}
            onEdit={() => { setEditingRoom(selectedRoom); setView("edit-room"); }}
            onDelete={() => deleteRoom(selectedRoom.id)}
            onUpdate={(patch) => updateRoomField(selectedRoom.id, patch)}
            driveConnected={!hasClaudeStorage && !!(data.driveAuth && data.driveAuth.refreshToken)}
            driveAvailable={!hasClaudeStorage && isDriveConfigured()}
            getDriveAccessToken={getRoomsAccessToken}
            flags={currentFlags()}
            onSearchVenue={searchByVenue}
            onFilterCity={filterByCity}
            onFilterCountry={filterByCountry}
          />
        )}

        {view === "trips" && (
          <TripsView
            trips={data.trips}
            rooms={data.rooms}
            onOpen={(id) => { setSelectedTripId(id); setView("trip-detail"); }}
            onNew={() => { setEditingTrip(emptyTrip(currentMember)); setView("edit-trip"); }}
            isGuest={isGuest}
            filters={tripsFilters}
            onFiltersChange={setTripsFilters}
          />
        )}

        {view === "gallery" && (
          <GalleryView
            rooms={data.rooms}
            driveConnected={!hasClaudeStorage && !!(data.driveAuth && data.driveAuth.refreshToken)}
            driveAvailable={!hasClaudeStorage && isDriveConfigured()}
            getDriveAccessToken={getRoomsAccessToken}
            filters={galleryFilters}
            onFiltersChange={setGalleryFilters}
            flags={currentFlags()}
          />
        )}

        {view === "edit-trip" && editingTrip && (
          <TripForm
            trip={editingTrip}
            rooms={playedRooms}
            onCancel={() => { setEditingTrip(null); setView(selectedTrip ? "trip-detail" : "trips", { back: true }); }}
            onSave={saveTrip}
          />
        )}

        {view === "trip-detail" && selectedTrip && (
          <TripDetail
            trip={selectedTrip}
            rooms={data.rooms}
            currentMember={currentMember}
            isGuest={isGuest}
            onBack={() => { setView("trips", { back: true }); setSelectedTripId(null); }}
            onEdit={() => { setEditingTrip(selectedTrip); setView("edit-trip"); }}
            onDelete={() => deleteTrip(selectedTrip.id)}
            onUpdate={(patch) => updateTripField(selectedTrip.id, patch)}
            onOpenRoom={(id) => { setSelectedRoomId(id); setReturnView("trip-detail"); setView("room-detail"); }}
            flags={currentFlags()}
          />
        )}
      </div>
        </main>
      </div>
    </div>
  );
}
 
/* ---------------------------------------------------------------
   WHO AM I
--------------------------------------------------------------- */
function WhoAmI({ members, authRecords, onChoose, onCreatePassword, onVerifyPassword, theme }) {
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
      setError("Couldn't set the password. Try again.");
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
      setError("Couldn't check the password. Try again.");
    } finally {
      setBusy(false);
    }
  };
 
  if (selected) {
    const isNew = !hasPassword(selected);
    return (
      <div className="ert-root" data-theme={theme} style={{ minHeight: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
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
              ? "First time logging in as you. Pick a password you'll use each time."
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
    <div className="ert-root" data-theme={theme} style={{ minHeight: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{TOKENS}</style>
      <div className="ert-card" style={{ padding: 28, maxWidth: 380, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <Users size={20} color="var(--brass)" />
          <div className="ert-display" style={{ fontSize: 20, fontWeight: 700 }}>Who's playing?</div>
        </div>
        <p style={{ fontSize: 13.5, color: "var(--text-dim)", marginTop: 4, marginBottom: 18 }}>
          Pick your name. First time, you'll set a password; after that, you'll enter it each time.
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

        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border-soft)" }}>
          <button
            className="ert-btn ert-btn-ghost"
            style={{ justifyContent: "flex-start", width: "100%", color: "var(--text-dim)" }}
            onClick={() => onChoose(GUEST_NAME)}
          >
            <User size={14} /> Continue as guest (view only, no password)
          </button>
        </div>
      </div>
    </div>
  );
}
 
/* ---------------------------------------------------------------
   HEADER / NAV
--------------------------------------------------------------- */
/* ---------------------------------------------------------------
   NAVIGATION CHROME
   One set of destinations, two possible homes for it: a slim top bar
   (the default) or a vertical side rail. The choice is remembered on
   this device.
--------------------------------------------------------------- */
const NAV_TABS = [
  { id: "dashboard", label: "Overview", icon: Home },
  { id: "rooms", label: "Rooms", icon: DoorOpen },
  { id: "ranking", label: "Ranking", icon: Trophy },
  { id: "trips", label: "Trips", icon: Plane },
  { id: "gallery", label: "Gallery", icon: ImageIcon },
  { id: "settings", label: "Crew", icon: Users },
];
const NAV_MODE_KEY = "escape-room-club-nav-mode";

// Which tab should look selected for the current screen (detail and form screens belong to a tab).
function activeTabFor(view, returnView) {
  if (view === "dashboard") return "dashboard";
  if (view === "rooms" || view === "wishlist" || view === "edit-room") return "rooms";
  if (view === "ranking") return "ranking";
  if (view === "trips" || view === "trip-detail" || view === "edit-trip") return "trips";
  if (view === "gallery") return "gallery";
  if (view === "settings") return "settings";
  if (view === "room-detail") {
    if (returnView === "dashboard") return "dashboard";
    if (returnView === "ranking") return "ranking";
    if (returnView === "trip-detail") return "trips";
    return "rooms";
  }
  return null;
}

const initialOf = (name) => (name === GUEST_NAME ? "G" : (name || "?").slice(0, 1).toUpperCase());

function AddRoomButton({ onAdd, onImportFile }) {
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
    <div className="ert-addwrap" style={{ display: "flex", position: "relative" }} ref={menuRef}>
      <button className="ert-btn ert-btn-brass" onClick={onAdd} style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, height: 38 }}>
        <Plus size={17} /> Add room
      </button>
      <button
        className="ert-btn ert-btn-brass"
        onClick={() => setMenuOpen((v) => !v)}
        title="More ways to add rooms"
        aria-label="More ways to add rooms"
        style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: "1px solid rgba(0,0,0,0.2)", padding: "0 11px", height: 38 }}
      >
        <ChevronDown size={14} />
      </button>
      {menuOpen && (
        <div
          className="ert-card-raised"
          style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 230, zIndex: 30, padding: 6, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
        >
          <button className="ert-btn ert-btn-ghost" style={{ width: "100%", justifyContent: "flex-start", border: "none" }} onClick={triggerFilePicker}>
            <Upload size={14} /> Upload from file (CSV)
          </button>
        </div>
      )}
      <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={handleFileChange} />
    </div>
  );
}

function TopBar({ activeTab, onNav, currentMember, isGuest, onSwitchMember, onOpenAppSettings, onToggleNav, onAdd, onImportFile, crewName }) {
  return (
    <header className="ert-topbar">
      <div className="ert-brand"><Lock size={21} /><span>{crewName}</span></div>
      <nav className="ert-ttabs" aria-label="Main">
        {NAV_TABS.map((t) => (
          <button key={t.id} className="ert-ttab" aria-label={t.label} title={t.label} aria-current={activeTab === t.id ? "page" : undefined} onClick={() => onNav(t.id)}>
            <t.icon size={17} /><span className="lbl">{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="ert-tright">
        {!isGuest && <AddRoomButton onAdd={onAdd} onImportFile={onImportFile} />}
        <button className="ert-ibtn" title="Switch to the side rail" aria-label="Switch to the side rail" onClick={onToggleNav}><PanelLeft size={19} /></button>
        {!isGuest && <button className="ert-ibtn" title="App settings" aria-label="App settings" onClick={onOpenAppSettings}><SlidersHorizontal size={19} /></button>}
        <button className="ert-avatar" title={`Playing as ${currentMember}. Click to switch player`} aria-label={`Playing as ${currentMember}. Switch player`} onClick={onSwitchMember}>{initialOf(currentMember)}</button>
      </div>
    </header>
  );
}

function SideRail({ activeTab, onNav, currentMember, isGuest, onSwitchMember, onOpenAppSettings, onToggleNav, crewName }) {
  return (
    <aside className="ert-rail">
      <div className="ert-logo" title={crewName}><Lock size={26} /></div>
      <nav aria-label="Main">
        {NAV_TABS.map((t) => (
          <button key={t.id} className="ert-rtab" aria-current={activeTab === t.id ? "page" : undefined} onClick={() => onNav(t.id)}>
            <t.icon size={20} />{t.label}
          </button>
        ))}
      </nav>
      <div className="ert-rail-foot">
        <button className="ert-ibtn" title="Switch to the top bar" aria-label="Switch to the top bar" onClick={onToggleNav}><PanelTop size={19} /></button>
        {!isGuest && <button className="ert-ibtn" title="App settings" aria-label="App settings" onClick={onOpenAppSettings}><SlidersHorizontal size={19} /></button>}
        <button className="ert-avatar" title={`Playing as ${currentMember}. Click to switch player`} aria-label={`Playing as ${currentMember}. Switch player`} onClick={onSwitchMember}>{initialOf(currentMember)}</button>
      </div>
    </aside>
  );
}

// Title row for the main screens. With the side rail there is no top bar, so the
// primary action lives here instead.
function PageHeader({ title, navMode, isGuest, onAdd, onImportFile }) {
  return (
    <div className="ert-ph">
      <h1>{title}</h1>
      {navMode === "side" && !isGuest && <AddRoomButton onAdd={onAdd} onImportFile={onImportFile} />}
    </div>
  );
}

// Removing a room from a trip asks for a second click, like deleting a photo: the first
// click arms the button, and it disarms after 3 seconds or when you click elsewhere.
function TripRoomRemove({ roomName, onRemove }) {
  const [armed, setArmed] = useState(false);
  const ref = React.useRef(null);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), 3000);
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setArmed(false); };
    document.addEventListener("mousedown", away);
    return () => { clearTimeout(timer); document.removeEventListener("mousedown", away); };
  }, [armed]);
  return (
    <button
      ref={ref}
      className={`ert-tile-x${armed ? " armed" : ""}`}
      title={armed ? "Click again to remove" : "Remove from trip"}
      aria-label={armed ? `Confirm removing ${roomName} from this trip` : `Remove ${roomName} from this trip`}
      onBlur={() => setArmed(false)}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) { setArmed(false); onRemove(); } else setArmed(true);
      }}
    >
      <X size={13} />{armed ? "Remove" : null}
    </button>
  );
}

/* ---------------------------------------------------------------
   DASHBOARD
--------------------------------------------------------------- */
/* ---------------------------------------------------------------
   SMALL SHARED HELPERS
--------------------------------------------------------------- */
const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return isNaN(d.getTime()) ? iso : formatDateAs(d, activeDateFormat);
};
// Search ignores case and Polish diacritics, so "lodz" finds "Łódź".
const normSearch = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
// Shortest unique prefix per name (Karol -> K, Jano -> Jan, Jaćka -> Jać), for compact rating chips.
const shortNamesOf = (names) => {
  const out = {};
  names.forEach((n) => {
    let k = 1;
    while (k < n.length && names.some((o) => o !== n && o.slice(0, k) === n.slice(0, k))) k += 1;
    out[n] = n.slice(0, k);
  });
  return out;
};

/* The combination dial: the one bold element, shared with the phone edition. The wheels
   roll to the count once when Home opens. */
function Dial({ value, digits = 3, label = "rooms played" }) {
  const str = String(Math.min(value, Math.pow(10, digits) - 1)).padStart(digits, "0");
  const [rolled, setRolled] = useState(false);
  useEffect(() => { const t = setTimeout(() => setRolled(true), 160); return () => clearTimeout(t); }, []);
  return (
    <div className="ert-dial" role="img" aria-label={`${value} ${label}`}>
      {str.split("").map((d, i) => (
        <div className="ert-wheel" key={i}>
          <div className="ert-strip" style={{ transform: `translateY(${rolled ? -Number(d) * 10 : 0}%)`, transitionDelay: `${i * 120}ms` }}>
            {Array.from({ length: 10 }).map((__, n) => <span key={n}>{n}</span>)}
          </div>
        </div>
      ))}
    </div>
  );
}

/* A two-option toggle that is one button: clicking anywhere flips it and the highlight slides across. */
function SlideToggle({ options, value, onChange, label }) {
  const idx = options[1].id === value ? 1 : 0;
  const other = options[1 - idx];
  return (
    <button type="button" className="ert-tgl" data-i={idx} aria-label={`${label}: ${options[idx].label}. Switch to ${other.label}`} onClick={() => onChange(other.id)}>
      <i className="thumb" aria-hidden="true" />
      {options.map((o, i) => <span key={o.id} className={i === idx ? "on" : ""} aria-hidden="true">{o.label}</span>)}
    </button>
  );
}

/* A rating you can point at (the stars light up under the cursor), click, or drag across. Half-points on
   the 10 point scale, whole points elsewhere. Read-only when no onChange is given. */
function RatingControl({ label, value, max, step, icon, color, solid = true, onChange, onClear }) {
  const ref = React.useRef(null);
  const [drag, setDrag] = useState(null);
  const [hover, setHover] = useState(null);
  const Icon = icon || Star;
  const readOnly = !onChange;
  const previewing = drag != null || (hover != null && hover !== (value || 0));
  const shown = drag != null ? drag : hover != null ? hover : value || 0;
  const size = 26;
  const cell = 40; // width of one star's cell; the bar is as long as its scale needs, so spacing is the same for 6 and 10
  const calc = (x) => {
    const r = ref.current.getBoundingClientRect();
    // Each icon sits centered in an equal-width cell. Work out which cell the pointer is in and how far across the
    // icon it is, so the value always matches the star under the pointer (the gap between two icons splits between them).
    const cellW = (r.width || 1) / max;
    const pad = Math.max(0, (cellW - size) / 2);
    const pos = Math.min(max - 1e-6, Math.max(0, (x - r.left) / cellW));
    const i = Math.floor(pos);
    const frac = Math.min(1, Math.max(0, ((pos - i) * cellW - pad) / size));
    const v = Math.ceil((i + frac) / step - 1e-9) * step;
    return Math.min(max, Math.max(step, v));
  };
  const down = (e) => {
    if (readOnly) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    setDrag(calc(e.clientX));
  };
  const move = (e) => {
    if (readOnly) return;
    if (drag != null) setDrag(calc(e.clientX));
    else if (e.pointerType === "mouse") setHover(calc(e.clientX));
  };
  const up = (e) => {
    if (drag == null) return;
    const v = calc(e.clientX);
    setDrag(null);
    onChange(v);
  };
  const key = (e) => {
    if (readOnly) return;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); onChange(Math.min(max, (value || 0) + step)); }
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); const nv = (value || 0) - step; nv < step - 1e-9 ? onClear() : onChange(nv); }
  };
  return (
    <div className="ert-rate">
      <span className="ert-rate-l">{label}</span>
      <span className={`ert-rate-val${shown ? "" : " empty"}`}>{shown ? shown : "-"}<small>{`/${max}`}</small></span>
      <div
        className={`ert-stars${readOnly ? " ro" : ""}${previewing ? " pv" : ""}`}
        ref={ref}
        style={{ maxWidth: max * cell }}
        role="slider"
        tabIndex={readOnly ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value || 0}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => { setDrag(null); setHover(null); }}
        onKeyDown={key}
      >
        {Array.from({ length: max }).map((_, i) => {
          const f = Math.max(0, Math.min(1, shown - i));
          return (
            <div className="ert-star" key={i}>
              <div className="ico" style={{ width: size, height: size }}>
                <Icon className="base" size={size} strokeWidth={1.6} />
                {f > 0 ? (
                  <div className="fillclip" style={{ clipPath: `inset(0 ${(1 - f) * 100}% 0 0)` }}>
                    <Icon size={size} strokeWidth={solid ? 1.8 : 2.4} color={color || "var(--brass)"} fill={solid ? color || "var(--brass)" : "none"} />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {!readOnly && value && !previewing ? <button className="ert-clear" onClick={onClear}>Clear</button> : <span />}
    </div>
  );
}

function StatBlock({ label, value, sub }) {
  return (
    <div style={{ flex: "1 1 140px", minWidth: 140 }}>
      <div className="ert-display" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 3 }}>{label}</div>
      {sub && <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{sub}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------
   DASHBOARD (Home)
--------------------------------------------------------------- */
// The same flag and photo icons the phone shows on the right of a row.
function RowIcons({ room, flags }) {
  const defs = (flags && flags.length ? flags : DEFAULT_FLAGS).filter((f) => (room.flags || []).includes(f.id));
  const hasPhotos = room.photos && room.photos.length > 0;
  const partial = missingPlayers(room).length > 0;
  if (!defs.length && !hasPhotos && !partial) return null;
  return (
    <span className="ert-rowicons">
      {defs.map((f) => {
        const Icon = resolveFlagIcon(f.icon);
        return <Icon key={f.id} size={16} color={f.color} aria-label={f.label} />;
      })}
      {partial ? <PartialGroupIcon room={room} /> : null}
      {hasPhotos ? <Camera size={16} aria-label="Has photos" /> : null}
    </span>
  );
}

function Dashboard({ rooms, members, onOpenRoom, onOpenWishlist, flags }) {
  const played = rooms.filter((r) => r.status === "played");
  const wishlist = rooms.filter((r) => r.status === "wishlist");
  const escaped = played.filter((r) => r.result === "escaped").length;
  const escapeRate = played.length ? Math.round((escaped / played.length) * 100) : null;
  const cityCount = new Set(played.map((r) => (r.city || "").trim().toLowerCase()).filter(Boolean)).size;
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

  const byYear = useMemo(() => roomsPerYear(played), [played]);

  const recent = [...played].sort((a, b) => (b.datePlayed || "").localeCompare(a.datePlayed || "")).slice(0, 5);
  const topRated = [...played]
    .map((r) => ({ ...r, _avg: avgRating(r) }))
    .filter((r) => r._avg !== null)
    .sort((a, b) => compareRoomsBest(a, b))
    .slice(0, 5);
  const topPositions = tiedPositions(topRated.map((r) => r._avg));

  return (
    <div>
      <div className="ert-hero">
        <Dial value={played.length} label="rooms played" />
        <div className="ert-hero-copy">
          <div className="big">{played.length === 1 ? "room played" : "rooms played"}</div>
          {cityCount > 0 ? <p>{`in ${cityCount === 1 ? "1 city" : `${cityCount} cities`}`}</p> : null}
        </div>
        <div className="ert-stats">
          <div><b>{fmtAvg(overallAvg)}</b><span>Group average</span></div>
          <div><b>{escapeRate === null ? "-" : `${escapeRate}%`}</b><span>Escape rate</span></div>
          <button onClick={onOpenWishlist} title="Open the wishlist"><b>{wishlist.length}</b><span>On the wishlist</span></button>
        </div>
      </div>

      <div className="ert-cols">
        <div>
          <h2 className="ert-sh">Best rooms<small>by group average</small></h2>
          {topRated.length === 0 && <EmptyNote text="No ratings yet. Rate a room to build your ranking." />}
          <div>
            {topRated.map((r, i) => (
              <button key={r.id} className="ert-lrow" onClick={() => onOpenRoom(r.id)}>
                <span className={`ert-rank${topPositions[i] === 1 ? " top" : ""}`}>{topPositions[i]}</span>
                <span><span className="ert-r-title">{r.name}</span><span className="ert-r-sub">{r.venue || r.city}</span></span>
                <span className="ert-rside"><RowIcons room={r} flags={flags} /><span className="ert-score">{fmtAvg(r._avg)}</span></span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <h2 className="ert-sh">Recently played</h2>
          {recent.length === 0 && <EmptyNote text="Nothing logged yet. Add your first room." />}
          <div>
            {recent.map((r) => (
              <button key={r.id} className="ert-lrow no-rank" onClick={() => onOpenRoom(r.id)}>
                <span>
                  <span className="ert-r-title">{r.name}</span>
                  <span className="ert-r-sub">
                    {[r.city, fmtDate(r.datePlayed)].filter(Boolean).join(", ")}
                    {r.result === "not-escaped" ? <span style={{ color: "var(--danger)" }}>{" Not escaped"}</span> : null}
                  </span>
                </span>
                <span className="ert-rside"><RowIcons room={r} flags={flags} /><span className="ert-score">{fmtAvg(avgRating(r))}</span></span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ert-cols" style={{ marginTop: 52, alignItems: "start" }}>
        <div className="ert-stack">
          <div>
            <h2 className="ert-sh">Where you've played</h2>
            {byCity.length === 0 && <EmptyNote text="No played rooms yet." />}
            <div>{byCity.map(([city, count]) => <BarRow key={city} label={city} count={count} max={byCity[0][1]} />)}</div>
          </div>
          <div>
            <h2 className="ert-sh">Rooms per year</h2>
            {byYear.length === 0 && <EmptyNote text="No dated rooms yet." />}
            <YearChart data={byYear} />
          </div>
        </div>
        <div>
          <h2 className="ert-sh">Categories</h2>
          {byCategory.length === 0 && <EmptyNote text="No played rooms yet." />}
          <div>{byCategory.map(([cat, count]) => <BarRow key={cat} label={cat} count={count} max={byCategory[0][1]} />)}</div>
        </div>
      </div>
    </div>
  );
}

// Played rooms per calendar year, oldest to newest, with empty years in
// between kept as zero so the timeline has no gaps. Rooms without a date
// can't be placed on it and are skipped.
function roomsPerYear(played) {
  const counts = {};
  played.forEach((r) => {
    const y = parseInt((r.datePlayed || "").slice(0, 4), 10);
    if (y >= 1900 && y <= 2200) counts[y] = (counts[y] || 0) + 1;
  });
  const years = Object.keys(counts).map(Number);
  if (!years.length) return [];
  const out = [];
  for (let y = Math.min(...years); y <= Math.max(...years); y++) out.push([String(y), counts[y] || 0]);
  return out;
}

function YearChart({ data }) {
  if (!data.length) return null;
  const max = Math.max(1, ...data.map((d) => d[1]));
  return (
    <div className={`ert-yearchart${data.length > 8 ? " dense" : ""}`} role="img" aria-label={`Rooms played per year: ${data.map((d) => `${d[0]} ${d[1]}`).join(", ")}`}>
      {data.map(([year, n]) => (
        <div className="ert-ycol" key={year}>
          <div className="plot">
            <span className="n">{n}</span>
            <div className={`col${n === 0 ? " zero" : ""}`} style={{ height: `${n === 0 ? 0 : Math.max(4, (n / max) * 100)}%`, flex: "0 0 auto" }} />
          </div>
          <span className="y">{year}</span>
        </div>
      ))}
    </div>
  );
}

function BarRow({ label, count, max }) {
  return (
    <div className="ert-bar">
      <span>{label}</span>
      <i><b style={{ width: `${Math.max(8, Math.round((count / max) * 100))}%` }} /></i>
      <span>{count}</span>
    </div>
  );
}

function EmptyNote({ text }) {
  return <div style={{ fontSize: 13.5, color: "var(--text-dim)", padding: "8px 0" }}>{text}</div>;
}


/* ---------------------------------------------------------------
   STAR ROW
   A 1-10 rating control that supports half-point precision -- click
   the left half of a star for a .5, the right half for a whole
   number. Read-only (no onChange) when used just for display.
--------------------------------------------------------------- */
function StarRow({ value, onChange, size, max, allowHalf, icon, halfIcon, color }) {
  const starSize = size || 17;
  const count = max || 10;
  const half = allowHalf !== false;
  const Filled = icon || Star;
  const HalfFilled = halfIcon || StarHalf;
  const litColor = color || "var(--brass)";
  const [hoverValue, setHoverValue] = useState(null);

  const valueForEvent = (e, starIndex) => {
    if (!half) return starIndex + 1;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const isHalf = x < rect.width / 2;
    return starIndex + (isHalf ? 0.5 : 1);
  };
  const handleClick = (e, starIndex) => {
    if (!onChange) return;
    onChange(valueForEvent(e, starIndex));
  };
  const handleMouseMove = (e, starIndex) => {
    if (!onChange) return;
    setHoverValue(valueForEvent(e, starIndex));
  };

  const displayValue = hoverValue !== null ? hoverValue : value;

  return (
    <div
      style={{ display: "inline-flex" }}
      onMouseLeave={onChange ? () => setHoverValue(null) : undefined}
    >
      {Array.from({ length: count }).map((_, idx) => {
        const full = displayValue >= idx + 1;
        const isHalf = !full && displayValue >= idx + 0.5;
        const Icon = isHalf ? HalfFilled : Filled;
        const lit = full || isHalf;
        const previewing = hoverValue !== null && lit;
        return (
          <span
            key={idx}
            className={onChange ? "ert-star-btn" : undefined}
            onClick={onChange ? (e) => handleClick(e, idx) : undefined}
            onMouseMove={onChange ? (e) => handleMouseMove(e, idx) : undefined}
            style={{ display: "inline-flex", lineHeight: 0, cursor: onChange ? "pointer" : "default" }}
          >
            <Icon
              size={starSize}
              fill={lit ? (previewing ? "var(--brass-bright)" : litColor) : "none"}
              color={lit ? (previewing ? "var(--brass-bright)" : litColor) : "var(--border)"}
              style={{ transition: "fill 0.1s, color 0.1s" }}
            />
          </span>
        );
      })}
    </div>
  );
}
 
/* ---------------------------------------------------------------
   ROOMS LIST (played or wishlist)
--------------------------------------------------------------- */
/* ---------------------------------------------------------------
   FILTER AND SORT POPOVERS
   Chips instead of checkboxes, the same look as the phone's filter sheet.
--------------------------------------------------------------- */
// Shared by the popovers: keeps the panel under its button in real screen pixels, closes on
// outside click or Escape.
function usePopoverPosition(open, setOpen, wrapRef, btnRef, width, maxH) {
  const [panelStyle, setPanelStyle] = useState(null);
  const recompute = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const panelWidth = Math.min(width, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - panelWidth - 12));
    const top = rect.bottom + 8;
    setPanelStyle({ position: "fixed", top, left, width: panelWidth, maxHeight: Math.max(160, Math.min(maxH, window.innerHeight - top - 12)) });
  }, [width, maxH]);
  useEffect(() => {
    if (!open) return undefined;
    recompute();
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [open, recompute]);
  return panelStyle;
}

function FilterSection({ label, items, selected, onToggle }) {
  if (!items.length) return null;
  return (
    <div className="ert-fsec">
      <div className="ert-flabel">{label}</div>
      <div className="ert-chips">
        {items.map((c) => (
          <button key={c} type="button" className="ert-chip" aria-pressed={selected.includes(c)} onClick={() => onToggle(c)}>{c}</button>
        ))}
      </div>
    </div>
  );
}

function FilterPopover({ cities, cats, countries, flagOptions, selectedCities, selectedGenres, selectedCountries, selectedFlags, onToggleCity, onToggleGenre, onToggleCountry, onToggleFlag, onClear }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);
  const btnRef = React.useRef(null);
  const panelStyle = usePopoverPosition(open, setOpen, ref, btnRef, 400, 560);
  const flagList = flagOptions || [];
  const activeCount = selectedCities.length + selectedGenres.length + selectedCountries.length + (selectedFlags ? selectedFlags.length : 0);

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        ref={btnRef}
        type="button"
        className="ert-btn ert-btn-ghost"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ fontWeight: 500, borderColor: activeCount ? "var(--brass)" : undefined, color: activeCount ? "var(--brass-bright)" : undefined }}
      >
        <SlidersHorizontal size={16} />
        Filters
        {activeCount > 0 && <span className="ert-fbadge">{activeCount}</span>}
      </button>

      {open && panelStyle && (
        <div
          className="ert-card-raised ert-scrollbar"
          role="dialog"
          aria-label="Filters"
          style={{ ...panelStyle, overflowY: "auto", zIndex: 20, padding: "16px 18px 6px", boxShadow: "0 12px 32px rgba(0,0,0,0.45)" }}
        >
          <div className="ert-pop-h">
            <span>Filters</span>
            {activeCount > 0 && <button type="button" className="ert-clear" onClick={onClear}>Clear all</button>}
          </div>

          <FilterSection label="Country" items={countries} selected={selectedCountries} onToggle={onToggleCountry} />
          <FilterSection label="City" items={cities} selected={selectedCities} onToggle={onToggleCity} />
          <FilterSection label="Category" items={cats} selected={selectedGenres} onToggle={onToggleGenre} />

          {flagList.length > 0 && (
            <div className="ert-fsec">
              <div className="ert-flabel">Flags</div>
              <div className="ert-chips">
                {flagList.map((f) => {
                  const Icon = resolveFlagIcon(f.icon);
                  return (
                    <button key={f.id} type="button" className="ert-chip" aria-pressed={(selectedFlags || []).includes(f.id)} onClick={() => onToggleFlag(f.id)}>
                      <Icon size={14} color={f.color} />{f.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {cities.length === 0 && cats.length === 0 && countries.length === 0 && flagList.length === 0 && <EmptyNote text="Nothing to filter yet." />}
        </div>
      )}
    </div>
  );
}

const SORT_OPTIONS = [
  { id: "visited-desc", label: "Date visited (newest)" },
  { id: "visited-asc", label: "Date visited (oldest)" },
  { id: "date-desc", label: "Date added (newest)" },
  { id: "date-asc", label: "Date added (oldest)" },
  { id: "rating-desc", label: "Rating (high to low)" },
  { id: "alpha", label: "Alphabetical (A to Z)" },
];

function sortRooms(rooms, sortBy) {
  const arr = [...rooms];
  switch (sortBy) {
    case "date-asc":
      return arr.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    case "date-desc":
      return arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    case "visited-asc":
      return arr.sort((a, b) => {
        const av = a.datePlayed || "";
        const bv = b.datePlayed || "";
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return av.localeCompare(bv);
      });
    case "rating-desc":
      return arr.sort((a, b) => compareRoomsBest(a, b));
    case "alpha":
      return arr.sort((a, b) => a.name.localeCompare(b.name, "pl"));
    case "visited-desc":
    default:
      return arr.sort((a, b) => {
        const av = a.datePlayed || "";
        const bv = b.datePlayed || "";
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return bv.localeCompare(av);
      });
  }
}

// Chunks an already date-sorted list into consecutive year groups, using
// whichever date field the caller names (e.g. "datePlayed"). Items with no
// date land in their own "Undated" group. Since it just reads the year out
// of each item's date, any future year appears automatically -- nothing
// here is tied to today's date.
function groupByYear(items, dateField) {
  const groups = [];
  let currentYear = null;
  let currentGroup = null;
  items.forEach((item) => {
    const year = item[dateField] ? item[dateField].slice(0, 4) : "Undated";
    if (year !== currentYear) {
      currentYear = year;
      currentGroup = { year, items: [] };
      groups.push(currentGroup);
    }
    currentGroup.items.push(item);
  });
  return groups;
}

function YearDivider({ year, count, itemLabel }) {
  return (
    <div className="ert-yr"><b>{year}</b><span>{plural(count, itemLabel)}</span></div>
  );
}

function SortPopover({ options, sortBy, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);
  const btnRef = React.useRef(null);
  const panelStyle = usePopoverPosition(open, setOpen, ref, btnRef, 260, 420);
  const current = options.find((o) => o.id === sortBy) || options[0];

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button ref={btnRef} type="button" className="ert-btn ert-btn-ghost" aria-expanded={open} aria-haspopup="menu" style={{ fontWeight: 500 }} onClick={() => setOpen((o) => !o)}>
        <ArrowUpDown size={16} />
        {current.label}
      </button>

      {open && panelStyle && (
        <div className="ert-card-raised" role="menu" aria-label="Sort by" style={{ ...panelStyle, zIndex: 20, padding: 6, boxShadow: "0 12px 32px rgba(0,0,0,0.45)" }}>
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="menuitemradio"
              aria-checked={opt.id === current.id}
              className="ert-menu-item"
              onClick={() => { onChange(opt.id); setOpen(false); }}
            >
              <span>{opt.label}</span>
              {opt.id === current.id ? <Check size={16} color="var(--brass-bright)" /> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function defaultRoomFilters(hideVisitedSort) {
  return {
    search: "",
    selectedCities: [],
    selectedGenres: [],
    selectedCountries: [],
    selectedFlags: [],
    onlyUnrated: false,
    sortBy: hideVisitedSort ? "date-desc" : "visited-desc",
  };
}

function RoomsView({ rooms, onOpen, emptyLabel, hideVisitedSort, flags, currentMember, filters, onFiltersChange, segment, counts, onSegment }) {
  const { search, selectedCities, selectedGenres, selectedCountries, selectedFlags, onlyUnrated, sortBy } = filters;
  const patch = (p) => onFiltersChange({ ...filters, ...p });
  const sortOptions = hideVisitedSort ? SORT_OPTIONS.filter((o) => !o.id.startsWith("visited-")) : SORT_OPTIONS;
  const flagOptions = flags && flags.length ? flags : DEFAULT_FLAGS;

  const cities = useMemo(() => Array.from(new Set(rooms.map((r) => r.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pl")), [rooms]);
  const cats = useMemo(() => Array.from(new Set(rooms.map((r) => r.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pl")), [rooms]);
  const countries = useMemo(() => Array.from(new Set(rooms.map((r) => r.country).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pl")), [rooms]);

  const toggleCity = (c) => patch({ selectedCities: selectedCities.includes(c) ? selectedCities.filter((x) => x !== c) : [...selectedCities, c] });
  const toggleGenre = (c) => patch({ selectedGenres: selectedGenres.includes(c) ? selectedGenres.filter((x) => x !== c) : [...selectedGenres, c] });
  const toggleCountry = (c) => patch({ selectedCountries: selectedCountries.includes(c) ? selectedCountries.filter((x) => x !== c) : [...selectedCountries, c] });
  const toggleFlagFilter = (id) => patch({ selectedFlags: selectedFlags.includes(id) ? selectedFlags.filter((x) => x !== id) : [...selectedFlags, id] });
  const clearPopoverFilters = () => patch({ selectedCities: [], selectedGenres: [], selectedCountries: [], selectedFlags: [] });
  const hasActiveFilters = !!search || selectedCities.length > 0 || selectedGenres.length > 0 || selectedCountries.length > 0 || selectedFlags.length > 0 || onlyUnrated;
  const clearAll = () => patch({ search: "", selectedCities: [], selectedGenres: [], selectedCountries: [], selectedFlags: [], onlyUnrated: false });

  const filtered = rooms.filter((r) => {
    if (search && !normSearch(`${r.name} ${r.venue}`).includes(normSearch(search))) return false;
    if (selectedCountries.length && !selectedCountries.includes(r.country)) return false;
    if (selectedCities.length && !selectedCities.includes(r.city)) return false;
    if (selectedGenres.length && !selectedGenres.includes(r.category)) return false;
    if (selectedFlags.length && !(r.flags || []).some((f) => selectedFlags.includes(f))) return false;
    if (onlyUnrated && currentMember && typeof r.ratings[currentMember] === "number") return false;
    return true;
  });
  const sorted = sortRooms(filtered, sortBy);
  const isDateGrouped = !hideVisitedSort && (sortBy === "visited-desc" || sortBy === "visited-asc");
  const yearGroups = isDateGrouped ? groupByYear(sorted, "datePlayed") : [];

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
        {onSegment && (
          <SlideToggle label="Which rooms" value={segment === "wishlist" ? "wishlist" : "completed"} onChange={onSegment} options={[{ id: "completed", label: "Completed" }, { id: "wishlist", label: "Wishlist" }]} />
        )}
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 180, maxWidth: 380 }}>
          <Search size={16} style={{ position: "absolute", left: 14, top: 13, color: "var(--text-dim)" }} />
          <input className="ert-input" style={{ paddingLeft: 42, height: 38 }} placeholder="Search rooms" aria-label="Search rooms" value={search} onChange={(e) => patch({ search: e.target.value })} />
        </div>
        <SortPopover options={sortOptions} sortBy={sortBy} onChange={(v) => patch({ sortBy: v })} />
        {!hideVisitedSort && currentMember && (
          <button
            className="ert-btn ert-btn-ghost"
            onClick={() => patch({ onlyUnrated: !onlyUnrated })}
            style={{
              flexShrink: 0, height: 38, background: "var(--surface)", borderColor: onlyUnrated ? "var(--brass)" : "var(--border-soft)",
              color: onlyUnrated ? "var(--brass-bright)" : "var(--text)", fontWeight: 500,
            }}
          >
            <Star size={16} /> Not rated yet
          </button>
        )}
        <FilterPopover
          cities={cities}
          cats={cats}
          countries={countries}
          flagOptions={flagOptions}
          selectedCities={selectedCities}
          selectedGenres={selectedGenres}
          selectedCountries={selectedCountries}
          selectedFlags={selectedFlags}
          onToggleCity={toggleCity}
          onToggleGenre={toggleGenre}
          onToggleCountry={toggleCountry}
          onToggleFlag={toggleFlagFilter}
          onClear={clearPopoverFilters}
        />
        {hasActiveFilters && (
          <button className="ert-btn ert-btn-ghost" onClick={clearAll} title="Clear filters" aria-label="Clear filters" style={{ flexShrink: 0, height: 38, padding: "0 12px" }}>
            <FilterX size={16} />
          </button>
        )}
        <span className="ert-count">
          {sorted.length === rooms.length ? `${plural(rooms.length, "room")} total` : `${sorted.length} of ${plural(rooms.length, "room")}`}
        </span>
      </div>

      {sorted.length === 0 ? (
        <div style={{ paddingTop: 22 }}><EmptyNote text={emptyLabel || "No rooms match those filters."} /></div>
      ) : isDateGrouped ? (
        <div>
          {yearGroups.map((group) => (
            <section key={group.year}>
              <YearDivider year={group.year} count={group.items.length} itemLabel="room" />
              <div className="ert-tgrid">
                {group.items.map((r) => <RoomCard key={r.id} room={r} onOpen={() => onOpen(r.id)} flags={flags} />)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="ert-tgrid" style={{ marginTop: 22 }}>
          {sorted.map((r) => <RoomCard key={r.id} room={r} onOpen={() => onOpen(r.id)} flags={flags} />)}
        </div>
      )}
    </div>
  );
}

function RoomCard({ room, onOpen, flags }) {
  const avg = avgRating(room);
  const played = room.status === "played";
  const flagDefs = (flags || DEFAULT_FLAGS).filter((f) => (room.flags || []).includes(f.id));
  return (
    <button type="button" className="ert-tile" onClick={onOpen}>
      <div className="ert-tile-top">
        <span>
          {played ? fmtDate(room.datePlayed) : "Not played yet"}
          {played && room.result === "not-escaped" ? <span style={{ color: "var(--danger)" }}>{room.datePlayed ? " Not escaped" : "Not escaped"}</span> : null}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
          {flagDefs.map((flag) => {
            const Icon = resolveFlagIcon(flag.icon);
            return <Icon key={flag.id} size={15} color={flag.color} aria-label={flag.label} />;
          })}
          <PartialGroupIcon room={room} size={15} />
          {room.photos && room.photos.length > 0 && <Camera size={15} color="var(--text-dim)" aria-label="Has photos" />}
        </span>
      </div>
      <div className="ert-tile-nm">{room.name || "Untitled room"}</div>
      {room.venue ? <div className="ert-tile-vn">{room.venue}</div> : null}
      <div className="ert-tile-loc"><MapPin size={13} />{room.city || "-"}{room.country ? `, ${room.country}` : ""}</div>
      <div className="ert-tile-bot">
        <span className="ert-pill">{room.category}</span>
        {played ? (
          <span className="ert-tile-sc"><Star size={17} />{fmtAvg(avg)}</span>
        ) : (
          <span style={{ color: "var(--text-dim)", fontSize: 13 }}>{room.difficulty}</span>
        )}
      </div>
    </button>
  );
}


/* ---------------------------------------------------------------
   RANKING
--------------------------------------------------------------- */
function defaultRankingFilters() {
  return { selectedCities: [], selectedGenres: [], selectedCountries: [], selectedFlags: [], onlyUnrated: false, sortDir: "best" };
}

function RankingView({ rooms, members, currentMember, onOpen, mode, onModeChange, filters, onFiltersChange, flags, highlightId, onClearHighlight }) {
  const personal = mode === "personal" && currentMember;
  const { selectedCities, selectedGenres, selectedCountries, selectedFlags, onlyUnrated, sortDir } = filters;
  const flagOptions = flags && flags.length ? flags : DEFAULT_FLAGS;
  const patch = (p) => onFiltersChange({ ...filters, ...p });

  const cities = useMemo(() => Array.from(new Set(rooms.map((r) => r.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pl")), [rooms]);
  const cats = useMemo(() => Array.from(new Set(rooms.map((r) => r.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pl")), [rooms]);
  const countries = useMemo(() => Array.from(new Set(rooms.map((r) => r.country).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pl")), [rooms]);

  const toggleCity = (c) => patch({ selectedCities: selectedCities.includes(c) ? selectedCities.filter((x) => x !== c) : [...selectedCities, c] });
  const toggleGenre = (c) => patch({ selectedGenres: selectedGenres.includes(c) ? selectedGenres.filter((x) => x !== c) : [...selectedGenres, c] });
  const toggleCountry = (c) => patch({ selectedCountries: selectedCountries.includes(c) ? selectedCountries.filter((x) => x !== c) : [...selectedCountries, c] });
  const toggleFlagFilter = (id) => patch({ selectedFlags: selectedFlags.includes(id) ? selectedFlags.filter((x) => x !== id) : [...selectedFlags, id] });
  const clearPopoverFilters = () => patch({ selectedCities: [], selectedGenres: [], selectedCountries: [], selectedFlags: [] });
  const hasActiveFilters = selectedCities.length > 0 || selectedGenres.length > 0 || selectedCountries.length > 0 || selectedFlags.length > 0 || onlyUnrated;
  const clearAll = () => patch({ selectedCities: [], selectedGenres: [], selectedCountries: [], selectedFlags: [], onlyUnrated: false });

  const filteredRooms = rooms.filter((r) => {
    if (selectedCountries.length && !selectedCountries.includes(r.country)) return false;
    if (selectedCities.length && !selectedCities.includes(r.city)) return false;
    if (selectedGenres.length && !selectedGenres.includes(r.category)) return false;
    if (selectedFlags.length && !(r.flags || []).some((f) => selectedFlags.includes(f))) return false;
    if (onlyUnrated && currentMember && typeof r.ratings[currentMember] === "number") return false;
    if (personal && currentMember && !roomParticipants(r).includes(currentMember)) return false;
    return true;
  });

  const ranked = useMemo(() => {
    const withValues = filteredRooms.map((r) => ({
      ...r,
      _avg: avgRating(r),
      _mine: personal ? (typeof r.ratings[currentMember] === "number" ? r.ratings[currentMember] : null) : null,
    }));
    const primary = personal ? (r) => r._mine : avgRating;
    const sorted = withValues.sort((a, b) => (sortDir === "worst" ? compareRoomsBest(b, a, primary) : compareRoomsBest(a, b, primary)));
    const positions = tiedPositions(sorted.map((r) => (personal ? r._mine : r._avg)));
    return sorted.map((r, i) => ({ ...r, _pos: positions[i] }));
  }, [filteredRooms, mode, currentMember, sortDir]);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
        {currentMember && (
          <SlideToggle label="Whose ratings" value={personal ? "personal" : "group"} onChange={onModeChange} options={[{ id: "group", label: "Group" }, { id: "personal", label: "Mine" }]} />
        )}
        <button className="ert-btn ert-btn-ghost" onClick={() => patch({ sortDir: sortDir === "worst" ? "best" : "worst" })} style={{ flexShrink: 0, fontWeight: 500 }}>
          <ArrowUpDown size={16} /> {sortDir === "worst" ? "Worst first" : "Best first"}
        </button>
        {currentMember && (
          <button
            className="ert-btn ert-btn-ghost"
            onClick={() => patch({ onlyUnrated: !onlyUnrated })}
            style={{
              flexShrink: 0, height: 38, background: "var(--surface)", fontWeight: 500,
              borderColor: onlyUnrated ? "var(--brass)" : "var(--border-soft)",
              color: onlyUnrated ? "var(--brass-bright)" : "var(--text)",
            }}
          >
            <Star size={16} /> Not rated yet
          </button>
        )}
        <FilterPopover
          cities={cities}
          cats={cats}
          countries={countries}
          flagOptions={flagOptions}
          selectedCities={selectedCities}
          selectedGenres={selectedGenres}
          selectedCountries={selectedCountries}
          selectedFlags={selectedFlags}
          onToggleCity={toggleCity}
          onToggleGenre={toggleGenre}
          onToggleCountry={toggleCountry}
          onToggleFlag={toggleFlagFilter}
          onClear={clearPopoverFilters}
        />
        {hasActiveFilters && (
          <button className="ert-btn ert-btn-ghost" onClick={clearAll} title="Clear filters" aria-label="Clear filters" style={{ flexShrink: 0, height: 38, padding: "0 12px" }}>
            <FilterX size={16} />
          </button>
        )}
        <span className="ert-count">
          {(() => {
            const total = personal ? rooms.filter((r) => roomParticipants(r).includes(currentMember)).length : rooms.length;
            return ranked.length === total ? `${plural(total, "room")} total` : `${ranked.length} of ${plural(total, "room")}`;
          })()}
        </span>
      </div>

      {ranked.length === 0 ? (
        <EmptyNote text={rooms.length === 0 ? "No completed rooms yet. The ranking fills in once you log one." : "No rooms match those filters."} />
      ) : (
        <div
          onMouseMove={highlightId ? (e) => {
            if (!(e.movementX || e.movementY)) return;
            const row = e.target.closest ? e.target.closest(".ert-lrow") : null;
            if (row && row.getAttribute("data-id") !== highlightId) onClearHighlight();
          } : undefined}
        >
          {(() => {
            const cols = personal
              ? "100px minmax(0, 1fr) 110px"
              : `100px minmax(0, 1fr) repeat(${members.length}, 84px)`;
            const head = { fontSize: 12.5, color: "var(--text-dim)" };
            return (
              <>
                <div style={{ display: "grid", gridTemplateColumns: cols, gap: 20, padding: "4px 0 9px", borderBottom: "1px solid var(--border)", alignItems: "end", ...head }}>
                  <span>{personal ? "My rating" : "Group average"}</span>
                  <span>Room</span>
                  {!personal && members.map((m) => (
                    <span key={m} title={m} style={{ textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: m === currentMember ? "var(--brass-bright)" : undefined }}>{m}</span>
                  ))}
                  {personal && <span style={{ textAlign: "right" }}>Group average</span>}
                </div>
                {ranked.map((r, i) => (
                  <button key={r.id} data-id={r.id} className={`ert-lrow${r.id === highlightId ? " ert-last" : ""}`} title={`Rank ${r._pos} of ${ranked.length}`} style={{ gridTemplateColumns: cols, gap: 20, alignItems: "center" }} onClick={() => onOpen(r.id)}>
                    <span className="ert-rkcell">
                      <span className="ert-score sc">{personal ? fmtRating(r._mine) : fmtAvg(r._avg)}</span>
                      <span className={`pos${r._pos === 1 ? " top" : ""}`} aria-hidden="true">{`#${r._pos}`}</span>
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span className="ert-r-title">{r.name}</span>
                      <span className="ert-r-sub">{r.venue || r.city}</span>
                    </span>
                    {!personal && members.map((m) => (
                      <span key={m} style={{ textAlign: "center" }}>
                        {typeof r.ratings[m] === "number" ? (
                          <span
                            className="ert-mono"
                            title={`${m}: ${r.ratings[m]}`}
                            style={{
                              display: "inline-block", minWidth: 40, fontSize: 13, padding: "2px 9px", borderRadius: 7,
                              color: m === currentMember ? "#17140c" : "var(--text-dim)",
                              background: m === currentMember ? "var(--brass)" : "var(--surface-raised)",
                              fontWeight: m === currentMember ? 700 : 500,
                            }}
                          >
                            {r.ratings[m]}
                          </span>
                        ) : null}
                      </span>
                    ))}
                    {personal && <span className="ert-mono" style={{ textAlign: "right", color: "var(--text-dim)", fontSize: 15 }}>{fmtAvg(r._avg)}</span>}
                  </button>
                ))}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
 
/* ---------------------------------------------------------------
   APP SETTINGS
   A small out-of-the-way place for crew-wide configuration that
   doesn't need its own tab -- starting with the list of genre
   categories offered when adding a room. More settings can live
   here later without cluttering the main nav.
--------------------------------------------------------------- */
function GeneralSettings({ crewName, onChangeCrewName, dateFormat, onChangeDateFormat, theme, onChangeTheme }) {
  const [nameDraft, setNameDraft] = useState(crewName);
  useEffect(() => { setNameDraft(crewName); }, [crewName]);
  const commitName = () => onChangeCrewName(nameDraft);
  const sample = new Date(2026, 9, 7, 12);
  // The page chooses which version to load when it opens, so remember the choice and reload.
  const openLegacy = () => {
    writeLegacyMode(true);
    try { window.location.reload(); } catch (e) { /* nothing to reload in a preview */ }
  };
  return (
    <div style={{ borderTop: "1px solid var(--border-soft)" }}>
      <div className="ert-gsrow">
        <label htmlFor="ert-crew-name">
          <b>Crew name</b>
          <small>Shown as the title of the app, in the top bar and the browser tab. Shared by everyone. Leave it empty to use "{DEFAULT_CREW_NAME}".</small>
        </label>
        <input
          id="ert-crew-name"
          className="ert-input"
          style={{ width: 240 }}
          maxLength={40}
          placeholder={DEFAULT_CREW_NAME}
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        />
      </div>

      <div className="ert-gsrow">
        <label htmlFor="ert-date-format">
          <b>Date format</b>
          <small>How dates appear across rooms and trips. This applies to this device only.</small>
        </label>
        <select id="ert-date-format" className="ert-select" style={{ width: 240 }} value={dateFormat} onChange={(e) => onChangeDateFormat(e.target.value)}>
          {DATE_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>{f.id === "auto" ? f.label : formatDateAs(sample, f.id)}</option>
          ))}
        </select>
      </div>

      <div className="ert-gsrow">
        <div>
          <b>Appearance</b>
          <small>Dark is easy on the eyes in a dim room, Light uses a soft paper tone instead of bright white. This applies to this device only.</small>
        </div>
        <div className="ert-seg" role="group" aria-label="Appearance">
          <button aria-pressed={theme === "dark"} onClick={() => onChangeTheme("dark")}>Dark</button>
          <button aria-pressed={theme === "light"} onClick={() => onChangeTheme("light")}>Light</button>
        </div>
      </div>

      <div className="ert-gsrow">
        <div>
          <b>Legacy mode</b>
          <small>Open the previous version of the app on this device. Both versions share the same data, so nothing is lost or duplicated. A button in the corner brings you back to the new version.</small>
        </div>
        <button className="ert-btn ert-btn-ghost" onClick={openLegacy}>Open previous version</button>
      </div>
    </div>
  );
}

function FlagIconPicker({ value, onChange }) {
  return (
    <div className="ert-chips" style={{ gap: 6 }}>
      {FLAG_ICON_CHOICES.map((name) => {
        const Icon = resolveFlagIcon(name);
        return (
          <button key={name} type="button" className="ert-pick" aria-pressed={value === name} aria-label={name} title={name} onClick={() => onChange(name)}>
            <Icon size={17} />
          </button>
        );
      })}
    </div>
  );
}

function FlagColorPicker({ value, onChange }) {
  return (
    <div className="ert-chips" style={{ gap: 8 }}>
      {FLAG_COLOR_CHOICES.map((c) => (
        <button
          key={c.value}
          type="button"
          className="ert-swatch"
          aria-pressed={value === c.value}
          aria-label={c.label}
          title={c.label}
          onClick={() => onChange(c.value)}
          style={{ background: c.value }}
        />
      ))}
    </div>
  );
}

function AppSettingsView({ crewName, onChangeCrewName, dateFormat, onChangeDateFormat, theme, onChangeTheme, categories, onBack, onAddCategory, onRemoveCategory, onRenameCategory, flags, onAddFlag, onUpdateFlag, onRemoveFlag, driveAvailable, driveConnected, onConnectDrive }) {
  const [tab, setTab] = useState("general");

  const [newCategory, setNewCategory] = useState("");
  const [editingCategory, setEditingCategory] = useState(null);
  const [editValue, setEditValue] = useState("");
  const list = categories && categories.length ? categories : DEFAULT_CATEGORIES;

  const submitAdd = () => {
    if (!newCategory.trim()) return;
    onAddCategory(newCategory);
    setNewCategory("");
  };
  const startEdit = (c) => {
    setEditingCategory(c);
    setEditValue(c);
  };
  const cancelEdit = () => {
    setEditingCategory(null);
    setEditValue("");
  };
  const submitEdit = () => {
    if (editValue.trim() && editValue.trim() !== editingCategory) {
      onRenameCategory(editingCategory, editValue);
    }
    cancelEdit();
  };

  const flagList = flags && flags.length ? flags : DEFAULT_FLAGS;
  const [newFlagLabel, setNewFlagLabel] = useState("");
  const [newFlagIcon, setNewFlagIcon] = useState(FLAG_ICON_CHOICES[0]);
  const [newFlagColor, setNewFlagColor] = useState(FLAG_COLOR_CHOICES[0].value);
  const [editingFlagId, setEditingFlagId] = useState(null);
  const [editFlagLabel, setEditFlagLabel] = useState("");
  const [editFlagIcon, setEditFlagIcon] = useState("");
  const [editFlagColor, setEditFlagColor] = useState("");

  const submitAddFlag = () => {
    if (!newFlagLabel.trim()) return;
    onAddFlag({ label: newFlagLabel, icon: newFlagIcon, color: newFlagColor });
    setNewFlagLabel("");
    setNewFlagIcon(FLAG_ICON_CHOICES[0]);
    setNewFlagColor(FLAG_COLOR_CHOICES[0].value);
  };
  const startEditFlag = (f) => {
    setEditingFlagId(f.id);
    setEditFlagLabel(f.label);
    setEditFlagIcon(f.icon);
    setEditFlagColor(f.color);
  };
  const cancelEditFlag = () => setEditingFlagId(null);
  const submitEditFlag = () => {
    if (editFlagLabel.trim()) {
      onUpdateFlag(editingFlagId, { label: editFlagLabel.trim(), icon: editFlagIcon, color: editFlagColor });
    }
    cancelEditFlag();
  };

  const settingsTabs = [
    { id: "general", label: "General" },
    { id: "categories", label: "Categories" },
    { id: "flags", label: "Flags" },
    { id: "drive", label: "Google Drive" },
  ];
  const hint = { margin: "0 0 18px", color: "var(--text-dim)", maxWidth: "62ch" };

  return (
    <div>
      <div className="ert-room-top">
        <button className="ert-back" onClick={onBack}><ChevronLeft size={22} /> Back</button>
      </div>
      <div className="ert-ph" style={{ marginTop: 6 }}>
        <h1>App settings</h1>
      </div>

      <div className="ert-seg" role="group" aria-label="Settings section" style={{ marginBottom: 24 }}>
        {settingsTabs.map((t) => (
          <button key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      <div style={{ maxWidth: 720 }}>
        {tab === "general" && <GeneralSettings crewName={crewName} onChangeCrewName={onChangeCrewName} dateFormat={dateFormat} onChangeDateFormat={onChangeDateFormat} theme={theme} onChangeTheme={onChangeTheme} />}

        {tab === "categories" && (
          <div>
            <p style={hint}>Shown as category options when adding or editing a room. Renaming one updates every room already using it.</p>
            <div style={{ borderTop: "1px solid var(--border-soft)" }}>
              {list.map((c) =>
                editingCategory === c ? (
                  <div key={c} className="ert-srow">
                    <input
                      className="ert-input"
                      style={{ height: 38 }}
                      value={editValue}
                      autoFocus
                      aria-label={`Rename ${c}`}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") submitEdit(); if (e.key === "Escape") cancelEdit(); }}
                    />
                    <span style={{ display: "flex", gap: 6, flex: "none" }}>
                      <button className="ert-btn ert-btn-brass" style={{ padding: "7px 14px" }} onClick={submitEdit}><Check size={16} /> Save</button>
                      <button className="ert-btn ert-btn-ghost" style={{ padding: "7px 14px" }} onClick={cancelEdit}>Cancel</button>
                    </span>
                  </div>
                ) : (
                  <div key={c} className="ert-srow">
                    <span style={{ fontWeight: 500 }}>{c}</span>
                    <span style={{ display: "flex", gap: 2, flex: "none" }}>
                      <button className="ert-ibtn sm" aria-label={`Rename ${c}`} title="Rename" onClick={() => startEdit(c)}><Edit2 size={16} /></button>
                      <button className="ert-ibtn sm" aria-label={`Remove ${c}`} title="Remove" onClick={() => onRemoveCategory(c)}><X size={17} /></button>
                    </span>
                  </div>
                )
              )}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <input
                className="ert-input"
                style={{ height: 38 }}
                placeholder="Add a category"
                aria-label="New category name"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); }}
              />
              <button className="ert-btn ert-btn-brass" style={{ flex: "none" }} onClick={submitAdd}><Plus size={17} /> Add</button>
            </div>
          </div>
        )}

        {tab === "flags" && (
          <div>
            <p style={hint}>Status pictograms you can set on a room, like "Permanently closed" or "Moved".</p>
            <div style={{ borderTop: "1px solid var(--border-soft)" }}>
              {flagList.map((f) => {
                const Icon = resolveFlagIcon(f.icon);
                if (editingFlagId === f.id) {
                  return (
                    <div key={f.id} className="ert-panel" style={{ margin: "14px 0", padding: "18px 20px", display: "grid", gap: 14 }}>
                      <input
                        className="ert-input"
                        style={{ height: 38 }}
                        value={editFlagLabel}
                        autoFocus
                        aria-label="Flag name"
                        onChange={(e) => setEditFlagLabel(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Escape") cancelEditFlag(); if (e.key === "Enter") submitEditFlag(); }}
                      />
                      <div><div className="ert-flabel">Icon</div><FlagIconPicker value={editFlagIcon} onChange={setEditFlagIcon} /></div>
                      <div><div className="ert-flabel">Color</div><FlagColorPicker value={editFlagColor} onChange={setEditFlagColor} /></div>
                      <div style={{ display: "flex", gap: 10 }}>
                        <button className="ert-btn ert-btn-brass" onClick={submitEditFlag}><Check size={16} /> Save flag</button>
                        <button className="ert-btn ert-btn-ghost" onClick={cancelEditFlag}>Cancel</button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={f.id} className="ert-srow">
                    <span style={{ display: "flex", alignItems: "center", gap: 12, fontWeight: 500 }}>
                      <Icon size={19} color={f.color} /> {f.label}
                    </span>
                    <span style={{ display: "flex", gap: 2, flex: "none" }}>
                      <button className="ert-ibtn sm" aria-label={`Edit ${f.label}`} title="Edit" onClick={() => startEditFlag(f)}><Edit2 size={16} /></button>
                      <button className="ert-ibtn sm" aria-label={`Remove ${f.label}`} title="Remove" onClick={() => onRemoveFlag(f.id)}><X size={17} /></button>
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="ert-rsec" style={{ marginTop: 34 }}>
              <h2>Add a flag</h2>
              <div className="ert-panel" style={{ padding: "18px 20px", display: "grid", gap: 14 }}>
                <input
                  className="ert-input"
                  style={{ height: 38 }}
                  placeholder="Flag name"
                  aria-label="New flag name"
                  value={newFlagLabel}
                  onChange={(e) => setNewFlagLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitAddFlag(); }}
                />
                <div><div className="ert-flabel">Icon</div><FlagIconPicker value={newFlagIcon} onChange={setNewFlagIcon} /></div>
                <div><div className="ert-flabel">Color</div><FlagColorPicker value={newFlagColor} onChange={setNewFlagColor} /></div>
                <div><button className="ert-btn ert-btn-brass" onClick={submitAddFlag}><Plus size={17} /> Add flag</button></div>
              </div>
            </div>
          </div>
        )}

        {tab === "drive" && (
          <div>
            {!driveAvailable ? (
              <div className="ert-unplayed" style={{ marginBottom: 0 }}>
                <h3>Photos need the hosted site</h3>
                <p style={{ marginBottom: 0 }}>Photo storage uses Google Drive and only works on the hosted site, not in this preview.</p>
              </div>
            ) : (
              <>
                <p style={{ ...hint, marginBottom: 20 }}>
                  Photos upload straight to a Google Drive folder, not a public link. Use this to connect it, or to reconnect if uploads or photos ever start failing. Google's access can expire after a while, and there's no way to tell from here whether the current one has, other than trying it. Reconnecting is always safe and just replaces the old connection.
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: driveConnected ? "var(--success)" : "var(--text-dim)" }} />
                  <span style={{ fontWeight: 500 }}>{driveConnected ? "A connection is on file" : "Not connected yet"}</span>
                </div>
                <button className="ert-btn ert-btn-brass" onClick={onConnectDrive}>
                  <Upload size={17} /> {driveConnected ? "Reconnect Google Drive" : "Connect Google Drive"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   ROOM DETAIL
--------------------------------------------------------------- */
function RoomDetail({ room, members, currentMember, isGuest, onBack, onEdit, onDelete, onUpdate, driveConnected, driveAvailable, getDriveAccessToken, flags, onSearchVenue, onFilterCity, onFilterCountry }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [myRating, setMyRating] = useState(room.ratings[currentMember] || 0);
  const [myDifficulty, setMyDifficulty] = useState((room.difficultyRatings && room.difficultyRatings[currentMember]) || 0);
  const [myScary, setMyScary] = useState((room.scaryRatings && room.scaryRatings[currentMember]) || 0);
  const [myNote, setMyNote] = useState(room.notes[currentMember] || "");
  const [noteSaved, setNoteSaved] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState(null);
  const [previewIndex, setPreviewIndex] = useState(null);
  const [walkthrough, setWalkthrough] = useState(room.walkthrough || "");
  const [walkthroughSaved, setWalkthroughSaved] = useState(false);
  const [editingWalkthrough, setEditingWalkthrough] = useState(false);

  useEffect(() => {
    setMyRating(room.ratings[currentMember] || 0);
    setMyDifficulty((room.difficultyRatings && room.difficultyRatings[currentMember]) || 0);
    setMyScary((room.scaryRatings && room.scaryRatings[currentMember]) || 0);
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
  const clearMyRating = () => {
    setMyRating(0);
    const next = { ...room.ratings };
    delete next[currentMember];
    onUpdate({ ratings: next });
  };
  const saveMyDifficulty = (val) => {
    setMyDifficulty(val);
    onUpdate({ difficultyRatings: { ...(room.difficultyRatings || {}), [currentMember]: val } });
  };
  const clearMyDifficulty = () => {
    setMyDifficulty(0);
    const next = { ...(room.difficultyRatings || {}) };
    delete next[currentMember];
    onUpdate({ difficultyRatings: next });
  };
  const saveMyScary = (val) => {
    setMyScary(val);
    onUpdate({ scaryRatings: { ...(room.scaryRatings || {}), [currentMember]: val } });
  };
  const clearMyScary = () => {
    setMyScary(0);
    const next = { ...(room.scaryRatings || {}) };
    delete next[currentMember];
    onUpdate({ scaryRatings: next });
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
  const [uploadProgress, setUploadProgress] = useState(null); // { done, total } while uploading
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const handlePhotosSelected = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setPhotoError(null);
    setUploadingPhoto(true);
    setUploadProgress({ done: 0, total: files.length });
    const uploadedPhotos = [];
    let failedCount = 0;
    try {
      const token = await getDriveAccessToken();
      for (const file of files) {
        try {
          const uploaded = await uploadPhotoToDrive(file, token);
          uploadedPhotos.push({
            id: uid(),
            driveFileId: uploaded.id,
            thumbFileId: uploaded.thumbId || null,
            name: uploaded.name,
            mimeType: uploaded.mimeType,
            addedBy: currentMember,
          });
        } catch (e) {
          failedCount += 1;
        }
        setUploadProgress((p) => ({ done: p.done + 1, total: p.total }));
      }
      if (uploadedPhotos.length) {
        onUpdate({ photos: [...(room.photos || []), ...uploadedPhotos] });
      }
      if (failedCount) {
        setPhotoError(`${failedCount} of ${files.length} photo${files.length === 1 ? "" : "s"} failed to upload.`);
      }
    } catch (e) {
      setPhotoError(e.message || "Couldn't upload those photos.");
    } finally {
      setUploadingPhoto(false);
      setUploadProgress(null);
    }
  };
  const removePhoto = async (photo) => {
    onUpdate({ photos: room.photos.filter((p) => p.id !== photo.id) });
    try {
      const token = await getDriveAccessToken();
      await deletePhotoFromDrive(photo.driveFileId, token);
      if (photo.thumbFileId) await deletePhotoFromDrive(photo.thumbFileId, token);
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
  const played = room.status === "played";
  const flagDefs = (flags || DEFAULT_FLAGS).filter((f) => (room.flags || []).includes(f.id));
  const who = roomParticipants(room);
  const diffAvg = avgOfMap(room.difficultyRatings);
  const scaryAvg = avgOfMap(room.scaryRatings);
  const hasResult = played && room.result !== "unknown";
  const hasPrice = played && room.price !== "" && room.price !== undefined && room.price !== null;
  const photoCount = room.photos ? room.photos.length : 0;

  return (
    <div>
      <div className="ert-room-top">
        <button className="ert-back" onClick={onBack}><ChevronLeft size={19} /> Back</button>
        {!isGuest && (
          <div style={{ display: "flex", gap: 10 }}>
            <button className="ert-btn ert-btn-ghost" onClick={onEdit}><Edit2 size={15} /> Edit</button>
            {confirmDelete ? (
              <button className="ert-btn ert-btn-danger" onClick={onDelete}>Confirm delete</button>
            ) : (
              <button className="ert-btn ert-btn-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete</button>
            )}
          </div>
        )}
      </div>

      <div className="ert-room">
        <aside className="ert-room-aside">
          <div className="ert-status">
            {played ? <Unlock size={15} color="var(--success)" /> : <Lock size={15} />}
            {played ? "Completed" : "On the wishlist"}
          </div>
          <h1>{room.name}</h1>
          {room.venue && (
            <button className="ert-link" style={{ fontSize: 14 }} onClick={() => onSearchVenue(room.venue, room.status)} title={`See other rooms at ${room.venue}`}>
              {room.venue}
            </button>
          )}

          <div className="ert-facts">
            {(room.city || room.country) && (
              <div className="ert-fact">
                <MapPin size={16} />
                <span>
                  {room.city && <button className="ert-link" onClick={() => onFilterCity(room.city, room.status)} title={`See other rooms in ${room.city}`}>{room.city}</button>}
                  {room.city && room.country ? ", " : ""}
                  {room.country && <button className="ert-link" onClick={() => onFilterCountry(room.country, room.status)} title={`See other rooms in ${room.country}`}>{room.country}</button>}
                </span>
              </div>
            )}
            <div className="ert-fact"><Skull size={16} />{room.difficulty}</div>
            {room.category && <div className="ert-fact"><Tag size={16} />{room.category}</div>}
            {played && room.datePlayed && <div className="ert-fact"><Calendar size={16} />{fmtDate(room.datePlayed)}</div>}
            {hasResult && (
              <div className="ert-fact" style={{ color: room.result === "escaped" ? "var(--success)" : "var(--danger)" }}>
                {room.result === "escaped" ? <Check size={16} /> : <X size={16} />}
                {room.result === "escaped" ? "Escaped" : "Not escaped"}{room.timeNote ? `, ${room.timeNote}` : ""}
              </div>
            )}
            {hasPrice && <div className="ert-fact"><Wallet size={16} />{room.price} {room.currency || "PLN"}</div>}
            {missingPlayers(room).length > 0 && <div className="ert-fact" style={{ color: PARTIAL_GROUP_COLOR }}><PartialGroupIcon room={room} />Not everyone played</div>}
            {flagDefs.map((flag) => {
              const Icon = resolveFlagIcon(flag.icon);
              return <div key={flag.id} className="ert-fact" style={{ color: flag.color }}><Icon size={16} />{flag.label}</div>;
            })}
            {room.lockmeUrl && (
              <div className="ert-fact">
                <ExternalLink size={16} />
                <a href={room.lockmeUrl} target="_blank" rel="noreferrer" className="ert-link" style={{ color: "var(--brass-bright)" }}>Open on lock.me</a>
              </div>
            )}
          </div>

          {played && (
            <>
              <div className="ert-who">
                {MEMBERS.map((m) => {
                  const on = who.includes(m);
                  return (
                    <div key={m} className={`ert-pchip${on ? "" : " off"}`} title={on ? `${m} played` : `${m} sat this one out`}>
                      <span className="c"><User size={19} /></span>
                      {m}
                    </div>
                  );
                })}
              </div>
              <div className="ert-avgs">
                <div>
                  <div className="ert-avg-big">{fmtAvg(avg)}</div>
                  <div className="ert-avg-cap">group average out of 10</div>
                </div>
                {(diffAvg !== null || scaryAvg !== null) && (
                  <div style={{ display: "grid", gap: 10 }}>
                    {diffAvg !== null && <div className="ert-avg-small" style={{ color: "var(--danger)" }}><Dumbbell size={17} />{diffAvg.toFixed(1)}<small>difficulty</small></div>}
                    {scaryAvg !== null && <div className="ert-avg-small" style={{ color: "var(--teal)" }}><Ghost size={17} />{scaryAvg.toFixed(1)}<small>scariness</small></div>}
                  </div>
                )}
              </div>
            </>
          )}
        </aside>

        <div>
          {!played && (
            <div className="ert-unplayed">
              <h3>Not played yet</h3>
              <p>{isGuest ? "Once the crew has played it, ratings, notes and photos show up here." : "Once you've played it, mark it as played to unlock ratings, notes and photos."}</p>
              {!isGuest && <button className="ert-btn ert-btn-brass" onClick={markPlayed}><Unlock size={16} /> Mark as played</button>}
            </div>
          )}

          {played && (
            <div className="ert-rsec">
              <h2>Your ratings</h2>
              {isGuest ? (
                <EmptyNote text="Guests can read ratings and notes but can't add their own." />
              ) : (
                <div className="ert-panel ert-panel-rate">
                  <RatingControl label="Rating" value={myRating} max={10} step={0.5} onChange={saveMyRating} onClear={clearMyRating} />
                  <RatingControl label="Difficulty" value={myDifficulty} max={6} step={1} icon={Dumbbell} solid={false} color="var(--danger)" onChange={saveMyDifficulty} onClear={clearMyDifficulty} />
                  <RatingControl label="Scariness" value={myScary} max={6} step={1} icon={Ghost} color="var(--teal)" onChange={saveMyScary} onClear={clearMyScary} />
                </div>
              )}
            </div>
          )}

          {played && (
            <div className="ert-rsec">
              <h2>Notes</h2>
              {members.map((m) => {
                const isMe = m === currentMember;
                const isEditingThis = isMe && editingNote;
                return (
                  <div key={m} className={`ert-note${isMe ? " me" : ""}`}>
                    <b>{m}{isMe ? " (you)" : ""}</b>
                    <span className="n">
                      {typeof room.ratings[m] === "number" && room.ratings[m]}
                      {isMe && !isEditingThis && !isGuest && (
                        <button className="ert-btn ert-btn-ghost" style={{ padding: "4px 11px", fontSize: 12.5, fontFamily: "'Inter', sans-serif" }} onClick={() => setEditingNote(true)}>
                          <Edit2 size={13} /> Edit
                        </button>
                      )}
                    </span>
                    {isEditingThis ? (
                      <div className="full" style={{ marginTop: 8 }}>
                        <textarea
                          className="ert-textarea"
                          rows={4}
                          placeholder="Your impressions: puzzle quality, story, scares, whether it's worth recommending"
                          value={myNote}
                          autoFocus
                          onChange={(e) => setMyNote(e.target.value)}
                        />
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                          <button className="ert-btn ert-btn-brass" disabled={!noteDirty} style={{ opacity: noteDirty ? 1 : 0.5 }} onClick={() => { saveMyNote(); setEditingNote(false); }}>
                            <Check size={14} /> Save note
                          </button>
                          <button className="ert-btn ert-btn-ghost" onClick={() => { setMyNote(room.notes[currentMember] || ""); setEditingNote(false); }}>Cancel</button>
                          {noteSaved && <span style={{ fontSize: 12.5, color: "var(--success)" }}>Saved.</span>}
                        </div>
                      </div>
                    ) : (
                      <p style={{ color: room.notes[m] ? "var(--text)" : "var(--text-dim)" }}>
                        {room.notes[m] || (isMe ? "No note yet. Use Edit to add yours." : "No note yet")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {played && (
            <div className="ert-rsec">
              <h2>
                Walkthrough
                {!isGuest && !editingWalkthrough && (
                  <button className="ert-link" style={{ fontSize: 13, fontFamily: "'Inter', sans-serif", fontWeight: 400 }} onClick={() => setEditingWalkthrough(true)}>
                    {room.walkthrough ? "Edit" : "Add"}
                  </button>
                )}
              </h2>
              {editingWalkthrough ? (
                <>
                  <textarea
                    className="ert-textarea"
                    rows={6}
                    placeholder="Step through how you solved it: puzzle order, hint usage, anything worth remembering next time"
                    value={walkthrough}
                    autoFocus
                    onChange={(e) => setWalkthrough(e.target.value)}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                    <button className="ert-btn ert-btn-brass" disabled={!walkthroughDirty} style={{ opacity: walkthroughDirty ? 1 : 0.5 }} onClick={() => { saveWalkthrough(); setEditingWalkthrough(false); }}>
                      <Check size={14} /> Save walkthrough
                    </button>
                    <button className="ert-btn ert-btn-ghost" onClick={() => { setWalkthrough(room.walkthrough || ""); setEditingWalkthrough(false); }}>Cancel</button>
                    {walkthroughSaved && <span style={{ fontSize: 12.5, color: "var(--success)" }}>Saved.</span>}
                  </div>
                </>
              ) : (
                <p style={{ margin: 0, maxWidth: "68ch", whiteSpace: "pre-wrap", lineHeight: 1.6, color: room.walkthrough ? "var(--text)" : "var(--text-dim)" }}>
                  {room.walkthrough || "No walkthrough yet. Shared by the whole crew."}
                </p>
              )}
            </div>
          )}

          <div className="ert-rsec">
            <h2>Photos{photoCount > 0 && <small>{plural(photoCount, "photo")}</small>}</h2>

            {!driveAvailable ? (
              <EmptyNote text="Photo upload uses Google Drive and only works on the hosted site, not in this preview." />
            ) : !driveConnected ? (
              isGuest ? (
                <EmptyNote text="No photos yet." />
              ) : (
                <EmptyNote text="Google Drive isn't connected yet. Connect it from App settings (Google Drive tab) to enable photo uploads." />
              )
            ) : (
              <>
                {!isGuest && (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setIsDraggingOver(false); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingOver(false);
                      if (e.dataTransfer.files && e.dataTransfer.files.length) handlePhotosSelected(e.dataTransfer.files);
                    }}
                    style={{
                      marginBottom: 14, padding: 16, borderRadius: 14,
                      border: `1.5px dashed ${isDraggingOver ? "var(--brass)" : "var(--border)"}`,
                      background: isDraggingOver ? "var(--surface)" : "transparent",
                      transition: "border-color 0.15s, background 0.15s",
                    }}
                  >
                    <input
                      id={`photo-input-${room.id}`}
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: "none" }}
                      onChange={(e) => { handlePhotosSelected(e.target.files); e.target.value = ""; }}
                    />
                    <label
                      htmlFor={`photo-input-${room.id}`}
                      className="ert-btn ert-btn-ghost"
                      style={{ cursor: "pointer", opacity: uploadingPhoto ? 0.6 : 1, pointerEvents: uploadingPhoto ? "none" : "auto" }}
                    >
                      <Upload size={15} /> {uploadingPhoto ? (uploadProgress ? `Uploading ${uploadProgress.done}/${uploadProgress.total}` : "Uploading") : "Upload photos"}
                    </label>
                    <span style={{ fontSize: 13, color: "var(--text-dim)", marginLeft: 12 }}>or drag photos here</span>
                    {photoError && <div style={{ color: "var(--danger)", fontSize: 12.5, marginTop: 8 }}>{photoError}</div>}
                  </div>
                )}

                {photoCount === 0 ? (
                  <EmptyNote text="No photos yet." />
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
                    {room.photos.map((p, i) => (
                      <DrivePhoto key={p.id} aspect="4 / 3" photo={p} getDriveAccessToken={getDriveAccessToken} onRemove={isGuest ? undefined : () => removePhoto(p)} onPreview={() => setPreviewIndex(i)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {previewIndex !== null && room.photos[previewIndex] && (
        <PhotoLightbox
          photos={room.photos}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          getDriveAccessToken={getDriveAccessToken}
        />
      )}
    </div>
  );
}

function DrivePhoto({ photo, getDriveAccessToken, onRemove, onPreview, aspect }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const containerRef = React.useRef(null);

  // Un-arm the delete confirmation automatically: after a few seconds of no
  // second click, or as soon as the user clicks anywhere outside this photo.
  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(false), 3000);
    const handleClickAway = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setConfirmDelete(false);
      }
    };
    document.addEventListener("mousedown", handleClickAway);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickAway);
    };
  }, [confirmDelete]);

  // Only start fetching once this thumbnail actually scrolls near the
  // viewport, rather than every photo in the grid firing a request at once.
  useEffect(() => {
    if (isVisible) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setIsVisible(true);
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    (async () => {
      try {
        const token = await getDriveAccessToken();
        const url = await fetchDriveThumbnailUrl(photo, token);
        if (!cancelled) setSrc(url);
      } catch (e) {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [photo.driveFileId, isVisible]);

  // Auto-revert the confirm state if the second click never comes, so a
  // stray tap days later doesn't suddenly delete something.
  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmDelete]);

  return (
    <div ref={containerRef} style={{ position: "relative", borderRadius: 12, overflow: "hidden", aspectRatio: aspect || "1", background: "var(--surface-raised)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {failed ? (
        <span style={{ fontSize: 13, color: "var(--text-dim)", padding: 8, textAlign: "center" }}>Couldn't load</span>
      ) : !src ? (
        <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{isVisible ? "loading…" : ""}</span>
      ) : (
        <img
          src={src}
          alt=""
          onClick={onPreview}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", cursor: "pointer" }}
        />
      )}
      {onRemove && (
        <button
          className={`ert-photo-x${confirmDelete ? " armed" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            if (confirmDelete) {
              onRemove();
            } else {
              setConfirmDelete(true);
            }
          }}
          title={confirmDelete ? "Click again to delete" : "Remove photo"}
          aria-label={confirmDelete ? "Confirm removing this photo" : "Remove photo"}
        >
          <X size={14} />
          {confirmDelete ? "Remove" : null}
        </button>
      )}
    </div>
  );
}
 
function PhotoLightbox({ photos, index, onIndexChange, onClose, getDriveAccessToken }) {
  const [loaded, setLoaded] = useState({ id: null, url: null }); // full-size image that finished loading
  const [failed, setFailed] = useState(false);
  const [direction, setDirection] = useState(null); // 'next' | 'prev' | null (initial open)
  const photo = photos[index];
  const hasMultiple = photos.length > 1;

  // What to show right now: the full-size photo if it's loaded or already
  // cached (so swiping to a prefetched photo is instant), otherwise the small
  // grid thumbnail as a placeholder while the full-size one downloads.
  const fullSrc = loaded.id === photo.id ? loaded.url : driveBlobCache.get(photo.driveFileId) || null;
  const placeholderSrc = fullSrc ? null : driveThumbCache.get(photo.thumbFileId || photo.driveFileId) || null;

  // Prevent the page behind the lightbox from scrolling while it's open.
  // otherwise a swipe to change photos also drags the page underneath.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevTouchAction = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "pan-y pinch-zoom";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.touchAction = prevTouchAction;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    (async () => {
      try {
        const token = await getDriveAccessToken();
        const url = await fetchDrivePhotoUrl(photo.driveFileId, token);
        if (!cancelled) setLoaded({ id: photo.id, url });
      } catch (e) {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [photo.id, photo.driveFileId]);

  // Once the current photo is showing, quietly fetch its neighbours (the one
  // in the direction of travel first) so the next swipe is instant.
  const currentReady = loaded.id === photo.id;
  useEffect(() => {
    if (!hasMultiple || !currentReady) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const token = await getDriveAccessToken();
        const n = photos.length;
        const offsets = direction === "prev" ? [-1, 1, -2] : [1, -1, 2];
        for (const o of offsets) {
          if (cancelled) return;
          const neighbour = photos[(((index + o) % n) + n) % n];
          if (!neighbour || neighbour.id === photo.id) continue;
          await prefetchDrivePhoto(neighbour.driveFileId, token);
        }
      } catch (e) { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [index, currentReady, photos.length, hasMultiple]);

  const goPrev = useCallback(() => {
    if (!hasMultiple) return;
    setDirection("prev");
    onIndexChange((index - 1 + photos.length) % photos.length);
  }, [index, photos.length, hasMultiple, onIndexChange]);
  const goNext = useCallback(() => {
    if (!hasMultiple) return;
    setDirection("next");
    onIndexChange((index + 1) % photos.length);
  }, [index, photos.length, hasMultiple, onIndexChange]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, goPrev, goNext]);

  // Swipe support for touch devices. Horizontal drags of 40px+ change
  // photo, anything more vertical (or too small) is ignored so scrolling
  // gestures aren't mistaken for a swipe.
  const touchStart = React.useRef(null);
  const handleTouchStart = (e) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const handleTouchEnd = (e) => {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) goNext();
    else goPrev();
  };

  const navButtonStyle = {
    position: "fixed", top: "50%", transform: "translateY(-50%)", zIndex: 102,
    background: "rgba(20,22,28,0.7)", border: "1px solid var(--border)", borderRadius: "50%",
    width: 42, height: 42, display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer", color: "var(--text)",
  };

  return (
    <div
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{
        position: "fixed", inset: 0, background: "rgba(10,11,15,0.88)", zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24, cursor: "zoom-out", touchAction: "pan-y pinch-zoom",
      }}
    >
      {hasMultiple && (
        <button
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          style={{ ...navButtonStyle, left: 16 }}
          title="Previous photo"
        >
          <ChevronLeft size={20} />
        </button>
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        className="ert-card-raised"
        style={{
          position: "relative", padding: 16, borderRadius: 14, cursor: "default",
          maxWidth: "min(560px, 85vw)", maxHeight: "80vh",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
        }}
      >
        <div style={{ width: "100%", display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} className="ert-btn ert-btn-ghost" style={{ padding: "5px 8px" }}>
            <X size={15} />
          </button>
        </div>

        <div
          key={photo.id}
          className={direction === "next" ? "ert-slide-next" : direction === "prev" ? "ert-slide-prev" : "ert-slide-fade"}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 120, maxHeight: "62vh", width: "100%" }}
        >
          {failed ? (
            <span style={{ fontSize: 12.5, color: "var(--text-dim)", padding: 24 }}>Couldn't load this photo.</span>
          ) : fullSrc ? (
            <img
              src={fullSrc}
              alt=""
              style={{ maxWidth: "100%", maxHeight: "62vh", borderRadius: 8, display: "block" }}
            />
          ) : placeholderSrc ? (
            <img
              src={placeholderSrc}
              alt=""
              style={{ width: "100%", maxHeight: "62vh", objectFit: "contain", borderRadius: 8, display: "block", opacity: 0.8 }}
            />
          ) : (
            <span className="ert-mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>loading…</span>
          )}
        </div>

        {(hasMultiple || photo.addedBy || photo.roomName) && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", fontSize: 11.5, color: "var(--text-dim)" }}>
            <span>
              {photo.roomName
                ? `${photo.roomName}${photo.city ? `, ${photo.city}` : ""}`
                : photo.addedBy
                ? `Added by ${photo.addedBy}`
                : ""}
            </span>
            {hasMultiple && <span className="ert-mono">{index + 1} / {photos.length}</span>}
          </div>
        )}
      </div>

      {hasMultiple && (
        <button
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          style={{ ...navButtonStyle, right: 16 }}
          title="Next photo"
        >
          <ChevronRight size={20} />
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   ADD / EDIT ROOM FORM
--------------------------------------------------------------- */
function RoomForm({ room, existingRooms, categories, flags, onCancel, onSave }) {
  const [form, setForm] = useState(room);
  const set = (patch) => setForm({ ...form, ...patch });
  const toggleFlag = (id) => {
    const current = form.flags || [];
    set({ flags: current.includes(id) ? current.filter((f) => f !== id) : [...current, id] });
  };
  const participants = form.participants && form.participants.length ? form.participants : MEMBERS;
  const toggleParticipant = (name) => {
    set({ participants: participants.includes(name) ? participants.filter((p) => p !== name) : [...participants, name] });
  };

  const cityOptions = useMemo(
    () => Array.from(new Set((existingRooms || []).map((r) => r.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pl")),
    [existingRooms]
  );

  const canSave = form.name.trim().length > 0;

  return (
    <div className="ert-card" style={{ padding: 22, maxWidth: 640 }}>
      <div className="ert-display" style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>
        {room.name ? "Edit room" : "Add a room"}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Room name *"><input className="ert-input" value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Venue / company"><input className="ert-input" value={form.venue} onChange={(e) => set({ venue: e.target.value })} /></Field>
        <Field label="City">
          <AutocompleteInput value={form.city} onChange={(v) => set({ city: v })} options={cityOptions} />
        </Field>
        <Field label="Country"><input className="ert-input" value={form.country} onChange={(e) => set({ country: e.target.value })} /></Field>
        <Field label="Category">
          <select className="ert-select" value={form.category} onChange={(e) => set({ category: e.target.value })}>
            {(categories && categories.length ? categories : DEFAULT_CATEGORIES).map((c) => <option key={c} value={c}>{c}</option>)}
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
            <Field label="Price paid">
              <input type="number" min="0" step="0.01" className="ert-input" placeholder="0" value={form.price || ""} onChange={(e) => set({ price: e.target.value })} />
            </Field>
            <Field label="Currency">
              <input className="ert-input" value={form.currency || "PLN"} onChange={(e) => set({ currency: e.target.value })} />
            </Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginBottom: 6 }}>Who played</div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {MEMBERS.map((m) => {
                  const checked = participants.includes(m);
                  return (
                    <div
                      key={m}
                      onClick={() => toggleParticipant(m)}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, cursor: "pointer", width: 58 }}
                    >
                      <div
                        style={{
                          width: 36, height: 36, borderRadius: "50%",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: checked ? "var(--brass)" : "var(--surface-raised)",
                          border: `1px solid ${checked ? "var(--brass)" : "var(--border)"}`,
                          transition: "background 0.15s, border-color 0.15s",
                        }}
                      >
                        <User size={17} color={checked ? "#17140c" : "var(--text-dim)"} />
                      </div>
                      <span style={{ fontSize: 11, color: checked ? "var(--text)" : "var(--text-dim)", textAlign: "center" }}>{m}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginBottom: 6 }}>Flags</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {(flags && flags.length ? flags : DEFAULT_FLAGS).map((f) => {
            const Icon = resolveFlagIcon(f.icon);
            const checked = (form.flags || []).includes(f.id);
            return (
              <div
                key={f.id}
                onClick={() => toggleFlag(f.id)}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, cursor: "pointer", width: 68 }}
              >
                <div
                  style={{
                    width: 36, height: 36, borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: checked ? f.color : "var(--surface-raised)",
                    border: `1px solid ${checked ? f.color : "var(--border)"}`,
                    transition: "background 0.15s, border-color 0.15s",
                  }}
                >
                  <Icon size={17} color={checked ? "#17140c" : "var(--text-dim)"} />
                </div>
                <span style={{ fontSize: 11, color: checked ? "var(--text)" : "var(--text-dim)", textAlign: "center" }}>{f.label}</span>
              </div>
            );
          })}
        </div>
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

function AutocompleteInput({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const matches = options
    .filter((o) => o.toLowerCase().includes((value || "").toLowerCase()) && o.toLowerCase() !== (value || "").toLowerCase())
    .slice(0, 6);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        className="ert-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
      />
      {open && matches.length > 0 && (
        <div
          className="ert-card-raised ert-scrollbar"
          style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, maxHeight: 180, overflowY: "auto", zIndex: 20, padding: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
        >
          {matches.map((o) => (
            <div
              key={o}
              onClick={() => { onChange(o); setOpen(false); }}
              style={{ padding: "7px 10px", borderRadius: 6, fontSize: 13, cursor: "pointer" }}
              onMouseDown={(e) => e.preventDefault()}
            >
              {o}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
 
/* ---------------------------------------------------------------
   SETTINGS
--------------------------------------------------------------- */
/* ---------------------------------------------------------------
   TRIPS
--------------------------------------------------------------- */
const TRIP_SORT_OPTIONS = [
  { id: "start-desc", label: "Trip date (newest)" },
  { id: "start-asc", label: "Trip date (oldest)" },
  { id: "date-desc", label: "Date added (newest)" },
  { id: "date-asc", label: "Date added (oldest)" },
  { id: "alpha", label: "Alphabetical (A to Z)" },
];

function TripFilterPopover({ cities, selectedCities, onToggleCity, onClear }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);
  const btnRef = React.useRef(null);
  const panelStyle = usePopoverPosition(open, setOpen, ref, btnRef, 360, 440);

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        ref={btnRef}
        type="button"
        className="ert-btn ert-btn-ghost"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ fontWeight: 500, borderColor: selectedCities.length ? "var(--brass)" : undefined, color: selectedCities.length ? "var(--brass-bright)" : undefined }}
      >
        <SlidersHorizontal size={16} />
        Filters
        {selectedCities.length > 0 && <span className="ert-fbadge">{selectedCities.length}</span>}
      </button>

      {open && panelStyle && (
        <div className="ert-card-raised ert-scrollbar" role="dialog" aria-label="Filters" style={{ ...panelStyle, overflowY: "auto", zIndex: 20, padding: "16px 18px 6px", boxShadow: "0 12px 32px rgba(0,0,0,0.45)" }}>
          <div className="ert-pop-h">
            <span>Filters</span>
            {selectedCities.length > 0 && <button type="button" className="ert-clear" onClick={onClear}>Clear all</button>}
          </div>
          {cities.length === 0 ? <EmptyNote text="Nothing to filter yet." /> : <FilterSection label="City" items={cities} selected={selectedCities} onToggle={onToggleCity} />}
        </div>
      )}
    </div>
  );
}

function sortTrips(trips, sortBy) {
  const arr = [...trips];
  switch (sortBy) {
    case "start-asc":
      return arr.sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
    case "date-desc":
      return arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    case "date-asc":
      return arr.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    case "alpha":
      return arr.sort((a, b) => a.name.localeCompare(b.name, "pl"));
    case "start-desc":
    default:
      return arr.sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));
  }
}

function TripRow({ trip, rooms, onOpen }) {
  const stats = tripStats(trip, rooms);
  const range = trip.startDate
    ? `${fmtDate(trip.startDate)}${trip.endDate && trip.endDate !== trip.startDate ? ` to ${fmtDate(trip.endDate)}` : ""}`
    : "";
  return (
    <button type="button" className="ert-lrow no-rank" onClick={() => onOpen(trip.id)} style={{ gridTemplateColumns: "minmax(0, 1fr) auto auto 22px" }}>
      <span>
        <span className="ert-r-title" style={{ fontSize: 18 }}>{trip.name || "Untitled trip"}</span>
        <span className="ert-r-sub" style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 4 }}>
          {trip.city && <span style={{ display: "flex", alignItems: "center", gap: 6 }}><MapPin size={13} />{trip.city}</span>}
          {range && <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Calendar size={13} />{range}</span>}
        </span>
      </span>
      <span style={{ textAlign: "center", minWidth: 56 }}>
        <span className="ert-display" style={{ display: "block", fontSize: 19, fontWeight: 700 }}>{stats.count}</span>
        <span className="ert-r-sub" style={{ fontSize: 12.5 }}>{stats.count === 1 ? "room" : "rooms"}</span>
      </span>
      <span style={{ textAlign: "center", minWidth: 64 }}>
        <span className="ert-score" style={{ display: "block", textAlign: "center", color: stats.avg !== null ? undefined : "var(--text-dim)" }}>{fmtAvg(stats.avg)}</span>
        <span className="ert-r-sub" style={{ fontSize: 12.5, marginTop: 4 }}>average</span>
      </span>
      <ChevronRight size={18} color="var(--text-dim)" />
    </button>
  );
}

function defaultTripFilters() {
  return { search: "", selectedCities: [], sortBy: "start-desc" };
}

function TripsView({ trips, rooms, onOpen, onNew, isGuest, filters, onFiltersChange }) {
  const { search, selectedCities, sortBy } = filters;
  const patch = (p) => onFiltersChange({ ...filters, ...p });

  const cities = useMemo(() => Array.from(new Set(trips.map((t) => t.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pl")), [trips]);
  const toggleCity = (c) => patch({ selectedCities: selectedCities.includes(c) ? selectedCities.filter((x) => x !== c) : [...selectedCities, c] });
  const hasActiveFilters = !!search || selectedCities.length > 0;
  const clearAll = () => patch({ search: "", selectedCities: [] });

  const filtered = trips.filter((t) => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (selectedCities.length && !selectedCities.includes(t.city)) return false;
    return true;
  });
  const sorted = sortTrips(filtered, sortBy);
  const isDateGrouped = sortBy === "start-desc" || sortBy === "start-asc";
  const yearGroups = isDateGrouped ? groupByYear(sorted, "startDate") : [];

  const byCity = useMemo(() => {
    const map = {};
    trips.forEach((t) => { if (t.city) map[t.city] = (map[t.city] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [trips]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 160, maxWidth: 600 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--text-dim)" }} />
          <input className="ert-input" style={{ paddingLeft: 30 }} placeholder="Search trips" value={search} onChange={(e) => patch({ search: e.target.value })} />
        </div>
        <SortPopover options={TRIP_SORT_OPTIONS} sortBy={sortBy} onChange={(v) => patch({ sortBy: v })} />
        <TripFilterPopover cities={cities} selectedCities={selectedCities} onToggleCity={toggleCity} onClear={() => patch({ selectedCities: [] })} />
        {hasActiveFilters && (
          <button className="ert-btn ert-btn-ghost" onClick={clearAll} title="Clear filters" style={{ flexShrink: 0, padding: "8px 9px" }}>
            <FilterX size={14} />
          </button>
        )}
        {!isGuest && (
          <button className="ert-btn ert-btn-brass" onClick={onNew} style={{ flexShrink: 0 }}>
            <Plus size={15} /> New trip
          </button>
        )}
        <span className="ert-count">
          {sorted.length} trip{sorted.length === 1 ? "" : "s"} total
        </span>
      </div>

      {trips.length === 0 ? (
        <EmptyNote text="No trips yet. Group the rooms from your next city trip together here." />
      ) : (
        <div className="ert-split">
          <div>
            {sorted.length === 0 ? (
              <EmptyNote text="No trips match those filters." />
            ) : isDateGrouped ? (
              yearGroups.map((group) => (
                <div key={group.year}>
                  <YearDivider year={group.year} count={group.items.length} itemLabel="trip" />
                  <div>
                    {group.items.map((t) => <TripRow key={t.id} trip={t} rooms={rooms} onOpen={onOpen} />)}
                  </div>
                </div>
              ))
            ) : (
              sorted.map((t) => <TripRow key={t.id} trip={t} rooms={rooms} onOpen={onOpen} />)
            )}
          </div>

          {byCity.length > 0 && (
            <aside>
              <div className="ert-sidehead" style={isDateGrouped ? undefined : { paddingTop: 0 }}>
                <b>Most visited cities</b>
              </div>
              <div style={{ paddingTop: 6 }}>
                {byCity.map(([city, count]) => (
                  <BarRow key={city} label={city} count={count} max={byCity[0][1]} />
                ))}
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function TripForm({ trip, rooms, onCancel, onSave }) {
  const [form, setForm] = useState(trip);
  const set = (patch) => setForm({ ...form, ...patch });

  const inRange = (r) => {
    if (!r.datePlayed) return false;
    if (form.startDate && r.datePlayed < form.startDate) return false;
    if (form.endDate && r.datePlayed > form.endDate) return false;
    return true;
  };

  // Suggest completed rooms played within the date range (and matching city,
  // if one's set) that aren't already selected -- this is the common case:
  // several rooms played over a few days in one city.
  const suggestions = useMemo(() => {
    if (!form.startDate) return [];
    return rooms.filter((r) => !form.roomIds.includes(r.id) && inRange(r) && (!form.city || r.city === form.city));
  }, [rooms, form.startDate, form.endDate, form.city, form.roomIds]);

  const toggleRoom = (id) => {
    set({ roomIds: form.roomIds.includes(id) ? form.roomIds.filter((x) => x !== id) : [...form.roomIds, id] });
  };
  const addAllSuggestions = () => {
    set({ roomIds: [...form.roomIds, ...suggestions.map((r) => r.id)] });
  };

  const canSave = form.name.trim().length > 0;
  const selectedRooms = rooms.filter((r) => form.roomIds.includes(r.id));

  return (
    <div className="ert-card" style={{ padding: 22, maxWidth: 640 }}>
      <div className="ert-display" style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>
        {trip.name ? "Edit trip" : "New trip"}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Trip name *"><input className="ert-input" placeholder="e.g. Wrocław weekend" value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="City"><input className="ert-input" value={form.city} onChange={(e) => set({ city: e.target.value })} /></Field>
        <Field label="Start date"><input type="date" className="ert-input" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
        <Field label="End date"><input type="date" className="ert-input" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} /></Field>
      </div>

      {suggestions.length > 0 && (
        <div style={{ marginTop: 18, background: "var(--surface-raised)", borderRadius: 8, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Rooms played in this window</span>
            <button className="ert-btn ert-btn-ghost" style={{ padding: "3px 8px", fontSize: 11.5 }} onClick={addAllSuggestions}>Add all</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {suggestions.map((r) => (
              <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={form.roomIds.includes(r.id)} onChange={() => toggleRoom(r.id)} />
                {r.name} <span style={{ color: "var(--text-dim)", fontSize: 11.5 }}>{r.datePlayed}{r.city ? `, ${r.city}` : ""}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginBottom: 6 }}>Rooms on this trip ({selectedRooms.length})</div>
        {selectedRooms.length === 0 ? (
          <EmptyNote text="No rooms added yet. Pick a date range above, or add rooms after saving." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {selectedRooms.map((r) => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface-raised)", padding: "6px 10px", borderRadius: 6, fontSize: 13 }}>
                <span>{r.name}</span>
                <button className="ert-btn ert-btn-ghost" style={{ padding: "2px 7px" }} onClick={() => toggleRoom(r.id)}><X size={11} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button className="ert-btn ert-btn-brass" disabled={!canSave} style={{ opacity: canSave ? 1 : 0.5 }} onClick={() => canSave && onSave(form)}>
          <Check size={14} /> Save trip
        </button>
        <button className="ert-btn ert-btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function TripDetail({ trip, rooms, currentMember, isGuest, onBack, onEdit, onDelete, onUpdate, onOpenRoom, flags }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notes, setNotes] = useState(trip.notes || "");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [addingRooms, setAddingRooms] = useState(false);
  const [ranking, setRanking] = useState(false);
  const [addSearch, setAddSearch] = useState("");

  useEffect(() => {
    setNotes(trip.notes || "");
    setEditingNotes(false);
    setNotesSaved(false);
  }, [trip.id]);

  useEffect(() => {
    if (!addingRooms && !ranking) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { setAddingRooms(false); setRanking(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addingRooms, ranking]);

  const stats = tripStats(trip, rooms);
  const notesDirty = notes !== (trip.notes || "");
  const saveNotes = () => {
    onUpdate({ notes });
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 1500);
  };

  const myRanking = useMemo(
    () => reconcileRanking((trip.votes && trip.votes[currentMember]) || [], trip.roomIds),
    [trip.votes, trip.roomIds, currentMember]
  );
  const moveMyRanking = (fromIdx, toIdx) => {
    if (toIdx < 0 || toIdx >= myRanking.length) return;
    const next = [...myRanking];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    onUpdate({ votes: { ...(trip.votes || {}), [currentMember]: next } });
  };
  const groupFavorites = useMemo(() => groupFavoritesForTrip(trip, stats.rooms), [trip, stats.rooms]);

  const removeRoom = (roomId) => {
    onUpdate({ roomIds: trip.roomIds.filter((id) => id !== roomId) });
  };
  const addRoom = (roomId) => {
    onUpdate({ roomIds: [...trip.roomIds, roomId] });
  };
  const addableRooms = rooms.filter(
    (r) => r.status === "played" && !trip.roomIds.includes(r.id) && (!addSearch || normSearch(r.name).includes(normSearch(addSearch)))
  );
  const range = trip.startDate
    ? `${fmtDate(trip.startDate)}${trip.endDate && trip.endDate !== trip.startDate ? ` to ${fmtDate(trip.endDate)}` : ""}`
    : "";

  return (
    <div>
      <div className="ert-room-top">
        <button className="ert-back" onClick={onBack}><ChevronLeft size={22} /> Back</button>
        {!isGuest && (
          <div style={{ display: "flex", gap: 10 }}>
            <button className="ert-btn ert-btn-ghost" onClick={() => setAddingRooms(true)}><Plus size={17} /> Add rooms</button>
            <button className="ert-btn ert-btn-ghost" onClick={onEdit}><Edit2 size={17} /> Edit</button>
            {confirmDelete ? (
              <button className="ert-btn ert-btn-danger" onClick={onDelete}>Confirm delete</button>
            ) : (
              <button className="ert-btn ert-btn-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={17} /> Delete</button>
            )}
          </div>
        )}
      </div>

      <div className="ert-room">
        <aside className="ert-room-aside">
          <div className="ert-status"><Plane size={17} color="var(--brass)" /> Trip</div>
          <h1>{trip.name || "Untitled trip"}</h1>
          <div className="ert-facts">
            {trip.city && <div className="ert-fact"><MapPin size={18} />{trip.city}</div>}
            {range && <div className="ert-fact"><Calendar size={18} />{range}</div>}
          </div>
          <div className="ert-aside-stats">
            <div><b>{stats.count}</b><span>{stats.count === 1 ? "room" : "rooms"}</span></div>
            <div><b>{fmtAvg(stats.avg)}</b><span>group average</span></div>
            <div><b>{stats.escapeRate === null ? "-" : `${stats.escapeRate}%`}</b><span>escape rate</span></div>
            <div><b>{stats.totalSpent === null ? "-" : stats.totalSpent}</b><span>{stats.totalSpent === null ? "total spent" : `${stats.spentCurrency} spent`}</span></div>
          </div>
        </aside>

        <div>
          <div className="ert-rsec">
            <h2>
              Summary
              {!isGuest && !editingNotes && (
                <button className="ert-link" style={{ fontSize: 14, fontFamily: "'Inter', sans-serif", fontWeight: 400 }} onClick={() => setEditingNotes(true)}>
                  {trip.notes ? "Edit" : "Add"}
                </button>
              )}
            </h2>
            {editingNotes ? (
              <>
                <textarea className="ert-textarea" rows={5} value={notes} autoFocus placeholder="Highlights, favorites, or a running joke from the trip" onChange={(e) => setNotes(e.target.value)} />
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                  <button className="ert-btn ert-btn-brass" disabled={!notesDirty} style={{ opacity: notesDirty ? 1 : 0.5 }} onClick={() => { saveNotes(); setEditingNotes(false); }}>
                    <Check size={16} /> Save summary
                  </button>
                  <button className="ert-btn ert-btn-ghost" onClick={() => { setNotes(trip.notes || ""); setEditingNotes(false); }}>Cancel</button>
                  {notesSaved && <span style={{ fontSize: 13, color: "var(--success)" }}>Saved.</span>}
                </div>
              </>
            ) : (
              <p style={{ margin: 0, maxWidth: "68ch", whiteSpace: "pre-wrap", lineHeight: 1.6, color: trip.notes ? "var(--text)" : "var(--text-dim)" }}>
                {trip.notes || (isGuest ? "No summary yet." : "No summary yet. Shared by the whole crew.")}
              </p>
            )}
          </div>

          <div className="ert-rsec">
            <h2>Rooms on this trip{stats.rooms.length > 0 && <small>{plural(stats.rooms.length, "room")}</small>}</h2>
            {stats.rooms.length === 0 ? (
              <EmptyNote text="No rooms on this trip yet." />
            ) : (
              <div className="ert-tgrid" style={{ marginTop: 4 }}>
                {stats.rooms.map((r) => (
                  <div key={r.id} className="ert-tilewrap">
                    <RoomCard room={r} onOpen={() => onOpenRoom(r.id)} flags={flags} />
                    {!isGuest && <TripRoomRemove roomName={r.name} onRemove={() => removeRoom(r.id)} />}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="ert-rsec">
            <h2>
              Group favorites
              {!isGuest && (
                <button
                  className="ert-btn ert-btn-ghost"
                  style={{ padding: "6px 14px", fontSize: 13, fontFamily: "'Inter', sans-serif", alignSelf: "center", opacity: myRanking.length === 0 ? 0.5 : 1 }}
                  disabled={myRanking.length === 0}
                  title={myRanking.length === 0 ? "Add rooms to this trip first" : "Order this trip's rooms from your favorite to least favorite"}
                  onClick={() => setRanking(true)}
                >
                  <ListOrdered size={16} /> Rank your favorites
                </button>
              )}
            </h2>
            {groupFavorites.length === 0 ? (
              <EmptyNote text="No one has ranked this trip's rooms yet." />
            ) : (
              <div>
                {groupFavorites.map((entry, idx) => (
                  <div key={entry.room.id} className="ert-frow" style={{ gridTemplateColumns: "34px minmax(0, 1fr) auto" }}>
                    <span className={`ert-rank${idx === 0 ? " top" : ""}`}>{idx + 1}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="ert-r-title" style={{ fontSize: 16 }}>{entry.room.name}</span>
                      <span className="ert-r-sub">{entry.room.venue || entry.room.city}</span>
                    </span>
                    <span style={{ color: "var(--text-dim)", fontSize: 13.5 }}>{plural(entry.voters, "vote")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {ranking && !isGuest && (
        <div className="ert-modal-bg" onClick={() => setRanking(false)}>
          <div className="ert-card-raised ert-modal" role="dialog" aria-label="Rank your favorites" onClick={(e) => e.stopPropagation()}>
            <div className="ert-pop-h" style={{ marginBottom: 6 }}>
              <span>Rank your favorites</span>
              <button className="ert-ibtn sm" aria-label="Close" onClick={() => setRanking(false)}><X size={18} /></button>
            </div>
            <p className="ert-hint" style={{ margin: "0 0 8px" }}>Order this trip's rooms from your favorite to least favorite. Everyone's own ranking combines into the group favorites.</p>
            {myRanking.length === 0 ? (
              <div style={{ padding: "10px 0 14px" }}><EmptyNote text="Add rooms to this trip first." /></div>
            ) : (
              <div className="ert-scrollbar" style={{ overflowY: "auto" }}>
                {myRanking.map((roomId, idx) => {
                  const room = rooms.find((r) => r.id === roomId);
                  if (!room) return null;
                  return (
                    <div key={roomId} className="ert-frow">
                      <span className={`ert-rank${idx === 0 ? " top" : ""}`}>{idx + 1}</span>
                      <span style={{ minWidth: 0 }}>
                        <span className="ert-r-title" style={{ fontSize: 16 }}>{room.name}</span>
                        <span className="ert-r-sub">{room.venue || room.city}</span>
                      </span>
                      <button className="ert-step" aria-label={`Move ${room.name} up`} disabled={idx === 0} onClick={() => moveMyRanking(idx, idx - 1)}><ChevronUp size={18} /></button>
                      <button className="ert-step" aria-label={`Move ${room.name} down`} disabled={idx === myRanking.length - 1} onClick={() => moveMyRanking(idx, idx + 1)}><ChevronDown size={18} /></button>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "14px 0 6px" }}>
              <button className="ert-btn ert-btn-brass" onClick={() => setRanking(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {addingRooms && !isGuest && (
        <div className="ert-modal-bg" onClick={() => setAddingRooms(false)}>
          <div className="ert-card-raised ert-modal" role="dialog" aria-label="Add rooms" onClick={(e) => e.stopPropagation()}>
            <div className="ert-pop-h" style={{ marginBottom: 12 }}>
              <span>Add rooms</span>
              <button className="ert-ibtn sm" aria-label="Close" onClick={() => setAddingRooms(false)}><X size={18} /></button>
            </div>
            <div style={{ position: "relative", marginBottom: 8 }}>
              <Search size={16} style={{ position: "absolute", left: 14, top: 11, color: "var(--text-dim)" }} />
              <input className="ert-input" style={{ paddingLeft: 40, height: 38 }} placeholder="Search completed rooms" aria-label="Search completed rooms" value={addSearch} autoFocus onChange={(e) => setAddSearch(e.target.value)} />
            </div>
            {addableRooms.length === 0 ? (
              <div style={{ padding: "10px 0 14px" }}><EmptyNote text="No matching completed rooms to add." /></div>
            ) : (
              <div className="ert-scrollbar" style={{ overflowY: "auto" }}>
                {addableRooms.map((r) => (
                  <div key={r.id} className="ert-srow">
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 500 }}>{r.name}</span>
                      <span style={{ display: "block", fontSize: 13, color: "var(--text-dim)" }}>{[r.venue, r.city].filter(Boolean).join(", ")}</span>
                    </span>
                    <button className="ert-btn ert-btn-ghost" style={{ padding: "5px 14px", fontSize: 13 }} onClick={() => addRoom(r.id)}>Add</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   GALLERY
   Every photo across every room, tagged with that room's name, city,
   country, genre and date visited, so the same search/filter/sort
   pattern used elsewhere works here too. Reuses the same lightbox,
   with prev/next moving through the whole filtered gallery rather
   than just one room's photos.
--------------------------------------------------------------- */
const GALLERY_SORT_OPTIONS = [
  { id: "visited-desc", label: "Date visited (newest)" },
  { id: "visited-asc", label: "Date visited (oldest)" },
  { id: "alpha", label: "Room (A to Z)" },
];

function sortGalleryPhotos(items, sortBy) {
  const arr = [...items];
  switch (sortBy) {
    case "visited-asc":
      return arr.sort((a, b) => (a.datePlayed || "").localeCompare(b.datePlayed || ""));
    case "alpha":
      return arr.sort((a, b) => (a.roomName || "").localeCompare(b.roomName || "", "pl"));
    case "visited-desc":
    default:
      return arr.sort((a, b) => (b.datePlayed || "").localeCompare(a.datePlayed || ""));
  }
}

function defaultGalleryFilters() {
  return { search: "", selectedCities: [], selectedGenres: [], selectedCountries: [], selectedFlags: [], sortBy: "visited-desc" };
}

function GalleryView({ rooms, driveConnected, driveAvailable, getDriveAccessToken, filters, onFiltersChange, flags }) {
  const { search, selectedCities, selectedGenres, selectedCountries, selectedFlags, sortBy } = filters;
  const patch = (p) => onFiltersChange({ ...filters, ...p });
  const flagOptions = flags && flags.length ? flags : DEFAULT_FLAGS;
  const [previewIndex, setPreviewIndex] = useState(null);

  const allPhotos = useMemo(() => {
    const items = [];
    rooms.forEach((r) => {
      (r.photos || []).forEach((p) => {
        items.push({
          ...p,
          roomId: r.id,
          roomName: r.name,
          city: r.city,
          country: r.country,
          category: r.category,
          datePlayed: r.datePlayed,
          roomFlags: r.flags || [],
        });
      });
    });
    return items;
  }, [rooms]);

  const cities = useMemo(() => Array.from(new Set(allPhotos.map((p) => p.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pl")), [allPhotos]);
  const cats = useMemo(() => Array.from(new Set(allPhotos.map((p) => p.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pl")), [allPhotos]);
  const countries = useMemo(() => Array.from(new Set(allPhotos.map((p) => p.country).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pl")), [allPhotos]);

  const toggleCity = (c) => patch({ selectedCities: selectedCities.includes(c) ? selectedCities.filter((x) => x !== c) : [...selectedCities, c] });
  const toggleGenre = (c) => patch({ selectedGenres: selectedGenres.includes(c) ? selectedGenres.filter((x) => x !== c) : [...selectedGenres, c] });
  const toggleCountry = (c) => patch({ selectedCountries: selectedCountries.includes(c) ? selectedCountries.filter((x) => x !== c) : [...selectedCountries, c] });
  const toggleFlagFilter = (id) => patch({ selectedFlags: selectedFlags.includes(id) ? selectedFlags.filter((x) => x !== id) : [...selectedFlags, id] });
  const clearPopoverFilters = () => patch({ selectedCities: [], selectedGenres: [], selectedCountries: [], selectedFlags: [] });
  const hasActiveFilters = !!search || selectedCities.length > 0 || selectedGenres.length > 0 || selectedCountries.length > 0 || selectedFlags.length > 0;
  const clearAll = () => patch({ search: "", selectedCities: [], selectedGenres: [], selectedCountries: [], selectedFlags: [] });

  const filtered = allPhotos.filter((p) => {
    if (search && !(p.roomName || "").toLowerCase().includes(search.toLowerCase())) return false;
    if (selectedCountries.length && !selectedCountries.includes(p.country)) return false;
    if (selectedCities.length && !selectedCities.includes(p.city)) return false;
    if (selectedGenres.length && !selectedGenres.includes(p.category)) return false;
    if (selectedFlags.length && !p.roomFlags.some((f) => selectedFlags.includes(f))) return false;
    return true;
  });
  const sorted = sortGalleryPhotos(filtered, sortBy);
  const isDateGrouped = sortBy === "visited-desc" || sortBy === "visited-asc";
  const yearGroups = isDateGrouped ? groupByYear(sorted, "datePlayed") : [];

  if (!driveAvailable) {
    return (
      <div className="ert-unplayed" style={{ maxWidth: 520 }}>
        <h3>Photos need the hosted site</h3>
        <p style={{ marginBottom: 0 }}>The gallery reads from Google Drive, which isn't available in this preview.</p>
      </div>
    );
  }
  if (!driveConnected) {
    return (
      <div className="ert-unplayed" style={{ maxWidth: 520 }}>
        <h3>Google Drive isn't connected yet</h3>
        <p style={{ marginBottom: 0 }}>Connect it from App settings (Google Drive tab) to start building a shared gallery.</p>
      </div>
    );
  }

  const renderTile = (p, openIndex) => (
    <div key={p.id}>
      <DrivePhoto photo={p} aspect="4 / 3" getDriveAccessToken={getDriveAccessToken} onPreview={() => setPreviewIndex(openIndex)} />
      <div style={{ marginTop: 8, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.roomName}</div>
        {p.city ? <div style={{ fontSize: 13, color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.city}</div> : null}
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 180, maxWidth: 380 }}>
          <Search size={16} style={{ position: "absolute", left: 14, top: 11, color: "var(--text-dim)" }} />
          <input className="ert-input" style={{ paddingLeft: 42, height: 38 }} placeholder="Search rooms" aria-label="Search rooms" value={search} onChange={(e) => patch({ search: e.target.value })} />
        </div>
        <SortPopover options={GALLERY_SORT_OPTIONS} sortBy={sortBy} onChange={(v) => patch({ sortBy: v })} />
        <FilterPopover
          cities={cities}
          cats={cats}
          countries={countries}
          flagOptions={flagOptions}
          selectedCities={selectedCities}
          selectedGenres={selectedGenres}
          selectedCountries={selectedCountries}
          selectedFlags={selectedFlags}
          onToggleCity={toggleCity}
          onToggleGenre={toggleGenre}
          onToggleCountry={toggleCountry}
          onToggleFlag={toggleFlagFilter}
          onClear={clearPopoverFilters}
        />
        {hasActiveFilters && (
          <button className="ert-btn ert-btn-ghost" onClick={clearAll} title="Clear filters" aria-label="Clear filters" style={{ flexShrink: 0, height: 38, padding: "0 12px" }}>
            <FilterX size={16} />
          </button>
        )}
        <span className="ert-count">
          {sorted.length === allPhotos.length ? `${plural(allPhotos.length, "photo")} total` : `${sorted.length} of ${plural(allPhotos.length, "photo")}`}
        </span>
      </div>

      {sorted.length === 0 ? (
        <div style={{ paddingTop: 22 }}><EmptyNote text={allPhotos.length === 0 ? "No photos yet. Upload some from a room's Photos section." : "No photos match those filters."} /></div>
      ) : isDateGrouped ? (
        <div>
          {yearGroups.map((group, gi) => {
            const offset = yearGroups.slice(0, gi).reduce((n, g) => n + g.items.length, 0);
            return (
              <section key={group.year}>
                <YearDivider year={group.year} count={group.items.length} itemLabel="photo" />
                <div className="ert-pgrid">{group.items.map((p, i) => renderTile(p, offset + i))}</div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="ert-pgrid" style={{ marginTop: 22 }}>{sorted.map((p, i) => renderTile(p, i))}</div>
      )}

      {previewIndex !== null && sorted[previewIndex] && (
        <PhotoLightbox
          photos={sorted}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          getDriveAccessToken={getDriveAccessToken}
        />
      )}
    </div>
  );
}

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
    members.forEach((m) => { byMember[m] = { added: 0, played: 0, rated: 0, noted: 0 }; });
    (rooms || []).forEach((r) => {
      if (r.addedBy && byMember[r.addedBy]) byMember[r.addedBy].added += 1;
      const playedThis = r.status === "played" ? roomParticipants(r) : [];
      members.forEach((m) => {
        if (playedThis.includes(m)) byMember[m].played += 1;
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
      setError("Couldn't update the password. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const cols = "minmax(200px, 1fr) repeat(4, 96px) 170px";
  const columns = [
    { key: "added", label: "Added", hint: "Rooms this person added to the log" },
    { key: "played", label: "Played", hint: "Completed rooms they took part in" },
    { key: "rated", label: "Rated", hint: "Rooms they gave a rating" },
    { key: "noted", label: "Noted", hint: "Rooms they wrote a note on" },
  ];

  return (
    <div>
      <p style={{ margin: "0 0 18px", color: "var(--text-dim)", maxWidth: "62ch" }}>Everyone here shares this log and can add rooms, ratings and notes.</p>

      <div className="ert-scrollbar" style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 780 }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 20, padding: "4px 0 9px", borderBottom: "1px solid var(--border)", fontSize: 12.5, color: "var(--text-dim)", alignItems: "end" }}>
        <span>Person</span>
        {columns.map((c) => <span key={c.key} title={c.hint} style={{ textAlign: "center" }}>{c.label}</span>)}
        <span />
      </div>
      {members.map((m) => {
        const me = m === currentMember;
        return (
          <div key={m} style={{ display: "grid", gridTemplateColumns: cols, gap: 20, alignItems: "center", padding: "13px 0", borderBottom: "1px solid var(--border-soft)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
              <span className="ert-avatar" style={{ width: 36, height: 36, cursor: "default", fontSize: 14, flex: "none" }} aria-hidden="true">{initialOf(m)}</span>
              <span className="ert-display" style={{ fontSize: 17, fontWeight: 600 }}>{m}</span>
              {me && <span className="ert-pill" style={{ color: "var(--brass-bright)" }}>you</span>}
            </span>
            {columns.map((c) => (
              <span key={c.key} className="ert-mono" style={{ textAlign: "center", fontSize: 20, fontWeight: 700, color: stats[m][c.key] ? "var(--brass-bright)" : "var(--text-dim)" }}>{stats[m][c.key]}</span>
            ))}
            <span style={{ textAlign: "right" }}>
              {me && !changing && <button className="ert-btn ert-btn-ghost" style={{ padding: "5px 14px", fontSize: 13 }} onClick={openChange}><KeyRound size={15} /> Change password</button>}
            </span>
          </div>
        );
      })}
      </div>
      </div>

      {changing && (
        <div className="ert-rsec" style={{ marginTop: 34, maxWidth: 380 }}>
          <h2>Change your password</h2>
          <div style={{ display: "grid", gap: 10 }}>
            <input type="password" className="ert-input" placeholder="Current password" aria-label="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            <input type="password" className="ert-input" placeholder="New password" aria-label="New password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            <input type="password" className="ert-input" placeholder="Repeat new password" aria-label="Repeat new password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {error && <div style={{ color: "var(--danger)", fontSize: 13.5, marginTop: 10 }} role="alert">{error}</div>}
          {success && <div style={{ color: "var(--success)", fontSize: 13.5, marginTop: 10 }}>Password updated.</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button className="ert-btn ert-btn-brass" disabled={busy} style={{ opacity: busy ? 0.6 : 1 }} onClick={submit}>
              <Check size={16} /> Save password
            </button>
            <button className="ert-btn ert-btn-ghost" onClick={closeChange}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
