/*
  The Escape Log, phone edition.

  Same shared data, same Firebase document, same Google Drive folder as the
  desktop app (escape-room-tracker.jsx), with an interface rebuilt for a thumb:
  bottom tab bar, bottom sheets, big touch targets, and swipe/pinch photo
  viewing. The storage, Firebase, Drive and password code below is shared
  logic copied verbatim from the desktop file, so edits made on either
  version show up on the other.
*/
import React, { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from "react";
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
  // Google only accepts redirect URIs registered in the Cloud Console, and that is the main
  // site's URL. The phone page lives next to it, so round-trip through that URL; the main
  // page forwards phones straight back here, keeping the ?code= for the exchange.
  return window.location.origin + window.location.pathname.replace(/mobile\.html$/, "");
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

async function fetchDrivePhotoUrl(fileId, accessToken) {
  if (driveBlobCache.has(fileId)) {
    touchCache(driveBlobCache, fileId);
    return driveBlobCache.get(fileId);
  }
  const blob = await fetchDriveBytes(fileId, accessToken);
  const url = URL.createObjectURL(blob);
  driveBlobCache.set(fileId, url);
  evictIfNeeded(driveBlobCache, FULL_CACHE_LIMIT);
  return url;
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
   HELPERS
--------------------------------------------------------------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const STORAGE_KEY = "escape-room-club-data-v1";
const MEMBER_KEY = "escape-room-club-current-member";
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
];

// A curated set of icons offered in the Settings picker -- broad enough to
// cover common flag ideas without listing lucide's entire (huge) icon set.
const FLAG_ICON_CHOICES = [
  "Ban", "CornerUpRight", "AlertTriangle", "Flag", "Star", "Heart", "ThumbsUp",
  "ThumbsDown", "Flame", "Snowflake", "Sun", "Moon", "Clock", "Wrench",
  "Construction", "PartyPopper", "Sparkles", "Zap", "Trophy", "Building2",
  "MapPin", "Lock", "Unlock", "Check", "X", "Info", "Users", "Drama",
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
 
function fmtRating(n) {
  return n === null || n === undefined ? "-" : n.toFixed(1);
}
 

const SORT_OPTIONS = [
  { id: "visited-desc", label: "Date visited (newest)" },
  { id: "visited-asc", label: "Date visited (oldest)" },
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
      return arr.sort((a, b) => {
        const av = avgRating(a);
        const bv = avgRating(b);
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return bv - av;
      });
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


const TRIP_SORT_OPTIONS = [
  { id: "start-desc", label: "Trip date (newest)" },
  { id: "start-asc", label: "Trip date (oldest)" },
  { id: "date-desc", label: "Date added (newest)" },
  { id: "date-asc", label: "Date added (oldest)" },
  { id: "alpha", label: "Alphabetical (A\u2013Z)" },
];


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


const GALLERY_SORT_OPTIONS = [
  { id: "visited-desc", label: "Date visited (newest)" },
  { id: "visited-asc", label: "Date visited (oldest)" },
  { id: "alpha", label: "Room (A\u2013Z)" },
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


/* ===================================================================
   PHONE UI
   Everything above this banner is shared logic. Everything below is the
   phone-specific interface.
=================================================================== */
const pick = (...names) => {
  for (const n of names) if (LucideIcons[n]) return LucideIcons[n];
  return LucideIcons.Circle;
};
const Ico = {
  lock: pick("Lock"), unlock: pick("Unlock"), pin: pick("MapPin"), star: pick("Star"), plus: pick("Plus"),
  search: pick("Search"), x: pick("X"), check: pick("Check"), back: pick("ChevronLeft"), next: pick("ChevronRight"),
  down: pick("ChevronDown"), up: pick("ChevronUp"), more: pick("MoreHorizontal", "Ellipsis"), camera: pick("Camera"),
  user: pick("User"), trophy: pick("Trophy"), plane: pick("Plane"), image: pick("Image", "ImageIcon"),
  home: pick("Home", "House"), door: pick("DoorOpen", "DoorClosed"), filter: pick("SlidersHorizontal", "Filter"),
  sort: pick("ArrowUpDown"), cal: pick("Calendar"), wallet: pick("Wallet"), dumbbell: pick("Dumbbell"),
  ghost: pick("Ghost"), minus: pick("Minus"), trash: pick("Trash2", "Trash"), edit: pick("Pencil", "Edit2", "Edit"),
  upload: pick("Upload"), settings: pick("Settings"), users: pick("Users"), flag: pick("Flag"),
  link: pick("ExternalLink"), key: pick("KeyRound", "Key"), monitor: pick("Monitor"), palette: pick("Tag", "Tags"),
  cloud: pick("Cloud"), clock: pick("Clock"), logout: pick("LogOut"), drive: pick("HardDrive", "Cloud"),
};

const tick = (ms = 8) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* not supported */ } };
const cx = (...a) => a.filter(Boolean).join(" ");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};
const distinct = (list) => Array.from(new Set(list.filter(Boolean))).sort((a, b) => a.localeCompare(b, "pl"));
// Search ignores case and Polish diacritics, so "lodz" finds "Łódź" on any phone keyboard.
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
const shortNames = (names) => {
  const out = {};
  names.forEach((n) => {
    let k = 1;
    while (k < n.length && names.some((o) => o !== n && o.slice(0, k) === n.slice(0, k))) k += 1;
    out[n] = n.slice(0, k);
  });
  return out;
};
const initialOf = (name) => (name === GUEST_NAME ? "G" : (name || "?").slice(0, 1).toUpperCase());

/* ---- filter shapes (one set per browsable screen) ---- */
const defRoomFilters = (wish) => ({ search: "", cities: [], genres: [], countries: [], flags: [], onlyUnrated: false, sortBy: wish ? "date-desc" : "visited-desc" });
const defRankingFilters = () => ({ cities: [], genres: [], countries: [], flags: [], onlyUnrated: false, sortDir: "best", mode: "group" });
const defTripFilters = () => ({ search: "", cities: [], sortBy: "start-desc" });
const defGalleryFilters = () => ({ search: "", cities: [], genres: [], countries: [], flags: [], sortBy: "visited-desc" });
const defAllFilters = () => ({ rooms: defRoomFilters(false), wishlist: defRoomFilters(true), ranking: defRankingFilters(), trips: defTripFilters(), gallery: defGalleryFilters() });
const countActive = (f) => (f.cities || []).length + (f.genres || []).length + (f.countries || []).length + (f.flags || []).length + (f.onlyUnrated ? 1 : 0);

function roomMatches(r, f, me) {
  if (f.search && !norm(`${r.name} ${r.venue || ""}`).includes(norm(f.search))) return false;
  if (f.countries && f.countries.length && !f.countries.includes(r.country)) return false;
  if (f.cities && f.cities.length && !f.cities.includes(r.city)) return false;
  if (f.genres && f.genres.length && !f.genres.includes(r.category)) return false;
  if (f.flags && f.flags.length && !(r.flags || []).some((x) => f.flags.includes(x))) return false;
  if (f.onlyUnrated && me && typeof (r.ratings || {})[me] === "number") return false;
  return true;
}

function crewStats(rooms) {
  const by = {};
  MEMBERS.forEach((m) => { by[m] = { added: 0, played: 0, rated: 0, noted: 0 }; });
  (rooms || []).forEach((r) => {
    if (r.addedBy && by[r.addedBy]) by[r.addedBy].added += 1;
    const played = r.status === "played" ? roomParticipants(r) : [];
    MEMBERS.forEach((m) => {
      if (played.includes(m)) by[m].played += 1;
      if (typeof (r.ratings || {})[m] === "number") by[m].rated += 1;
      if (r.notes && r.notes[m] && r.notes[m].trim()) by[m].noted += 1;
    });
  });
  return by;
}

/* ---- styles ---- */
const MOBILE_CSS = `
:root{--bg:#14161c;--surface:#1b1e27;--raised:#252a35;--hair:#2a2f3b;--line:#3a4152;--text:#ece8dd;--dim:#9aa0b1;
--brass:#c89b4a;--brass-hi:#e3bd72;--teal:#48a99e;--danger:#d0675a;--success:#6a9d74;
--safe-t:env(safe-area-inset-top,0px);--safe-b:env(safe-area-inset-bottom,0px);--hdr:52px;--tabbar:58px;color-scheme:dark}
html{-webkit-text-size-adjust:100%;background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1.45;-webkit-font-smoothing:antialiased;overscroll-behavior-y:none}
.m-app,.m-app *,.m-app *::before,.m-app *::after{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.m-app{min-height:100vh;min-height:100dvh}
:where(.m-app) button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;touch-action:manipulation;text-align:inherit}
:where(.m-app) input,:where(.m-app) select,:where(.m-app) textarea{font:inherit;font-size:16px;color:var(--text);margin:0}
.m-app :focus-visible{outline:2px solid var(--brass-hi);outline-offset:2px}
.m-app ::selection{background:var(--brass);color:#14161c}
.disp{font-family:'Space Grotesk','Inter',system-ui,sans-serif}
.num{font-family:'Space Grotesk','Inter',system-ui,sans-serif;font-variant-numeric:tabular-nums}
.dim{color:var(--dim)}.brass{color:var(--brass-hi)}.danger{color:var(--danger)}.grow{flex:1}
.sm{font-size:14px}.xs{font-size:13px}

/* header + tabs */
.hdr{position:sticky;top:0;z-index:30;padding-top:var(--safe-t);background:rgba(20,22,28,.94);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border-bottom:1px solid var(--hair)}
.hdr-in{height:var(--hdr);display:flex;align-items:center;gap:2px;padding:0 6px 0 6px}
.hdr-title{flex:1;min-width:0;font-weight:600;font-size:18px;padding:0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brand{flex:1;display:flex;align-items:center;gap:9px;padding-left:10px;font-size:19px;font-weight:700;letter-spacing:-.01em}
.ibtn{width:44px;height:44px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex:none}
.ibtn:active{background:var(--raised)}
.hbtn{height:44px;padding:0 14px;border-radius:22px;font-weight:600;color:var(--brass-hi)}
.hbtn:active{background:var(--raised)}
.avatar{width:34px;height:34px;border-radius:50%;background:var(--raised);border:1.5px solid var(--brass);color:var(--brass-hi);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:14px}
.tabbar{position:fixed;left:0;right:0;bottom:0;z-index:40;display:flex;background:rgba(27,30,39,.97);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border-top:1px solid var(--hair);padding-bottom:var(--safe-b)}
.tab{flex:1;height:var(--tabbar);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:11.5px;font-weight:500;color:var(--dim);position:relative}
.tab[aria-current=page]{color:var(--brass-hi)}
.tab[aria-current=page]::before{content:"";position:absolute;top:0;width:26px;height:2px;border-radius:2px;background:var(--brass)}
.fab{position:fixed;right:16px;bottom:calc(var(--tabbar) + var(--safe-b) + 16px);z-index:35;width:56px;height:56px;border-radius:50%;background:var(--brass);color:#17140c;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.5)}
.fab:active{transform:scale(.96);background:var(--brass-hi)}
.main{padding-bottom:calc(var(--tabbar) + var(--safe-b) + 84px)}
.main.bare{padding-bottom:calc(var(--safe-b) + 40px)}
.pad{padding-left:16px;padding-right:16px}
.banner{padding:9px 16px;font-size:14px;background:var(--raised);border-bottom:1px solid var(--hair)}
.banner.err{background:#3a1f1c;color:#f0b8b0}.banner.ok{background:#1d2e24;color:#b4d8bf}

/* titles + rows */
.pg-h{font-family:'Space Grotesk',sans-serif;font-size:30px;font-weight:700;letter-spacing:-.02em;line-height:1.1;margin:20px 0 6px}
.sec-h{font-family:'Space Grotesk',sans-serif;font-size:20px;font-weight:600;margin:30px 16px 4px;display:flex;align-items:baseline;justify-content:space-between}
.sec-h small{font-family:'Inter',sans-serif;font-size:13px;font-weight:400;color:var(--dim)}
.row{display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;border-bottom:1px solid var(--hair);min-height:64px;text-align:left}
button.row:active,a.row:active{background:var(--surface)}
.rr-main{flex:1;min-width:0}
.rr-title{font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:600;line-height:1.25;overflow-wrap:anywhere}
.rr-sub{color:var(--dim);font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rr-meta{display:flex;gap:4px 14px;align-items:center;color:var(--dim);font-size:13.5px;margin-top:4px;flex-wrap:wrap}
.rr-meta span{display:inline-flex;align-items:center;gap:4px}
.rr-side{display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex:none}
.rr-score{font-family:'Space Grotesk',sans-serif;font-size:23px;font-weight:700;color:var(--brass-hi);font-variant-numeric:tabular-nums;line-height:1}
.rr-icons{display:flex;gap:7px;align-items:center;color:var(--dim)}
.rank-n{font-family:'Space Grotesk',sans-serif;font-size:22px;font-weight:700;width:30px;flex:none;color:var(--dim);font-variant-numeric:tabular-nums}
.rank-n.top{color:var(--brass-hi)}
.mini-row{display:flex;gap:5px;margin-top:6px;flex-wrap:wrap}
.mini{font-size:12.5px;padding:2px 7px;border-radius:6px;background:var(--raised);color:var(--dim);font-variant-numeric:tabular-nums}
.mini.me{background:var(--brass);color:#17140c;font-weight:600}
.yr{display:flex;align-items:baseline;justify-content:space-between;padding:24px 16px 8px;border-bottom:1px solid var(--line)}
.yr b{font-family:'Space Grotesk',sans-serif;font-size:21px;font-weight:700}
.yr span{color:var(--dim);font-size:13.5px}
.empty{padding:44px 24px;text-align:center;color:var(--dim)}
.empty h3{margin:0 0 6px;font-family:'Space Grotesk',sans-serif;font-size:20px;color:var(--text)}
.empty p{margin:0 0 18px;max-width:30ch;margin-left:auto;margin-right:auto}
.bars{padding:6px 16px 0}
.bar{display:grid;grid-template-columns:minmax(80px,32%) 1fr 28px;align-items:center;gap:10px;padding:7px 0;font-size:15px}
.bar i{display:block;height:8px;border-radius:4px;background:var(--raised);overflow:hidden}
.bar i b{display:block;height:100%;background:var(--brass);border-radius:4px}
.bar span:last-child{text-align:right;color:var(--dim);font-variant-numeric:tabular-nums}
.bar span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* sticky tools */
.tools{position:sticky;top:calc(var(--safe-t) + var(--hdr));z-index:20;background:var(--bg);padding:10px 16px;border-bottom:1px solid var(--hair)}
.seg{display:flex;background:var(--surface);border:1px solid var(--hair);border-radius:12px;padding:3px;gap:3px}
.seg button{flex:1;height:42px;border-radius:9px;font-weight:600;font-size:15px;color:var(--dim);text-align:center}
.seg button[aria-pressed=true]{background:var(--raised);color:var(--text);box-shadow:inset 0 0 0 1px var(--line)}
.tools-row{display:flex;gap:8px;margin-top:10px}
.tools-row:first-child{margin-top:0}
.search{flex:1;position:relative;min-width:0}
.search input{width:100%;height:44px;padding:0 42px 0 42px;background:var(--surface);border:1px solid var(--hair);border-radius:12px;-webkit-appearance:none;appearance:none}
.search input::placeholder{color:var(--dim)}
.search .si{position:absolute;left:14px;top:13px;color:var(--dim);pointer-events:none}
.search .clr{position:absolute;right:0;top:0;width:44px;height:44px;display:flex;align-items:center;justify-content:center;color:var(--dim)}
.tbtn{width:44px;height:44px;border-radius:12px;background:var(--surface);border:1px solid var(--hair);display:flex;align-items:center;justify-content:center;position:relative;flex:none}
.tbtn[aria-pressed=true]{border-color:var(--brass);color:var(--brass-hi)}
.tbtn.wide{width:auto;padding:0 14px;gap:7px;font-weight:600;font-size:14.5px}
.badge{position:absolute;top:-6px;right:-6px;min-width:19px;height:19px;border-radius:10px;background:var(--brass);color:#17140c;font-size:11.5px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px}
.applied{display:flex;gap:8px;overflow-x:auto;padding:12px 16px 2px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.applied::-webkit-scrollbar{display:none}
.pill{flex:none;display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 8px 0 13px;border-radius:17px;background:var(--raised);font-size:14px}
.count-line{padding:12px 16px 4px;color:var(--dim);font-size:14px}

/* buttons + fields */
.btn{height:50px;border-radius:12px;padding:0 20px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-align:center;font-size:16px}
.btn-primary{background:var(--brass);color:#17140c}
.btn-primary:active{background:var(--brass-hi)}
.btn-quiet{background:var(--raised)}
.btn-quiet:active{background:#2d3340}
.btn-danger{color:var(--danger);border:1px solid rgba(208,103,90,.5)}
.btn-block{width:100%}
.btn[disabled]{opacity:.45}
.field{margin:18px 0}
.field-l{font-size:14px;color:var(--dim);margin-bottom:7px;display:block}
.inp{display:block;width:100%;min-height:50px;padding:0 14px;background:var(--surface);border:1px solid var(--line);border-radius:12px;-webkit-appearance:none;appearance:none}
textarea.inp{padding:13px 14px;min-height:110px;resize:vertical;line-height:1.5}
select.inp{padding-right:40px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%239aa0b1' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center}
.inp[type=date]{text-align:left;min-width:0}
.inp:focus{border-color:var(--brass);outline:none;box-shadow:0 0 0 3px rgba(200,155,74,.28)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.chips{display:flex;flex-wrap:wrap;gap:9px}
.chip{min-height:42px;padding:0 16px;border-radius:21px;background:var(--surface);border:1px solid var(--line);font-size:15px;display:inline-flex;align-items:center;gap:7px}
.chip[aria-pressed=true]{background:rgba(200,155,74,.16);border-color:var(--brass);color:var(--brass-hi)}
.suggest{display:flex;gap:8px;overflow-x:auto;padding:9px 0 0;scrollbar-width:none}
.suggest::-webkit-scrollbar{display:none}
.suggest button{flex:none;height:42px;padding:0 14px;border-radius:18px;background:var(--raised);font-size:14.5px}
.pchips{display:flex;flex-wrap:wrap;gap:6px 4px}
.pchip{display:flex;flex-direction:column;align-items:center;gap:6px;width:76px;font-size:13px;color:var(--dim);text-align:center;line-height:1.2}
.pchip .c{width:50px;height:50px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--raised);border:1px solid var(--line);color:var(--dim);transition:background .15s,border-color .15s,color .15s}
.pchip[aria-pressed=true]{color:var(--text)}
.pchip.on-brass[aria-pressed=true] .c{background:var(--brass);border-color:var(--brass);color:#17140c}
.swrow{display:flex;align-items:center;justify-content:space-between;gap:14px;width:100%;padding:14px 0;border-bottom:1px solid var(--hair);text-align:left}
.swrow b{display:block;font-weight:500}.swrow small{display:block;color:var(--dim);font-size:13.5px;margin-top:2px}
.sw{width:48px;height:30px;border-radius:15px;background:var(--line);position:relative;flex:none;transition:background .15s}
.sw i{position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;transition:transform .15s}
.swrow[aria-checked=true] .sw{background:var(--brass)}.swrow[aria-checked=true] .sw i{transform:translateX(18px)}
.opt{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:54px;padding:0 4px;border-bottom:1px solid var(--hair);font-size:16.5px}
.fgroup{margin:6px 0 22px}.fgroup-l{font-weight:600;margin:12px 0 10px}

/* sheets */
.sheet-bg{position:fixed;inset:0;z-index:60;background:rgba(6,7,10,.64);opacity:0;transition:opacity .2s}
.sheet-bg.vis{opacity:1}
.sheet{position:fixed;left:0;right:0;bottom:0;z-index:61;max-height:90vh;max-height:90dvh;display:flex;flex-direction:column;background:var(--surface);border-radius:20px 20px 0 0;border-top:1px solid var(--line);transform:translateY(100%);transition:transform .26s cubic-bezier(.2,.8,.2,1);padding-bottom:var(--safe-b)}
.sheet.vis{transform:translateY(0)}
.grab{height:24px;display:flex;align-items:center;justify-content:center;flex:none;touch-action:none}
.grab i{width:40px;height:4px;border-radius:2px;background:var(--line)}
.sheet-h{display:flex;align-items:center;justify-content:space-between;padding:0 8px 6px 20px;flex:none}
.sheet-h h2{margin:0;font-size:20px;font-weight:600;font-family:'Space Grotesk',sans-serif}
.sheet-b{overflow-y:auto;overscroll-behavior:contain;padding:4px 20px 20px;-webkit-overflow-scrolling:touch}
.sheet-f{flex:none;padding:12px 20px;border-top:1px solid var(--hair);display:flex;gap:10px}
.toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(var(--safe-b) + 24px);z-index:95;background:#2c313e;border:1px solid var(--line);padding:12px 18px;border-radius:12px;font-size:15px;max-width:calc(100vw - 32px);box-shadow:0 8px 24px rgba(0,0,0,.45)}
.toast.err{border-color:var(--danger)}

/* room page */
.room-name{font-family:'Space Grotesk',sans-serif;font-size:30px;font-weight:700;letter-spacing:-.02em;line-height:1.12;margin:6px 0 4px;overflow-wrap:anywhere}
.status-line{display:flex;align-items:center;gap:7px;color:var(--dim);font-size:14.5px;margin-top:18px}
.linkish{color:var(--dim);text-decoration:underline;text-decoration-color:var(--line);text-underline-offset:4px;display:inline-block;padding:10px 1px}
.facts .linkish{padding:8px 1px}
.facts{display:grid;gap:3px;margin-top:14px;color:var(--dim)}
.facts div{display:flex;align-items:center;gap:9px;min-height:30px}
.facts svg{flex:none}
.facts .ok{color:var(--success)}.facts .bad{color:var(--danger)}
.avgs{display:flex;align-items:center;gap:28px;margin-top:20px}
.avg-col{display:grid;gap:8px}
.avg-big{font-family:'Space Grotesk',sans-serif;font-size:44px;font-weight:700;color:var(--brass-hi);line-height:1;font-variant-numeric:tabular-nums}
.avg-cap{font-size:13.5px;color:var(--dim);margin-top:4px}
.avg-small{display:flex;align-items:center;gap:7px;font-family:'Space Grotesk',sans-serif;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums;}
.rate{padding:16px 0 14px;border-bottom:1px solid var(--hair)}
.rate-top{display:flex;align-items:center;gap:10px}
.rate-l{flex:1;font-weight:600}
.rate-val{font-family:'Space Grotesk',sans-serif;font-size:30px;font-weight:700;color:var(--brass-hi);font-variant-numeric:tabular-nums;line-height:1;min-width:76px;text-align:center}
.rate-val small{font-size:15px;color:var(--dim);font-weight:500}
.step{width:44px;height:44px;border-radius:50%;background:var(--raised);display:flex;align-items:center;justify-content:center;flex:none}
.step:active{background:#2f3542}
.stars{display:flex;align-items:center;min-height:48px;touch-action:pan-y;margin-top:6px;user-select:none;-webkit-user-select:none;cursor:pointer}
.star{flex:1;aspect-ratio:1;position:relative;display:flex;align-items:center;justify-content:center}
.star .base{color:var(--line)}
.star .fillclip{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.clear{font-size:14px;color:var(--dim);padding:12px 4px;text-decoration:underline;text-underline-offset:3px}
.note{padding:14px 0;border-bottom:1px solid var(--hair)}
.note b{font-weight:600}.note p{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
.note.mine{width:100%;display:block;text-align:left}
.pgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:3px}
.ph{aspect-ratio:1;background:var(--raised);position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:12px;width:100%}
.ph img{width:100%;height:100%;object-fit:cover;display:block}
.ph.add{border:1.5px dashed var(--line);background:transparent;flex-direction:column;gap:6px;font-size:13.5px;cursor:pointer}

/* combination-lock hero */
.hero{padding:26px 16px 8px;text-align:center}
.dial{display:inline-flex;gap:7px;padding:12px;border-radius:20px;background:#0e1015;border:1px solid #4a3d22;box-shadow:0 0 0 1px #000,0 10px 30px rgba(0,0,0,.5),inset 0 1px 0 rgba(227,189,114,.12);position:relative}
.dial::before{content:"";position:absolute;top:-7px;left:50%;margin-left:-7px;border:7px solid transparent;border-top-color:var(--brass);border-bottom:0}
.wheel{width:58px;height:84px;overflow:hidden;position:relative;border-radius:10px;background:#20252f;box-shadow:inset 0 0 0 1px #3a4152}
.wheel::after{content:"";position:absolute;inset:0;border-radius:10px;pointer-events:none;background:linear-gradient(#000c,#0000 28%,#0000 72%,#000c);box-shadow:inset 0 0 12px rgba(0,0,0,.7)}
.strip{transition:transform 1.3s cubic-bezier(.22,.9,.24,1)}
.strip span{display:block;height:84px;line-height:84px;text-align:center;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:50px;color:var(--brass-hi);font-variant-numeric:tabular-nums}
.hero-cap{margin-top:16px;font-size:17px}
.hero-sub{color:var(--dim);font-size:14.5px;margin-top:3px}
.strip3{display:grid;grid-template-columns:repeat(3,1fr);margin:22px 16px 0;border-top:1px solid var(--hair);border-bottom:1px solid var(--hair)}
.strip3>div{padding:14px 4px;text-align:center}
.strip3>div+div{border-left:1px solid var(--hair)}
.strip3 b{display:block;font-family:'Space Grotesk',sans-serif;font-size:26px;font-weight:700;font-variant-numeric:tabular-nums}
.strip3 span{font-size:13.5px;color:var(--dim)}

/* login */
.login{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;justify-content:center;padding:calc(var(--safe-t) + 28px) 22px calc(var(--safe-b) + 28px);max-width:460px;margin:0 auto}
.login h1{font-family:'Space Grotesk',sans-serif;font-size:36px;line-height:1.05;letter-spacing:-.025em;margin:14px 0 6px}
.login p{color:var(--dim);margin:0 0 22px}
.who{display:flex;align-items:center;gap:14px;width:100%;min-height:68px;padding:0 18px;margin-bottom:10px;border-radius:16px;background:var(--surface);border:1px solid var(--hair);font-size:19px;font-weight:600;font-family:'Space Grotesk',sans-serif}
.who:active{border-color:var(--brass)}
.who .avatar{width:40px;height:40px;font-size:17px}
.fine{color:var(--dim);font-size:14px;margin:10px 0 0}
.err-t{color:#f0b8b0;font-size:14.5px;margin:10px 0 0}

/* lightbox */
.lb{position:fixed;inset:0;z-index:80;background:#050608;display:flex;flex-direction:column;touch-action:none}
.lb-top{display:flex;align-items:center;justify-content:space-between;padding:calc(var(--safe-t) + 4px) 6px 4px;color:#fff;flex:none}
.lb-stage{flex:1;position:relative;overflow:hidden;touch-action:none}
.lb-stage img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;transform-origin:center center;will-change:transform;user-select:none;-webkit-user-select:none;-webkit-user-drag:none}
.lb-info{flex:none;padding:12px 16px calc(var(--safe-b) + 14px);display:flex;align-items:center;gap:12px;color:#fff}
.lb-info .grow{min-width:0}.lb-info b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lb-load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--dim);pointer-events:none}

/* picker, wrappers, misc */
.row.plain{border-bottom:0;padding-right:4px}
.rowwrap{display:flex;align-items:center;border-bottom:1px solid var(--hair)}
.rowwrap .row{flex:1;min-width:0}
.step[disabled]{opacity:.3}
.tick{width:26px;height:26px;border-radius:50%;border:1.5px solid var(--line);display:flex;align-items:center;justify-content:center;flex:none}
.tick.on{background:var(--brass);border-color:var(--brass);color:#17140c}
.sheet-b .row{margin:0 -20px;width:calc(100% + 40px)}
a.opt{color:inherit;text-decoration:none}
.opt:active{background:var(--raised)}
@media (prefers-reduced-motion:reduce){.strip,.sheet,.sheet-bg,.sw,.sw i,.pchip .c{transition:none!important}}
@media (min-width:700px){.m-app{max-width:560px;margin:0 auto;border-left:1px solid var(--hair);border-right:1px solid var(--hair)}.tabbar{max-width:560px;margin:0 auto}.fab{right:calc(50% - 264px)}}
`;

/* ---- back-button aware layers ----
   Every pushed screen and every sheet registers a "layer". Each one adds a
   browser history entry, so the Android back button and the iOS swipe-back
   gesture close the topmost sheet or screen instead of leaving the app. */
const LayerCtx = createContext(null);
function createLayerManager() {
  const layers = [];
  let seq = 0;
  let ignore = 0;
  let backCount = 0;
  let backTimer = null;
  const deferred = [];
  const flush = () => { while (deferred.length) deferred.shift()(); };
  const pushState = (id) => { try { window.history.pushState({ escapeLayer: id }, ""); } catch (e) { /* ignore */ } };
  return {
    push(close) {
      const id = ++seq;
      layers.push({ id, close });
      if (ignore > 0 || backTimer) deferred.push(() => pushState(id));
      else pushState(id);
      return id;
    },
    remove(id) {
      const i = layers.findIndex((l) => l.id === id);
      if (i === -1) return; // already closed by the back gesture itself
      layers.splice(i, 1);
      backCount += 1;
      if (!backTimer) {
        backTimer = setTimeout(() => {
          const k = backCount;
          backCount = 0;
          backTimer = null;
          ignore += 1;
          try { window.history.go(-k); } catch (e) { ignore -= 1; flush(); }
        }, 0);
      }
    },
    onPop() {
      if (ignore > 0) {
        ignore -= 1;
        if (ignore === 0 && !backTimer) flush();
        return;
      }
      const top = layers.pop();
      if (top) top.close();
    },
  };
}
function useLayer(active, onClose) {
  const mgr = useContext(LayerCtx);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!active || !mgr) return undefined;
    const id = mgr.push(() => closeRef.current());
    return () => mgr.remove(id);
  }, [active, mgr]);
}

