import { useCallback, useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import { api, STATUS_COLORS, SOURCE_LABELS } from '../api'
import { useLang } from '../LangContext'
import { useView, matchView } from '../ViewContext'
import { useCycle } from '../CycleContext'
import ViewModeSwitch from '../components/ViewModeSwitch'
import { useToast } from '../components/Toast'
import KpiDetailDrawer from '../components/KpiDetailDrawer'
import NumberStepper from '../components/NumberStepper'
import { UiIcon, cleanIconLabel } from '../components/UiIcon'

const HC = { green: '#22c55e', yellow: '#eab308', red: '#ef4444' }
const RISK_C = { safe: '#22c55e', warning: '#eab308', danger: '#ef4444' }
const healthLabels = (tr) => ({
    green: tr('dashboard.health_green'),
    yellow: tr('dashboard.health_yellow'),
    red: tr('dashboard.health_red'),
})

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
    position:relative;
    display:flex; flex-direction:column; gap:16px;
    animation:ddb-page-in .22s ease both;
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
      radial-gradient(420px 220px at 18% 10%, rgba(124,92,255,.075), transparent 62%),
      radial-gradient(520px 260px at 85% 20%, rgba(20,184,166,.065), transparent 64%),
      linear-gradient(180deg,rgba(255,255,255,.96),rgba(248,252,255,.88));
    border:1px solid var(--border); border-radius:14px;
    padding:22px 24px; display:grid; grid-template-columns:auto minmax(0,1fr);
    gap:24px; align-items:center;
    animation:ddb-up .35s ease both; box-shadow:var(--shadow-hover);
  }
  .ddb-hero:hover { z-index:30; }
  [data-theme="dark"] .ddb-hero {
    background:
      radial-gradient(420px 220px at 18% 10%, rgba(124,92,255,.10), transparent 62%),
      radial-gradient(520px 260px at 85% 20%, rgba(20,184,166,.08), transparent 66%),
      linear-gradient(180deg,#111827,#0f172a);
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
  .ddb-hero-title .ui-icon {
    width:26px; height:26px; padding:5px; box-sizing:content-box;
    border-radius:12px; color:#fff; background:linear-gradient(135deg,#7c5cff,#14b8a6);
    box-shadow:0 10px 24px rgba(20,184,166,.20),0 4px 14px rgba(124,92,255,.18);
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
    background:rgba(124,92,255,.045);
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
    background:rgba(124,92,255,.055); border-radius:12px; padding:12px 14px;
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
  .ddb-insight-icon {
    width:28px; height:28px; display:grid; place-items:center; flex-shrink:0;
    color:#e0f2fe; border-radius:9px; background:linear-gradient(135deg,rgba(124,92,255,.86),rgba(20,184,166,.72));
    box-shadow:0 6px 14px rgba(20,184,166,.12);
  }
  .ddb-insight-icon .ui-icon { width:16px; height:16px; stroke-width:2.1 }

  /* 2-col row */
  .ddb-row2 { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; align-items:stretch; min-width:0 }
  @media(max-width:980px){ .ddb-row2 { grid-template-columns:1fr } }

  /* Panel */
  .ddb-panel {
    position:relative; overflow:visible; z-index:1;
    background:linear-gradient(180deg,rgba(255,255,255,.28),rgba(255,255,255,.10)),var(--surface);
    border:1px solid var(--border); border-radius:14px;
    padding:18px; animation:ddb-up .38s ease both; box-shadow:var(--shadow);
    transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease;
    min-width:0;
  }
  .ddb-panel::before {
    content:''; position:absolute; inset:0; z-index:0; pointer-events:none;
    background:
      linear-gradient(90deg,transparent,rgba(255,255,255,.12),transparent);
    opacity:.50;
  }
  .ddb-panel > * { position:relative; z-index:1; }
  [data-theme="dark"] .ddb-panel {
    background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012)),var(--surface);
    box-shadow:0 12px 34px rgba(2,6,23,.18);
  }
  [data-theme="dark"] .ddb-panel::before {
    background:
      linear-gradient(90deg,transparent,rgba(255,255,255,.035),transparent);
  }
  .ddb-panel:hover {
    border-color:rgba(148,163,184,.28);
    transform:translateY(-1px);
    box-shadow:var(--shadow-hover);
    z-index:30;
  }
  .ddb-panel:focus-within { z-index:30; }
  [data-theme="dark"] .ddb-panel:hover { box-shadow:0 18px 42px rgba(2,6,23,.24); }
  .ddb-panel:nth-child(1){ animation-delay:.04s }
  .ddb-panel:nth-child(2){ animation-delay:.08s }
  .ddb-panel:nth-child(3){ animation-delay:.12s }
  .ddb-panel:nth-child(4){ animation-delay:.16s }
  .ddb-panel:nth-child(5){ animation-delay:.20s }
  .ddb-panel-hd {
    font-size:10.5px; color:var(--muted); text-transform:uppercase; letter-spacing:.5px;
    font-weight:700; margin-bottom:14px; display:flex; align-items:center; gap:8px;
    justify-content:space-between;
  }
  .ddb-panel-title {
    display:inline-flex; align-items:center; gap:8px; min-width:0;
  }
  .ddb-panel-title > .ui-icon {
    width:16px; height:16px; color:#e0f2fe; padding:4px; box-sizing:content-box;
    border-radius:9px; background:linear-gradient(135deg,rgba(124,92,255,.86),rgba(20,184,166,.72));
    box-shadow:0 6px 14px rgba(20,184,166,.10);
  }
  .ddb-panel-title-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ddb-info-tip {
    position:relative; display:inline-grid; place-items:center; width:20px; height:20px;
    border:1px solid var(--border); border-radius:999px; background:var(--surface-2);
    color:var(--muted); cursor:pointer; flex-shrink:0; line-height:0; align-self:center;
  }
  .ddb-info-tip > .ui-icon { width:12px; height:12px; stroke-width:2.15; display:block; }
  .ddb-info-tip:hover,
  .ddb-info-tip:focus-visible { color:var(--text); border-color:rgba(20,184,166,.55); outline:none; }
  .ddb-info-tooltip {
    position:absolute; left:50%; bottom:calc(100% + 9px); z-index:120; width:min(300px,72vw);
    transform:translate(-50%,4px); opacity:0; pointer-events:none;
    padding:11px 12px; border:1px solid var(--border); border-radius:10px;
    background:var(--surface); color:var(--text); box-shadow:var(--shadow-hover);
    text-transform:none; letter-spacing:0; font-size:12px; font-weight:500; line-height:1.5;
    white-space:normal; text-align:left; box-sizing:border-box;
    transition:opacity .15s ease,transform .15s ease;
  }
  .ddb-info-tip:hover .ddb-info-tooltip,
  .ddb-info-tip:focus-visible .ddb-info-tooltip { opacity:1; transform:translate(-50%,0); }
  [data-theme="dark"] .ddb-info-tooltip { background:#18213a; border-color:rgba(148,163,184,.24); }
  .ddb-panel-hd-actions { display:inline-flex; align-items:center; gap:8px; flex-shrink:0; }
  .ddb-panel-hd-actions .ddb-clear-btn { margin-left:0; }
  .ddb-panel-hd .ddb-filters-row { max-width:100%; min-width:0; }
  .ddb-panel-hd .ddb-filter-chip { max-width:220px; }
  .ddb-panel-hd .ddb-filter-chip span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ddb-panel-hd-count { color:var(--text); font-weight:800; font-size:12px; }
  @media(max-width:640px){
    .ddb-panel-hd { align-items:flex-start; flex-direction:column; }
    .ddb-panel-hd-actions { align-self:stretch; flex-wrap:wrap; }
    .ddb-info-tooltip { left:0; transform:translate(0,4px); }
    .ddb-info-tip:hover .ddb-info-tooltip,
    .ddb-info-tip:focus-visible .ddb-info-tooltip { transform:translate(0,0); }
  }
  .ddb-clear-btn {
    display:inline-flex; align-items:center; gap:4px;
    font-size:10px; padding:2px 8px; border-radius:10px; border:none;
    background:var(--surface-2); color:var(--muted); cursor:pointer;
    transition:background .12s;
  }
  .ddb-clear-btn .ui-icon { width:11px; height:11px }
  .ddb-clear-btn:hover { background:var(--border); color:var(--text) }

  /* Trend line */
  .ddb-trend-wrap { min-height:176px; display:flex; flex-direction:column; gap:10px }
  .ddb-trend-svg { width:100%; height:150px; display:block; overflow:visible }
  .ddb-trend-area { opacity:0; animation:ddb-fade .55s ease .2s both }
  .ddb-trend-line {
    stroke-dasharray:900; stroke-dashoffset:900;
    animation:ddb-draw 1.1s cubic-bezier(.4,0,.2,1) .18s forwards;
  }
  .ddb-trend-dot {
    opacity:0; transform-origin:center; animation:ddb-pop .32s ease both;
    cursor:pointer; outline:none;
  }
  .ddb-trend-hit { fill:transparent; pointer-events:all; }
  .ddb-trend-node {
    transition:transform .16s ease,stroke-width .16s ease,filter .16s ease;
    transform-box:fill-box; transform-origin:center;
  }
  .ddb-trend-dot:hover .ddb-trend-node,
  .ddb-trend-dot:focus-visible .ddb-trend-node,
  .ddb-trend-dot.active .ddb-trend-node {
    transform:scale(1.35);
    stroke-width:4;
    filter:drop-shadow(0 0 7px rgba(20,184,166,.58));
  }
  .ddb-trend-dot:focus-visible .ddb-trend-hit { stroke:rgba(147,197,253,.75); stroke-width:1.5; }
  .ddb-trend-labels { display:flex; justify-content:space-between; color:var(--muted); font-size:10.5px }
  .ddb-trend-detail {
    margin-top:-2px; padding:10px 12px; border:1px solid var(--border); border-radius:10px;
    background:rgba(124,92,255,.065); color:var(--muted); font-size:12px; line-height:1.45;
    animation:ddb-up .16s ease both;
  }
  [data-theme="dark"] .ddb-trend-detail { background:rgba(15,23,42,.42); }
  .ddb-trend-detail-top { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:4px; }
  .ddb-trend-detail-title { color:var(--text); font-weight:800; }
  .ddb-trend-detail-change { font-weight:800; white-space:nowrap; }
  .ddb-trend-detail p { margin:0; }
  .ddb-trend-detail-meta { display:flex; gap:10px; flex-wrap:wrap; margin-top:6px; font-size:11px; color:var(--muted); }
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
  .ddb-obj-chip { display:inline-flex; align-items:center; gap:3px; font-size:10px; padding:1px 6px; border-radius:8px; font-weight:700 }
  .ddb-obj-chip .ui-icon { width:10px; height:10px }
  .ddb-obj-bar-row { display:flex; align-items:center; gap:8px }
  .ddb-obj-track { flex:1; height:6px; background:var(--border); border-radius:3px; overflow:hidden }
  .ddb-obj-fill {
    height:100%; border-radius:3px; transition:width 1s cubic-bezier(.4,0,.2,1);
    transform-origin:left center; animation:ddb-fill .85s cubic-bezier(.4,0,.2,1) both;
  }
  .ddb-obj-pct { font-size:11.5px; font-weight:700; width:32px; text-align:right; flex-shrink:0 }

  /* Burnout meter */
  .ddb-gauge-wrap {
    --gauge-color:#eab308;
    min-height:196px; display:flex; flex-direction:column; justify-content:center; gap:16px;
    padding:6px 2px 2px;
  }
  .ddb-burnout-top { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; }
  .ddb-burnout-scorebox { display:flex; flex-direction:column; gap:4px; min-width:0; }
  .ddb-burnout-score { color:var(--text); font-size:44px; line-height:.95; font-weight:850; letter-spacing:0; }
  .ddb-burnout-caption {
    color:var(--muted); font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:0;
  }
  .ddb-burnout-status {
    display:inline-flex; align-items:center; gap:7px; flex-shrink:0;
    color:var(--gauge-color); font-size:12px; font-weight:850; line-height:1;
    padding:7px 10px; border-radius:999px;
    background:color-mix(in srgb,var(--gauge-color) 12%,transparent);
    border:1px solid color-mix(in srgb,var(--gauge-color) 28%,transparent);
  }
  .ddb-burnout-status::before { content:''; width:7px; height:7px; border-radius:50%; background:currentColor; }
  .ddb-burnout-meter { display:grid; gap:8px; }
  .ddb-burnout-track {
    position:relative; height:12px; overflow:hidden; border-radius:999px;
    background:linear-gradient(90deg,var(--track),color-mix(in srgb,var(--track) 80%,var(--surface-2)));
  }
  .ddb-burnout-fill {
    height:100%; width:0; border-radius:inherit;
    background:linear-gradient(90deg,#22c55e,var(--gauge-color));
    transition:width .55s cubic-bezier(.4,0,.2,1);
  }
  .ddb-burnout-marker {
    position:absolute; top:-3px; bottom:-3px; width:2px; border-radius:2px;
    background:color-mix(in srgb,var(--text) 42%,transparent);
  }
  .ddb-burnout-marker.warning { left:40%; }
  .ddb-burnout-marker.limit { left:66.666%; }
  .ddb-burnout-scale { display:grid; grid-template-columns:1fr 1fr 1fr; color:var(--muted); font-size:10px; font-weight:700; }
  .ddb-burnout-scale span:nth-child(2) { text-align:center; }
  .ddb-burnout-scale span:nth-child(3) { text-align:right; }
  .ddb-burnout-stats { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px; }
  .ddb-burnout-stat {
    display:flex; align-items:baseline; justify-content:space-between; gap:10px;
    padding-top:10px; border-top:1px solid var(--border); min-width:0;
  }
  .ddb-burnout-stat span {
    color:var(--muted); font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:0;
    white-space:nowrap;
  }
  .ddb-burnout-stat strong { color:var(--text); font-size:18px; line-height:1; font-weight:850; white-space:nowrap; }
  .ddb-burnout-stat.primary strong { color:var(--gauge-color); }

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
  .ddb-empty-icon {
    width:34px; height:34px; margin:0 auto 8px; display:grid; place-items:center;
    color:#16a34a;
  }
  .ddb-empty-icon .ui-icon { width:28px; height:28px }

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
    background:rgba(124,92,255,.055);
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
  .ddb-kpi-badge { display:inline-grid; place-items:center; font-size:9.5px; font-weight:700; padding:2px 7px; border-radius:10px; flex-shrink:0; white-space:nowrap }
  .ddb-kpi-badge .ui-icon { width:12px; height:12px }
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
  .ddb-filter-chip .ui-icon { width:11px; height:11px }
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

  /* Monthly + AI insight lens */
  .ddb-lens {
    display:flex; flex-direction:column; gap:14px;
  }
  .ddb-lens-top {
    display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;
    margin-bottom:2px;
  }
  .ddb-lens-copy {
    color:var(--muted); font-size:12px; line-height:1.45; max-width:720px;
  }
  .ddb-lens-tabs {
    display:inline-flex; gap:6px; padding:5px; border:1px solid var(--border);
    border-radius:10px; background:var(--surface-2); flex-wrap:wrap;
  }
  .ddb-lens-actions {
    display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap;
  }
  .ddb-ai-meta {
    color:var(--muted); font-size:11px; font-weight:700;
  }
  .ddb-ai-callout {
    border:1px solid var(--border); border-radius:10px; background:var(--surface-2);
    padding:14px; color:var(--muted); font-size:13px; line-height:1.55;
    display:flex; align-items:flex-start; gap:10px;
  }
  .ddb-ai-callout .ui-icon { width:17px; height:17px; color:#14b8a6; flex-shrink:0; margin-top:1px; }
  .ddb-ai-callout.error { color:#ef4444; border-color:rgba(239,68,68,.28); background:rgba(239,68,68,.07); }
  .ddb-ai-callout.error .ui-icon { color:#ef4444; }
  .ddb-ai-skeleton {
    position:relative; overflow:hidden; min-height:132px;
    border:1px solid var(--border); border-radius:10px; background:var(--surface-2);
  }
  .ddb-ai-skeleton::after {
    content:''; position:absolute; inset:0;
    background:linear-gradient(105deg,transparent 0%,rgba(255,255,255,.20) 45%,transparent 70%);
    transform:translateX(-120%); animation:ddb-shimmer 1.4s ease-in-out infinite;
  }
  [data-theme="dark"] .ddb-ai-skeleton::after { background:linear-gradient(105deg,transparent 0%,rgba(255,255,255,.055) 45%,transparent 70%); }
  .ddb-lens-tab {
    display:inline-flex; align-items:center; gap:6px; min-height:32px;
    border:1px solid transparent; border-radius:8px; background:transparent;
    color:var(--muted); cursor:pointer; padding:6px 10px;
    font-size:12px; font-weight:800; transition:background .15s,color .15s,border-color .15s;
  }
  .ddb-lens-tab .ui-icon { width:14px; height:14px; }
  .ddb-lens-tab:hover,
  .ddb-lens-tab.active { color:var(--text); background:var(--surface); border-color:var(--border); }
  .ddb-ai-grid {
    display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px;
  }
  .ddb-ai-card {
    --ai-color:#14b8a6;
    border:1px solid var(--border); border-radius:10px; background:var(--surface-2);
    padding:14px; min-height:132px; cursor:pointer; display:flex; flex-direction:column; gap:10px;
    animation:ddb-ai-flip .42s ease both;
    transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease;
  }
  .ddb-ai-card:nth-child(2){ animation-delay:.08s }
  .ddb-ai-card:nth-child(3){ animation-delay:.16s }
  .ddb-ai-card:hover {
    transform:translateY(-2px); border-color:color-mix(in srgb,var(--ai-color) 42%,var(--border));
    box-shadow:var(--shadow-hover);
  }
  .ddb-ai-card-label {
    display:flex; align-items:center; gap:7px; color:var(--muted);
    font-size:10.5px; font-weight:850; text-transform:uppercase; letter-spacing:0;
  }
  .ddb-ai-card-label .ui-icon { width:16px; height:16px; color:var(--ai-color); }
  .ddb-ai-card-text {
    color:var(--text); font-size:15px; line-height:1.42; font-weight:850; overflow-wrap:anywhere;
  }
  .ddb-ai-card-note { color:var(--muted); font-size:11.5px; line-height:1.45; margin-top:auto; }
  .ddb-lens-grid {
    display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr); gap:14px;
  }
  .ddb-lens-subpanel {
    min-width:0; border:1px solid var(--border); border-radius:10px;
    background:var(--surface-2); padding:14px;
  }
  .ddb-lens-subtitle {
    display:flex; align-items:center; gap:7px; color:var(--text);
    font-size:11px; font-weight:850; text-transform:uppercase; letter-spacing:0; margin-bottom:12px;
  }
  .ddb-lens-subtitle .ui-icon { width:15px; height:15px; color:#14b8a6; }
  .ddb-acc-list { display:flex; flex-direction:column; gap:8px; }
  .ddb-acc-item {
    border:1px solid var(--border); border-radius:9px; overflow:hidden; background:var(--surface);
  }
  .ddb-acc-btn {
    width:100%; display:flex; justify-content:space-between; align-items:center; gap:10px;
    padding:11px 12px; border:0; background:transparent; color:var(--text);
    cursor:pointer; text-align:left; font-size:12.5px; font-weight:850;
  }
  .ddb-acc-btn .ui-icon { width:15px; height:15px; color:var(--muted); flex-shrink:0; }
  .ddb-acc-body {
    color:var(--text); font-size:12.5px; line-height:1.65;
    padding:0 12px 12px; animation:ddb-fade .18s ease both;
  }
  .ddb-action-list { display:flex; flex-direction:column; gap:8px; }
  .ddb-action-item {
    display:flex; align-items:flex-start; gap:9px; padding:9px 10px;
    border:1px solid var(--border); border-radius:9px; background:var(--surface);
    color:var(--text); font-size:12.5px; line-height:1.45;
  }
  .ddb-action-item input { width:16px; height:16px; margin-top:2px; flex-shrink:0; }
  .ddb-month-grid {
    display:grid; grid-template-columns:minmax(260px,.9fr) minmax(0,1.1fr); gap:14px;
  }
  .ddb-radar-box {
    min-height:230px; display:grid; place-items:center;
  }
  .ddb-radar-svg { width:100%; max-width:360px; height:auto; overflow:visible; }
  .ddb-radar-poly {
    transform-origin:center; animation:ddb-radar-in .8s cubic-bezier(.2,.8,.2,1) both;
  }
  .ddb-month-table { display:flex; flex-direction:column; gap:6px; }
  .ddb-month-row {
    display:grid; grid-template-columns:minmax(0,1fr) 56px 56px 56px; gap:8px; align-items:center;
    padding:7px 0; border-bottom:1px solid var(--border); color:var(--muted); font-size:12px;
    border-top:0; border-left:0; border-right:0; background:transparent; width:100%; text-align:left; font:inherit;
  }
  .ddb-month-row.head {
    color:var(--muted); font-size:10px; font-weight:850; text-transform:uppercase; letter-spacing:0;
  }
  .ddb-month-row:not(.head) { cursor:pointer; border-radius:8px; padding-inline:6px; transition:background .12s; }
  .ddb-month-row:not(.head):hover { background:var(--surface); }
  .ddb-month-row strong {
    color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;
  }
  .ddb-week-bars { display:flex; flex-direction:column; gap:8px; }
  .ddb-week-bar-row {
    display:grid; grid-template-columns:54px minmax(0,1fr) 46px; align-items:center; gap:10px;
    color:var(--muted); font-size:12px;
  }
  .ddb-week-bar-track {
    height:11px; border-radius:999px; background:var(--surface);
    border:1px solid var(--border); overflow:hidden;
  }
  .ddb-week-bar-fill {
    height:100%; width:0; border-radius:inherit;
    background:linear-gradient(90deg,#7c5cff,#14b8a6);
    animation:ddb-week-grow .8s ease both;
  }
  .ddb-winconcern {
    display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px;
  }
  .ddb-mini-list { display:flex; flex-direction:column; gap:7px; }
  .ddb-mini-item {
    display:flex; align-items:flex-start; gap:8px;
    padding:8px 9px; border:1px solid var(--border); border-radius:9px;
    background:var(--surface); color:var(--text); font-size:12px; line-height:1.45;
    animation:ddb-pop .28s ease both;
  }
  .ddb-mini-dot {
    width:8px; height:8px; border-radius:999px; background:var(--dot-color);
    margin-top:5px; flex-shrink:0;
  }

  /* Drawer */
  .ddb-backdrop {
    position:fixed; left:0; right:0; top:var(--header-h); bottom:0;
    background:rgba(2,6,23,.50); z-index:80;
    backdrop-filter:blur(2px); -webkit-backdrop-filter:blur(2px);
    animation:ddb-fade .25s forwards;
  }
  .ddb-drawer {
    position:fixed; right:0; top:var(--header-h); bottom:0; width:min(460px,100vw);
    max-height:calc(100dvh - var(--header-h));
    background:
      linear-gradient(180deg,rgba(255,255,255,.84),rgba(255,255,255,.96)),
      var(--surface);
    border-left:1px solid var(--border); z-index:90;
    display:flex; flex-direction:column; overflow:hidden;
    box-shadow:-26px 0 70px rgba(15,23,42,.20);
    animation:ddb-slide .28s cubic-bezier(.4,0,.2,1) forwards;
  }
  [data-theme="dark"] .ddb-drawer {
    background:
      linear-gradient(180deg,rgba(24,31,56,.94),rgba(15,23,42,.98)),
      var(--surface);
    box-shadow:-28px 0 82px rgba(0,0,0,.38);
  }
  .ddb-drawer-hd {
    display:flex; align-items:flex-start; justify-content:space-between;
    padding:20px; border-bottom:1px solid var(--border); gap:12px;
    position:relative; flex:0 0 auto;
    background:
      linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.03)),
      var(--surface);
    z-index:1;
  }
  [data-theme="dark"] .ddb-drawer-hd {
    background:
      linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.018)),
      #111827;
  }
  .ddb-drawer-title { font-size:15px; font-weight:700; line-height:1.35 }
  .ddb-drawer-body {
    padding:20px; flex:1; min-height:0; overflow-y:auto;
    overscroll-behavior:contain; scrollbar-gutter:stable;
  }
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
  @keyframes ddb-page-in { from{opacity:0}to{opacity:1} }
  @keyframes ddb-pop { from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)} }
  @keyframes ddb-fill { from{transform:scaleX(0)}to{transform:scaleX(1)} }
  @keyframes ddb-draw { to{stroke-dashoffset:0} }
  @keyframes ddb-donut-in { from{opacity:0;transform:scale(.88)}to{opacity:1;transform:scale(1)} }
  @keyframes ddb-ring-pulse { 0%,100%{filter:drop-shadow(0 0 10px rgba(124,92,255,.22))}50%{filter:drop-shadow(0 0 18px rgba(20,184,166,.32))} }
  @keyframes ddb-shimmer { 0%,68%{transform:translateX(-120%)}100%{transform:translateX(120%)} }
  @keyframes ddb-slide { from{transform:translateX(100%)}to{transform:translateX(0)} }
  @keyframes ddb-sheet { from{transform:translateY(100%)}to{transform:translateY(0)} }
  @keyframes ddb-fade { from{opacity:0}to{opacity:1} }
  @keyframes ddb-ai-flip { from{opacity:0;transform:rotateY(-14deg) translateY(8px)}to{opacity:1;transform:rotateY(0) translateY(0)} }
  @keyframes ddb-radar-in { from{opacity:0;transform:scale(.18)}to{opacity:1;transform:scale(1)} }
  @keyframes ddb-week-grow { from{width:0}to{width:var(--bar-width)} }
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
    .ddb-backdrop { top:0; }
    .ddb-drawer {
      top:auto; left:0; right:0; bottom:0; width:100vw;
      max-height:min(92dvh,720px); border-left:none; border-top:1px solid var(--border);
      border-radius:16px 16px 0 0;
      animation:ddb-sheet .28s cubic-bezier(.4,0,.2,1) forwards;
    }
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
    .ddb-ai-grid,
    .ddb-lens-grid,
    .ddb-month-grid,
    .ddb-winconcern { grid-template-columns:1fr; }
    .ddb-month-row { grid-template-columns:minmax(0,1fr) 48px 48px 48px; }
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
        <div className="ddb-metric" tabIndex={0} aria-label={`${label}: ${detail || ''}`}>
            <span className="ddb-metric-num" style={{ color }}>{counted}</span>
            <span className="ddb-metric-label">{label}</span>
            <div className="ddb-metric-bar" style={{ background: color }} />
            {detail && <span className="ddb-metric-detail">{detail}</span>}
        </div>
    )
}

