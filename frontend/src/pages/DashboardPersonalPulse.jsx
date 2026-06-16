import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useLang } from '../LangContext'
import { useView, matchView } from '../ViewContext'
import { useCycle } from '../CycleContext'
import ViewModeSwitch from '../components/ViewModeSwitch'
import { useToast } from '../components/Toast'
import { UiIcon, cleanIconLabel } from '../components/UiIcon'

const HC = { green: '#16a34a', yellow: '#d97706', red: '#dc2626' }
const CAT = {
  Work: '#2563eb',
  Personal: '#0f766e',
  Other: '#64748b',
}
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const PULSE_CSS = `
  .page.pp-wrap {
    --pp-surface:var(--card);
    --pp-surface-2:var(--surface);
    --pp-soft:#f4f7fb;
    --pp-border:var(--border);
    --pp-text:var(--text);
    --pp-muted:var(--muted);
    --pp-blue:#2563eb;
    --pp-teal:#0f766e;
    --pp-amber:#d97706;
    --pp-red:#dc2626;
    max-width:1360px;
    width:100%;
    display:flex;
    flex-direction:column;
    gap:14px;
    overflow-x:hidden;
    animation:pp-fade .22s ease both;
  }
  [data-theme="dark"] .page.pp-wrap {
    --pp-soft:#111827;
    --pp-surface:#111827;
    --pp-surface-2:#0f172a;
    --pp-border:rgba(148,163,184,.18);
  }
  .pp-topbar {
    display:flex;
    align-items:center;
    gap:10px;
    flex-wrap:wrap;
  }
  .pp-view-switch { flex:1; min-width:220px; }
  .pp-tabs {
    display:flex;
    gap:6px;
    flex-wrap:wrap;
    padding:6px;
    border:1px solid var(--pp-border);
    border-radius:8px;
    background:var(--pp-surface);
  }
  .pp-tab {
    display:inline-flex;
    align-items:center;
    gap:6px;
    border:1px solid transparent;
    background:transparent;
    color:var(--pp-muted);
    border-radius:7px;
    padding:8px 10px;
    font-size:12px;
    font-weight:750;
    cursor:pointer;
    min-height:34px;
    transition:background .15s ease,color .15s ease,border-color .15s ease;
  }
  .pp-tab:hover,
  .pp-tab.active {
    background:var(--pp-soft);
    color:var(--pp-text);
    border-color:var(--pp-border);
  }
  .pp-tab .ui-icon { width:15px; height:15px; flex-shrink:0; }
  .pp-hero {
    display:grid;
    grid-template-columns:minmax(0,1.05fr) minmax(260px,.95fr);
    gap:14px;
    align-items:stretch;
  }
  .pp-band,
  .pp-panel {
    border:1px solid var(--pp-border);
    border-radius:8px;
    background:var(--pp-surface);
    box-shadow:var(--shadow);
    min-width:0;
  }
  .pp-band {
    padding:18px;
    display:grid;
    grid-template-columns:auto minmax(0,1fr);
    gap:18px;
    align-items:center;
  }
  .pp-title {
    margin:0;
    color:var(--pp-text);
    font-size:24px;
    line-height:1.18;
    font-weight:850;
    overflow-wrap:anywhere;
  }
  .pp-subtitle {
    margin:5px 0 0;
    color:var(--pp-muted);
    font-size:13px;
    line-height:1.45;
  }
  .pp-ring {
    position:relative;
    width:132px;
    height:132px;
    flex-shrink:0;
  }
  .pp-ring svg { width:132px; height:132px; display:block; }
  .pp-ring-progress {
    stroke-dasharray:0 400;
    animation:pp-ring 1.1s cubic-bezier(.2,.8,.2,1) .1s both;
  }
  .pp-ring-inner {
    position:absolute;
    inset:0;
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:center;
    line-height:1;
  }
  .pp-ring-num {
    color:var(--pp-text);
    font-size:30px;
    font-weight:850;
  }
  .pp-ring-label {
    color:var(--pp-muted);
    font-size:10px;
    font-weight:800;
    text-transform:uppercase;
    letter-spacing:0;
    margin-top:4px;
  }
  .pp-hero-actions {
    display:flex;
    gap:8px;
    flex-wrap:wrap;
    margin-top:14px;
  }
  .pp-pulse-grid {
    display:grid;
    grid-template-columns:repeat(3,minmax(0,1fr));
    gap:10px;
    margin-top:16px;
  }
  .pp-pulse-card {
    position:relative;
    border:1px solid var(--pp-border);
    border-radius:8px;
    background:var(--pp-soft);
    padding:13px;
    min-height:122px;
    cursor:pointer;
    display:flex;
    flex-direction:column;
    gap:8px;
    overflow:hidden;
    animation:pp-up .32s ease both, pp-heart 5s ease-in-out infinite;
    transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease;
  }
  .pp-pulse-card:nth-child(2) { animation-delay:.07s, 1.2s; }
  .pp-pulse-card:nth-child(3) { animation-delay:.14s, 2.4s; }
  .pp-pulse-card:hover,
  .pp-pulse-card.active {
    transform:translateY(-2px);
    border-color:color-mix(in srgb,var(--pp-card-color) 55%,var(--pp-border));
    box-shadow:var(--shadow-hover);
  }
  .pp-card-head {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:8px;
    color:var(--pp-muted);
    font-size:11px;
    font-weight:800;
    text-transform:uppercase;
    letter-spacing:0;
  }
  .pp-card-icon {
    width:28px;
    height:28px;
    border-radius:8px;
    display:grid;
    place-items:center;
    color:#fff;
    background:var(--pp-card-color);
  }
  .pp-card-icon .ui-icon { width:16px; height:16px; }
  .pp-card-score {
    color:var(--pp-card-color);
    font-size:31px;
    line-height:1;
    font-weight:850;
  }
  .pp-card-meta {
    color:var(--pp-muted);
    font-size:12px;
    line-height:1.4;
    min-height:34px;
  }
  .pp-card-track {
    height:6px;
    border-radius:999px;
    background:color-mix(in srgb,var(--pp-card-color) 12%,transparent);
    overflow:hidden;
  }
  .pp-card-fill {
    height:100%;
    width:0;
    border-radius:inherit;
    background:var(--pp-card-color);
    animation:pp-fill .9s cubic-bezier(.2,.8,.2,1) .15s both;
  }
  .pp-insight {
    padding:18px;
    display:flex;
    flex-direction:column;
    gap:12px;
  }
  .pp-insight-head {
    display:flex;
    align-items:center;
    gap:8px;
    color:var(--pp-text);
    font-size:12px;
    font-weight:850;
    text-transform:uppercase;
    letter-spacing:0;
  }
  .pp-insight-head .ui-icon { width:17px; height:17px; color:var(--pp-teal); }
  .pp-typewriter {
    color:var(--pp-text);
    font-size:14px;
    line-height:1.65;
    min-height:68px;
  }
  .pp-spark-list {
    display:flex;
    flex-direction:column;
    gap:9px;
  }
  .pp-spark-row {
    display:grid;
    grid-template-columns:96px minmax(0,1fr) 58px;
    gap:10px;
    align-items:center;
    color:var(--pp-muted);
    font-size:12px;
  }
  .pp-spark-name {
    color:var(--pp-text);
    font-weight:760;
    overflow:hidden;
    white-space:nowrap;
    text-overflow:ellipsis;
  }
  .pp-spark-svg {
    width:100%;
    height:30px;
    overflow:visible;
  }
  .pp-spark-path {
    stroke-dasharray:220;
    stroke-dashoffset:220;
    animation:pp-draw .85s ease .15s both;
  }
  .pp-spark-delta {
    text-align:right;
    font-weight:850;
  }
  .pp-section-grid {
    display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:14px;
  }
  .pp-panel {
    padding:16px;
    animation:pp-up .28s ease both;
  }
  .pp-panel-head {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:10px;
    margin-bottom:13px;
  }
  .pp-panel-title {
    display:inline-flex;
    align-items:center;
    gap:8px;
    min-width:0;
    color:var(--pp-text);
    font-size:13px;
    font-weight:850;
    text-transform:uppercase;
    letter-spacing:0;
  }
  .pp-panel-title .ui-icon { width:17px; height:17px; color:var(--pp-teal); flex-shrink:0; }
  .pp-panel-title span {
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
  }
  .pp-chip-row {
    display:flex;
    gap:6px;
    flex-wrap:wrap;
    min-width:0;
  }
  .pp-chip {
    border:1px solid var(--pp-border);
    background:var(--pp-surface);
    color:var(--pp-muted);
    border-radius:999px;
    padding:6px 10px;
    font-size:12px;
    font-weight:750;
    cursor:pointer;
    min-height:32px;
  }
  .pp-chip:hover,
  .pp-chip.active {
    color:var(--pp-text);
    background:var(--pp-soft);
  }
  .pp-kpi-list {
    display:flex;
    flex-direction:column;
    gap:10px;
  }
  .pp-kpi-row {
    border:1px solid var(--pp-border);
    border-radius:8px;
    background:var(--pp-soft);
    padding:12px;
    display:grid;
    gap:10px;
    animation:pp-up .28s ease both;
  }
  .pp-kpi-row-top {
    display:grid;
    grid-template-columns:minmax(0,1fr) auto;
    gap:12px;
    align-items:start;
  }
  .pp-kpi-name {
    color:var(--pp-text);
    font-size:14px;
    line-height:1.35;
    font-weight:820;
    overflow-wrap:anywhere;
  }
  .pp-kpi-meta {
    display:flex;
    flex-wrap:wrap;
    gap:6px;
    color:var(--pp-muted);
    font-size:11px;
    margin-top:5px;
  }
  .pp-pill {
    display:inline-flex;
    align-items:center;
    gap:5px;
    border-radius:999px;
    background:var(--pp-surface);
    border:1px solid var(--pp-border);
    padding:4px 8px;
    color:var(--pp-muted);
    font-size:11px;
    font-weight:760;
  }
  .pp-pill .ui-icon { width:12px; height:12px; }
  .pp-progress-row {
    display:grid;
    grid-template-columns:minmax(0,1fr) 64px;
    align-items:center;
    gap:10px;
  }
  .pp-progress-track {
    height:9px;
    border-radius:999px;
    overflow:hidden;
    background:var(--pp-surface);
    border:1px solid var(--pp-border);
  }
  .pp-progress-fill {
    height:100%;
    width:0;
    border-radius:inherit;
    animation:pp-fill .9s ease both;
  }
  .pp-progress-num {
    color:var(--pp-text);
    font-size:13px;
    font-weight:850;
    text-align:right;
  }
  .pp-actions {
    display:flex;
    gap:7px;
    flex-wrap:wrap;
  }
  .pp-inline-suggestion {
    border-left:3px solid var(--pp-teal);
    background:var(--pp-surface);
    border-radius:7px;
    padding:9px 10px;
    color:var(--pp-text);
    font-size:12px;
    line-height:1.5;
    animation:pp-fade .2s ease both;
  }
  .pp-heatmap {
    display:grid;
    grid-template-columns:minmax(110px,1.2fr) repeat(7,minmax(28px,1fr));
    gap:5px;
    align-items:center;
    overflow-x:auto;
  }
  .pp-heat-head {
    color:var(--pp-muted);
    font-size:10px;
    font-weight:800;
    text-align:center;
    text-transform:uppercase;
    letter-spacing:0;
  }
  .pp-heat-name {
    color:var(--pp-text);
    font-size:12px;
    font-weight:760;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
  }
  .pp-heat-cell {
    height:28px;
    border-radius:7px;
    border:1px solid var(--pp-border);
    background:var(--pp-surface);
    display:grid;
    place-items:center;
    animation:pp-pop .24s ease both;
  }
  .pp-heat-dot {
    width:10px;
    height:10px;
    border-radius:999px;
    background:var(--pp-cell-color);
  }
  .pp-radar-wrap,
  .pp-chart-wrap {
    min-height:250px;
    display:grid;
    place-items:center;
  }
  .pp-chart-svg {
    width:100%;
    max-width:620px;
    height:auto;
    overflow:visible;
  }
  .pp-line-path {
    stroke-dasharray:900;
    stroke-dashoffset:900;
    animation:pp-draw 1.3s ease both;
  }
  .pp-point {
    opacity:0;
    animation:pp-pop .22s ease both;
  }
  .pp-table {
    display:flex;
    flex-direction:column;
    gap:7px;
  }
  .pp-table-row {
    display:grid;
    grid-template-columns:minmax(0,1fr) 62px 62px 62px;
    gap:8px;
    align-items:center;
    border-bottom:1px solid var(--pp-border);
    padding:7px 0;
    color:var(--pp-muted);
    font-size:12px;
  }
  .pp-table-row.head {
    color:var(--pp-muted);
    font-size:10px;
    font-weight:850;
    text-transform:uppercase;
    letter-spacing:0;
  }
  .pp-table-row strong {
    color:var(--pp-text);
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
  }
  .pp-bar-list {
    display:flex;
    flex-direction:column;
    gap:9px;
  }
  .pp-bar-row {
    display:grid;
    grid-template-columns:54px minmax(0,1fr) 48px;
    align-items:center;
    gap:10px;
    color:var(--pp-muted);
    font-size:12px;
  }
  .pp-bar-track {
    height:12px;
    border-radius:999px;
    background:var(--pp-soft);
    border:1px solid var(--pp-border);
    overflow:hidden;
  }
  .pp-bar-fill {
    height:100%;
    border-radius:inherit;
    background:linear-gradient(90deg,var(--pp-blue),var(--pp-teal));
    width:0;
    animation:pp-fill 1s ease both;
  }
  .pp-two-list {
    display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:12px;
  }
  .pp-mini-list {
    display:flex;
    flex-direction:column;
    gap:7px;
  }
  .pp-mini-item {
    display:flex;
    align-items:flex-start;
    gap:8px;
    color:var(--pp-text);
    font-size:12px;
    line-height:1.45;
    padding:8px;
    border:1px solid var(--pp-border);
    border-radius:8px;
    background:var(--pp-soft);
  }
  .pp-mini-dot {
    width:8px;
    height:8px;
    border-radius:999px;
    background:var(--pp-dot);
    margin-top:5px;
    flex-shrink:0;
  }
  .pp-analysis {
    color:var(--pp-text);
    font-size:13px;
    line-height:1.65;
  }
  .pp-momentum-list {
    display:flex;
    flex-direction:column;
    gap:9px;
  }
  .pp-momentum {
    display:grid;
    grid-template-columns:110px minmax(0,1fr) 88px;
    gap:10px;
    align-items:center;
    color:var(--pp-muted);
    font-size:12px;
  }
  .pp-momentum strong { color:var(--pp-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pp-arrow {
    width:28px;
    height:28px;
    border-radius:999px;
    display:grid;
    place-items:center;
    background:var(--pp-soft);
    color:var(--pp-arrow-color);
    transform:rotate(var(--pp-rotation));
    transition:transform .35s ease;
  }
  .pp-detail-head {
    display:grid;
    grid-template-columns:minmax(0,1fr) repeat(4,minmax(94px,auto));
    gap:10px;
    align-items:stretch;
  }
  .pp-detail-title {
    color:var(--pp-text);
    font-size:17px;
    line-height:1.35;
    font-weight:850;
    overflow-wrap:anywhere;
  }
  .pp-stat {
    border:1px solid var(--pp-border);
    border-radius:8px;
    padding:10px;
    background:var(--pp-soft);
    min-width:0;
  }
  .pp-stat span {
    display:block;
    color:var(--pp-muted);
    font-size:10px;
    font-weight:850;
    text-transform:uppercase;
    letter-spacing:0;
  }
  .pp-stat strong {
    display:block;
    color:var(--pp-text);
    font-size:18px;
    line-height:1.1;
    margin-top:5px;
    overflow-wrap:anywhere;
  }
  .pp-timeline {
    display:grid;
    grid-template-columns:repeat(8,minmax(64px,1fr));
    gap:8px;
    overflow-x:auto;
    padding-bottom:3px;
  }
  .pp-time-item {
    border:1px solid var(--pp-border);
    border-radius:8px;
    background:var(--pp-soft);
    padding:9px 8px;
    min-width:64px;
    text-align:center;
    animation:pp-pop .24s ease both;
  }
  .pp-time-dot {
    width:15px;
    height:15px;
    border-radius:999px;
    background:var(--pp-time-color);
    margin:0 auto 6px;
  }
  .pp-time-label {
    color:var(--pp-text);
    font-size:11px;
    font-weight:850;
  }
  .pp-time-value {
    color:var(--pp-muted);
    font-size:11px;
    margin-top:3px;
  }
  .pp-log-list {
    display:flex;
    flex-direction:column;
    gap:8px;
  }
  .pp-log-item {
    display:grid;
    grid-template-columns:82px minmax(0,1fr) auto;
    gap:10px;
    align-items:start;
    color:var(--pp-muted);
    font-size:12px;
    border-bottom:1px solid var(--pp-border);
    padding-bottom:8px;
  }
  .pp-log-item strong {
    color:var(--pp-text);
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
  }
  .pp-ai-grid {
    display:grid;
    grid-template-columns:repeat(3,minmax(0,1fr));
    gap:12px;
  }
  .pp-ai-card {
    border:1px solid var(--pp-border);
    border-radius:8px;
    background:var(--pp-soft);
    padding:14px;
    min-height:128px;
    display:flex;
    flex-direction:column;
    gap:10px;
    transform-style:preserve-3d;
    animation:pp-flip .42s ease both;
  }
  .pp-ai-card:nth-child(2) { animation-delay:.1s; }
  .pp-ai-card:nth-child(3) { animation-delay:.2s; }
  .pp-ai-label {
    display:flex;
    align-items:center;
    gap:7px;
    color:var(--pp-muted);
    font-size:11px;
    font-weight:850;
    text-transform:uppercase;
    letter-spacing:0;
  }
  .pp-ai-label .ui-icon { width:16px; height:16px; color:var(--pp-card-color); }
  .pp-ai-text {
    color:var(--pp-text);
    font-size:15px;
    line-height:1.45;
    font-weight:820;
    overflow-wrap:anywhere;
  }
  .pp-accordion {
    display:flex;
    flex-direction:column;
    gap:8px;
  }
  .pp-acc-item {
    border:1px solid var(--pp-border);
    border-radius:8px;
    background:var(--pp-soft);
    overflow:hidden;
  }
  .pp-acc-btn {
    width:100%;
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:10px;
    padding:12px;
    border:0;
    background:transparent;
    color:var(--pp-text);
    font-size:13px;
    font-weight:850;
    cursor:pointer;
    text-align:left;
  }
  .pp-acc-body {
    color:var(--pp-text);
    font-size:13px;
    line-height:1.65;
    padding:0 12px 12px;
    animation:pp-fade .2s ease both;
  }
  .pp-action-list {
    display:flex;
    flex-direction:column;
    gap:8px;
  }
  .pp-action-item {
    display:flex;
    align-items:flex-start;
    gap:9px;
    border:1px solid var(--pp-border);
    border-radius:8px;
    background:var(--pp-soft);
    color:var(--pp-text);
    padding:10px;
    font-size:13px;
    line-height:1.45;
  }
  .pp-action-item input {
    margin-top:2px;
    width:16px;
    height:16px;
    flex-shrink:0;
  }
  .pp-empty {
    border:1px dashed var(--pp-border);
    border-radius:8px;
    background:var(--pp-soft);
    color:var(--pp-muted);
    padding:18px;
    text-align:center;
    font-size:13px;
    line-height:1.5;
  }
  @media (prefers-reduced-motion: reduce) {
    .pp-wrap *,
    .pp-wrap *::before,
    .pp-wrap *::after {
      animation-duration:.01ms !important;
      animation-iteration-count:1 !important;
      transition-duration:.01ms !important;
    }
  }
  @media(max-width:1080px){
    .pp-hero,
    .pp-section-grid,
    .pp-two-list { grid-template-columns:1fr; }
    .pp-ai-grid { grid-template-columns:1fr; }
    .pp-detail-head { grid-template-columns:1fr 1fr; }
  }
  @media(max-width:720px){
    .pp-band { grid-template-columns:1fr; }
    .pp-ring { width:112px; height:112px; }
    .pp-ring svg { width:112px; height:112px; }
    .pp-pulse-grid { grid-template-columns:1fr; }
    .pp-spark-row { grid-template-columns:78px minmax(120px,1fr) 48px; }
    .pp-table-row { grid-template-columns:minmax(0,1fr) 52px 52px 52px; }
    .pp-detail-head { grid-template-columns:1fr; }
    .pp-log-item { grid-template-columns:1fr; }
    .pp-momentum { grid-template-columns:1fr auto; }
    .pp-momentum span:last-child { grid-column:1 / -1; }
  }
  @keyframes pp-fade { from { opacity:0 } to { opacity:1 } }
  @keyframes pp-up { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
  @keyframes pp-pop { from { opacity:0; transform:scale(.82) } to { opacity:1; transform:scale(1) } }
  @keyframes pp-fill { from { width:0 } to { width:var(--pp-fill) } }
  @keyframes pp-draw { to { stroke-dashoffset:0 } }
  @keyframes pp-ring { to { stroke-dasharray:var(--pp-ring-fill) var(--pp-ring-rest) } }
  @keyframes pp-heart {
    0%, 90%, 100% { transform:scale(1) }
    94% { transform:scale(1.018) }
  }
  @keyframes pp-flip {
    from { opacity:0; transform:rotateY(-18deg) translateY(8px) }
    to { opacity:1; transform:rotateY(0) translateY(0) }
  }
`

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : 0))
}

