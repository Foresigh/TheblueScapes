const fs   = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.json');

let db = null;

function load() {
  if (db) return db;
  try {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    db = { leads: [], events: [], _leadSeq: 0, _eventSeq: 0 };
  }
  return db;
}

function save() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ── Lead helpers ─────────────────────────────────────────
function insertLead(fields) {
  const d = load();
  d._leadSeq += 1;
  const lead = {
    id:           d._leadSeq,
    created_at:   new Date().toISOString(),
    status:       'new',
    notes:        '',
    ...fields,
  };
  d.leads.unshift(lead);
  save();
  return lead;
}

function queryLeads({ status, project, search } = {}) {
  let rows = [...load().leads];
  if (status  && status  !== 'all') rows = rows.filter(l => l.status       === status);
  if (project && project !== 'all') rows = rows.filter(l => l.project_type === project);
  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter(l =>
      (l.first_name  || '').toLowerCase().includes(s) ||
      (l.last_name   || '').toLowerCase().includes(s) ||
      (l.email       || '').toLowerCase().includes(s) ||
      (l.phone       || '').includes(s)
    );
  }
  return rows;
}

function updateLead(id, fields) {
  const d = load();
  const idx = d.leads.findIndex(l => l.id === Number(id));
  if (idx === -1) return null;
  d.leads[idx] = { ...d.leads[idx], ...fields };
  save();
  return d.leads[idx];
}

function deleteLead(id) {
  const d = load();
  d.leads = d.leads.filter(l => l.id !== Number(id));
  save();
}

// ── Stats ─────────────────────────────────────────────────
function getStats() {
  const all = load().leads;
  const now      = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const weekAgo  = new Date(now - 7 * 86400000).toISOString();

  const byType   = {};
  const byStatus = {};
  const bySrc    = {};

  all.forEach(l => {
    const t = l.project_type || 'Not specified';
    byType[t]   = (byType[t]   || 0) + 1;
    byStatus[l.status || 'new'] = (byStatus[l.status || 'new'] || 0) + 1;
    const src = l.utm_source || 'direct';
    bySrc[src]  = (bySrc[src]  || 0) + 1;
  });

  return {
    total:    all.length,
    today:    all.filter(l => l.created_at.slice(0, 10) === todayStr).length,
    week:     all.filter(l => l.created_at >= weekAgo).length,
    pending:  all.filter(l => !l.status || l.status === 'new').length,
    byType:   Object.entries(byType).map(([project_type, n]) => ({ project_type, n })).sort((a,b) => b.n - a.n),
    byStatus: Object.entries(byStatus).map(([status, n]) => ({ status, n })),
    bySource: Object.entries(bySrc).map(([src, n]) => ({ src, n })).sort((a,b) => b.n - a.n),
  };
}

// ── Event helpers ─────────────────────────────────────────
function insertEvent(fields) {
  const d = load();
  d._eventSeq += 1;
  d.events.unshift({ id: d._eventSeq, created_at: new Date().toISOString(), ...fields });
  if (d.events.length > 10000) d.events = d.events.slice(0, 10000);
  save();
}

function getAnalytics(days = 30) {
  const events   = load().events;
  const leads    = load().leads;
  const cutoff   = new Date(Date.now() - days * 86400000).toISOString();
  const recent   = events.filter(e => e.created_at >= cutoff);

  // Daily page views for chart (last `days` days)
  const dailyMap = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    dailyMap[d] = 0;
  }
  recent.filter(e => e.event === 'page_view')
    .forEach(e => { const d = e.created_at.slice(0, 10); if (d in dailyMap) dailyMap[d]++; });
  const daily = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, views]) => ({ date, views }));

  // Unique visitors by IP
  const uniqueIPs    = new Set(recent.filter(e => e.event === 'page_view').map(e => e.ip)).size;
  const pageViews    = recent.filter(e => e.event === 'page_view').length;
  const formStarts   = recent.filter(e => e.event === 'form_start').length;
  const leadsInRange = leads.filter(l => l.created_at >= cutoff).length;

  // Event breakdown
  const eventCounts = {};
  recent.forEach(e => { eventCounts[e.event] = (eventCounts[e.event] || 0) + 1; });
  const topEvents = Object.entries(eventCounts)
    .map(([event, n]) => ({ event, n }))
    .sort((a, b) => b.n - a.n);

  // Top CTAs clicked
  const ctaMap = {};
  recent.filter(e => e.event === 'cta_click').forEach(e => {
    try {
      const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      const label = d.cta_text || 'unknown';
      ctaMap[label] = (ctaMap[label] || 0) + 1;
    } catch {}
  });
  const topCTAs = Object.entries(ctaMap)
    .map(([label, n]) => ({ label, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);

  // Top sections viewed
  const sectionMap = {};
  recent.filter(e => e.event === 'section_view').forEach(e => {
    try {
      const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      const s = d.section || 'unknown';
      sectionMap[s] = (sectionMap[s] || 0) + 1;
    } catch {}
  });
  const topSections = Object.entries(sectionMap)
    .map(([section, n]) => ({ section, n }))
    .sort((a, b) => b.n - a.n);

  // Conversion rate
  const convRate = pageViews > 0 ? ((leadsInRange / pageViews) * 100).toFixed(1) : '0.0';

  return { pageViews, uniqueIPs, formStarts, leadsInRange, convRate, daily, topEvents, topCTAs, topSections, days };
}

module.exports = { insertLead, queryLeads, updateLead, deleteLead, getStats, insertEvent, getAnalytics };