function InfoTip({ text, tr }) {
    if (!text) return null
    return (
        <span className="ddb-info-tip" tabIndex={0} aria-label={`${tr('dashboard.info_label')}: ${text}`}>
            <UiIcon name="info" />
            <span className="ddb-info-tooltip">{text}</span>
        </span>
    )
}

function PanelHeader({ icon, label, tip, tr, children }) {
    return (
        <div className="ddb-panel-hd">
            <span className="ddb-panel-title">
                <UiIcon name={icon} />
                <span className="ddb-panel-title-text">{label}</span>
                <InfoTip text={tip} tr={tr} />
            </span>
            {children && <span className="ddb-panel-hd-actions">{children}</span>}
        </div>
    )
}

function clampPct(value) {
    return Math.max(0, Math.min(100, Number(value) || 0))
}

function roundNum(value, digits = 0) {
    const m = 10 ** digits
    return Math.round((Number(value) || 0) * m) / m
}

function ddbCategoryOf(kpi) {
    if (kpi?.category === 'Personal') return 'Personal'
    if (kpi?.category === 'Work') return 'Work'
    return 'Other'
}

function ddbCategoryLabel(category, tr) {
    if (category === 'Work') return cleanIconLabel(tr('category.work'))
    if (category === 'Personal') return cleanIconLabel(tr('category.personal'))
    if (category === 'Focus') return tr('pulse.category_focus')
    return tr('pulse.category_other')
}

