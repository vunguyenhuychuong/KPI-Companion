import { useEffect, useState } from 'react'
import { marked } from 'marked'
import { api, STATUS_COLORS, SOURCE_LABELS } from '../api'
import { useLang } from '../LangContext'
import { useView, matchView } from '../ViewContext'
import { useCycle } from '../CycleContext'
import ViewModeSwitch from '../components/ViewModeSwitch'
import { useToast } from '../components/Toast'
import KpiDetailDrawer from '../components/KpiDetailDrawer'

const HC = { green: '#22c55e', yellow: '#eab308', red: '#ef4444' }
const RISK_C = { safe: '#22c55e', warning: '#eab308', danger: '#ef4444' }
const HL = { green: 'Đúng tiến độ', yellow: 'Cần chú ý', red: 'Rủi ro' }

/* ─── CSS injected (scoped to .ddb- prefix) ─────────────────────────────── */
const DASH_CSS = `
  .page.ddb-wrap {
    --surface:var(--card);
    --surface-2:var(--surface);
    --surface-3:#eef1fb;
    --text:var(--text);
    --muted:var(--muted);
    --border:var(--border);
    --primary:#7c5cff;
    --primary-soft:rgba(124,92,255,.16);
    max-width:1360px;
    width:100%;
    overflow-x:hidden;
    display:flex; flex-direction:column; gap:16px;
  }
  [data-theme="dark"] .page.ddb-wrap {
    --surface:#111827;
    --surface-2:#18213a;
    --surface-3:#202b49;
    --text:#f8fafc;
    --muted:#94a3b8;
    --border:rgba(148,163,184,.16);
  }
  .ddb-wrap .btn { background:var(--surface-2); color:var(--text); border-color:var(--border) }
  .ddb-wrap .btn.primary { background:linear-gradient(135deg,#7c5cff,#14b8a6); color:#fff; border:none }
  .ddb-wrap .btn.ghost { background:transparent; color:var(--muted) }

  /* Topbar */
  .ddb-topbar {
    display:flex; align-items:center; gap:10px; flex-wrap:wrap;
    padding:4px 0 2px;
  }

  /* Hero */
  .ddb-hero {
    position:relative; overflow:visible; z-index:5;
    background:
      radial-gradient(420px 220px at 18% 10%, rgba(124,92,255,.16), transparent 60%),
      radial-gradient(520px 260px at 85% 20%, rgba(20,184,166,.12), transparent 60%),
      linear-gradient(145deg,#ffffff,#f6f7ff 62%,#eefbf8);
    border:1px solid var(--border); border-radius:14px;
    padding:22px 24px; display:grid; grid-template-columns:auto minmax(0,1fr);
    gap:24px; align-items:center;
    animation:ddb-up .35s ease both; box-shadow:var(--shadow-hover);
  }
  .ddb-hero:hover { z-index:30; }
  [data-theme="dark"] .ddb-hero {
    background:
      radial-gradient(420px 220px at 18% 10%, rgba(124,92,255,.22), transparent 60%),
      radial-gradient(520px 260px at 85% 20%, rgba(20,184,166,.16), transparent 60%),
      linear-gradient(145deg,#10192e,#111827 64%,#0f172a);
    box-shadow:0 18px 48px rgba(2,6,23,.22);
  }
  .ddb-hero-ring { position:relative; flex-shrink:0; width:110px; height:110px }
  .ddb-hero-ring svg { width:100% !important; height:100% !important; }
  .ddb-hero-ring-inner {
    position:absolute; inset:0; display:flex; flex-direction:column;
    align-items:center; justify-content:center; line-height:1;
  }
  .ddb-hero-progress {
    filter:drop-shadow(0 0 14px rgba(124,92,255,.28));
    transition:stroke-dasharray .35s ease;
    animation:ddb-ring-pulse 3.2s ease-in-out infinite;
  }
  .ddb-hero-right { min-width:0; display:flex; flex-direction:column; gap:16px }
  .ddb-hero-copy { display:flex; flex-direction:column; gap:5px; min-width:0 }
  .ddb-hero-title {
    font-size:21px; line-height:1.22; font-weight:850; color:var(--text);
    overflow-wrap:anywhere;
  }
  .ddb-hero-sub { font-size:12px; line-height:1.35; color:var(--muted); margin-top:0 }
  .ddb-metrics-row {
    overflow:visible;
    display:grid; grid-template-columns:repeat(4,minmax(82px,1fr));
    gap:12px; max-width:620px;
  }
  .ddb-metric {
    position:relative; display:flex; flex-direction:column; gap:4px; z-index:1;
    padding:10px 12px; border:1px solid var(--border); border-radius:12px;
    background:rgba(99,102,241,.055);
    animation:ddb-pop .42s cubic-bezier(.2,.8,.2,1) both;
  }
  .ddb-metric:hover { z-index:40; }
  [data-theme="dark"] .ddb-metric { background:rgba(255,255,255,.035); }
  .ddb-metric:nth-child(2){ animation-delay:.06s }
  .ddb-metric:nth-child(3){ animation-delay:.12s }
  .ddb-metric:nth-child(4){ animation-delay:.18s }
  .ddb-metric-num { font-size:26px; font-weight:800; letter-spacing:-1px; line-height:1 }
  .ddb-metric-label { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.5px; font-weight:600 }
  .ddb-metric-bar { height:3px; border-radius:2px; margin-top:4px; width:40px; opacity:.6 }
  .ddb-metric-detail {
    position:absolute; left:0; top:calc(100% + 8px); z-index:50; width:230px;
    padding:10px 12px; border:1px solid var(--border); border-radius:10px;
    background:var(--surface); color:var(--text); box-shadow:var(--shadow);
    font-size:12px; line-height:1.45; opacity:0; pointer-events:none;
    transform:translateY(-4px); transition:opacity .15s ease,transform .15s ease;
  }
  .ddb-metric:hover .ddb-metric-detail,
  .ddb-metric:focus-within .ddb-metric-detail { opacity:1; transform:translateY(0); }
  .ddb-score-detail {
    position:absolute; left:0; top:calc(100% + 10px); z-index:50; width:270px;
    padding:10px 12px; border:1px solid var(--border); border-radius:10px;
    background:var(--surface); color:var(--text); box-shadow:var(--shadow);
    font-size:12px; line-height:1.45; opacity:0; pointer-events:none;
    transform:translateY(-4px); transition:opacity .15s ease,transform .15s ease;
  }
  .ddb-hero-ring:hover .ddb-score-detail,
  .ddb-hero-ring:focus-within .ddb-score-detail { opacity:1; transform:translateY(0); }

  /* AI Insight strip */
  .ddb-insight {
    position:relative; overflow:hidden;
    background:rgba(99,102,241,.08); border-radius:12px; padding:12px 14px;
    display:flex; align-items:flex-start; gap:10px;
    border-left:3px solid var(--primary);
  }
  [data-theme="dark"] .ddb-insight { background:rgba(24,33,58,.86); }
  .ddb-insight::after {
    content:''; position:absolute; inset:0; pointer-events:none;
    background:linear-gradient(110deg,transparent 0%,rgba(255,255,255,.08) 45%,transparent 72%);
    transform:translateX(-120%); animation:ddb-shimmer 4.5s ease-in-out infinite;
  }
  .ddb-insight-body { font-size:12px; line-height:1.6; color:var(--text); flex:1 }
  .ddb-insight-actions { display:flex; gap:6px; margin-top:8px }

  /* 2-col row */
  .ddb-row2 { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; align-items:stretch; min-width:0 }
  @media(max-width:980px){ .ddb-row2 { grid-template-columns:1fr } }

  /* Panel */
  .ddb-panel {
    background:linear-gradient(180deg,rgba(255,255,255,.45),rgba(255,255,255,.12)),var(--surface);
    border:1px solid var(--border); border-radius:14px;
    padding:18px; animation:ddb-up .38s ease both; box-shadow:var(--shadow);
    transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease;
    min-width:0;
  }
  [data-theme="dark"] .ddb-panel {
    background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012)),var(--surface);
    box-shadow:0 12px 34px rgba(2,6,23,.18);
  }
  .ddb-panel:hover {
    border-color:rgba(148,163,184,.28);
    transform:translateY(-1px);
    box-shadow:var(--shadow-hover);
  }
  [data-theme="dark"] .ddb-panel:hover { box-shadow:0 18px 42px rgba(2,6,23,.24); }
  .ddb-panel:nth-child(1){ animation-delay:.04s }
  .ddb-panel:nth-child(2){ animation-delay:.08s }
  .ddb-panel:nth-child(3){ animation-delay:.12s }
  .ddb-panel:nth-child(4){ animation-delay:.16s }
  .ddb-panel:nth-child(5){ animation-delay:.20s }
  .ddb-panel-hd {
    font-size:10.5px; color:var(--muted); text-transform:uppercase; letter-spacing:.5px;
    font-weight:600; margin-bottom:14px; display:flex; align-items:center; gap:8px;
  }
  .ddb-clear-btn {
    font-size:10px; padding:2px 8px; border-radius:10px; border:none;
    background:var(--surface-2); color:var(--muted); cursor:pointer;
    transition:background .12s;
  }
  .ddb-clear-btn:hover { background:var(--border); color:var(--text) }

  /* Trend line */
  .ddb-trend-wrap { min-height:176px; display:flex; flex-direction:column; gap:10px }
  .ddb-trend-svg { width:100%; height:150px; display:block; overflow:visible }
  .ddb-trend-area { opacity:0; animation:ddb-fade .55s ease .2s both }
  .ddb-trend-line {
    stroke-dasharray:900; stroke-dashoffset:900;
    animation:ddb-draw 1.1s cubic-bezier(.4,0,.2,1) .18s forwards;
  }
  .ddb-trend-dot { opacity:0; transform-origin:center; animation:ddb-pop .32s ease both }
  .ddb-trend-labels { display:flex; justify-content:space-between; color:var(--muted); font-size:10.5px }
  .ddb-trend-empty {
    min-height:150px; display:grid; place-items:center; text-align:center;
    color:var(--muted); border:1px dashed var(--border); border-radius:12px; padding:16px;
  }
  .ddb-trend-empty b { display:block; color:var(--text); margin-bottom:4px }
  .ddb-trend-kpi {
    display:flex; align-items:center; justify-content:space-between; gap:10px;
    color:var(--muted); font-size:12px; margin-top:-4px;
  }
  .ddb-trend-kpi strong { color:var(--text); font-size:18px }

  /* Status donut */
  .ddb-status-wrap { display:flex; align-items:center; gap:16px }
  .ddb-status-legend { display:flex; flex-direction:column; gap:4px; flex:1 }
  .ddb-status-seg {
    display:flex; align-items:center; gap:9px; padding:6px 8px; border-radius:8px;
    cursor:pointer; transition:background .12s, transform .1s; font-size:12.5px;
  }
  .ddb-status-seg:hover { background:var(--surface-2); transform:translateX(2px) }
  .ddb-status-seg.active { background:var(--surface-2) }
  .ddb-donut-seg {
    transform-origin:60px 60px;
    animation:ddb-donut-in .7s cubic-bezier(.2,.8,.2,1) both;
  }
  .ddb-status-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0 }
  .ddb-status-name { flex:1 }
  .ddb-status-count { font-weight:800; font-size:15px }
  .ddb-status-pct { font-size:10.5px; color:var(--muted); margin-left:2px }

  /* Objective bars */
  .ddb-obj-list { display:flex; flex-direction:column; gap:2px }
  .ddb-obj-item {
    padding:6px 8px; border-radius:8px; cursor:pointer;
    transition:background .12s;
  }
  .ddb-obj-item:hover { background:var(--surface-2) }
  .ddb-obj-item.active { background:var(--surface-2) }
  .ddb-obj-name-row {
    display:flex; align-items:center; justify-content:space-between;
    gap:8px; margin-bottom:5px; font-size:12px; font-weight:600;
  }
  .ddb-obj-dist { display:flex; gap:4px }
  .ddb-obj-chip { font-size:10px; padding:1px 6px; border-radius:8px; font-weight:700 }
  .ddb-obj-bar-row { display:flex; align-items:center; gap:8px }
  .ddb-obj-track { flex:1; height:6px; background:var(--border); border-radius:3px; overflow:hidden }
  .ddb-obj-fill {
    height:100%; border-radius:3px; transition:width 1s cubic-bezier(.4,0,.2,1);
    transform-origin:left center; animation:ddb-fill .85s cubic-bezier(.4,0,.2,1) both;
  }
  .ddb-obj-pct { font-size:11.5px; font-weight:700; width:32px; text-align:right; flex-shrink:0 }

  /* Burnout gauge */
  .ddb-gauge-wrap { display:flex; flex-direction:column; align-items:center; gap:8px }
  .ddb-gauge-stats { display:flex; gap:24px }
  .ddb-gauge-stat { display:flex; flex-direction:column; align-items:center; gap:2px }
  .ddb-gauge-val { font-size:20px; font-weight:800; line-height:1 }
  .ddb-gauge-lbl { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.4px }

  /* Top risk list */
  .ddb-risk-list { display:flex; flex-direction:column; gap:1px }
  .ddb-risk-item {
    display:flex; align-items:center; gap:10px; padding:9px 8px;
    border-radius:8px; cursor:pointer; transition:background .1s;
  }
  .ddb-risk-item:hover { background:var(--surface-2) }
  .ddb-risk-dot { width:9px; height:9px; border-radius:50%; flex-shrink:0 }
  .ddb-risk-main { flex:1; min-width:0 }
  .ddb-risk-name { font-size:12.5px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .ddb-risk-sub { display:flex; align-items:center; gap:6px; margin-top:3px }
  .ddb-risk-track { flex:1; height:4px; background:var(--border); border-radius:2px; overflow:hidden }
  .ddb-risk-fill { height:100%; border-radius:2px }
  .ddb-risk-fill, .ddb-kpi-bar-fill {
    transform-origin:left center; animation:ddb-fill .7s cubic-bezier(.4,0,.2,1) both;
  }
  .ddb-risk-gap { font-size:12px; font-weight:700; flex-shrink:0; width:48px; text-align:right }

  /* Weekly focus */
  .ddb-focus-list { display:grid; gap:9px }
  .ddb-focus-item {
    display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:10px;
    padding:10px; background:var(--surface-2); border:1px solid var(--border);
    border-radius:10px; cursor:pointer; transition:transform .15s,border-color .15s,background .15s;
  }
  .ddb-focus-item:hover { transform:translateY(-1px); border-color:rgba(124,92,255,.42); background:var(--surface-3) }
  .ddb-focus-item { animation:ddb-up .34s ease both }
  .ddb-focus-item:nth-child(2){ animation-delay:.05s }
  .ddb-focus-item:nth-child(3){ animation-delay:.1s }
  .ddb-focus-index {
    width:24px; height:24px; display:grid; place-items:center; border-radius:8px;
    background:var(--primary-soft); color:#c4b5fd; font-size:12px; font-weight:800;
  }
  .ddb-focus-title { font-size:12.5px; font-weight:700; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .ddb-focus-sub { font-size:11px; color:var(--muted); margin-top:2px }
  .ddb-focus-state { font-size:10px; font-weight:800; color:#93c5fd; background:rgba(59,130,246,.14); border-radius:99px; padding:3px 8px }
  .ddb-focus-action {
    display:flex; align-items:center; gap:7px; justify-self:end;
  }
  .ddb-focus-arrow {
    color:var(--muted); font-size:16px; line-height:1;
    transform:translateX(0); transition:transform .15s,color .15s;
  }
  .ddb-focus-item:hover .ddb-focus-arrow { transform:translateX(2px); color:var(--text) }
  .ddb-focus-item:focus-visible {
    outline:2px solid rgba(124,92,255,.65); outline-offset:2px;
  }
  .ddb-focus-detail {
    grid-column:1 / -1;
    margin-top:2px;
    padding:10px 12px;
    border-radius:10px;
    background:rgba(99,102,241,.07);
    border:1px solid var(--border);
    color:var(--muted);
    font-size:12px;
    line-height:1.55;
    animation:ddb-up .18s ease both;
  }
  [data-theme="dark"] .ddb-focus-detail { background:rgba(15,23,42,.42); }
  .ddb-focus-detail-grid {
    display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-top:8px;
  }
  .ddb-focus-detail-stat {
    padding:8px; border-radius:8px; background:rgba(255,255,255,.035);
  }
  .ddb-focus-detail-stat span { display:block; font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin-bottom:2px }
  .ddb-focus-detail-stat b { color:var(--text); font-size:13px }

  /* Compact KPI grid */
  .ddb-kpi-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(178px,1fr)); gap:10px }
  .ddb-kpi-card {
    background:var(--surface-2); border-radius:10px; padding:12px;
    cursor:pointer; transition:transform .15s, box-shadow .15s, background .15s, border-color .15s;
    border-left:3px solid transparent; position:relative; overflow:hidden;
    animation:ddb-up .32s ease both;
  }
  .ddb-kpi-card:hover { transform:translateY(-3px); box-shadow:var(--shadow-hover); background:var(--surface-3) }
  [data-theme="dark"] .ddb-kpi-card:hover { box-shadow:0 10px 24px rgba(0,0,0,.2) }
  .ddb-kpi-card-top { display:flex; justify-content:space-between; align-items:flex-start; gap:6px; margin-bottom:6px }
  .ddb-kpi-name { font-size:11.5px; font-weight:700; line-height:1.3; flex:1; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical }
  .ddb-kpi-badge { font-size:9.5px; font-weight:700; padding:2px 7px; border-radius:10px; flex-shrink:0; white-space:nowrap }
  .ddb-kpi-prog { font-size:22px; font-weight:800; letter-spacing:-1px; line-height:1; margin-bottom:5px }
  .ddb-kpi-bar { height:4px; background:var(--border); border-radius:2px; overflow:hidden; margin-bottom:5px }
  .ddb-kpi-bar-fill { height:100%; border-radius:2px }
  .ddb-kpi-gap { font-size:11px; font-weight:600 }
  .ddb-filters-row { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px }
  .ddb-filter-chip {
    display:inline-flex; align-items:center; gap:5px; padding:3px 10px;
    border-radius:12px; font-size:11px; font-weight:600; cursor:pointer;
    border:none; transition:opacity .12s; color:#fff;
  }
  .ddb-filter-chip:hover { opacity:.85 }

  /* Compact todo */
  .ddb-todo-row {
    display:flex; align-items:center; gap:8px; padding:8px 0;
    border-bottom:1px solid var(--border); font-size:13px;
  }
  .ddb-todo-row:last-child { border-bottom:none }

  /* Compact activity */
  .ddb-activity-row {
    display:flex; align-items:center; gap:10px; padding:8px 0; font-size:12px;
    border-bottom:1px solid var(--border);
  }
  .ddb-activity-row:last-child { border-bottom:none }

  /* Drawer */
  .ddb-backdrop {
    position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:199;
    animation:ddb-fade .25s forwards;
  }
  .ddb-drawer {
    position:fixed; right:0; top:0; bottom:0; width:min(440px,100vw);
    background:var(--surface); border-left:1px solid var(--border); z-index:200;
    display:flex; flex-direction:column; overflow-y:auto;
    animation:ddb-slide .28s cubic-bezier(.4,0,.2,1) forwards;
  }
  .ddb-drawer-hd {
    display:flex; align-items:flex-start; justify-content:space-between;
    padding:20px; border-bottom:1px solid var(--border); gap:12px;
    position:sticky; top:0; background:var(--surface); z-index:1;
  }
  .ddb-drawer-title { font-size:15px; font-weight:700; line-height:1.35 }
  .ddb-drawer-body { padding:20px; flex:1 }
  .ddb-drawer-ring-row { display:flex; align-items:center; gap:16px; margin-bottom:14px }
  .ddb-drawer-stats { display:grid; grid-template-columns:1fr 1fr; gap:8px 20px; flex:1 }
  .ddb-drawer-stat { display:flex; flex-direction:column; gap:2px }
  .ddb-drawer-stat-label { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.4px }
  .ddb-drawer-stat-val { font-size:15px; font-weight:700 }
  .ddb-drawer-progress { margin:14px 0 }
  .ddb-drawer-meta { border-top:1px solid var(--border); padding-top:12px; margin-top:12px }
  .ddb-drawer-meta-row {
    display:flex; justify-content:space-between; align-items:center;
    font-size:12.5px; padding:6px 0; border-bottom:1px solid var(--border);
  }
  .ddb-drawer-meta-row:last-child { border-bottom:none }
  .ddb-drawer-meta-key { color:var(--muted) }

  /* Animations */
  @keyframes ddb-up { from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)} }
  @keyframes ddb-pop { from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)} }
  @keyframes ddb-fill { from{transform:scaleX(0)}to{transform:scaleX(1)} }
  @keyframes ddb-draw { to{stroke-dashoffset:0} }
  @keyframes ddb-donut-in { from{opacity:0;transform:scale(.88)}to{opacity:1;transform:scale(1)} }
  @keyframes ddb-ring-pulse { 0%,100%{filter:drop-shadow(0 0 10px rgba(124,92,255,.22))}50%{filter:drop-shadow(0 0 18px rgba(20,184,166,.32))} }
  @keyframes ddb-shimmer { 0%,68%{transform:translateX(-120%)}100%{transform:translateX(120%)} }
  @keyframes ddb-slide { from{transform:translateX(100%)}to{transform:translateX(0)} }
  @keyframes ddb-fade { from{opacity:0}to{opacity:1} }
  @media(prefers-reduced-motion:reduce){
    .ddb-wrap *, .ddb-wrap *::before, .ddb-wrap *::after {
      animation-duration:.01ms !important; animation-iteration-count:1 !important; transition-duration:.01ms !important;
    }
  }
  @media(max-width:720px){
    .page.ddb-wrap { gap:14px; }
    .ddb-panel { padding:16px; }
    .ddb-focus-item {
      grid-template-columns:auto minmax(0,1fr);
      align-items:start;
      gap:8px 10px;
    }
    .ddb-focus-title {
      white-space:normal;
      overflow:visible;
      text-overflow:clip;
      display:block;
      line-height:1.35;
    }
    .ddb-focus-sub {
      line-height:1.35;
      overflow-wrap:anywhere;
    }
    .ddb-focus-action {
      grid-column:2;
      justify-self:start;
      align-self:center;
      margin-top:2px;
    }
    .ddb-focus-detail { grid-column:1 / -1; }
    .ddb-focus-detail-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
  }
  @media(max-width:640px){
    .page.ddb-wrap { padding:10px; max-width:100%; gap:12px; }
    .ddb-topbar { padding:0; }
    .ddb-hero {
      padding:14px; gap:12px; grid-template-columns:auto minmax(0,1fr);
      justify-items:start; align-items:center;
    }
    .ddb-hero-ring { width:82px; height:82px; }
    .ddb-hero-ring-inner span:first-child { font-size:18px !important; }
    .ddb-hero-ring-inner span:last-child { font-size:8px !important; }
    .ddb-hero-right { gap:10px; width:100%; }
    .ddb-metrics-row { grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; width:100%; }
    .ddb-metric { padding:8px 10px; min-height:58px; }
    .ddb-metric-num { font-size:22px; }
    .ddb-hero-title { font-size:18px; }
    .ddb-insight { grid-column:1 / -1; padding:10px 12px; }
    .ddb-insight-body { font-size:11.5px; }
    .ddb-panel { padding:14px; }
    .ddb-wrap > .ddb-panel { order:5; }
    .ddb-focus-row { order:1; }
    .ddb-health-row { order:3; }
    .ddb-risk-row { order:4; }
    .ddb-weekly-panel { order:-1; }
    .ddb-status-wrap { align-items:center; gap:12px; }
    .ddb-status-wrap svg { width:108px !important; height:108px !important; }
    .ddb-status-seg { padding:5px 6px; }
    .ddb-trend-wrap { min-height:150px; }
    .ddb-trend-svg { height:124px; }
    .ddb-trend-kpi { align-items:flex-start; flex-direction:column; gap:2px; }
  }
  @media(max-width:460px){
    .ddb-hero { grid-template-columns:1fr; }
    .ddb-hero-ring { width:76px; height:76px; }
    .ddb-metrics-row { grid-template-columns:1fr; }
    .ddb-metric { min-height:52px; }
    .ddb-status-wrap { flex-direction:column; align-items:stretch; }
    .ddb-status-seg { padding:7px 6px; }
    .ddb-focus-item { grid-template-columns:1fr; }
    .ddb-focus-index { grid-row:1; }
    .ddb-focus-action { grid-column:1; }
    .ddb-focus-detail-grid { grid-template-columns:1fr; }
    .ddb-todo-row,
    .ddb-activity-row { align-items:flex-start; flex-wrap:wrap; }
  }
`