function round(n, digits = 0) {
  const m = 10 ** digits
  return Math.round((Number(n) || 0) * m) / m
}

function useCountUp(target, duration = 900) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    const safeTarget = Number(target) || 0
    let raf
    let start = null
    const step = ts => {
      if (!start) start = ts
      const p = Math.min((ts - start) / duration, 1)
      setVal(round((1 - Math.pow(1 - p, 3)) * safeTarget))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return val
}

function categoryOf(kpi) {
  if (kpi?.category === 'Personal') return 'Personal'
  if (kpi?.category === 'Work') return 'Work'
  return 'Other'
}

function labelForCategory(key, tr) {
  if (key === 'Work') return cleanIconLabel(tr('category.work'))
  if (key === 'Personal') return cleanIconLabel(tr('category.personal'))
  return tr('pulse.category_other')
}

function weightedProgress(statuses) {
  const items = statuses || []
  const totalWeight = items.reduce((sum, s) => sum + (Number(s.kpi?.weight) || 0), 0)
  if (!items.length) return 0
  if (totalWeight > 0) {
    return round(items.reduce((sum, s) => sum + clamp(s.kpi?.progress, 0, 100) * (Number(s.kpi?.weight) || 0), 0) / totalWeight, 1)
  }
  return round(items.reduce((sum, s) => sum + clamp(s.kpi?.progress, 0, 100), 0) / items.length, 1)
}