function weightedStatuses(statuses, field = 'progress') {
    const items = statuses || []
    if (!items.length) return 0
    const totalWeight = items.reduce((sum, s) => sum + (Number(s.kpi?.weight) || 0), 0)
    if (totalWeight > 0) {
        return roundNum(items.reduce((sum, s) => {
            const raw = field === 'expected' ? s.expected_progress : s.kpi?.progress
            return sum + clampPct(raw) * (Number(s.kpi?.weight) || 0)
        }, 0) / totalWeight, 1)
    }
    return roundNum(items.reduce((sum, s) => {
        const raw = field === 'expected' ? s.expected_progress : s.kpi?.progress
        return sum + clampPct(raw)
    }, 0) / items.length, 1)
}

function sparkSeries(score, weeklyActivity = [], seed = 'Work') {
    const recent = (weeklyActivity || []).slice(-6)
    const maxCount = Math.max(1, ...recent.map(w => Number(w.count) || 0))
    const seedShift = seed === 'Personal' ? 6 : seed === 'Focus' ? -8 : 0
    if (!recent.length) {
        return Array.from({ length: 6 }, (_, i) => clampPct(score - (5 - i) * 3 + seedShift / 4))
    }
    return recent.map((w, i) => {
        const activityLift = ((Number(w.count) || 0) / maxCount) * 10
        const timeLift = (i - (recent.length - 1)) * 2
        const lastBias = i === recent.length - 1 ? score : score - 8
        return roundNum(clampPct(lastBias + timeLift + activityLift + seedShift / 5), 1)
    })
}