const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);

/* ---- primitives ---- */
function Sheet({ open, onClose, title, children, footer }) {
  useLayer(open, onClose);
  const [mounted, setMounted] = useState(open);
  const [vis, setVis] = useState(false);
  const [dy, setDy] = useState(0);
  const startY = useRef(null);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setDy(0);
      let r2;
      const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setVis(true)); });
      return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
    }
    setVis(false);
    const t = setTimeout(() => setMounted(false), 260);
    return () => clearTimeout(t);
  }, [open]);
  useEffect(() => {
    if (!mounted) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [mounted]);
  if (!mounted) return null;
  const ts = (e) => { startY.current = e.touches[0].clientY; };
  const tm = (e) => { if (startY.current != null) setDy(Math.max(0, e.touches[0].clientY - startY.current)); };
  const te = () => { if (dy > 90) onClose(); setDy(0); startY.current = null; };
  return (
    <>
      <div className={cx("sheet-bg", vis && "vis")} onClick={onClose} />
      <div className={cx("sheet", vis && "vis")} role="dialog" aria-modal="true" aria-label={title || "Panel"} style={dy ? { transform: `translateY(${dy}px)`, transition: "none" } : undefined}>
        <div className="grab" onTouchStart={ts} onTouchMove={tm} onTouchEnd={te}><i /></div>
        {title ? (
          <div className="sheet-h">
            <h2>{title}</h2>
            <button className="ibtn" aria-label="Close" onClick={onClose}><Ico.x size={22} /></button>
          </div>
        ) : null}
        <div className="sheet-b">{children}</div>
        {footer ? <div className="sheet-f">{footer}</div> : null}
      </div>
    </>
  );
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button key={o.id} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

function SwitchRow({ label, hint, checked, onChange }) {
  return (
    <button className="swrow" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span><b>{label}</b>{hint ? <small>{hint}</small> : null}</span>
      <span className="sw"><i /></span>
    </button>
  );
}

function Field({ label, children }) {
  return (
    <div className="field">
      <span className="field-l">{label}</span>
      {children}
    </div>
  );
}

function EmptyState({ title, text, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {text ? <p>{text}</p> : null}
      {action}
    </div>
  );
}

function BarList({ items }) {
  const max = Math.max(1, ...items.map((i) => i[1]));
  return (
    <div className="bars">
      {items.map(([label, n]) => (
        <div className="bar" key={label}>
          <span>{label}</span>
          <i><b style={{ width: `${(n / max) * 100}%` }} /></i>
          <span>{n}</span>
        </div>
      ))}
    </div>
  );
}

function YearHeader({ year, count, noun }) {
  return (
    <div className="yr"><b>{year}</b><span>{plural(count, noun)}</span></div>
  );
}

function Header({ title, back, actions, brand }) {
  const { nav, me, openAccount } = useApp();
  return (
    <header className="hdr">
      <div className="hdr-in">
        {back ? <button className="ibtn" aria-label="Back" onClick={nav.back}><Ico.back size={28} /></button> : null}
        {brand ? (
          <div className="brand disp"><Ico.lock size={20} color="var(--brass)" />The Escape Log</div>
        ) : (
          <div className="hdr-title disp">{title}</div>
        )}
        {actions}
        {!back ? (
          <button className="ibtn" aria-label="Account and settings" onClick={openAccount}>
            <span className="avatar">{initialOf(me)}</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}

function Screen({ title, back, actions, brand, bare, children }) {
  return (
    <>
      <Header title={title} back={back} actions={actions} brand={brand} />
      <main className={cx("main", bare && "bare")}>{children}</main>
    </>
  );
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="search">
      <Ico.search className="si" size={18} />
      <input type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck="false" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      {value ? <button className="clr" aria-label="Clear search" onClick={() => onChange("")}><Ico.x size={18} /></button> : null}
    </div>
  );
}

function AppliedPills({ items }) {
  if (!items.length) return null;
  return (
    <div className="applied">
      {items.map((p) => (
        <span className="pill" key={p.key}>
          {p.label}
          <button aria-label={`Remove ${p.label}`} className="ibtn" style={{ width: 28, height: 28 }} onClick={p.onRemove}><Ico.x size={15} /></button>
        </span>
      ))}
    </div>
  );
}

function FilterSheet({ open, onClose, groups, extras, count, noun, onClear }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filters"
      footer={(
        <>
          <button className="btn btn-quiet" onClick={onClear}>Clear all</button>
          <button className="btn btn-primary grow" onClick={onClose}>{`Show ${plural(count, noun)}`}</button>
        </>
      )}
    >
      {extras}
      {groups.filter((g) => g.options.length).map((g) => (
        <div className="fgroup" key={g.key}>
          <div className="fgroup-l">{g.label}</div>
          <div className="chips">
            {g.options.map((o) => (
              <button key={o.id} className="chip" aria-pressed={g.selected.includes(o.id)} onClick={() => g.onToggle(o.id)}>
                {o.icon ? <o.icon size={16} color={o.color} /> : null}
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </Sheet>
  );
}

function SortSheet({ open, onClose, options, value, onChange }) {
  return (
    <Sheet open={open} onClose={onClose} title="Sort by">
      {options.map((o) => (
        <button key={o.id} className="opt" onClick={() => { onChange(o.id); onClose(); }}>
          <span>{o.label}</span>
          {value === o.id ? <Ico.check size={22} color="var(--brass-hi)" /> : null}
        </button>
      ))}
    </Sheet>
  );
}

/* Drag across the icons to scrub a rating; lift to set it. Half-points on the
   10-point scale, whole points elsewhere. Large - / + buttons for fine tuning. */
function RatingControl({ label, value, max, step, icon, color, onChange, onClear, readOnly, solid = true }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(null);
  const Icon = icon || Ico.star;
  const shown = drag != null ? drag : value || 0;
  const calc = (x) => {
    const r = ref.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (x - r.left) / (r.width || 1)));
    const v = Math.ceil((frac * max) / step - 1e-9) * step;
    return Math.min(max, Math.max(step, v));
  };
  const down = (e) => {
    if (readOnly) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    setDrag(calc(e.clientX));
  };
  const move = (e) => { if (drag != null) setDrag(calc(e.clientX)); };
  const up = (e) => {
    if (drag == null) return;
    const v = calc(e.clientX);
    setDrag(null);
    tick();
    onChange(v);
  };
  const key = (e) => {
    if (readOnly) return;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); onChange(Math.min(max, (value || 0) + step)); }
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); const nv = (value || 0) - step; nv < step ? onClear() : onChange(nv); }
  };
  const minus = () => { tick(); const nv = (value || 0) - step; nv < step - 1e-9 ? onClear() : onChange(nv); };
  const plus = () => { tick(); onChange(Math.min(max, (value || 0) + step)); };
  return (
    <div className="rate">
      <div className="rate-top">
        <span className="rate-l">{label}</span>
        {!readOnly && step < 1 ? <button className="step" aria-label={`Lower ${label} by half a point`} onClick={minus}><Ico.minus size={20} /></button> : null}
        <span className="rate-val">{shown ? shown : "-"}<small>{`/${max}`}</small></span>
        {!readOnly && step < 1 ? <button className="step" aria-label={`Raise ${label} by half a point`} onClick={plus}><Ico.plus size={20} /></button> : null}
      </div>
      <div
        className="stars"
        ref={ref}
        role="slider"
        tabIndex={readOnly ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value || 0}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={key}
      >
        {Array.from({ length: max }).map((_, i) => {
          const f = Math.max(0, Math.min(1, shown - i));
          return (
            <div className="star" key={i} style={{ maxWidth: max > 8 ? 46 : 64 }}>
              <Icon className="base" size={max > 8 ? 27 : 32} strokeWidth={1.6} />
              {f > 0 ? (
                <div className="fillclip" style={{ clipPath: `inset(0 ${(1 - f) * 100}% 0 0)` }}>
                  <Icon size={max > 8 ? 27 : 32} strokeWidth={solid ? 1.6 : 2.4} color={color || "var(--brass)"} fill={solid ? color || "var(--brass)" : "none"} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {!readOnly && value ? <button className="clear" onClick={() => { tick(); onClear(); }}>{`Clear my ${label.toLowerCase()}`}</button> : null}
    </div>
  );
}

function Dial({ value, digits = 3 }) {
  const str = String(Math.min(value, Math.pow(10, digits) - 1)).padStart(digits, "0");
  const [rolled, setRolled] = useState(false);
  useEffect(() => { const t = setTimeout(() => setRolled(true), 140); return () => clearTimeout(t); }, []);
  return (
    <div className="dial" role="img" aria-label={`${value} rooms escaped`}>
      {str.split("").map((d, i) => (
        <div className="wheel" key={i}>
          <div className="strip" style={{ transform: `translateY(${rolled ? -Number(d) * 10 : 0}%)`, transitionDelay: `${i * 110}ms` }}>
            {Array.from({ length: 10 }).map((__, n) => <span key={n}>{n}</span>)}
          </div>
        </div>
      ))}
    </div>
  );
}


/* ---- sign-in ---- */
function WhoAmI({ authRecords, onChoose, onCreatePassword, onVerifyPassword }) {
  const [selected, setSelected] = useState(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useLayer(!!selected, () => { setSelected(null); setPw(""); setPw2(""); setErr(""); });
  const hasPw = (n) => !!(authRecords && authRecords[n]);
  const isNew = !!selected && !hasPw(selected);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (isNew) {
      if (pw.length < 4) { setErr("Use at least 4 characters."); return; }
      if (pw !== pw2) { setErr("The two passwords don't match."); return; }
    }
    setBusy(true);
    try {
      if (isNew) {
        await onCreatePassword(selected, pw);
        onChoose(selected);
      } else if (await onVerifyPassword(selected, pw)) {
        onChoose(selected);
      } else {
        setErr("That password doesn't match. Try again.");
      }
    } catch (ex) {
      setErr("Couldn't reach the shared data. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (selected) {
    return (
      <div className="login">
        <span className="avatar" style={{ width: 52, height: 52, fontSize: 22 }}>{initialOf(selected)}</span>
        <h1>{isNew ? `Set a password, ${selected}` : `Welcome back, ${selected}`}</h1>
        <p>{isNew ? "First time on this crew. Pick a password you'll use on every device." : "Enter your password to continue."}</p>
        <form onSubmit={submit}>
          <input type="text" name="username" autoComplete="username" value={selected} readOnly tabIndex={-1} aria-hidden="true" style={{ position: "absolute", opacity: 0, height: 0, width: 0 }} />
          <input className="inp" type="password" name="password" placeholder="Password" autoComplete={isNew ? "new-password" : "current-password"} enterKeyHint={isNew ? "next" : "go"} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          {isNew ? <input className="inp" style={{ marginTop: 10 }} type="password" name="confirm" placeholder="Repeat password" autoComplete="new-password" enterKeyHint="go" value={pw2} onChange={(e) => setPw2(e.target.value)} /> : null}
          {err ? <p className="err-t" role="alert">{err}</p> : null}
          <button className="btn btn-primary btn-block" style={{ marginTop: 18 }} type="submit" disabled={busy || !pw}>{busy ? "Checking" : isNew ? "Set password and sign in" : "Sign in"}</button>
          <button className="btn btn-block" style={{ marginTop: 8, color: "var(--dim)" }} type="button" onClick={() => { setSelected(null); setPw(""); setPw2(""); setErr(""); }}>{`Not ${selected}?`}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="login">
      <Ico.lock size={34} color="var(--brass)" />
      <h1 className="disp">The Escape Log</h1>
      <p>Who's playing?</p>
      {MEMBERS.map((m) => (
        <button key={m} className="who" onClick={() => { tick(); setSelected(m); }}>
          <span className="avatar">{initialOf(m)}</span>
          {m}
        </button>
      ))}
      <button className="btn btn-block btn-quiet" style={{ marginTop: 14 }} onClick={() => onChoose(GUEST_NAME)}>
        <Ico.user size={18} /> Look around as a guest
      </button>
      <p className="fine">Guests can browse everything but can't change anything.</p>
    </div>
  );
}

/* ---- rows ---- */
function RoomRow({ room, flagDefs, onOpen, rank, score, minis, meta = true, plain }) {
  const flagIcons = (flagDefs || []).filter((f) => (room.flags || []).includes(f.id));
  const hasPhotos = (room.photos || []).length > 0;
  return (
    <button className={cx("row", plain && "plain")} onClick={onOpen}>
      {rank != null ? <span className={cx("rank-n", rank === 1 && "top")}>{rank}</span> : null}
      <span className="rr-main">
        <span className="rr-title" style={{ display: "block" }}>{room.name}</span>
        {room.venue ? <span className="rr-sub" style={{ display: "block" }}>{room.venue}</span> : null}
        {meta ? (
          <span className="rr-meta">
            {room.city ? <span><Ico.pin size={13} />{room.city}</span> : null}
            {room.status === "played" && room.datePlayed ? <span><Ico.cal size={13} />{fmtDate(room.datePlayed)}</span> : null}
            {room.status === "played" && room.result === "not-escaped" ? <span className="danger">Not escaped</span> : null}
          </span>
        ) : null}
        {minis}
      </span>
      <span className="rr-side">
        {score != null ? <span className="rr-score">{score}</span> : null}
        {flagIcons.length || hasPhotos ? (
          <span className="rr-icons">
            {flagIcons.map((f) => { const Ic = resolveFlagIcon(f.icon); return <Ic key={f.id} size={16} color={f.color} aria-label={f.label} />; })}
            {hasPhotos ? <Ico.camera size={16} aria-label="Has photos" /> : null}
          </span>
        ) : null}
      </span>
    </button>
  );
}

const countBy = (list, key) => {
  const m = {};
  list.forEach((r) => { if (r[key]) m[r[key]] = (m[r[key]] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pl"));
};

/* ---- home ---- */
function HomeScreen() {
  const { data, nav, flags, isGuest } = useApp();
  const played = data.rooms.filter((r) => r.status === "played");
  const wish = data.rooms.filter((r) => r.status === "wishlist");
  const escaped = played.filter((r) => r.result !== "not-escaped").length;
  const rate = played.length ? Math.round((escaped / played.length) * 100) : null;
  const avgs = played.map(avgRating).filter((v) => v !== null);
  const groupAvg = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null;
  const top = played.map((r) => ({ r, a: avgRating(r) })).filter((x) => x.a !== null).sort((a, b) => b.a - a.a).slice(0, 5);
  const recent = [...played].sort((a, b) => (b.datePlayed || "").localeCompare(a.datePlayed || "")).slice(0, 5);
  const cities = countBy(played, "city").slice(0, 6);
  const genres = countBy(played, "category").slice(0, 6);

  if (!data.rooms.length) {
    return (
      <Screen brand>
        <div className="hero"><Dial value={0} /></div>
        <EmptyState
          title="Nothing logged yet"
          text={isGuest ? "Once the crew adds rooms, they'll show up here." : "Add the first room you've played, or one you want to try."}
          action={isGuest ? null : <button className="btn btn-primary" onClick={() => nav.push({ type: "roomForm", room: emptyRoom(null) })}><Ico.plus size={20} /> Add a room</button>}
        />
      </Screen>
    );
  }

  return (
    <Screen brand>
      <section className="hero">
        <Dial value={escaped} />
        <div className="hero-cap disp">{escaped === 1 ? "room escaped" : "rooms escaped"}</div>
        <div className="hero-sub">{`${plural(played.length, "room")} played together`}</div>
      </section>
      <div className="strip3">
        <div><b>{groupAvg !== null ? groupAvg.toFixed(1) : "-"}</b><span>Group average</span></div>
        <div><b>{rate !== null ? `${rate}%` : "-"}</b><span>Escape rate</span></div>
        <button style={{ padding: 0, textAlign: "center" }} onClick={() => nav.goList("wishlist")}><b style={{ display: "block", fontFamily: "'Space Grotesk',sans-serif", fontSize: 26, fontWeight: 700 }}>{wish.length}</b><span style={{ fontSize: 13.5, color: "var(--dim)" }}>On the wishlist</span></button>
      </div>

      {top.length ? (
        <>
          <h2 className="sec-h">Best rooms<small>by group average</small></h2>
          {top.map((x, i) => (
            <RoomRow key={x.r.id} room={x.r} flagDefs={flags} rank={i + 1} score={x.a.toFixed(1)} meta={false} onOpen={() => nav.openRoom(x.r.id)} />
          ))}
        </>
      ) : null}

      {recent.length ? (
        <>
          <h2 className="sec-h">Recently played</h2>
          {recent.map((r) => <RoomRow key={r.id} room={r} flagDefs={flags} score={avgRating(r) !== null ? avgRating(r).toFixed(1) : null} onOpen={() => nav.openRoom(r.id)} />)}
        </>
      ) : null}

      {cities.length ? (
        <>
          <h2 className="sec-h">Where you've played</h2>
          <BarList items={cities} />
        </>
      ) : null}
      {genres.length ? (
        <>
          <h2 className="sec-h">Genres</h2>
          <BarList items={genres} />
        </>
      ) : null}
    </Screen>
  );
}

/* ---- rooms (completed + wishlist) ---- */
function RoomsScreen() {
  const { data, me, nav, filters, setFilter, flags, isGuest } = useApp();
  const wish = nav.roomsSeg === "wishlist";
  const key = wish ? "wishlist" : "rooms";
  const f = filters[key];
  const patch = (p) => setFilter(key, p);
  const [sortOpen, setSortOpen] = useState(false);
  const [filtOpen, setFiltOpen] = useState(false);

  const base = useMemo(() => data.rooms.filter((r) => (r.status === "played") !== wish), [data.rooms, wish]);
  const playedCount = data.rooms.filter((r) => r.status === "played").length;
  const wishCount = data.rooms.length - playedCount;
  const cities = useMemo(() => distinct(base.map((r) => r.city)), [base]);
  const genres = useMemo(() => distinct(base.map((r) => r.category)), [base]);
  const countries = useMemo(() => distinct(base.map((r) => r.country)), [base]);
  const list = useMemo(() => sortRooms(base.filter((r) => roomMatches(r, f, me)), f.sortBy), [base, f, me]);
  const grouped = !wish && (f.sortBy === "visited-desc" || f.sortBy === "visited-asc");
  const years = useMemo(() => (grouped ? groupByYear(list, "datePlayed") : []), [grouped, list]);
  const sortOptions = wish ? SORT_OPTIONS.filter((o) => !o.id.startsWith("visited-")) : SORT_OPTIONS;
  const sortLabel = (sortOptions.find((o) => o.id === f.sortBy) || sortOptions[0]).label;
  const toggle = (field) => (id) => patch({ [field]: f[field].includes(id) ? f[field].filter((x) => x !== id) : [...f[field], id] });
  const active = countActive(f);
  const pills = [
    ...f.cities.map((c) => ({ key: `c${c}`, label: c, onRemove: () => toggle("cities")(c) })),
    ...f.countries.map((c) => ({ key: `n${c}`, label: c, onRemove: () => toggle("countries")(c) })),
    ...f.genres.map((c) => ({ key: `g${c}`, label: c, onRemove: () => toggle("genres")(c) })),
    ...f.flags.map((id) => { const d = flags.find((x) => x.id === id); return { key: `f${id}`, label: d ? d.label : id, onRemove: () => toggle("flags")(id) }; }),
    ...(f.onlyUnrated ? [{ key: "unrated", label: "Not rated by me", onRemove: () => patch({ onlyUnrated: false }) }] : []),
  ];
  const clearAll = () => patch({ search: "", cities: [], genres: [], countries: [], flags: [], onlyUnrated: false });

  return (
    <Screen title="Rooms">
      <div className="tools">
        <div className="tools-row">
          <div className="grow">
            <Segmented
              value={wish ? "wishlist" : "completed"}
              onChange={(v) => nav.setRoomsSeg(v === "wishlist" ? "wishlist" : "completed")}
              options={[{ id: "completed", label: `Completed ${playedCount}` }, { id: "wishlist", label: `Wishlist ${wishCount}` }]}
            />
          </div>
        </div>
        <div className="tools-row">
          <SearchBox value={f.search} onChange={(v) => patch({ search: v })} placeholder="Search rooms" />
          <button className="tbtn" aria-label={`Sort: ${sortLabel}`} onClick={() => setSortOpen(true)}><Ico.sort size={20} /></button>
          <button className="tbtn" aria-label="Filters" aria-pressed={active > 0} onClick={() => setFiltOpen(true)}>
            <Ico.filter size={20} />
            {active > 0 ? <span className="badge">{active}</span> : null}
          </button>
        </div>
      </div>
      <AppliedPills items={pills} />
      <div className="count-line">{`${plural(list.length, "room")}, ${sortLabel.toLowerCase()}`}</div>

      {!list.length ? (
        <EmptyState
          title={base.length ? "No rooms match" : wish ? "The wishlist is empty" : "No completed rooms yet"}
          text={base.length ? "Try removing a filter or clearing the search." : wish ? "Rooms you want to try will collect here." : "Rooms you've played will show up here."}
          action={base.length && (active > 0 || f.search) ? <button className="btn btn-quiet" onClick={clearAll}>Clear filters</button> : null}
        />
      ) : grouped ? (
        years.map((g) => (
          <section key={g.year}>
            <YearHeader year={g.year} count={g.items.length} noun="room" />
            {g.items.map((r) => <RoomRow key={r.id} room={r} flagDefs={flags} score={avgRating(r) !== null ? avgRating(r).toFixed(1) : null} onOpen={() => nav.openRoom(r.id)} />)}
          </section>
        ))
      ) : (
        list.map((r) => <RoomRow key={r.id} room={r} flagDefs={flags} score={!wish && avgRating(r) !== null ? avgRating(r).toFixed(1) : null} onOpen={() => nav.openRoom(r.id)} />)
      )}

      <SortSheet open={sortOpen} onClose={() => setSortOpen(false)} options={sortOptions} value={f.sortBy} onChange={(v) => patch({ sortBy: v })} />
      <FilterSheet
        open={filtOpen}
        onClose={() => setFiltOpen(false)}
        count={list.length}
        noun="room"
        onClear={clearAll}
        extras={!wish && !isGuest ? <SwitchRow label="Only rooms I haven't rated" checked={f.onlyUnrated} onChange={(v) => patch({ onlyUnrated: v })} /> : null}
        groups={[
          { key: "city", label: "City", options: cities.map((c) => ({ id: c, label: c })), selected: f.cities, onToggle: toggle("cities") },
          { key: "genre", label: "Genre", options: genres.map((c) => ({ id: c, label: c })), selected: f.genres, onToggle: toggle("genres") },
          { key: "country", label: "Country", options: countries.map((c) => ({ id: c, label: c })), selected: f.countries, onToggle: toggle("countries") },
          { key: "flags", label: "Flags", options: flags.map((d) => ({ id: d.id, label: d.label, icon: resolveFlagIcon(d.icon), color: d.color })), selected: f.flags, onToggle: toggle("flags") },
        ]}
      />
    </Screen>
  );
}

/* ---- ranking ---- */
function RankingScreen() {
  const { data, me, isGuest, filters, setFilter, flags } = useApp();
  const { nav } = useApp();
  const f = filters.ranking;
  const patch = (p) => setFilter("ranking", p);
  const personal = f.mode === "personal" && !isGuest;
  const [filtOpen, setFiltOpen] = useState(false);
  const short = useMemo(() => shortNames(MEMBERS), []);
  const played = useMemo(() => data.rooms.filter((r) => r.status === "played"), [data.rooms]);
  const cities = useMemo(() => distinct(played.map((r) => r.city)), [played]);
  const genres = useMemo(() => distinct(played.map((r) => r.category)), [played]);
  const countries = useMemo(() => distinct(played.map((r) => r.country)), [played]);
  const ranked = useMemo(() => {
    const rows = played
      .filter((r) => roomMatches(r, f, me) && (!personal || roomParticipants(r).includes(me)))
      .map((r) => ({ r, v: personal ? (typeof (r.ratings || {})[me] === "number" ? r.ratings[me] : null) : avgRating(r) }));
    rows.sort((a, b) => (f.sortDir === "worst" ? (a.v ?? -1) - (b.v ?? -1) : (b.v ?? -1) - (a.v ?? -1)));
    return rows;
  }, [played, f, me, personal]);
  const toggle = (field) => (id) => patch({ [field]: f[field].includes(id) ? f[field].filter((x) => x !== id) : [...f[field], id] });
  const active = countActive(f);
  const clearAll = () => patch({ cities: [], genres: [], countries: [], flags: [], onlyUnrated: false });
  const pills = [
    ...f.cities.map((c) => ({ key: `c${c}`, label: c, onRemove: () => toggle("cities")(c) })),
    ...f.countries.map((c) => ({ key: `n${c}`, label: c, onRemove: () => toggle("countries")(c) })),
    ...f.genres.map((c) => ({ key: `g${c}`, label: c, onRemove: () => toggle("genres")(c) })),
    ...f.flags.map((id) => { const d = flags.find((x) => x.id === id); return { key: `f${id}`, label: d ? d.label : id, onRemove: () => toggle("flags")(id) }; }),
    ...(f.onlyUnrated ? [{ key: "unrated", label: "Not rated by me", onRemove: () => patch({ onlyUnrated: false }) }] : []),
  ];

  return (
    <Screen title="Ranking">
      <div className="tools">
        <div className="tools-row">
          {!isGuest ? (
            <div className="grow">
              <Segmented value={personal ? "personal" : "group"} onChange={(v) => patch({ mode: v })} options={[{ id: "group", label: "Group" }, { id: "personal", label: "Mine" }]} />
            </div>
          ) : <div className="grow" />}
          <button className="tbtn wide" aria-label="Reverse order" onClick={() => patch({ sortDir: f.sortDir === "worst" ? "best" : "worst" })}>
            <Ico.sort size={19} />{f.sortDir === "worst" ? "Worst first" : "Best first"}
          </button>
          <button className="tbtn" aria-label="Filters" aria-pressed={active > 0} onClick={() => setFiltOpen(true)}>
            <Ico.filter size={20} />
            {active > 0 ? <span className="badge">{active}</span> : null}
          </button>
        </div>
      </div>
      <AppliedPills items={pills} />
      <div className="count-line">{personal ? `${plural(ranked.length, "room")} you played` : plural(ranked.length, "room")}</div>
      {!ranked.length ? (
        <EmptyState title={played.length ? "No rooms match" : "Nothing to rank yet"} text={played.length ? "Try removing a filter." : "The ranking fills in once rooms are played and rated."} action={active > 0 ? <button className="btn btn-quiet" onClick={clearAll}>Clear filters</button> : null} />
      ) : (
        ranked.map((x, i) => (
          <RoomRow
            key={x.r.id}
            room={x.r}
            flagDefs={flags}
            rank={i + 1}
            meta={false}
            score={x.v !== null ? fmtRating(x.v) : null}
            minis={!personal ? (
              <span className="mini-row">
                {MEMBERS.filter((m) => typeof (x.r.ratings || {})[m] === "number").map((m) => (
                  <span key={m} className={cx("mini", m === me && "me")}>{`${short[m]} ${x.r.ratings[m]}`}</span>
                ))}
              </span>
            ) : (x.v === null ? <span className="rr-sub" style={{ display: "block" }}>Not rated by you yet</span> : null)}
            onOpen={() => nav.openRoom(x.r.id)}
          />
        ))
      )}
      <FilterSheet
        open={filtOpen}
        onClose={() => setFiltOpen(false)}
        count={ranked.length}
        noun="room"
        onClear={clearAll}
        extras={!isGuest ? <SwitchRow label="Only rooms I haven't rated" checked={f.onlyUnrated} onChange={(v) => patch({ onlyUnrated: v })} /> : null}
        groups={[
          { key: "city", label: "City", options: cities.map((c) => ({ id: c, label: c })), selected: f.cities, onToggle: toggle("cities") },
          { key: "genre", label: "Genre", options: genres.map((c) => ({ id: c, label: c })), selected: f.genres, onToggle: toggle("genres") },
          { key: "country", label: "Country", options: countries.map((c) => ({ id: c, label: c })), selected: f.countries, onToggle: toggle("countries") },
          { key: "flags", label: "Flags", options: flags.map((d) => ({ id: d.id, label: d.label, icon: resolveFlagIcon(d.icon), color: d.color })), selected: f.flags, onToggle: toggle("flags") },
        ]}
      />
    </Screen>
  );
}


Ico.skull = pick("Skull");

/* ---- photos ---- */
function Thumb({ photo, onClick }) {
  const { drive } = useApp();
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const [seen, setSeen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (seen) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === "undefined") { setSeen(true); return undefined; }
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) setSeen(true); }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  useEffect(() => {
    if (!seen) return undefined;
    let dead = false;
    (async () => {
      try {
        const token = await drive.getToken();
        const url = await fetchDriveThumbnailUrl(photo, token);
        if (!dead) setSrc(url);
      } catch (e) {
        if (!dead) setFailed(true);
      }
    })();
    return () => { dead = true; };
  }, [seen, photo.driveFileId, photo.thumbFileId]);
  return (
    <button ref={ref} className="ph" onClick={onClick} aria-label="Open photo">
      {src ? <img src={src} alt="" /> : failed ? <span>Couldn't load</span> : null}
    </button>
  );
}

/* Full-screen viewer: swipe between photos, pinch or double-tap to zoom,
   drag down to close. */
function Lightbox({ photos, index, onIndex, onClose, caption, onOpenRoom, onDelete }) {
  const { drive } = useApp();
  useLayer(true, onClose);
  const photo = photos[index];
  const [src, setSrc] = useState(null);
  const [t, setT] = useState({ s: 1, x: 0, y: 0, anim: false });
  const stage = useRef(null);
  const g = useRef({ mode: null });
  const lastTap = useRef(0);

  useEffect(() => {
    let dead = false;
    setSrc(null);
    setT({ s: 1, x: 0, y: 0, anim: false });
    (async () => {
      try {
        const token = await drive.getToken();
        fetchDriveThumbnailUrl(photo, token).then((u) => { if (!dead) setSrc((cur) => cur || u); }).catch(() => {});
        const url = await fetchDrivePhotoUrl(photo.driveFileId, token);
        if (!dead) setSrc(url);
      } catch (e) { /* keep whatever is showing */ }
    })();
    return () => { dead = true; };
  }, [photo.id]);

  useEffect(() => {
    const k = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < photos.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [index, photos.length]);

  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const box = () => stage.current.getBoundingClientRect();
  const clampT = (s, x, y) => {
    const r = box();
    const mx = ((s - 1) * r.width) / 2;
    const my = ((s - 1) * r.height) / 2;
    return { s, x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)), anim: false };
  };
  const mid = (ts) => {
    const r = box();
    return { x: (ts[0].clientX + ts[1].clientX) / 2 - r.left - r.width / 2, y: (ts[0].clientY + ts[1].clientY) / 2 - r.top - r.height / 2 };
  };
  const start = (e) => {
    const ts = e.touches;
    if (ts.length === 2) {
      const m = mid(ts);
      g.current = { mode: "pinch", d0: dist(ts[0], ts[1]), s0: t.s, x0: t.x, y0: t.y, mx0: m.x, my0: m.y };
    } else if (ts.length === 1) {
      g.current = { mode: "one", sx: ts[0].clientX, sy: ts[0].clientY, x0: t.x, y0: t.y, moved: false };
    }
    if (t.anim) setT((c) => ({ ...c, anim: false }));
  };
  const move = (e) => {
    const ts = e.touches;
    const st = g.current;
    if (st.mode === "pinch" && ts.length === 2) {
      const s = Math.min(5, Math.max(1, (st.s0 * dist(ts[0], ts[1])) / st.d0));
      const m = mid(ts);
      const k = s / st.s0;
      setT(clampT(s, m.x - (st.mx0 - st.x0) * k, m.y - (st.my0 - st.y0) * k));
    } else if (st.mode === "one" && ts.length === 1) {
      const dx = ts[0].clientX - st.sx;
      const dy = ts[0].clientY - st.sy;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) st.moved = true;
      if (t.s > 1) setT(clampT(t.s, st.x0 + dx, st.y0 + dy));
      else setT({ s: 1, x: dx, y: dy > 0 ? dy : dy * 0.25, anim: false });
    }
  };
  const end = (e) => {
    const st = g.current;
    if (st.mode === "pinch") {
      if (e.touches.length < 2) {
        g.current = { mode: null };
        setT((c) => (c.s < 1.05 ? { s: 1, x: 0, y: 0, anim: true } : c));
      }
      return;
    }
    if (st.mode !== "one") return;
    g.current = { mode: null };
    if (!st.moved) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        lastTap.current = 0;
        setT((c) => (c.s > 1 ? { s: 1, x: 0, y: 0, anim: true } : { s: 2.5, x: 0, y: 0, anim: true }));
      } else {
        lastTap.current = now;
      }
      return;
    }
    if (t.s > 1) return;
    if (Math.abs(t.x) > 70 && Math.abs(t.x) > Math.abs(t.y)) {
      if (t.x < 0 && index < photos.length - 1) { tick(); onIndex(index + 1); return; }
      if (t.x > 0 && index > 0) { tick(); onIndex(index - 1); return; }
    } else if (t.y > 110) {
      onClose();
      return;
    }
    setT({ s: 1, x: 0, y: 0, anim: true });
  };

  return (
    <div className="lb" role="dialog" aria-modal="true" aria-label="Photo viewer">
      <div className="lb-top">
        <button className="ibtn" aria-label="Close photo" onClick={onClose}><Ico.x size={26} color="#fff" /></button>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{photos.length > 1 ? `${index + 1} of ${photos.length}` : ""}</span>
        {onDelete ? <button className="ibtn" aria-label="Delete photo" onClick={() => onDelete(photo)}><Ico.trash size={22} color="#fff" /></button> : <span style={{ width: 44 }} />}
      </div>
      <div className="lb-stage" ref={stage} onTouchStart={start} onTouchMove={move} onTouchEnd={end} onTouchCancel={end}>
        {src ? (
          <img
            src={src}
            alt=""
            draggable={false}
            style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`, transition: t.anim ? "transform .22s ease-out" : "none", opacity: t.s === 1 && t.y > 0 ? Math.max(0.35, 1 - t.y / 420) : 1 }}
          />
        ) : <div className="lb-load">Loading photo</div>}
      </div>
      <div className="lb-info">
        <div className="grow">
          <b>{caption ? caption(photo).title : ""}</b>
          <span className="dim sm">{caption ? caption(photo).sub : ""}</span>
        </div>
        {onOpenRoom ? <button className="btn btn-quiet" style={{ height: 44 }} onClick={() => onOpenRoom(photo)}>Open room</button> : null}
      </div>
    </div>
  );
}

/* ---- room page ---- */
function RoomScreen({ roomId }) {
  const { data, nav } = useApp();
  const room = data.rooms.find((r) => r.id === roomId);
  if (!room) {
    return (
      <Screen title="Room" back>
        <EmptyState title="This room is gone" text="Someone in the crew deleted it." action={<button className="btn btn-quiet" onClick={nav.back}>Go back</button>} />
      </Screen>
    );
  }
  return <RoomView room={room} />;
}

function RoomView({ room }) {
  const { me, isGuest, nav, act, flags, drive, toast, ask } = useApp();
  const played = room.status === "played";
  const [menu, setMenu] = useState(false);
  const [editNote, setEditNote] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [editWalk, setEditWalk] = useState(false);
  const [walkText, setWalkText] = useState("");
  const [lb, setLb] = useState(null);
  const [upload, setUpload] = useState(null);
  const avg = avgRating(room);
  const diffAvg = avgOfMap(room.difficultyRatings);
  const scaryAvg = avgOfMap(room.scaryRatings);
  const roomFlags = flags.filter((f) => (room.flags || []).includes(f.id));
  const who = roomParticipants(room);
  const photos = room.photos || [];
  const seg = played ? "completed" : "wishlist";

  const setMine = (field, v) => act.updateRoom(room.id, (r) => ({ [field]: { ...(r[field] || {}), [me]: v } }));
  const clearMine = (field) => act.updateRoom(room.id, (r) => { const n = { ...(r[field] || {}) }; delete n[me]; return { [field]: n }; });

  const saveNote = () => { act.updateRoom(room.id, (r) => ({ notes: { ...(r.notes || {}), [me]: noteText.trim() } })); setEditNote(false); toast("Note saved"); };
  const saveWalk = () => { act.updateRoom(room.id, { walkthrough: walkText.trim() }); setEditWalk(false); toast("Walkthrough saved"); };

  const onPick = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUpload({ done: 0, total: files.length });
    const added = [];
    let failed = 0;
    try {
      const token = await drive.getToken();
      for (const file of files) {
        try {
          const u = await uploadPhotoToDrive(file, token);
          added.push({ id: uid(), driveFileId: u.id, thumbFileId: u.thumbId || null, name: u.name, mimeType: u.mimeType, addedBy: me });
        } catch (e) { failed += 1; }
        setUpload((p) => ({ done: p.done + 1, total: p.total }));
      }
      if (added.length) act.updateRoom(room.id, (r) => ({ photos: [...(r.photos || []), ...added] }));
      if (added.length) toast(`${plural(added.length, "photo")} added`);
      if (failed) toast(`${failed} of ${files.length} didn't upload. Try those again.`, "err");
    } catch (e) {
      toast(e.message || "Couldn't reach Google Drive. Try reconnecting in Settings.", "err");
    } finally {
      setUpload(null);
    }
  };
  const removePhoto = (photo) => ask({
    title: "Delete this photo?",
    body: "It disappears for everyone and is deleted from Google Drive.",
    action: "Delete photo",
    danger: true,
    onConfirm: async () => {
      setLb(null);
      act.updateRoom(room.id, (r) => ({ photos: (r.photos || []).filter((p) => p.id !== photo.id) }));
      try {
        const token = await drive.getToken();
        await deletePhotoFromDrive(photo.driveFileId, token);
        if (photo.thumbFileId) await deletePhotoFromDrive(photo.thumbFileId, token);
      } catch (e) { /* the room no longer lists it; a leftover Drive file is harmless */ }
      toast("Photo deleted");
    },
  });

  return (
    <Screen
      title=""
      back
      actions={!isGuest ? <button className="ibtn" aria-label="Room actions" onClick={() => setMenu(true)}><Ico.more size={26} /></button> : null}
    >
      <div className="pad">
        <div className="status-line">
          {played ? <Ico.unlock size={16} color="var(--success)" /> : <Ico.lock size={16} />}
          {played ? "Completed" : "On the wishlist"}
        </div>
        <h1 className="room-name">{room.name}</h1>
        {room.venue ? <button className="linkish" onClick={() => nav.goList(seg, { search: room.venue })}>{room.venue}</button> : null}

        <div className="facts">
          {room.city || room.country ? (
            <div>
              <Ico.pin size={17} />
              <span>
                {room.city ? <button className="linkish" onClick={() => nav.goList(seg, { cities: [room.city] })}>{room.city}</button> : null}
                {room.city && room.country ? ", " : ""}
                {room.country ? <button className="linkish" onClick={() => nav.goList(seg, { countries: [room.country] })}>{room.country}</button> : null}
              </span>
            </div>
          ) : null}
          <div><Ico.skull size={17} />{room.difficulty}</div>
          {room.category ? <div><Ico.palette size={17} />{room.category}</div> : null}
          {played && room.datePlayed ? <div><Ico.cal size={17} />{fmtDate(room.datePlayed)}</div> : null}
          {played ? (
            <div className={room.result === "not-escaped" ? "bad" : "ok"}>
              {room.result === "not-escaped" ? <Ico.x size={17} /> : <Ico.check size={17} />}
              {room.result === "not-escaped" ? "Not escaped" : "Escaped"}{room.timeNote ? `, ${room.timeNote}` : ""}
            </div>
          ) : null}
          {played && room.price !== "" && room.price != null ? <div><Ico.wallet size={17} />{`${room.price} ${room.currency || "PLN"}`}</div> : null}
          {roomFlags.map((f) => { const Ic = resolveFlagIcon(f.icon); return <div key={f.id} style={{ color: f.color }}><Ic size={17} />{f.label}</div>; })}
          {room.lockmeUrl ? <div><Ico.link size={17} /><a className="linkish" style={{ color: "var(--brass-hi)" }} href={room.lockmeUrl} target="_blank" rel="noreferrer">Open on lock.me</a></div> : null}
        </div>

        {played ? (
          <>
            <div className="pchips" style={{ marginTop: 22 }}>
              {MEMBERS.map((m) => (
                <div key={m} className="pchip on-brass" data-on={who.includes(m)} aria-pressed={who.includes(m)}>
                  <span className="c"><Ico.user size={22} /></span>
                  <span>{m}</span>
                  <span className="xs" style={{ marginTop: -4 }}>{who.includes(m) ? "played" : "sat out"}</span>
                </div>
              ))}
            </div>
            <div className="avgs">
              <div><div className="avg-big">{avg !== null ? avg.toFixed(1) : "-"}</div><div className="avg-cap">group average out of 10</div></div>
              {diffAvg !== null || scaryAvg !== null ? (
                <div className="avg-col">
                  {diffAvg !== null ? <div className="avg-small" style={{ color: "var(--danger)" }}><Ico.dumbbell size={18} />{diffAvg.toFixed(1)}<span className="dim xs" style={{ fontFamily: "Inter" }}>difficulty</span></div> : null}
                  {scaryAvg !== null ? <div className="avg-small" style={{ color: "var(--teal)" }}><Ico.ghost size={18} />{scaryAvg.toFixed(1)}<span className="dim xs" style={{ fontFamily: "Inter" }}>scariness</span></div> : null}
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {!played && !isGuest ? (
          <button className="btn btn-primary btn-block" style={{ marginTop: 22 }} onClick={() => { act.markPlayed(room); toast("Marked as played"); }}>
            <Ico.unlock size={20} /> Mark as played
          </button>
        ) : null}
      </div>

      {played ? (
        <>
          <h2 className="sec-h">Your ratings</h2>
          <div className="pad">
            {isGuest ? <p className="dim">Guests can look but not rate. Sign in as a crew member to add your ratings.</p> : (
              <>
                <RatingControl label="Rating" value={(room.ratings || {})[me]} max={10} step={0.5} onChange={(v) => setMine("ratings", v)} onClear={() => clearMine("ratings")} />
                <RatingControl label="Difficulty" value={(room.difficultyRatings || {})[me]} max={6} step={1} icon={Ico.dumbbell} solid={false} color="var(--danger)" onChange={(v) => setMine("difficultyRatings", v)} onClear={() => clearMine("difficultyRatings")} />
                <RatingControl label="Scariness" value={(room.scaryRatings || {})[me]} max={6} step={1} icon={Ico.ghost} color="var(--teal)" onChange={(v) => setMine("scaryRatings", v)} onClear={() => clearMine("scaryRatings")} />
              </>
            )}
          </div>

          <h2 className="sec-h">Notes</h2>
          <div className="pad">
            {MEMBERS.map((m) => {
              const text = (room.notes || {})[m] || "";
              if (m === me && !isGuest) {
                return editNote ? (
                  <div className="note" key={m}>
                    <b>{`${m} (you)`}</b>
                    <textarea className="inp" style={{ marginTop: 8 }} autoFocus value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Puzzle quality, story, scares, would you recommend it?" />
                    <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                      <button className="btn btn-primary grow" onClick={saveNote}>Save note</button>
                      <button className="btn btn-quiet" onClick={() => setEditNote(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button className="note mine" key={m} onClick={() => { setNoteText(text); setEditNote(true); }}>
                    <b>{`${m} (you)`}</b>
                    <p className={text ? "" : "dim"}>{text || "Tap to add your note"}</p>
                  </button>
                );
              }
              return <div className="note" key={m}><b>{m}</b><p className={text ? "" : "dim"}>{text || "No note yet"}</p></div>;
            })}
          </div>

          <h2 className="sec-h">Walkthrough</h2>
          <div className="pad">
            {editWalk ? (
              <>
                <textarea className="inp" autoFocus style={{ minHeight: 160 }} value={walkText} onChange={(e) => setWalkText(e.target.value)} placeholder="Puzzle order, hints used, anything worth remembering for next time" />
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <button className="btn btn-primary grow" onClick={saveWalk}>Save walkthrough</button>
                  <button className="btn btn-quiet" onClick={() => setEditWalk(false)}>Cancel</button>
                </div>
              </>
            ) : isGuest ? (
              <p className={room.walkthrough ? "" : "dim"} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{room.walkthrough || "No walkthrough yet."}</p>
            ) : (
              <button className="note mine" style={{ borderBottom: 0 }} onClick={() => { setWalkText(room.walkthrough || ""); setEditWalk(true); }}>
                <p className={room.walkthrough ? "" : "dim"} style={{ marginTop: 0 }}>{room.walkthrough || "Tap to write down how you solved it"}</p>
              </button>
            )}
          </div>

          <h2 className="sec-h">Photos<small>{photos.length ? plural(photos.length, "photo") : ""}</small></h2>
          <div className="pad">
            {!drive.available ? (
              <p className="dim">Photos need the hosted site and Google Drive. They aren't available in this preview.</p>
            ) : !drive.connected ? (
              <p className="dim">{isGuest ? "No photos yet." : "Google Drive isn't connected yet. Connect it in Settings to add photos."}</p>
            ) : (
              <div className="pgrid">
                {photos.map((p, i) => <Thumb key={p.id} photo={p} onClick={() => setLb(i)} />)}
                {!isGuest ? (
                  <label className="ph add">
                    <input type="file" accept="image/*" multiple style={{ display: "none" }} disabled={!!upload} onChange={(e) => { onPick(e.target.files); e.target.value = ""; }} />
                    <Ico.camera size={26} />
                    {upload ? `${upload.done} of ${upload.total}` : "Add photos"}
                  </label>
                ) : null}
              </div>
            )}
          </div>
        </>
      ) : null}

      {lb !== null && photos[lb] ? (
        <Lightbox
          photos={photos}
          index={lb}
          onIndex={setLb}
          onClose={() => setLb(null)}
          caption={(p) => ({ title: room.name, sub: p.addedBy ? `Added by ${p.addedBy}` : "" })}
          onDelete={!isGuest ? removePhoto : null}
        />
      ) : null}

      <Sheet open={menu} onClose={() => setMenu(false)} title={room.name}>
        <button className="opt" onClick={() => { setMenu(false); nav.push({ type: "roomForm", room }); }}><span>Edit room</span><Ico.edit size={20} color="var(--dim)" /></button>
        <button className="opt" style={{ color: "var(--danger)" }} onClick={() => {
          setMenu(false);
          ask({ title: "Delete this room?", body: "Its ratings, notes and photo list are removed for everyone. This can't be undone.", action: "Delete room", danger: true, onConfirm: () => { act.deleteRoom(room.id); nav.back(); toast("Room deleted"); } });
        }}><span>Delete room</span><Ico.trash size={20} /></button>
      </Sheet>
    </Screen>
  );
}

/* ---- add / edit room ---- */
function RoomFormScreen({ initial }) {
  const { data, nav, act, flags, categories, toast } = useApp();
  const [form, setForm] = useState(initial);
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const isNew = !data.rooms.some((r) => r.id === initial.id);
  const participants = form.participants && form.participants.length ? form.participants : MEMBERS;
  const cityOptions = useMemo(() => {
    const counts = {};
    data.rooms.forEach((r) => { if (r.city) counts[r.city] = (counts[r.city] || 0) + 1; });
    const typed = norm(form.city);
    return Object.keys(counts)
      .filter((c) => norm(c) !== typed && (!typed || norm(c).includes(typed)))
      .sort((a, b) => counts[b] - counts[a] || a.localeCompare(b, "pl"))
      .slice(0, 8);
  }, [data.rooms, form.city]);

  const toggleIn = (field, id, base) => {
    const cur = field === "participants" ? participants : form[field] || base || [];
    set({ [field]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  const save = () => {
    if (!form.name.trim()) { toast("Give the room a name first", "err"); return; }
    act.saveRoom({ ...form, name: form.name.trim() });
    if (isNew) nav.replaceTop({ type: "room", roomId: form.id });
    else nav.back();
    toast(isNew ? "Room added" : "Changes saved");
  };
  const catList = categories && categories.length ? categories : DEFAULT_CATEGORIES;
  const catOptions = catList.includes(form.category) ? catList : [form.category, ...catList];

  return (
    <Screen
      title={isNew ? "Add a room" : "Edit room"}
      back
      bare
      actions={<button className="hbtn" onClick={save}>Save</button>}
    >
      <div className="pad">
        <Field label="Room name"><input className="inp" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Nocne Łowy" autoComplete="off" enterKeyHint="next" /></Field>
        <Field label="Venue or company"><input className="inp" value={form.venue} onChange={(e) => set({ venue: e.target.value })} autoComplete="off" enterKeyHint="next" /></Field>
        <Field label="City">
          <input className="inp" value={form.city} onChange={(e) => set({ city: e.target.value })} autoComplete="off" enterKeyHint="next" />
          {cityOptions.length ? <div className="suggest">{cityOptions.map((c) => <button key={c} onClick={() => set({ city: c })}>{c}</button>)}</div> : null}
        </Field>
        <Field label="Country"><input className="inp" value={form.country} onChange={(e) => set({ country: e.target.value })} autoComplete="off" enterKeyHint="next" /></Field>
        <div className="grid2">
          <Field label="Genre"><select className="inp" value={form.category} onChange={(e) => set({ category: e.target.value })}>{catOptions.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
          <Field label="Difficulty"><select className="inp" value={form.difficulty} onChange={(e) => set({ difficulty: e.target.value })}>{DIFFICULTY_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
        </div>
        <Field label="lock.me link"><input className="inp" type="url" inputMode="url" value={form.lockmeUrl} onChange={(e) => set({ lockmeUrl: e.target.value })} placeholder="https://lock.me/..." autoComplete="off" autoCapitalize="none" /></Field>

        <Field label="Status">
          <Segmented
            value={form.status}
            onChange={(v) => set({ status: v, datePlayed: v === "played" ? form.datePlayed || new Date().toISOString().slice(0, 10) : form.datePlayed })}
            options={[{ id: "wishlist", label: "Wishlist" }, { id: "played", label: "Played" }]}
          />
        </Field>

        {form.status === "played" ? (
          <>
            <Field label="Date played"><input className="inp" type="date" value={form.datePlayed} onChange={(e) => set({ datePlayed: e.target.value })} /></Field>
            <Field label="Result">
              <Segmented value={form.result} onChange={(v) => set({ result: v })} options={[{ id: "escaped", label: "Escaped" }, { id: "not-escaped", label: "Not escaped" }]} />
            </Field>
            <Field label="Time left or how it ended"><input className="inp" value={form.timeNote} onChange={(e) => set({ timeNote: e.target.value })} placeholder="e.g. 4:12 left" autoComplete="off" /></Field>
            <div className="grid2">
              <Field label="Price paid"><input className="inp" type="number" inputMode="decimal" min="0" step="0.01" value={form.price || ""} onChange={(e) => set({ price: e.target.value })} placeholder="0" /></Field>
              <Field label="Currency"><input className="inp" value={form.currency || "PLN"} onChange={(e) => set({ currency: e.target.value })} autoCapitalize="characters" /></Field>
            </div>
            <Field label="Who played">
              <div className="pchips">
                {MEMBERS.map((m) => (
                  <button key={m} className="pchip on-brass" aria-pressed={participants.includes(m)} onClick={() => { tick(); toggleIn("participants", m); }}>
                    <span className="c"><Ico.user size={24} /></span>{m}
                  </button>
                ))}
              </div>
            </Field>
          </>
        ) : null}

        <Field label="Flags">
          <div className="pchips">
            {flags.map((f) => {
              const Ic = resolveFlagIcon(f.icon);
              const on = (form.flags || []).includes(f.id);
              return (
                <button key={f.id} className="pchip" aria-pressed={on} onClick={() => { tick(); toggleIn("flags", f.id); }}>
                  <span className="c" style={on ? { background: f.color, borderColor: f.color, color: "#17140c" } : undefined}><Ic size={24} /></span>
                  {f.label}
                </button>
              );
            })}
          </div>
        </Field>

        <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={save}>{isNew ? "Add room" : "Save changes"}</button>
      </div>
    </Screen>
  );
}


/* ---- trips ---- */
const dateRange = (t) => {
  if (!t.startDate && !t.endDate) return "";
  const a = fmtDate(t.startDate);
  return t.endDate && t.endDate !== t.startDate ? `${a} to ${fmtDate(t.endDate)}` : a;
};

function TripRow({ trip, rooms, onOpen }) {
  const s = tripStats(trip, rooms);
  return (
    <button className="row" onClick={onOpen}>
      <span className="rr-main">
        <span className="rr-title" style={{ display: "block" }}>{trip.name || "Untitled trip"}</span>
        <span className="rr-meta">
          {trip.city ? <span><Ico.pin size={13} />{trip.city}</span> : null}
          {dateRange(trip) ? <span><Ico.cal size={13} />{dateRange(trip)}</span> : null}
          <span>{plural(s.count, "room")}</span>
        </span>
      </span>
      <span className="rr-side">{s.avg !== null ? <span className="rr-score">{s.avg.toFixed(1)}</span> : null}</span>
    </button>
  );
}

function TripsScreen() {
  const { data, nav, filters, setFilter } = useApp();
  const f = filters.trips;
  const patch = (p) => setFilter("trips", p);
  const [sortOpen, setSortOpen] = useState(false);
  const [filtOpen, setFiltOpen] = useState(false);
  const cities = useMemo(() => distinct(data.trips.map((t) => t.city)), [data.trips]);
  const list = useMemo(
    () => sortTrips(data.trips.filter((t) => (!f.search || norm(t.name).includes(norm(f.search))) && (!f.cities.length || f.cities.includes(t.city))), f.sortBy),
    [data.trips, f]
  );
  const grouped = f.sortBy === "start-desc" || f.sortBy === "start-asc";
  const years = useMemo(() => (grouped ? groupByYear(list, "startDate") : []), [grouped, list]);
  const byCity = countBy(data.trips, "city").slice(0, 6);
  const sortLabel = (TRIP_SORT_OPTIONS.find((o) => o.id === f.sortBy) || TRIP_SORT_OPTIONS[0]).label;
  const toggleCity = (c) => patch({ cities: f.cities.includes(c) ? f.cities.filter((x) => x !== c) : [...f.cities, c] });
  const clearAll = () => patch({ search: "", cities: [] });
  const active = f.cities.length;

  return (
    <Screen title="Trips">
      <div className="tools">
        <div className="tools-row">
          <SearchBox value={f.search} onChange={(v) => patch({ search: v })} placeholder="Search trips" />
          <button className="tbtn" aria-label={`Sort: ${sortLabel}`} onClick={() => setSortOpen(true)}><Ico.sort size={20} /></button>
          <button className="tbtn" aria-label="Filters" aria-pressed={active > 0} onClick={() => setFiltOpen(true)}>
            <Ico.filter size={20} />
            {active > 0 ? <span className="badge">{active}</span> : null}
          </button>
        </div>
      </div>
      <AppliedPills items={f.cities.map((c) => ({ key: c, label: c, onRemove: () => toggleCity(c) }))} />
      <div className="count-line">{`${plural(list.length, "trip")}, ${sortLabel.toLowerCase()}`}</div>
      {!list.length ? (
        <EmptyState
          title={data.trips.length ? "No trips match" : "No trips yet"}
          text={data.trips.length ? "Try removing a filter or clearing the search." : "Group the rooms from a city weekend into one trip to see them together."}
          action={data.trips.length && (active || f.search) ? <button className="btn btn-quiet" onClick={clearAll}>Clear filters</button> : null}
        />
      ) : grouped ? (
        years.map((g) => (
          <section key={g.year}>
            <YearHeader year={g.year} count={g.items.length} noun="trip" />
            {g.items.map((t) => <TripRow key={t.id} trip={t} rooms={data.rooms} onOpen={() => nav.openTrip(t.id)} />)}
          </section>
        ))
      ) : (
        list.map((t) => <TripRow key={t.id} trip={t} rooms={data.rooms} onOpen={() => nav.openTrip(t.id)} />)
      )}
      {byCity.length ? (
        <>
          <h2 className="sec-h">Most visited cities</h2>
          <BarList items={byCity} />
        </>
      ) : null}
      <SortSheet open={sortOpen} onClose={() => setSortOpen(false)} options={TRIP_SORT_OPTIONS} value={f.sortBy} onChange={(v) => patch({ sortBy: v })} />
      <FilterSheet
        open={filtOpen}
        onClose={() => setFiltOpen(false)}
        count={list.length}
        noun="trip"
        onClear={() => patch({ cities: [] })}
        groups={[{ key: "city", label: "City", options: cities.map((c) => ({ id: c, label: c })), selected: f.cities, onToggle: toggleCity }]}
      />
    </Screen>
  );
}

function RoomPicker({ rooms, selected, onToggle, inRange }) {
  const [q, setQ] = useState("");
  const list = rooms
    .filter((r) => !q || norm(`${r.name} ${r.venue || ""} ${r.city || ""}`).includes(norm(q)))
    .sort((a, b) => (inRange.has(b.id) ? 1 : 0) - (inRange.has(a.id) ? 1 : 0) || (b.datePlayed || "").localeCompare(a.datePlayed || ""));
  return (
    <div>
      <SearchBox value={q} onChange={setQ} placeholder="Search completed rooms" />
      <div style={{ marginTop: 8 }}>
        {!list.length ? <p className="dim">No completed rooms match.</p> : list.map((r) => {
          const on = selected.includes(r.id);
          return (
            <button key={r.id} className="row pick" role="checkbox" aria-checked={on} onClick={() => { tick(); onToggle(r.id); }}>
              <span className={cx("tick", on && "on")}>{on ? <Ico.check size={17} /> : null}</span>
              <span className="rr-main">
                <span className="rr-title" style={{ display: "block", fontSize: 17 }}>{r.name}</span>
                <span className="rr-meta">
                  {r.city ? <span><Ico.pin size={13} />{r.city}</span> : null}
                  {r.datePlayed ? <span>{fmtDate(r.datePlayed)}</span> : null}
                  {inRange.has(r.id) ? <span className="brass">In the trip's dates</span> : null}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const roomsInRange = (rooms, t) => new Set(
  rooms.filter((r) => r.status === "played" && r.datePlayed && t.startDate && r.datePlayed >= t.startDate && (!t.endDate || r.datePlayed <= t.endDate) && (!t.city || r.city === t.city)).map((r) => r.id)
);

function TripScreen({ tripId }) {
  const { data, nav } = useApp();
  const trip = data.trips.find((t) => t.id === tripId);
  if (!trip) {
    return (
      <Screen title="Trip" back>
        <EmptyState title="This trip is gone" text="Someone in the crew deleted it." action={<button className="btn btn-quiet" onClick={nav.back}>Go back</button>} />
      </Screen>
    );
  }
  return <TripView trip={trip} />;
}

function TripView({ trip }) {
  const { data, me, isGuest, nav, act, flags, toast, ask } = useApp();
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editSum, setEditSum] = useState(false);
  const [sumText, setSumText] = useState("");
  const stats = tripStats(trip, data.rooms);
  const playedRooms = data.rooms.filter((r) => r.status === "played");
  const myRanking = reconcileRanking((trip.votes && trip.votes[me]) || [], trip.roomIds);
  const group = groupFavoritesForTrip(trip, stats.rooms);
  const inRange = useMemo(() => roomsInRange(data.rooms, trip), [data.rooms, trip]);
  const toggleRoom = (id) => act.updateTrip(trip.id, (t) => ({ roomIds: t.roomIds.includes(id) ? t.roomIds.filter((x) => x !== id) : [...t.roomIds, id] }));
  const move = (from, to) => {
    if (to < 0 || to >= myRanking.length) return;
    tick();
    const next = [...myRanking];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    act.updateTrip(trip.id, (t) => ({ votes: { ...(t.votes || {}), [me]: next } }));
  };

  return (
    <Screen
      title=""
      back
      actions={!isGuest ? <button className="ibtn" aria-label="Trip actions" onClick={() => setMenu(true)}><Ico.more size={26} /></button> : null}
    >
      <div className="pad">
        <div className="status-line"><Ico.plane size={16} />Trip</div>
        <h1 className="room-name">{trip.name || "Untitled trip"}</h1>
        <div className="facts">
          {trip.city ? <div><Ico.pin size={17} />{trip.city}</div> : null}
          {dateRange(trip) ? <div><Ico.cal size={17} />{dateRange(trip)}</div> : null}
          {stats.totalSpent !== null ? <div><Ico.wallet size={17} />{`${stats.totalSpent} ${stats.spentCurrency} spent`}</div> : null}
        </div>
      </div>
      <div className="strip3">
        <div><b>{stats.count}</b><span>{stats.count === 1 ? "Room" : "Rooms"}</span></div>
        <div><b>{stats.avg !== null ? stats.avg.toFixed(1) : "-"}</b><span>Group average</span></div>
        <div><b>{stats.escapeRate !== null ? `${stats.escapeRate}%` : "-"}</b><span>Escaped</span></div>
      </div>

      <h2 className="sec-h">Summary</h2>
      <div className="pad">
        {editSum ? (
          <>
            <textarea className="inp" autoFocus style={{ minHeight: 140 }} value={sumText} onChange={(e) => setSumText(e.target.value)} placeholder="Highlights, favourites, a running joke from the weekend" />
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button className="btn btn-primary grow" onClick={() => { act.updateTrip(trip.id, { notes: sumText.trim() }); setEditSum(false); toast("Summary saved"); }}>Save summary</button>
              <button className="btn btn-quiet" onClick={() => setEditSum(false)}>Cancel</button>
            </div>
          </>
        ) : isGuest ? (
          <p className={trip.notes ? "" : "dim"} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{trip.notes || "No summary yet."}</p>
        ) : (
          <button className="note mine" style={{ borderBottom: 0 }} onClick={() => { setSumText(trip.notes || ""); setEditSum(true); }}>
            <p className={trip.notes ? "" : "dim"} style={{ marginTop: 0 }}>{trip.notes || "Tap to write up the trip"}</p>
          </button>
        )}
      </div>

      <h2 className="sec-h">Rooms on this trip</h2>
      {!stats.rooms.length ? (
        <EmptyState title="No rooms yet" text={isGuest ? "" : "Add the rooms you played on this trip."} action={isGuest ? null : <button className="btn btn-quiet" onClick={() => setAdding(true)}><Ico.plus size={18} /> Add rooms</button>} />
      ) : stats.rooms.map((r) => (
        <div className="rowwrap" key={r.id}>
          <RoomRow room={r} flagDefs={flags} plain score={avgRating(r) !== null ? avgRating(r).toFixed(1) : null} onOpen={() => nav.openRoom(r.id)} />
          {!isGuest ? <button className="ibtn" style={{ marginRight: 6 }} aria-label={`Remove ${r.name} from this trip`} onClick={() => toggleRoom(r.id)}><Ico.x size={20} color="var(--dim)" /></button> : null}
        </div>
      ))}

      {!isGuest && myRanking.length > 1 ? (
        <>
          <h2 className="sec-h">Rank your favourites<small>best first</small></h2>
          {myRanking.map((id, i) => {
            const r = data.rooms.find((x) => x.id === id);
            if (!r) return null;
            return (
              <div className="row" key={id}>
                <span className={cx("rank-n", i === 0 && "top")}>{i + 1}</span>
                <span className="rr-main"><span className="rr-title" style={{ fontSize: 17 }}>{r.name}</span></span>
                <button className="step" aria-label={`Move ${r.name} up`} disabled={i === 0} onClick={() => move(i, i - 1)}><Ico.up size={21} /></button>
                <button className="step" aria-label={`Move ${r.name} down`} disabled={i === myRanking.length - 1} onClick={() => move(i, i + 1)}><Ico.down size={21} /></button>
              </div>
            );
          })}
        </>
      ) : null}

      {group.length ? (
        <>
          <h2 className="sec-h">Group favourites<small>from everyone's ranking</small></h2>
          {group.map((x, i) => (
            <div className="row" key={x.room.id}>
              <span className={cx("rank-n", i === 0 && "top")}>{i + 1}</span>
              <span className="rr-main"><span className="rr-title" style={{ fontSize: 17 }}>{x.room.name}</span></span>
              <span className="dim sm">{plural(x.voters, "vote")}</span>
            </div>
          ))}
        </>
      ) : null}

      <Sheet open={menu} onClose={() => setMenu(false)} title={trip.name || "Trip"}>
        <button className="opt" onClick={() => { setMenu(false); setAdding(true); }}><span>Add or remove rooms</span><Ico.plus size={20} color="var(--dim)" /></button>
        <button className="opt" onClick={() => { setMenu(false); nav.push({ type: "tripForm", trip }); }}><span>Edit trip</span><Ico.edit size={20} color="var(--dim)" /></button>
        <button className="opt" style={{ color: "var(--danger)" }} onClick={() => {
          setMenu(false);
          ask({ title: "Delete this trip?", body: "The rooms stay in your log. Only the trip, its summary and favourites are removed.", action: "Delete trip", danger: true, onConfirm: () => { act.deleteTrip(trip.id); nav.back(); toast("Trip deleted"); } });
        }}><span>Delete trip</span><Ico.trash size={20} /></button>
      </Sheet>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Rooms on this trip" footer={<button className="btn btn-primary btn-block" onClick={() => setAdding(false)}>Done</button>}>
        <RoomPicker rooms={playedRooms} selected={trip.roomIds} onToggle={toggleRoom} inRange={inRange} />
      </Sheet>
    </Screen>
  );
}

function TripFormScreen({ initial }) {
  const { data, nav, act, toast } = useApp();
  const [form, setForm] = useState({ ...initial, votes: initial.votes || {} });
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const isNew = !data.trips.some((t) => t.id === initial.id);
  const played = data.rooms.filter((r) => r.status === "played");
  const inRange = useMemo(() => roomsInRange(data.rooms, form), [data.rooms, form.startDate, form.endDate, form.city]);
  const suggestions = [...inRange].filter((id) => !form.roomIds.includes(id));
  const toggle = (id) => set({ roomIds: form.roomIds.includes(id) ? form.roomIds.filter((x) => x !== id) : [...form.roomIds, id] });
  const save = () => {
    if (!form.name.trim()) { toast("Give the trip a name first", "err"); return; }
    act.saveTrip({ ...form, name: form.name.trim() });
    if (isNew) nav.replaceTop({ type: "trip", tripId: form.id });
    else nav.back();
    toast(isNew ? "Trip added" : "Changes saved");
  };
  return (
    <Screen title={isNew ? "New trip" : "Edit trip"} back bare actions={<button className="hbtn" onClick={save}>Save</button>}>
      <div className="pad">
        <Field label="Trip name"><input className="inp" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Wrocław weekend" autoComplete="off" /></Field>
        <Field label="City"><input className="inp" value={form.city} onChange={(e) => set({ city: e.target.value })} autoComplete="off" /></Field>
        <div className="grid2">
          <Field label="Start date"><input className="inp" type="date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
          <Field label="End date"><input className="inp" type="date" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} /></Field>
        </div>
        <div className="field">
          <span className="field-l">{`Rooms on this trip (${form.roomIds.length})`}</span>
          {suggestions.length ? (
            <button className="btn btn-quiet btn-block" style={{ marginBottom: 8 }} onClick={() => set({ roomIds: [...form.roomIds, ...suggestions] })}>
              {`Add the ${plural(suggestions.length, "room")} played in these dates`}
            </button>
          ) : null}
          <RoomPicker rooms={played} selected={form.roomIds} onToggle={toggle} inRange={inRange} />
        </div>
        <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} onClick={save}>{isNew ? "Add trip" : "Save changes"}</button>
      </div>
    </Screen>
  );
}

/* ---- gallery ---- */
function GalleryScreen() {
  const { data, nav, filters, setFilter, flags, drive, isGuest } = useApp();
  const f = filters.gallery;
  const patch = (p) => setFilter("gallery", p);
  const [sortOpen, setSortOpen] = useState(false);
  const [filtOpen, setFiltOpen] = useState(false);
  const [lb, setLb] = useState(null);

  const all = useMemo(() => {
    const items = [];
    data.rooms.forEach((r) => (r.photos || []).forEach((p) => items.push({ ...p, roomId: r.id, roomName: r.name, city: r.city, country: r.country, category: r.category, datePlayed: r.datePlayed, flags: r.flags || [], venue: r.venue })));
    return items;
  }, [data.rooms]);
  const cities = useMemo(() => distinct(all.map((p) => p.city)), [all]);
  const genres = useMemo(() => distinct(all.map((p) => p.category)), [all]);
  const countries = useMemo(() => distinct(all.map((p) => p.country)), [all]);
  const list = useMemo(
    () => sortGalleryPhotos(
      all.filter((p) => roomMatches({ name: p.roomName, venue: p.venue, city: p.city, country: p.country, category: p.category, flags: p.flags }, f, null)),
      f.sortBy
    ),
    [all, f]
  );
  const grouped = f.sortBy === "visited-desc" || f.sortBy === "visited-asc";
  const years = useMemo(() => (grouped ? groupByYear(list, "datePlayed") : []), [grouped, list]);
  const sortLabel = (GALLERY_SORT_OPTIONS.find((o) => o.id === f.sortBy) || GALLERY_SORT_OPTIONS[0]).label;
  const toggle = (field) => (id) => patch({ [field]: f[field].includes(id) ? f[field].filter((x) => x !== id) : [...f[field], id] });
  const active = countActive(f);
  const clearAll = () => patch({ search: "", cities: [], genres: [], countries: [], flags: [] });
  const pills = [
    ...f.cities.map((c) => ({ key: `c${c}`, label: c, onRemove: () => toggle("cities")(c) })),
    ...f.countries.map((c) => ({ key: `n${c}`, label: c, onRemove: () => toggle("countries")(c) })),
    ...f.genres.map((c) => ({ key: `g${c}`, label: c, onRemove: () => toggle("genres")(c) })),
    ...f.flags.map((id) => { const d = flags.find((x) => x.id === id); return { key: `f${id}`, label: d ? d.label : id, onRemove: () => toggle("flags")(id) }; }),
  ];

  if (!drive.available) {
    return <Screen title="Gallery"><EmptyState title="Photos need the hosted site" text="The gallery reads from Google Drive, which isn't available in this preview." /></Screen>;
  }
  if (!drive.connected) {
    return (
      <Screen title="Gallery">
        <EmptyState
          title="Google Drive isn't connected"
          text={isGuest ? "Ask the crew to connect it." : "Connect it once and everyone's photos appear here."}
          action={isGuest ? null : <button className="btn btn-primary" onClick={() => nav.push({ type: "drive" })}>Connect Google Drive</button>}
        />
      </Screen>
    );
  }
  let offset = 0;
  const cell = (p, i) => <Thumb key={p.id} photo={p} onClick={() => setLb(i)} />;
  return (
    <Screen title="Gallery">
      <div className="tools">
        <div className="tools-row">
          <SearchBox value={f.search} onChange={(v) => patch({ search: v })} placeholder="Search rooms" />
          <button className="tbtn" aria-label={`Sort: ${sortLabel}`} onClick={() => setSortOpen(true)}><Ico.sort size={20} /></button>
          <button className="tbtn" aria-label="Filters" aria-pressed={active > 0} onClick={() => setFiltOpen(true)}>
            <Ico.filter size={20} />
            {active > 0 ? <span className="badge">{active}</span> : null}
          </button>
        </div>
      </div>
      <AppliedPills items={pills} />
      <div className="count-line">{plural(list.length, "photo")}</div>
      {!list.length ? (
        <EmptyState title={all.length ? "No photos match" : "No photos yet"} text={all.length ? "Try removing a filter." : "Photos you add to a room show up here."} action={all.length && (active || f.search) ? <button className="btn btn-quiet" onClick={clearAll}>Clear filters</button> : null} />
      ) : grouped ? (
        years.map((g) => {
          const start = offset;
          offset += g.items.length;
          return (
            <section key={g.year}>
              <YearHeader year={g.year} count={g.items.length} noun="photo" />
              <div className="pgrid" style={{ marginTop: 3 }}>{g.items.map((p, i) => cell(p, start + i))}</div>
            </section>
          );
        })
      ) : (
        <div className="pgrid" style={{ marginTop: 3 }}>{list.map((p, i) => cell(p, i))}</div>
      )}

      {lb !== null && list[lb] ? (
        <Lightbox
          photos={list}
          index={lb}
          onIndex={setLb}
          onClose={() => setLb(null)}
          caption={(p) => ({ title: p.roomName, sub: p.city || "" })}
          onOpenRoom={(p) => { setLb(null); nav.openRoom(p.roomId); }}
        />
      ) : null}
      <SortSheet open={sortOpen} onClose={() => setSortOpen(false)} options={GALLERY_SORT_OPTIONS} value={f.sortBy} onChange={(v) => patch({ sortBy: v })} />
      <FilterSheet
        open={filtOpen}
        onClose={() => setFiltOpen(false)}
        count={list.length}
        noun="photo"
        onClear={clearAll}
        groups={[
          { key: "city", label: "City", options: cities.map((c) => ({ id: c, label: c })), selected: f.cities, onToggle: toggle("cities") },
          { key: "genre", label: "Genre", options: genres.map((c) => ({ id: c, label: c })), selected: f.genres, onToggle: toggle("genres") },
          { key: "country", label: "Country", options: countries.map((c) => ({ id: c, label: c })), selected: f.countries, onToggle: toggle("countries") },
          { key: "flags", label: "Flags", options: flags.map((d) => ({ id: d.id, label: d.label, icon: resolveFlagIcon(d.icon), color: d.color })), selected: f.flags, onToggle: toggle("flags") },
        ]}
      />
    </Screen>
  );
}

/* ---- account + settings ---- */
function AccountSheet({ open, onClose }) {
  const { me, isGuest, data, nav, act } = useApp();
  const stats = useMemo(() => crewStats(data.rooms), [data.rooms]);
  const go = (screen) => { onClose(); setTimeout(() => nav.push(screen), 0); };
  return (
    <Sheet open={open} onClose={onClose} title={isGuest ? "Guest" : me}>
      <p className="dim" style={{ marginTop: 0 }}>{isGuest ? "You're looking around as a guest. Browsing and filtering work, changes don't." : `You're playing as ${me} on this phone.`}</p>
      <div style={{ margin: "14px 0 6px", fontWeight: 600 }}>The crew</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr repeat(4, 54px)", gap: "4px 2px", alignItems: "center", fontSize: 14 }}>
        <span />
        {["Added", "Played", "Rated", "Noted"].map((h) => <span key={h} className="dim xs" style={{ textAlign: "center" }}>{h}</span>)}
        {MEMBERS.map((m) => (
          <React.Fragment key={m}>
            <span style={{ padding: "7px 0", fontWeight: m === me ? 600 : 400 }}>{m}</span>
            {["added", "played", "rated", "noted"].map((k) => <span key={k} className="num brass" style={{ textAlign: "center" }}>{stats[m][k]}</span>)}
          </React.Fragment>
        ))}
      </div>
      <div style={{ marginTop: 18 }}>
        {!isGuest ? <button className="opt" onClick={() => go({ type: "settings" })}><span>Settings</span><Ico.settings size={20} color="var(--dim)" /></button> : null}
        <button className="opt" onClick={() => { onClose(); act.switchPlayer(); }}><span>{isGuest ? "Sign in as a crew member" : "Switch player"}</span><Ico.users size={20} color="var(--dim)" /></button>
        <a className="opt" href="index.html?desktop=1"><span>Open the desktop version</span><Ico.monitor size={20} color="var(--dim)" /></a>
      </div>
    </Sheet>
  );
}

function SettingsScreen() {
  const { nav, drive } = useApp();
  const rows = [
    { type: "categories", label: "Genres", hint: "The genre choices when adding a room", icon: Ico.palette },
    { type: "flags", label: "Flags", hint: "Status icons like Permanently closed", icon: Ico.flag },
    { type: "drive", label: "Google Drive", hint: drive.available ? (drive.connected ? "Connected" : "Not connected yet") : "Hosted site only", icon: Ico.drive },
    { type: "password", label: "Change password", hint: "For signing in on any device", icon: Ico.key },
  ];
  return (
    <Screen title="Settings" back bare>
      {rows.map((r) => (
        <button className="row" key={r.type} onClick={() => nav.push({ type: r.type })}>
          <r.icon size={22} color="var(--brass)" />
          <span className="rr-main"><span className="rr-title" style={{ display: "block", fontSize: 17 }}>{r.label}</span><span className="rr-sub" style={{ display: "block" }}>{r.hint}</span></span>
          <Ico.next size={20} color="var(--dim)" />
        </button>
      ))}
    </Screen>
  );
}

function CategoriesScreen() {
  const { categories, act, ask, toast } = useApp();
  const list = categories && categories.length ? categories : DEFAULT_CATEGORIES;
  const [sheet, setSheet] = useState(null); // { old, name }
  const save = () => {
    const name = sheet.name.trim();
    if (!name) return;
    if (sheet.old) act.renameCategory(sheet.old, name);
    else act.addCategory(name);
    setSheet(null);
    toast(sheet.old ? "Genre renamed everywhere" : "Genre added");
  };
  return (
    <Screen title="Genres" back bare actions={<button className="hbtn" onClick={() => setSheet({ old: null, name: "" })}>Add</button>}>
      <p className="dim pad" style={{ margin: "14px 0 6px" }}>Renaming a genre updates every room that uses it.</p>
      {list.map((c) => (
        <button className="row" key={c} onClick={() => setSheet({ old: c, name: c })}>
          <span className="rr-main"><span className="rr-title" style={{ fontSize: 17 }}>{c}</span></span>
          <Ico.edit size={19} color="var(--dim)" />
        </button>
      ))}
      <Sheet
        open={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet && sheet.old ? "Rename genre" : "New genre"}
        footer={(
          <>
            {sheet && sheet.old ? <button className="btn btn-danger" onClick={() => { const old = sheet.old; setSheet(null); ask({ title: `Remove ${old}?`, body: "Rooms already using it keep it. It just won't be offered for new rooms.", action: "Remove genre", danger: true, onConfirm: () => { act.removeCategory(old); toast("Genre removed"); } }); }}>Remove</button> : null}
            <button className="btn btn-primary grow" onClick={save}>Save</button>
          </>
        )}
      >
        <Field label="Name"><input className="inp" autoFocus value={sheet ? sheet.name : ""} onChange={(e) => setSheet({ ...sheet, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") save(); }} /></Field>
      </Sheet>
    </Screen>
  );
}

function FlagsScreen() {
  const { flags, act, ask, toast } = useApp();
  const blank = { id: null, label: "", icon: FLAG_ICON_CHOICES[0], color: FLAG_COLOR_CHOICES[0].value };
  const [sheet, setSheet] = useState(null);
  const save = () => {
    const label = sheet.label.trim();
    if (!label) return;
    if (sheet.id) act.updateFlag(sheet.id, { label, icon: sheet.icon, color: sheet.color });
    else act.addFlag({ label, icon: sheet.icon, color: sheet.color });
    setSheet(null);
    toast(sheet.id ? "Flag updated" : "Flag added");
  };
  return (
    <Screen title="Flags" back bare actions={<button className="hbtn" onClick={() => setSheet({ ...blank })}>Add</button>}>
      <p className="dim pad" style={{ margin: "14px 0 6px" }}>Flags mark a room, for example as permanently closed or moved.</p>
      {flags.map((f) => {
        const Ic = resolveFlagIcon(f.icon);
        return (
          <button className="row" key={f.id} onClick={() => setSheet({ ...f })}>
            <Ic size={22} color={f.color} />
            <span className="rr-main"><span className="rr-title" style={{ fontSize: 17 }}>{f.label}</span></span>
            <Ico.edit size={19} color="var(--dim)" />
          </button>
        );
      })}
      <Sheet
        open={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet && sheet.id ? "Edit flag" : "New flag"}
        footer={(
          <>
            {sheet && sheet.id ? <button className="btn btn-danger" onClick={() => { const f = sheet; setSheet(null); ask({ title: `Remove ${f.label}?`, body: "It's cleared from every room that has it.", action: "Remove flag", danger: true, onConfirm: () => { act.removeFlag(f.id); toast("Flag removed"); } }); }}>Remove</button> : null}
            <button className="btn btn-primary grow" onClick={save}>Save</button>
          </>
        )}
      >
        {sheet ? (
          <>
            <Field label="Name"><input className="inp" value={sheet.label} onChange={(e) => setSheet({ ...sheet, label: e.target.value })} /></Field>
            <div className="field">
              <span className="field-l">Icon</span>
              <div className="chips">
                {FLAG_ICON_CHOICES.map((name) => { const Ic = resolveFlagIcon(name); return <button key={name} aria-label={name} className="chip" style={{ width: 48, padding: 0, justifyContent: "center" }} aria-pressed={sheet.icon === name} onClick={() => setSheet({ ...sheet, icon: name })}><Ic size={20} /></button>; })}
              </div>
            </div>
            <div className="field">
              <span className="field-l">Colour</span>
              <div className="chips">
                {FLAG_COLOR_CHOICES.map((c) => (
                  <button key={c.value} aria-label={c.label} aria-pressed={sheet.color === c.value} onClick={() => setSheet({ ...sheet, color: c.value })} style={{ width: 44, height: 44, borderRadius: "50%", background: c.value, border: sheet.color === c.value ? "3px solid var(--text)" : "3px solid transparent" }} />
                ))}
              </div>
            </div>
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

function DriveScreen() {
  const { drive } = useApp();
  return (
    <Screen title="Google Drive" back bare>
      <div className="pad" style={{ paddingTop: 16 }}>
        {!drive.available ? (
          <p className="dim">Photo storage uses Google Drive and only works on the hosted site, not in this preview.</p>
        ) : (
          <>
            <p>Photos are stored in a private Google Drive folder, never a public link. Reconnect here whenever photos stop loading or uploading. Google access can expire, and reconnecting simply replaces the old connection.</p>
            <p className="dim">{drive.connected ? "A connection is on file." : "Not connected yet."}</p>
            <button className="btn btn-primary btn-block" onClick={drive.connect}><Ico.cloud size={20} />{drive.connected ? "Reconnect Google Drive" : "Connect Google Drive"}</button>
            <p className="fine">You'll go to Google to approve access, then come straight back here.</p>
          </>
        )}
      </div>
    </Screen>
  );
}

function PasswordScreen() {
  const { me, act, nav, toast } = useApp();
  const [cur, setCur] = useState("");
  const [n1, setN1] = useState("");
  const [n2, setN2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (n1.length < 4) { setErr("Use at least 4 characters."); return; }
    if (n1 !== n2) { setErr("The two new passwords don't match."); return; }
    setBusy(true);
    try {
      const ok = await act.changePassword(cur, n1);
      if (ok) { toast("Password changed"); nav.back(); } else setErr("Your current password doesn't match.");
    } catch (ex) {
      setErr("Couldn't save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title="Change password" back bare>
      <form className="pad" onSubmit={submit} style={{ paddingTop: 8 }}>
        <input type="text" name="username" autoComplete="username" value={me} readOnly tabIndex={-1} aria-hidden="true" style={{ position: "absolute", opacity: 0, height: 0, width: 0 }} />
        <Field label="Current password"><input className="inp" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="New password"><input className="inp" type="password" autoComplete="new-password" value={n1} onChange={(e) => setN1(e.target.value)} /></Field>
        <Field label="Repeat new password"><input className="inp" type="password" autoComplete="new-password" value={n2} onChange={(e) => setN2(e.target.value)} /></Field>
        {err ? <p className="err-t" role="alert">{err}</p> : null}
        <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} type="submit" disabled={busy || !cur || !n1}>{busy ? "Saving" : "Change password"}</button>
      </form>
    </Screen>
  );
}


/* ---- shell ---- */
const TABS = [
  { id: "home", label: "Home", icon: Ico.home },
  { id: "rooms", label: "Rooms", icon: Ico.door },
  { id: "ranking", label: "Ranking", icon: Ico.trophy },
  { id: "trips", label: "Trips", icon: Ico.plane },
  { id: "gallery", label: "Gallery", icon: Ico.image },
];
const GUEST_BLOCKED = new Set(["roomForm", "tripForm", "settings", "categories", "flags", "drive", "password"]);

function TabBar({ tab, onTab }) {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) => (
        <button key={t.id} className="tab" aria-current={tab === t.id ? "page" : undefined} onClick={() => { tick(6); onTab(t.id); }}>
          <t.icon size={23} strokeWidth={tab === t.id ? 2.3 : 1.8} />
          {t.label}
        </button>
      ))}
    </nav>
  );
}

function Splash({ error }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 9000); return () => clearTimeout(t); }, []);
  return (
    <div className="login" style={{ alignItems: "center", textAlign: "center" }}>
      <Ico.lock size={34} color="var(--brass)" />
      <h1 className="disp" style={{ fontSize: 28 }}>The Escape Log</h1>
      {error || slow ? (
        <>
          <p className={error ? "err-t" : ""} role={error ? "alert" : "status"}>{error || "Still connecting. Check that you're online."}</p>
          <button className="btn btn-quiet" onClick={() => window.location.reload()}>Try again</button>
        </>
      ) : <p>opening the door…</p>}
    </div>
  );
}

function ConfirmSheet({ confirm, onClose }) {
  const last = useRef(null);
  if (confirm) last.current = confirm;
  const c = confirm || last.current;
  return (
    <Sheet
      open={!!confirm}
      onClose={onClose}
      title={c ? c.title : ""}
      footer={c ? (
        <>
          <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
          <button className={cx("btn grow", c.danger ? "btn-primary" : "btn-primary")} style={c.danger ? { background: "var(--danger)", color: "#fff" } : undefined} onClick={() => { const fn = c.onConfirm; onClose(); setTimeout(fn, 0); }}>{c.action}</button>
        </>
      ) : null}
    >
      {c ? <p style={{ margin: "4px 0 8px" }}>{c.body}</p> : null}
    </Sheet>
  );
}

function AppRoot() {
  const mgr = useContext(LayerCtx);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(null);
  const [data, setData] = useState(() => normalizeData(null));
  const dataRef = useRef(data);
  const [me, setMe] = useState(null);
  const meRef = useRef(null);
  meRef.current = me;
  const isGuest = me === GUEST_NAME;
  const [tab, setTabState] = useState("home");
  const [roomsSeg, setRoomsSegState] = useState("completed");
  const [stack, setStack] = useState([]);
  const stackRef = useRef([]);
  stackRef.current = stack;
  const scrolls = useRef([]);
  const [filters, setFilters] = useState(defAllFilters);
  const [account, setAccount] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const [driveMessage, setDriveMessage] = useState(null);

  /* ---- load shared data + remembered player ---- */
  useEffect(() => {
    let unsub = null;
    const apply = (raw) => { const d = normalizeData(raw); dataRef.current = d; setData(d); };
    if (hasClaudeStorage) {
      (async () => {
        try {
          let loaded = null;
          try {
            const res = await storageGet(STORAGE_KEY, true);
            if (res && res.value) loaded = JSON.parse(res.value);
          } catch (e) { /* nothing saved yet */ }
          apply(loaded);
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
          unsub = onSnapshot(
            ref,
            (snap) => { apply(snap.exists() ? snap.data() : null); setLoading(false); setSaveError(null); },
            () => { setSaveError("Couldn't reach the shared data. Check your connection."); setLoading(false); }
          );
        } catch (e) {
          setSaveError("Couldn't connect to the shared data. Check your connection and try again.");
          setLoading(false);
        }
      })();
    }
    (async () => {
      try {
        const r = await storageGet(MEMBER_KEY, false);
        if (r && r.value && (MEMBERS.includes(r.value) || r.value === GUEST_NAME)) setMe(r.value);
      } catch (e) { /* nobody picked yet on this phone */ }
    })();
    return () => { if (unsub) unsub(); };
  }, []);

  const persist = useCallback(async (next) => {
    if (meRef.current === GUEST_NAME) return; // guests never write, whatever called this
    dataRef.current = next;
    setData(next);
    try {
      if (hasClaudeStorage) {
        const res = await storageSet(STORAGE_KEY, JSON.stringify(next), true);
        setSaveError(res ? null : "Couldn't save your last change. It may not be stored.");
      } else {
        const { setDoc, ref } = await getFirebaseHandle();
        await setDoc(ref, JSON.parse(JSON.stringify(next)));
        setSaveError(null);
      }
    } catch (e) {
      setSaveError("Couldn't save your last change. Check your connection.");
    }
  }, []);

  /* ---- data actions ---- */
  const act = useMemo(() => {
    const upd = (fn) => persist(fn(dataRef.current));
    const cats = (d) => (d.categories && d.categories.length ? d.categories : DEFAULT_CATEGORIES);
    const flagList = (d) => (d.flags && d.flags.length ? d.flags : DEFAULT_FLAGS);
    const sortPl = (a) => a.sort((x, y) => x.localeCompare(y, "pl"));
    const updateRoom = (id, patch) => upd((d) => ({ ...d, rooms: d.rooms.map((r) => (r.id === id ? { ...r, ...(typeof patch === "function" ? patch(r) : patch) } : r)) }));
    return {
      updateRoom,
      saveRoom: (room) => upd((d) => {
        const existing = d.rooms.find((r) => r.id === room.id);
        // Moving a completed room back to the wishlist clears what only applies once it's played.
        const toWishlist = existing && existing.status === "played" && room.status === "wishlist";
        const toSave = toWishlist ? { ...room, datePlayed: "", result: "escaped", timeNote: "", price: "", currency: "PLN", ratings: {}, flags: [] } : room;
        return { ...d, rooms: existing ? d.rooms.map((r) => (r.id === room.id ? toSave : r)) : [toSave, ...d.rooms] };
      }),
      deleteRoom: (id) => upd((d) => ({ ...d, rooms: d.rooms.filter((r) => r.id !== id), trips: d.trips.map((t) => ({ ...t, roomIds: t.roomIds.filter((x) => x !== id) })) })),
      markPlayed: (room) => updateRoom(room.id, { status: "played", datePlayed: room.datePlayed || new Date().toISOString().slice(0, 10), result: room.result === "not-escaped" ? "not-escaped" : "escaped" }),
      saveTrip: (trip) => upd((d) => ({ ...d, trips: d.trips.some((t) => t.id === trip.id) ? d.trips.map((t) => (t.id === trip.id ? trip : t)) : [trip, ...d.trips] })),
      updateTrip: (id, patch) => upd((d) => ({ ...d, trips: d.trips.map((t) => (t.id === id ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t)) })),
      deleteTrip: (id) => upd((d) => ({ ...d, trips: d.trips.filter((t) => t.id !== id) })),
      addCategory: (name) => upd((d) => {
        const n = name.trim();
        if (!n || cats(d).some((c) => c.toLowerCase() === n.toLowerCase())) return d;
        return { ...d, categories: sortPl([...cats(d), n]) };
      }),
      renameCategory: (oldName, newName) => upd((d) => {
        const n = newName.trim();
        if (!n || n === oldName || cats(d).some((c) => c !== oldName && c.toLowerCase() === n.toLowerCase())) return d;
        return { ...d, categories: sortPl(cats(d).map((c) => (c === oldName ? n : c))), rooms: d.rooms.map((r) => (r.category === oldName ? { ...r, category: n } : r)) };
      }),
      removeCategory: (name) => upd((d) => ({ ...d, categories: cats(d).filter((c) => c !== name) })),
      addFlag: ({ label, icon, color }) => upd((d) => {
        const id = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || uid();
        return { ...d, flags: [...flagList(d), { id: flagList(d).some((f) => f.id === id) ? `${id}-${uid().slice(-3)}` : id, label: label.trim(), icon, color }] };
      }),
      updateFlag: (id, patch) => upd((d) => ({ ...d, flags: flagList(d).map((f) => (f.id === id ? { ...f, ...patch } : f)) })),
      removeFlag: (id) => upd((d) => ({ ...d, flags: flagList(d).filter((f) => f.id !== id), rooms: d.rooms.map((r) => ((r.flags || []).includes(id) ? { ...r, flags: r.flags.filter((x) => x !== id) } : r)) })),
      changePassword: async (current, next) => {
        const who = meRef.current;
        const rec = dataRef.current.auth && dataRef.current.auth[who];
        if (!rec) return false;
        if ((await hashPassword(current, rec.salt)) !== rec.hash) return false;
        const salt = randomSalt();
        const hash = await hashPassword(next, salt);
        await persist({ ...dataRef.current, auth: { ...(dataRef.current.auth || {}), [who]: { salt, hash } } });
        return true;
      },
    };
  }, [persist]);

  /* ---- navigation ---- */
  const toTop = () => { try { window.scrollTo(0, 0); } catch (e) { /* ignore */ } };
  const resetFilters = () => setFilters(defAllFilters());
  const setFilter = (key, patch) => setFilters((f) => ({ ...f, [key]: { ...f[key], ...patch } }));
  const popScreen = () => {
    setStack((s) => s.slice(0, -1));
    const y = scrolls.current.pop();
    requestAnimationFrame(() => { try { window.scrollTo(0, y || 0); } catch (e) { /* ignore */ } });
  };
  const nav = {
    tab,
    roomsSeg,
    stack,
    push(screen) {
      if (isGuest && GUEST_BLOCKED.has(screen.type)) return;
      scrolls.current.push(window.scrollY || 0);
      const id = mgr.push(() => popScreen());
      setStack((s) => [...s, { ...screen, layerId: id }]);
      toTop();
    },
    back() {
      const top = stackRef.current[stackRef.current.length - 1];
      if (!top) return;
      mgr.remove(top.layerId);
      popScreen();
    },
    replaceTop(screen) {
      setStack((s) => { const top = s[s.length - 1]; return [...s.slice(0, -1), { ...screen, layerId: top ? top.layerId : undefined }]; });
      toTop();
    },
    popAll() {
      stackRef.current.forEach((s) => mgr.remove(s.layerId));
      scrolls.current = [];
      setStack([]);
    },
    openRoom(id) { nav.push({ type: "room", roomId: id }); },
    openTrip(id) { nav.push({ type: "trip", tripId: id }); },
    setTab(t) {
      if (t === tab && !stackRef.current.length) { toTop(); return; }
      nav.popAll();
      setTabState(t);
      resetFilters();
      toTop();
    },
    setRoomsSeg(v) { setRoomsSegState(v); resetFilters(); toTop(); },
    // Jump to a list with one filter applied (tapping a venue, city or country on a room).
    goList(seg, patch) {
      nav.popAll();
      setTabState("rooms");
      setRoomsSegState(seg);
      const key = seg === "wishlist" ? "wishlist" : "rooms";
      setFilters({ ...defAllFilters(), [key]: { ...defRoomFilters(seg === "wishlist"), ...(patch || {}) } });
      toTop();
    },
  };

  /* ---- player + passwords ---- */
  const chooseMember = async (name) => {
    setMe(name);
    setTabState("home");
    resetFilters();
    try { await storageSet(MEMBER_KEY, name || "", false); } catch (e) { /* non-fatal */ }
  };
  const createPassword = async (name, password) => {
    const salt = randomSalt();
    const hash = await hashPassword(password, salt);
    await persist({ ...dataRef.current, auth: { ...(dataRef.current.auth || {}), [name]: { salt, hash } } });
  };
  const verifyPassword = async (name, password) => {
    const rec = dataRef.current.auth && dataRef.current.auth[name];
    if (!rec) return false;
    return (await hashPassword(password, rec.salt)) === rec.hash;
  };
  act.switchPlayer = () => { nav.popAll(); chooseMember(null); };

  /* ---- ui helpers ---- */
  const toastTimer = useRef(null);
  const toast = (msg, kind) => {
    setToastMsg({ msg, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), kind === "err" ? 4800 : 2400);
  };
  const ask = (opts) => setConfirm(opts);

  /* ---- Google Drive ---- */
  const driveAvailable = !hasClaudeStorage && isDriveConfigured();
  const driveConnected = !hasClaudeStorage && !!(data.driveAuth && data.driveAuth.refreshToken);
  const getToken = useCallback(() => getDriveAccessToken(dataRef.current.driveAuth && dataRef.current.driveAuth.refreshToken), []);
  const drive = {
    available: driveAvailable,
    connected: driveConnected,
    getToken,
    connect: () => startDriveConnect().catch((e) => setDriveMessage({ type: "err", text: e.message || "Couldn't start the connection." })),
  };
  const driveHandled = useRef(false);
  useEffect(() => {
    if (loading || driveHandled.current) return;
    if (hasClaudeStorage || !isDriveConfigured()) return;
    if (!window.location.search.includes("code=")) return;
    driveHandled.current = true;
    (async () => {
      try {
        const refreshToken = await handleDriveOAuthRedirect();
        if (refreshToken) {
          await persist({ ...dataRef.current, driveAuth: { refreshToken } });
          setDriveMessage({ type: "ok", text: "Google Drive connected. Photos will now upload there." });
        }
      } catch (e) {
        setDriveMessage({ type: "err", text: e.message || "Couldn't connect Google Drive." });
      }
      setTimeout(() => setDriveMessage(null), 6000);
    })();
  }, [loading]);

  /* ---- render ---- */
  if (loading) return <Splash error={saveError} />;
  if (!me) return <WhoAmI authRecords={data.auth} onChoose={chooseMember} onCreatePassword={createPassword} onVerifyPassword={verifyPassword} />;

  const flags = data.flags && data.flags.length ? data.flags : DEFAULT_FLAGS;
  const ctx = {
    data, me, isGuest, flags, categories: data.categories, nav, act, filters, setFilter, drive, toast, ask,
    openAccount: () => setAccount(true),
  };
  const top = stack[stack.length - 1];
  const today = new Date().toISOString().slice(0, 10);
  let content;
  if (top) {
    switch (top.type) {
      case "room": content = <RoomScreen key={top.layerId} roomId={top.roomId} />; break;
      case "trip": content = <TripScreen key={top.layerId} tripId={top.tripId} />; break;
      case "roomForm": content = <RoomFormScreen key={top.layerId} initial={top.room} />; break;
      case "tripForm": content = <TripFormScreen key={top.layerId} initial={top.trip} />; break;
      case "settings": content = <SettingsScreen />; break;
      case "categories": content = <CategoriesScreen />; break;
      case "flags": content = <FlagsScreen />; break;
      case "drive": content = <DriveScreen />; break;
      case "password": content = <PasswordScreen />; break;
      default: content = <HomeScreen />;
    }
  } else {
    content = tab === "rooms" ? <RoomsScreen /> : tab === "ranking" ? <RankingScreen /> : tab === "trips" ? <TripsScreen /> : tab === "gallery" ? <GalleryScreen /> : <HomeScreen />;
  }
  const showFab = !top && !isGuest && (tab === "home" || tab === "rooms" || tab === "trips");
  const onFab = () => {
    tick();
    if (tab === "trips") nav.push({ type: "tripForm", trip: emptyTrip(me) });
    else {
      const base = emptyRoom(me);
      const wish = tab === "rooms" && roomsSeg === "wishlist";
      nav.push({ type: "roomForm", room: wish ? base : { ...base, status: "played", datePlayed: today } });
    }
  };

  return (
    <AppCtx.Provider value={ctx}>
      {isKnownInAppBrowser() ? <div className="banner err">This looks like an in-app browser, which can block saving. Open this link in Safari or Chrome instead.</div> : null}
      {saveError ? <div className="banner err" role="alert">{saveError}</div> : null}
      {driveMessage ? <div className={cx("banner", driveMessage.type === "err" ? "err" : "ok")} role="status">{driveMessage.text}</div> : null}
      {content}
      {!top ? <TabBar tab={tab} onTab={nav.setTab} /> : null}
      {showFab ? (
        <button className="fab" aria-label={tab === "trips" ? "Add a trip" : "Add a room"} onClick={onFab}><Ico.plus size={28} strokeWidth={2.4} /></button>
      ) : null}
      <AccountSheet open={account} onClose={() => setAccount(false)} />
      <ConfirmSheet confirm={confirm} onClose={() => setConfirm(null)} />
      {toastMsg ? <div className={cx("toast", toastMsg.kind === "err" && "err")} role="status">{toastMsg.msg}</div> : null}
    </AppCtx.Provider>
  );
}

export default function EscapeLogMobile() {
  const mgr = useMemo(() => createLayerManager(), []);
  useEffect(() => {
    const h = () => mgr.onPop();
    window.addEventListener("popstate", h);
    try { window.history.scrollRestoration = "manual"; } catch (e) { /* ignore */ }
    return () => window.removeEventListener("popstate", h);
  }, [mgr]);
  return (
    <LayerCtx.Provider value={mgr}>
      <style>{MOBILE_CSS}</style>
      <div className="m-app"><AppRoot /></div>
    </LayerCtx.Provider>
  );
}