function expectedFor(statuses) {
  const items = statuses || []
  if (!items.length) return 0
  const totalWeight = items.reduce((sum, s) => sum + (Number(s.kpi?.weight) || 0), 0)
  if (totalWeight > 0) {
    return round(items.reduce((sum, s) => sum + clamp(s.expected_progress, 0, 100) * (Number(s.kpi?.weight) || 0), 0) / totalWeight, 1)
  }
  return round(items.reduce((sum, s) => sum + clamp(s.expected_progress, 0, 100), 0) / items.length, 1)
}

function makeCategoryCards(statuses, weeklyActivity, tr) {
  const work = statuses.filter(s => categoryOf(s.kpi) === 'Work')
  const personal = statuses.filter(s => categoryOf(s.kpi) === 'Personal')
  const metrics = [
    makeCategoryMetric('Work', work, weeklyActivity, tr),
    makeCategoryMetric('Personal', personal, weeklyActivity, tr),
  ]
  return metrics.filter(m => m.count > 0 || statuses.length === 0)
}

function makeCategoryMetric(key, items, weeklyActivity, tr) {
  const score = weightedProgress(items)
  const expected = expectedFor(items)
  const risk = items.filter(s => s.health !== 'green').length
  const series = sparkSeries(score, weeklyActivity, key)
  const prev = series.slice(-4, -1)
  const prevAvg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : score
  const delta = round(score - prevAvg)
  return {
    key,
    label: labelForCategory(key, tr),
    color: CAT[key] || CAT.Other,
    score,
    expected,
    count: items.length,
    risk,
    series,
    delta,
  }
}