function lensMetric(key, statuses, weeklyActivity, tr) {
    const score = weightedStatuses(statuses)
    const expected = weightedStatuses(statuses, 'expected')
    const series = sparkSeries(score, weeklyActivity, key)
    const prev = series.slice(-4, -1)
    const prevAvg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : score
    return {
        key,
        label: ddbCategoryLabel(key, tr),
        color: key === 'Work' ? '#2563eb' : key === 'Personal' ? '#0f766e' : '#d97706',
        score,
        expected,
        risk: statuses.filter(s => s.health !== 'green').length,
        count: statuses.length,
        delta: roundNum(score - prevAvg),
    }
}

function buildLensMetrics(visible, data, tr) {
    return [
        lensMetric('Work', visible.filter(s => ddbCategoryOf(s.kpi) === 'Work'), data.weekly_activity, tr),
        lensMetric('Personal', visible.filter(s => ddbCategoryOf(s.kpi) === 'Personal'), data.weekly_activity, tr),
        lensMetric('Focus', visible.filter(s => s.health !== 'green'), data.weekly_activity, tr),
    ]
}

function stableInsightPayload(data) {
    return JSON.stringify({
        year: data.year,
        overall_progress: data.overall_progress,
        objectives: (data.objectives || []).map(o => ({
            id: o.id,
            weight: o.weight,
            progress: o.progress,
            kpi_count: o.kpi_count,
        })),
        kpis: (data.kpi_statuses || []).map(s => ({
            id: s.kpi.id,
            category: s.kpi.category,
            objective_id: s.kpi.objective_id,
            weight: s.kpi.weight,
            progress: s.kpi.progress,
            current_value: s.kpi.current_value,
            target_value: s.kpi.target_value,
            expected_progress: s.expected_progress,
            health: s.health,
            gap: s.gap,
            deadline: s.kpi.deadline,
        })).sort((a, b) => a.id - b.id),
        recent: (data.recent_items || []).map(w => ({
            id: w.id,
            status: w.status,
            kpi_id: w.kpi_id,
            progress_delta: w.progress_delta,
            work_date: w.work_date,
            created_at: w.created_at,
        })),
        todos: (data.todo_items || []).map(w => ({
            id: w.id,
            status: w.status,
            kpi_id: w.kpi_id,
            work_date: w.work_date,
        })),
        weekly_activity: data.weekly_activity || [],
    })
}

