import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Lock, Unlock, MapPin, Star, Plus, Search, X, Edit2, Trash2,
  ExternalLink, Users, Trophy, ListChecks, LayoutDashboard,
  Camera, ChevronLeft, Settings, Check, Clock, Skull, Sparkles, Filter,
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
      const app = initializeApp(FIREBASE_CONFIG);
      const db = getFirestore(app);
      const ref = doc(db, ...FIREBASE_DOC_PATH);
      return { setDoc, onSnapshot, ref };
    })();
  }
  return firebaseHandlePromise;
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
 
// Top-ranked rooms from lock.me's Polish-language Poland ranking (name + city only).
// This is a partial list (top 80) — ask to preload more to extend it.
const LOCKME_TOP_ROOMS = [
  ["Boczna Aleja 6", "Gdańsk"], ["Nocne Łowy", "Sopot"], ["Księga Zła", "Warszawa"],
  ["Księżycowa Noc", "Warszawa"], ["Cień Nietoperza", "Poznań"], ["Zielona Mila", "Poznań"],
  ["Tron Wśród Kłamstw", "Gdańsk"], ["Opuszczony Hotel", "Wrocław"], ["Zemsta Umarlaka", "Poznań"],
  ["Ostatni Pasażer", "Warszawa"], ["Magiczna Księga", "Rybnik"], ["Leśna Chatka Wiedźmy", "Olsztyn"],
  ["Frank & Stein", "Sopot"], ["Serce Atlantydy", "Poznań"], ["Tajemnice Szkoły Magii", "Olsztyn"],
  ["Chatka Gajowego", "Gdynia"], ["Wyspa Smoka - Świątynia Żywiołów", "Wrocław"], ["Alien Kormeda", "Poznań"],
  ["Powstanie Warszawskie", "Warszawa"], ["Piętno", "Rybnik"], ["W Cieniu Piramid", "Warszawa"],
  ["Cicha Noc", "Gliwice"], ["Grobowiec Faraona", "Olsztyn"], ["Osobowość", "Poznań"],
  ["Szkoła Magii i Czarodziejstwa", "Chorzów"], ["Twoja Bajka: Upadek Fantazji", "Warszawa"], ["Osadzeni w Bunkrze", "Warszawa"],
  ["Przeklęte Lustro", "Kraków"], ["Zaginiona", "Warszawa"], ["Grota Czarnoksiężnika", "Rzeszów"],
  ["Seria Niefortunnych Zagadek", "Pszczyna"], ["Stary sklep z zabawkami", "Kraków"], ["Szkoła Magii - pierwszy rok", "Bydgoszcz"],
  ["KARMA", "Toruń"], ["Transmigracja", "Bytom"], ["Lochy Króla Artura", "Wrocław"],
  ["Napad na bank - Dziki Zachód", "Olsztyn"], ["Upiorny Dwór - spadkobiercy", "Gdańsk"], ["Wyznania Egzorcysty", "Katowice"],
  ["Lokalizacja", "Gliwice"], ["Moriarty sp. z o.o.", "Katowice"], ["Panorama", "Rybnik"],
  ["Tajemnice Watykanu", "Bydgoszcz"], ["Wikingowie · Amulety Mocy", "Poznań"], ["Bestie Peruna", "Wrocław"],
  ["Super Zioło", "Rzeszów"], ["Rastamobil", "Wrocław"], ["Przystanek Księżycowa", "Warszawa"],
  ["Nieznajomi", "Poznań"], ["Świątynia Złotego Słońca", "Gdańsk"], ["Tajemnicze Domostwo", "Poznań"],
  ["Szlak Nieumarłych", "Rzeszów"], ["Szkoła Magii - Turniej", "Bydgoszcz"], ["Krasnoludy", "Poznań"],
  ["Motel California", "Warszawa"], ["Piła: Początek", "Toruń"], ["Ekstremus: Ostatni Spacer", "Warszawa"],
  ["Sierociniec św Klary", "Bydgoszcz"], ["Wonderland", "Wrocław"], ["Turniej Trójmagiczny", "Poznań"],
  ["Opuszczony Szpital", "Olsztyn"], ["Wyrok Arktyki", "Gdańsk"], ["American School Story", "Wrocław"],
  ["Wyścig szczurów", "Poznań"], ["Superheroom", "Bydgoszcz"], ["Muzeum okultyzmu Państwa Warren", "Warszawa"],
  ["Porwany Samolot", "Wrocław"], ["Katakumby", "Warszawa"], ["Gabinet Kopernika", "Toruń"],
  ["Żelazny Tron Westeros", "Andrychów"], ["Obłęd", "Wrocław"], ["Kuźnia Krasnoluda", "Gdynia"],
  ["Licho", "Gdańsk"], ["Diabelski Cyrk", "Lublin"], ["Sectum Sempra", "Gdańsk"],
  ["Przyjaciel Cieni", "Wrocław"], ["Kryjówka wiedźmy", "Gdańsk"], ["Wednesday - Miłość aż po grób", "Toruń"],
  ["Rycerski", "Warszawa"], ["Piracka Skrzynia Umarlaka", "Gdynia"],
];
 
