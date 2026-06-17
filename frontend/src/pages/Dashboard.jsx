import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useLang } from '../LangContext'
import { useView, matchView } from '../ViewContext'
import { useCycle } from '../CycleContext'
import ViewModeSwitch from '../components/ViewModeSwitch'
import KpiDetailDrawer from '../components/KpiDetailDrawer'
import { UiIcon, cleanIconLabel } from '../components/UiIcon'

const HC = { green: '#22c55e', yellow: '#eab308', red: '#ef4444' }

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

  /* Output cockpit */
  .ddb-output-cockpit {
    position:relative; overflow:visible; isolation:isolate;
    border:1px solid color-mix(in srgb,#06b6d4 28%,var(--border)); border-radius:16px;
    padding:16px; display:flex; flex-direction:column;
    gap:14px;
    background:
      linear-gradient(135deg,rgba(124,92,255,.055),rgba(6,182,212,.045) 52%,rgba(20,184,166,.05)),
      var(--surface);
    box-shadow:var(--shadow-hover),0 0 0 1px rgba(255,255,255,.03) inset;
    animation:ddb-up .36s ease both;
  }
  .ddb-output-cockpit.draft {
    overflow:hidden;
    display:grid;
    grid-template-columns:minmax(250px,.86fr) minmax(0,1.58fr);
    grid-template-areas:
      "hero metrics"
      "hero insight"
      "charts charts";
    align-items:stretch;
    padding:14px;
    gap:14px;
  }
  .ddb-output-draft-hero {
    grid-area:hero;
    position:relative; overflow:hidden; min-height:246px;
    padding:18px; border-radius:14px;
    border:1px solid color-mix(in srgb,var(--primary) 24%,var(--border));
    background:
      radial-gradient(280px 180px at 18% 5%, rgba(124,92,255,.14), transparent 60%),
      radial-gradient(240px 180px at 92% 88%, rgba(20,184,166,.14), transparent 62%),
      color-mix(in srgb,var(--surface) 82%,transparent);
    display:flex; flex-direction:column; justify-content:space-between; gap:14px;
    box-shadow:0 0 0 1px rgba(255,255,255,.025) inset;
  }
  [data-theme="dark"] .ddb-output-draft-hero {
    background:
      radial-gradient(300px 190px at 16% 8%, rgba(124,92,255,.20), transparent 62%),
      radial-gradient(270px 190px at 88% 92%, rgba(20,184,166,.16), transparent 64%),
      rgba(255,255,255,.045);
  }
  .ddb-output-draft-hero::after {
    content:''; position:absolute; right:-44px; bottom:-48px; width:168px; height:168px;
    border-radius:50%; border:1px solid rgba(20,184,166,.18); pointer-events:none; z-index:0;
  }
  .ddb-output-draft-copy { position:relative; z-index:2; max-width:260px; }
  .ddb-output-draft-kicker {
    display:inline-flex; align-items:center; gap:7px;
    color:#67e8f9; font-size:10.5px; font-weight:850; text-transform:uppercase; letter-spacing:.08em;
    padding:5px 9px; border:1px solid rgba(6,182,212,.28); border-radius:999px;
    background:rgba(6,182,212,.08);
  }
  .ddb-output-draft-kicker .ui-icon { width:14px; height:14px; }
  .ddb-output-draft-title {
    margin:10px 0 7px; color:var(--text); font-size:clamp(28px,3.4vw,46px);
    line-height:.98; font-weight:900; letter-spacing:0;
  }
  .ddb-output-draft-sub { color:var(--muted); font-size:12.5px; line-height:1.45; margin:0; }
  .ddb-output-draft-orbit {
    --v:0%;
    position:absolute; right:-18px; bottom:-36px; width:148px; height:148px;
    border-radius:50%;
    background:
      conic-gradient(from -90deg,#7c5cff var(--v),rgba(124,92,255,.13) 0),
      radial-gradient(circle at 30% 18%,rgba(34,211,238,.52),transparent 34%);
    display:grid; place-items:center;
    filter:drop-shadow(0 0 18px rgba(20,184,166,.18));
    animation:ddb-ring-pulse 3.6s ease-in-out infinite;
    z-index:1;
  }
  .ddb-output-draft-orbit::after {
    content:''; position:absolute; inset:28px; border-radius:50%;
    background:var(--surface);
    box-shadow:inset 0 0 0 1px var(--border);
  }
  .ddb-output-draft-orbit span {
    position:relative; z-index:1; display:flex; flex-direction:column; align-items:center; gap:2px;
    color:var(--text); font-size:22px; line-height:1; font-weight:900;
  }
  .ddb-output-draft-orbit small {
    color:var(--muted); font-size:9px; font-weight:850; text-transform:uppercase; letter-spacing:.04em;
  }
  .ddb-output-draft-actions {
    position:relative; z-index:3; display:flex; gap:8px; flex-wrap:wrap; max-width:198px;
  }
  .ddb-output-draft-actions .btn { flex:1 1 calc(50% - 4px); justify-content:center; min-width:0; }
  .ddb-output-draft-actions .btn.primary {
    flex-basis:100%;
    box-shadow:0 10px 24px rgba(20,184,166,.22),0 6px 16px rgba(124,92,255,.20);
  }
  .ddb-output-draft-next {
    grid-area:insight;
    min-height:82px;
    align-self:stretch;
  }
  .ddb-output-cockpit.draft .ddb-output-metrics { grid-area:metrics; }
  .ddb-output-cockpit.draft .ddb-cockpit-side { grid-area:charts; }
  [data-theme="dark"] .ddb-output-cockpit {
    background:
      linear-gradient(135deg,rgba(8,13,31,.96),rgba(13,23,48,.94) 48%,rgba(7,35,46,.82)),
      var(--surface);
    border-color:rgba(6,182,212,.34);
    box-shadow:0 20px 58px rgba(2,6,23,.32),0 0 0 1px rgba(124,92,255,.10) inset;
  }
  .ddb-output-cockpit::before {
    content:''; position:absolute; inset:0; z-index:-1; pointer-events:none;
    background:
      linear-gradient(110deg,transparent 0%,rgba(6,182,212,.08) 40%,transparent 64%),
      linear-gradient(180deg,rgba(255,255,255,.035),transparent 44%),
      repeating-linear-gradient(90deg,rgba(148,163,184,.055) 0 1px,transparent 1px 80px);
    border-radius:inherit;
    opacity:.72;
  }
  .ddb-output-cockpit::after {
    content:''; position:absolute; left:16px; right:16px; top:-1px; height:1px; pointer-events:none;
    background:linear-gradient(90deg,transparent,#8b5cf6,#06b6d4,transparent);
    opacity:.86;
  }
  .ddb-cockpit-main { min-width:0; display:flex; flex-direction:column; gap:12px; }
  .ddb-cockpit-head { display:flex; align-items:center; justify-content:space-between; gap:14px; }
  .ddb-cockpit-kicker {
    display:inline-flex; align-items:center; gap:7px; width:max-content;
    color:#67e8f9; font-size:10.5px; font-weight:850; text-transform:uppercase; letter-spacing:.08em;
    padding:5px 9px; border:1px solid rgba(6,182,212,.28); border-radius:999px;
    background:rgba(6,182,212,.08);
  }
  .ddb-cockpit-kicker .ui-icon { width:14px; height:14px; }
  .ddb-cockpit-title {
    margin-top:7px; color:var(--text); font-weight:900; line-height:1.08;
    font-size:clamp(22px,2.2vw,30px); letter-spacing:0;
  }
  .ddb-cockpit-sub { margin-top:6px; color:var(--muted); font-size:12.5px; line-height:1.45; max-width:780px; }
  .ddb-cockpit-actions { display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; flex-shrink:0; }
  .ddb-output-metrics {
    display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; overflow:visible;
  }
  .ddb-output-metric {
    --metric-color:#14b8a6;
    position:relative; min-width:0; min-height:146px;
    border:1px solid color-mix(in srgb,var(--metric-color) 28%,var(--border));
    border-radius:12px; padding:12px 13px;
    background:
      linear-gradient(180deg,color-mix(in srgb,var(--metric-color) 9%,transparent),rgba(255,255,255,.025)),
      color-mix(in srgb,var(--surface) 88%,transparent);
    display:flex; flex-direction:column; align-items:center; justify-content:space-between; gap:8px;
    box-shadow:0 0 0 1px rgba(255,255,255,.025) inset;
    transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease;
    animation:ddb-pop .34s ease both;
    font:inherit; color:inherit; text-align:left; appearance:none;
  }
  .ddb-output-metric.clickable { cursor:pointer; }
  .ddb-output-metric::after {
    content:''; position:absolute; inset:0; pointer-events:none; border-radius:inherit; z-index:2;
    background:linear-gradient(115deg,transparent 25%,rgba(255,255,255,.18) 50%,transparent 75%);
    transform:translateX(-110%); transition:transform 0s;
  }
  .ddb-output-metric:hover::after { transform:translateX(110%); transition:transform .52s cubic-bezier(.4,0,.2,1); }
  .ddb-output-metric:hover,
  .ddb-output-metric:focus-visible {
    transform:translateY(-3px) scale(1.012);
    border-color:color-mix(in srgb,var(--metric-color) 58%,white);
    box-shadow:0 16px 36px color-mix(in srgb,var(--metric-color) 18%,transparent),0 0 22px color-mix(in srgb,var(--metric-color) 16%,transparent);
    outline:none;
    z-index:30;
  }
  .ddb-output-metric:nth-child(2){ animation-delay:.05s }
  .ddb-output-metric:nth-child(3){ animation-delay:.10s }
  .ddb-output-metric:nth-child(4){ animation-delay:.15s }
  .ddb-output-metric-top { width:100%; display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .ddb-output-metric-icon {
    width:28px; height:28px; display:grid; place-items:center; border-radius:9px;
    color:var(--metric-color); background:color-mix(in srgb,var(--metric-color) 13%,transparent);
  }
  .ddb-output-metric-icon .ui-icon { width:16px; height:16px; }
  .ddb-output-metric-label {
    flex:1; min-width:0; color:var(--muted); font-size:10.5px; font-weight:850;
    text-transform:uppercase; letter-spacing:0; line-height:1.22;
  }
  .ddb-output-ring { position:relative; width:86px; height:86px; flex-shrink:0; }
  .ddb-output-ring svg { width:86px; height:86px; transform:rotate(-90deg); overflow:visible; }
  .ddb-output-ring-track { fill:none; stroke:rgba(148,163,184,.18); stroke-width:10; }
  .ddb-output-ring-value {
    fill:none; stroke:var(--metric-color); stroke-width:10; stroke-linecap:round;
    filter:drop-shadow(0 0 8px color-mix(in srgb,var(--metric-color) 38%,transparent));
    transition:stroke-dasharray .72s cubic-bezier(.34,1.18,.64,1);
    animation:ddb-ring-pulse 4s ease-in-out infinite;
  }
  .ddb-output-ring-center {
    position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center;
    text-align:center; padding:0 8px;
  }
  .ddb-output-ring-value-text { color:var(--text); font-size:21px; font-weight:900; line-height:1; overflow-wrap:anywhere; }
  .ddb-output-ring-unit { margin-top:3px; color:var(--muted); font-size:9px; font-weight:800; text-transform:uppercase; }
  .ddb-output-metric-delta {
    display:inline-flex; align-items:center; gap:4px; min-height:20px;
    color:var(--metric-color); font-size:11px; font-weight:850;
  }
  .ddb-output-metric-delta .ui-icon { width:13px; height:13px; }
  .ddb-output-metric-tip {
    position:absolute; left:10px; right:10px; top:calc(100% + 8px); z-index:80;
    padding:10px 11px; border-radius:10px; border:1px solid var(--border);
    background:var(--surface-2); color:var(--text); box-shadow:var(--shadow-hover);
    font-size:12px; line-height:1.45; opacity:0; pointer-events:none;
    transform:translateY(-4px); transition:opacity .15s ease,transform .15s ease;
  }
  .ddb-formula-line {
    display:block; margin-top:7px; padding:5px 8px; border-radius:7px;
    background:color-mix(in srgb,var(--metric-color) 9%,var(--surface-3));
    border:1px solid color-mix(in srgb,var(--metric-color) 16%,var(--border));
    color:var(--metric-color); font-size:10.5px;
    font-family:ui-monospace,'Cascadia Code',monospace;
    letter-spacing:0; line-height:1.5; word-break:break-all;
  }
  .ddb-output-metric:hover .ddb-output-metric-tip,
  .ddb-output-metric:focus-visible .ddb-output-metric-tip { opacity:1; transform:translateY(0); }
  .ddb-output-cockpit.draft .ddb-output-metric {
    min-height:124px;
    align-items:flex-start;
    justify-content:flex-start;
    padding:12px;
    background:
      linear-gradient(135deg,rgba(124,92,255,.075),rgba(20,184,166,.045)),
      color-mix(in srgb,var(--surface) 82%,transparent);
    border-color:color-mix(in srgb,var(--primary) 20%,var(--border));
  }
  .ddb-output-cockpit.draft .ddb-output-metric:hover,
  .ddb-output-cockpit.draft .ddb-output-metric:focus-visible {
    border-color:color-mix(in srgb,var(--metric-color) 42%,var(--accent));
    box-shadow:0 12px 30px rgba(2,6,23,.10),0 0 22px color-mix(in srgb,var(--metric-color) 12%,transparent);
  }
  [data-theme="dark"] .ddb-output-cockpit.draft .ddb-output-metric {
    background:rgba(255,255,255,.045);
  }
  .ddb-output-cockpit.draft .ddb-output-metric-top { align-items:flex-start; min-height:34px; }
  .ddb-output-cockpit.draft .ddb-output-metric-icon {
    color:var(--metric-color);
    background:color-mix(in srgb,var(--metric-color) 14%,transparent);
  }
  .ddb-output-cockpit.draft .ddb-output-ring {
    width:64px; height:64px; margin-top:6px;
  }
  .ddb-output-cockpit.draft .ddb-output-ring svg { width:64px; height:64px; }
  .ddb-output-cockpit.draft .ddb-output-ring-track,
  .ddb-output-cockpit.draft .ddb-output-ring-value { stroke-width:9; }
  .ddb-output-cockpit.draft .ddb-output-ring-value-text { font-size:16px; }
  .ddb-output-cockpit.draft .ddb-output-ring-unit { font-size:8px; }
  .ddb-output-cockpit.draft .ddb-output-metric-delta {
    position:absolute; right:12px; bottom:12px;
    min-height:auto; padding:3px 7px; border-radius:999px;
    background:color-mix(in srgb,var(--metric-color) 10%,transparent);
  }
  .ddb-cockpit-side {
    display:grid; grid-template-columns:minmax(0,1.25fr) minmax(340px,.95fr);
    gap:12px; min-width:0; align-items:stretch;
  }
  .ddb-output-chart,
  .ddb-output-categories {
    border:1px solid color-mix(in srgb,#06b6d4 18%,var(--border)); border-radius:12px; padding:12px;
    background:rgba(255,255,255,.045); min-width:0;
    box-shadow:0 0 0 1px rgba(255,255,255,.025) inset;
  }
  [data-theme="dark"] .ddb-output-chart,
  [data-theme="dark"] .ddb-output-categories { background:rgba(11,18,38,.62); }
  .ddb-output-panel-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:9px; }
  .ddb-output-panel-title { display:flex; align-items:center; gap:7px; color:var(--text); font-size:13px; font-weight:850; }
  .ddb-output-panel-title .ui-icon { width:16px; height:16px; color:#22d3ee; }
  .ddb-output-period-select {
    border:1px solid var(--border); border-radius:9px; color:var(--text);
    background:var(--surface-2); font-size:11px; padding:5px 8px; font:inherit;
  }
  .ddb-output-chart-svg { width:100%; height:224px; display:block; overflow:visible; }
  .ddb-output-grid-line { opacity:.56; }
  .ddb-output-axis-label { fill:var(--muted); font-size:10px; font-weight:650; opacity:.82; }
  .ddb-output-bar {
    cursor:pointer; transition:opacity .15s ease,filter .15s ease;
    animation:ddb-bar-rise .58s cubic-bezier(.2,.8,.2,1) both;
    transform-origin:bottom; transform-box:fill-box;
  }
  .ddb-output-bar:hover,
  .ddb-output-bar.active { filter:drop-shadow(0 0 10px rgba(34,211,238,.44)); opacity:1; }
  .ddb-output-trend-line { stroke-dasharray:520; stroke-dashoffset:520; animation:ddb-draw .9s ease .12s forwards; }
  .ddb-output-chart-tip {
    min-height:52px; padding:9px 10px; border-radius:10px;
    border:1px solid var(--border); background:rgba(124,92,255,.055);
    color:var(--muted); font-size:12px; line-height:1.45;
  }
  [data-theme="dark"] .ddb-output-chart-tip { background:rgba(2,6,23,.34); }
  .ddb-output-tip-title { display:flex; align-items:center; justify-content:space-between; gap:10px; color:var(--text); font-weight:850; margin-bottom:4px; }
  .ddb-output-tip-meta { display:flex; gap:10px; flex-wrap:wrap; }
  .ddb-output-category-list { display:flex; flex-direction:column; gap:8px; }
  .ddb-output-category {
    --cat-color:#14b8a6;
    display:grid; grid-template-columns:minmax(0,1fr) 44px;
    grid-template-areas:"copy value" "track track";
    align-items:center; gap:6px 10px;
    padding:8px 0; border-bottom:1px solid color-mix(in srgb,var(--border) 72%,transparent);
    cursor:pointer;
    border-left:none; border-right:none; border-top:none; background:transparent; width:100%; font:inherit; text-align:left;
  }
  .ddb-output-category:last-child { border-bottom:none; }
  .ddb-output-category-copy { grid-area:copy; min-width:0; display:block; }
  .ddb-output-category:hover .ddb-output-category-fill { filter:drop-shadow(0 0 7px color-mix(in srgb,var(--cat-color) 52%,transparent)); }
  .ddb-output-category-name { display:block; min-width:0; color:var(--text); font-size:12.5px; font-weight:750; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ddb-output-category-meta { color:var(--muted); font-size:10.5px; margin-top:2px; }
  .ddb-output-category-track { grid-area:track; height:8px; border-radius:999px; background:rgba(148,163,184,.18); overflow:hidden; }
  .ddb-output-category-fill {
    position:relative; width:0; height:100%; border-radius:inherit;
    background:linear-gradient(90deg,var(--cat-color),#22d3ee);
    animation:ddb-fill .72s cubic-bezier(.34,1.12,.64,1) both; transform-origin:left;
    overflow:hidden;
  }
  .ddb-output-category-fill::after {
    content:''; position:absolute; inset:0;
    background:linear-gradient(90deg,transparent,rgba(255,255,255,.38),transparent);
    animation:ddb-shine 2.4s ease 1s both;
  }
  .ddb-output-category-value { grid-area:value; text-align:right; color:var(--cat-color); font-size:13px; font-weight:900; align-self:start; }
  .ddb-output-risk-panel .ddb-drawer-body { display:flex; flex-direction:column; gap:10px; }
  .ddb-output-risk-row {
    border:1px solid var(--border); border-radius:12px; padding:11px;
    background:var(--surface); display:grid; gap:9px; cursor:pointer;
    transition:transform .15s ease,border-color .15s ease,background .15s ease;
    width:100%; font:inherit; text-align:left; color:inherit;
  }
  .ddb-output-risk-row:hover { transform:translateY(-1px); border-color:rgba(20,184,166,.38); background:var(--surface-2); }
  .ddb-output-risk-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
  .ddb-output-risk-name { display:block; color:var(--text); font-weight:850; line-height:1.28; text-wrap:pretty; }
  .ddb-output-risk-sub { display:block; color:var(--muted); font-size:11.5px; margin-top:5px; line-height:1.35; text-wrap:pretty; }
  .ddb-output-risk-reason {
    display:block;
    margin-top:6px;
    color:var(--muted);
    font-size:11px;
    font-style:italic;
    line-height:1.35;
    text-wrap:pretty;
  }
  .ddb-output-risk-reason b {
    color:#8bdfff;
    font-style:normal;
  }
  .ddb-output-risk-badge { font-size:11px; font-weight:850; border-radius:999px; padding:4px 8px; white-space:nowrap; }
  .ddb-output-risk-stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:6px; }
  .ddb-output-risk-stat { border:1px solid var(--border); border-radius:9px; padding:7px; background:rgba(255,255,255,.03); min-width:0; }
  .ddb-output-risk-stat span { display:block; color:var(--muted); font-size:9.5px; font-weight:800; text-transform:uppercase; letter-spacing:0; }
  .ddb-output-risk-stat b { display:block; color:var(--text); font-size:13px; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  @media(max-width:1180px){
    .ddb-output-cockpit.draft {
      grid-template-columns:1fr;
      grid-template-areas:"hero" "metrics" "insight" "charts";
    }
    .ddb-output-draft-hero { min-height:208px; }
    .ddb-output-draft-copy { max-width:540px; }
    .ddb-cockpit-side { grid-template-columns:1fr; }
  }
  @media(max-width:900px){
    .ddb-output-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); }
  }
  @media(max-width:560px){
    .ddb-output-cockpit { padding:14px; border-radius:14px; }
    .ddb-output-draft-hero { min-height:236px; padding:16px; }
    .ddb-output-draft-title { font-size:30px; max-width:220px; }
    .ddb-output-draft-sub { max-width:230px; }
    .ddb-output-draft-orbit { width:124px; height:124px; right:-28px; bottom:-30px; }
    .ddb-output-draft-orbit::after { inset:24px; }
    .ddb-output-draft-orbit span { font-size:18px; }
    .ddb-output-draft-actions .btn { flex:1 1 calc(50% - 4px); justify-content:center; min-width:0; }
    .ddb-output-draft-actions .btn.primary { flex-basis:100%; }
    .ddb-cockpit-head { flex-direction:column; }
    .ddb-cockpit-actions { justify-content:flex-start; width:100%; }
    .ddb-cockpit-actions .btn { flex:1 1 calc(50% - 4px); justify-content:center; min-width:0; }
    .ddb-cockpit-actions .btn.primary { flex-basis:100%; }
    .ddb-output-metrics { grid-template-columns:1fr; }
    .ddb-output-metric {
      min-height:112px; display:grid; grid-template-columns:76px minmax(0,1fr);
      grid-template-rows:auto auto; align-items:center; justify-items:start;
      column-gap:12px; row-gap:6px;
    }
    .ddb-output-metric-top { grid-column:2; grid-row:1; }
    .ddb-output-metric-label { font-size:10px; }
    .ddb-output-ring { grid-column:1; grid-row:1 / span 2; width:76px; height:76px; }
    .ddb-output-ring svg { width:76px; height:76px; }
    .ddb-output-ring-value-text { font-size:19px; }
    .ddb-output-metric-delta { grid-column:2; grid-row:2; }
    .ddb-output-metric-tip { left:0; right:0; top:calc(100% + 6px); }
    .ddb-output-risk-stats { grid-template-columns:repeat(2,minmax(0,1fr)); }
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

  /* Burnout — capacity bar */
  .ddb-gauge-wrap {
    --gauge-color:#22c55e;
    display:flex; flex-direction:column; gap:12px; padding:4px 0 2px;
  }
  .ddb-burnout-header { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
  .ddb-burnout-pct {
    font-size:36px; line-height:.95; font-weight:800; letter-spacing:-.5px;
    font-variant-numeric:tabular-nums; color:var(--gauge-color);
    animation:ddb-pop .6s cubic-bezier(.34,1.18,.64,1) .08s both;
  }
  .ddb-burnout-caption { color:var(--muted); font-size:10px; font-weight:800; text-transform:uppercase; margin-top:5px; }
  .ddb-burnout-status {
    display:inline-flex; align-items:center; gap:7px; flex-shrink:0;
    color:var(--gauge-color); font-size:12px; font-weight:700; line-height:1;
    padding:7px 10px; border-radius:999px;
    background:color-mix(in srgb,var(--gauge-color) 12%,transparent);
    border:1px solid color-mix(in srgb,var(--gauge-color) 28%,transparent);
  }
  .ddb-burnout-status::before { content:''; width:7px; height:7px; border-radius:50%; background:currentColor; }
  .ddb-capbar-outer { display:flex; flex-direction:column; gap:5px; }
  .ddb-capbar-track {
    position:relative; height:18px; border-radius:9px; overflow:hidden;
    background:linear-gradient(90deg,
      color-mix(in srgb,#22c55e 22%,var(--surface-2)) 0% 40%,
      color-mix(in srgb,#eab308 22%,var(--surface-2)) 40% 66.7%,
      color-mix(in srgb,#ef4444 18%,var(--surface-2)) 66.7% 100%);
  }
  .ddb-capbar-fill {
    position:absolute; inset:0; right:auto;
    border-radius:inherit;
    background:var(--gauge-color);
    opacity:.88;
    transform-origin:left center;
    animation:ddb-capbar-in .88s cubic-bezier(.34,1.12,.64,1) .1s both;
    overflow:hidden;
  }
  .ddb-capbar-fill::after {
    content:''; position:absolute; inset:0;
    background:linear-gradient(90deg,transparent,rgba(255,255,255,.46),transparent);
    animation:ddb-shine 1s ease .9s both;
  }
  .ddb-capbar-marker {
    position:absolute; top:2px; bottom:2px; width:1.5px; border-radius:1px;
    background:rgba(255,255,255,.72); z-index:2;
  }
  .ddb-capbar-ticks {
    display:grid; grid-template-columns:0fr 1fr 1fr 0fr;
    color:var(--muted); font-size:9.5px; font-weight:700;
  }
  .ddb-capbar-ticks span:nth-child(2) { text-align:center; padding-left:6%; }
  .ddb-capbar-ticks span:nth-child(3) { text-align:center; padding-left:10%; }
  .ddb-capbar-ticks span:last-child { text-align:right; }
  .ddb-burnout-stats { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
  .ddb-burnout-stat {
    display:flex; align-items:center; gap:8px;
    padding:9px 10px; border-radius:10px;
    border:1px solid var(--border); background:var(--surface-2); min-width:0;
    animation:ddb-up .42s cubic-bezier(.22,1,.36,1) .3s both;
  }
  .ddb-burnout-stat:nth-child(2) { animation-delay:.42s; }
  .ddb-burnout-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
  .ddb-burnout-stat-text { min-width:0; }
  .ddb-burnout-stat-text span {
    display:block; color:var(--muted); font-size:9.5px; font-weight:800;
    text-transform:uppercase; letter-spacing:0; white-space:nowrap;
  }
  .ddb-burnout-stat-text strong {
    display:block; color:var(--text); font-size:16px; font-weight:800;
    font-variant-numeric:tabular-nums; line-height:1.15;
  }
  .ddb-burnout-stat-text strong.primary { color:var(--gauge-color); }
  @keyframes ddb-capbar-in { from{transform:scaleX(0)} }

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
    position:fixed; inset:0;
    background:rgba(2,6,23,.50); z-index:900;
    backdrop-filter:blur(2px); -webkit-backdrop-filter:blur(2px);
    animation:ddb-fade .25s forwards;
  }
  .ddb-drawer {
    position:fixed; right:0; top:0; bottom:0; width:min(460px,100vw);
    max-height:100dvh;
    background:
      linear-gradient(180deg,rgba(255,255,255,.84),rgba(255,255,255,.96)),
      var(--surface);
    border-left:1px solid var(--border); z-index:1000;
    display:flex; flex-direction:column; overflow:hidden;
    box-shadow:-26px 0 70px rgba(15,23,42,.20);
    animation:ddb-slide .28s cubic-bezier(.4,0,.2,1) forwards;
    outline:none;
  }
  .ddb-drawer:focus-visible {
    outline:none;
    box-shadow:var(--focus-ring), -26px 0 70px rgba(15,23,42,.20);
  }
  .lcmd-journal-detail:focus-visible,
  .lcmd-confirm-dialog:focus-visible {
    outline:none;
    box-shadow:var(--focus-ring);
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
  .ddb-drawer-title { font-size:15px; font-weight:700; line-height:1.35; text-wrap:balance }
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
  @keyframes ddb-up { from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)} }
  @keyframes ddb-page-in { from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)} }
  @keyframes ddb-pop { from{opacity:0;transform:scale(.91) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)} }
  @keyframes ddb-fill { from{transform:scaleX(0)}to{transform:scaleX(1)} }
  @keyframes ddb-bar-rise { from{opacity:.45;transform:scaleY(.08)}to{opacity:1;transform:scaleY(1)} }
  @keyframes ddb-draw { to{stroke-dashoffset:0} }
  @keyframes ddb-donut-in { from{opacity:0;transform:scale(.88)}to{opacity:1;transform:scale(1)} }
  @keyframes ddb-ring-pulse { 0%,100%{filter:drop-shadow(0 0 10px rgba(124,92,255,.22));transform:scale(1)} 50%{filter:drop-shadow(0 0 20px rgba(20,184,166,.40));transform:scale(1.018)} }
  @keyframes ddb-shimmer { 0%,68%{transform:translateX(-120%)}100%{transform:translateX(120%)} }
  @keyframes ddb-shine { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
  @keyframes ddb-slide { from{transform:translateX(100%)}to{transform:translateX(0)} }
  @keyframes ddb-sheet { from{transform:translateY(100%)}to{transform:translateY(0)} }
  @keyframes ddb-fade { from{opacity:0}to{opacity:1} }
  @keyframes ddb-ai-flip { from{opacity:0;transform:rotateY(-14deg) translateY(8px)}to{opacity:1;transform:rotateY(0) translateY(0)} }
  @keyframes ddb-radar-in { from{opacity:0;transform:scale(.18)}to{opacity:1;transform:scale(1)} }
  @keyframes ddb-week-grow { from{width:0}to{width:var(--bar-width)} }
  @keyframes ddb-urgent-blink { 0%,100%{opacity:.55} 50%{opacity:1;filter:drop-shadow(0 0 5px currentColor)} }

  /* Living dashboard shell */
  .ldb-shell { position:relative; isolation:isolate; display:flex; flex-direction:column; gap:14px; }
  .ldb-ambient {
    position:fixed; inset:var(--header-h) 0 0; z-index:-1; pointer-events:none; overflow:hidden;
    background:var(--lcmd-ambient-bg);
  }
  .ldb-ambient::before {
    content:''; position:absolute; inset:0;
    background:
      linear-gradient(90deg,var(--lcmd-grid-line-a) 1px,transparent 1px),
      linear-gradient(180deg,var(--lcmd-grid-line-b) 1px,transparent 1px);
    background-size:72px 72px;
    mask-image:linear-gradient(180deg,rgba(0,0,0,.85),transparent 82%);
    animation:ldb-grid-drift 16s linear infinite;
  }
  .ldb-ambient::after {
    content:''; position:absolute; left:0; right:0; top:-2px; height:2px;
    background:var(--lcmd-scan-line);
    box-shadow:var(--lcmd-scan-shadow); opacity:.38;
    animation:ldb-scan 8s linear infinite;
  }
  .ldb-particle {
    position:absolute; width:3px; height:3px; border-radius:999px;
    background:#22d3ee; opacity:.34; box-shadow:0 0 12px currentColor;
    animation:ldb-float 7s ease-in-out infinite;
  }
  .ldb-particle:nth-child(1){ left:8%; top:18%; color:#22d3ee; animation-delay:-1s; }
  .ldb-particle:nth-child(2){ left:31%; top:8%; color:#7c5cff; animation-delay:-4s; }
  .ldb-particle:nth-child(3){ left:58%; top:22%; color:#edf2ff; animation-delay:-2s; }
  .ldb-particle:nth-child(4){ left:78%; top:42%; color:#14b8a6; animation-delay:-5s; }
  .ldb-particle:nth-child(5){ left:18%; top:70%; color:#ffb300; animation-delay:-3s; }
  .ldb-top { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .ldb-title { min-width:0; display:flex; flex-direction:column; gap:4px; }
  .ldb-title strong { color:var(--text); font-size:18px; font-weight:900; line-height:1.15; }
  .ldb-title span { color:var(--muted); font-size:12px; }
  .ldb-alert {
    display:flex; align-items:center; gap:10px; padding:12px 14px;
    border:1px solid rgba(255,61,0,.28); border-left:3px solid #ff3d00; border-radius:12px;
    background:linear-gradient(90deg,rgba(255,61,0,.10),rgba(255,61,0,.025));
    color:var(--text); font-size:12.5px; line-height:1.45; animation:ddb-up .26s ease both;
  }
  .ldb-alert.ok {
    border-color:rgba(0,230,118,.22); border-left-color:#00e676;
    background:linear-gradient(90deg,rgba(0,230,118,.09),rgba(0,229,255,.03));
  }
  .ldb-alert .ui-icon {
    width:17px; height:17px; color:#ff6b3d; flex-shrink:0;
    animation:ddb-ring-pulse 2.6s ease-in-out infinite;
  }
  .ldb-alert.ok .ui-icon { color:#00e676; }
  .ldb-alert-actions { margin-left:auto; display:inline-flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
  .ldb-command-grid { display:grid; grid-template-columns:minmax(0,1.25fr) minmax(320px,.75fr); gap:14px; align-items:stretch; }
  .ldb-side-stack { display:grid; gap:14px; }
  .ldb-bottom-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
  .ldb-panel {
    min-width:0; border:1px solid color-mix(in srgb,#00e5ff 15%,var(--border));
    border-radius:12px; padding:14px;
    background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.015)),var(--surface);
    box-shadow:0 0 0 1px rgba(255,255,255,.018) inset;
  }
  [data-theme="dark"] .ldb-panel {
    background:linear-gradient(180deg,rgba(17,29,53,.82),rgba(13,20,36,.88)),var(--surface);
  }
  .ldb-journal-list { display:flex; flex-direction:column; gap:9px; }
  .ldb-journal-item {
    display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:9px;
    padding:9px 0; border-bottom:1px solid var(--border); color:var(--text); font-size:12px;
  }
  .ldb-journal-item:last-child { border-bottom:none; }
  .ldb-journal-icon {
    width:24px; height:24px; display:grid; place-items:center; border-radius:8px;
    color:#22d3ee; background:rgba(34,211,238,.10);
  }
  .ldb-journal-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:750; }
  .ldb-journal-meta { color:var(--muted); font-size:10.5px; white-space:nowrap; }
  @keyframes ldb-scan { from{ transform:translateY(0); } to{ transform:translateY(100vh); } }
  @keyframes ldb-grid-drift { from{ transform:translate3d(0,0,0); } to{ transform:translate3d(72px,72px,0); } }
  @keyframes ldb-float { 0%,100%{ transform:translate3d(0,0,0); opacity:.22; } 50%{ transform:translate3d(18px,-16px,0); opacity:.48; } }

  /* Command center rebuild */
  .page.ddb-wrap.lcmd-page {
    --surface:#ffffff;
    --surface-2:#f3f8ff;
    --surface-3:#e8f2ff;
    --text:#172033;
    --muted:#64708c;
    --border:rgba(79,70,229,.16);
    --primary:#7c5cff;
    --primary-2:#14b8a6;
    --cyan:#0891b2;
    --violet:#8b5cf6;
    --grad:linear-gradient(135deg,#7c5cff 0%,#06b6d4 55%,#14b8a6 100%);
    --grad-hot:linear-gradient(135deg,#7c5cff 0%,#22d3ee 50%,#ff6ec7 100%);
    --primary-soft:rgba(124,92,255,.11);
    --shadow-hover:0 12px 30px rgba(15,23,42,.10),0 1px 3px rgba(15,23,42,.04);
    --lcmd-ambient-bg:
      radial-gradient(circle at 14% 16%,rgba(124,92,255,.12),transparent 28%),
      radial-gradient(circle at 86% 7%,rgba(6,182,212,.10),transparent 30%),
      radial-gradient(circle at 52% 36%,rgba(20,184,166,.07),transparent 28%),
      linear-gradient(180deg,rgba(248,252,255,.72),rgba(248,252,255,.14) 54%,transparent);
    --lcmd-grid-line-a:rgba(79,70,229,.055);
    --lcmd-grid-line-b:rgba(20,184,166,.045);
    --lcmd-scan-line:linear-gradient(90deg,transparent,rgba(124,92,255,.24),rgba(6,182,212,.26),transparent);
    --lcmd-scan-shadow:0 0 14px rgba(124,92,255,.14),0 0 18px rgba(34,211,238,.10);
    --lcmd-page-bg:
      radial-gradient(900px 460px at 18% -12%,rgba(124,92,255,.10),transparent 66%),
      radial-gradient(820px 420px at 96% 0%,rgba(6,182,212,.08),transparent 64%),
      linear-gradient(180deg,#f7fbff 0%,#f3f7fb 48%,#f8fbff 100%);
    --lcmd-title-grad:linear-gradient(135deg,#172033 0%,#4f46e5 44%,#0891b2 100%);
    --lcmd-button-bg:color-mix(in srgb,var(--surface) 90%,var(--primary) 7%);
    --lcmd-card-bg:
      radial-gradient(380px 220px at 18% 0%,rgba(124,92,255,.11),transparent 62%),
      linear-gradient(160deg,rgba(6,182,212,.075),rgba(20,184,166,.045) 48%,rgba(124,92,255,.065)),
      var(--surface);
    --lcmd-panel-bg:
      radial-gradient(320px 170px at 0% 0%,rgba(124,92,255,.08),transparent 64%),
      linear-gradient(180deg,rgba(255,255,255,.78),rgba(255,255,255,.48)),
      var(--surface);
    --lcmd-row-bg:color-mix(in srgb,var(--surface) 88%,var(--cyan) 5%);
    --lcmd-row-hover:color-mix(in srgb,var(--surface-2) 82%,var(--cyan) 9%);
    --lcmd-row-strong:color-mix(in srgb,var(--surface) 82%,var(--primary) 8%);
    --lcmd-inset-shadow:0 0 0 1px rgba(15,23,42,.035) inset;
    --lcmd-note-text:#51617f;
    --lcmd-highlight:#0e7490;
    --lcmd-highlight-soft:rgba(14,116,144,.13);
    --lcmd-ring-core:#ffffff;
    --lcmd-hover-base:#0f172a;
    --lcmd-chart-axis:#64708c;
    --lcmd-chart-text:#172033;
    --lcmd-chart-label:#172033;
    --lcmd-chart-label-stroke:#ffffff;
    --lcmd-chart-callout-bg:rgba(255,255,255,.96);
    --lcmd-chart-callout-text:#172033;
    --lcmd-chart-callout-muted:#64708c;
    --lcmd-needle:#172033;
    --lcmd-dialog-bg:#ffffff;
    --lcmd-dialog-text:#172033;
    --lcmd-live-tip-bg:#ffffff;
    --lcmd-live-tip-text:#172033;
    position:relative;
    max-width:1360px;
    min-height:calc(100vh - var(--header-h));
    background:var(--lcmd-page-bg);
    overflow:hidden;
    font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;
    text-rendering:geometricPrecision;
  }
  [data-theme="dark"] .page.ddb-wrap.lcmd-page {
    --surface:#0b1022;
    --surface-2:#111a34;
    --surface-3:#182448;
    --text:#edf2ff;
    --muted:#a2acc8;
    --border:rgba(148,163,184,.18);
    --cyan:#22d3ee;
    --primary-soft:rgba(124,92,255,.16);
    --shadow-hover:0 18px 46px rgba(2,6,23,.34);
    --lcmd-ambient-bg:
      radial-gradient(circle at 14% 16%,rgba(124,92,255,.16),transparent 28%),
      radial-gradient(circle at 86% 7%,rgba(6,182,212,.13),transparent 30%),
      radial-gradient(circle at 52% 36%,rgba(20,184,166,.08),transparent 28%),
      linear-gradient(180deg,rgba(7,10,22,.56),rgba(7,10,22,.02) 54%,transparent);
    --lcmd-grid-line-a:rgba(124,92,255,.055);
    --lcmd-grid-line-b:rgba(20,184,166,.045);
    --lcmd-scan-line:linear-gradient(90deg,transparent,rgba(124,92,255,.44),rgba(34,211,238,.48),transparent);
    --lcmd-scan-shadow:0 0 18px rgba(124,92,255,.24),0 0 22px rgba(34,211,238,.18);
    --lcmd-page-bg:
      radial-gradient(900px 460px at 18% -12%,rgba(124,92,255,.18),transparent 66%),
      radial-gradient(820px 420px at 96% 0%,rgba(6,182,212,.12),transparent 64%),
      linear-gradient(180deg,#070a16 0%,#090e1d 48%,#070b18 100%);
    --lcmd-title-grad:linear-gradient(135deg,#f5f7ff 0%,#c7d2fe 35%,#67e8f9 100%);
    --lcmd-button-bg:rgba(17,26,52,.84);
    --lcmd-card-bg:
      radial-gradient(380px 220px at 18% 0%,rgba(124,92,255,.13),transparent 62%),
      linear-gradient(160deg,rgba(34,211,238,.05),rgba(20,184,166,.035) 48%,rgba(124,92,255,.07)),
      var(--surface);
    --lcmd-panel-bg:
      radial-gradient(320px 170px at 0% 0%,rgba(124,92,255,.09),transparent 64%),
      linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012)),
      var(--surface);
    --lcmd-row-bg:rgba(7,10,22,.64);
    --lcmd-row-hover:rgba(17,26,52,.92);
    --lcmd-row-strong:rgba(17,26,52,.72);
    --lcmd-inset-shadow:0 0 0 1px rgba(255,255,255,.025) inset;
    --lcmd-note-text:#cbd5ef;
    --lcmd-highlight:#8bdfff;
    --lcmd-highlight-soft:rgba(139,223,255,.13);
    --lcmd-ring-core:#0b1022;
    --lcmd-hover-base:#ffffff;
    --lcmd-chart-axis:#a2acc8;
    --lcmd-chart-text:#edf2ff;
    --lcmd-chart-label:#dbeafe;
    --lcmd-chart-label-stroke:#0b1022;
    --lcmd-chart-callout-bg:rgba(7,10,22,.88);
    --lcmd-chart-callout-text:#edf2ff;
    --lcmd-chart-callout-muted:#a2acc8;
    --lcmd-needle:#edf2ff;
    --lcmd-dialog-bg:#101827;
    --lcmd-dialog-text:#edf2ff;
    --lcmd-live-tip-bg:#0b1022;
    --lcmd-live-tip-text:#edf2ff;
  }
  .lcmd {
    position:relative;
    isolation:isolate;
    display:grid;
    gap:12px;
    color:var(--text);
    font-size:13px;
    line-height:1.45;
  }
  .lcmd button {
    font-family:inherit;
  }
  .lcmd .btn {
    border-color:var(--border);
    background:var(--lcmd-button-bg);
    color:var(--text);
  }
  .lcmd .btn.primary {
    border:0;
    color:#fff;
    background:var(--grad);
    box-shadow:0 10px 28px rgba(124,92,255,.22),0 0 22px rgba(20,184,166,.14);
  }
  .lcmd .btn.ghost {
    background:transparent;
    color:var(--muted);
  }
  .lcmd-topline {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12px;
    flex-wrap:wrap;
    padding:2px 0;
  }
  .lcmd-kicker {
    display:inline-flex;
    align-items:center;
    gap:7px;
    width:max-content;
    color:var(--lcmd-highlight);
    font-size:10px;
    font-weight:800;
    text-transform:uppercase;
    letter-spacing:.08em;
  }
  .lcmd-kicker::before {
    content:'';
    width:7px;
    height:7px;
    border-radius:999px;
    background:#14b8a6;
    box-shadow:0 0 12px rgba(20,184,166,.82);
    animation:lcmd-live 2s ease-in-out infinite;
  }
  .lcmd-title {
    margin-top:4px;
    font-size:28px;
    line-height:1.08;
    font-weight:800;
    background:var(--lcmd-title-grad);
    -webkit-background-clip:text;
    background-clip:text;
    color:transparent;
  }
  .lcmd-subtitle {
    margin-top:5px;
    color:var(--muted);
    font-size:12.5px;
    text-wrap:pretty;
  }
  .lcmd-top-actions {
    display:flex;
    align-items:center;
    justify-content:flex-end;
    gap:10px;
    flex-wrap:wrap;
  }
  .lcmd-top-actions .view-switch {
    margin-bottom:0;
    align-self:center;
  }
  .lcmd-refresh-state {
    display:inline-flex;
    align-items:center;
    justify-content:center;
    gap:6px;
    height:38px;
    padding:0 10px;
    border:1px solid var(--border);
    border-radius:12px;
    background:var(--lcmd-row-bg);
    color:var(--muted);
    font-size:11px;
    font-weight:750;
    white-space:nowrap;
    line-height:1;
  }
  .lcmd-refresh-state .ui-icon {
    width:13px;
    height:13px;
  }
  .lcmd-refresh-state.active .ui-icon {
    animation:lcmd-spin 1s linear infinite;
  }
  .lcmd-hero-grid {
    display:grid;
    grid-template-columns:minmax(276px,.74fr) minmax(0,1.86fr);
    gap:12px;
    align-items:stretch;
  }
  .lcmd-hero-side {
    display:grid;
    gap:10px;
    min-width:0;
  }
  .lcmd-card {
    position:relative;
    overflow:hidden;
    border:1px solid var(--border);
    border-radius:12px;
    background:var(--lcmd-card-bg);
    box-shadow:var(--lcmd-inset-shadow);
  }
  .lcmd-card::before {
    content:'';
    position:absolute;
    inset:0;
    pointer-events:none;
    background:
      linear-gradient(115deg,transparent 0%,rgba(124,92,255,.075) 42%,rgba(34,211,238,.06) 52%,transparent 64%),
      repeating-linear-gradient(90deg,rgba(148,163,184,.04) 0 1px,transparent 1px 96px);
    opacity:.68;
  }
  .lcmd-score-card {
    min-height:278px;
    height:100%;
    padding:14px;
    display:flex;
    flex-direction:column;
    justify-content:space-between;
    gap:10px;
  }
  .lcmd-score-card.danger {
    border-color:rgba(255,61,0,.36);
    box-shadow:0 0 20px rgba(255,61,0,.14),var(--lcmd-inset-shadow);
    animation:lcmd-red-pulse 3s ease-in-out infinite;
  }
  .lcmd-score-head,
  .lcmd-score-body,
  .lcmd-metric-grid,
  .lcmd-panel-inner {
    position:relative;
    z-index:1;
  }
  .lcmd-score-head {
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:12px;
  }
  .lcmd-score-title {
    color:var(--muted);
    font-size:10.5px;
    font-weight:800;
    text-transform:uppercase;
    letter-spacing:.08em;
  }
  .lcmd-score-note {
    margin-top:5px;
    max-width:260px;
    color:var(--lcmd-note-text);
    font-size:11.5px;
    font-style:italic;
    line-height:1.45;
    text-wrap:pretty;
  }
  .lcmd-score-body {
    flex:1;
    display:grid;
    place-items:center;
  }
  .lcmd-score-ring {
    position:relative;
    width:180px;
    height:180px;
    margin:4px auto 0;
    display:grid;
    place-items:center;
    border-radius:999px;
    box-shadow:0 0 0 1px color-mix(in srgb,var(--score-strong) 46%,transparent),0 0 36px var(--score-glow),0 0 70px color-mix(in srgb,var(--score-strong) 16%,transparent);
  }
  .lcmd-score-ring::before {
    content:'';
    position:absolute;
    inset:8px;
    border-radius:999px;
    background:radial-gradient(circle,color-mix(in srgb,var(--score-strong) 34%,transparent),transparent 68%);
    filter:blur(12px);
    opacity:.62;
    transform:scale(var(--score-scale,.95));
    pointer-events:none;
  }
  .lcmd-score-ring::after {
    content:'';
    position:absolute;
    inset:-4px;
    border-radius:999px;
    background:conic-gradient(from -90deg,color-mix(in srgb,var(--score-soft) 20%,transparent),var(--score-mid),var(--score-strong),color-mix(in srgb,var(--score-strong) 18%,transparent));
    opacity:.72;
    -webkit-mask:radial-gradient(circle,transparent 68%,#000 70%);
    mask:radial-gradient(circle,transparent 68%,#000 70%);
    pointer-events:none;
  }
  .lcmd-score-ring svg {
    width:180px;
    height:180px;
    transform:rotate(-90deg);
    overflow:visible;
    position:relative;
    z-index:1;
  }
  .lcmd-ring-track {
    fill:none;
    stroke:rgba(162,172,200,.20);
    stroke-width:18;
  }
  .lcmd-ring-value {
    fill:none;
    stroke:url(#lcmdScoreGradient);
    stroke-width:18;
    stroke-linecap:round;
    filter:drop-shadow(0 0 10px var(--score-glow)) drop-shadow(0 0 16px color-mix(in srgb,var(--score-strong) 22%,transparent));
    animation:lcmd-ring-load 1.1s cubic-bezier(.22,1,.36,1) both;
  }
  .lcmd-score-center {
    position:absolute;
    z-index:2;
    display:flex;
    flex-direction:column;
    align-items:center;
    gap:4px;
    max-width:106px;
    text-align:center;
  }
  .lcmd-score-number {
    font-size:44px;
    line-height:.95;
    font-weight:800;
    font-variant-numeric:tabular-nums;
    font-feature-settings:"tnum" 1;
    background:linear-gradient(135deg,color-mix(in srgb,var(--score-strong) 78%,#172033) 0%,var(--score-strong) 46%,color-mix(in srgb,var(--score-strong) 68%,#0f172a) 100%);
    -webkit-background-clip:text;
    background-clip:text;
    color:transparent;
    filter:none;
    text-shadow:none;
  }
  [data-theme="dark"] .lcmd-score-number {
    background:linear-gradient(135deg,#fffef2 0%,var(--score-mid) 42%,var(--score-strong) 100%);
    -webkit-background-clip:text;
    background-clip:text;
    filter:drop-shadow(0 0 8px color-mix(in srgb,var(--score-strong) 58%,transparent)) drop-shadow(0 0 18px var(--score-glow));
    text-shadow:0 0 18px color-mix(in srgb,var(--score-strong) 52%,transparent);
  }
  .lcmd-score-label {
    color:var(--muted);
    font-size:10px;
    font-weight:800;
    text-transform:uppercase;
    letter-spacing:.10em;
    line-height:1.18;
    max-width:96px;
    white-space:normal;
  }
  .lcmd-cursor {
    display:inline-block;
    width:1px;
    height:13px;
    margin-left:3px;
    vertical-align:-2px;
    background:var(--lcmd-highlight);
    animation:lcmd-cursor 1s steps(2,end) infinite;
  }
  .lcmd-score-actions {
    display:flex;
    gap:8px;
    flex-wrap:wrap;
  }
  .lcmd-metric-grid {
    display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:10px;
  }
  .lcmd-metric {
    --metric-color:#22d3ee;
    position:relative; overflow:hidden;
    min-height:102px;
    border:1px solid color-mix(in srgb,var(--metric-color) 30%,var(--border));
    border-radius:12px;
    background:
      radial-gradient(170px 110px at 8% 0%,color-mix(in srgb,var(--metric-color) 13%,transparent),transparent 66%),
      linear-gradient(180deg,rgba(255,255,255,.70),rgba(255,255,255,.38)),
      var(--surface);
    padding:11px 12px;
    color:var(--text);
    text-align:left;
    cursor:pointer;
    animation:ddb-pop .38s cubic-bezier(.34,1.2,.64,1) both;
    transition:transform .18s cubic-bezier(.34,1.2,.64,1),border-color .16s ease,background .16s ease,box-shadow .18s ease;
  }
  .lcmd-metric:nth-child(1) { animation-delay:.04s }
  .lcmd-metric:nth-child(2) { animation-delay:.09s }
  .lcmd-metric:nth-child(3) { animation-delay:.14s }
  .lcmd-metric:nth-child(4) { animation-delay:.19s }
  [data-theme="dark"] .lcmd-metric {
    background:
      radial-gradient(170px 110px at 8% 0%,color-mix(in srgb,var(--metric-color) 16%,transparent),transparent 66%),
      linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012)),
      var(--surface);
  }
  .lcmd-metric::after {
    content:''; position:absolute; inset:0; pointer-events:none; border-radius:inherit; z-index:2;
    background:linear-gradient(115deg,transparent 25%,rgba(255,255,255,.15) 50%,transparent 75%);
    transform:translateX(-110%); transition:transform 0s;
  }
  .lcmd-metric:hover::after { transform:translateX(110%); transition:transform .5s cubic-bezier(.4,0,.2,1); }
  .lcmd-metric:hover,
  .lcmd-metric:focus-visible {
    transform:translateY(-3px) scale(1.01);
    border-color:color-mix(in srgb,var(--metric-color) 60%,var(--lcmd-hover-base));
    box-shadow:0 16px 36px rgba(2,6,23,.22),0 0 20px color-mix(in srgb,var(--metric-color) 12%,transparent);
    outline:none;
  }
  .lcmd-metric-icon {
    width:27px;
    height:27px;
    display:grid;
    place-items:center;
    border-radius:9px;
    color:var(--metric-color);
    background:color-mix(in srgb,var(--metric-color) 14%,transparent);
  }
  .lcmd-metric-icon .ui-icon {
    width:16px;
    height:16px;
  }
  .lcmd-metric-top {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:8px;
    width:100%;
  }
  .lcmd-metric-badge {
    min-width:0;
    max-width:92px;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
    padding:3px 7px;
    border-radius:999px;
    color:var(--metric-color);
    background:color-mix(in srgb,var(--metric-color) 13%,transparent);
    font-size:10px;
    font-weight:850;
  }
  .lcmd-metric-label {
    margin-top:8px;
    color:var(--muted);
    font-size:10px;
    font-weight:800;
    text-transform:uppercase;
    letter-spacing:.06em;
    line-height:1.25;
    text-wrap:balance;
  }
  .lcmd-metric-value {
    margin-top:5px;
    font-size:25px;
    line-height:1;
    font-weight:800;
    color:var(--text);
    font-variant-numeric:tabular-nums;
    font-feature-settings:"tnum" 1;
  }
  .lcmd-metric-sub {
    margin-top:5px;
    min-height:16px;
    color:var(--muted);
    font-size:11px;
    font-weight:650;
    line-height:1.35;
    text-wrap:pretty;
  }
  .lcmd-metric-mini {
    display:block;
    width:100%;
    height:5px;
    margin-top:8px;
    border-radius:999px;
    overflow:hidden;
    background:rgba(162,172,200,.16);
  }
  .lcmd-metric-mini span {
    display:block;
    height:100%;
    border-radius:inherit;
    background:var(--metric-color);
    box-shadow:0 0 12px color-mix(in srgb,var(--metric-color) 28%,transparent);
    animation:ddb-fill .72s cubic-bezier(.22,1,.36,1) both;
    transform-origin:left;
  }
  .lcmd-live {
    display:inline-flex;
    align-items:center;
    gap:5px;
    margin-top:8px;
    color:var(--metric-color);
    max-width:100%;
    font-size:10.5px;
    font-weight:800;
    line-height:1.25;
    overflow-wrap:anywhere;
  }
  .lcmd-live-info {
    position:relative;
    display:inline-grid;
    place-items:center;
    width:15px;
    height:15px;
    margin-left:1px;
    border-radius:999px;
    border:1px solid currentColor;
    font-size:10px;
    line-height:1;
    opacity:.86;
  }
  .lcmd-live-info .ui-icon {
    width:11px;
    height:11px;
    stroke-width:2.3;
  }
  .lcmd-live-tip {
    position:absolute;
    left:50%;
    bottom:calc(100% + 8px);
    width:min(250px,calc(100vw - 44px));
    transform:translate(-50%,4px);
    z-index:40;
    padding:8px 9px;
    border:1px solid color-mix(in srgb,var(--lcmd-highlight) 24%,var(--border));
    border-radius:9px;
    background:var(--lcmd-live-tip-bg);
    color:var(--lcmd-live-tip-text);
    box-shadow:0 12px 30px rgba(2,6,23,.34);
    font-size:11px;
    font-weight:650;
    line-height:1.35;
    text-transform:none;
    letter-spacing:0;
    opacity:0;
    pointer-events:none;
    transition:opacity .15s ease,transform .15s ease;
  }
  .lcmd-live:hover .lcmd-live-tip,
  .lcmd-live:focus-within .lcmd-live-tip {
    opacity:1;
    transform:translate(-50%,0);
  }
  .lcmd-live.up { color:#14b8a6; }
  .lcmd-live.down { color:#ff6b3d; }
  .lcmd-live.flat { color:var(--muted); }
  .lcmd-live-arrow {
    display:inline-grid;
    place-items:center;
    width:16px;
    height:16px;
    flex-shrink:0;
    border-radius:6px;
    background:color-mix(in srgb,currentColor 14%,transparent);
  }
  .lcmd-live-arrow .ui-icon { width:12px; height:12px; stroke-width:2.25; }
  .lcmd-alert {
    position:relative;
    display:flex;
    align-items:center;
    gap:10px;
    min-height:46px;
    padding:10px 12px;
    border:1px solid rgba(255,61,0,.26);
    border-left:3px solid #ff3d00;
    border-radius:12px;
    background:linear-gradient(90deg,rgba(255,61,0,.10),rgba(255,61,0,.025));
    color:var(--text);
    font-size:12.5px;
    line-height:1.45;
    animation:ddb-up .24s ease both;
  }
  .lcmd-alert.ok {
    border-color:rgba(0,230,118,.22);
    border-left-color:#14b8a6;
    background:linear-gradient(90deg,rgba(20,184,166,.11),rgba(124,92,255,.045));
  }
  .lcmd-alert.watch {
    border-color:rgba(255,179,0,.28);
    border-left-color:#ffb300;
    background:linear-gradient(90deg,rgba(255,179,0,.10),rgba(124,92,255,.035));
  }
  .lcmd-alert .ui-icon {
    width:17px;
    height:17px;
    color:#ff3d00;
    flex-shrink:0;
  }
  .lcmd-alert.ok .ui-icon {
    color:#14b8a6;
  }
  .lcmd-alert.watch .ui-icon {
    color:#ffb300;
  }
  .lcmd-alert-copy {
    min-width:0;
    display:grid;
    gap:2px;
  }
  .lcmd-alert-copy strong {
    color:var(--text);
    font-size:12.5px;
    line-height:1.35;
    text-wrap:pretty;
  }
  .lcmd-alert-copy em {
    color:var(--muted);
    font-size:11.5px;
    font-style:italic;
    line-height:1.35;
    text-wrap:pretty;
  }
  .lcmd-alert-actions {
    margin-left:auto;
    display:inline-flex;
    gap:10px;
    flex-wrap:wrap;
    flex-shrink:0;
  }
  .lcmd-alert-actions .lcmd-inline {
    white-space:nowrap;
  }
  .lcmd-inline {
    border:0;
    padding:0;
    background:transparent;
    color:var(--lcmd-highlight);
    font:inherit;
    font-weight:700;
    cursor:pointer;
    text-decoration:none;
  }
  .lcmd-inline:hover,
  .lcmd-inline:focus-visible {
    color:var(--violet);
    outline:none;
  }
  .lcmd-main-grid {
    display:grid;
    grid-template-columns:minmax(0,1fr);
    gap:12px;
  }
  .lcmd-panel {
    min-width:0;
    padding:12px;
    border:1px solid var(--border);
    border-radius:12px;
    background:var(--lcmd-panel-bg);
    box-shadow:var(--lcmd-inset-shadow);
  }
  .lcmd .ddb-gauge-wrap {
    min-height:150px;
    gap:11px;
    padding:0;
  }
  .lcmd .ddb-burnout-top {
    gap:10px;
  }
  .lcmd .ddb-burnout-score {
    font-size:36px;
  }
  .lcmd .ddb-burnout-track {
    height:10px;
  }
  .lcmd .ddb-burnout-stats {
    gap:10px;
  }
  .lcmd .ddb-burnout-stat {
    padding-top:7px;
  }
  .lcmd .ddb-burnout-note {
    display:grid;
    gap:3px;
    padding:7px 9px;
    border:1px solid color-mix(in srgb,var(--lcmd-highlight) 22%,var(--border));
    border-radius:9px;
    background:var(--lcmd-row-bg);
    color:var(--muted);
    font-size:10.8px;
    line-height:1.34;
    text-wrap:pretty;
  }
  .lcmd .ddb-burnout-note em {
    color:var(--text);
    font-style:italic;
  }
  .lcmd-panel-head {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:10px;
    margin-bottom:9px;
  }
  .lcmd-panel-title {
    display:flex;
    align-items:center;
    gap:8px;
    color:var(--text);
    font-size:12px;
    font-weight:800;
    text-transform:uppercase;
    letter-spacing:.06em;
  }
  .lcmd-panel-title .ui-icon {
    width:16px;
    height:16px;
    color:var(--lcmd-highlight);
  }
  .lcmd-chart {
    width:100%;
    height:266px;
    display:block;
    overflow:visible;
  }
  .lcmd-bar {
    cursor:pointer;
    transform-origin:bottom;
    transform-box:fill-box;
    animation:ddb-bar-rise .64s cubic-bezier(.22,1,.36,1) both;
  }
  .lcmd-bar-hit {
    cursor:pointer;
    fill:transparent;
  }
  .lcmd-axis-label {
    fill:var(--lcmd-chart-axis);
    font-size:10.5px;
    font-weight:750;
  }
  .lcmd-target-line {
    stroke-dasharray:7 7;
  }
  .lcmd-chart-legend {
    display:flex;
    align-items:center;
    gap:10px;
    flex-wrap:wrap;
    margin:-3px 0 8px;
    color:var(--muted);
    font-size:10.5px;
    font-weight:750;
  }
  .lcmd-chart-legend span {
    display:inline-flex;
    align-items:center;
    gap:5px;
    white-space:nowrap;
  }
  .lcmd-period-badge {
    display:inline-flex;
    align-items:center;
    min-height:26px;
    padding:4px 8px;
    border:1px solid var(--border);
    border-radius:999px;
    background:var(--lcmd-row-bg);
    color:var(--muted);
    font-size:11px;
    font-weight:800;
    white-space:nowrap;
  }
  .lcmd-legend-mark {
    width:18px;
    height:3px;
    border-radius:999px;
    background:#22d3ee;
  }
  .lcmd-legend-mark.bar {
    width:9px;
    height:11px;
    border-radius:3px;
  }
  .lcmd-legend-mark.target {
    background:repeating-linear-gradient(90deg,var(--lcmd-chart-axis) 0 5px,transparent 5px 8px);
  }
  .lcmd-legend-mark.zero {
    width:10px;
    height:10px;
    border-radius:3px;
    background:linear-gradient(135deg,rgba(255,61,0,.62),rgba(255,179,0,.38));
  }
  .lcmd-legend-mark.trend {
    height:3px;
    width:20px;
    background:var(--lcmd-highlight);
    box-shadow:0 0 10px color-mix(in srgb,var(--lcmd-highlight) 42%,transparent);
  }
  .lcmd-trend-layer { pointer-events:none; }
  .lcmd-trend-line {
    fill:none;
    stroke:var(--lcmd-highlight);
    stroke-width:2.8;
    stroke-linecap:round;
    stroke-linejoin:round;
    filter:drop-shadow(0 0 10px color-mix(in srgb,var(--lcmd-highlight) 42%,transparent));
    stroke-dasharray:1800;
    stroke-dashoffset:1800;
    animation:lcmd-trend-draw 1.2s cubic-bezier(.22,1,.36,1) .2s forwards;
  }
  .lcmd-area-fill {
    fill:url(#lcmdAreaGrad);
    pointer-events:none;
    animation:ddb-up .8s ease .3s both;
  }
  .lcmd-trend-dot {
    fill:var(--lcmd-ring-core);
    stroke:var(--lcmd-highlight);
    stroke-width:1.8;
    opacity:.82;
  }
  .lcmd-trend-dot.active {
    fill:var(--lcmd-highlight);
    animation:lcmd-trend-pulse 1.6s ease-in-out infinite;
  }
  .lcmd-trend-node {
    pointer-events:all;
    cursor:pointer;
  }
  .lcmd-trend-hit {
    fill:rgba(139,223,255,.001);
    pointer-events:all;
  }
  .lcmd-trend-label {
    fill:var(--lcmd-chart-label);
    font-size:8.8px;
    font-weight:850;
    paint-order:stroke;
    stroke:var(--lcmd-chart-label-stroke);
    stroke-width:3px;
    stroke-linejoin:round;
  }
  .lcmd-bar-label {
    fill:var(--lcmd-chart-callout-text);
    font-size:9px;
    font-weight:850;
    paint-order:stroke;
    stroke:var(--lcmd-chart-label-stroke);
    stroke-width:3px;
    stroke-linejoin:round;
  }
  .lcmd-bar-score {
    fill:var(--lcmd-chart-text);
    font-size:10.5px;
    font-weight:850;
    paint-order:stroke;
    stroke:var(--lcmd-chart-label-stroke);
    stroke-width:3.5px;
    stroke-linejoin:round;
    pointer-events:none;
    transition:opacity .18s;
  }
  .lcmd-bar-glow {
    pointer-events:none;
    filter:blur(7px);
    opacity:.24;
  }
  .lcmd-tip-chips {
    display:flex; align-items:center; gap:6px; flex-wrap:wrap;
  }
  .lcmd-tip-chip {
    display:inline-flex; align-items:center; gap:5px;
    padding:4px 10px; border-radius:999px;
    border:1px solid var(--border); background:var(--surface-2);
    color:var(--muted); font-size:11px; font-weight:750;
    white-space:nowrap;
    animation:ddb-up .28s ease both;
  }
  .lcmd-tip-chip.period { color:var(--text); font-weight:800; border-color:transparent; background:transparent; padding-left:0; }
  .lcmd-tip-chip b { color:var(--text); font-weight:850; }
  .lcmd-tip-chip.trend { color:var(--lcmd-highlight); border-color:color-mix(in srgb,var(--lcmd-highlight) 26%,var(--border)); }
  .lcmd-tip-chip.pos { color:#22c55e; border-color:color-mix(in srgb,#22c55e 26%,var(--border)); }
  .lcmd-tip-chip.neg { color:#ef4444; border-color:color-mix(in srgb,#ef4444 26%,var(--border)); }
  .lcmd-tip-chip.formula { font-style:italic; font-size:10.5px; color:var(--lcmd-highlight); border-color:transparent; background:transparent; }
  .lcmd-chart-callout {
    pointer-events:none;
  }
  .lcmd-chart-callout rect {
    fill:var(--lcmd-chart-callout-bg);
    stroke:color-mix(in srgb,var(--lcmd-highlight) 36%,var(--border));
    stroke-width:1;
    filter:drop-shadow(0 12px 24px rgba(0,0,0,.28));
  }
  .lcmd-chart-callout text {
    fill:var(--lcmd-chart-callout-text);
    font-size:10px;
    font-weight:800;
  }
  .lcmd-chart-callout .muted {
    fill:var(--lcmd-chart-callout-muted);
    font-size:9.2px;
    font-weight:750;
  }
  .lcmd-tip {
    min-height:34px;
    padding:8px 10px;
    border:1px solid var(--border);
    border-radius:10px;
    background:var(--lcmd-row-bg);
    color:var(--muted);
    font-size:12px;
    line-height:1.45;
    text-wrap:pretty;
  }
  .lcmd-tip b {
    color:var(--text);
  }
  .lcmd-tip-row {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:10px;
  }
  .lcmd-tip-main {
    min-width:0;
  }
  .lcmd-tip-formula {
    display:block;
    margin-top:4px;
    color:var(--lcmd-highlight);
    font-size:11px;
    font-style:italic;
    text-wrap:pretty;
  }
  .lcmd-category-list {
    display:grid;
    gap:8px;
  }
  .lcmd-category {
    --cat-color:#22d3ee;
    border:0;
    border-radius:10px;
    padding:9px 10px;
    background:var(--lcmd-row-bg);
    color:var(--text);
    text-align:left;
    cursor:pointer;
    transition:background .16s ease,transform .16s ease;
  }
  .lcmd-category:hover,
  .lcmd-category:focus-visible {
    background:var(--lcmd-row-hover);
    transform:translateY(-1px);
    outline:1px solid color-mix(in srgb,var(--cat-color) 44%,var(--border));
  }
  .lcmd-category-top {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:10px;
    margin-bottom:8px;
  }
  .lcmd-category-name {
    min-width:0;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
    font-size:13px;
    font-weight:700;
  }
  .lcmd-category-value {
    color:var(--cat-color);
    font-size:14px;
    font-weight:800;
    font-variant-numeric:tabular-nums;
  }
  .lcmd-category-meta {
    color:var(--muted);
    font-size:11px;
    margin-bottom:7px;
  }
  .lcmd-track {
    height:8px;
    overflow:hidden;
    border-radius:999px;
    background:rgba(162,172,200,.18);
  }
  .lcmd-fill {
    height:100%;
    width:0;
    border-radius:inherit;
    background:linear-gradient(90deg,var(--cat-color),#7c5cff 55%,#22d3ee);
    animation:ddb-fill .9s cubic-bezier(.22,1,.36,1) both;
    transform-origin:left;
  }
  .lcmd-bottom-grid {
    display:grid;
    grid-template-columns:1.02fr 1fr 1fr;
    gap:12px;
  }
  .lcmd-secondary-grid {
    display:grid;
    grid-template-columns:minmax(0,1fr);
    gap:12px;
  }
  .lcmd-risk-list,
  .lcmd-journal-list {
    display:grid;
    gap:8px;
  }
  .lcmd-risk-row {
    --risk-color:#ff3d00;
    display:grid;
    grid-template-columns:28px minmax(0,1fr);
    gap:8px;
    align-items:center;
    border:1px solid var(--border);
    border-radius:10px;
    padding:8px 9px;
    background:var(--lcmd-row-bg);
    color:var(--text);
    text-align:left;
    cursor:pointer;
    animation:ddb-up .32s ease both;
    transition:transform .14s ease,border-color .14s ease,box-shadow .14s ease;
  }
  .lcmd-risk-row:nth-child(2) { animation-delay:.06s }
  .lcmd-risk-row:nth-child(3) { animation-delay:.12s }
  .lcmd-risk-row:nth-child(4) { animation-delay:.18s }
  .lcmd-risk-row:hover { transform:translateX(2px); border-color:color-mix(in srgb,var(--risk-color) 38%,var(--border)); }
  .lcmd-risk-row:first-child {
    border-color:rgba(255,61,0,.32);
    box-shadow:0 0 18px rgba(255,61,0,.12);
  }
  .lcmd-risk-row.urgent {
    border-color:color-mix(in srgb,var(--risk-color) 42%,var(--border));
    background:linear-gradient(90deg,color-mix(in srgb,var(--risk-color) 12%,transparent),var(--lcmd-row-bg));
  }
  .lcmd-risk-row.urgent .lcmd-risk-index {
    color:var(--risk-color);
    animation:ddb-urgent-blink 2.2s ease-in-out infinite;
  }
  .lcmd-risk-criteria {
    margin:-3px 0 9px;
    color:var(--muted);
    font-size:11.5px;
    line-height:1.45;
    font-style:italic;
    text-wrap:pretty;
  }
  .lcmd-risk-index {
    color:var(--muted);
    font-size:12px;
    font-weight:800;
    font-variant-numeric:tabular-nums;
  }
  .lcmd-risk-name {
    display:flex;
    align-items:center;
    gap:7px;
    min-width:0;
    font-size:12px;
    font-weight:700;
  }
  .lcmd-risk-name-text {
    min-width:0;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
  }
  .lcmd-risk-chip {
    flex-shrink:0;
    padding:2px 6px;
    border-radius:999px;
    background:color-mix(in srgb,var(--risk-color) 14%,transparent);
    color:var(--risk-color);
    font-size:9.5px;
    font-weight:850;
  }
  .lcmd-risk-meta {
    display:grid;
    grid-template-columns:minmax(54px,1fr) auto auto;
    align-items:center;
    gap:7px;
    margin-top:6px;
    color:var(--muted);
    font-size:10.5px;
  }
  .lcmd-risk-bar {
    min-width:54px;
    height:5px;
    overflow:hidden;
    border-radius:999px;
    background:rgba(162,172,200,.18);
  }
  .lcmd-risk-bar span {
    display:block;
    height:100%;
    border-radius:inherit;
    background:linear-gradient(90deg,var(--risk-color),#ffb300);
  }
  .lcmd-risk-delta {
    color:var(--risk-color);
    font-size:11.5px;
    font-weight:800;
    font-variant-numeric:tabular-nums;
  }
  .lcmd-risk-reason {
    display:block;
    margin-top:4px;
    color:var(--muted);
    font-size:10.5px;
    line-height:1.35;
    font-style:italic;
    text-wrap:pretty;
  }
  .lcmd-journal-row {
    width:100%;
    display:grid;
    grid-template-columns:auto minmax(0,1fr) auto;
    align-items:center;
    gap:9px;
    padding:9px 8px;
    border:1px solid transparent;
    border-bottom-color:var(--border);
    border-radius:9px;
    background:transparent;
    color:inherit;
    font:inherit;
    text-align:left;
    cursor:pointer;
    transition:background .16s ease,border-color .16s ease,box-shadow .16s ease;
  }
  .lcmd-journal-row:last-child {
    border-bottom-color:transparent;
  }
  .lcmd-journal-row:hover,
  .lcmd-journal-row:focus-visible,
  .lcmd-journal-row.is-active {
    border-color:rgba(34,211,238,.26);
    background:rgba(14,165,233,.08);
    box-shadow:0 0 18px rgba(34,211,238,.08);
    outline:none;
  }
  .lcmd-journal-icon {
    width:25px;
    height:25px;
    display:grid;
    place-items:center;
    border-radius:8px;
    color:var(--lcmd-highlight);
    background:rgba(124,92,255,.14);
  }
  .lcmd-journal-icon .ui-icon {
    width:14px;
    height:14px;
  }
  .lcmd-journal-title {
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
    color:var(--text);
    font-size:12px;
    font-weight:600;
  }
  .lcmd-journal-date {
    color:var(--muted);
    font-size:10.5px;
    white-space:nowrap;
  }
  .lcmd-journal-detail {
    margin-top:10px;
    padding:10px;
    border:1px solid color-mix(in srgb,var(--lcmd-highlight) 25%,var(--border));
    border-radius:10px;
    background:var(--lcmd-row-strong);
    box-shadow:0 16px 34px rgba(15,23,42,.12);
  }
  .lcmd-journal-detail-head {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:10px;
    margin-bottom:9px;
  }
  .lcmd-journal-detail-title {
    min-width:0;
    color:var(--text);
    font-size:12.5px;
    font-weight:850;
    line-height:1.3;
  }
  .lcmd-journal-detail-close {
    width:28px;
    height:28px;
    display:grid;
    place-items:center;
    border:1px solid var(--border);
    border-radius:8px;
    background:var(--lcmd-row-bg);
    color:var(--muted);
    cursor:pointer;
  }
  .lcmd-journal-detail-close:hover,
  .lcmd-journal-detail-close:focus-visible {
    color:var(--text);
    border-color:rgba(34,211,238,.32);
    outline:none;
  }
  .lcmd-journal-detail-close .ui-icon {
    width:14px;
    height:14px;
  }
  .lcmd-journal-detail-grid {
    display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:8px;
  }
  .lcmd-journal-detail-field {
    min-width:0;
    padding:8px;
    border:1px solid rgba(148,163,184,.14);
    border-radius:8px;
    background:color-mix(in srgb,var(--surface) 86%,var(--surface-3) 14%);
  }
  .lcmd-journal-detail-field span {
    display:block;
    color:var(--muted);
    font-size:10px;
    font-weight:800;
    text-transform:uppercase;
  }
  .lcmd-journal-detail-field b {
    display:block;
    margin-top:3px;
    color:var(--text);
    font-size:11.5px;
    font-weight:750;
    line-height:1.35;
    overflow-wrap:anywhere;
  }
  .lcmd-journal-detail-note {
    margin-top:8px;
    color:var(--muted);
    font-size:11.5px;
    line-height:1.45;
    font-style:italic;
    text-wrap:pretty;
  }
  .lcmd-journal-detail-actions {
    margin-top:10px;
    display:flex;
    justify-content:flex-end;
  }
  @media (max-width:640px) {
    .lcmd-journal-detail-grid {
      grid-template-columns:minmax(0,1fr);
    }
  }
  .lcmd-period-panel .ddb-drawer-body {
    display:grid;
    gap:12px;
  }
  .lcmd-period-summary {
    display:grid;
    grid-template-columns:repeat(4,minmax(0,1fr));
    gap:8px;
  }
  .lcmd-period-stat {
    padding:10px;
    border:1px solid var(--border);
    border-radius:10px;
    background:var(--lcmd-row-bg);
  }
  .lcmd-period-stat span {
    display:block;
    color:var(--muted);
    font-size:10px;
    font-weight:800;
    text-transform:uppercase;
    letter-spacing:.06em;
  }
  .lcmd-period-stat b {
    display:block;
    margin-top:5px;
    color:var(--text);
    font-size:18px;
    line-height:1;
    font-variant-numeric:tabular-nums;
  }
  .lcmd-period-stat em {
    display:block;
    margin-top:6px;
    color:var(--muted);
    font-style:italic;
    font-size:10.5px;
    line-height:1.35;
    text-transform:none;
    letter-spacing:0;
    text-wrap:pretty;
  }
  .lcmd-period-explain {
    padding:10px 11px;
    border:1px solid color-mix(in srgb,var(--lcmd-highlight) 24%,var(--border));
    border-radius:10px;
    background:var(--lcmd-row-strong);
    color:var(--text);
    font-size:12px;
    font-style:italic;
    line-height:1.5;
  }
  .lcmd-period-list {
    display:grid;
    gap:8px;
  }
  .lcmd-period-kpi {
    display:grid;
    grid-template-columns:minmax(0,1fr) auto;
    gap:8px;
    align-items:center;
    padding:10px;
    border:1px solid var(--border);
    border-radius:10px;
    background:var(--lcmd-row-bg);
    color:var(--text);
  }
  .lcmd-period-kpi strong {
    display:block;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
    font-size:12.5px;
  }
  .lcmd-period-kpi small {
    display:block;
    margin-top:3px;
    color:var(--muted);
    font-size:11px;
  }
  .lcmd-period-kpi b {
    display:block;
    color:var(--lcmd-highlight);
    font-size:13px;
    font-variant-numeric:tabular-nums;
  }
  .lcmd-period-kpi > .lcmd-inline {
    display:grid;
    gap:3px;
    justify-items:end;
    text-align:right;
    white-space:nowrap;
  }
  .lcmd-period-kpi > .lcmd-inline span {
    color:var(--muted);
    font-size:11px;
    font-weight:750;
  }
  .lcmd-period-actions {
    display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:8px;
  }
  .lcmd-period-actions .btn {
    justify-content:center;
    min-height:36px;
    white-space:nowrap;
  }
  .lcmd-confirm-backdrop {
    position:fixed;
    inset:0;
    z-index:1200;
    display:grid;
    place-items:center;
    padding:18px;
    background:rgba(3,7,18,.58);
    backdrop-filter:blur(8px);
    -webkit-backdrop-filter:blur(8px);
  }
  .lcmd-confirm-dialog {
    --lcmd-confirm-accent:var(--lcmd-highlight, var(--accent, #22d3ee));
    width:min(420px,100%);
    display:grid;
    grid-template-columns:auto minmax(0,1fr);
    gap:12px;
    padding:14px;
    position:relative;
    isolation:isolate;
    border:2px solid color-mix(in srgb,var(--lcmd-confirm-accent) 72%,var(--border));
    border-radius:12px;
    background:
      linear-gradient(180deg,color-mix(in srgb,var(--surface) 88%,var(--lcmd-confirm-accent) 12%),var(--surface));
    color:var(--text);
    box-shadow:
      0 0 0 1px color-mix(in srgb,var(--lcmd-confirm-accent) 26%,transparent) inset,
      0 24px 70px rgba(2,6,23,.42),
      0 0 34px color-mix(in srgb,var(--lcmd-confirm-accent) 22%,transparent);
    animation:ddb-up .18s ease both;
  }
  .lcmd-confirm-dialog::before {
    content:'';
    position:absolute;
    inset:-3px;
    border:1px solid color-mix(in srgb,var(--lcmd-confirm-accent) 42%,transparent);
    border-radius:14px;
    pointer-events:none;
  }
  .lcmd-confirm-icon {
    width:34px;
    height:34px;
    display:grid;
    place-items:center;
    border-radius:10px;
    color:var(--lcmd-confirm-accent);
    background:rgba(34,211,238,.12);
  }
  .lcmd-confirm-icon .ui-icon { width:18px; height:18px; }
  .lcmd-confirm-copy {
    display:grid;
    gap:5px;
    min-width:0;
  }
  .lcmd-confirm-copy strong {
    font-size:14px;
  }
  .lcmd-confirm-copy span {
    color:var(--muted);
    font-size:12.5px;
    line-height:1.45;
    text-wrap:pretty;
  }
  .lcmd-confirm-actions {
    grid-column:1 / -1;
    display:flex;
    justify-content:flex-end;
    gap:8px;
    flex-wrap:wrap;
  }
  @keyframes lcmd-ring-load {
    from { stroke-dasharray:0 999; }
  }
  @keyframes lcmd-spin {
    to { transform:rotate(360deg); }
  }
  @keyframes lcmd-trend-draw {
    to { stroke-dashoffset:0; }
  }
  @keyframes lcmd-trend-pulse {
    0%,100% { opacity:1; filter:drop-shadow(0 0 4px rgba(139,223,255,.42)); }
    50% { opacity:.58; filter:drop-shadow(0 0 12px rgba(139,223,255,.65)); }
  }
  @keyframes lcmd-live {
    0%,100% { opacity:1; transform:scale(1); }
    50% { opacity:.35; transform:scale(.72); }
  }
  @keyframes lcmd-cursor {
    0%,45% { opacity:1; }
    46%,100% { opacity:0; }
  }
  @keyframes lcmd-red-pulse {
    0%,100% { box-shadow:0 0 12px rgba(255,61,0,.12),0 0 0 1px rgba(255,255,255,.025) inset; }
    50% { box-shadow:0 0 26px rgba(255,61,0,.28),0 0 0 1px rgba(255,255,255,.025) inset; }
  }
  @media(max-width:960px){
    .lcmd-hero-grid,
    .lcmd-main-grid { grid-template-columns:1fr; }
  }
  @media(max-width:820px){
    .lcmd-bottom-grid { grid-template-columns:1fr; }
  }
  @media(max-width:560px){
    .lcmd-topline { align-items:flex-start; }
    .lcmd-top-actions { width:100%; justify-content:space-between; }
    .lcmd-refresh-state { max-width:100%; }
    .lcmd-title { font-size:22px; }
    .lcmd-score-card { min-height:260px; }
    .lcmd-score-ring,
    .lcmd-score-ring svg { width:148px; height:148px; }
    .lcmd-score-number { font-size:31px; }
    .lcmd-metric-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
    .lcmd-metric { min-height:104px; }
    .lcmd-live-tip { display:none; }
    .lcmd-alert { align-items:flex-start; flex-direction:column; }
    .lcmd-alert-actions { margin-left:0; }
    .lcmd-chart { height:190px; }
    .lcmd-risk-meta { grid-template-columns:minmax(48px,1fr) auto; }
    .lcmd-risk-delta { justify-self:start; }
    .lcmd-tip-row { align-items:flex-start; flex-direction:column; }
    .lcmd-period-summary { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .lcmd-period-kpi { grid-template-columns:1fr; }
  }
  @media(prefers-reduced-motion:reduce){
    .ddb-wrap *, .ddb-wrap *::before, .ddb-wrap *::after {
      animation-duration:.01ms !important; animation-iteration-count:1 !important; transition-duration:.01ms !important;
    }
    .ldb-ambient { display:none; }
  }
  @media(max-width:1080px){
    .ldb-command-grid,
    .ldb-bottom-grid { grid-template-columns:1fr; }
  }
  @media(max-width:720px){
    .page.ddb-wrap { gap:14px; }
    .ddb-panel { padding:16px; }
    .ldb-alert { align-items:flex-start; flex-direction:column; }
    .ldb-alert-actions { margin-left:0; justify-content:flex-start; }
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

function toneColor(tone) {
    if (tone === 'red') return '#fb7185'
    if (tone === 'yellow') return '#f59e0b'
    if (tone === 'green') return '#14b8a6'
    return '#14b8a6'
}

function metricIcon(key) {
    if (key === 'overall_score') return 'target'
    if (key === 'on_track') return 'checkCircle'
    if (key === 'target_achievement') return 'flag'
    if (key === 'at_risk') return 'warning'
    return 'target'
}

function metricLabel(key, tr) {
    return tr(`output.metric_${key}`)
}

function metricDetail(key, tr) {
    return tr(`output.metric_${key}_tip`)
}

function metricFormula(key, tr) {
    return tr(`output.metric_${key}_formula`)
}

function fallbackOutputMetrics(data, visible) {
    const total = visible.length
    const green = visible.filter(s => s.health === 'green').length
    const risky = visible.filter(s => s.health !== 'green').length
    const targetHits = visible.filter(s => s.kpi.progress >= 100).length
    const targetAchievement = total ? Math.round(targetHits / total * 1000) / 10 : 0
    const onTrackPct = total ? Math.round(green / total * 1000) / 10 : 0
    const score = Number(data?.overall_progress || 0)
    return [
        { key: 'overall_score', value: score, value_text: `${score}%`, unit: '%', tone: score < 70 ? 'red' : score < 90 ? 'yellow' : 'green', action: 'reports' },
        { key: 'on_track', value: onTrackPct, value_text: `${green}/${total}`, unit: 'kpis', tone: onTrackPct < 45 ? 'red' : onTrackPct < 70 ? 'yellow' : 'green', action: 'filter_on_track' },
        { key: 'target_achievement', value: targetAchievement, value_text: `${targetAchievement}%`, unit: '%', tone: targetAchievement < 70 ? 'red' : targetAchievement < 90 ? 'yellow' : 'green', action: 'kpis' },
        { key: 'at_risk', value: total ? Math.round(risky / total * 1000) / 10 : 0, value_text: `${risky}`, unit: 'kpis', tone: risky ? 'red' : 'green', action: 'open_risks' },
    ]
}

function OutputMetricCard({ metric, tr, onAction }) {
    const value = clampPct(metric?.value ?? 0)
    const counted = useCountUp(value)
    const color = toneColor(metric?.tone)
    const r = 39
    const circum = 2 * Math.PI * r
    const filled = circum * (value / 100)
    const rawText = metric?.value_text || `${counted}${metric?.unit === '%' ? '%' : ''}`
    const clickable = !!metric?.action
    return (
        <button
            type="button"
            className={`ddb-output-metric${clickable ? ' clickable' : ''}`}
            style={{ '--metric-color': color }}
            onClick={() => clickable && onAction(metric)}
            aria-label={`${metricLabel(metric.key, tr)}: ${rawText}`}
        >
            <span className="ddb-output-metric-top">
                <span className="ddb-output-metric-icon"><UiIcon name={metricIcon(metric.key)} /></span>
                <span className="ddb-output-metric-label">{metricLabel(metric.key, tr)}</span>
            </span>
            <span className="ddb-output-ring" aria-hidden="true">
                <svg viewBox="0 0 96 96">
                    <circle className="ddb-output-ring-track" cx="48" cy="48" r={r} />
                    <circle
                        className="ddb-output-ring-value"
                        cx="48" cy="48" r={r}
                        strokeDasharray={`${filled} ${circum - filled}`}
                    />
                </svg>
                <span className="ddb-output-ring-center">
                    <span className="ddb-output-ring-value-text">{rawText}</span>
                    <span className="ddb-output-ring-unit">{metric?.unit || 'score'}</span>
                </span>
            </span>
            <span className="ddb-output-metric-delta">
                {metric?.delta_pct == null
                    ? <span>{tr('output.metric_live')}</span>
                    : <>
                        <UiIcon name={metric.delta_pct >= 0 ? 'arrowRight' : 'chartDown'} />
                        <span>{metric.delta_pct >= 0 ? '+' : ''}{metric.delta_pct}%</span>
                    </>}
            </span>
            <span className="ddb-output-metric-tip">
                {metricDetail(metric.key, tr)}
                <span className="ddb-formula-line" style={{ '--metric-color': color }}>{metricFormula(metric.key, tr)}</span>
            </span>
        </button>
    )
}

function fallbackPerformancePoints(data) {
    const current = clampPct(Number(data?.overall_progress || 0))
    const now = new Date()
    const count = 12
    const baseStep = Math.max(1.6, Math.min(4.2, (current || 45) / 14))
    let prevScore = null
    return Array.from({ length: count }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1)
        const distance = count - 1 - i
        const wave = Math.sin(i * 1.25) * 3.2 + (i % 4 === 1 ? 2.4 : 0)
        const score = i === count - 1
            ? Math.round(current)
            : Math.round(clampPct(current - distance * baseStep + wave))
        const delta = prevScore == null ? null : roundNum(score - prevScore, 1)
        prevScore = score
        return {
            label: d.toLocaleDateString(undefined, { month: 'short' }).replace('.', ''),
            period_key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
            actual: score,
            target: 100,
            attainment_pct: score,
            weighted_score: score,
            severity: score < 70 ? 'red' : score < 90 ? 'yellow' : 'green',
            delta_pct: delta,
            is_estimated: true,
        }
    })
}


function lcmdToneColor(toneOrValue) {
    if (toneOrValue === 'red' || toneOrValue < 40) return '#ff3d00'
    if (toneOrValue === 'yellow' || toneOrValue < 70) return '#ffb300'
    return '#14b8a6'
}

function lcmdScorePalette(score) {
    const pct = clampPct(score)
    if (pct < 40) return {
        soft: '#45110b',
        mid: '#ff6b3d',
        strong: '#ff3d00',
        glow: 'rgba(255,61,0,.34)',
    }
    if (pct < 70) return {
        soft: '#42310a',
        mid: '#ffd166',
        strong: '#ffb300',
        glow: 'rgba(255,179,0,.30)',
    }
    return {
        soft: '#083d3a',
        mid: '#5eead4',
        strong: '#14b8a6',
        glow: 'rgba(20,184,166,.32)',
    }
}

function lcmdMetricIcon(key) {
    if (key === 'overall_score') return 'target'
    if (key === 'on_track') return 'checkCircle'
    if (key === 'target_achievement') return 'flag'
    if (key === 'at_risk') return 'warning'
    return metricIcon(key)
}

function lcmdStatusIcon(tone) {
    if (tone === 'up') return 'arrowUp'
    if (tone === 'down') return 'arrowDown'
    if (tone === 'risk') return 'warning'
    return 'arrowRight'
}

function lcmdScrollTo(id) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${id}`)
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

function lcmdFocusPanel(node, { scroll = false, block = 'nearest' } = {}) {
    if (!node) return
    requestAnimationFrame(() => {
        node.querySelector?.('.ddb-drawer-body')?.scrollTo({ top: 0, left: 0 })
        if (scroll) node.scrollIntoView({ behavior: 'smooth', block })
        node.focus(scroll ? { preventScroll: true } : undefined)
    })
}

function lcmdPointScore(point) {
    return Number(point?.weighted_score ?? point?.attainment_pct ?? point?.actual ?? point?.score ?? 0)
}

function lcmdPointMonth(point, fallbackYear) {
    const key = String(point?.period_key || '').trim()
    if (/^\d{4}-\d{2}$/.test(key)) {
        return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) }
    }
    const raw = point?.period_label || point?.label || ''
    const monthIndex = LCMD_MONTH_SHORT.findIndex(m => m.toLowerCase() === String(raw).slice(0, 3).toLowerCase())
    if (monthIndex >= 0) return { year: fallbackYear, month: monthIndex + 1 }
    return null
}

function lcmdVisualPeriods(data) {
    const raw = data?.performance_periods || []
    const fallbackYear = Number(data?.displayYear || data?.year || new Date().getFullYear())
    const byMonth = new Map()
    raw.forEach((point) => {
        const ym = lcmdPointMonth(point, fallbackYear)
        if (!ym || ym.year !== fallbackYear || ym.month < 1 || ym.month > 12) return
        byMonth.set(ym.month, point)
    })
    let prevScore = null
    return Array.from({ length: 12 }, (_, index) => {
        const month = index + 1
        const source = byMonth.get(month)
        const score = source ? roundNum(lcmdPointScore(source), 1) : 0
        const point = source ? { ...source } : {
            label: LCMD_MONTH_SHORT[index],
            target: 100,
            actual: 0,
            attainment_pct: 0,
            weighted_score: 0,
            is_empty: true,
        }
        const delta = prevScore == null ? null : roundNum(score - prevScore, 1)
        prevScore = score
        return {
            ...point,
            period_key: `${fallbackYear}-${String(month).padStart(2, '0')}`,
            label: point.label || LCMD_MONTH_SHORT[index],
            actual: source ? Number(point.actual ?? point.weighted_score ?? score) : 0,
            target: Number(point.target || 100),
            attainment_pct: source ? Number(point.attainment_pct ?? score) : 0,
            weighted_score: score,
            severity: source ? (point.severity || (score < 70 ? 'red' : score < 90 ? 'yellow' : 'green')) : 'red',
            delta_pct: point.delta_pct ?? delta,
            is_empty: !source,
        }
    })
}

function lcmdLatestDelta(points) {
    const recent = (points || []).slice(-2)
    if (recent.length < 2) return null
    return roundNum(lcmdPointScore(recent[1]) - lcmdPointScore(recent[0]), 1)
}

const LCMD_MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function lcmdMonthLabel(month, tr) {
    const short = LCMD_MONTH_SHORT[month - 1] || ''
    if (!short) return ''
    return tr ? tr('output.month_label', { short, month }) : short
}

function lcmdPeriodLabel(point, fallback = '', tr) {
    const key = String(point?.period_key || '').trim()
    if (/^\d{4}-\d{2}$/.test(key)) {
        const month = Number(key.slice(5, 7))
        return lcmdMonthLabel(month, tr) || fallback
    }
    const raw = point?.period_label || point?.label || key || fallback
    const monthIndex = LCMD_MONTH_SHORT.findIndex(m => m.toLowerCase() === String(raw).slice(0, 3).toLowerCase())
    if (monthIndex >= 0) return lcmdMonthLabel(monthIndex + 1, tr) || raw
    return raw
}

function lcmdSignedDelta(delta) {
    const value = roundNum(Math.abs(delta), 1)
    if (Math.abs(delta) < 0.1) return '0%'
    return `${delta > 0 ? '+' : '-'}${value}%`
}

function lcmdDeltaText(delta, tr, previousLabel = '') {
    if (delta == null || Number.isNaN(delta)) return tr('output.metric_live')
    const value = roundNum(Math.abs(delta), 1)
    if (previousLabel) {
        if (Math.abs(delta) < 0.1) return tr('output.delta_flat_named', { period: previousLabel })
        return delta > 0
            ? tr('output.delta_up_named', { value, period: previousLabel })
            : tr('output.delta_down_named', { value, period: previousLabel })
    }
    if (Math.abs(delta) < 0.1) return tr('output.delta_flat')
    return delta > 0 ? tr('output.delta_up', { value }) : tr('output.delta_down', { value })
}

function lcmdDeltaTone(delta, positiveIsGood = true) {
    if (delta == null || Math.abs(delta) < 0.1) return 'flat'
    const good = positiveIsGood ? delta > 0 : delta < 0
    return good ? 'up' : 'down'
}

function lcmdDeltaInfo(points, tr, options = {}) {
    const all = points || []
    const latestDataIndex = all.reduce((last, point, index) => !point?.is_empty ? index : last, -1)
    const recent = latestDataIndex >= 0
        ? [all[Math.max(0, latestDataIndex - 1)], all[latestDataIndex]].filter(Boolean)
        : all.slice(-2)
    const hasDelta = Object.prototype.hasOwnProperty.call(options, 'delta')
    const delta = hasDelta ? options.delta : (recent.length >= 2 ? lcmdLatestDelta(recent) : null)
    const previous = lcmdPeriodLabel(recent[0], tr('output.previous_period'), tr)
    const current = lcmdPeriodLabel(recent[1], tr('output.current_period'), tr)
    const estimated = Boolean(recent[0]?.is_estimated || recent[1]?.is_estimated)
    const text = lcmdDeltaText(delta, tr, previous)
    const tooltip = delta == null
        ? tr('output.delta_tooltip_empty')
        : [
            tr('output.delta_tooltip', { current, previous, delta: lcmdSignedDelta(delta) }),
            estimated ? tr('output.delta_tooltip_estimated') : '',
            options.risk ? tr('output.delta_tooltip_risk') : '',
        ].filter(Boolean).join(' ')
    return { delta, text, tooltip, previous, current, estimated }
}

function lcmdPeriodFormulaText(point, tr) {
    if (!point) return tr('output.performance_formula')
    if (point.is_empty) return `${tr('output.performance_formula')} ${tr('output.performance_missing_zero')}`
    return point.is_estimated
        ? `${tr('output.performance_formula')} ${tr('output.performance_estimated_note')}`
        : tr('output.performance_formula')
}

function lcmdTrendFormulaText(trend, tr) {
    if (!trend?.samples?.length) return ''
    return tr('output.trend_node_formula', {
        count: trend.samples.length,
        periods: trend.samples.map(p => lcmdPeriodLabel(p, '', tr)).join(', '),
        score: Math.round(trend.score || 0),
    })
}

function lcmdTrendShortText(trend, tr) {
    if (!trend?.samples?.length) return ''
    return tr('output.trend_node_short', {
        count: trend.samples.length,
        score: Math.round(trend.score || 0),
    })
}

function lcmdPeriodKpiRows(visible) {
    return [...(visible || [])]
        .map((s) => {
            const progress = Number(s.kpi?.progress || 0)
            const expected = Number(s.expected_progress ?? progress - (s.gap || 0))
            const weight = Number(s.kpi?.weight || 0)
            return {
                id: s.kpi?.id,
                name: s.kpi?.name || '',
                unit: s.kpi?.unit || '%',
                current: Number(s.kpi?.current_value || 0),
                target: Number(s.kpi?.target_value || 0),
                progress: roundNum(progress, 1),
                expected: roundNum(expected, 1),
                gap: roundNum(Number(s.gap ?? progress - expected), 1),
                weight: roundNum(weight, 1),
                contribution: roundNum(clampPct(progress) * (weight || 1) / 100, 1),
            }
        })
        .sort((a, b) => a.gap - b.gap)
}

function lcmdRiskSignal(item, visible, year, tr) {
    const status = visible?.find?.(s => s.kpi?.id === item?.kpi_id)
    const progress = Number(item?.attainment_pct ?? item?.progress ?? status?.kpi?.progress ?? 0)
    const expected = Number(item?.expected_progress ?? status?.expected_progress ?? progress)
    const gap = roundNum(Number(item?.gap ?? status?.gap ?? progress - expected), 1)
    const severity = String(item?.severity || status?.health || '').toLowerCase()
    const deadline = item?.deadline || status?.kpi?.deadline || `${year || new Date().getFullYear()}-12-31`
    const parsedDeadline = new Date(deadline)
    const safeDeadline = Number.isNaN(parsedDeadline.getTime()) ? new Date(`${year || new Date().getFullYear()}-12-31`) : parsedDeadline
    const daysLeft = Math.ceil((safeDeadline - new Date()) / 86400000)
    const isRed = severity === 'red'
    const overdueBehind = daysLeft < 0 && gap < 0
    const severeGap = gap <= -10
    const dueSoonBehind = daysLeft <= 7 && gap <= -5
    const today = isRed || overdueBehind || severeGap || dueSoonBehind
    let reason = tr('output.risk_reason_watch')
    if (overdueBehind) reason = tr('output.risk_reason_overdue')
    else if (isRed) reason = tr('output.risk_reason_red')
    else if (severeGap) reason = tr('output.risk_reason_gap', { gap: Math.abs(gap) })
    else if (dueSoonBehind) reason = tr('output.risk_reason_due', { days: Math.max(0, daysLeft) })
    return {
        progress,
        expected,
        gap,
        daysLeft,
        today,
        reason,
        label: today ? tr('output.risk_today_badge') : tr('output.risk_watch_badge'),
    }
}

function lcmdDecoratedRisks(items, visible, year, tr) {
    return [...(items || [])]
        .map(item => ({ ...item, signal: lcmdRiskSignal(item, visible, year, tr) }))
        .sort((a, b) => {
            if (a.signal.today !== b.signal.today) return a.signal.today ? -1 : 1
            return (a.signal.daysLeft - b.signal.daysLeft) || (a.signal.gap - b.signal.gap)
        })
}

function LivingMetricCard({ metric, onAction, tr }) {
    const counted = useCountUp(metric.countTarget ?? 0, 820)
    const color = metric.color || lcmdToneColor(metric.tone)
    const value = metric.format ? metric.format(counted) : `${counted}${metric.suffix || ''}`
    const statusText = metric.deltaText || metric.delta || tr('output.metric_live')
    const statusTone = metric.deltaTone || (metric.deltaText ? 'flat' : 'live')
    const tooltip = metric.deltaTooltip || tr('output.delta_tooltip_empty')
    const fillPct = clampPct(metric.fillPct ?? metric.countTarget ?? 0)
    return (
        <button
            type="button"
            className="lcmd-metric"
            style={{ '--metric-color': color }}
            onClick={() => onAction(metric.action)}
            aria-label={`${metricLabel(metric.key, tr)}: ${value}`}
            title={tooltip}
        >
            <span className="lcmd-metric-top">
                <span className="lcmd-metric-icon"><UiIcon name={lcmdMetricIcon(metric.key)} /></span>
                {metric.badge && <span className="lcmd-metric-badge">{metric.badge}</span>}
            </span>
            <div className="lcmd-metric-label">{metricLabel(metric.key, tr)}</div>
            <div className="lcmd-metric-value">{value}</div>
            {metric.subText && <div className="lcmd-metric-sub">{metric.subText}</div>}
            <span className="lcmd-metric-mini" aria-hidden="true"><span style={{ width: `${fillPct}%` }} /></span>
            <span className={`lcmd-live ${statusTone}`}>
                <span className="lcmd-live-arrow"><UiIcon name={lcmdStatusIcon(statusTone)} /></span>
                {statusText}
                <span className="lcmd-live-info" aria-hidden="true">
                    <UiIcon name="info" />
                    <span className="lcmd-live-tip">{tooltip}</span>
                </span>
            </span>
        </button>
    )
}

function LivingHeroScore({ data, visible, counts, tr }) {
    const rawScore = Number(data?.overall_progress || 0)
    const score = clampPct(rawScore)
    const counted = useCountUp(Math.round(score), 1100)
    const r = 70
    const circumference = 2 * Math.PI * r
    const color = lcmdToneColor(score)
    const palette = lcmdScorePalette(score)
    const danger = score < 40 || counts.red > 0
    return (
        <section className={`lcmd-card lcmd-score-card${danger ? ' danger' : ''}`} onClick={(e) => {
            if (e.target.closest('button')) return
            lcmdScrollTo('performance')
        }}>
            <div className="lcmd-score-head">
                <div>
                    <div className="lcmd-score-title">{tr('dashboard.health_score')}</div>
                    <div className="lcmd-subtitle">{tr('dashboard.tracking_count', { count: visible.length })}</div>
                    <div className="lcmd-score-note">{tr('output.health_score_formula_short')}</div>
                </div>
                <span className="lcmd-kicker">{tr('output.metric_live')}</span>
            </div>
            <div className="lcmd-score-body">
                <div
                    className="lcmd-score-ring"
                    style={{
                        '--score-color': color,
                        '--score-soft': palette.soft,
                        '--score-mid': palette.mid,
                        '--score-strong': palette.strong,
                        '--score-glow': palette.glow,
                        '--score-scale': 0.82 + score / 560,
                    }}
                >
                    <svg viewBox="0 0 176 176" role="img" aria-label={tr('dashboard.health_score_aria')}>
                        <defs>
                            <linearGradient id="lcmdScoreGradient" x1="0" x2="1" y1="0" y2="1">
                                <stop offset="0%" stopColor={palette.soft} />
                                <stop offset="52%" stopColor={palette.mid} />
                                <stop offset="100%" stopColor={palette.strong} />
                            </linearGradient>
                        </defs>
                        <circle className="lcmd-ring-track" cx="88" cy="88" r={r} />
                        <circle
                            className="lcmd-ring-value"
                            cx="88" cy="88" r={r}
                            strokeDasharray={`${circumference * (score / 100)} ${circumference}`}
                        />
                    </svg>
                    <span className="lcmd-score-center">
                        <span className="lcmd-score-number">{counted}%</span>
                        <span className="lcmd-score-label">{cleanIconLabel(tr('dashboard.health_score_short'))}</span>
                    </span>
                </div>
            </div>
        </section>
    )
}

function LivingPerformanceChart({ data, visible, tr, onOpenPeriod }) {
    const [hoverIndex, setHoverIndex] = useState(null)
    const all = lcmdVisualPeriods(data)
    const points = all
    const currentMonthIndex = Math.max(0, Math.min(11, new Date().getMonth()))
    const latestDataIndex = points.reduce((last, point, index) => !point.is_empty ? index : last, -1)
    const activeIndex = hoverIndex ?? (latestDataIndex >= 0 ? latestDataIndex : currentMonthIndex)
    const active = points[activeIndex]
    const w = 760, h = 268, padX = 50, padTop = 32, padBottom = 58
    const innerW = w - padX * 2
    const innerH = h - padTop - padBottom
    const maxScore = Math.max(1, ...points.map(p => lcmdPointScore(p)))
    const maxValue = Math.max(100, Math.min(120, Math.ceil((maxScore + 14) / 10) * 10))
    const targetY = padTop + innerH - (Math.min(100, maxValue) / maxValue) * innerH
    const slotW = innerW / Math.max(1, points.length)
    const barW = Math.min(32, Math.max(16, slotW * 0.42))
    const coords = points.map((p, i) => {
        const score = lcmdPointScore(p)
        const x = padX + i * slotW + (slotW - barW) / 2
        const barH = Math.max(3, (score / maxValue) * innerH)
        const y = padTop + innerH - barH
        const tone = score < 40 ? 'red' : score < 70 ? 'yellow' : 'green'
        return { ...p, score, tone, x, y, barH, cx: padX + i * slotW + slotW / 2 }
    })
    const trendCoords = coords.map((p, i) => {
        const from = Math.max(0, i - 2)
        const sample = coords.slice(from, i + 1)
        const avg = sample.reduce((sum, row) => sum + row.score, 0) / Math.max(1, sample.length)
        const y = padTop + innerH - (avg / maxValue) * innerH
        return { x: p.cx, y, score: avg, samples: sample }
    })
    const dataTrendCoords = trendCoords.slice(0, latestDataIndex + 1)
    const smoothTrendPath = (() => {
        const pts = dataTrendCoords
        if (pts.length < 2) return ''
        const parts = [`M ${pts[0].x} ${pts[0].y}`]
        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[Math.max(0, i - 1)]
            const p1 = pts[i]
            const p2 = pts[i + 1]
            const p3 = pts[Math.min(pts.length - 1, i + 2)]
            const t = 0.2
            const cp1x = (p1.x + (p2.x - p0.x) * t).toFixed(1)
            const cp1y = (p1.y + (p2.y - p0.y) * t).toFixed(1)
            const cp2x = (p2.x - (p3.x - p1.x) * t).toFixed(1)
            const cp2y = (p2.y - (p3.y - p1.y) * t).toFixed(1)
            parts.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`)
        }
        return parts.join(' ')
    })()
    const baseY = padTop + innerH
    const areaPath = smoothTrendPath
        ? `${smoothTrendPath} L ${dataTrendCoords[dataTrendCoords.length - 1].x} ${baseY} L ${dataTrendCoords[0].x} ${baseY} Z`
        : ''
    const activePrevious = activeIndex > 0 ? points[activeIndex - 1] : null
    const activeTrend = trendCoords[activeIndex]
    const hoverTrend = hoverIndex != null ? trendCoords[hoverIndex] : null
    const calloutX = hoverTrend ? Math.max(padX, Math.min(w - padX - 182, hoverTrend.x + 12)) : 0
    const calloutY = hoverTrend ? Math.max(14, Math.min(h - padBottom - 50, hoverTrend.y - 58)) : 0
    const openPoint = (point, previous) => {
        if (!point) return
        onOpenPeriod?.({
            point,
            previous,
            rows: lcmdPeriodKpiRows(visible),
        })
    }
    return (
        <section className="lcmd-panel" id="performance">
            <div className="lcmd-panel-head">
                <div className="lcmd-panel-title"><UiIcon name="chartDown" />{tr('output.performance_title')}</div>
            </div>
            <div className="lcmd-chart-legend" aria-hidden="true">
                <span><i className="lcmd-legend-mark bar" />{tr('output.legend_bar_score')}</span>
                <span><i className="lcmd-legend-mark trend" />{tr('output.legend_line_trend')}</span>
                <span><i className="lcmd-legend-mark target" />{tr('output.legend_target_line')}</span>
                <span><i className="lcmd-legend-mark zero" />{tr('output.legend_missing_zero')}</span>
            </div>
            <svg className="lcmd-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={tr('output.performance_title')}>
                <defs>
                    <linearGradient id="lcmdBarRed" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#ffb300" />
                        <stop offset="100%" stopColor="#ff3d00" />
                    </linearGradient>
                    <linearGradient id="lcmdBarYellow" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#ffd166" />
                        <stop offset="100%" stopColor="#ffb300" />
                    </linearGradient>
                    <linearGradient id="lcmdBarGreen" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#5eead4" />
                        <stop offset="100%" stopColor="#14b8a6" />
                    </linearGradient>
                    <linearGradient id="lcmdAreaGrad" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="var(--lcmd-highlight)" stopOpacity=".18" />
                        <stop offset="100%" stopColor="var(--lcmd-highlight)" stopOpacity="0" />
                    </linearGradient>
                </defs>
                <text className="lcmd-axis-label" x={padX} y="12">{tr('output.axis_score')}</text>
                <text className="lcmd-axis-label" x={w - padX} y={h - 3} textAnchor="end">{tr('output.axis_period')}</text>
                <line x1={padX} x2={padX} y1={padTop} y2={padTop + innerH} stroke="rgba(148,163,184,.34)" />
                <line x1={padX} x2={w - padX} y1={padTop + innerH} y2={padTop + innerH} stroke="rgba(148,163,184,.34)" />
                <rect x={padX} y={padTop} width={innerW} height={Math.max(0, targetY - padTop)} fill="#14b8a6" opacity=".035" rx="10" />
                <rect x={padX} y={targetY} width={innerW} height={padTop + innerH - targetY} fill="#ff3d00" opacity=".035" rx="10" />
                {[0, 25, 50, 75, 100].map(v => {
                    if (v > maxValue) return null
                    const y = padTop + innerH - (v / maxValue) * innerH
                    return (
                        <g key={v}>
                            <line x1={padX} x2={w - padX} y1={y} y2={y} stroke="rgba(148,163,184,.18)" strokeDasharray="3 7" />
                            <text x={padX - 10} y={y + 4} textAnchor="end" fill="var(--lcmd-chart-axis)" fontSize="10">{v}%</text>
                        </g>
                    )
                })}
                <line className="lcmd-target-line" x1={padX} x2={w - padX} y1={targetY} y2={targetY} stroke="var(--lcmd-chart-axis)" strokeWidth="2" strokeDasharray="7 7" opacity=".78" />
                <text x={w - padX - 6} y={Math.max(12, targetY - 6)} textAnchor="end" fill="var(--lcmd-chart-label)" fontSize="10.5" fontWeight="800">{tr('output.target_100')}</text>
                {coords.map((p, i) => {
                    const gradient = p.tone === 'green' ? 'url(#lcmdBarGreen)' : p.tone === 'yellow' ? 'url(#lcmdBarYellow)' : 'url(#lcmdBarRed)'
                    const trend = trendCoords[i]
                    const isActive = activeIndex === i
                    return (
                        <g
                            key={`${p.period_key || p.label}-${i}`}
                            tabIndex={0}
                            onMouseEnter={() => setHoverIndex(i)}
                            onMouseLeave={() => setHoverIndex(null)}
                            onFocus={() => setHoverIndex(i)}
                            onBlur={() => setHoverIndex(null)}
                            onClick={() => {
                                setHoverIndex(i)
                                openPoint(p, i > 0 ? points[i - 1] : null)
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    setHoverIndex(i)
                                    openPoint(p, i > 0 ? points[i - 1] : null)
                                }
                            }}
                            role="button"
                            aria-label={tr('output.open_period_detail', { period: lcmdPeriodLabel(p, '', tr), score: Math.round(p.score) })}
                        >
                            <title>{`${lcmdPeriodLabel(p, '', tr)}: ${tr('output.legend_bar_score')} ${Math.round(p.score)}%. ${lcmdTrendFormulaText(trend, tr)} ${lcmdPeriodFormulaText(p, tr)}`}</title>
                            {isActive && !p.is_empty && (
                                <rect className="lcmd-bar-glow" x={p.x - 2} y={p.y} width={barW + 4} height={p.barH} rx="8" fill={gradient} />
                            )}
                            <rect className="lcmd-bar" x={p.x} y={p.y} width={barW} height={p.barH} rx="6" fill={gradient} opacity={isActive ? '.97' : p.is_empty ? '.38' : '.72'} style={{ animationDelay: `${i * 52}ms` }} />
                            {!p.is_empty && (
                                <text className="lcmd-bar-score" x={p.cx} y={Math.max(padTop + 10, p.y - 6)} textAnchor="middle" opacity={isActive ? 1 : 0}>
                                    {Math.round(p.score)}%
                                </text>
                            )}
                            <rect className="lcmd-bar-hit" x={p.cx - Math.max(22, slotW * .36)} y={padTop} width={Math.max(44, slotW * .72)} height={innerH + 24} />
                            <text transform={`translate(${p.cx} ${h - 16}) rotate(-36)`} textAnchor="end" fill="var(--lcmd-chart-axis)" fontSize="9.4" fontWeight={isActive ? '850' : '650'}>{lcmdPeriodLabel(p, '', tr)}</text>
                        </g>
                    )
                })}
                {smoothTrendPath && (
                    <g className="lcmd-trend-layer">
                        {areaPath && <path className="lcmd-area-fill" d={areaPath} />}
                        <path className="lcmd-trend-line" d={smoothTrendPath} />
                        {trendCoords.map((p, i) => {
                            const point = points[i]
                            if (point.is_empty) return null
                            const isActive = i === activeIndex
                            return (
                            <g
                                key={`trend-${i}`}
                                className="lcmd-trend-node"
                                tabIndex={0}
                                role="button"
                                aria-label={tr('output.open_period_detail', { period: lcmdPeriodLabel(point, '', tr), score: Math.round(p.score) })}
                                onMouseEnter={() => setHoverIndex(i)}
                                onMouseLeave={() => setHoverIndex(null)}
                                onFocus={() => setHoverIndex(i)}
                                onBlur={() => setHoverIndex(null)}
                                onClick={() => {
                                    setHoverIndex(i)
                                    openPoint(point, i > 0 ? points[i - 1] : null)
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault()
                                        setHoverIndex(i)
                                        openPoint(point, i > 0 ? points[i - 1] : null)
                                    }
                                }}
                            >
                                <title>{`${lcmdPeriodLabel(point, '', tr)}: ${lcmdTrendFormulaText(p, tr)} ${lcmdPeriodFormulaText(point, tr)}`}</title>
                                <circle className="lcmd-trend-hit" cx={p.x} cy={p.y} r="14" />
                                <circle
                                    className={isActive ? 'lcmd-trend-dot active' : 'lcmd-trend-dot'}
                                    cx={p.x} cy={p.y}
                                    r={isActive ? 5 : 3}
                                />
                                {p.score > 1 && (
                                    <text className="lcmd-trend-label" x={p.x} y={Math.max(14, p.y - (i % 2 === 0 ? 12 : 24))} textAnchor="middle">{Math.round(p.score)}%</text>
                                )}
                            </g>
                        )})}
                    </g>
                )}
                {hoverTrend && (
                    <g className="lcmd-chart-callout" transform={`translate(${calloutX} ${calloutY})`}>
                        <rect width="182" height="46" rx="9" />
                        <text x="10" y="17">{lcmdPeriodLabel(points[hoverIndex], '', tr)} | {Math.round(hoverTrend.score)}%</text>
                        <text className="muted" x="10" y="34">{lcmdTrendShortText(hoverTrend, tr)}</text>
                    </g>
                )}
            </svg>
            <div className="lcmd-tip">
                {active ? (
                    <div className="lcmd-tip-chips">
                        <span className="lcmd-tip-chip period"><b>{lcmdPeriodLabel(active, '', tr)}</b></span>
                        <span className="lcmd-tip-chip" style={{ animationDelay: '.04s' }}>
                            {tr('output.tip_period_score')} <b>{Math.round(active.score || 0)}%</b>
                        </span>
                        {activeTrend && (
                            <span className="lcmd-tip-chip trend" style={{ animationDelay: '.08s' }}>
                                ↗ {tr('output.tip_trend')} <b>{Math.round(activeTrend.score || 0)}%</b>
                            </span>
                        )}
                        {active.delta_pct != null && (
                            <span className={`lcmd-tip-chip ${active.delta_pct >= 0 ? 'pos' : 'neg'}`} style={{ animationDelay: '.12s' }}>
                                {active.delta_pct >= 0 ? '+' : ''}{Math.round(active.delta_pct)}% {lcmdPeriodLabel(activePrevious, '', tr) ? `vs ${lcmdPeriodLabel(activePrevious, '', tr)}` : ''}
                            </span>
                        )}
                        {lcmdPeriodFormulaText(active, tr) && (
                            <span className="lcmd-tip-chip formula" style={{ animationDelay: '.16s' }}>{lcmdPeriodFormulaText(active, tr)}</span>
                        )}
                        <button className="lcmd-inline" type="button" style={{ marginLeft: 'auto' }} onClick={() => openPoint(active, activePrevious)}>
                            {tr('output.open_period_detail_short')}
                        </button>
                    </div>
                ) : tr('dashboard.trend_empty_desc')}
            </div>
        </section>
    )
}

function LivingCategoryBars({ data, visible, tr, navigate }) {
    const rows = data?.category_progress?.length
        ? data.category_progress.map(r => ({
            key: r.key,
            name: r.name,
            value: roundNum(r.attainment_pct || 0),
            kpiCount: r.kpi_count || 0,
            riskCount: r.at_risk_count || 0,
        }))
        : objectiveLensRows(data, visible).map(r => ({
            key: r.id,
            name: r.name,
            value: r.actual,
            kpiCount: visible.filter(s => s.kpi.objective_id === r.id).length,
            riskCount: visible.filter(s => s.kpi.objective_id === r.id && s.health !== 'green').length,
        }))
    return (
        <section className="lcmd-panel">
            <div className="lcmd-panel-head">
                <div className="lcmd-panel-title"><UiIcon name="flag" />{tr('output.category_title')}</div>
                <button className="lcmd-inline" type="button" onClick={() => navigate('/kpis', tr('output.destination_kpis'))}>{tr('output.view_all')}</button>
            </div>
            <div className="lcmd-category-list">
                {!rows.length ? (
                    <div className="lcmd-tip">{tr('dashboard.no_objectives')}</div>
                ) : rows.slice(0, 6).map(row => {
                    const color = lcmdToneColor(row.value)
                    return (
                        <button key={row.key} type="button" className="lcmd-category" style={{ '--cat-color': color }} onClick={() => navigate(`/kpis?category=${encodeURIComponent(row.name)}`, tr('output.destination_kpis'))}>
                            <span className="lcmd-category-top">
                                <span className="lcmd-category-name">{row.name}</span>
                                <span className="lcmd-category-value">{Math.round(row.value)}%</span>
                            </span>
                            <div className="lcmd-category-meta">{tr('output.category_meta', { count: row.kpiCount, risk: row.riskCount })}</div>
                            <span className="lcmd-track"><span className="lcmd-fill" style={{ width: `${clampPct(row.value)}%` }} /></span>
                        </button>
                    )
                })}
            </div>
        </section>
    )
}

function LivingRiskList({ riskItems, visible, year, tr, onOpenRiskKpi, navigate }) {
    const items = riskItems?.length ? lcmdDecoratedRisks(riskItems, visible, year, tr) : []
    return (
        <section className="lcmd-panel" id="at-risk-list">
            <div className="lcmd-panel-head">
                <div className="lcmd-panel-title"><UiIcon name="warning" />{tr('dashboard.panel_top_risk')}</div>
                <button className="lcmd-inline" type="button" onClick={() => navigate('/kpis?filter=at-risk', tr('output.destination_kpis'))}>{tr('output.view_all')}</button>
            </div>
            <div className="lcmd-risk-criteria">{tr('output.risk_today_rule')}</div>
            <div className="lcmd-risk-list">
                {!items.length ? (
                    <div className="lcmd-tip">{tr('dashboard.risk_none')}</div>
                ) : items.slice(0, 4).map((item, i) => {
                    const progress = item.signal.progress
                    const gap = item.signal.gap
                    const days = item.signal.daysLeft
                    const color = lcmdToneColor(item.severity || progress)
                    return (
                        <button key={item.kpi_id || item.name} type="button" className={`lcmd-risk-row${item.signal.today ? ' urgent' : ''}`} style={{ '--risk-color': color }} onClick={() => onOpenRiskKpi(item)}>
                            <span className="lcmd-risk-index">{String(i + 1).padStart(2, '0')}</span>
                            <span style={{ minWidth: 0 }}>
                                <span className="lcmd-risk-name">
                                    <span className="lcmd-risk-name-text">{item.name}</span>
                                    <span className="lcmd-risk-chip">{item.signal.label}</span>
                                </span>
                                <span className="lcmd-risk-meta">
                                    <span className="lcmd-risk-bar"><span style={{ width: `${clampPct(progress)}%` }} /></span>
                                    <span>{days >= 0 ? tr('dashboard.days_short', { days }) : tr('dashboard.overdue_short', { days: -days })}</span>
                                    <span className="lcmd-risk-delta">{gap > 0 ? '+' : ''}{roundNum(gap)}%</span>
                                </span>
                                <span className="lcmd-risk-reason">{item.signal.reason}</span>
                            </span>
                        </button>
                    )
                })}
            </div>
        </section>
    )
}

function lcmdActivityLabel(tr, group, value) {
    const key = `${group}.${value || ''}`
    const label = tr(key)
    return label === key ? (value || tr('output.activity_empty_value')) : cleanIconLabel(label)
}

function lcmdActivityDetail(w, tr) {
    const empty = tr('output.activity_empty_value')
    const delta = Number(w?.progress_delta || 0)
    return {
        title: w?.title || empty,
        workDate: w?.work_date || w?.created_at?.slice(0, 10) || empty,
        recordedAt: w?.created_at ? w.created_at.slice(0, 16).replace('T', ' ') : empty,
        status: lcmdActivityLabel(tr, 'status', w?.status),
        kpi: w?.kpi_name || tr('journal.no_kpi'),
        delta: delta ? `${delta > 0 ? '+' : ''}${roundNum(delta, 2)}` : empty,
        source: lcmdActivityLabel(tr, 'source', w?.source),
        note: String(w?.detail || w?.mapping_reason || '').trim(),
    }
}

function LivingQuickJournal({ items, tr, navigate }) {
    const rows = (items || []).slice(0, 4)
    const [selected, setSelected] = useState(null)
    const detailRef = useRef(null)
    const selectedDetail = selected ? lcmdActivityDetail(selected, tr) : null
    useEffect(() => {
        if (selectedDetail) lcmdFocusPanel(detailRef.current, { scroll: true })
    }, [selected?.id])
    return (
        <section className="lcmd-panel">
            <div className="lcmd-panel-head">
                <div className="lcmd-panel-title"><UiIcon name="refresh" />{tr('dashboard.recent_activity')}</div>
                <button className="lcmd-inline" type="button" onClick={() => navigate('/journal', tr('output.destination_journal'))}>{tr('output.go_journal')}</button>
            </div>
            <div className="lcmd-journal-list">
                {!rows.length ? (
                    <div className="lcmd-tip">{tr('dashboard.focus_empty_desc')}</div>
                ) : rows.map(w => (
                    <button
                        key={w.id}
                        className={`lcmd-journal-row${selected?.id === w.id ? ' is-active' : ''}`}
                        type="button"
                        aria-expanded={selected?.id === w.id}
                        onClick={() => setSelected(prev => prev?.id === w.id ? null : w)}
                    >
                        <span className="lcmd-journal-icon"><UiIcon name="clipboardList" /></span>
                        <span className="lcmd-journal-title">{w.title}</span>
                        <span className="lcmd-journal-date">{w.work_date || w.created_at?.slice(0, 10) || '-'}</span>
                    </button>
                ))}
            </div>
            {selectedDetail && (
                <div className="lcmd-journal-detail" role="region" aria-live="polite" aria-label={tr('output.activity_detail_title')} tabIndex={-1} ref={detailRef}>
                    <div className="lcmd-journal-detail-head">
                        <div className="lcmd-journal-detail-title">{selectedDetail.title}</div>
                        <button className="lcmd-journal-detail-close" type="button" onClick={() => setSelected(null)} aria-label={tr('common.close')}>
                            <UiIcon name="x" />
                        </button>
                    </div>
                    <div className="lcmd-journal-detail-grid">
                        <div className="lcmd-journal-detail-field">
                            <span>{tr('journal.col_work_date')}</span>
                            <b>{selectedDetail.workDate}</b>
                        </div>
                        <div className="lcmd-journal-detail-field">
                            <span>{tr('journal.col_recorded')}</span>
                            <b>{selectedDetail.recordedAt}</b>
                        </div>
                        <div className="lcmd-journal-detail-field">
                            <span>{tr('journal.col_status')}</span>
                            <b>{selectedDetail.status}</b>
                        </div>
                        <div className="lcmd-journal-detail-field">
                            <span>{tr('journal.col_kpi')}</span>
                            <b>{selectedDetail.kpi}</b>
                        </div>
                        <div className="lcmd-journal-detail-field">
                            <span>{tr('journal.col_delta')}</span>
                            <b>{selectedDetail.delta}</b>
                        </div>
                        <div className="lcmd-journal-detail-field">
                            <span>{tr('journal.col_source')}</span>
                            <b>{selectedDetail.source}</b>
                        </div>
                    </div>
                    {selectedDetail.note && <div className="lcmd-journal-detail-note">{selectedDetail.note}</div>}
                    <div className="lcmd-journal-detail-actions">
                        <button className="lcmd-inline" type="button" onClick={() => navigate('/journal', tr('output.destination_journal'))}>
                            {tr('output.activity_open_journal')}
                        </button>
                    </div>
                </div>
            )}
        </section>
    )
}

function LivingPeriodDrawer({ detail, tr, navigate, onClose }) {
    const drawerRef = useRef(null)
    useEffect(() => {
        if (!detail) return undefined
        const onKey = e => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        document.body.classList.add('kpi-drawer-open')
        document.body.style.overflow = 'hidden'
        lcmdFocusPanel(drawerRef.current)
        return () => {
            window.removeEventListener('keydown', onKey)
            document.body.classList.remove('kpi-drawer-open')
            document.body.style.overflow = ''
        }
    }, [detail, onClose])

    if (!detail) return null

    const point = detail.point || {}
    const previous = detail.previous
    const rows = detail.rows || []
    const period = lcmdPeriodLabel(point, tr('output.current_period'), tr)
    const score = roundNum(lcmdPointScore(point), 1)
    const target = roundNum(Number(point.target || 100), 1)
    const attainment = roundNum(Number(point.attainment_pct ?? score), 1)
    const actual = roundNum(Number(point.actual ?? point.weighted_score ?? score), 1)
    const delta = point.delta_pct ?? (previous ? roundNum(score - lcmdPointScore(previous), 1) : null)
    const periodKey = String(point.period_key || '').trim()
    const goJournal = () => {
        onClose()
        navigate(`/journal${periodKey ? `?period_key=${encodeURIComponent(periodKey)}` : ''}`, tr('output.destination_journal'))
    }
    const goKpiMetrics = (id) => {
        onClose()
        navigate(`/kpis?focus_kpi=${encodeURIComponent(id)}${periodKey ? `&period_key=${encodeURIComponent(periodKey)}` : ''}`, tr('output.destination_kpis'))
    }
    const goKpisForPeriod = () => {
        onClose()
        navigate(`/kpis${periodKey ? `?period_key=${encodeURIComponent(periodKey)}` : ''}`, tr('output.destination_kpis'))
    }
    const shownRows = rows
        .filter(row => Number(row.current || 0) > 0 || Number(row.progress || 0) > 0)
        .slice(0, 6)

    const drawer = (
        <>
            <div className="ddb-backdrop" onClick={onClose} />
            <div className="ddb-drawer lcmd-period-panel" role="dialog" aria-modal="true" aria-label={tr('output.period_drawer_title', { period })} tabIndex={-1} ref={drawerRef}>
                <div className="ddb-drawer-hd">
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="ddb-drawer-title">{tr('output.period_drawer_title', { period })}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                            {point.is_estimated ? tr('output.period_drawer_estimated') : tr('output.period_drawer_confirmed')}
                        </div>
                    </div>
                    <button className="btn-icon" type="button" onClick={onClose} aria-label={tr('common.close')}>
                        <UiIcon name="x" />
                    </button>
                </div>
                <div className="ddb-drawer-body">
                    <div className="lcmd-period-summary">
                        <div className="lcmd-period-stat"><span>{tr('output.tip_actual')}</span><b>{actual}%</b><em>{tr('output.period_actual_desc')}</em></div>
                        <div className="lcmd-period-stat"><span>{tr('output.tip_target')}</span><b>{target}%</b><em>{tr('output.period_target_desc')}</em></div>
                        <div className="lcmd-period-stat"><span>{tr('output.tip_attainment')}</span><b>{attainment}%</b><em>{tr('output.period_attainment_desc')}</em></div>
                        <div className="lcmd-period-stat"><span>{tr('output.period_delta')}</span><b>{delta == null ? '-' : lcmdSignedDelta(delta)}</b><em>{tr('output.period_delta_desc')}</em></div>
                    </div>

                    <div className="lcmd-period-explain">
                        <b>{tr('output.period_formula_title')}</b>
                        <br />
                        {tr('output.period_formula_body')}
                        {point.is_estimated && <><br />{tr('output.performance_estimated_note')}</>}
                    </div>

                    <div className="lcmd-panel-head" style={{ marginBottom: 0 }}>
                        <div className="lcmd-panel-title"><UiIcon name="table" />{tr('output.period_kpi_contrib')}</div>
                    </div>
                    <div className="lcmd-period-list">
                        {!shownRows.length ? (
                            <div className="lcmd-tip">{tr('dashboard.kpi_filter_empty')}</div>
                        ) : shownRows.map(row => (
                            <div className="lcmd-period-kpi" key={row.id || row.name}>
                                <span style={{ minWidth: 0 }}>
                                    <strong>{row.name}</strong>
                                    <small>
                                        {tr('dashboard.actual_label')} {row.current}/{row.target} {row.unit}
                                        {' · '}{tr('dashboard.expected_label')} {row.expected}%
                                        {' · '}{tr('dashboard.weight_label_short')} {row.weight}%
                                    </small>
                                </span>
                                <button className="lcmd-inline" type="button" onClick={() => goKpiMetrics(row.id)} aria-label={tr('output.open_kpi_detail')}>
                                    <b>{row.progress}%</b>
                                    <span>{tr('output.open_kpi_detail')}</span>
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="lcmd-period-actions">
                        <button className="btn small ghost" type="button" onClick={goJournal}>
                            <UiIcon name="clipboardList" />{tr('output.open_period_journal')}
                        </button>
                        <button className="btn small primary" type="button" onClick={goKpisForPeriod}>
                            <UiIcon name="table" />{tr('output.log_period_metric')}
                        </button>
                    </div>
                </div>
            </div>
        </>
    )
    return createPortal(drawer, document.body)
}

function LivingDashboard({
    data, visible, counts, tr, dashboardYear, riskItems,
    onOpenRisks, onOpenRiskKpi, onOpenPeriod, navigate,
    lastUpdated, autoRefreshing, lang,
}) {
    const total = visible.length
    const score = clampPct(Number(data?.overall_progress || 0))
    const targetHits = visible.filter(s => Number(s.kpi?.progress || 0) >= 100).length
    const targetPct = total ? Math.round((targetHits / total) * 100) : 0
    const periods = lcmdVisualPeriods(data)
    const scoreInfo = lcmdDeltaInfo(periods, tr)
    const scoreDelta = scoreInfo.delta
    const decoratedRisks = lcmdDecoratedRisks(riskItems, visible, dashboardYear, tr)
    const urgentRisks = decoratedRisks.filter(item => item.signal.today)
    const riskTotal = decoratedRisks.length
    const currentSnapshot = tr('output.metric_current_snapshot')
    const currentSnapshotTip = tr('output.metric_current_snapshot_tip')
    const metrics = [
        {
            key: 'overall_score',
            countTarget: Math.round(score),
            suffix: '%',
            tone: score,
            color: '#7c5cff',
            action: 'performance',
            fillPct: score,
            subText: tr('output.metric_overall_sub', { total }),
            deltaText: scoreInfo.text,
            deltaTone: lcmdDeltaTone(scoreDelta),
            deltaTooltip: scoreInfo.tooltip,
        },
        {
            key: 'on_track',
            countTarget: counts.green,
            tone: counts.green / Math.max(1, total) * 100,
            color: '#14b8a6',
            action: 'on_track',
            format: (n) => `${n}/${total}`,
            fillPct: total ? counts.green / total * 100 : 0,
            subText: tr('output.metric_on_track_sub', { count: counts.green, total }),
            deltaText: currentSnapshot,
            deltaTone: 'flat',
            deltaTooltip: currentSnapshotTip,
        },
        {
            key: 'target_achievement',
            countTarget: targetPct,
            suffix: '%',
            tone: targetPct,
            color: '#22d3ee',
            action: 'target',
            fillPct: targetPct,
            subText: tr('output.metric_target_sub', { count: targetHits, total }),
            deltaText: currentSnapshot,
            deltaTone: 'flat',
            deltaTooltip: currentSnapshotTip,
        },
        {
            key: 'at_risk',
            countTarget: riskTotal,
            tone: urgentRisks.length ? 'red' : riskTotal ? 'yellow' : 'green',
            action: 'risk',
            format: (n) => `${n}/${total}`,
            fillPct: total ? riskTotal / total * 100 : 0,
            badge: urgentRisks.length ? tr('output.metric_today_badge', { count: urgentRisks.length }) : '',
            subText: urgentRisks.length
                ? tr('output.metric_at_risk_today_sub', { count: urgentRisks.length })
                : tr('output.metric_at_risk_clear_sub'),
            deltaText: urgentRisks.length ? tr('output.risk_today_badge') : currentSnapshot,
            deltaTone: urgentRisks.length ? 'risk' : 'flat',
            deltaTooltip: tr('output.risk_today_rule'),
        },
    ]
    const alertOk = riskTotal === 0
    const alertWatch = !alertOk && urgentRisks.length === 0
    const topUrgent = urgentRisks[0]
    const alertText = alertOk
        ? tr('dashboard.insight_all_good')
        : urgentRisks.length
            ? tr('dashboard.insight_today_summary', {
                count: urgentRisks.length,
                name: topUrgent?.name || '',
                reason: topUrgent?.signal?.reason || '',
            })
            : tr('dashboard.insight_watch_summary', { count: riskTotal })
    const alertExplain = alertOk
        ? tr('dashboard.insight_all_good_detail')
        : urgentRisks.length
            ? tr('output.risk_today_rule')
            : tr('dashboard.insight_watch_detail')
    const lastUpdatedText = lastUpdated
        ? tr('output.last_updated', {
            time: new Intl.DateTimeFormat(lang === 'vi' ? 'vi-VN' : 'en-US', {
                hour: '2-digit',
                minute: '2-digit',
            }).format(lastUpdated),
        })
        : ''
    const handleMetric = (action) => {
        if (action === 'performance') lcmdScrollTo('performance')
        else if (action === 'risk') {
            lcmdScrollTo('at-risk-list')
            onOpenRisks(riskItems)
        } else if (action === 'on_track') navigate('/kpis?filter=on-track', tr('output.destination_kpis'))
        else if (action === 'target') navigate('/kpis?sort=achievement-desc', tr('output.destination_kpis'))
    }
    return (
        <div className="lcmd">
            <div className="ldb-ambient" aria-hidden="true">
                <span className="ldb-particle" />
                <span className="ldb-particle" />
                <span className="ldb-particle" />
                <span className="ldb-particle" />
                <span className="ldb-particle" />
            </div>
            <div className="lcmd-topline">
                <div>
                    <div className="lcmd-kicker">{tr('output.cockpit_title')}</div>
                    <div className="lcmd-title">{cleanIconLabel(tr('dashboard.title', { year: dashboardYear }))}</div>
                    <div className="lcmd-subtitle">{tr('output.cockpit_subtitle', { count: total })}</div>
                </div>
                <div className="lcmd-top-actions">
                    {lastUpdatedText && (
                        <span className={`lcmd-refresh-state${autoRefreshing ? ' active' : ''}`}>
                            <UiIcon name="refresh" />
                            {autoRefreshing ? tr('output.auto_refreshing') : lastUpdatedText}
                        </span>
                    )}
                    <ViewModeSwitch />
                </div>
            </div>

            <div className="lcmd-hero-grid">
                <LivingHeroScore
                    data={data}
                    visible={visible}
                    counts={counts}
                    tr={tr}
                />
                <div className="lcmd-hero-side">
                    <div className="lcmd-metric-grid">
                        {metrics.map(metric => <LivingMetricCard key={metric.key} metric={metric} onAction={handleMetric} tr={tr} />)}
                    </div>
                    <div className={`lcmd-alert${alertOk ? ' ok' : alertWatch ? ' watch' : ''}`}>
                        <UiIcon name={alertOk ? 'checkCircle' : 'warning'} />
                        <span className="lcmd-alert-copy">
                            <strong>{alertText}</strong>
                            <em>{alertExplain}</em>
                        </span>
                        {!alertOk && <span className="lcmd-alert-actions">
                            <button className="lcmd-inline" type="button" onClick={() => {
                                lcmdScrollTo('at-risk-list')
                                onOpenRisks(riskItems)
                            }}>{tr('output.open_risks')}</button>
                        </span>}
                    </div>
                </div>
            </div>

            <div className="lcmd-main-grid">
                <LivingPerformanceChart data={data} visible={visible} tr={tr} onOpenPeriod={onOpenPeriod} />
            </div>

            <div className="lcmd-bottom-grid">
                <LivingRiskList riskItems={riskItems} visible={visible} year={dashboardYear} tr={tr} onOpenRiskKpi={onOpenRiskKpi} navigate={navigate} />
                <section className="lcmd-panel">
                    <div className="lcmd-panel-head">
                        <div className="lcmd-panel-title"><UiIcon name="shield" />{tr('dashboard.panel_burnout')}</div>
                    </div>
                    <BurnoutGauge tr={tr} />
                </section>
                <LivingQuickJournal items={data.recent_items} tr={tr} navigate={navigate} />
            </div>

            <div className="lcmd-secondary-grid">
                <LivingCategoryBars data={data} visible={visible} tr={tr} navigate={navigate} />
            </div>
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

function buildInstantDashboardInsight(visible, metrics, tr) {
    const strength = [...metrics].filter(m => m.count > 0).sort((a, b) => b.score - a.score)[0]
    const risk = [...visible].filter(s => s.gap < 0).sort((a, b) => a.gap - b.gap)[0]
    const priority = risk || [...visible].sort((a, b) => (a.kpi.progress || 0) - (b.kpi.progress || 0))[0]
    const riskCount = visible.filter(s => s.health === 'red').length
    const yellowCount = visible.filter(s => s.health === 'yellow').length
    return {
        generated_at: null,
        data_signature: 'instant',
        top_strength: strength
            ? tr('pulse.insight_strength_text', { category: strength.label, value: roundNum(strength.score) })
            : tr('pulse.insight_no_strength'),
        top_risk: risk
            ? tr('pulse.insight_risk_text', { name: risk.kpi.name, value: Math.abs(roundNum(risk.gap)) })
            : tr('pulse.insight_no_risk'),
        top_priority: priority
            ? tr('pulse.insight_priority_text', { name: priority.kpi.name })
            : tr('pulse.insight_no_priority'),
        correlation_insight: tr('pulse.correlation_text', { risk: riskCount, attention: yellowCount }),
        forecast_next_period: tr('pulse.forecast_text', {
            work: roundNum(metrics.find(m => m.key === 'Work')?.score || 0),
            personal: roundNum(metrics.find(m => m.key === 'Personal')?.score || 0),
        }),
        kpi_adjustment: risk
            ? tr('pulse.adjustment_text', { name: risk.kpi.name })
            : tr('pulse.adjustment_ok'),
        suggested_actions: priority
            ? [
                tr('pulse.action_log', { name: priority.kpi.name }),
                tr('pulse.action_split', { name: priority.kpi.name }),
                tr('pulse.action_review'),
            ]
            : [tr('pulse.action_start')],
        risk_kpi_id: risk?.kpi?.id ?? null,
        priority_kpi_id: priority?.kpi?.id ?? null,
        strength_category: strength?.key ?? 'None',
    }
}

function OutputRiskDrawer({ open, items, visible, year, tr, onClose, onSelectKpi, onGoJournal, onGoKpis }) {
    const drawerRef = useRef(null)
    useEffect(() => {
        if (!open) return undefined
        const onKey = e => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        document.body.classList.add('kpi-drawer-open')
        document.body.style.overflow = 'hidden'
        lcmdFocusPanel(drawerRef.current)
        return () => {
            window.removeEventListener('keydown', onKey)
            document.body.classList.remove('kpi-drawer-open')
            document.body.style.overflow = ''
        }
    }, [open, onClose])

    if (!open) return null

    const rows = lcmdDecoratedRisks(items || [], visible || [], year, tr)
    const drawer = (
        <>
            <div className="ddb-backdrop" onClick={onClose} />
            <div className="ddb-drawer ddb-output-risk-panel" role="dialog" aria-modal="true" aria-label={tr('output.risk_drawer_title')} tabIndex={-1} ref={drawerRef}>
                <div className="ddb-drawer-hd">
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="ddb-drawer-title">{tr('output.risk_drawer_title')}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                            {tr('output.risk_drawer_sub')}
                        </div>
                    </div>
                    <button className="btn-icon" type="button" onClick={onClose} aria-label={tr('common.close')}>
                        <UiIcon name="x" />
                    </button>
                </div>
                <div className="ddb-drawer-body">
                    {!rows.length ? (
                        <div className="lcmd-tip">{tr('dashboard.risk_none')}</div>
                    ) : rows.map((item, i) => {
                        const progress = item.signal.progress
                        const expected = item.signal.expected
                        const projected = Number(item.projected_progress ?? progress)
                        const gap = item.signal.gap
                        const color = lcmdToneColor(item.severity || progress)
                        return (
                            <button
                                key={item.kpi_id || `${item.name}-${i}`}
                                type="button"
                                className="ddb-output-risk-row"
                                onClick={() => onSelectKpi(item)}
                            >
                                <div className="ddb-output-risk-head">
                                    <span style={{ minWidth: 0 }}>
                                        <span className="ddb-output-risk-name">{item.name}</span>
                                        <span className="ddb-output-risk-sub">{item.objective_name || tr('dashboard.panel_top_risk')}</span>
                                        <span className="ddb-output-risk-reason">
                                            <b>{item.signal.label}</b>{' '}
                                            {item.signal.reason}
                                        </span>
                                    </span>
                                    <span className="ddb-output-risk-badge" style={{ color, background: `${color}22` }}>
                                        {gap > 0 ? '+' : ''}{roundNum(gap)}%
                                    </span>
                                </div>
                                <div className="ddb-output-risk-stats">
                                    <span className="ddb-output-risk-stat"><span>{tr('output.tip_actual')}</span><b>{roundNum(progress)}%</b></span>
                                    <span className="ddb-output-risk-stat"><span>{tr('dashboard.expected_label')}</span><b>{roundNum(expected)}%</b></span>
                                    <span className="ddb-output-risk-stat"><span>{tr('dashboard.gap_label')}</span><b>{gap > 0 ? '+' : ''}{roundNum(gap)}%</b></span>
                                    <span className="ddb-output-risk-stat"><span>{tr('output.risk_projected')}</span><b>{roundNum(projected)}%</b></span>
                                </div>
                            </button>
                        )
                    })}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                        <button className="btn small ghost" type="button" onClick={onGoJournal}>
                            <UiIcon name="clipboardList" />{tr('output.go_journal')}
                        </button>
                        <button className="btn small primary" type="button" onClick={onGoKpis}>
                            <UiIcon name="list" />{tr('output.view_all')}
                        </button>
                    </div>
                </div>
            </div>
        </>
    )
    return createPortal(drawer, document.body)
}



function BurnoutGauge({ tr }) {
    const [data, setData] = useState(null)
    useEffect(() => { api.burnoutCheck().then(setData).catch(() => {}) }, [])

    const loadPct = data && data.free_hours > 0
        ? Math.min(150, Math.round((data.hours_needed / data.free_hours) * 100))
        : 0
    const counted = useCountUp(loadPct)
    const color = data?.risk_level === 'danger' ? HC.red : data?.risk_level === 'warning' ? HC.yellow : HC.green
    const riskLabel = {
        safe: tr('dashboard.burnout_safe'),
        warning: tr('dashboard.burnout_warning'),
        danger: tr('dashboard.burnout_danger'),
    }
    const barWidthPct = `${Math.min(100, (counted / 150) * 100).toFixed(2)}%`

    return (
        <div className="ddb-gauge-wrap" style={{ '--gauge-color': color }}>
            <div className="ddb-burnout-header">
                <div>
                    <div className="ddb-burnout-pct">{data ? `${counted}%` : '--'}</div>
                    <div className="ddb-burnout-caption">{tr('dashboard.gauge_needed')} / {tr('dashboard.gauge_free')}</div>
                </div>
                {data && <span className="ddb-burnout-status">{riskLabel[data.risk_level]}</span>}
            </div>
            <div className="ddb-capbar-outer">
                <div className="ddb-capbar-track">
                    <div className="ddb-capbar-fill" style={{ width: barWidthPct }} />
                    <div className="ddb-capbar-marker" style={{ left: '40%' }} />
                    <div className="ddb-capbar-marker" style={{ left: '66.666%' }} />
                </div>
                <div className="ddb-capbar-ticks">
                    <span>0%</span>
                    <span>60%</span>
                    <span>100%</span>
                    <span>150%</span>
                </div>
            </div>
            {data && (
                <div className="ddb-burnout-stats">
                    <div className="ddb-burnout-stat">
                        <div className="ddb-burnout-dot" style={{ background: 'var(--gauge-color)' }} />
                        <div className="ddb-burnout-stat-text">
                            <span>{tr('dashboard.gauge_needed')}</span>
                            <strong className="primary">{data.hours_needed}h</strong>
                        </div>
                    </div>
                    <div className="ddb-burnout-stat">
                        <div className="ddb-burnout-dot" style={{ background: 'var(--muted)' }} />
                        <div className="ddb-burnout-stat-text">
                            <span>{tr('dashboard.gauge_free')}</span>
                            <strong>{data.free_hours}h</strong>
                        </div>
                    </div>
                </div>
            )}
            {data && (
                <div className="ddb-burnout-note">
                    <em>{tr('burnout.formula_full', { days: data.horizon_days || 14 })}</em>
                </div>
            )}
        </div>
    )
}

/* ─── Top Risk List ──────────────────────────────────────────────────────── */

function ConfirmNavigationDialog({ pending, tr, onCancel, onConfirm }) {
    const dialogRef = useRef(null)
    useEffect(() => {
        if (pending) lcmdFocusPanel(dialogRef.current)
    }, [pending])
    if (!pending) return null
    const dialog = (
        <div className="lcmd-confirm-backdrop" role="presentation">
            <div className="lcmd-confirm-dialog" role="dialog" aria-modal="true" aria-label={tr('output.confirm_nav_title')} tabIndex={-1} ref={dialogRef}>
                <div className="lcmd-confirm-icon"><UiIcon name="arrowRight" /></div>
                <div className="lcmd-confirm-copy">
                    <strong>{tr('output.confirm_nav_title')}</strong>
                    <span>{tr('output.confirm_nav_body', { destination: pending.label || tr('output.destination_page') })}</span>
                </div>
                <div className="lcmd-confirm-actions">
                    <button className="btn small ghost" type="button" onClick={onCancel}>{tr('output.confirm_nav_stay')}</button>
                    <button className="btn small primary" type="button" onClick={onConfirm}>{tr('output.confirm_nav_continue')}</button>
                </div>
            </div>
        </div>
    )
    return createPortal(dialog, document.body)
}

export default function Dashboard() {
    const { tr, lang } = useLang()
    const { mode } = useView()
    const { activeCycleId, currentYear, cycles, loading: cyclesLoading } = useCycle()
    const navigate = useNavigate()

    const [data, setData] = useState(null)
    const [error, setError] = useState('')
    const [selectedKpi, setSelectedKpi] = useState(null)
    const [selectedKpiFromRisk, setSelectedKpiFromRisk] = useState(false)
    const [riskDrawerOpen, setRiskDrawerOpen] = useState(false)
    const [riskDrawerItems, setRiskDrawerItems] = useState([])
    const [periodDetail, setPeriodDetail] = useState(null)
    const [lastUpdated, setLastUpdated] = useState(null)
    const [autoRefreshing, setAutoRefreshing] = useState(false)
    const [pendingNavigation, setPendingNavigation] = useState(null)

    const dashboardCategory = mode === 'personal' ? 'Personal' : 'Work'
    const load = useCallback((options = {}) => {
        if (cyclesLoading) return
        if (activeCycleId && cycles.length > 0 && !cycles.some(c => c.id === activeCycleId)) return
        const silent = Boolean(options.silent)
        if (silent) setAutoRefreshing(true)
        else setError('')
        return api.dashboard(activeCycleId, dashboardCategory)
            .then(next => {
                setData(next)
                setLastUpdated(new Date())
            })
            .catch(e => {
                if (!silent) setError(e.message)
            })
            .finally(() => {
                if (silent) setAutoRefreshing(false)
            })
    }, [activeCycleId, dashboardCategory, cycles, cyclesLoading])

    useEffect(() => {
        load()
    }, [load])

    useEffect(() => {
        const panelOpen = selectedKpi || riskDrawerOpen || periodDetail || pendingNavigation
        if (cyclesLoading || panelOpen) return undefined
        const tick = () => {
            if (!document.hidden) load({ silent: true })
        }
        const id = window.setInterval(tick, 180000)
        const onVisible = () => {
            if (!document.hidden) load({ silent: true })
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
            window.clearInterval(id)
            document.removeEventListener('visibilitychange', onVisible)
        }
    }, [cyclesLoading, load, pendingNavigation, periodDetail, riskDrawerOpen, selectedKpi])

    const requestNavigate = useCallback((to, label) => {
        setPendingNavigation({ to, label: label || tr('output.destination_page') })
    }, [tr])

    const confirmNavigate = useCallback(() => {
        const next = pendingNavigation
        if (!next) return
        setPendingNavigation(null)
        navigate(next.to)
    }, [navigate, pendingNavigation])

    if (error) return <div className="page"><div className="error-text"><UiIcon name="warning" /> {error}</div></div>
    if (!data) return <div className="page" style={{ color: 'var(--muted)', fontSize: 14 }}>{tr('dashboard.loading')}</div>

    const visible = data.kpi_statuses.filter(s => matchView(mode, s.kpi.category, s.health))
    const counts = { green: 0, yellow: 0, red: 0 }
    visible.forEach(s => counts[s.health]++)

    const dashboardYear = currentYear || data.year
    const openRiskDrawer = (items = data.at_risk_items || []) => {
        setRiskDrawerItems(items)
        setRiskDrawerOpen(true)
    }
    const openRiskKpi = (riskItem) => {
        const status = visible.find(s => s.kpi.id === riskItem.kpi_id)
        if (status) {
            setRiskDrawerOpen(false)
            setSelectedKpiFromRisk(true)
            setSelectedKpi({
                ...status,
                expected_progress: status.expected_progress ?? status.kpi.progress - status.gap,
            })
        }
    }
    const riskItems = data.at_risk_items?.length ? data.at_risk_items : visible
        .filter(s => s.health !== 'green' || s.gap < 0)
        .slice(0, 8)
        .map(s => ({
            kpi_id: s.kpi.id,
            name: s.kpi.name,
            objective_name: s.kpi.objective_name || '',
            attainment_pct: s.kpi.progress,
            expected_progress: s.expected_progress,
            gap: s.gap,
            velocity_pct: s.gap,
            projected_progress: Math.max(0, s.kpi.progress + s.gap),
            severity: s.health,
        }))

    return (
        <div className="page ddb-wrap lcmd-page">
            <style>{DASH_CSS}</style>

            <LivingDashboard
                data={{ ...data, displayYear: dashboardYear }}
                visible={visible}
                counts={counts}
                tr={tr}
                dashboardYear={dashboardYear}
                riskItems={riskItems}
                onOpenRisks={openRiskDrawer}
                onOpenRiskKpi={openRiskKpi}
                onOpenPeriod={setPeriodDetail}
                navigate={requestNavigate}
                lastUpdated={lastUpdated}
                autoRefreshing={autoRefreshing}
                lang={lang}
            />


            {/* KPI Detail Drawer */}
            {selectedKpi && (
                <KpiDetailDrawer
                    item={selectedKpi}
                    year={dashboardYear}
                    onClose={() => { setSelectedKpi(null); setSelectedKpiFromRisk(false) }}
                    onBack={selectedKpiFromRisk ? () => {
                        setSelectedKpi(null)
                        setRiskDrawerOpen(true)
                    } : undefined}
                    backLabel={tr('output.back_to_risks')}
                    onReload={() => { setSelectedKpi(null); setSelectedKpiFromRisk(false); load() }}
                    lang={lang}
                />
            )}
            <OutputRiskDrawer
                open={riskDrawerOpen}
                items={riskDrawerItems}
                visible={visible}
                year={dashboardYear}
                tr={tr}
                onClose={() => setRiskDrawerOpen(false)}
                onSelectKpi={openRiskKpi}
                onGoJournal={() => requestNavigate('/journal', tr('output.destination_journal'))}
                onGoKpis={() => requestNavigate('/kpis', tr('output.destination_kpis'))}
            />
            <LivingPeriodDrawer
                detail={periodDetail}
                tr={tr}
                navigate={requestNavigate}
                onClose={() => setPeriodDetail(null)}
            />
            <ConfirmNavigationDialog
                pending={pendingNavigation}
                tr={tr}
                onCancel={() => setPendingNavigation(null)}
                onConfirm={confirmNavigate}
            />
        </div>
    )
}