function simpleHash(text) {
    let h = 2166136261
    for (let i = 0; i < text.length; i += 1) {
        h ^= text.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return (h >>> 0).toString(36)
}

function dashboardInsightSignature(data) {
    return simpleHash(stableInsightPayload(data))
}

function objectiveLensRows(data, visible) {
    const rows = (data.objectives || []).map(o => {
        const children = visible.filter(s => s.kpi.objective_id === o.id)
        const plan = weightedStatuses(children, 'expected')
        const actual = Number(o.progress) || weightedStatuses(children)
        return {
            id: o.id,
            name: o.name,
            plan: roundNum(plan),
            actual: roundNum(actual),
            delta: roundNum(actual - plan),
            color: actual >= plan ? HC.green : actual + 8 >= plan ? HC.yellow : HC.red,
        }
    })
    if (rows.length) return rows
    return ['Work', 'Personal'].map(cat => {
        const children = visible.filter(s => ddbCategoryOf(s.kpi) === cat)
        const plan = weightedStatuses(children, 'expected')
        const actual = weightedStatuses(children)
        return {
            id: cat,
            name: cat,
            plan: roundNum(plan),
            actual: roundNum(actual),
            delta: roundNum(actual - plan),
            color: actual >= plan ? HC.green : actual + 8 >= plan ? HC.yellow : HC.red,
        }
    }).filter(r => r.actual || r.plan)
}

function buildWeeklyLensBars(data) {
    const activity = (data.weekly_activity || []).slice(-5)
    const maxCount = Math.max(1, ...activity.map(w => Number(w.count) || 0))
    return activity.map((w, i) => {
        const base = Number(data.overall_progress) || 0
        const activityLift = ((Number(w.count) || 0) / maxCount) * 8
        const value = clampPct(base - (activity.length - 1 - i) * 3 + activityLift)
        return { label: w.label || `W${i + 1}`, value: roundNum(value) }
    })
}

function topLensWins(visible, tr) {
    return [...visible]
        .sort((a, b) => (b.gap - a.gap) || (b.kpi.progress - a.kpi.progress))
        .slice(0, 3)
        .map(s => tr('pulse.win_item', { name: s.kpi.name, value: `${s.gap >= 0 ? '+' : ''}${roundNum(s.gap)}` }))
}

function topLensConcerns(visible, tr) {
    return [...visible]
        .filter(s => s.gap < 0)
        .sort((a, b) => a.gap - b.gap)
        .slice(0, 3)
        .map(s => tr('pulse.concern_item', { name: s.kpi.name, value: Math.abs(roundNum(s.gap)) }))
}

function DashboardInsightLens({ data, visible, tr, onSelectKpi, onFilterObj, cycleId }) {
    const [lens, setLens] = useState('insight')
    const [open, setOpen] = useState('correlation')
    const [checked, setChecked] = useState({})
    const [aiInsight, setAiInsight] = useState(null)
    const [loadingInsight, setLoadingInsight] = useState(false)
    const [insightError, setInsightError] = useState('')
    const metrics = useMemo(() => buildLensMetrics(visible, data, tr), [visible, data, tr])
    const signature = useMemo(() => dashboardInsightSignature(data), [data])
    const cacheKey = useMemo(
        () => `kpi.dashboardInsight.v1:${cycleId ?? 'all'}:${signature}`,
        [cycleId, signature],
    )
    const rows = useMemo(() => objectiveLensRows(data, visible), [data, visible])
    const weeks = useMemo(() => buildWeeklyLensBars(data), [data])
    const wins = useMemo(() => topLensWins(visible, tr), [visible, tr])
    const concerns = useMemo(() => topLensConcerns(visible, tr), [visible, tr])
    const riskStatus = aiInsight?.risk_kpi_id
        ? visible.find(s => s.kpi.id === aiInsight.risk_kpi_id)
        : null
    const priorityStatus = aiInsight?.priority_kpi_id
        ? visible.find(s => s.kpi.id === aiInsight.priority_kpi_id)
        : null
    const sections = [
        ['correlation', tr('pulse.acc_correlation'), aiInsight?.correlation_insight || ''],
        ['forecast', tr('pulse.acc_forecast'), aiInsight?.forecast_next_period || ''],
        ['adjustment', tr('pulse.acc_adjustment'), aiInsight?.kpi_adjustment || ''],
    ]

    const loadAiInsight = useCallback(async (force = false) => {
        setInsightError('')
        if (!force) {
            try {
                const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null')
                if (cached?.data_signature) {
                    setAiInsight(cached)
                    return
                }
            } catch {
                // ignore cache parse errors
            }
        }
        setLoadingInsight(true)
        try {
            const result = await api.dashboardInsight(cycleId)
            setAiInsight(result)
            localStorage.setItem(cacheKey, JSON.stringify(result))
        } catch (e) {
            setInsightError(e.message)
            setAiInsight(null)
        } finally {
            setLoadingInsight(false)
        }
    }, [cacheKey, cycleId])

    useEffect(() => {
        setAiInsight(null)
        setChecked({})
        loadAiInsight(false)
    }, [loadAiInsight])

    const openKpi = (status) => {
        if (!status) return
        onSelectKpi({
            ...status,
            expected_progress: status.expected_progress ?? status.kpi.progress - status.gap,
        })
    }

    return (
        <div className="ddb-panel ddb-lens">
            <div className="ddb-lens-top">
                <PanelHeader icon="bot" label={tr('pulse.insight_center_title')} tip={tr('pulse.subtitle')} tr={tr} />
                <div className="ddb-lens-actions">
                    {aiInsight?.generated_at && (
                        <span className="ddb-ai-meta">{tr('pulse.last_generated', { time: new Date(aiInsight.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</span>
                    )}
                    <button className="btn small" onClick={() => loadAiInsight(true)} disabled={loadingInsight}>
                        <UiIcon name="refresh" />{loadingInsight ? tr('pulse.ai_loading_short') : tr('pulse.regenerate')}
                    </button>
                    <div className="ddb-lens-tabs" role="tablist" aria-label={tr('pulse.tabs_label')}>
                        <button className={`ddb-lens-tab${lens === 'insight' ? ' active' : ''}`} onClick={() => setLens('insight')}>
                            <UiIcon name="sparkles" />{tr('pulse.tab_insight')}
                        </button>
                        <button className={`ddb-lens-tab${lens === 'monthly' ? ' active' : ''}`} onClick={() => setLens('monthly')}>
                            <UiIcon name="target" />{tr('pulse.tab_monthly')}
                        </button>
                    </div>
                </div>
            </div>
            <div className="ddb-lens-copy">
                {lens === 'insight'
                    ? (loadingInsight
                        ? tr('pulse.ai_loading')
                        : aiInsight?.top_priority || tr('pulse.ai_waiting'))
                    : (concerns.length
                        ? tr('pulse.month_analysis_risk', { win: wins[0] || tr('pulse.no_win'), concern: concerns[0] })
                        : tr('pulse.month_analysis_ok', { win: wins[0] || tr('pulse.no_win') }))}
            </div>

            {lens === 'insight' ? (
                <>
                    {loadingInsight && !aiInsight && (
                        <div className="ddb-ai-grid">
                            <div className="ddb-ai-skeleton" />
                            <div className="ddb-ai-skeleton" />
                            <div className="ddb-ai-skeleton" />
                        </div>
                    )}
                    {insightError && (
                        <div className="ddb-ai-callout error">
                            <UiIcon name="warning" />
                            <span>{tr('pulse.ai_error', { message: insightError })}</span>
                        </div>
                    )}
                    {aiInsight && (
                        <div className="ddb-ai-grid">
                            <button className="ddb-ai-card" style={{ '--ai-color': HC.green }} onClick={() => setLens('monthly')}>
                                <span className="ddb-ai-card-label"><UiIcon name="sparkles" />{tr('pulse.strength')}</span>
                                <span className="ddb-ai-card-text">{aiInsight.top_strength}</span>
                                <span className="ddb-ai-card-note">{tr('pulse.open_weekly')}</span>
                            </button>
                            <button className="ddb-ai-card" style={{ '--ai-color': HC.red }} onClick={() => openKpi(riskStatus)}>
                                <span className="ddb-ai-card-label"><UiIcon name="warning" />{tr('pulse.risk')}</span>
                                <span className="ddb-ai-card-text">{aiInsight.top_risk}</span>
                                <span className="ddb-ai-card-note">{riskStatus ? tr('pulse.detail') : tr('pulse.no_data')}</span>
                            </button>
                            <button className="ddb-ai-card" style={{ '--ai-color': HC.yellow }} onClick={() => openKpi(priorityStatus)}>
                                <span className="ddb-ai-card-label"><UiIcon name="compass" />{tr('pulse.priority')}</span>
                                <span className="ddb-ai-card-text">{aiInsight.top_priority}</span>
                                <span className="ddb-ai-card-note">{priorityStatus ? tr('pulse.ai_suggestion') : tr('pulse.no_data')}</span>
                            </button>
                        </div>
                    )}
                    {!loadingInsight && !insightError && !aiInsight && (
                        <div className="ddb-ai-callout">
                            <UiIcon name="bot" />
                            <span>{tr('pulse.ai_waiting')}</span>
                        </div>
                    )}
                    <div className="ddb-lens-grid">
                        <div className="ddb-lens-subpanel">
                            <div className="ddb-lens-subtitle"><UiIcon name="list" />{tr('pulse.deep_analysis')}</div>
                            <div className="ddb-acc-list">
                                {sections.map(([key, label, body]) => (
                                    <div key={key} className="ddb-acc-item">
                                        <button className="ddb-acc-btn" onClick={() => setOpen(open === key ? '' : key)}>
                                            <span>{label}</span>
                                            <UiIcon name={open === key ? 'eyeOff' : 'eye'} />
                                        </button>
                                        {open === key && <div className="ddb-acc-body">{body || tr('pulse.ai_waiting')}</div>}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="ddb-lens-subpanel">
                            <div className="ddb-lens-subtitle"><UiIcon name="checkCircle" />{tr('pulse.suggested_actions')}</div>
                            <div className="ddb-action-list">
                                {(aiInsight?.suggested_actions?.length ? aiInsight.suggested_actions : [tr('pulse.ai_waiting')]).map((action, i) => (
                                    <label key={`${action}-${i}`} className="ddb-action-item">
                                        <input
                                            type="checkbox"
                                            disabled={!aiInsight}
                                            checked={!!checked[i]}
                                            onChange={e => setChecked(prev => ({ ...prev, [i]: e.target.checked }))}
                                        />
                                        <span>{action}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>
                </>
            ) : (
                <>
                    <div className="ddb-month-grid">
                        <div className="ddb-lens-subpanel">
                            <div className="ddb-lens-subtitle"><UiIcon name="target" />{tr('pulse.monthly_radar')}</div>
                            <MonthlyRadar rows={rows} tr={tr} />
                        </div>
                        <div className="ddb-lens-subpanel">
                            <div className="ddb-lens-subtitle"><UiIcon name="list" />{tr('pulse.completion_table')}</div>
                            <MonthlyCompletionRows rows={rows} tr={tr} onFilterObj={onFilterObj} />
                        </div>
                    </div>
                    <div className="ddb-lens-grid">
                        <div className="ddb-lens-subpanel">
                            <div className="ddb-lens-subtitle"><UiIcon name="chartDown" />{tr('pulse.weekly_breakdown')}</div>
                            <div className="ddb-week-bars">
                                {weeks.map((w, i) => (
                                    <div key={`${w.label}-${i}`} className="ddb-week-bar-row">
                                        <strong>{w.label}</strong>
                                        <span className="ddb-week-bar-track">
                                            <span className="ddb-week-bar-fill" style={{ '--bar-width': `${w.value}%` }} />
                                        </span>
                                        <span>{w.value}%</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="ddb-lens-subpanel">
                            <div className="ddb-lens-subtitle"><UiIcon name="sparkles" />{tr('pulse.wins_concerns')}</div>
                            <div className="ddb-winconcern">
                                <MiniLensList title={tr('pulse.wins')} items={wins} color={HC.green} empty={tr('pulse.no_win')} />
                                <MiniLensList title={tr('pulse.concerns')} items={concerns} color={HC.red} empty={tr('pulse.no_concern')} />
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}

function MonthlyRadar({ rows, tr }) {
    const axes = rows.length >= 3 ? rows.slice(0, 6) : rows
    if (axes.length < 3) {
        return <div className="ddb-trend-empty"><div><b>{tr('pulse.no_data')}</b></div></div>
    }
    const w = 280, h = 238, cx = 140, cy = 118, r = 78
    const ptsFor = scale => axes.map((row, i) => {
        const a = -Math.PI / 2 + i * Math.PI * 2 / axes.length
        return `${cx + Math.cos(a) * r * scale},${cy + Math.sin(a) * r * scale}`
    }).join(' ')
    const pts = axes.map((row, i) => {
        const a = -Math.PI / 2 + i * Math.PI * 2 / axes.length
        const scale = clampPct(row.actual) / 100
        return {
            ...row,
            x: cx + Math.cos(a) * r * scale,
            y: cy + Math.sin(a) * r * scale,
            lx: cx + Math.cos(a) * (r + 26),
            ly: cy + Math.sin(a) * (r + 26),
        }
    })
    return (
        <div className="ddb-radar-box">
            <svg className="ddb-radar-svg" viewBox={`0 0 ${w} ${h}`}>
                {[.25, .5, .75, 1].map(s => <polygon key={s} points={ptsFor(s)} fill="none" stroke="var(--border)" />)}
                {pts.map(p => <line key={`axis-${p.id}`} x1={cx} y1={cy} x2={p.lx} y2={p.ly} stroke="var(--border)" />)}
                <polygon className="ddb-radar-poly" points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="rgba(20,184,166,.18)" stroke="#14b8a6" strokeWidth="3" />
                {pts.map((p, i) => (
                    <g key={p.id}>
                        <circle cx={p.x} cy={p.y} r="4" fill="#14b8a6" style={{ animationDelay: `${i * .05}s` }} />
                        <text x={p.lx} y={p.ly} textAnchor={p.lx < cx ? 'end' : p.lx > cx ? 'start' : 'middle'} fontSize="10" fill="var(--muted)">
                            {String(p.name).slice(0, 16)}
                        </text>
                    </g>
                ))}
            </svg>
        </div>
    )
}

function MonthlyCompletionRows({ rows, tr, onFilterObj }) {
    if (!rows.length) return <div className="ddb-trend-empty"><div><b>{tr('pulse.no_data')}</b></div></div>
    return (
        <div className="ddb-month-table">
            <div className="ddb-month-row head">
                <span>{tr('pulse.table_category')}</span>
                <span>{tr('pulse.table_plan')}</span>
                <span>{tr('pulse.table_actual')}</span>
                <span>{tr('pulse.table_delta')}</span>
            </div>
            {rows.map(row => (
                <button
                    key={row.id}
                    className="ddb-month-row"
                    onClick={() => typeof row.id === 'number' && onFilterObj(row.id)}
                    type="button"
                >
                    <strong>{row.name}</strong>
                    <span>{row.plan}%</span>
                    <span>{row.actual}%</span>
                    <span style={{ color: row.color, fontWeight: 850 }}>{row.delta >= 0 ? '+' : ''}{row.delta}%</span>
                </button>
            ))}
        </div>
    )
}

function MiniLensList({ title, items, color, empty }) {
    const list = items.length ? items : [empty]
    return (
        <div className="ddb-mini-list">
            <div className="ddb-lens-subtitle" style={{ marginBottom: 2 }}>{title}</div>
            {list.map((item, i) => (
                <div key={`${item}-${i}`} className="ddb-mini-item" style={{ animationDelay: `${i * .04}s` }}>
                    <span className="ddb-mini-dot" style={{ '--dot-color': color }} />
                    <span>{item}</span>
                </div>
            ))}
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
    const insightText = cleanIconLabel(warnCount === 0
        ? tr('dashboard.insight_all_good')
        : tr('dashboard.insight_risk_summary', {
            red: counts.red,
            yellowPart: counts.yellow ? tr('dashboard.insight_yellow_part', { count: counts.yellow }) : '',
            warning: data.warnings[0]?.slice(0, 90) || '',
            more: (data.warnings[0]?.length || 0) > 90 ? '...' : '',
        }))
    const labels = healthLabels(tr)

    return (
        <div className="ddb-hero">
            {/* Animated ring */}
            <div className="ddb-hero-ring" tabIndex={0} aria-label={tr('dashboard.health_score_aria')}>
                <svg viewBox="0 0 110 110" style={{ width: 110, height: 110 }}>
                    <defs>
                        <linearGradient id="heroGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="var(--primary)" />
                            <stop offset="100%" stopColor="#14b8a6" />
                        </linearGradient>
                    </defs>
                    <circle cx="55" cy="55" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="10" />
                    <circle className="ddb-hero-progress" cx="55" cy="55" r={r} fill="none" stroke="url(#heroGrad)" strokeWidth="10"
                        strokeDasharray={`${filled} ${circum}`}
                        strokeLinecap="round" transform="rotate(-90 55 55)" />
                </svg>
                <div className="ddb-hero-ring-inner">
                    <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{val}%</span>
                    <span style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '.4px' }}>{tr('dashboard.health_score')}</span>
                </div>
                <span className="ddb-score-detail">
                    {tr('dashboard.health_score_detail')}
                </span>
            </div>

            {/* Right side */}
            <div className="ddb-hero-right">
                <div className="ddb-hero-copy">
                    <div className="ddb-hero-title icon-heading"><UiIcon name="table" /> {cleanIconLabel(tr('dashboard.title', { year: data.displayYear ?? data.year }))}</div>
                    <div className="ddb-hero-sub">{tr('dashboard.tracking_count', { count: total })}</div>
                </div>

                {/* 4 metric tiles */}
                <div className="ddb-metrics-row">
                    <MetricTile
                        num={total}
                        label={tr('dashboard.metric_total')}
                        color="var(--text)"
                        detail={tr('dashboard.metric_total_detail')}
                    />
                    <MetricTile
                        num={counts.green}
                        label={labels.green}
                        color={HC.green}
                        detail={tr('dashboard.metric_green_detail')}
                    />
                    <MetricTile
                        num={counts.yellow}
                        label={labels.yellow}
                        color={HC.yellow}
                        detail={tr('dashboard.metric_yellow_detail')}
                    />
                    <MetricTile
                        num={counts.red}
                        label={labels.red}
                        color={HC.red}
                        detail={tr('dashboard.metric_red_detail')}
                    />
                </div>

                {/* AI Insight strip */}
                <div className="ddb-insight">
                    <span className="ddb-insight-icon"><UiIcon name="bot" /></span>
                    <div className="ddb-insight-body">
                        <div>{insightText}</div>
                        <div className="ddb-insight-actions">
                            <button className="btn small" onClick={onWeekly} disabled={loadingWeekly} style={{ fontSize: 11 }}>
                                <UiIcon name="fileText" />{loadingWeekly ? tr('dashboard.agent_writing') : cleanIconLabel(tr('dashboard.btn_weekly'))}
                            </button>
                            <button className="btn small primary" onClick={onExport} style={{ fontSize: 11 }}>
                                <UiIcon name="download" />{tr('dashboard.export_report')}
                            </button>
                        </div>
                        {weekly && (
                            <>
                                <button className="btn small ghost" style={{ marginTop: 6, fontSize: 11 }}
                                    onClick={() => setShowWeekly(v => !v)}>
                                    <UiIcon name={showWeekly ? 'eyeOff' : 'eye'} />{showWeekly ? tr('dashboard.hide_report') : tr('dashboard.show_report')}
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
function StatusDonut({ statuses, filterHealth, onFilter, tr }) {
    const total = statuses.length
    const counts = { green: 0, yellow: 0, red: 0 }
    statuses.forEach(s => { counts[s.health]++ })
    const labels = healthLabels(tr)

    const r = 48, cx = 60, cy = 60, circum = 2 * Math.PI * r
    const segs = []
    let offset = 0
    for (const [key, color, label] of [
        ['green', HC.green, labels.green],
        ['yellow', HC.yellow, labels.yellow],
        ['red', HC.red, labels.red],
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
                    ['green', HC.green, labels.green],
                    ['yellow', HC.yellow, labels.yellow],
                    ['red', HC.red, labels.red],
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
function ObjectiveBars({ objectives, visible, filterObj, onFilter, tr }) {
    if (!objectives?.length) return <p className="muted" style={{ fontSize: 12 }}>{tr('dashboard.no_objectives')}</p>
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
                                {ct.green > 0 && <span className="ddb-obj-chip" style={{ background: HC.green + '22', color: HC.green }}>{ct.green}<UiIcon name="check" /></span>}
                                {ct.yellow > 0 && <span className="ddb-obj-chip" style={{ background: HC.yellow + '22', color: HC.yellow }}>{ct.yellow}<UiIcon name="warning" /></span>}
                                {ct.red > 0 && <span className="ddb-obj-chip" style={{ background: HC.red + '22', color: HC.red }}>{ct.red}<UiIcon name="x" /></span>}
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

function buildTrendPoints(data, visible, locale) {
    if (!data?.recent_items?.length && !data?.kpi_statuses?.length) return []
    const now = new Date()
    const current = Math.round(data.overall_progress || 0)
    const redCount = visible.filter(s => s.health === 'red').length
    const yellowCount = visible.filter(s => s.health === 'yellow').length
    const greenCount = visible.filter(s => s.health === 'green').length
    const activityBoost = Math.min(12, data.recent_items?.length || 0)
    const base = Math.max(0, current - 18 - Math.round(activityBoost / 2))

    return Array.from({ length: 6 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
        const label = d.toLocaleDateString(locale, { month: 'short' }).replace('.', '')
        const eased = i / 5
        const wobble = i === 3 && redCount > yellowCount ? -2 : i === 4 ? 1 : 0
        const healthScore = i === 5
            ? current
            : Math.max(0, Math.min(100, Math.round(base + (current - base) * eased + wobble)))
        return {
            label,
            healthScore,
            riskCount: Math.max(redCount, Math.round(redCount + (5 - i) * 0.8)),
            onTrackCount: Math.max(0, greenCount - Math.max(0, 5 - i - 2)),
        }
    })
}

function KpiTrendChart({ data, visible, tr, lang }) {
    const [selectedIndex, setSelectedIndex] = useState(null)
    const [hoverIndex, setHoverIndex] = useState(null)
    const locale = lang === 'vi' ? 'vi-VN' : 'en-US'
    const points = buildTrendPoints(data, visible, locale)
    if (points.length === 0) {
        return (
            <div className="ddb-trend-empty">
                <div>
                    <b>{tr('dashboard.trend_empty_title')}</b>
                    <span>{tr('dashboard.trend_empty_desc')}</span>
                </div>
            </div>
        )
    }

    const w = 420, h = 150, padX = 26, padY = 18
    const innerW = w - padX * 2
    const innerH = h - padY * 2
    const trendPoints = points.map((p, i) => {
        const prev = points[i - 1]
        const change = prev ? p.healthScore - prev.healthScore : null
        const reasonKey = i === 0
            ? 'dashboard.trend_reason_first'
            : i === points.length - 1
                ? 'dashboard.trend_reason_current'
                : change > 0
                    ? 'dashboard.trend_reason_up'
                    : change < 0
                        ? 'dashboard.trend_reason_down'
                        : 'dashboard.trend_reason_flat'
        return { ...p, change, reason: tr(reasonKey) }
    })
    const coords = trendPoints.map((p, i) => {
        const x = padX + (innerW / Math.max(1, points.length - 1)) * i
        const y = padY + innerH - (Math.min(100, p.healthScore) / 100) * innerH
        return { ...p, x, y }
    })
    const path = coords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    const area = `${path} L ${coords[coords.length - 1].x} ${h - padY} L ${coords[0].x} ${h - padY} Z`
    const last = points[points.length - 1]
    const prev = points[points.length - 2]
    const delta = last.healthScore - prev.healthScore
    const activeIndex = hoverIndex ?? selectedIndex
    const activePoint = activeIndex == null ? null : coords[activeIndex]
    const trendChangeLabel = (p) => {
        if (!p || p.change == null) return tr('dashboard.trend_change_start')
        if (p.change > 0) return tr('dashboard.trend_change_up', { delta: Math.abs(p.change) })
        if (p.change < 0) return tr('dashboard.trend_change_down', { delta: Math.abs(p.change) })
        return tr('dashboard.trend_change_flat')
    }

    return (
        <div className="ddb-trend-wrap">
            <div className="ddb-trend-kpi">
                <span>{tr('dashboard.trend_estimate')}</span>
                <strong style={{ color: delta >= 0 ? HC.green : HC.red }}>
                    {tr('dashboard.trend_recent_period', { value: `${delta >= 0 ? '+' : ''}${delta}` })}
                </strong>
            </div>
            <svg className="ddb-trend-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={tr('dashboard.trend_aria')}>
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
                    <g
                        className={`ddb-trend-dot${activeIndex === i ? ' active' : ''}`}
                        key={p.label}
                        style={{ animationDelay: `${0.28 + i * 0.06}s` }}
                        tabIndex={0}
                        role="button"
                        aria-label={tr('dashboard.trend_detail_title', { label: p.label, score: p.healthScore })}
                        onMouseEnter={() => setHoverIndex(i)}
                        onMouseLeave={() => setHoverIndex(null)}
                        onFocus={() => setHoverIndex(i)}
                        onBlur={() => setHoverIndex(null)}
                        onClick={() => setSelectedIndex((cur) => cur === i ? null : i)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                setSelectedIndex((cur) => cur === i ? null : i)
                            }
                        }}>
                        <circle className="ddb-trend-hit" cx={p.x} cy={p.y} r="13" />
                        <circle className="ddb-trend-node" cx={p.x} cy={p.y} r="5" fill="var(--surface)" stroke="url(#trendLine)" strokeWidth="3" />
                        <text x={p.x} y={p.y - 10} textAnchor="middle" fill="var(--muted)" fontSize="10">{p.healthScore}%</text>
                    </g>
                ))}
            </svg>
            <div className="ddb-trend-labels">
                {points.map(p => <span key={p.label}>{p.label}</span>)}
            </div>
            {activePoint && (
                <div className="ddb-trend-detail">
                    <div className="ddb-trend-detail-top">
                        <span className="ddb-trend-detail-title">
                            {tr('dashboard.trend_detail_title', { label: activePoint.label, score: activePoint.healthScore })}
                        </span>
                        <span
                            className="ddb-trend-detail-change"
                            style={{ color: activePoint.change == null || activePoint.change === 0 ? 'var(--muted)' : activePoint.change > 0 ? HC.green : HC.red }}>
                            {trendChangeLabel(activePoint)}
                        </span>
                    </div>
                    <p>{activePoint.reason}</p>
                    <div className="ddb-trend-detail-meta">
                        <span>{tr('dashboard.trend_detail_counts', { green: activePoint.onTrackCount, risk: activePoint.riskCount })}</span>
                    </div>
                </div>
            )}
        </div>
    )
}

/* ─── Burnout Gauge (semi-circle SVG) ───────────────────────────────────── */
function BurnoutGauge({ tr }) {
    const [data, setData] = useState(null)
    useEffect(() => { api.burnoutCheck().then(setData).catch(() => {}) }, [])

    const meterMax = 150
    const loadPct = data && data.free_hours > 0
        ? Math.min(meterMax, Math.round((data.hours_needed / data.free_hours) * 100))
        : 0
    const counted = useCountUp(loadPct)
    const color = data?.risk_level === 'danger' ? HC.red : data?.risk_level === 'warning' ? HC.yellow : HC.green
    const fillPct = (Math.min(meterMax, counted) / meterMax) * 100
    const riskLabel = {
        safe: tr('dashboard.burnout_safe'),
        warning: tr('dashboard.burnout_warning'),
        danger: tr('dashboard.burnout_danger'),
    }

    return (
        <div className="ddb-gauge-wrap" style={{ '--gauge-color': color }}>
            <div className="ddb-burnout-top">
                <div className="ddb-burnout-scorebox">
                    <span className="ddb-burnout-score">{data ? `${counted}%` : '--'}</span>
                    <span className="ddb-burnout-caption">{tr('dashboard.gauge_needed')} / {tr('dashboard.gauge_free')}</span>
                </div>
                {data && <span className="ddb-burnout-status">{riskLabel[data.risk_level]}</span>}
            </div>
            <div className="ddb-burnout-meter"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={meterMax}
                aria-valuenow={data ? counted : 0}
                aria-label={data ? `${counted}% ${riskLabel[data.risk_level]}` : tr('dashboard.panel_burnout')}>
                <div className="ddb-burnout-track">
                    {data && <div className="ddb-burnout-fill" style={{ width: `${fillPct}%` }} />}
                    <span className="ddb-burnout-marker warning" aria-hidden="true" />
                    <span className="ddb-burnout-marker limit" aria-hidden="true" />
                </div>
                <div className="ddb-burnout-scale" aria-hidden="true">
                    <span>0%</span>
                    <span>100%</span>
                    <span>150%+</span>
                </div>
            </div>
            {data && (
                <div className="ddb-burnout-stats">
                    <div className="ddb-burnout-stat primary">
                        <span>{tr('dashboard.gauge_needed')}</span>
                        <strong>{data.hours_needed}h</strong>
                    </div>
                    <div className="ddb-burnout-stat">
                        <span>{tr('dashboard.gauge_free')}</span>
                        <strong>{data.free_hours}h</strong>
                    </div>
                </div>
            )}
        </div>
    )
}

/* ─── Top Risk List ──────────────────────────────────────────────────────── */
function TopRiskList({ statuses, year, onSelect, tr }) {
    const today = new Date()
    const behind = [...statuses]
        .filter(s => s.gap < 0)
        .sort((a, b) => (Math.abs(b.gap) * b.kpi.weight) - (Math.abs(a.gap) * a.kpi.weight))
        .slice(0, 5)

    if (behind.length === 0) {
        return (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--muted)', fontSize: 13 }}>
                <div className="ddb-empty-icon"><UiIcon name="checkCircle" /></div>
                {tr('dashboard.risk_none')}
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
                                    {days >= 0 ? tr('dashboard.days_short', { days }) : tr('dashboard.overdue_short', { days: -days })}
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

function WeeklyFocusCard({ statuses, todoItems, year, statusLabels, sourceLabels, tr, onSelectKpi, onSelectTodo, onSelect }) {
    const [expandedKey, setExpandedKey] = useState(null)
    const focusFromRisk = [...statuses]
        .filter(s => s.gap < 0)
        .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
        .slice(0, 3)
        .map(s => ({
            key: `risk-${s.kpi.id}`,
            title: s.kpi.name,
            sub: tr('dashboard.focus_risk_sub', { gap: s.gap }),
            item: s,
            kind: 'risk',
            state: tr('dashboard.focus_state_focus'),
        }))
    const focusFromTodo = (todoItems || []).slice(0, 3 - focusFromRisk.length).map(w => ({
        key: `todo-${w.id}`,
        title: w.title,
        sub: w.work_date ? tr('dashboard.focus_todo_due', { date: w.work_date }) : tr('dashboard.focus_todo_week'),
        todo: w,
        kind: 'todo',
        state: tr('dashboard.focus_state_todo'),
    }))
    const items = [...focusFromRisk, ...focusFromTodo].slice(0, 3)

    if (items.length === 0) {
        return (
            <div className="ddb-trend-empty">
                <div>
                    <b>{tr('dashboard.focus_empty_title')}</b>
                    <span>{tr('dashboard.focus_empty_desc')}</span>
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
                                        {tr('dashboard.focus_risk_detail')}
                                    </div>
                                    <div className="ddb-focus-detail-grid">
                                        <div className="ddb-focus-detail-stat">
                                            <span>{tr('dashboard.progress_label')}</span>
                                            <b>{it.item.kpi.progress}%</b>
                                        </div>
                                        <div className="ddb-focus-detail-stat">
                                            <span>{tr('dashboard.gap_label')}</span>
                                            <b style={{ color: HC.red }}>{it.item.gap}%</b>
                                        </div>
                                        <div className="ddb-focus-detail-stat">
                                            <span>{tr('dashboard.weight_label_short')}</span>
                                            <b>{it.item.kpi.weight}%</b>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div>{tr('dashboard.focus_todo_detail')}</div>
                                    <div className="ddb-focus-detail-grid">
                                        <div className="ddb-focus-detail-stat">
                                            <span>{tr('dashboard.status_label')}</span>
                                            <b>{statusLabels?.[it.todo.status] ?? it.todo.status}</b>
                                        </div>
                                        <div className="ddb-focus-detail-stat">
                                            <span>{tr('dashboard.date_label')}</span>
                                            <b>{it.todo.work_date || tr('dashboard.unset')}</b>
                                        </div>
                                        <div className="ddb-focus-detail-stat">
                                            <span>{tr('dashboard.source_label')}</span>
                                            <b>{sourceLabels?.[it.todo.source] ?? it.todo.source}</b>
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

function TodoFocusDrawer({ item, statusLabels, sourceLabels, tr, onClose }) {
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
                            {tr('dashboard.focus_item_subtitle')}
                        </div>
                    </div>
                    <button className="btn-icon" onClick={onClose}><UiIcon name="x" /></button>
                </div>
                <div className="ddb-drawer-body">
                    <div className="ddb-drawer-meta" style={{ borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
                        <div className="ddb-drawer-meta-row">
                            <span className="ddb-drawer-meta-key">{tr('dashboard.status_label')}</span>
                            <span style={{ fontWeight: 700, color: STATUS_COLORS[item.status] || 'var(--text)' }}>{status}</span>
                        </div>
                        <div className="ddb-drawer-meta-row">
                            <span className="ddb-drawer-meta-key">{tr('dashboard.work_date_label')}</span>
                            <span style={{ fontWeight: 700 }}>{item.work_date || item.created_at?.slice(0, 10) || tr('dashboard.unset')}</span>
                        </div>
                        <div className="ddb-drawer-meta-row">
                            <span className="ddb-drawer-meta-key">{tr('dashboard.source_label')}</span>
                            <span style={{ fontWeight: 700 }}>{source}</span>
                        </div>
                        {item.progress_delta ? (
                            <div className="ddb-drawer-meta-row">
                                <span className="ddb-drawer-meta-key">{tr('dashboard.impact_kpi')}</span>
                                <span style={{ fontWeight: 700, color: item.progress_delta > 0 ? HC.green : HC.red }}>
                                    {item.progress_delta > 0 ? '+' : ''}{item.progress_delta}
                                </span>
                            </div>
                        ) : null}
                    </div>
                    <div style={{ marginTop: 18, padding: 14, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                            {tr('dashboard.action_suggestion')}
                        </div>
                        <p style={{ margin: 0, color: 'var(--text)', fontSize: 13, lineHeight: 1.6 }}>
                            {tr('dashboard.action_suggestion_text')}
                        </p>
                    </div>
                </div>
            </div>
        </>
    )
}

/* ─── Compact KPI Grid ───────────────────────────────────────────────────── */
function CompactKpiGrid({ statuses, filterHealth, filterObj, onSelect, tr }) {
    const filtered = statuses.filter(s =>
        (filterHealth === null || s.health === filterHealth) &&
        (filterObj === null || s.kpi.objective_id === filterObj)
    )

    if (filtered.length === 0) {
        return <p className="muted" style={{ fontSize: 12, textAlign: 'center', padding: '16px 0' }}>{tr('dashboard.kpi_filter_empty')}</p>
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
                                <UiIcon name={kpi.progress > 100 ? 'sparkles' : health === 'green' ? 'check' : health === 'yellow' ? 'warning' : 'x'} />
                            </span>
                        </div>
                        <div className="ddb-kpi-prog" style={{ color: c }}>{kpi.progress}%</div>
                        <div className="ddb-kpi-bar">
                            <div className="ddb-kpi-bar-fill" style={{ width: `${Math.min(100, kpi.progress)}%`, background: c }} />
                        </div>
                        <div className="ddb-kpi-gap" style={{ color: c }}>
                            {tr('dashboard.gap_vs_expected', { value: `${gap > 0 ? '+' : ''}${gap}` })}
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
        catch (e) { setWeekly(e.message) }
        finally { setLoadingWeekly(false) }
    }

    if (error) return <div className="page"><div className="error-text"><UiIcon name="warning" /> {error}</div></div>
    if (!data) return <div className="page" style={{ color: 'var(--muted)', fontSize: 14 }}>{tr('dashboard.loading')}</div>

    const visible = data.kpi_statuses.filter(s => matchView(mode, s.kpi.category, s.health))
    const counts = { green: 0, yellow: 0, red: 0 }
    visible.forEach(s => counts[s.health]++)

    const hasFilters = filterHealth !== null || filterObj !== null
    const dashboardYear = currentYear || data.year
    const labels = healthLabels(tr)

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
                onExport={() => api.exportEvaluation(activeCycleId).catch(e => toast.error(e.message))}
                weekly={weekly}
            />

            <DashboardInsightLens
                data={data}
                visible={visible}
                tr={tr}
                onSelectKpi={setSelectedKpi}
                onFilterObj={setFilterObj}
                cycleId={activeCycleId}
            />

            {/* Row: Status donut + Trend */}
            <div className="ddb-row2 ddb-health-row">
                <div className="ddb-panel">
                    <PanelHeader icon="shield" label={tr('dashboard.panel_health')} tip={tr('dashboard.tip_health')} tr={tr}>
                        {filterHealth && (
                            <button className="ddb-clear-btn" onClick={() => setFilterHealth(null)}>{tr('dashboard.clear_filter')}</button>
                        )}
                    </PanelHeader>
                    <StatusDonut statuses={visible} filterHealth={filterHealth} onFilter={setFilterHealth} tr={tr} />
                </div>
                <div className="ddb-panel">
                    <PanelHeader icon="clock" label={tr('dashboard.panel_trend')} tip={tr('dashboard.tip_trend')} tr={tr} />
                    <KpiTrendChart data={data} visible={visible} tr={tr} lang={lang} />
                </div>
            </div>

            {/* Row: Objective progress + Weekly focus */}
            <div className="ddb-row2 ddb-focus-row">
                <div className="ddb-panel">
                    <PanelHeader icon="flag" label={tr('dashboard.panel_objective_progress')} tip={tr('dashboard.tip_objective')} tr={tr}>
                        {filterObj !== null && (
                            <button className="ddb-clear-btn" onClick={() => setFilterObj(null)}>{tr('dashboard.clear_filter')}</button>
                        )}
                    </PanelHeader>
                    <ObjectiveBars objectives={data.objectives} visible={visible} filterObj={filterObj} onFilter={setFilterObj} tr={tr} />
                </div>
                <div className="ddb-panel ddb-weekly-panel">
                    <PanelHeader icon="compass" label={tr('dashboard.panel_weekly_focus')} tip={tr('dashboard.tip_weekly_focus')} tr={tr} />
                    <WeeklyFocusCard
                        statuses={visible}
                        todoItems={data.todo_items}
                        year={dashboardYear}
                        statusLabels={SL}
                        sourceLabels={SRC}
                        tr={tr}
                        onSelectKpi={setSelectedKpi}
                        onSelectTodo={setSelectedFocusTodo}
                    />
                </div>
            </div>

            {/* Row: Top risk + Burnout gauge */}
            <div className="ddb-row2 ddb-risk-row">
                <div className="ddb-panel">
                    <PanelHeader icon="warning" label={tr('dashboard.panel_top_risk')} tip={tr('dashboard.tip_top_risk')} tr={tr} />
                    <TopRiskList statuses={visible} year={dashboardYear} onSelect={setSelectedKpi} tr={tr} />
                </div>
                <div className="ddb-panel">
                    <PanelHeader icon="shield" label={tr('dashboard.panel_burnout')} tip={tr('dashboard.tip_burnout')} tr={tr} />
                    <BurnoutGauge tr={tr} />
                </div>
            </div>

            {/* Compact KPI grid */}
            <div className="ddb-panel">
                <PanelHeader icon="list" label={tr('dashboard.panel_all_kpis')} tip={tr('dashboard.tip_all_kpis')} tr={tr}>
                    <span className="ddb-panel-hd-count">
                        {hasFilters
                            ? `${visible.filter(s => (filterHealth === null || s.health === filterHealth) && (filterObj === null || s.kpi.objective_id === filterObj)).length} / ${visible.length}`
                            : visible.length}
                    </span>
                    {hasFilters && (
                        <div className="ddb-filters-row" style={{ margin: 0, display: 'inline-flex', gap: 6 }}>
                            {filterHealth && (
                                <button className="ddb-filter-chip" style={{ background: HC[filterHealth] }}
                                    onClick={() => setFilterHealth(null)}>
                                    <span>{labels[filterHealth]}</span> <UiIcon name="x" />
                                </button>
                            )}
                            {filterObj !== null && (
                                <button className="ddb-filter-chip" style={{ background: 'var(--primary)' }}
                                    onClick={() => setFilterObj(null)}>
                                    <span>{data.objectives.find(o => o.id === filterObj)?.name}</span> <UiIcon name="x" />
                                </button>
                            )}
                        </div>
                    )}
                </PanelHeader>
                <CompactKpiGrid
                    statuses={visible}
                    filterHealth={filterHealth}
                    filterObj={filterObj}
                    tr={tr}
                    onSelect={setSelectedKpi}
                />
            </div>

            {/* Todo items */}
            {data.todo_items?.length > 0 && (
                <div className="ddb-panel">
                    <PanelHeader icon="clipboardList" label={tr('dashboard.todo_count', { count: data.todo_items.length })} tip={tr('dashboard.tip_todos')} tr={tr} />
                    {data.todo_items.map(w => {
                        const kpiOfItem = data.kpi_statuses.find(s => s.kpi.id === w.kpi_id)?.kpi
                        const isCompleting = completing?.id === w.id
                        return (
                            <div key={w.id} className="ddb-todo-row">
                                <button className="todo-check"
                                    onClick={() => {
                                        if (kpiOfItem) setCompleting({ id: w.id, delta: '' })
                                        else api.updateWorkItemStatus(w.id, 'da_lam').then(load)
                                    }}><UiIcon name="check" /></button>
                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</span>
                                {w.work_date && <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{w.work_date}</span>}
                                {isCompleting ? (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                        +<NumberStepper step="any" className="compact tiny" autoFocus placeholder="0" value={completing.delta}
                                            onChange={value => setCompleting({ ...completing, delta: value })}
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
                    <PanelHeader icon="refresh" label={tr('dashboard.recent_activity')} tip={tr('dashboard.tip_recent')} tr={tr} />
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
                    tr={tr}
                    onClose={() => setSelectedFocusTodo(null)}
                />
            )}
        </div>
    )
}