function emptyRoom() {
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
    result: "unknown", // 'escaped' | 'not-escaped' | 'unknown'
    timeNote: "",
    photos: [],
    ratings: {},
    notes: {},
    walkthrough: "",
    createdAt: Date.now(),
  };
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
  const [data, setData] = useState({ rooms: [] });
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
          let loaded = { rooms: [] };
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
              setData(snap.exists() ? snap.data() : { rooms: [] });
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
 
  const preloadLockmeRooms = () => {
    const existingNames = new Set(data.rooms.map((r) => r.name.trim().toLowerCase()));
    const toAdd = LOCKME_TOP_ROOMS
      .filter(([name]) => !existingNames.has(name.trim().toLowerCase()))
      .map(([name, city]) => ({
        ...emptyRoom(),
        name,
        city,
        country: "Poland",
        category: "Other",
      }));
    if (toAdd.length) persist({ ...data, rooms: [...data.rooms, ...toAdd] });
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
    return <WhoAmI members={MEMBERS} onChoose={chooseMember} />;
  }
 
  return (
    <div className="ert-root" style={{ minHeight: 600, borderRadius: 14, overflow: "hidden" }}>
      <style>{TOKENS}</style>
 
      <Header
        currentMember={currentMember}
        onSwitchMember={() => chooseMember(null)}
        onAdd={() => { setEditingRoom(emptyRoom()); setView("edit-room"); }}
      />
 
      {saveError && (
        <div style={{ background: "var(--danger)", color: "#fff", fontSize: 12.5, padding: "6px 20px" }}>
          {saveError}
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
            onPreload={preloadLockmeRooms}
          />
        )}
 
        {view === "ranking" && <RankingView rooms={playedRooms} members={MEMBERS} onOpen={(id) => { setSelectedRoomId(id); setReturnView("ranking"); setView("room-detail"); }} />}
 
        {view === "settings" && (
          <SettingsView members={MEMBERS} currentMember={currentMember} />
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
          />
        )}
      </div>
    </div>
  );
}
 
