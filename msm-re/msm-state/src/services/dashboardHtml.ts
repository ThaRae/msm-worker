/**
 * The dashboard page served at GET /. Kept as one self-contained document
 * (inline CSS + vanilla JS) so the tool ships without a frontend build
 * step; it only reads /api/state plus the asset and audio routes.
 *
 * Layout: an island sidebar (grouped by family, searchable, with "ready"
 * badges), an Overview page, and one page per island. Pages are addressed
 * by URL hash (#/overview, #/island/<id>) so the browser back button and
 * reloads keep the user where they were. The dashboard is read-only: it
 * shows account state and never sends gameplay requests.
 */

export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MSM Dashboard</title>
<style>
  :root {
    --bg: #0f1117; --panel: #171a23; --panel2: #1e2230; --panel3: #262b3c;
    --line: #2a3043; --text: #eceef5; --dim: #9198ad; --faint: #666d84;
    --accent: #7c9cff; --accent-strong: #4f6fe8; --good: #3ccf8e; --good-bg: rgba(60,207,142,.12);
    --warn: #f2b84b; --warn-bg: rgba(242,184,75,.12); --bad: #ff7b72; --bad-bg: rgba(255,123,114,.12);
    --radius: 12px;
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--text);
         font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  a { color: inherit; text-decoration: none; }
  h1 { font-size: 24px; margin: 0; letter-spacing: -.01em; }
  h2 { font-size: 15px; margin: 0; }
  p { margin: 0; }
  .dim { color: var(--dim); }
  .small { font-size: 12px; }
  .num { font-variant-numeric: tabular-nums; }

  /* Top bar */
  .topbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 14px;
            padding: 10px 20px; background: rgba(15,17,23,.92); backdrop-filter: blur(8px);
            border-bottom: 1px solid var(--line); }
  .brand { font-weight: 700; letter-spacing: .02em; }
  .player { display: flex; align-items: baseline; gap: 8px; }
  .player b { font-size: 15px; }
  .spacer { flex: 1; }
  .status { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--dim);
            background: var(--panel2); border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px; }
  .status .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--bad); }
  .status.online .dot { background: var(--good); }
  .status.starting .dot { background: var(--warn); }

  /* Wallet */
  .wallet { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 8px;
            padding: 14px 20px 0; }
  .coin { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; }
  .coin .lbl { color: var(--dim); font-size: 12px; }
  .coin .val { font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .coin .swatch { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; }

  /* Layout */
  .layout { display: grid; grid-template-columns: 270px 1fr; gap: 20px; padding: 16px 20px 40px;
            max-width: 1500px; margin: 0 auto; align-items: start; }
  .layout > * { min-width: 0; }
  .sidebar { position: sticky; top: 62px; max-height: calc(100vh - 80px); overflow: auto;
             background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 10px; }
  .sidebar input[type=search] { width: 100%; margin-bottom: 8px; }
  .nav-group { color: var(--faint); font-size: 11px; font-weight: 700; text-transform: uppercase;
               letter-spacing: .08em; padding: 12px 8px 4px; }
  .nav-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px;
              color: var(--dim); }
  .nav-item:hover { background: var(--panel2); color: var(--text); }
  .nav-item.active { background: var(--panel3); color: var(--text); }
  .nav-item .nav-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nav-item .count { color: var(--faint); font-size: 12px; }
  .nav-empty { color: var(--faint); padding: 8px; font-size: 13px; }

  /* Common bits */
  .badge { display: inline-block; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 1px 8px;
           background: var(--good-bg); color: var(--good); white-space: nowrap; }
  .badge.warn { background: var(--warn-bg); color: var(--warn); }
  .badge.muted { background: var(--panel3); color: var(--dim); }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; }
  .card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
  .card-head .spacer { flex: 1; }
  .stack { display: grid; gap: 16px; }
  .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr)); gap: 16px; }
  .grid2 > * { min-width: 0; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr)); gap: 12px; }
  .stat { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; }
  .stat .big { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.2; }
  .stat.good .big { color: var(--good); }
  .page-head { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
  .crumbs { color: var(--dim); font-size: 13px; margin-bottom: 4px; }
  .crumbs a:hover { color: var(--text); text-decoration: underline; }
  .empty { color: var(--faint); padding: 6px 0; }

  .item { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); }
  .item:first-of-type { border-top: 0; }
  .item-main { flex: 1; min-width: 0; }
  .item-main b { display: block; }
  .item-side { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
  .kind { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--faint);
          width: 64px; flex: none; }

  .ready { color: var(--good); font-weight: 600; }
  .waiting { color: var(--warn); font-variant-numeric: tabular-nums; }

  .qa { display: flex; align-items: center; gap: 14px; padding: 12px 0; border-top: 1px solid var(--line); }
  .qa:first-of-type { border-top: 0; padding-top: 0; }
  .qa .qa-text { flex: 1; }

  /* Controls */
  button { font: inherit; font-size: 13px; background: var(--panel3); color: var(--text); border: 1px solid var(--line);
           border-radius: 8px; padding: 6px 12px; cursor: pointer; white-space: nowrap; }
  button:hover { border-color: #3a4260; background: #2d3346; }
  button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button:disabled { opacity: .45; cursor: default; }
  button.primary { background: var(--accent-strong); border-color: var(--accent-strong); color: #fff; }
  button.primary:hover { background: #5d7cf0; }
  button.good { background: #1f7a52; border-color: #239060; color: #fff; }
  button.good:hover { background: #24905f; }
  button.ghost { background: transparent; }
  button.sm { padding: 3px 9px; font-size: 12px; }
  input, select { font: inherit; font-size: 13px; background: var(--bg); color: var(--text); border: 1px solid var(--line);
                  border-radius: 8px; padding: 6px 10px; }
  input[type=number] { width: 70px; }
  label.field { display: grid; gap: 4px; font-size: 12px; color: var(--dim); }
  .form { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
  .form .full { grid-column: 1 / -1; }
  .form select { width: 100%; }
  details.adv summary { cursor: pointer; color: var(--dim); font-size: 12px; user-select: none; }
  details.adv[open] { width: 100%; }
  details.adv .adv-body { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 12px; color: var(--dim); }

  /* Monster table */
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  th { color: var(--faint); font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
  tr:hover td { background: rgba(255,255,255,.015); }
  td.actions { text-align: right; white-space: nowrap; }
  .nick { color: var(--dim); font-size: 12px; }
  .bar { display: inline-block; width: 60px; height: 6px; border-radius: 3px; background: var(--panel3);
         vertical-align: middle; margin-right: 6px; overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--good); }
  .table-wrap { overflow-x: auto; }

  /* Island map */
  canvas.map { display: block; width: 100%; height: auto; cursor: crosshair; user-select: none; background: #0c1018; border-radius: 8px; }
  .map-foot { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .map-foot .swatch { display: inline-block; width: 9px; height: 9px; border-radius: 2px; }

  /* Store sections */
  details.section summary { cursor: pointer; color: var(--dim); font-size: 13px; padding: 8px 0; user-select: none; list-style-position: outside; }
  details.section summary:hover { color: var(--text); }
  details.section summary b { color: var(--text); }

  /* Monster portrait thumbnails in list rows */
  img.mini { width: 22px; height: 22px; border-radius: 4px; vertical-align: middle; margin-right: 6px; object-fit: cover; }

  .progress { height: 6px; border-radius: 3px; background: var(--panel3); margin-top: 6px; overflow: hidden; }
  .progress span { display: block; height: 100%; background: var(--accent); transition: width .2s; }

  /* Activity drawer */
  .drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(440px, 100vw); z-index: 30;
            background: var(--panel); border-left: 1px solid var(--line); box-shadow: -8px 0 32px rgba(0,0,0,.4);
            display: flex; flex-direction: column; }
  .drawer[hidden] { display: none; }
  .drawer-head { display: flex; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--line); }
  .drawer-body { overflow: auto; padding: 8px 16px 16px; }
  .ev { padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
  .ev .ev-time { color: var(--faint); font-size: 12px; margin-right: 8px; font-variant-numeric: tabular-nums; }
  .ev.error .ev-title { color: var(--bad); }
  .ev .ev-detail { color: var(--faint); font: 11px/1.4 ui-monospace, Menlo, monospace; word-break: break-all; margin-top: 2px; }

  /* Toasts */
  #toast { position: fixed; right: 16px; bottom: 16px; max-width: 420px; z-index: 40; display: grid; gap: 8px; }
  .toast { background: var(--panel3); border: 1px solid var(--line); border-left: 3px solid var(--good); color: var(--text);
           border-radius: 8px; padding: 10px 14px; font-size: 13px; box-shadow: 0 6px 20px rgba(0,0,0,.45); }
  .toast.err { border-left-color: var(--bad); }

  @media (max-width: 900px) {
    .layout { grid-template-columns: 1fr; padding: 12px; }
    .wallet { padding: 12px 12px 0; }
    .sidebar { position: static; max-height: 45vh; }
    .topbar { flex-wrap: wrap; padding: 10px 12px; }
    .form { grid-template-columns: 1fr; }
    .qa { flex-wrap: wrap; }
  }
</style>
</head>
<body>
<header class="topbar" id="top"></header>
<section class="wallet" id="wallet"></section>
<div class="layout">
  <aside class="sidebar">
    <input type="search" id="islandSearch" placeholder="Find an island..." aria-label="Find an island" autocomplete="off">
    <nav id="islandNav"></nav>
  </aside>
  <main>
    <div id="view"><p class="dim">Loading your islands...</p></div>
  </main>
</div>
<aside class="drawer" id="activity" hidden>
  <div class="drawer-head"><h2>Recent activity</h2><span class="spacer"></span>
    <button class="ghost sm" data-action="toggleActivity">Close</button></div>
  <div class="drawer-body" id="activityBody"></div>
</aside>
<div id="toast" role="status" aria-live="polite"></div>
<script>
'use strict';

var GROUP_LABELS = {
  natural: 'Natural Islands', mirror: 'Mirror Islands', fire: 'Fire Islands',
  magical: 'Magical Islands', ethereal: 'Ethereal Islands', special: 'Special Islands',
};
var CURRENCIES = [
  ['coins', 'Coins', '#f7c948'], ['diamonds', 'Diamonds', '#58c4dd'], ['food', 'Food', '#e8885a'],
  ['keys', 'Keys', '#c9a0ff'], ['relics', 'Relics', '#7ee0b5'], ['starpower', 'Starpower', '#ffd36e'],
  ['etherealCurrency', 'Shards', '#b48cff'], ['eggWildcards', 'Wildcards', '#ff9ec4'],
  ['clubboxTokens', 'Clubbox Tix', '#8ef0d2'], ['minigameTokens', 'Memory Tix', '#f0a88e'],
];
var STATUS_TEXT = { online: 'Connected', starting: 'Connecting...', offline: 'Offline' };
var EVENT_LABELS = {
  gs_collect_monster: 'Collected coins from a monster',
  gs_feed_monster: 'Fed a monster',
  gs_collect_from_mine: 'Collected mines',
  gs_hatch_egg: 'Hatched an egg',
  gs_finish_breeding: 'Finished a breeding',
  gs_breed_monsters: 'Started a breeding',
  gs_change_island: 'Switched island',
  gs_sell_egg: 'Sold an egg',
  gs_sell_monster: 'Sold a monster',
  gs_box_add_egg: 'Zapped an egg to a statue',
  gs_start_baking: 'Started baking treats',
  gs_finish_baking: 'Collected baked treats',
  gs_buy_structure: 'Bought a structure from the market',
  gs_buy_egg: 'Bought a monster egg from the market',
  gs_buy_tile: 'Bought an island expansion tile',
  gs_sell_structure: 'Sold a structure',
  gs_move_structure: 'Moved a structure',
  gs_finish_structure: 'Finished construction',
  gs_buy_card_album_store_item: 'Bought a sticker pack',
  gs_open_card_packs: 'Opened sticker packs',
  gs_collect_card_album_page_rewards: 'Collected a sticker page reward',
  gs_collect_card_album_rewards: 'Collected the album reward',
  update_island_mode: 'Flipped the Paironormal mirror',
  collect_all: 'Collect all monsters on an island',
  online: 'Connected to the game server',
  disconnect: 'Disconnected from the game server',
  start: 'Could not connect',
};

var lastDoc = null;
var lastSignature = '';
var lastLayoutSig = '';
var currentView = 'overview';

// ---------- formatting ----------

function fmtNum(n) { return Number(n || 0).toLocaleString('en-US'); }
function fmtCompact(n) {
  var v = Number(n || 0);
  // [show from, divide by, suffix]: values under 10,000 stay exact.
  var units = [[1e12, 1e12, 'T'], [1e9, 1e9, 'B'], [1e6, 1e6, 'M'], [1e4, 1e3, 'K']];
  var unit = units.find(function (u) { return Math.abs(v) >= u[0]; });
  if (!unit) return fmtNum(v);
  var scaled = v / unit[1];
  return scaled.toFixed(scaled >= 100 ? 0 : 1) + unit[2];
}
function fmtDur(ms) {
  if (ms <= 0) return 'now';
  var s = Math.floor(ms / 1000);
  var d = Math.floor(s / 86400); s -= d * 86400;
  var h = Math.floor(s / 3600); s -= h * 3600;
  var m = Math.floor(s / 60); s -= m * 60;
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function serverNow() { return lastDoc.serverNowMs + (Date.now() - lastDoc.fetchedAtMs); }
function countdown(deadline) {
  var left = deadline - serverNow();
  return '<span class="cd ' + (left <= 0 ? 'ready' : 'waiting') + '" data-deadline="' + deadline + '">' +
    (left <= 0 ? 'ready' : fmtDur(left)) + '</span>';
}
function since(startMs) {
  return '<span class="cd" data-since="' + startMs + '">' + fmtDur(serverNow() - startMs) + '</span>';
}

// ---------- data helpers ----------

function islands() { return lastDoc ? lastDoc.state.islands : []; }
function findIsland(id) { return islands().find(function (i) { return i.userIslandId === id; }); }
function readyCount(island) {
  return island.eggs.filter(function (e) { return e.done; }).length +
    island.breeding.filter(function (b) { return b.done; }).length +
    island.baking.filter(function (b) { return b.done; }).length;
}
function collectable(island) {
  return island.monsters.filter(function (m) {
    return !m.inHotel && m.statueState !== 'dormant' && m.statueState !== 'evolving';
  });
}
function mines(island) { return island.structures.filter(function (s) { return s.isMine; }); }


/** Catalog id -> species name, learned from the monsters we can see. */
var monsterNames = null;
function nameOfMonster(id) {
  if (!monsterNames) {
    monsterNames = {};
    islands().forEach(function (i) { i.monsters.forEach(function (m) { monsterNames[m.monsterId] = m.monsterName; }); });
  }
  return monsterNames[id] || ASSETS.names[id] || ('monster ' + id);
}

/** "Noggin x10 + 3 more" for the wants line under a statue row. */
function wantsLabel(list) {
  var parts = list.slice(0, 4).map(function (n) { return nameOfMonster(n.monsterId) + ' x' + n.count; });
  if (list.length > 4) parts.push((list.length - 4) + ' more');
  return parts.join(', ');
}

/** Every timed item (egg or breeding) across all islands, soonest first. */
function allTimers() {
  return islands().reduce(function (acc, island) {
    island.eggs.forEach(function (e) {
      acc.push({ kind: 'egg', island: island, item: e, deadline: e.hatchesOnMs, done: e.done, title: e.monsterName + ' egg' });
    });
    island.breeding.forEach(function (b) {
      acc.push({ kind: 'breeding', island: island, item: b, deadline: b.completeOnMs, done: b.done, title: b.newMonsterName });
    });
    island.baking.forEach(function (bk) {
      acc.push({ kind: 'baking', island: island, item: bk, deadline: bk.completeOnMs, done: bk.done, title: bk.foodName + ' x' + bk.foodCount });
    });
    return acc;
  }, []).sort(function (a, b) { return a.deadline - b.deadline; });
}

// ---------- notifications ----------

function toast(msg, isErr) {
  var el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  setTimeout(function () { el.remove(); }, isErr ? 9000 : 5000);
}

// ---------- server calls ----------

function withFetchedAt(doc) { doc.fetchedAtMs = Date.now(); return doc; }

function poll(explicit) {
  return fetch('/api/state')
    .then(function (r) { return r.json(); })
    .then(function (doc) {
      applyDoc(withFetchedAt(doc));
      if (explicit === true) { toast('Up to date.'); }
    })
    .catch(function (err) { toast('Could not reach the dashboard server: ' + err.message, true); });
}

// ---------- rendering: chrome ----------

function renderTop(doc) {
  var p = doc.state.player;
  var s = doc.status;
  var statusText = STATUS_TEXT[s.status] || s.status;
  var synced = s.lastSyncAtMs ? ' - synced <span data-ago="' + s.lastSyncAtMs + '">' + fmtDur(Date.now() - s.lastSyncAtMs) + '</span> ago' : '';
  // Token countdown tells the user how long the dashboard can keep
  // reconnecting without Steam (a fresh ticket only needed after expiry).
  var auth = '';
  if (s.authExpiresAtMs) {
    var left = s.authExpiresAtMs - Date.now();
    auth = ' - <span class="dim">token ' + (left <= 0 ? 'past expiry' : fmtDur(left)) + (s.authFromCache ? ' (cached' + (s.authStale ? ', stale' : '') + ')' : '') + '</span>';
  }
  document.getElementById('top').innerHTML =
    '<span class="brand">MSM Dashboard</span>' +
    (p ? '<span class="player"><b>' + esc(p.name) + '</b><span class="dim">Level ' + p.level + '</span></span>'
       : '<span class="dim">Not logged in</span>') +
    '<span class="spacer"></span>' +
    '<span class="status ' + esc(s.status) + '" title="' + esc(s.lastError || '') + '"><span class="dot"></span>' +
      statusText + (s.status === 'online' ? synced : '') + auth + (s.lastError ? ' - ' + esc(s.lastError) : '') + '</span>' +
    '<button data-action="toggleActivity">Activity</button>' +
    '<button class="primary" data-action="refresh">Refresh</button>';

  document.getElementById('wallet').innerHTML = p ? CURRENCIES.map(function (c) {
    return '<div class="coin" title="' + fmtNum(p[c[0]]) + ' ' + c[1] + '">' +
      '<div class="lbl"><span class="swatch" style="background:' + c[2] + '"></span>' + c[1] + '</div>' +
      '<div class="val">' + fmtCompact(p[c[0]]) + '</div></div>';
  }).join('') : '';
}

function renderNav() {
  var groups = islands().reduce(function (acc, island) {
    (acc[island.group] = acc[island.group] || []).push(island);
    return acc;
  }, {});
  var totalReady = islands().reduce(function (n, i) { return n + readyCount(i); }, 0);
  var overview = '<a class="nav-item' + (currentView === 'overview' ? ' active' : '') + '" href="#/overview">' +
    '<span class="nav-name"><b>Overview</b></span>' +
    (totalReady ? '<span class="badge">' + totalReady + ' ready</span>' : '') + '</a>';
  var groupHtml = Object.keys(GROUP_LABELS).filter(function (g) { return groups[g]; }).map(function (g) {
    return '<div class="nav-section"><div class="nav-group">' + GROUP_LABELS[g] + '</div>' +
      groups[g].map(function (island) {
        var ready = readyCount(island);
        return '<a class="nav-item' + (currentView === island.userIslandId ? ' active' : '') + '"' +
          ' href="#/island/' + esc(island.userIslandId) + '" data-name="' + esc(island.name.toLowerCase()) + '">' +
          '<span class="nav-name">' + esc(island.name) + '</span>' +
          (ready ? '<span class="badge" title="eggs ready to hatch + finished breedings">' + ready + ' ready</span>'
                 : '<span class="count">' + island.monsters.length + '</span>') + '</a>';
      }).join('') + '</div>';
  }).join('');
  document.getElementById('islandNav').innerHTML = overview + groupHtml +
    '<div class="nav-empty" id="navEmpty" hidden>No island matches that search.</div>';
  applyIslandSearch();
}

function applyIslandSearch() {
  var q = document.getElementById('islandSearch').value.trim().toLowerCase();
  var visible = 0;
  document.querySelectorAll('#islandNav .nav-section').forEach(function (section) {
    var shown = 0;
    section.querySelectorAll('.nav-item').forEach(function (item) {
      var match = q === '' || item.getAttribute('data-name').indexOf(q) !== -1;
      item.hidden = !match;
      shown += match ? 1 : 0;
    });
    section.hidden = shown === 0;
    visible += shown;
  });
  document.getElementById('navEmpty').hidden = visible > 0 || q === '';
}

function renderActivity(doc) {
  var evs = doc.events.slice(-80).reverse();
  document.getElementById('activityBody').innerHTML = evs.length === 0
    ? '<p class="empty">Nothing yet.</p>'
    : evs.map(function (e) {
      var title = EVENT_LABELS[e.cmd] || e.cmd;
      var kind = e.kind === 'response' ? ' (done)' : e.kind === 'push' ? ' (from server)' : '';
      return '<div class="ev ' + esc(e.kind) + '"><span class="ev-time">' + new Date(e.atMs).toLocaleTimeString() + '</span>' +
        '<span class="ev-title">' + esc(title) + '</span><span class="dim small">' + kind + '</span>' +
        (e.detail ? '<div class="ev-detail">' + esc(e.detail) + '</div>' : '') + '</div>';
    }).join('');
}

// ---------- rendering: overview ----------

function timerRow(t) {
  var link = '<a class="dim small" href="#/island/' + esc(t.island.userIslandId) + '">' + esc(t.island.name) + '</a>';
  var button = '<span class="ready">Ready</span>';
  var sub = t.kind === 'breeding' ? esc(t.item.monster1Name) + ' + ' + esc(t.item.monster2Name) + ' - ' : '';
  var kindLabel = t.kind === 'egg' ? 'Egg' : t.kind === 'baking' ? 'Baking' : 'Breeding';
  return '<div class="item"><span class="kind">' + kindLabel + '</span>' +
    '<div class="item-main"><b>' + esc(t.title) + '</b><span class="small dim">' + sub + '</span>' + link + '</div>' +
    '<div class="item-side">' + (t.done ? button : countdown(t.deadline)) + '</div></div>';
}

/** Encore event, clubboxes and the global event schedule. */
function eventsCard() {
  var ev = lastDoc.state.events || { encore: null, clubboxes: [], timedEvents: [] };
  var rows = '';

  var enc = ev.encore;
  if (enc) {
    var pct = Math.round(enc.progress * 1000) / 10;
    rows += '<div class="item"><span class="kind">Encore</span>' +
      '<div class="item-main"><b>' + esc(enc.name) + '</b>' +
      '<span class="small dim">' + esc(enc.rewardTrackName) + ' track' + (enc.rollsOver ? ' · rolls over' : '') + '</span></div>' +
      '<div class="item-side"><span class="bar" style="width:120px" title="' + pct + '% to the next reward">' +
      '<span style="width:' + Math.min(100, Math.max(0, pct)) + '%"></span></span> ' +
      '<span class="small dim">' + pct + '%</span> ' +
      '<span class="dim small">ends in</span>' + countdown(enc.endsOnMs) + '</div></div>';
  } else {
    rows += '<div class="item"><div class="item-main"><b>No encore event running</b>' +
      '<span class="small dim">Encore events run on weekends and reward breeding, hatching or baking.</span></div></div>';
  }

  (ev.clubboxes || []).forEach(function (cb) {
    rows += '<div class="item"><span class="kind">Clubbox</span>' +
      '<div class="item-main"><b>' + esc(cb.actName) + '</b>' +
      '<span class="small dim">' + (cb.islandName ? 'on ' + esc(cb.islandName) : 'act ' + cb.actId) +
      (cb.startedOnMs ? ' · running ' + since(cb.startedOnMs) : '') + '</span></div>' +
      '<div class="item-side"><span class="small dim">hype</span> <b>' + fmtNum(cb.hype) + '</b>' +
      '<span class="small dim">(best ' + fmtNum(cb.topHype) + ')</span></div></div>';
  });

  (ev.timedEvents || []).slice(0, 8).forEach(function (te) {
    rows += '<div class="item"><span class="kind">' + esc(te.eventType) + '</span>' +
      '<div class="item-main"><b>' + esc(te.label) + '</b></div>' +
      '<div class="item-side">' + (te.active
        ? '<span class="dim small">ends in</span>' + countdown(te.endsOnMs)
        : '<span class="dim small">starts in</span>' + countdown(te.startOnMs)) + '</div></div>';
  });

  return '<div class="card"><div class="card-head"><h2>Events</h2>' +
    (enc ? '<span class="badge">encore live</span>' : '') + '<span class="spacer"></span>' +
    '<span class="dim small">' + plural((lastDoc.state.player && lastDoc.state.player.clubboxTokens) || 0, 'clubbox ticket') + '</span></div>' +
    rows + '</div>';
}

// ---------- rendering: sticker book ----------

/** Sum the CARD_PACK amounts inside a store item's JSON contents string. */
function packCount(contents) {
  var parsed;
  try { parsed = JSON.parse(contents || '[]'); } catch (e) { parsed = []; }
  if (!Array.isArray(parsed)) return 0;
  return parsed.reduce(function (n, entry) {
    return n + (entry && entry.type === 'CARD_PACK' ? Number(entry.amount) || 0 : 0);
  }, 0);
}

/** Human hint for non-pack bonuses inside a pack's contents ("+ 25 diamonds"). */
function packBonus(contents) {
  var parsed;
  try { parsed = JSON.parse(contents || '[]'); } catch (e) { parsed = []; }
  if (!Array.isArray(parsed)) return '';
  var extras = parsed.filter(function (e) { return e && e.type !== 'CARD_PACK'; }).map(function (e) {
    return (Number(e.amount) || 0) + ' ' + String(e.type || '').toLowerCase().replace(/_/g, ' ');
  });
  return extras.length ? ' (+' + extras.join(', ') + ')' : '';
}

/** Humanize a page's JSON rewards: [{"type":"COINS","amount":140000}] -> "140,000 coins". */
function rewardSummary(rewardsJson) {
  var parsed;
  try { parsed = JSON.parse(rewardsJson || '[]'); } catch (e) { parsed = []; }
  if (!Array.isArray(parsed)) return '';
  return parsed.map(function (r) {
    if (!r) return '';
    var type = String(r.type || '').toLowerCase().replace(/_/g, ' ');
    return Number(r.amount) > 0 ? fmtNum(r.amount) + ' ' + type : type;
  }).filter(Boolean).join(' + ');
}

/**
 * The sticker book (card album): progress per page, page rewards to
 * claim, and the album's own store where card currency buys sticker
 * packs. Buying auto-opens the granted packs so the new stickers land
 * in the book right away (see the buyPack handler).
 */
function stickerBookCard() {
  var album = lastDoc.state.cardAlbum;
  if (!album || album.pages.length === 0) return '';
  var seen = {};
  var totalCards = 0;
  album.pages.forEach(function (p) {
    p.cardIds.forEach(function (id) { if (!seen[id]) { seen[id] = 1; totalCards += 1; } });
  });
  var have = album.collectedCardIds.length;
  var pct = totalCards === 0 ? 0 : Math.round((have / totalCards) * 100);

  var pageRows = album.pages.map(function (p) {
    var reward = rewardSummary(p.rewards);
    var side = p.rewardClaimed
      ? '<span class="badge muted">claimed</span>'
      : p.canClaim
        ? '<span class="badge">reward ready</span>'
        : '<span class="small dim">' + p.collected + '/' + p.cardIds.length + '</span>';
    return '<div class="item"><div class="item-main"><b>' + esc(p.name) + '</b>' +
      '<span class="small dim">' + plural(p.collected, 'of ' + p.cardIds.length, 'of ' + p.cardIds.length) + ' stickers' +
      (reward ? ' · reward: ' + esc(reward) : '') +
      (p.rewardClaimed ? ' · claimed' : '') + '</span></div>' +
      '<div class="item-side">' + side + '</div></div>';
  }).join('');

  // Pack instances waiting to be opened (bought just now or granted by an
  // event). The server only reveals their ids through the album state, so
  // the open call is driven from here rather than the buy response.
  var PACK_TYPES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  var pendingRows = (album.pendingPacks || []).map(function (pk) {
    var rarity = PACK_TYPES[pk.type - 1] || 'pack';
    return '<div class="item"><div class="item-main"><b>Unopened ' + esc(rarity) + ' pack</b>' +
      '<span class="small dim">' + plural(pk.cards.length, 'sticker') + ' inside</span></div></div>';
  }).join('');

  var packRows = album.packs.map(function (pk) {
    var afford = album.currency >= pk.cost;
    var label = pk.name || ('sticker pack ' + pk.id);
    return '<div class="item"><div class="item-main"><b>' + esc(label) + '</b>' +
      '<span class="small dim">' + plural(packCount(pk.contents), 'sticker pack') + packBonus(pk.contents) + '</span></div>' +
      '<div class="item-side"><span class="small dim">' + pk.cost + ' stickers' +
      (afford ? '' : ' (not enough yet)') + '</span></div></div>';
  }).join('');

  var albumClaim = album.complete
    ? '<div class="item"><div class="item-main"><b>Album complete!</b>' +
      '<span class="small dim">Every page is done; the album reward is ready in game.</span></div></div>'
    : '';

  return '<div class="card"><div class="card-head"><h2>Sticker book</h2>' +
    '<span class="badge muted">' + have + '/' + totalCards + ' stickers</span><span class="spacer"></span>' +
    '<span class="dim small">' + fmtNum(album.currency) + ' sticker currency · ' +
    plural(album.duplicates, 'duplicate') + '</span></div>' +
    '<div class="item"><div class="item-main"><b>Album ' + album.albumId + ' progress</b></div>' +
      '<div class="item-side"><span class="bar" style="width:120px"><span style="width:' + pct + '%"></span></span> ' +
      '<span class="small dim">' + pct + '%</span></div></div>' +
    albumClaim + pendingRows + pageRows +
    (packRows ? '<div class="card-head" style="margin-top:12px"><h2>Sticker packs</h2></div>' + packRows
              : '<p class="empty">This album has no packs for sale.</p>') +
    '</div>';
}

function renderOverview() {
  var s = lastDoc.state.summary;
  var timers = allTimers();
  var ready = timers.filter(function (t) { return t.done; });
  var upcoming = timers.filter(function (t) { return !t.done; }).slice(0, 10);
  var eggsReady = ready.filter(function (t) { return t.kind === 'egg'; }).length;
  var breedsDone = ready.filter(function (t) { return t.kind === 'breeding'; }).length;
  var minesReady = s.minesReady || 0;

  return '<div class="stack">' +
    '<div class="page-head"><div><h1>Overview</h1><p class="dim">' + plural(s.islands, 'island') + ', ' +
      plural(s.monsters, 'monster') + '. Pick an island on the left to see it in detail.</p></div></div>' +
    '<div class="stats">' +
      '<div class="stat' + (eggsReady ? ' good' : '') + '"><div class="big">' + eggsReady + '</div><div class="dim">eggs ready to hatch <span class="small">(' + s.eggsTotal + ' total)</span></div></div>' +
      '<div class="stat' + (breedsDone ? ' good' : '') + '"><div class="big">' + breedsDone + '</div><div class="dim">breedings finished <span class="small">(' + s.breedingsActive + ' still running)</span></div></div>' +
      '<div class="stat"><div class="big">' + fmtNum(s.monsters) + '</div><div class="dim">monsters</div></div>' +
      '<div class="stat' + (minesReady ? ' good' : '') + '"><div class="big">' + minesReady + '/' + s.mines + '</div><div class="dim">mines ready <span class="small">(fills over 12-23h)</span></div></div>' +
    '</div>' +
    '<div class="grid2">' + eventsCard() + stickerBookCard() + '</div>' +
    '<div class="grid2">' +
      '<div class="card"><div class="card-head"><h2>Ready now</h2>' + (ready.length ? '<span class="badge">' + ready.length + '</span>' : '') + '</div>' +
        (ready.length ? ready.map(timerRow).join('') : '<p class="empty">Nothing is waiting on you.</p>') + '</div>' +
      '<div class="card"><div class="card-head"><h2>Coming up</h2></div>' +
        (upcoming.length ? upcoming.map(timerRow).join('') : '<p class="empty">No eggs or breedings in progress.</p>') + '</div>' +
    '</div>' +
  '</div>';
}

// ---------- rendering: island page ----------


/** One card for all bakeries on an island: each can bake or be collected. */
function bakeryCard(island) {
  var bakeries = island.structures.filter(function (st) { return st.isBakery; });
  if (bakeries.length === 0) return '';
  var rows = bakeries.map(function (st, i) {
    var bake = island.baking.find(function (bk) { return bk.userStructureId === st.userStructureId; });
    var head = '<div class="item"><div class="item-main"><b>' + esc(st.name) + ' ' + (i + 1) + '</b>';
    if (!bake) {
      // Idle bakery: pick a recipe and bake. Seasonal recipes are skipped
      // because the server only offers them part of the year.
      return head + '</div><div class="item-side"><span class="dim small">idle</span></div></div>';
    }
    var side = bake.done
      ? '<span class="badge">Ready</span>'
      : '<span class="dim small">ready in</span>' + countdown(bake.completeOnMs);
    return head + '<span class="small dim">' + esc(bake.foodName) + ' x' + bake.foodCount + '</span></div>' +
      '<div class="item-side">' + side + '</div></div>';
  }).join('');
  return '<div class="card"><div class="card-head"><h2>Bakery</h2>' +
    (island.baking.some(function (bk) { return bk.done; }) ? '<span class="badge">treats ready</span>' : '') + '</div>' +
    (rows || '') + '</div>';
}

function breedingCard(island) {
  var structures = island.structures.filter(function (st) { return st.isBreeding; });
  var free = structures.filter(function (st) { return !st.isOccupied && !st.isUpgrading; });
  var rows = island.breeding.map(function (b) {
    var zap = '';
    return '<div class="item"><div class="item-main"><b>' + esc(b.newMonsterName) + '</b>' +
      '<span class="small dim">' + esc(b.monster1Name) + ' + ' + esc(b.monster2Name) + '</span>' + zap + '</div>' +
      '<div class="item-side">' + (b.done
        ? '<span class="ready">Done</span>'
        : countdown(b.completeOnMs) + '<span class="dim small">left</span>') + '</div></div>';
  }).join('');

  var form = structures.length === 0 ? '<p class="empty">This island has no breeding structure.</p>' : '';

  return '<div class="card"><div class="card-head"><h2>Breeding</h2>' +
    '<span class="badge muted">' + (structures.length - free.length) + ' of ' + structures.length + ' busy</span></div>' +
    (rows || '<p class="empty">Nothing is breeding right now.</p>') + form + '</div>';
}

function nurseryCard(island) {
  var rows = island.eggs.map(function (e) {
    return '<div class="item"><div class="item-main">' + miniPortrait(e.monsterId) + '<b>' + esc(e.monsterName) + ' egg</b>' +
      (e.previousName ? '<span class="small dim">was called "' + esc(e.previousName) + '"</span>' : '') +
      '</div>' +
      '<div class="item-side">' + (e.done
        ? '<span class="ready">Ready to hatch</span>'
        : '<span class="dim small">hatches in</span>' + countdown(e.hatchesOnMs)) + '</div></div>';
  }).join('');
  return '<div class="card"><div class="card-head"><h2>Nursery</h2>' +
    (island.eggs.length ? '<span class="badge muted">' + plural(island.eggs.length, 'egg') + '</span>' : '') + '</div>' +
    (rows || '<p class="empty">No eggs in the nursery.</p>') + '</div>';
}

function monstersCard(island) {
  if (island.monsters.length === 0) return '';
  var id = esc(island.userIslandId);
  // The island's mirror mode is tracked locally (see paironormalMode), so
  // the "shown" mark follows what the player last flipped to.
  var islandMode = island.isPaironormal ? paironormalMode(island) : -1;
  var rows = island.monsters.map(function (m) {
    var search = (m.monsterName + ' ' + m.name).toLowerCase();
    var last = m.inHotel ? '<span class="badge muted">in hotel</span>'
      : m.sinceLastCollectionMs === null ? '<span class="dim">never</span>'
      : since(serverNow() - m.sinceLastCollectionMs) + ' ago';
    var happy = Math.max(0, Math.min(100, m.happiness));
    // Zap statues (Wublins, Celestials, Amber vessels): lifecycle badge +
    // egg progress + the outstanding eggs; awake ones show their historical
    // requirement list instead, since they accept nothing anymore. The
    // fraction only appears when gs_player actually reports boxed contents
    // — dormant Wublins and vessels keep fill server-side, so those rows
    // say how many they need rather than a fake 0/N. Fill expiry is
    // egg_timer_start + catalog time_to_fill_sec; if the start is omitted
    // (SFS default -1) the catalog window length is shown instead.
    var dormantLabel = island.islandTypeId === 22 ? 'vessel' : 'not woken up';
    var fillText = m.boxFillKnown === false
      ? plural(m.boxTotal, 'egg') + ' needed (fill not in state)'
      : m.boxFilled > 0 || m.statueState === 'awake'
        ? m.boxFilled + '/' + m.boxTotal + ' eggs in'
        : plural(m.boxTotal, 'egg') + ' needed';
    var expireText = '';
    if (m.statueState && m.statueState !== 'awake') {
      if (m.boxExpired) expireText = ' · <span class="badge warn">fill expired</span>';
      else if (m.boxExpiresAtMs) expireText = ' · expires ' + countdown(m.boxExpiresAtMs);
      else if (m.boxFillMs) expireText = ' · ' + fmtDur(m.boxFillMs) + ' to fill';
    }
    var statue = m.statueState
      ? '<div class="nick"><span class="badge' + (m.statueState === 'awake' ? '' : ' warn') + '">' +
        (m.statueState === 'awake' ? 'awake' : m.statueState === 'evolving' ? 'evolving' : dormantLabel) +
        '</span> · ' + fillText + expireText + '</div>'
      : '';
    var wants = m.boxNeeds && m.boxNeeds.length
      ? '<div class="nick" title="' + esc(wantsLabel(m.boxNeeds)) + '">wants: ' + esc(wantsLabel(m.boxNeeds)) + '</div>'
      : m.statueState && m.boxRequirements && m.boxRequirements.length
        ? '<div class="nick dim" title="' + esc(wantsLabel(m.boxRequirements)) + '">needs: ' + esc(wantsLabel(m.boxRequirements)) + '</div>'
        : '';
    // Paironormal pairs: the fused Multimodal carries the pair's Major and
    // Minor components, each with its own level and happiness.
    var pair = (m.modes || []).map(function (mode, index) {
      search += ' ' + mode.name.toLowerCase();
      if (!mode.placed) return '<div class="nick dim">' + esc(mode.name) + ' - not placed yet</div>';
      return '<div class="nick">' + esc(mode.name) + ' Lv ' + mode.level + ' · ' + mode.happiness + '%' +
        (mode.inHotel ? ' · in hotel' : '') + (index === islandMode ? ' · <b>shown</b>' : '') + '</div>';
    }).join('');
    return '<tr data-search="' + esc(search) + '"><td>' + miniPortrait(m.monsterId) + '<b>' + esc(m.monsterName) + '</b>' +
      (m.name && m.name !== m.monsterName ? '<div class="nick">' + esc(m.name) + '</div>' : '') + statue + wants + pair + '</td>' +
      '<td class="num">' + m.level + '</td>' +
      '<td><span class="bar"><span style="width:' + happy + '%"></span></span>' + m.happiness + '%</td>' +
      '<td>' + last + '</td></tr>';
  }).join('');
  return '<div class="card"><div class="card-head"><h2>Monsters</h2><span class="badge muted">' + island.monsters.length + '</span>' +
    '<span class="spacer"></span>' +
    '<input type="search" class="monster-filter" id="mf-' + id + '" placeholder="Filter by name..." aria-label="Filter monsters"></div>' +
    '<div class="table-wrap"><table><thead><tr><th>Monster</th><th>Level</th><th>Happiness</th><th>Last collected</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>' +
    '<p class="empty" id="mfe-' + id + '" hidden>No monster matches that filter.</p></div>';
}

// ---------- rendering: island map ----------
//
// The canvas is painted from /api/islands/:id/view: grass tiles, the
// island scene, and each entity's AEAnim rest pose, all in the game's
// 96x48 isometric pixel space. Clicking inverts that transform and
// highlights the grid cell under the cursor.
var mapPicked = null;
var islandScenes = {};
var mapImages = {};
var USE_WASM_MAP = new URLSearchParams(location.search).get('renderer') === 'wasm';
var mapPreviews = {}, mapPending = {}, mapErrors = {}, mapStartedAt = {};
var mapGeneration = 0, mapAnimationFrame = 0, mapLastFrame = 0, mapHiddenAt = null;
var mapPreviewModule = null;
var mapAudio = {}, mapAudioFactory = null;
function islandSoundSignature(island) {
  return JSON.stringify([island.islandVariantId,
    island.monsters.map(function (m) { return [m.userMonsterId, m.monsterId, m.muted, m.inHotel, m.boxNeeds, m.modes]; }),
    island.structures.map(function (s) { return [s.userStructureId, s.structureId, s.inWarehouse, s.isUpgrading]; })]);
}
function stopMapAudio(key) {
  var audio = mapAudio[key];
  if (audio && audio.transport) {
    if (audio.transport.started) mapStartedAt[key] = performance.now() - audio.transport.elapsed * 1000;
    audio.transport.dispose();
  }
  delete mapAudio[key];
}
function toggleMapAudio(key) {
  if (mapAudio[key]) { stopMapAudio(key); paintMaps(); return; }
  var scene = islandScenes[key], island = lastDoc.state.islands.find(function (i) { return i.userIslandId === key; });
  if (!island || !scene || !scene.runtime || !scene.runtime.song || !mapAudioFactory || document.hidden) return;
  var audio;
  try {
    var transport = mapAudioFactory(scene.runtime.song);
    audio = { transport: transport, loading: true, model: islandSoundSignature(island) };
    mapAudio[key] = audio;
    transport.start().then(function () {
      if (mapAudio[key] !== audio) { transport.dispose(); return; }
      audio.loading = false; mapStartedAt[key] = performance.now();
      if (document.hidden) transport.suspend();
      paintMaps();
    }).catch(function (error) {
      if (mapAudio[key] !== audio) return;
      audio.loading = false; audio.error = error.message; transport.dispose(); paintMaps();
    });
  } catch (error) { mapAudio[key] = { error: error.message }; }
  paintMaps();
}
function previewModule() {
  if (!mapPreviewModule) {
    mapPreviewModule = import('/api/runtime/animationPreview.js').catch(function (error) {
      mapPreviewModule = null; throw error;
    });
  }
  return mapPreviewModule;
}
function scheduleMapFrame() {
  if (!USE_WASM_MAP || mapAnimationFrame || document.hidden) return;
  var active = document.querySelector('canvas.map[data-map]');
  if (!active || !mapPreviews[active.getAttribute('data-map')]) return;
  mapAnimationFrame = requestAnimationFrame(function (now) {
    mapAnimationFrame = 0;
    if (now - mapLastFrame >= 1000 / 30) { mapLastFrame = now; paintMaps(); }
    scheduleMapFrame();
  });
}
var ASSETS = { monsters: {}, structures: {}, names: {} };

function miniPortrait(monsterId) {
  var a = ASSETS.monsters[monsterId];
  return a && !a.fw ? '<img class="mini" src="' + a.url + '" alt="" loading="lazy">' : '';
}

function mapImage(url) {
  var img = mapImages[url];
  if (img) return img;
  img = mapImages[url] = new Image();
  img.decoding = 'async';
  img.onload = paintMaps;
  img.src = url;
  return img;
}

function paintMap(canvas, scene) {
  var vb = scene.viewBox;
  var cssW = canvas.clientWidth || 800;
  var scale = cssW / Math.max(1, vb.w);
  var w = Math.max(1, Math.round(vb.w * scale));
  var h = Math.max(1, Math.round(vb.h * scale));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  var ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  ctx.setTransform(scale, 0, 0, scale, -vb.x * scale, -vb.y * scale);
  if (scene.sky) {
    var sky = mapImage(scene.sky);
    if (sky.complete && sky.naturalWidth) {
      ctx.drawImage(sky, vb.x, vb.y, vb.w, vb.h);
    }
  }
  scene.draws.forEach(function (d) {
    var img = mapImage(d.url);
    if (!img.complete || !img.naturalWidth) return;
    ctx.save();
    ctx.globalAlpha = d.opacity === undefined ? 1 : d.opacity;
    ctx.transform(d.m[0], d.m[1], d.m[2], d.m[3], d.m[4], d.m[5]);
    if (d.shape === 'diamond') {
      // Native 0x550A00 builds vertices AND UVs at quad-edge midpoints.
      // Clipping the affine-textured quad is equivalent in Canvas2D.
      // Canvas antialiases each clip separately, unlike a tessellated GPU
      // mesh. A subpixel coverage guard prevents sky-colored shared seams.
      var padX = Math.min(d.lw / 8, 1.2 / Math.max(scale, 0.001));
      var padY = padX * d.lh / d.lw;
      ctx.beginPath(); ctx.moveTo(d.lw / 2, -padY);
      ctx.lineTo(d.lw + padX, d.lh / 2); ctx.lineTo(d.lw / 2, d.lh + padY);
      ctx.lineTo(-padX, d.lh / 2); ctx.closePath(); ctx.clip();
    }
    if (d.fw > 0) {
      var pixelScale = d.pixelScale === undefined ? 1 : d.pixelScale;
      ctx.translate(d.ox, d.oy);
      if (d.rotated) {
        ctx.translate(0, d.fw * pixelScale);
        ctx.rotate(-Math.PI / 2);
      }
      ctx.drawImage(img, d.fx, d.fy, d.fw, d.fh, 0, 0, d.fw * pixelScale, d.fh * pixelScale);
    } else {
      ctx.drawImage(img, 0, 0, d.lw, d.lh);
    }
    ctx.restore();
  });
  var pick = mapPicked && mapPicked.island === canvas.getAttribute('data-map') ? mapPicked : null;
  if (pick) {
    var tw = scene.tileW, th = scene.tileH;
    var cx = (pick.x + pick.y) * tw / 2, cy = (pick.y - pick.x) * th / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - th / 2);
    ctx.lineTo(cx + tw / 2, cy);
    ctx.lineTo(cx, cy + th / 2);
    ctx.lineTo(cx - tw / 2, cy);
    ctx.closePath();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3 / scale;
    ctx.setLineDash([6 / scale, 4 / scale]);
    ctx.stroke();
  }
}

function paintMaps() {
  var active = {};
  document.querySelectorAll('canvas.map[data-map]').forEach(function (canvas) {
    var key = canvas.getAttribute('data-map'); active[key] = true;
    var scene = islandScenes[key], preview = mapPreviews[key];
    if (scene && preview) {
      var now = mapHiddenAt === null ? performance.now() : mapHiddenAt;
      var audio = mapAudio[key];
      var elapsed = audio && audio.transport && audio.transport.started && !audio.transport.finished
        ? audio.transport.elapsed : Math.max(0, now - mapStartedAt[key]) / 1000;
      paintMap(canvas, Object.assign({}, scene, { draws: preview.drawsAt(elapsed) }));
    } else if (scene) { paintMap(canvas, scene); }
    var status = document.getElementById('mapruntime-' + key);
    if (status) {
      status.textContent = mapErrors[key] ? 'Static fallback: ' + mapErrors[key]
        : preview ? 'WASM preview · ' + preview.activeInstanceCount + ' animated · ' + preview.diagnostics.length + ' notes' 
        : USE_WASM_MAP ? 'Loading WASM preview…' : 'Static map';
      var sound = mapAudio[key];
      if (USE_WASM_MAP) status.textContent += sound
        ? sound.error ? ' · Audio failed: ' + sound.error : sound.loading ? ' · Loading samples…' : sound.transport.finished ? ' · Song finished' : ' · Original-sample audio'
        : ' · Audio off';
      status.title = preview ? preview.diagnostics.concat(scene.runtime.song ? scene.runtime.song.diagnostics : [], sound && sound.transport ? sound.transport.diagnostics : []).join('; ') : '';
    }
    var soundButton = document.querySelector('[data-map-sound="' + key + '"]');
    if (soundButton) {
      soundButton.disabled = !mapAudioFactory || !scene || !scene.runtime || !scene.runtime.song || !scene.runtime.song.events.length;
      soundButton.textContent = mapAudio[key] ? 'Stop audio' : 'Play original samples';
    }
  });
  Object.keys(mapAudio).forEach(function (key) { if (!active[key]) stopMapAudio(key); });
  // Drop heavyweight rigs and abort stale loads when navigating away. Clock
  // origins survive DOM refreshes but not leaving an island.
  if (USE_WASM_MAP) {
    Object.keys(mapPending).forEach(function (key) {
      if (!active[key]) { mapPending[key].abort(); delete mapPending[key]; }
    });
    Object.keys(islandScenes).forEach(function (key) {
      if (!active[key]) { delete islandScenes[key]; delete mapPreviews[key]; delete mapStartedAt[key]; delete mapErrors[key]; }
    });
  }
  if (!document.querySelector('canvas.map[data-map]') && mapAnimationFrame) {
    cancelAnimationFrame(mapAnimationFrame); mapAnimationFrame = 0;
  }
  scheduleMapFrame();
}

function requestIslandScene(island) {
  var key = island.userIslandId;
  if (islandScenes[key] || mapPending[key]) { paintMaps(); return; }
  var controller = new AbortController(), generation = mapGeneration;
  mapPending[key] = controller;
  var base = '/api/islands/' + encodeURIComponent(key);
  function getScene(suffix) {
    return fetch(base + suffix, { signal: controller.signal }).then(function (r) {
      if (!r.ok) throw new Error('scene load failed (' + r.status + ')');
      return r.json();
    });
  }
  getScene(USE_WASM_MAP ? '/runtime' : '/view')
    .catch(function (error) {
      if (!USE_WASM_MAP || controller.signal.aborted) throw error;
      mapErrors[key] = error.message; return getScene('/view');
    })
    .then(async function (scene) {
      if (controller.signal.aborted || generation !== mapGeneration) return;
      if (!scene || !scene.viewBox) throw new Error('invalid scene payload');
      islandScenes[key] = scene;
      if (USE_WASM_MAP && !scene.runtime && !mapErrors[key]) mapErrors[key] = 'runtime metadata unavailable';
      if (USE_WASM_MAP && scene.runtime) {
        try {
          var module = await previewModule();
          mapAudioFactory = module.createSongPreview;
          var preview = await module.createAnimationPreview(scene);
          if (controller.signal.aborted || generation !== mapGeneration || islandScenes[key] !== scene) return;
          mapPreviews[key] = preview;
          if (mapStartedAt[key] === undefined) mapStartedAt[key] = mapHiddenAt === null ? performance.now() : mapHiddenAt;
        } catch (error) {
          if (!controller.signal.aborted && generation === mapGeneration) mapErrors[key] = error.message;
        }
      }
      paintMaps();
    })
    .catch(function (error) {
      if (!controller.signal.aborted && generation === mapGeneration) { mapErrors[key] = error.message; paintMaps(); }
    })
    .finally(function () { if (mapPending[key] === controller) delete mapPending[key]; });
}

function mapCard(island) {
  var placed = island.structures.filter(function (s) { return !s.inWarehouse; });
  var roaming = island.monsters.filter(function (m) { return !m.inHotel; });
  if (placed.length + roaming.length === 0) return '';
  var pick = mapPicked && mapPicked.island === island.userIslandId ? mapPicked : null;
  var pickText = pick
    ? 'Picked ' + pick.x + ', ' + pick.y + ' — filled into the place boxes below.'
    : 'Click a spot to fill the place boxes with those coordinates.';
  return '<div class="card"><div class="card-head"><h2>Island map</h2>' +
    '<span class="badge muted">' + plural(placed.length, 'structure') + ', ' + plural(roaming.length, 'monster') + '</span>' +
    '<a class="small" href="?renderer=' + (USE_WASM_MAP ? 'static' : 'wasm') + '#/island/' + encodeURIComponent(island.userIslandId) + '">' +
    (USE_WASM_MAP ? 'Use static map' : 'Try WASM preview') + '</a></div>' +
    '<canvas class="map" data-map="' + esc(island.userIslandId) + '" role="img" aria-label="Island layout map"></canvas>' +
    '<div class="map-foot"><span id="mappick-' + esc(island.userIslandId) + '" class="small">' + pickText + '</span>' +
    (USE_WASM_MAP ? '<button class="sm" data-map-sound="' + esc(island.userIslandId) + '" disabled title="Full MIDI arrangement; adaptive loops and singing animations are not synchronized yet">Play original samples</button>' : '') +
    '<span id="mapruntime-' + esc(island.userIslandId) + '" class="small dim">' + (USE_WASM_MAP ? 'Experimental WASM preview · Audio off' : 'Static map') + '</span></div></div>';
}

// ---------- rendering: store ----------

function storeCost(item) {
  var parts = [];
  if (item.costCoins) parts.push(fmtNum(item.costCoins) + ' coins');
  if (item.costEthCurrency) parts.push(item.costEthCurrency + ' shards');
  if (item.costDiamonds) parts.push(item.costDiamonds + ' diamonds');
  if (item.costKeys) parts.push(item.costKeys + ' keys');
  if (item.costRelics) parts.push(item.costRelics + ' relics');
  if (item.costStarpower) parts.push(item.costStarpower + ' starpower');
  if (item.costMedals) parts.push(item.costMedals + ' medals');
  return parts.length === 0 ? 'free' : parts.join(' or ');
}

/**
 * Limited-time rows (EntityStoreAvailability windows) carry their offer
 * end; a live countdown tells the player how long the item stays
 * buyable. Rows without a window render nothing.
 */
function offerMark(offerEndsMs) {
  if (!offerEndsMs) return '';
  return ' <span class="small dim">· offer ends in ' + fmtDur(Math.max(0, offerEndsMs - serverNow())) + '</span>';
}

/** Affordability is a hint; the server enforces it (and the wallet in the top bar). */
function storeCanAfford(item, player) {
  if (item.costCoins === 0 && item.costEthCurrency === 0 && item.costDiamonds === 0 &&
      item.costKeys === 0 && item.costRelics === 0 && item.costStarpower === 0 && item.costMedals === 0) return true;
  return (item.costCoins > 0 && player.coins >= item.costCoins) ||
    (item.costEthCurrency > 0 && player.etherealCurrency >= item.costEthCurrency) ||
    (item.costDiamonds > 0 && player.diamonds >= item.costDiamonds) ||
    (item.costKeys > 0 && player.keys >= item.costKeys) ||
    (item.costRelics > 0 && player.relics >= item.costRelics) ||
    (item.costStarpower > 0 && player.starpower >= item.costStarpower);
}

function storeRows(items, island) {
  var player = lastDoc.state.player || { coins: 0, diamonds: 0, etherealCurrency: 0 };
  return items.map(function (it) {
    var locked = !it.levelOk || !it.requirementsOk;
    var reason = !it.levelOk ? 'Unlocks at player level ' + it.level : 'Requires a structure you have not built';
    var afford = storeCanAfford(it, player);
    var search = (it.name + ' ' + it.structureType).toLowerCase();
    return '<tr data-search="' + esc(search) + '"><td><b>' + esc(it.name) + '</b>' + offerMark(it.offerEndsMs) +
      '<div class="nick">' + it.sizeX + 'x' + it.sizeY + ' · build ' + (it.buildTimeMs ? fmtDur(it.buildTimeMs) : 'instant') + '</div></td>' +
      '<td class="num">' + esc(storeCost(it)) + '</td>' +
      '<td class="small dim">' + (locked ? esc(reason) : afford ? 'available' : 'cannot afford yet') + '</td></tr>';
  }).join('');
}

/**
 * Market monsters arrive as eggs in the island nursery. On Amber Island
 * (type 22) every purchase is a vessel instead: an inactive statue the
 * player fills with zapped eggs.
 */
function monsterRows(monsters, island) {
  var player = lastDoc.state.player || { coins: 0, diamonds: 0, etherealCurrency: 0, keys: 0, relics: 0, starpower: 0 };
  var vessels = island.islandTypeId === 22;
  var nursery = island.structures.find(function (s) { return s.isNursery && !s.isUpgrading && !s.inWarehouse; });
  var nurseryBusy = island.eggs.length > 0;
  return monsters.map(function (m) {
    var afford = storeCanAfford(m, player);
    var hint = !m.levelOk
      ? 'Unlocks at player level ' + m.level
      : !vessels && !nursery
        ? 'This island has no free nursery'
        : !vessels && nurseryBusy
          ? 'The nursery already holds an egg'
          : !afford
            ? 'You cannot afford this yet'
            : '';
    var search = m.name.toLowerCase();
    return '<tr data-search="' + esc(search) + '"><td>' + miniPortrait(m.monsterId) + '<b>' + esc(m.name) + '</b>' +
      (m.limited ? ' <span class="small dim">· limited time</span>' : '') +
      offerMark(m.offerEndsMs) +
      '<div class="nick">' +
      (vessels
        ? 'a vessel · fill it with zapped eggs · ' + plural(m.beds, 'bed')
        : 'hatches in ' + (m.buildTimeMs ? fmtDur(m.buildTimeMs) : 'instant') + ' · ' + plural(m.beds, 'bed')) +
      '</div></td>' +
      '<td class="num">' + esc(storeCost(m)) + '</td>' +
      '<td class="small dim">' + esc(hint || 'available') + '</td></tr>';
  }).join('');
}

/** The in-game market as this island sees it: structures, decorations and monsters. */
function storeCard(island) {
  var store = island.store;
  if (!store || (store.items.length === 0 && store.monsters.length === 0)) return '';
  var id = esc(island.userIslandId);
  var structures = store.items.filter(function (it) { return !it.isDecoration; });
  var decorations = store.items.filter(function (it) { return it.isDecoration; });
  var makeSection = function (key, title, rowsHtml, count, filterId, open) {
    return '<details class="section" data-sec="store-' + id + '-' + key + '"' + (open ? ' open' : '') + '>' +
      '<summary><b>' + title + '</b> (' + count + ')</summary>' +
      '<input type="search" class="store-filter" id="' + filterId + '" placeholder="Filter..." aria-label="Filter ' + esc(title) + '">' +
      '<div class="table-wrap"><table><tbody>' + rowsHtml + '</tbody></table></div>' +
      '<p class="empty" hidden>No match.</p></details>';
  };
  var total = store.items.length + store.monsters.length;
  return '<div class="card"><div class="card-head"><h2>Store</h2>' +
    '<span class="badge muted">' + plural(total, 'item') + '</span></div>' +
    makeSection('str', 'Structures', storeRows(structures, island), structures.length, 'ssf-' + id, true) +
    makeSection('mon', 'Monsters', monsterRows(store.monsters, island), store.monsters.length, 'msf-' + id, false) +
    makeSection('dec', 'Decorations', storeRows(decorations, island), decorations.length, 'dsf-' + id, false) +
    '</div>';
}

/** Everything placed on the island. */
function structuresCard(island) {
  var placed = island.structures.filter(function (s) { return !s.inWarehouse; });
  if (placed.length === 0) return '';
  var rows = placed.map(function (s) {
    return '<div class="item"><div class="item-main"><b>' + esc(s.name) + '</b>' +
      '<span class="small dim">at ' + s.posX + ', ' + s.posY + (s.isUpgrading ? ' · upgrading' : '') + '</span></div>' +
      '</div>';
  }).join('');
  return '<div class="card"><div class="card-head"><h2>Placed structures</h2><span class="badge muted">' +
    plural(placed.length, 'structure') + '</span></div>' + rows + '</div>';
}

function minesCard(island) {
  var list = mines(island);
  if (list.length === 0) return '';
  var readyNow = list.some(function (m) { return m.mineReady; });
  return '<div class="card"><div class="card-head"><h2>Mines</h2>' +
    (readyNow ? '<span class="badge">ready to collect</span>' : '') + '</div>' +
    list.map(function (m) {
      var status = m.mineReady
        ? '<span class="badge">Ready</span>'
        // Fill deadline in server-epoch ms; tick() flips the countdown to
        // "ready" on its own even without a re-render. The window is the
        // mine's own (12h regular Mine, 23h Mini Mine).
        : '<span class="dim small">fills in</span>' + countdown(serverNow() - m.sinceLastCollectionMs + m.mineFillMs);
      return '<div class="item"><div class="item-main"><b>' + esc(m.name) + '</b>' +
        (m.sinceLastCollectionMs === null ? '' : '<span class="small dim">collected ' + since(serverNow() - m.sinceLastCollectionMs) + ' ago</span>') +
        '</div><div class="item-side">' + status + '</div></div>';
    }).join('') + '</div>';
}

function renderIsland(island) {
  var count = collectable(island).length;
  var ready = readyCount(island);
  return '<div class="stack">' +
    '<div><div class="crumbs"><a href="#/overview">Overview</a> / ' + GROUP_LABELS[island.group] + '</div>' +
      '<div class="page-head"><h1>' + esc(island.name) + '</h1>' +
      (ready ? '<span class="badge">' + ready + ' ready</span>' : '') +
      '<span class="dim small">' + plural(count, 'monster') + ' with coins to collect</span></div>' +
      '<p class="dim">' + plural(island.monsters.length, 'monster') + ', ' + plural(island.breeding.length, 'breeding') + ', ' +
        plural(island.eggs.length, 'egg') + (island.baking.length ? ', ' + plural(island.baking.length, 'baking') : '') + (island.likes ? ', ' + plural(island.likes, 'like') : '') + '</p></div>' +
    '<div class="grid2">' + breedingCard(island) + nurseryCard(island) + '</div>' +
    mirrorCard(island) +
    minesCard(island) +
    bakeryCard(island) +
    mapCard(island) +
    storeCard(island) +
    structuresCard(island) +
    monstersCard(island) +
  '</div>';
}

/**
 * The server never echoes the island's current mirror mode back in
 * gs_player — the game client tracks it locally, and so do we (Major is
 * the game's default until the first flip).
 */
function paironormalMode(island) {
  return localStorage.getItem('paironormal-mode-' + island.userIslandId) === '1' ? 1 : 0;
}

/**
 * Paironormal Island only: the island's mirror flips every pair between
 * its Major and Minor forms. The badge shows the locally tracked mode.
 */
function mirrorCard(island) {
  if (!island.isPaironormal) return '';
  var mode = paironormalMode(island);
  return '<div class="card"><div class="card-head"><h2>Mirror</h2><span class="badge' + (mode === 1 ? ' warn' : '') + '">showing ' + (mode === 1 ? 'Minor' : 'Major') + '</span></div>' +
    '<p class="dim">The server does not report the mirror mode; Major is the game default.</p>' +
    '</div>';
}

// ---------- rendering: page ----------

function renderView() {
  var root = document.getElementById('view');
  // Keep what the user typed or picked across background refreshes.
  var kept = Array.prototype.map.call(root.querySelectorAll('select[id], input[id]'), function (el) {
    return [el.id, el.value];
  });
  // Collapsible store sections keep their open/closed state too.
  var openSections = Array.prototype.map.call(root.querySelectorAll('details[data-sec]'), function (el) {
    return [el.getAttribute('data-sec'), el.open];
  });
  var focusId = document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : '';
  var island = currentView === 'overview' ? null : findIsland(currentView);
  if (currentView !== 'overview' && !island) { currentView = 'overview'; }
  root.innerHTML = !lastDoc.state.player ? '<p class="dim">Not logged in yet. The dashboard will connect automatically.</p>'
    : island ? renderIsland(island) : renderOverview();
  kept.forEach(function (pair) {
    var el = document.getElementById(pair[0]);
    if (!el || el.type === 'hidden') return;
    var valid = el.tagName !== 'SELECT' || Array.prototype.some.call(el.options, function (o) { return o.value === pair[1]; });
    if (valid) { el.value = pair[1]; }
  });
  openSections.forEach(function (pair) {
    var el = root.querySelector('details[data-sec="' + pair[0] + '"]');
    if (el) { el.open = pair[1]; }
  });
  var focusEl = focusId ? document.getElementById(focusId) : null;
  if (focusEl) { focusEl.focus(); }
  root.querySelectorAll('.monster-filter, .store-filter').forEach(applyRowFilter);
  if (island) { requestIslandScene(island); }
  paintMaps();
}

/** Filter table rows by their data-search, scoped to the input's section. */
function applyRowFilter(input) {
  var q = input.value.trim().toLowerCase();
  // Store sections each have their own filter, so scope to the enclosing
  // details; the monster table's filter has no details ancestor, so it
  // falls back to the whole card.
  var scope = input.closest('details') || input.closest('.card');
  var shown = 0;
  scope.querySelectorAll('tbody tr').forEach(function (tr) {
    var match = q === '' || tr.getAttribute('data-search').indexOf(q) !== -1;
    tr.hidden = !match;
    shown += match ? 1 : 0;
  });
  var empty = scope.querySelector('.empty');
  if (empty) { empty.hidden = shown > 0; }
}

function signatureOf(doc) {
  // Times change every poll; ids, done flags and wallet values define
  // whether a structural re-render is needed.
  var ev = doc.state.events || { encore: null, clubboxes: [], timedEvents: [] };
  var eventsSig = JSON.stringify(ev.timedEvents.map(function (te) { return te.id + (te.active ? '!' : '.'); })) +
    (ev.encore ? ev.encore.name + ev.encore.rewardTrackId + ':' + (ev.encore.progress * 100 | 0) : '') +
    ev.clubboxes.map(function (cb) { return cb.actId + 'x' + cb.hype; }).join('') +
    (doc.state.player ? doc.state.player.clubboxTokens + ',' + doc.state.player.minigameTokens : '');
  // Sticker book: currency, owned stickers, pending packs and claimed
  // pages all change as packs are bought and opened.
  var ca = doc.state.cardAlbum;
  var cardSig = !ca ? '' : ca.albumId + ':' + ca.currency + ':' + ca.collectedCardIds.join(',') + ':' +
    ca.pages.map(function (p) { return p.collected + (p.rewardClaimed ? '!' : '.'); }).join('') +
    ':p' + (ca.pendingPacks || []).map(function (pk) { return pk.id; }).join(',');
  return JSON.stringify(doc.status) + JSON.stringify(doc.state.summary) +
    JSON.stringify(doc.state.player) + eventsSig + cardSig +
    doc.state.islands.map(function (i) {
      return i.userIslandId + ':' +
        i.eggs.map(function (e) { return e.userEggId + (e.done ? '!' : '.'); }).join('') + ':' +
        i.breeding.map(function (b) { return b.userBreedingId + (b.done ? '!' : '.'); }).join('') + ':' +
        i.baking.map(function (b) { return b.userBakingId + (b.done ? '!' : '.'); }).join('') + ':' +
        i.monsters.map(function (m) {
          return m.userMonsterId + (m.inHotel ? 'h' : '') + m.level +
            (m.boxNeeds ? 'z' + m.boxNeeds.map(function (n) { return n.monsterId + 'x' + n.count; }).join('') : '') +
            (m.modes ? 'p' + m.modes.map(function (o) { return o.monsterId + ':' + o.level + ':' + o.happiness + ':' + (o.active ? 'a' : '') + (o.inHotel ? 'h' : ''); }).join('') : '');
        }).join('');
    }).join('|') + doc.events.length;
}

function renderAll() {
  renderTop(lastDoc);
  renderNav();
  renderView();
  renderActivity(lastDoc);
}

function applyDoc(doc) {
  lastDoc = doc;
  monsterNames = null; // species may have changed (new statues, sold monsters)
  var sig = signatureOf(doc);
  // Layout can change without the headline signature moving (a structure
  // is moved, scaled or flipped), so track it separately and always check.
  var layout = doc.state.islands.map(function (i) {
    return i.userIslandId + ':' +
      i.structures.map(function (s) { return s.userStructureId + '@' + s.posX + ',' + s.posY + (s.inWarehouse ? 'w' : '') + s.scale + (s.flip ? 'f' : ''); }).join('') + ':' +
      i.monsters.map(function (m) { return m.userMonsterId + '@' + m.posX + ',' + m.posY + (m.inHotel ? 'h' : '') + m.scale + (m.flip ? 'f' : ''); }).join('') + ':' + islandSoundSignature(i);
  }).join('|');
  var layoutChanged = layout !== lastLayoutSig;
  if (sig === lastSignature && !layoutChanged) return;
  lastSignature = sig;
  if (layoutChanged) {
    Object.keys(mapAudio).forEach(function (key) {
      var island = doc.state.islands.find(function (i) { return i.userIslandId === key; });
      if (!island || mapAudio[key].model !== islandSoundSignature(island)) stopMapAudio(key);
    });
    lastLayoutSig = layout;
    mapGeneration += 1;
    Object.keys(mapPending).forEach(function (key) { mapPending[key].abort(); });
    mapPending = {};
    mapPreviews = {};
    mapErrors = {};
    islandScenes = {};
  }
  renderAll();
}

function readRoute() {
  var parts = location.hash.replace('#/', '').split('/');
  currentView = parts[0] === 'island' && parts[1] ? decodeURIComponent(parts[1]) : 'overview';
}

// ---------- controls ----------

var HANDLERS = {
  refresh: function () { poll(true); },
  toggleActivity: function () {
    var drawer = document.getElementById('activity');
    drawer.hidden = !drawer.hidden;
  },
};

document.addEventListener('click', function (ev) {
  var btn = ev.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  var handler = HANDLERS[btn.getAttribute('data-action')];
  if (handler) { handler(btn); }
});

document.addEventListener('click', function (ev) {
  var button = ev.target.closest('[data-map-sound]');
  if (button && !button.disabled) toggleMapAudio(button.getAttribute('data-map-sound'));
});

// Island map: click picks a grid cell (inverse of the iso transform) and
// highlights it on the map.
document.addEventListener('click', function (ev) {
  var canvas = ev.target.closest('canvas.map[data-map]');
  if (!canvas) return;
  var scene = islandScenes[canvas.getAttribute('data-map')];
  if (!scene) return;
  var rect = canvas.getBoundingClientRect();
  var sx = (ev.clientX - rect.left) / rect.width * scene.viewBox.w + scene.viewBox.x;
  var sy = (ev.clientY - rect.top) / rect.height * scene.viewBox.h + scene.viewBox.y;
  var tw = scene.tileW / 2, th = scene.tileH / 2;
  var x = Math.round((sx / tw - sy / th) / 2);
  var y = Math.round((sx / tw + sy / th) / 2);
  mapPicked = { island: canvas.getAttribute('data-map'), x: x, y: y };
  renderView();
});

window.addEventListener('resize', paintMaps);
document.addEventListener('visibilitychange', function () {
  if (document.hidden) {
    mapHiddenAt = performance.now();
    Object.keys(mapAudio).forEach(function (key) { if (mapAudio[key].transport) mapAudio[key].transport.suspend(); });
    if (mapAnimationFrame) cancelAnimationFrame(mapAnimationFrame);
    mapAnimationFrame = 0;
  } else {
    if (mapHiddenAt !== null) {
      var paused = performance.now() - mapHiddenAt;
      Object.keys(mapStartedAt).forEach(function (key) { mapStartedAt[key] += paused; });
    }
    Object.keys(mapAudio).forEach(function (key) { if (mapAudio[key].transport) mapAudio[key].transport.resume(); });
    mapHiddenAt = null; paintMaps();
  }
});
window.addEventListener('pagehide', function () {
  if (mapAnimationFrame) cancelAnimationFrame(mapAnimationFrame);
  mapAnimationFrame = 0;
  Object.keys(mapPending).forEach(function (key) { mapPending[key].abort(); });
  Object.keys(mapAudio).forEach(stopMapAudio);
  mapPending = {}; mapPreviews = {}; islandScenes = {};
});

document.addEventListener('input', function (ev) {
  if (ev.target.id === 'islandSearch') { applyIslandSearch(); return; }
  if (ev.target.classList.contains('monster-filter') || ev.target.classList.contains('store-filter')) { applyRowFilter(ev.target); }
});

document.addEventListener('keydown', function (ev) {
  if (ev.key === 'Escape') { document.getElementById('activity').hidden = true; }
  if (ev.key === 'Enter' && ev.target.id === 'islandSearch') {
    var first = document.querySelector('#islandNav .nav-section .nav-item:not([hidden])');
    if (first) { location.hash = first.getAttribute('href'); }
  }
});

window.addEventListener('hashchange', function () {
  readRoute();
  if (!lastDoc) return;
  renderNav();
  renderView();
  window.scrollTo(0, 0);
});

function tick() {
  if (!lastDoc) return;
  var now = serverNow();
  document.querySelectorAll('span.cd[data-deadline]').forEach(function (el) {
    var left = Number(el.getAttribute('data-deadline')) - now;
    el.textContent = left <= 0 ? 'ready' : fmtDur(left);
    el.className = 'cd ' + (left <= 0 ? 'ready' : 'waiting');
  });
  document.querySelectorAll('span.cd[data-since]').forEach(function (el) {
    el.textContent = fmtDur(now - Number(el.getAttribute('data-since')));
  });
  document.querySelectorAll('[data-ago]').forEach(function (el) {
    el.textContent = fmtDur(Date.now() - Number(el.getAttribute('data-ago')));
  });
}

readRoute();
poll(false);
// Portraits arrive after the first render; re-render once they land. A
// failure just means the monster table and nursery rows lose thumbnails.
fetch('/api/assets/manifest').then(function (r) { return r.json(); }).then(function (m) {
  ASSETS = { monsters: m.monsters || {}, structures: m.structures || {}, names: m.names || {} };
  renderView();
}).catch(function () {});
setInterval(function () { if (!document.hidden) { poll(false); } }, 10000);
setInterval(tick, 1000);
</script>
</body>
</html>
`;