function sparkSeries(score, weeklyActivity = [], seed = 'Work') {
  const recent = (weeklyActivity || []).slice(-6)
  const maxCount = Math.max(1, ...recent.map(w => Number(w.count) || 0))
  const seedShift = seed === 'Personal' ? 6 : 0
  if (!recent.length) {
    return Array.from({ length: 6 }, (_, i) => clamp(score - (5 - i) * 3 + seedShift / 4))
  }
  return recent.map((w, i) => {
    const activityLift = ((Number(w.count) || 0) / maxCount) * 10
    const timeLift = (i - (recent.length - 1)) * 2.2
    const lastBias = i === recent.length - 1 ? score : score - 8
    return round(clamp(lastBias + timeLift + activityLift + seedShift / 5), 1)
  })
}

function buildTrendSeries(metrics, weeklyActivity) {
  return metrics
    .map(metric => ({
      ...metric,
      series: sparkSeries(metric.score, weeklyActivity, metric.key).slice(-6),
    }))
}

function dateKey(value) {
  if (!value) return ''
  try {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10)
    return d.toISOString().slice(0, 10)
  } catch {
    return String(value).slice(0, 10)
  }
}

function currentWeekDays() {
  const now = new Date()
  const monday = new Date(now)
  const day = monday.getDay() || 7
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() - day + 1)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function statusColor(status, isFuture, isWeekend) {
  if (status === 'da_lam') return HC.green
  if (status === 'dang_lam' || status === 'se_lam') return HC.yellow
  if (isFuture || isWeekend) return '#cbd5e1'
  return HC.red
}

function kpiStatusColor(health) {
  return HC[health] || HC.green
}

function buildWeeklyBars(data) {
  const activity = (data.weekly_activity || []).slice(-5)
  const maxCount = Math.max(1, ...activity.map(w => Number(w.count) || 0))
  return activity.map((w, i) => {
    const base = Number(data.overall_progress) || 0
    const activityLift = ((Number(w.count) || 0) / maxCount) * 8
    const value = clamp(base - (activity.length - 1 - i) * 3 + activityLift)
    return { label: w.label || `W${i + 1}`, value: round(value) }
  })
}

function objectiveRows(data, statuses) {
  const rows = (data.objectives || []).map(obj => {
    const children = statuses.filter(s => s.kpi?.objective_id === obj.id)
    const plan = expectedFor(children)
    const actual = Number(obj.progress) || weightedProgress(children)
    return {
      id: obj.id,
      name: obj.name,
      plan: round(plan),
      actual: round(actual),
      delta: round(actual - plan),
      color: actual >= plan ? HC.green : actual + 8 >= plan ? HC.yellow : HC.red,
      children,
    }
  })
  if (rows.length) return rows
  const byCategory = ['Work', 'Personal'].map(key => {
    const children = statuses.filter(s => categoryOf(s.kpi) === key)
    const actual = weightedProgress(children)
    const plan = expectedFor(children)
    return {
      id: key,
      name: key,
      plan: round(plan),
      actual: round(actual),
      delta: round(actual - plan),
      color: actual >= plan ? HC.green : actual + 8 >= plan ? HC.yellow : HC.red,
      children,
    }
  }).filter(r => r.children.length)
  return byCategory
}

function topWins(statuses, tr) {
  return [...statuses]
    .sort((a, b) => (b.gap - a.gap) || (b.kpi.progress - a.kpi.progress))
    .slice(0, 3)
    .map(s => tr('pulse.win_item', { name: s.kpi.name, value: `${s.gap >= 0 ? '+' : ''}${round(s.gap)}` }))
}

function topConcerns(statuses, tr) {
  return [...statuses]
    .filter(s => s.gap < 0)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 3)
    .map(s => tr('pulse.concern_item', { name: s.kpi.name, value: Math.abs(round(s.gap)) }))
}

function buildInsight(statuses, metrics, tr) {
  const strength = [...metrics].filter(m => m.count > 0).sort((a, b) => b.score - a.score)[0]
  const risk = [...statuses].filter(s => s.gap < 0).sort((a, b) => a.gap - b.gap)[0]
  const priority = risk || [...statuses].sort((a, b) => (a.kpi.progress || 0) - (b.kpi.progress || 0))[0]
  const riskCount = statuses.filter(s => s.health === 'red').length
  const yellowCount = statuses.filter(s => s.health === 'yellow').length
  return {
    topStrength: strength
      ? tr('pulse.insight_strength_text', { category: strength.label, value: round(strength.score) })
      : tr('pulse.insight_no_strength'),
    topRisk: risk
      ? tr('pulse.insight_risk_text', { name: risk.kpi.name, value: Math.abs(round(risk.gap)) })
      : tr('pulse.insight_no_risk'),
    topPriority: priority
      ? tr('pulse.insight_priority_text', { name: priority.kpi.name })
      : tr('pulse.insight_no_priority'),
    overview: risk
      ? tr('pulse.overview_insight_risk', { name: risk.kpi.name, value: Math.abs(round(risk.gap)) })
      : tr('pulse.overview_insight_ok', { count: statuses.length }),
    correlation: tr('pulse.correlation_text', { risk: riskCount, attention: yellowCount }),
    forecast: tr('pulse.forecast_text', {
      work: round(metrics.find(m => m.key === 'Work')?.score || 0),
      personal: round(metrics.find(m => m.key === 'Personal')?.score || 0),
    }),
    adjustment: risk
      ? tr('pulse.adjustment_text', { name: risk.kpi.name })
      : tr('pulse.adjustment_ok'),
    actions: priority
      ? [
          tr('pulse.action_log', { name: priority.kpi.name }),
          tr('pulse.action_split', { name: priority.kpi.name }),
          tr('pulse.action_review'),
        ]
      : [tr('pulse.action_start')],
  }
}