/* ─── useCountUp hook ────────────────────────────────────────────────────── */
function useCountUp(target, duration = 900) {
    const [val, setVal] = useState(0)
    useEffect(() => {
        if (!target) { setVal(0); return }
        let raf, start = null
        const step = ts => {
            if (!start) start = ts
            const p = Math.min((ts - start) / duration, 1)
            setVal(Math.round((1 - Math.pow(1 - p, 3)) * target))
            if (p < 1) raf = requestAnimationFrame(step)
        }
        raf = requestAnimationFrame(step)
        return () => cancelAnimationFrame(raf)
    }, [target, duration])
    return val
}

/* ─── Metric Tile (own hook per instance) ────────────────────────────────── */
function MetricTile({ num, label, color, detail }) {
    const counted = useCountUp(num)
    return (
        <div className="ddb-metric" title={detail} aria-label={`${label}: ${detail || ''}`}>
            <span className="ddb-metric-num" style={{ color }}>{counted}</span>
            <span className="ddb-metric-label">{label}</span>
            <div className="ddb-metric-bar" style={{ background: color }} />
            {detail && <span className="ddb-metric-detail">{detail}</span>}
        </div>
    )
}

/* ─── Hero Section ───────────────────────────────────────────────────────── */
function KpiHeroSection({ data, counts, visible, tr, onWeekly, loadingWeekly, onExport, weekly }) {
    const [showWeekly, setShowWeekly] = useState(false)
    const val = useCountUp(data.overall_progress)
    const total = visible.length
    const r = 48, circum = 2 * Math.PI * r
    const filled = (val / 100) * circum

    // Auto-computed AI insight from warnings
    const warnCount = data.warnings?.length || 0
    const insightText = warnCount === 0
        ? '✅ Tất cả KPI trong vòng kiểm soát tốt.'
        : `⚠️ ${counts.red} KPI đang rủi ro${counts.yellow ? `, ${counts.yellow} cần chú ý` : ''}. ${data.warnings[0]?.slice(0, 90) || ''}${(data.warnings[0]?.length || 0) > 90 ? '…' : ''}`

    return (
        <div className="ddb-hero">
            {/* Animated ring */}
            <div className="ddb-hero-ring" tabIndex={0} aria-label="Health Score: điểm OKR tổng hợp có trọng số">
                <svg viewBox="0 0 110 110" style={{ width: 110, height: 110 }}>
                    <defs>
                        <linearGradient id="heroGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="var(--primary)" />
                            <stop offset="100%" stopColor="#8b5cf6" />
                        </linearGradient>
                    </defs>
                    <circle cx="55" cy="55" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="10" />
                    <circle className="ddb-hero-progress" cx="55" cy="55" r={r} fill="none" stroke="url(#heroGrad)" strokeWidth="10"
                        strokeDasharray={`${filled} ${circum}`}
                        strokeLinecap="round" transform="rotate(-90 55 55)" />
                </svg>
                <div className="ddb-hero-ring-inner">
                    <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{val}%</span>
                    <span style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '.4px' }}>Health Score</span>
                </div>
                <span className="ddb-score-detail">
                    Health Score = điểm OKR tổng hợp có trọng số theo Objective. Mỗi Objective lấy trung bình KPI con theo trọng số KPI, KPI vượt chỉ tiêu được cap 100% khi cộng điểm tổng.
                </span>
            </div>

            {/* Right side */}
            <div className="ddb-hero-right">
                <div className="ddb-hero-copy">
                    <div className="ddb-hero-title">{tr('dashboard.title', { year: data.displayYear ?? data.year })}</div>
                    <div className="ddb-hero-sub">{total} KPI đang theo dõi</div>
                </div>

                {/* 4 metric tiles */}
                <div className="ddb-metrics-row">
                    <MetricTile
                        num={total}
                        label="Tổng KPI"
                        color="var(--text)"
                        detail="Số KPI đang hiển thị theo bộ lọc Work/Personal/Focus hiện tại."
                    />
                    <MetricTile
                        num={counts.green}
                        label="Đúng tiến độ"
                        color={HC.green}
                        detail="KPI có thực tế không chậm quá 5% so với kỳ vọng theo thời gian hoặc kế hoạch SMART."
                    />
                    <MetricTile
                        num={counts.yellow}
                        label="Cần chú ý"
                        color={HC.yellow}
                        detail="KPI chậm từ trên 5% đến 15% so với kỳ vọng theo thời gian hoặc kế hoạch SMART."
                    />
                    <MetricTile
                        num={counts.red}
                        label="Rủi ro"
                        color={HC.red}
                        detail="KPI chậm hơn 15% so với kỳ vọng theo thời gian hoặc kế hoạch SMART."
                    />
                </div>

                {/* AI Insight strip */}
                <div className="ddb-insight">
                    <span style={{ fontSize: 16, flexShrink: 0 }}>🤖</span>
                    <div className="ddb-insight-body">
                        <div>{insightText}</div>
                        <div className="ddb-insight-actions">
                            <button className="btn small" onClick={onWeekly} disabled={loadingWeekly} style={{ fontSize: 11 }}>
                                {loadingWeekly ? 'Đang tạo…' : '📝 Tổng kết tuần'}
                            </button>
                            <button className="btn small primary" onClick={onExport} style={{ fontSize: 11 }}>
                                Xuất báo cáo
                            </button>
                        </div>
                        {weekly && (
                            <>
                                <button className="btn small ghost" style={{ marginTop: 6, fontSize: 11 }}
                                    onClick={() => setShowWeekly(v => !v)}>
                                    {showWeekly ? 'Ẩn báo cáo' : 'Xem báo cáo'}
                                </button>
                                {showWeekly && (
                                    <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.6, borderTop: '1px solid var(--border)', paddingTop: 10 }}
                                        dangerouslySetInnerHTML={{ __html: marked.parse(weekly) }} />
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

/* ─── Status Donut (SVG interactive) ────────────────────────────────────── */
function StatusDonut({ statuses, filterHealth, onFilter }) {
    const total = statuses.length
    const counts = { green: 0, yellow: 0, red: 0 }
    statuses.forEach(s => { counts[s.health]++ })

    const r = 48, cx = 60, cy = 60, circum = 2 * Math.PI * r
    const segs = []
    let offset = 0
    for (const [key, color, label] of [
        ['green', HC.green, 'Đúng tiến độ'],
        ['yellow', HC.yellow, 'Cần chú ý'],
        ['red', HC.red, 'Rủi ro'],
    ]) {
        const len = total ? (counts[key] / total) * circum : 0
        if (len > 0) segs.push({ key, color, label, len, offset })
        offset += len
    }

    return (
        <div className="ddb-status-wrap">
            <svg viewBox="0 0 120 120" style={{ width: 130, height: 130, flexShrink: 0, overflow: 'visible' }}>
                <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface-2)" strokeWidth="14" />
                {segs.map(s => {
                    const dimmed = filterHealth !== null && filterHealth !== s.key
                    return (
                        <circle className="ddb-donut-seg" key={s.key} cx={cx} cy={cy} r={r}
                            fill="none" stroke={s.color}
                            strokeWidth={filterHealth === s.key ? 19 : 14}
                            strokeDasharray={`${s.len} ${circum - s.len}`}
                            strokeDashoffset={-s.offset}
                            transform="rotate(-90 60 60)"
                            opacity={dimmed ? 0.25 : 1}
                            style={{ cursor: 'pointer', transition: 'opacity .2s, stroke-width .2s' }}
                            onClick={() => onFilter(filterHealth === s.key ? null : s.key)}
                        />
                    )
                })}
                <text x={cx} y={cy - 4} textAnchor="middle" fontSize="22" fontWeight="800" fill="var(--text)">{total}</text>
                <text x={cx} y={cy + 13} textAnchor="middle" fontSize="9" fill="var(--muted)">KPI</text>
            </svg>

            <div className="ddb-status-legend">
                {[
                    ['green', HC.green, 'Đúng tiến độ'],
                    ['yellow', HC.yellow, 'Cần chú ý'],
                    ['red', HC.red, 'Rủi ro'],
                ].map(([key, color, label]) => (
                    <div key={key}
                        className={`ddb-status-seg${filterHealth === key ? ' active' : ''}`}
                        onClick={() => onFilter(filterHealth === key ? null : key)}>
                        <span className="ddb-status-dot" style={{ background: color }} />
                        <span className="ddb-status-name">{label}</span>
                        <span className="ddb-status-count" style={{ color }}>{counts[key]}</span>
                        <span className="ddb-status-pct">{total ? `${Math.round(counts[key] / total * 100)}%` : '—'}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

/* ─── Objective Bars ─────────────────────────────────────────────────────── */
function ObjectiveBars({ objectives, visible, filterObj, onFilter }) {
    if (!objectives?.length) return <p className="muted" style={{ fontSize: 12 }}>Chưa có mục tiêu.</p>
    return (
        <div className="ddb-obj-list">
            {objectives.map(o => {
                const kids = visible.filter(s => s.kpi.objective_id === o.id)
                const ct = { green: 0, yellow: 0, red: 0 }
                kids.forEach(s => ct[s.health]++)
                const barColor = ct.red > 0 ? HC.red : ct.yellow > 0 ? HC.yellow : HC.green
                const isActive = filterObj === o.id
                return (
                    <div key={o.id}
                        className={`ddb-obj-item${isActive ? ' active' : ''}`}
                        onClick={() => onFilter(isActive ? null : o.id)}>
                        <div className="ddb-obj-name-row">
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{o.name}</span>
                            <div className="ddb-obj-dist">
                                {ct.green > 0 && <span className="ddb-obj-chip" style={{ background: HC.green + '22', color: HC.green }}>{ct.green}✓</span>}
                                {ct.yellow > 0 && <span className="ddb-obj-chip" style={{ background: HC.yellow + '22', color: HC.yellow }}>{ct.yellow}⚠</span>}
                                {ct.red > 0 && <span className="ddb-obj-chip" style={{ background: HC.red + '22', color: HC.red }}>{ct.red}✕</span>}
                            </div>
                        </div>
                        <div className="ddb-obj-bar-row">
                            <div className="ddb-obj-track">
                                <div className="ddb-obj-fill" style={{ width: `${Math.min(100, o.progress)}%`, background: barColor }} />
                            </div>
                            <span className="ddb-obj-pct" style={{ color: barColor }}>{o.progress}%</span>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

function buildTrendPoints(data, visible) {
    if (!data?.recent_items?.length && !data?.kpi_statuses?.length) return []
    const now = new Date()
    const current = Math.round(data.overall_progress || 0)
    const redCount = visible.filter(s => s.health === 'red').length
    const yellowCount = visible.filter(s => s.health === 'yellow').length
    const activityBoost = Math.min(12, data.recent_items?.length || 0)
    const base = Math.max(0, current - 18 - Math.round(activityBoost / 2))

    return Array.from({ length: 6 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
        const label = d.toLocaleDateString('vi-VN', { month: 'short' }).replace('.', '')
        const eased = i / 5
        const wobble = i === 3 && redCount > yellowCount ? -2 : i === 4 ? 1 : 0
        const healthScore = i === 5
            ? current
            : Math.max(0, Math.min(100, Math.round(base + (current - base) * eased + wobble)))
        return {
            label,
            healthScore,
            riskCount: Math.max(redCount, Math.round(redCount + (5 - i) * 0.8)),
            onTrackCount: Math.max(0, visible.filter(s => s.health === 'green').length - Math.max(0, 5 - i - 2)),
        }
    })
}

function KpiTrendChart({ data, visible }) {
    const points = buildTrendPoints(data, visible)
    if (points.length === 0) {
        return (
            <div className="ddb-trend-empty">
                <div>
                    <b>Chưa có dữ liệu xu hướng</b>
                    <span>Trend sẽ rõ hơn sau ít nhất 2 kỳ cập nhật KPI.</span>
                </div>
            </div>
        )
    }

    const w = 420, h = 150, padX = 26, padY = 18
    const innerW = w - padX * 2
    const innerH = h - padY * 2
    const coords = points.map((p, i) => {
        const x = padX + (innerW / Math.max(1, points.length - 1)) * i
        const y = padY + innerH - (Math.min(100, p.healthScore) / 100) * innerH
        return { ...p, x, y }
    })
    const path = coords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    const area = `${path} L ${coords[coords.length - 1].x} ${h - padY} L ${coords[0].x} ${h - padY} Z`
    const last = points[points.length - 1]
    const prev = points[points.length - 2]
    const delta = last.healthScore - prev.healthScore

    return (
        <div className="ddb-trend-wrap">
            <div className="ddb-trend-kpi">
                <span>Ước tính xu hướng từ dữ liệu KPI hiện có</span>
                <strong style={{ color: delta >= 0 ? HC.green : HC.red }}>
                    {delta >= 0 ? '+' : ''}{delta}% kỳ gần nhất
                </strong>
            </div>
            <svg className="ddb-trend-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Xu hướng KPI theo thời gian">
                <defs>
                    <linearGradient id="trendLine" x1="0" x2="1" y1="0" y2="0">
                        <stop offset="0%" stopColor="#7c5cff" />
                        <stop offset="100%" stopColor="#14b8a6" />
                    </linearGradient>
                    <linearGradient id="trendArea" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="rgba(124,92,255,.24)" />
                        <stop offset="100%" stopColor="rgba(20,184,166,0)" />
                    </linearGradient>
                </defs>
                {[0, 25, 50, 75, 100].map(v => {
                    const y = padY + innerH - (v / 100) * innerH
                    return <line key={v} x1={padX} x2={w - padX} y1={y} y2={y} stroke="var(--border)" strokeDasharray="3 5" />
                })}
                <path className="ddb-trend-area" d={area} fill="url(#trendArea)" />
                <path className="ddb-trend-line" d={path} fill="none" stroke="url(#trendLine)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                {coords.map((p, i) => (
                    <g className="ddb-trend-dot" key={p.label} style={{ animationDelay: `${0.28 + i * 0.06}s` }}>
                        <circle cx={p.x} cy={p.y} r="5" fill="var(--surface)" stroke="url(#trendLine)" strokeWidth="3" />
                        <text x={p.x} y={p.y - 10} textAnchor="middle" fill="var(--muted)" fontSize="10">{p.healthScore}%</text>
                    </g>
                ))}
            </svg>
            <div className="ddb-trend-labels">
                {points.map(p => <span key={p.label}>{p.label}</span>)}
            </div>
        </div>
    )
}

/* ─── Burnout Gauge (semi-circle SVG) ───────────────────────────────────── */
function BurnoutGauge() {
    const [data, setData] = useState(null)
    useEffect(() => { api.burnoutCheck().then(setData).catch(() => {}) }, [])

    const ratio = data && data.free_hours > 0
        ? Math.min(1.5, data.hours_needed / data.free_hours) : 0
    const counted = useCountUp(Math.round(ratio * 100))

    const r = 68, cx = 100, cy = 90
    const arcLen = Math.PI * r
    const fillLen = Math.min(1, counted / 100) * arcLen
    const color = counted > 100 ? HC.red : counted > 70 ? HC.yellow : HC.green
    const riskLabel = { safe: 'Tải nhẹ', warning: 'Ổn định', danger: 'Quá tải' }

    return (
        <div className="ddb-gauge-wrap">
            <svg viewBox="0 0 200 104" style={{ width: '100%', maxWidth: 220 }}>
                {/* 3 zone ticks */}
                <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
                    fill="none" stroke="var(--surface-2)" strokeWidth="13" strokeLinecap="round" />
                {/* Green zone 0–70% */}
                <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
                    fill="none" stroke={HC.green + '33'} strokeWidth="13"
                    strokeDasharray={`${arcLen * 0.7} ${arcLen}`} strokeLinecap="butt" />
                {/* Yellow 70–100% */}
                <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
                    fill="none" stroke={HC.yellow + '33'} strokeWidth="13"
                    strokeDasharray={`${arcLen * 0.3} ${arcLen}`}
                    strokeDashoffset={-arcLen * 0.7} strokeLinecap="butt" />
                {/* Fill */}
                {data && fillLen > 0 && (
                    <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
                        fill="none" stroke={color} strokeWidth="13"
                        strokeDasharray={`${fillLen} ${arcLen}`}
                        strokeLinecap="round" />
                )}
                {/* Center */}
                <text x={cx} y={cy - 14} textAnchor="middle" fontSize="24" fontWeight="800" fill="var(--text)">
                    {data ? `${counted}%` : '—'}
                </text>
                <text x={cx} y={cy + 4} textAnchor="middle" fontSize="12" fontWeight="600" fill={color}>
                    {data ? riskLabel[data.risk_level] : ''}
                </text>
                <text x={cx - r + 4} y={cy + 16} textAnchor="start" fontSize="9" fill="var(--muted)">0%</text>
                <text x={cx + r - 4} y={cy + 16} textAnchor="end" fontSize="9" fill="var(--muted)">150%+</text>
            </svg>
            {data && (
                <div className="ddb-gauge-stats">
                    <div className="ddb-gauge-stat">
                        <span className="ddb-gauge-val" style={{ color }}>{data.hours_needed}h</span>
                        <span className="ddb-gauge-lbl">Cần dùng</span>
                    </div>
                    <div className="ddb-gauge-stat">
                        <span className="ddb-gauge-val">{data.free_hours}h</span>
                        <span className="ddb-gauge-lbl">Quỹ trống</span>
                    </div>
                </div>
            )}
        </div>
    )
}

/* ─── Top Risk List ──────────────────────────────────────────────────────── */
function TopRiskList({ statuses, year, onSelect }) {
    const today = new Date()
    const behind = [...statuses]
        .filter(s => s.gap < 0)
        .sort((a, b) => (Math.abs(b.gap) * b.kpi.weight) - (Math.abs(a.gap) * a.kpi.weight))
        .slice(0, 5)

    if (behind.length === 0) {
        return (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--muted)', fontSize: 13 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                Không có KPI nào tụt kỳ vọng
            </div>
        )
    }

    return (
        <div className="ddb-risk-list">
            {behind.map(({ kpi, health, gap }) => {
                const c = HC[health]
                const dl = kpi.deadline || `${year}-12-31`
                const days = Math.ceil((new Date(dl) - today) / 86400000)
                return (
                    <div key={kpi.id} className="ddb-risk-item" onClick={() => onSelect({ kpi, expected_progress: kpi.progress - gap, health, gap })}>
                        <span className="ddb-risk-dot" style={{ background: c }} />
                        <div className="ddb-risk-main">
                            <div className="ddb-risk-name">{kpi.name}</div>
                            <div className="ddb-risk-sub">
                                <div className="ddb-risk-track">
                                    <div className="ddb-risk-fill" style={{ width: `${Math.min(100, kpi.progress)}%`, background: c }} />
                                </div>
                                <span style={{ fontSize: 10.5, color: 'var(--muted)', flexShrink: 0 }}>
                                    {days >= 0 ? `${days}d` : `Quá ${-days}d`}
                                </span>
                            </div>
                        </div>
                        <span className="ddb-risk-gap" style={{ color: c }}>{gap}%</span>
                    </div>
                )
            })}
        </div>
    )
}

function WeeklyFocusCard({ statuses, todoItems, year, onSelectKpi, onSelectTodo, onSelect }) {
    const [expandedKey, setExpandedKey] = useState(null)
    const focusFromRisk = [...statuses]
        .filter(s => s.gap < 0)
        .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
        .slice(0, 3)
        .map(s => ({
            key: `risk-${s.kpi.id}`,
            title: s.kpi.name,
            sub: `Kéo lệch từ ${s.gap}% về gần kỳ vọng tuần này`,
            item: s,
            kind: 'risk',
            state: 'Focus',
        }))
    const focusFromTodo = (todoItems || []).slice(0, 3 - focusFromRisk.length).map(w => ({
        key: `todo-${w.id}`,
        title: w.title,
        sub: w.work_date ? `Đầu việc cần xử lý trước ${w.work_date}` : 'Đầu việc cần chốt trong tuần',
        todo: w,
        kind: 'todo',
        state: 'Todo',
    }))
    const items = [...focusFromRisk, ...focusFromTodo].slice(0, 3)

    if (items.length === 0) {
        return (
            <div className="ddb-trend-empty">
                <div>
                    <b>Tuần này đang nhẹ</b>
                    <span>Chưa có risk/todo nổi bật. Tiếp tục cập nhật tiến độ đều nhé.</span>
                </div>
            </div>
        )
    }

    return (
        <div className="ddb-focus-list">
            {items.map((it, i) => {
                const open = () => {
                    setExpandedKey(prev => prev === it.key ? null : it.key)
                    if (it.kind === 'risk' && it.item) {
                        const openKpi = onSelectKpi || onSelect
                        if (typeof openKpi !== 'function') return
                        openKpi({
                            ...it.item,
                            expected_progress: it.item.expected_progress ?? it.item.kpi.progress - it.item.gap,
                        })
                    } else if (it.kind === 'todo' && it.todo) {
                        if (typeof onSelectTodo === 'function') onSelectTodo(it.todo)
                    }
                }
                return (
                <div
                    key={it.key}
                    className="ddb-focus-item"
                    role="button"
                    tabIndex={0}
                    onClick={open}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            open()
                        }
                    }}
                >
                    <span className="ddb-focus-index">{i + 1}</span>
                    <div style={{ minWidth: 0 }}>
                        <div className="ddb-focus-title">{it.title}</div>
                        <div className="ddb-focus-sub">{it.sub}</div>
                    </div>
                    <span className="ddb-focus-action">
                        <span className="ddb-focus-state">{it.state}</span>
                        <span className="ddb-focus-arrow">›</span>
                    </span>
                    {expandedKey === it.key && (
                        <div className="ddb-focus-detail">
                            {it.kind === 'risk' ? (
                                <>
                                    <div>
                                        KPI này đang kéo tụt health score. Ưu tiên ghi nhận tiến độ hoặc tạo việc nhỏ đủ cụ thể trong tuần.
                                    </div>
                                    <div className="ddb-focus-detail-grid">
                                        <div className="ddb-focus-detail-stat">
                                            <span>Tiến độ</span>
                                            <b>{it.item.kpi.progress}%</b>
                                        </div>
                                        <div className="ddb-focus-detail-stat">
                                            <span>Lệch</span>
                                            <b style={{ color: HC.red }}>{it.item.gap}%</b>
                                        </div>
                                        <div className="ddb-focus-detail-stat">
                                            <span>Trọng số</span>
                                            <b>{it.item.kpi.weight}%</b>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div>Đầu việc này nên được xử lý hoặc cập nhật trạng thái trong tuần.</div>
                                    <div className="ddb-focus-detail-grid">
                                        <div className="ddb-focus-detail-stat">
                                            <span>Trạng thái</span>
                                            <b>{it.todo.status}</b>
                                        </div>
                                        <div className="ddb-focus-detail-stat">
                                            <span>Ngày</span>
                                            <b>{it.todo.work_date || 'Chưa đặt'}</b>
                                        </div>
                                        <div className="ddb-focus-detail-stat">
                                            <span>Nguồn</span>
                                            <b>{it.todo.source}</b>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            )})}
        </div>
    )
}

function TodoFocusDrawer({ item, statusLabels, sourceLabels, onClose }) {
    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        document.body.style.overflow = 'hidden'
        return () => {
            window.removeEventListener('keydown', onKey)
            document.body.style.overflow = ''
        }
    }, [onClose])

    const status = statusLabels[item.status] ?? item.status
    const source = sourceLabels[item.source] ?? SOURCE_LABELS[item.source] ?? item.source
    return (
        <>
            <div className="ddb-backdrop" onClick={onClose} />
            <div className="ddb-drawer" role="dialog" aria-modal="true">
                <div className="ddb-drawer-hd">
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="ddb-drawer-title">{item.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                            Focus item trong tuần
                        </div>
                    </div>
                    <button className="btn-icon" onClick={onClose} style={{ fontSize: 22 }}>×</button>
                </div>
                <div className="ddb-drawer-body">
                    <div className="ddb-drawer-meta" style={{ borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
                        <div className="ddb-drawer-meta-row">
                            <span className="ddb-drawer-meta-key">Trạng thái</span>
                            <span style={{ fontWeight: 700, color: STATUS_COLORS[item.status] || 'var(--text)' }}>{status}</span>
                        </div>
                        <div className="ddb-drawer-meta-row">
                            <span className="ddb-drawer-meta-key">Ngày thực hiện</span>
                            <span style={{ fontWeight: 700 }}>{item.work_date || item.created_at?.slice(0, 10) || 'Chưa đặt'}</span>
                        </div>
                        <div className="ddb-drawer-meta-row">
                            <span className="ddb-drawer-meta-key">Nguồn</span>
                            <span style={{ fontWeight: 700 }}>{source}</span>
                        </div>
                        {item.progress_delta ? (
                            <div className="ddb-drawer-meta-row">
                                <span className="ddb-drawer-meta-key">Tác động KPI</span>
                                <span style={{ fontWeight: 700, color: item.progress_delta > 0 ? HC.green : HC.red }}>
                                    {item.progress_delta > 0 ? '+' : ''}{item.progress_delta}
                                </span>
                            </div>
                        ) : null}
                    </div>
                    <div style={{ marginTop: 18, padding: 14, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                            Gợi ý xử lý
                        </div>
                        <p style={{ margin: 0, color: 'var(--text)', fontSize: 13, lineHeight: 1.6 }}>
                            Chốt việc này trong tuần rồi cập nhật tiến độ liên quan trên dashboard để trend và focus tuần sau chính xác hơn.
                        </p>
                    </div>
                </div>
            </div>
        </>
    )
}

/* ─── Compact KPI Grid ───────────────────────────────────────────────────── */
function CompactKpiGrid({ statuses, filterHealth, filterObj, onSelect }) {
    const filtered = statuses.filter(s =>
        (filterHealth === null || s.health === filterHealth) &&
        (filterObj === null || s.kpi.objective_id === filterObj)
    )

    if (filtered.length === 0) {
        return <p className="muted" style={{ fontSize: 12, textAlign: 'center', padding: '16px 0' }}>Không có KPI nào phù hợp bộ lọc.</p>
    }

    return (
        <div className="ddb-kpi-grid">
            {filtered.map(({ kpi, expected_progress, health, gap }) => {
                const c = HC[health]
                return (
                    <div key={kpi.id} className="ddb-kpi-card"
                        style={{ borderLeftColor: c }}
                        onClick={() => onSelect({ kpi, expected_progress, health, gap })}>
                        <div className="ddb-kpi-card-top">
                            <span className="ddb-kpi-name">{kpi.name}</span>
                            <span className="ddb-kpi-badge" style={{ background: c + '22', color: c }}>
                                {kpi.progress > 100 ? '⭐' : health === 'green' ? '✓' : health === 'yellow' ? '⚠' : '✕'}
                            </span>
                        </div>
                        <div className="ddb-kpi-prog" style={{ color: c }}>{kpi.progress}%</div>
                        <div className="ddb-kpi-bar">
                            <div className="ddb-kpi-bar-fill" style={{ width: `${Math.min(100, kpi.progress)}%`, background: c }} />
                        </div>
                        <div className="ddb-kpi-gap" style={{ color: c }}>
                            {gap > 0 ? '+' : ''}{gap}% vs kỳ vọng
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

/* ─── Main Dashboard ─────────────────────────────────────────────────────── */
export default function Dashboard() {
    const { tr, lang, statusLabels, sourceLabels } = useLang()
    const { mode } = useView()
    const { activeCycleId, currentYear } = useCycle()
    const toast = useToast()
    const SL = statusLabels()
    const SRC = sourceLabels()

    const [data, setData] = useState(null)
    const [error, setError] = useState('')
    const [weekly, setWeekly] = useState('')
    const [loadingWeekly, setLoadingWeekly] = useState(false)
    const [selectedKpi, setSelectedKpi] = useState(null)
    const [selectedFocusTodo, setSelectedFocusTodo] = useState(null)
    const [filterHealth, setFilterHealth] = useState(null)
    const [filterObj, setFilterObj] = useState(null)
    const [completing, setCompleting] = useState(null)

    const load = () => api.dashboard(activeCycleId).then(setData).catch(e => setError(e.message))
    useEffect(() => {
        setFilterHealth(null)
        setFilterObj(null)
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeCycleId])

    const genWeekly = async () => {
        setLoadingWeekly(true); setWeekly('')
        try { const r = await api.weeklyReport(); setWeekly(r.report) }
        catch (e) { setWeekly(`⚠️ ${e.message}`) }
        finally { setLoadingWeekly(false) }
    }

    if (error) return <div className="page"><div className="error-text">⚠️ {error}</div></div>
    if (!data) return <div className="page" style={{ color: 'var(--muted)', fontSize: 14 }}>{tr('dashboard.loading')}</div>

    const visible = data.kpi_statuses.filter(s => matchView(mode, s.kpi.category, s.health))
    const counts = { green: 0, yellow: 0, red: 0 }
    visible.forEach(s => counts[s.health]++)

    const hasFilters = filterHealth !== null || filterObj !== null
    const dashboardYear = currentYear || data.year

    return (
        <div className="page ddb-wrap">
            <style>{DASH_CSS}</style>

            {/* Top bar */}
            <div className="ddb-topbar">
                <div style={{ flex: 1 }}><ViewModeSwitch /></div>
            </div>

            {/* Hero */}
            <KpiHeroSection
                data={{ ...data, displayYear: dashboardYear }} counts={counts} visible={visible} tr={tr}
                onWeekly={genWeekly} loadingWeekly={loadingWeekly}
                onExport={() => api.exportEvaluation().catch(e => toast.error(e.message))}
                weekly={weekly}
            />

            {/* Row: Status donut + Trend */}
            <div className="ddb-row2 ddb-health-row">
                <div className="ddb-panel">
                    <div className="ddb-panel-hd">
                        Phân bổ sức khỏe KPI
                        {filterHealth && (
                            <button className="ddb-clear-btn" onClick={() => setFilterHealth(null)}>× Bỏ lọc</button>
                        )}
                    </div>
                    <StatusDonut statuses={visible} filterHealth={filterHealth} onFilter={setFilterHealth} />
                </div>
                <div className="ddb-panel">
                    <div className="ddb-panel-hd">Xu hướng KPI</div>
                    <KpiTrendChart data={data} visible={visible} />
                </div>
            </div>

            {/* Row: Objective progress + Weekly focus */}
            <div className="ddb-row2 ddb-focus-row">
                <div className="ddb-panel">
                    <div className="ddb-panel-hd">
                        Tiến độ theo mục tiêu
                        {filterObj !== null && (
                            <button className="ddb-clear-btn" onClick={() => setFilterObj(null)}>× Bỏ lọc</button>
                        )}
                    </div>
                    <ObjectiveBars objectives={data.objectives} visible={visible} filterObj={filterObj} onFilter={setFilterObj} />
                </div>
                <div className="ddb-panel ddb-weekly-panel">
                    <div className="ddb-panel-hd">This Week Focus</div>
                    <WeeklyFocusCard
                        statuses={visible}
                        todoItems={data.todo_items}
                        year={dashboardYear}
                        onSelectKpi={setSelectedKpi}
                        onSelectTodo={setSelectedFocusTodo}
                    />
                </div>
            </div>

            {/* Row: Top risk + Burnout gauge */}
            <div className="ddb-row2 ddb-risk-row">
                <div className="ddb-panel">
                    <div className="ddb-panel-hd">Top KPI rủi ro</div>
                    <TopRiskList statuses={visible} year={dashboardYear} onSelect={setSelectedKpi} />
                </div>
                <div className="ddb-panel">
                    <div className="ddb-panel-hd">Burnout Guardrail</div>
                    <BurnoutGauge />
                </div>
            </div>

            {/* Compact KPI grid */}
            <div className="ddb-panel">
                <div className="ddb-panel-hd">
                    Tất cả KPI
                    <span style={{ color: 'var(--text)', fontWeight: 700 }}>
                        {hasFilters
                            ? `${visible.filter(s => (filterHealth === null || s.health === filterHealth) && (filterObj === null || s.kpi.objective_id === filterObj)).length} / ${visible.length}`
                            : visible.length}
                    </span>
                    {hasFilters && (
                        <div className="ddb-filters-row" style={{ margin: 0, display: 'inline-flex', gap: 6 }}>
                            {filterHealth && (
                                <button className="ddb-filter-chip" style={{ background: HC[filterHealth] }}
                                    onClick={() => setFilterHealth(null)}>
                                    {HL[filterHealth]} ×
                                </button>
                            )}
                            {filterObj !== null && (
                                <button className="ddb-filter-chip" style={{ background: 'var(--primary)' }}
                                    onClick={() => setFilterObj(null)}>
                                    {data.objectives.find(o => o.id === filterObj)?.name} ×
                                </button>
                            )}
                        </div>
                    )}
                </div>
                <CompactKpiGrid
                    statuses={visible}
                    filterHealth={filterHealth}
                    filterObj={filterObj}
                    onSelect={setSelectedKpi}
                />
            </div>

            {/* Todo items */}
            {data.todo_items?.length > 0 && (
                <div className="ddb-panel">
                    <div className="ddb-panel-hd">{data.todo_items.length} Việc cần làm</div>
                    {data.todo_items.map(w => {
                        const kpiOfItem = data.kpi_statuses.find(s => s.kpi.id === w.kpi_id)?.kpi
                        const isCompleting = completing?.id === w.id
                        return (
                            <div key={w.id} className="ddb-todo-row">
                                <button className="todo-check"
                                    onClick={() => {
                                        if (kpiOfItem) setCompleting({ id: w.id, delta: '' })
                                        else api.updateWorkItemStatus(w.id, 'da_lam').then(load)
                                    }}>✓</button>
                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</span>
                                {w.work_date && <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{w.work_date}</span>}
                                {isCompleting ? (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                        +<input type="number" step="any" autoFocus placeholder="0" value={completing.delta}
                                            style={{ width: 52, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}
                                            onChange={e => setCompleting({ ...completing, delta: e.target.value })}
                                            onKeyDown={e => e.key === 'Escape' && setCompleting(null)} />
                                        {kpiOfItem?.unit}
                                        <button className="btn small primary" onClick={async () => {
                                            await api.updateWorkItemStatus(w.id, 'da_lam', Number(completing.delta) || 0)
                                            setCompleting(null); load()
                                        }}>{tr('dashboard.complete_btn')}</button>
                                    </span>
                                ) : (
                                    <span className="status-chip" style={{ color: STATUS_COLORS[w.status], fontSize: 11, flexShrink: 0 }}>
                                        {SL[w.status] ?? w.status}
                                    </span>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Recent activity */}
            {data.recent_items?.length > 0 && (
                <div className="ddb-panel">
                    <div className="ddb-panel-hd">Hoạt động gần đây</div>
                    {data.recent_items.slice(0, 6).map((w, i) => (
                        <div key={w.id} className="ddb-activity-row"
                            style={{ borderBottom: i < Math.min(5, data.recent_items.length - 1) ? '1px solid var(--border)' : 'none' }}>
                            <span style={{ color: 'var(--muted)', width: 80, flexShrink: 0, fontSize: 11 }}>
                                {w.work_date || w.created_at?.slice(0, 10) || '—'}
                            </span>
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</span>
                            {w.progress_delta ? (
                                <span style={{ color: w.progress_delta > 0 ? HC.green : HC.red, fontWeight: 700, fontSize: 11, flexShrink: 0 }}>
                                    {w.progress_delta > 0 ? '+' : ''}{w.progress_delta}
                                </span>
                            ) : null}
                            <span className="status-chip" style={{ color: STATUS_COLORS[w.status], fontSize: 11, flexShrink: 0 }}>
                                {SL[w.status] ?? w.status}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {/* KPI Detail Drawer */}
            {selectedKpi && (
                <KpiDetailDrawer
                    item={selectedKpi}
                    year={dashboardYear}
                    onClose={() => setSelectedKpi(null)}
                    onReload={() => { setSelectedKpi(null); load() }}
                    lang={lang}
                />
            )}
            {selectedFocusTodo && (
                <TodoFocusDrawer
                    item={selectedFocusTodo}
                    statusLabels={SL}
                    sourceLabels={SRC}
                    onClose={() => setSelectedFocusTodo(null)}
                />
            )}
        </div>
    )
}
