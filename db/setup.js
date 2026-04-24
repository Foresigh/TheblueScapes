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

module.exports = { insertLead, queryLeads, updateLead, deleteLead, getStats, insertEvent };