function slopeOf(series) {
  if (!series || series.length < 2) return 0
  const n = series.length
  const avgX = (n - 1) / 2
  const avgY = series.reduce((a, b) => a + b, 0) / n
  const num = series.reduce((sum, y, x) => sum + (x - avgX) * (y - avgY), 0)
  const den = series.reduce((sum, _y, x) => sum + (x - avgX) ** 2, 0) || 1
  return round(num / den, 1)
}

function PulseHeader({ activeView, setActiveView, tr }) {
  const tabs = [
    ['overview', 'table', tr('pulse.tab_overview')],
    ['weekly', 'clock', tr('pulse.tab_weekly')],
    ['monthly', 'target', tr('pulse.tab_monthly')],
    ['trend', 'chartDown', tr('pulse.tab_trend')],
    ['goal', 'flag', tr('pulse.tab_goal')],
    ['insight', 'bot', tr('pulse.tab_insight')],
  ]
  return (
    <div className="pp-tabs" role="tablist" aria-label={tr('pulse.tabs_label')}>
      {tabs.map(([key, icon, label]) => (
        <button
          key={key}
          type="button"
          className={`pp-tab${activeView === key ? ' active' : ''}`}
          onClick={() => setActiveView(key)}
          role="tab"
          aria-selected={activeView === key}
        >
          <UiIcon name={icon} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}

function Panel({ icon, title, action, children }) {
  return (
    <section className="pp-panel">
      <div className="pp-panel-head">
        <div className="pp-panel-title">
          <UiIcon name={icon} />
          <span>{title}</span>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function Sparkline({ values, color }) {
  const w = 180
  const h = 30
  const max = Math.max(100, ...values)
  const min = Math.min(0, ...values)
  const range = Math.max(1, max - min)
  const points = values.map((v, i) => {
    const x = (w / Math.max(1, values.length - 1)) * i
    const y = h - ((v - min) / range) * h
    return { x, y }
  })
  const path = points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ')
  return (
    <svg className="pp-spark-svg" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={path} className="pp-spark-path" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={color} opacity=".85" />)}
    </svg>
  )
}

function OverviewView({ data, metrics, insight, activeCategory, setActiveCategory, setActiveView, tr }) {
  const counted = useCountUp(data.overall_progress)
  const radius = 54
  const circum = 2 * Math.PI * radius
  const fill = clamp(counted) / 100 * circum
  return (
    <>
      <div className="pp-hero">
        <section className="pp-band">
          <div className="pp-ring" aria-label={tr('pulse.overall_score')}>
            <svg viewBox="0 0 132 132">
              <circle cx="66" cy="66" r={radius} fill="none" stroke="var(--pp-soft)" strokeWidth="12" />
              <circle
                className="pp-ring-progress"
                cx="66"
                cy="66"
                r={radius}
                fill="none"
                stroke="var(--pp-teal)"
                strokeWidth="12"
                strokeLinecap="round"
                transform="rotate(-90 66 66)"
                style={{ '--pp-ring-fill': `${fill}`, '--pp-ring-rest': `${circum - fill}` }}
              />
            </svg>
            <div className="pp-ring-inner">
              <span className="pp-ring-num">{counted}%</span>
              <span className="pp-ring-label">{tr('pulse.overall_score')}</span>
            </div>
          </div>
          <div>
            <h1 className="pp-title">{tr('pulse.title')}</h1>
            <p className="pp-subtitle">{tr('pulse.subtitle')}</p>
            <div className="pp-hero-actions">
              <button className="btn small" onClick={() => setActiveView('weekly')}>
                <UiIcon name="clock" />{tr('pulse.open_weekly')}
              </button>
              <button className="btn small" onClick={() => setActiveView('insight')}>
                <UiIcon name="bot" />{tr('pulse.open_insight')}
              </button>
            </div>
            <div className="pp-pulse-grid">
              {metrics.map(metric => (
                <button
                  key={metric.key}
                  type="button"
                  className={`pp-pulse-card${activeCategory === metric.key ? ' active' : ''}`}
                  style={{ '--pp-card-color': metric.color }}
                  onClick={() => {
                    setActiveCategory(metric.key)
                    setActiveView('weekly')
                  }}
                >
                  <span className="pp-card-head">
                    <span>{metric.label}</span>
                    <span className="pp-card-icon"><UiIcon name="target" /></span>
                  </span>
                  <span className="pp-card-score">{round(metric.score)}%</span>
                  <span className="pp-card-meta">
                    {tr('pulse.card_meta', { count: metric.count, risk: metric.risk, expected: round(metric.expected) })}
                  </span>
                  <span className="pp-card-track">
                    <span className="pp-card-fill" style={{ '--pp-fill': `${clamp(metric.score)}%` }} />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="pp-panel pp-insight">
          <div className="pp-insight-head"><UiIcon name="sparkles" />{tr('pulse.ai_overview')}</div>
          <div className="pp-typewriter">{insight.overview}</div>
          <div className="pp-spark-list">
            {metrics.map(metric => (
              <div key={metric.key} className="pp-spark-row">
                <span className="pp-spark-name">{metric.label}</span>
                <Sparkline values={metric.series} color={metric.color} />
                <span className="pp-spark-delta" style={{ color: metric.delta >= 0 ? HC.green : HC.red }}>
                  {metric.delta >= 0 ? '+' : ''}{metric.delta}%
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}

function WeeklyView({ statuses, activeCategory, setActiveCategory, setSelectedStatus, setActiveView, data, tr }) {
  const [suggestions, setSuggestions] = useState({})
  const tabs = ['Work', 'Personal'].filter(cat => statuses.some(s => categoryOf(s.kpi) === cat))
  const visibleTabs = tabs.length ? tabs : [activeCategory]
  const filtered = filterStatuses(statuses, activeCategory)
  const rows = filtered.slice(0, 8)
  return (
    <div className="pp-section-grid">
      <Panel
        icon="clock"
        title={tr('pulse.weekly_title')}
        action={
          <div className="pp-chip-row">
            {visibleTabs.map(tab => (
              <button
                key={tab}
                type="button"
                className={`pp-chip${activeCategory === tab ? ' active' : ''}`}
                onClick={() => setActiveCategory(tab)}
              >
                {labelForCategory(tab, tr)}
              </button>
            ))}
          </div>
        }
      >
        {rows.length ? (
          <div className="pp-kpi-list">
            {rows.map((status, i) => {
              const color = kpiStatusColor(status.health)
              const kpi = status.kpi
              return (
                <article key={kpi.id} className="pp-kpi-row" style={{ animationDelay: `${i * 0.05}s` }}>
                  <div className="pp-kpi-row-top">
                    <div>
                      <div className="pp-kpi-name">{kpi.name}</div>
                      <div className="pp-kpi-meta">
                        <span className="pp-pill">{labelForCategory(categoryOf(kpi), tr)}</span>
                        <span className="pp-pill">{tr('pulse.weight', { value: kpi.weight || 0 })}</span>
                        <span className="pp-pill">{tr('pulse.target', { current: kpi.current_value, target: kpi.target_value, unit: kpi.unit })}</span>
                      </div>
                    </div>
                    <span className="pp-pill" style={{ color }}>
                      <UiIcon name={status.health === 'green' ? 'check' : status.health === 'yellow' ? 'warning' : 'x'} />
                      {round(status.gap)}%
                    </span>
                  </div>
                  <div className="pp-progress-row">
                    <div className="pp-progress-track">
                      <div className="pp-progress-fill" style={{ '--pp-fill': `${clamp(kpi.progress)}%`, background: color }} />
                    </div>
                    <span className="pp-progress-num">{round(kpi.progress)}%</span>
                  </div>
                  <div className="pp-actions">
                    <button className="btn small" onClick={() => {
                      setSelectedStatus(status)
                      setActiveView('goal')
                    }}>
                      <UiIcon name="flag" />{tr('pulse.detail')}
                    </button>
                    <button className="btn small" onClick={() => {
                      setSelectedStatus(status)
                      setActiveView('trend')
                    }}>
                      <UiIcon name="chartDown" />{tr('pulse.trend')}
                    </button>
                    <button className="btn small" onClick={() => setSuggestions(prev => ({
                      ...prev,
                      [kpi.id]: makeSuggestion(status, tr),
                    }))}>
                      <UiIcon name="bot" />{tr('pulse.ai_suggestion')}
                    </button>
                  </div>
                  {suggestions[kpi.id] && <div className="pp-inline-suggestion">{suggestions[kpi.id]}</div>}
                </article>
              )
            })}
          </div>
        ) : (
          <div className="pp-empty">{tr('pulse.empty_weekly')}</div>
        )}
      </Panel>
      <Panel icon="table" title={tr('pulse.heatmap_title')}>
        <WeeklyHeatmap statuses={filtered} items={data.recent_items || []} tr={tr} />
      </Panel>
    </div>
  )
}

function filterStatuses(statuses, category) {
  if (!category) return statuses
  return statuses.filter(s => categoryOf(s.kpi) === category)
}

function makeSuggestion(status, tr) {
  const kpi = status.kpi
  if (status.gap < -15) return tr('pulse.suggestion_red', { name: kpi.name, unit: kpi.unit })
  if (status.gap < -5) return tr('pulse.suggestion_yellow', { name: kpi.name })
  if (kpi.progress >= 100) return tr('pulse.suggestion_done', { name: kpi.name })
  return tr('pulse.suggestion_green', { name: kpi.name })
}

function WeeklyHeatmap({ statuses, items, tr }) {
  const days = currentWeekDays()
  const todayKey = dateKey(new Date())
  const top = statuses.slice(0, 7)
  if (!top.length) return <div className="pp-empty">{tr('pulse.empty_heatmap')}</div>
  return (
    <div className="pp-heatmap">
      <span />
      {WEEK_DAYS.map(day => <span key={day} className="pp-heat-head">{day}</span>)}
      {top.map(status => (
        <div key={status.kpi.id} style={{ display: 'contents' }}>
          <span className="pp-heat-name">{status.kpi.name}</span>
          {days.map((d, idx) => {
            const key = dateKey(d)
            const found = items.find(item => item.kpi_id === status.kpi.id && dateKey(item.work_date || item.created_at) === key)
            const isFuture = key > todayKey
            const isWeekend = idx >= 5
            const color = statusColor(found?.status, isFuture, isWeekend)
            return (
              <span key={key} className="pp-heat-cell" style={{ '--pp-cell-color': color, animationDelay: `${idx * 0.03}s` }} title={found?.title || key}>
                <span className="pp-heat-dot" />
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function MonthlyView({ data, statuses, tr }) {
  const rows = objectiveRows(data, statuses)
  const weekly = buildWeeklyBars(data)
  const wins = topWins(statuses, tr)
  const concerns = topConcerns(statuses, tr)
  const analysis = concerns.length
    ? tr('pulse.month_analysis_risk', { concern: concerns[0], win: wins[0] || tr('pulse.no_win') })
    : tr('pulse.month_analysis_ok', { win: wins[0] || tr('pulse.no_win') })
  return (
    <>
      <div className="pp-section-grid">
        <Panel icon="target" title={tr('pulse.monthly_radar')}>
          <Radar rows={rows} tr={tr} />
        </Panel>
        <Panel icon="list" title={tr('pulse.completion_table')}>
          <CompletionTable rows={rows} tr={tr} />
        </Panel>
      </div>
      <div className="pp-section-grid">
        <Panel icon="chartDown" title={tr('pulse.weekly_breakdown')}>
          <div className="pp-bar-list">
            {weekly.map((w, i) => (
              <div key={`${w.label}-${i}`} className="pp-bar-row">
                <strong>{w.label}</strong>
                <span className="pp-bar-track"><span className="pp-bar-fill" style={{ '--pp-fill': `${w.value}%` }} /></span>
                <span>{w.value}%</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel icon="sparkles" title={tr('pulse.wins_concerns')}>
          <div className="pp-two-list">
            <MiniList title={tr('pulse.wins')} items={wins} color={HC.green} empty={tr('pulse.no_win')} />
            <MiniList title={tr('pulse.concerns')} items={concerns} color={HC.red} empty={tr('pulse.no_concern')} />
          </div>
        </Panel>
      </div>
      <Panel icon="bot" title={tr('pulse.monthly_analysis')}>
        <div className="pp-analysis">{analysis}</div>
      </Panel>
    </>
  )
}

function Radar({ rows, tr }) {
  const axes = rows.length >= 3 ? rows.slice(0, 6) : [
    ...rows,
    { id: 'plan', name: 'Plan', actual: rows[0]?.plan || 0 },
    { id: 'risk', name: 'Risk', actual: Math.max(0, 100 - Math.abs(rows[0]?.delta || 0)) },
  ].slice(0, 6)
  if (axes.length < 3) return <div className="pp-empty">{tr('pulse.no_data')}</div>
  const w = 240
  const h = 220
  const cx = 120
  const cy = 112
  const r = 72
  const ptsFor = scale => axes.map((row, i) => {
    const angle = -Math.PI / 2 + i * Math.PI * 2 / axes.length
    return `${cx + Math.cos(angle) * r * scale},${cy + Math.sin(angle) * r * scale}`
  }).join(' ')
  const dataPoints = axes.map((row, i) => {
    const angle = -Math.PI / 2 + i * Math.PI * 2 / axes.length
    const scale = clamp(row.actual) / 100
    return { row, x: cx + Math.cos(angle) * r * scale, y: cy + Math.sin(angle) * r * scale, lx: cx + Math.cos(angle) * (r + 24), ly: cy + Math.sin(angle) * (r + 24) }
  })
  return (
    <div className="pp-radar-wrap">
      <svg className="pp-chart-svg" viewBox={`0 0 ${w} ${h}`}>
        {[.25, .5, .75, 1].map(scale => <polygon key={scale} points={ptsFor(scale)} fill="none" stroke="var(--pp-border)" />)}
        {dataPoints.map(p => <line key={`axis-${p.row.id}`} x1={cx} y1={cy} x2={p.lx} y2={p.ly} stroke="var(--pp-border)" />)}
        <polygon points={dataPoints.map(p => `${p.x},${p.y}`).join(' ')} fill="rgba(15,118,110,.18)" stroke="var(--pp-teal)" strokeWidth="3" />
        {dataPoints.map((p, i) => (
          <g key={p.row.id}>
            <circle className="pp-point" style={{ animationDelay: `${i * 0.05}s` }} cx={p.x} cy={p.y} r="4" fill="var(--pp-teal)" />
            <text x={p.lx} y={p.ly} textAnchor={p.lx < cx ? 'end' : p.lx > cx ? 'start' : 'middle'} fontSize="10" fill="var(--pp-muted)">
              {String(p.row.name).slice(0, 16)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function CompletionTable({ rows, tr }) {
  return (
    <div className="pp-table">
      <div className="pp-table-row head">
        <span>{tr('pulse.table_category')}</span>
        <span>{tr('pulse.table_plan')}</span>
        <span>{tr('pulse.table_actual')}</span>
        <span>{tr('pulse.table_delta')}</span>
      </div>
      {rows.map(row => (
        <div key={row.id} className="pp-table-row">
          <strong>{row.name}</strong>
          <span>{row.plan}%</span>
          <span>{row.actual}%</span>
          <span style={{ color: row.color, fontWeight: 850 }}>{row.delta >= 0 ? '+' : ''}{row.delta}%</span>
        </div>
      ))}
    </div>
  )
}

function MiniList({ title, items, color, empty }) {
  return (
    <div className="pp-mini-list">
      <div className="pp-panel-title" style={{ fontSize: 12 }}>
        <span>{title}</span>
      </div>
      {(items.length ? items : [empty]).map((item, idx) => (
        <div key={`${item}-${idx}`} className="pp-mini-item">
          <span className="pp-mini-dot" style={{ '--pp-dot': color }} />
          <span>{item}</span>
        </div>
      ))}
    </div>
  )
}

function TrendView({ metrics, data, selectedStatus, setSelectedStatus, setActiveView, tr }) {
  const series = buildTrendSeries(metrics, data.weekly_activity || [])
  const allValues = series.flatMap(s => s.series)
  const best = allValues.length ? Math.max(...allValues) : 0
  const worst = allValues.length ? Math.min(...allValues) : 0
  const pattern = best - worst > 18 ? tr('pulse.pattern_swing', { value: round(best - worst) }) : tr('pulse.pattern_stable')
  return (
    <>
      <Panel icon="chartDown" title={tr('pulse.trend_title')}>
        <MultiLineChart series={series} />
      </Panel>
      <div className="pp-section-grid">
        <Panel icon="compass" title={tr('pulse.momentum_title')}>
          <div className="pp-momentum-list">
            {series.map(s => {
              const slope = slopeOf(s.series)
              const rotation = slope > 1.5 ? '-45deg' : slope < -1.5 ? '45deg' : '0deg'
              const color = slope > 1.5 ? HC.green : slope < -1.5 ? HC.red : HC.yellow
              return (
                <div key={s.key} className="pp-momentum">
                  <strong>{s.label}</strong>
                  <span className="pp-arrow" style={{ '--pp-rotation': rotation, '--pp-arrow-color': color }}>
                    <UiIcon name="arrowRight" />
                  </span>
                  <span>{tr('pulse.slope_per_week', { value: `${slope >= 0 ? '+' : ''}${slope}` })}</span>
                </div>
              )
            })}
          </div>
        </Panel>
        <Panel icon="sparkles" title={tr('pulse.best_worst_title')}>
          <div className="pp-mini-list">
            <div className="pp-mini-item">
              <span className="pp-mini-dot" style={{ '--pp-dot': HC.green }} />
              <span>{tr('pulse.best_week', { value: round(best) })}</span>
            </div>
            <div className="pp-mini-item">
              <span className="pp-mini-dot" style={{ '--pp-dot': HC.red }} />
              <span>{tr('pulse.worst_week', { value: round(worst) })}</span>
            </div>
            {selectedStatus && (
              <button className="btn small" onClick={() => {
                setSelectedStatus(selectedStatus)
                setActiveView('goal')
              }}>
                <UiIcon name="flag" />{tr('pulse.open_selected_goal')}
              </button>
            )}
          </div>
        </Panel>
      </div>
      <Panel icon="bot" title={tr('pulse.pattern_insight')}>
        <div className="pp-analysis">{pattern}</div>
      </Panel>
    </>
  )
}

function MultiLineChart({ series }) {
  const w = 640
  const h = 260
  const padX = 42
  const padY = 30
  const innerW = w - padX * 2
  const innerH = h - padY * 2
  const labels = ['W-5', 'W-4', 'W-3', 'W-2', 'W-1', 'Now']
  const yFor = v => padY + innerH - clamp(v) / 100 * innerH
  return (
    <div className="pp-chart-wrap">
      <svg className="pp-chart-svg" viewBox={`0 0 ${w} ${h}`}>
        {[0, 25, 50, 75, 100].map(v => (
          <g key={v}>
            <line x1={padX} x2={w - padX} y1={yFor(v)} y2={yFor(v)} stroke="var(--pp-border)" strokeDasharray="4 5" />
            <text x={padX - 10} y={yFor(v) + 4} textAnchor="end" fontSize="10" fill="var(--pp-muted)">{v}%</text>
          </g>
        ))}
        {labels.map((label, i) => {
          const x = padX + innerW / (labels.length - 1) * i
          return <text key={label} x={x} y={h - 8} textAnchor="middle" fontSize="10" fill="var(--pp-muted)">{label}</text>
        })}
        {series.map((s, sIdx) => {
          const points = s.series.map((v, i) => ({
            x: padX + innerW / Math.max(1, s.series.length - 1) * i,
            y: yFor(v),
            v,
          }))
          const path = points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ')
          return (
            <g key={s.key}>
              <path className="pp-line-path" style={{ animationDelay: `${sIdx * 0.18}s` }} d={path} fill="none" stroke={s.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              {points.map((p, i) => <circle key={i} className="pp-point" style={{ animationDelay: `${0.2 + sIdx * 0.18 + i * 0.03}s` }} cx={p.x} cy={p.y} r="4" fill="var(--pp-surface)" stroke={s.color} strokeWidth="3" />)}
              <text x={w - padX + 8} y={points[points.length - 1]?.y || 0} fontSize="11" fill={s.color} fontWeight="800">{s.label}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function GoalView({ status, data, tr }) {
  if (!status) return <div className="pp-empty">{tr('pulse.empty_goal')}</div>
  const kpi = status.kpi
  const series = sparkSeries(kpi.progress, data.weekly_activity || [], String(kpi.id)).slice(-8)
  const avg4 = round(series.slice(-4).reduce((a, b) => a + b, 0) / Math.max(1, series.slice(-4).length))
  const best = round(Math.max(...series))
  const streak = series.slice().reverse().findIndex(v => v < 100)
  const currentStreak = streak === -1 ? series.length : streak
  const items = (data.recent_items || []).filter(item => item.kpi_id === kpi.id).slice(0, 6)
  const coach = status.gap < -10
    ? tr('pulse.coach_risk', { name: kpi.name, value: Math.abs(round(status.gap)) })
    : tr('pulse.coach_ok', { name: kpi.name })
  return (
    <>
      <Panel icon="flag" title={tr('pulse.goal_detail_title')}>
        <div className="pp-detail-head">
          <div>
            <div className="pp-detail-title">{kpi.name}</div>
            <p className="pp-subtitle">{kpi.description || kpi.target || tr('pulse.no_description')}</p>
          </div>
          <div className="pp-stat"><span>{tr('pulse.current_week')}</span><strong>{round(kpi.progress)}%</strong></div>
          <div className="pp-stat"><span>{tr('pulse.avg_4w')}</span><strong>{avg4}%</strong></div>
          <div className="pp-stat"><span>{tr('pulse.best')}</span><strong>{best}%</strong></div>
          <div className="pp-stat"><span>{tr('pulse.streak')}</span><strong>{currentStreak}</strong></div>
        </div>
      </Panel>
      <Panel icon="clock" title={tr('pulse.timeline_title')}>
        <div className="pp-timeline">
          {series.map((value, i) => {
            const color = value >= 100 ? HC.green : value >= 50 ? HC.yellow : HC.red
            return (
              <div key={i} className="pp-time-item" style={{ animationDelay: `${i * 0.04}s` }}>
                <div className="pp-time-dot" style={{ '--pp-time-color': color }} />
                <div className="pp-time-label">W-{series.length - i - 1 || 'Now'}</div>
                <div className="pp-time-value">{round(value)}%</div>
              </div>
            )
          })}
        </div>
      </Panel>
      <div className="pp-section-grid">
        <Panel icon="list" title={tr('pulse.log_history')}>
          {items.length ? (
            <div className="pp-log-list">
              {items.map(item => (
                <div key={item.id} className="pp-log-item">
                  <span>{dateKey(item.work_date || item.created_at)}</span>
                  <strong>{item.title}</strong>
                  <span style={{ color: item.progress_delta ? HC.green : 'var(--pp-muted)' }}>
                    {item.progress_delta ? `+${item.progress_delta} ${kpi.unit}` : item.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="pp-empty">{tr('pulse.empty_logs')}</div>
          )}
        </Panel>
        <Panel icon="bot" title={tr('pulse.ai_coach')}>
          <div className="pp-analysis">{coach}</div>
        </Panel>
      </div>
    </>
  )
}

function InsightView({ insight, onExport, tr }) {
  const [open, setOpen] = useState('correlation')
  const [checked, setChecked] = useState({})
  const sections = [
    ['correlation', tr('pulse.acc_correlation'), insight.correlation],
    ['forecast', tr('pulse.acc_forecast'), insight.forecast],
    ['adjustment', tr('pulse.acc_adjustment'), insight.adjustment],
  ]
  return (
    <>
      <Panel
        icon="bot"
        title={tr('pulse.insight_center_title')}
        action={<button className="btn small" onClick={onExport}><UiIcon name="download" />{tr('pulse.export_report')}</button>}
      >
        <div className="pp-ai-grid">
          <InsightCard icon="sparkles" label={tr('pulse.strength')} text={insight.topStrength} color={HC.green} />
          <InsightCard icon="warning" label={tr('pulse.risk')} text={insight.topRisk} color={HC.red} />
          <InsightCard icon="compass" label={tr('pulse.priority')} text={insight.topPriority} color={HC.yellow} />
        </div>
      </Panel>
      <div className="pp-section-grid">
        <Panel icon="list" title={tr('pulse.deep_analysis')}>
          <div className="pp-accordion">
            {sections.map(([key, label, body]) => (
              <div key={key} className="pp-acc-item">
                <button type="button" className="pp-acc-btn" onClick={() => setOpen(open === key ? '' : key)}>
                  <span>{label}</span>
                  <UiIcon name={open === key ? 'eyeOff' : 'eye'} />
                </button>
                {open === key && <div className="pp-acc-body">{body}</div>}
              </div>
            ))}
          </div>
        </Panel>
        <Panel icon="checkCircle" title={tr('pulse.suggested_actions')}>
          <div className="pp-action-list">
            {insight.actions.map((action, i) => (
              <label key={`${action}-${i}`} className="pp-action-item">
                <input
                  type="checkbox"
                  checked={!!checked[i]}
                  onChange={e => setChecked(prev => ({ ...prev, [i]: e.target.checked }))}
                />
                <span>{action}</span>
              </label>
            ))}
          </div>
        </Panel>
      </div>
    </>
  )
}

function InsightCard({ icon, label, text, color }) {
  return (
    <div className="pp-ai-card" style={{ '--pp-card-color': color }}>
      <div className="pp-ai-label"><UiIcon name={icon} />{label}</div>
      <div className="pp-ai-text">{text}</div>
    </div>
  )
}

export default function DashboardPersonalPulse() {
  const { tr } = useLang()
  const { mode } = useView()
  const { activeCycleId, cycles, loading: cyclesLoading } = useCycle()
  const toast = useToast()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [activeView, setActiveView] = useState('overview')
  const [activeCategory, setActiveCategory] = useState('Work')
  const [selectedStatus, setSelectedStatus] = useState(null)

  const dashboardCategory = mode === 'personal' ? 'Personal' : 'Work'
  const load = useCallback(() => {
    if (cyclesLoading) return
    if (activeCycleId && cycles.length > 0 && !cycles.some(c => c.id === activeCycleId)) return
    setError('')
    return api.dashboard(activeCycleId, dashboardCategory)
      .then(res => {
        setData(res)
        setSelectedStatus(null)
      })
      .catch(e => setError(e.message))
  }, [activeCycleId, dashboardCategory, cycles, cyclesLoading])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setActiveCategory(dashboardCategory)
  }, [dashboardCategory])

  const statuses = useMemo(() => {
    const all = data?.kpi_statuses || []
    return all.filter(s => matchView(mode, s.kpi.category, s.health))
  }, [data, mode])

  const metrics = useMemo(() => makeCategoryCards(statuses, data?.weekly_activity || [], tr), [statuses, data, tr])
  const insight = useMemo(() => buildInsight(statuses, metrics, tr), [statuses, metrics, tr])
  const currentStatus = selectedStatus || statuses[0] || null

  const exportReport = async () => {
    try {
      await api.exportEvaluation(activeCycleId)
      toast.success?.(tr('pulse.export_started'))
    } catch (e) {
      toast.error(e.message)
    }
  }

  if (error) return <div className="page"><div className="error-text"><UiIcon name="warning" /> {error}</div></div>
  if (!data) return <div className="page" style={{ color: 'var(--muted)', fontSize: 14 }}>{tr('dashboard.loading')}</div>

  return (
    <div className="page pp-wrap">
      <style>{PULSE_CSS}</style>
      <div className="pp-topbar">
        <div className="pp-view-switch"><ViewModeSwitch /></div>
        <button className="btn small" onClick={() => navigate('/dashboard')}>
          <UiIcon name="arrowLeft" />{tr('pulse.compare_current')}
        </button>
      </div>
      <PulseHeader activeView={activeView} setActiveView={setActiveView} tr={tr} />

      {activeView === 'overview' && (
        <OverviewView
          data={data}
          metrics={metrics}
          insight={insight}
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
          setActiveView={setActiveView}
          tr={tr}
        />
      )}
      {activeView === 'weekly' && (
        <WeeklyView
          statuses={statuses}
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
          setSelectedStatus={setSelectedStatus}
          setActiveView={setActiveView}
          data={data}
          tr={tr}
        />
      )}
      {activeView === 'monthly' && <MonthlyView data={data} statuses={statuses} tr={tr} />}
      {activeView === 'trend' && (
        <TrendView
          metrics={metrics}
          data={data}
          selectedStatus={currentStatus}
          setSelectedStatus={setSelectedStatus}
          setActiveView={setActiveView}
          tr={tr}
        />
      )}
      {activeView === 'goal' && <GoalView status={currentStatus} data={data} tr={tr} />}
      {activeView === 'insight' && <InsightView insight={insight} onExport={exportReport} tr={tr} />}
    </div>
  )
}