/* ---------------------------------------------------------------
   WHO AM I
--------------------------------------------------------------- */
function WhoAmI({ members, onChoose }) {
  return (
    <div className="ert-root" style={{ minHeight: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{TOKENS}</style>
      <div className="ert-card" style={{ padding: 28, maxWidth: 380, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <Users size={20} color="var(--brass)" />
          <div className="ert-display" style={{ fontSize: 20, fontWeight: 700 }}>Who's playing?</div>
        </div>
        <p style={{ fontSize: 13.5, color: "var(--text-dim)", marginTop: 4, marginBottom: 18 }}>
          Pick your name so your ratings and notes are logged under you on this device.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {members.map((m) => (
            <button
              key={m}
              className="ert-btn ert-btn-ghost"
              style={{ justifyContent: "flex-start" }}
              onClick={() => onChoose(m)}
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
function Header({ currentMember, onSwitchMember, onAdd }) {
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
        <button className="ert-btn ert-btn-brass" onClick={onAdd}>
          <Plus size={15} /> Add room
        </button>
      </div>
    </div>
  );
}
 
function Nav({ view, setView }) {
  const tabs = [
    { id: "dashboard", label: "Overview", icon: LayoutDashboard },
    { id: "rooms", label: "Completed", icon: ListChecks },
    { id: "ranking", label: "Ranking", icon: Trophy },
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
   ROOMS LIST (played or wishlist)
--------------------------------------------------------------- */
function FilterPopover({ cities, cats, countries, selectedCities, selectedGenres, selectedCountries, onToggleCity, onToggleGenre, onToggleCountry, onClear }) {
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
 
  const activeCount = selectedCities.length + selectedGenres.length + selectedCountries.length;
 
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
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
 
      {open && (
        <div
          className="ert-card-raised ert-scrollbar"
          style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, width: 240, maxHeight: 360, overflowY: "auto", zIndex: 20, padding: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
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
 
function RoomsView({ rooms, onOpen, emptyLabel, onPreload }) {
  const [search, setSearch] = useState("");
  const [selectedCities, setSelectedCities] = useState([]);
  const [selectedGenres, setSelectedGenres] = useState([]);
  const [selectedCountries, setSelectedCountries] = useState([]);
 
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
 
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 200px" }}>
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
        {onPreload && (
          <button className="ert-btn ert-btn-ghost" onClick={onPreload} title="Add lock.me's top-ranked Poland rooms (name & city only)">
            <Sparkles size={14} /> Preload lock.me top rooms
          </button>
        )}
      </div>
 
      {filtered.length === 0 ? (
        <EmptyNote text={emptyLabel || "No rooms match those filters."} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
          {filtered.map((r, i) => <RoomCard key={r.id} room={r} index={i} onOpen={() => onOpen(r.id)} />)}
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
function RoomDetail({ room, members, currentMember, onBack, onEdit, onDelete, onUpdate }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [myRating, setMyRating] = useState(room.ratings[currentMember] || 0);
  const [myNote, setMyNote] = useState(room.notes[currentMember] || "");
  const [newPhotoUrl, setNewPhotoUrl] = useState("");
  const [walkthrough, setWalkthrough] = useState(room.walkthrough || "");
 
  useEffect(() => {
    setMyRating(room.ratings[currentMember] || 0);
    setMyNote(room.notes[currentMember] || "");
    setWalkthrough(room.walkthrough || "");
  }, [room.id, currentMember]);
 
  const saveMyRating = (val) => {
    setMyRating(val);
    onUpdate({ ratings: { ...room.ratings, [currentMember]: val } });
  };
  const saveMyNote = () => {
    onUpdate({ notes: { ...room.notes, [currentMember]: myNote } });
  };
  const saveWalkthrough = () => {
    onUpdate({ walkthrough });
  };
  const addPhoto = () => {
    if (!newPhotoUrl.trim()) return;
    onUpdate({ photos: [...(room.photos || []), { url: newPhotoUrl.trim() }] });
    setNewPhotoUrl("");
  };
  const removePhoto = (idx) => {
    onUpdate({ photos: room.photos.filter((_, i) => i !== idx) });
  };
  const markPlayed = () => {
    onUpdate({ status: "played", datePlayed: room.datePlayed || new Date().toISOString().slice(0, 10) });
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
              lock.me listing <ExternalLink size={12} />
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
          <div className="ert-display" style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Your rating &amp; notes</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            {Array.from({ length: 10 }).map((_, i) => (
              <Star
                key={i}
                size={19}
                className="ert-star-btn"
                onClick={() => saveMyRating(i + 1)}
                fill={i < myRating ? "var(--brass)" : "none"}
                color={i < myRating ? "var(--brass)" : "var(--border)"}
              />
            ))}
            <span className="ert-mono" style={{ fontSize: 13, color: "var(--text-dim)", marginLeft: 4 }}>{myRating || "—"}/10</span>
          </div>
          <textarea
            className="ert-textarea"
            rows={4}
            placeholder="Your impressions — puzzle quality, story, scares, whether it's worth recommending…"
            value={myNote}
            onChange={(e) => setMyNote(e.target.value)}
            onBlur={saveMyNote}
          />
 
          <div style={{ marginTop: 18 }}>
            <div className="ert-display" style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>Everyone's notes</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {members.map((m) => (
                <div key={m} style={{ background: "var(--surface-raised)", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{m}</span>
                    {typeof room.ratings[m] === "number" && (
                      <span className="ert-mono" style={{ fontSize: 12, color: "var(--brass)" }}>{room.ratings[m]}/10</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: room.notes[m] ? "var(--text)" : "var(--text-dim)", fontStyle: room.notes[m] ? "normal" : "italic" }}>
                    {room.notes[m] || "No notes yet."}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
 
      {room.status === "played" && (
        <div className="ert-card" style={{ padding: 22, marginBottom: 16 }}>
          <div className="ert-display" style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Walkthrough</div>
          <p style={{ fontSize: 11.5, color: "var(--text-dim)", marginBottom: 10 }}>
            Shared by the whole crew — jot down the solve path, hints used, or tips for a replay. Anyone can add to or edit this.
          </p>
          <textarea
            className="ert-textarea"
            rows={6}
            placeholder="Step through how you solved it — puzzle order, hint usage, anything worth remembering next time…"
            value={walkthrough}
            onChange={(e) => setWalkthrough(e.target.value)}
            onBlur={saveWalkthrough}
          />
        </div>
      )}
 
      <div className="ert-card" style={{ padding: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
          <Camera size={15} color="var(--brass)" />
          <div className="ert-display" style={{ fontSize: 15, fontWeight: 700 }}>Photos</div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input className="ert-input" placeholder="Paste an image URL…" value={newPhotoUrl} onChange={(e) => setNewPhotoUrl(e.target.value)} />
          <button className="ert-btn ert-btn-ghost" onClick={addPhoto}><Plus size={14} /></button>
        </div>
        {(!room.photos || room.photos.length === 0) ? (
          <EmptyNote text="No photos yet — paste a link to an image (e.g. from your phone's cloud backup)." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
            {room.photos.map((p, i) => (
              <div key={i} style={{ position: "relative", borderRadius: 8, overflow: "hidden", aspectRatio: "1", background: "var(--surface-raised)" }}>
                <img src={p.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} onError={(e) => { e.target.style.display = "none"; }} />
                <button
                  onClick={() => removePhoto(i)}
                  style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.6)", border: "none", borderRadius: 5, padding: 3, cursor: "pointer" }}
                >
                  <X size={12} color="#fff" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
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
        <Field label="lock.me link (or other listing)">
          <input className="ert-input" placeholder="https://www.lock.me/…" value={form.lockmeUrl} onChange={(e) => set({ lockmeUrl: e.target.value })} />
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
              <select className="ert-select" value={form.result} onChange={(e) => set({ result: e.target.value })}>
                <option value="unknown">Not recorded</option>
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
function SettingsView({ members, currentMember }) {
  return (
    <div className="ert-card" style={{ padding: 22, maxWidth: 420 }}>
      <div className="ert-display" style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Crew</div>
      <p style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 14 }}>Everyone here shares this log and can add rooms, ratings and notes.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {members.map((m) => (
          <div key={m} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface-raised)", padding: "9px 12px", borderRadius: 7 }}>
            <span style={{ fontSize: 13.5 }}>{m}{m === currentMember ? "  (you)" : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
 
