const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Table init ────────────────────────────────────────────
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id            SERIAL PRIMARY KEY,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      first_name    TEXT NOT NULL,
      last_name     TEXT DEFAULT '',
      email         TEXT NOT NULL,
      phone         TEXT NOT NULL,
      project_type  TEXT DEFAULT '',
      message       TEXT DEFAULT '',
      status        TEXT DEFAULT 'new',
      notes         TEXT DEFAULT '',
      utm_source    TEXT DEFAULT '',
      utm_medium    TEXT DEFAULT '',
      utm_campaign  TEXT DEFAULT '',
      ip_address    TEXT DEFAULT '',
      referrer      TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS events (
      id         SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      event      TEXT NOT NULL,
      page       TEXT DEFAULT '',
      data       TEXT DEFAULT '{}',
      ip         TEXT DEFAULT ''
    );
  `);
}

// ── Leads ─────────────────────────────────────────────────
async function insertLead(f) {
  const { rows } = await pool.query(
    `INSERT INTO leads
       (first_name,last_name,email,phone,project_type,message,
        utm_source,utm_medium,utm_campaign,ip_address,referrer)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [f.first_name, f.last_name, f.email, f.phone, f.project_type, f.message,
     f.utm_source, f.utm_medium, f.utm_campaign, f.ip_address, f.referrer]
  );
  return rows[0];
}

async function queryLeads({ status, project, search } = {}) {
  const conditions = [];
  const params     = [];

  if (status  && status  !== 'all') { params.push(status);          conditions.push(`status = $${params.length}`); }
  if (project && project !== 'all') { params.push(project);         conditions.push(`project_type = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    const p = params.length;
    conditions.push(`(first_name ILIKE $${p} OR last_name ILIKE $${p} OR email ILIKE $${p} OR phone ILIKE $${p})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`SELECT * FROM leads ${where} ORDER BY created_at DESC`, params);
  return rows;
}

async function updateLead(id, { status, notes }) {
  await pool.query('UPDATE leads SET status=$1, notes=$2 WHERE id=$3', [status, notes, id]);
}

async function deleteLead(id) {
  await pool.query('DELETE FROM leads WHERE id=$1', [id]);
}

// ── Stats ─────────────────────────────────────────────────
async function getStats() {
  const [total, today, week, pending, byType, byStatus, bySource] = await Promise.all([
    pool.query('SELECT COUNT(*)::int n FROM leads'),
    pool.query("SELECT COUNT(*)::int n FROM leads WHERE created_at::date = CURRENT_DATE"),
    pool.query("SELECT COUNT(*)::int n FROM leads WHERE created_at >= NOW() - INTERVAL '7 days'"),
    pool.query("SELECT COUNT(*)::int n FROM leads WHERE status = 'new'"),
    pool.query("SELECT project_type, COUNT(*)::int n FROM leads GROUP BY project_type ORDER BY n DESC"),
    pool.query("SELECT status, COUNT(*)::int n FROM leads GROUP BY status"),
    pool.query("SELECT COALESCE(NULLIF(utm_source,''),'direct') src, COUNT(*)::int n FROM leads GROUP BY src ORDER BY n DESC"),
  ]);

  return {
    total:    total.rows[0].n,
    today:    today.rows[0].n,
    week:     week.rows[0].n,
    pending:  pending.rows[0].n,
    byType:   byType.rows,
    byStatus: byStatus.rows,
    bySource: bySource.rows,
  };
}

// ── Analytics ─────────────────────────────────────────────
async function getAnalytics(days = 30) {
  const interval = `${days} days`;

  const [views, unique, starts, leadsInRange, daily, eventCounts, ctaRows, sectionRows] = await Promise.all([
    pool.query("SELECT COUNT(*)::int n FROM events WHERE event='page_view' AND created_at >= NOW() - $1::INTERVAL", [interval]),
    pool.query("SELECT COUNT(DISTINCT ip)::int n FROM events WHERE event='page_view' AND created_at >= NOW() - $1::INTERVAL", [interval]),
    pool.query("SELECT COUNT(*)::int n FROM events WHERE event='form_start' AND created_at >= NOW() - $1::INTERVAL", [interval]),
    pool.query("SELECT COUNT(*)::int n FROM leads WHERE created_at >= NOW() - $1::INTERVAL", [interval]),

    // Daily page views
    pool.query(`
      SELECT TO_CHAR(d::date,'YYYY-MM-DD') date,
             COALESCE(COUNT(e.id)::int, 0) views
      FROM generate_series(NOW() - $1::INTERVAL, NOW(), '1 day') d
      LEFT JOIN events e
             ON e.event = 'page_view'
            AND e.created_at::date = d::date
      GROUP BY d ORDER BY d`, [interval]),

    // All event counts
    pool.query(`SELECT event, COUNT(*)::int n FROM events WHERE created_at >= NOW() - $1::INTERVAL GROUP BY event ORDER BY n DESC`, [interval]),

    // Top CTAs — cast TEXT→JSONB safely
    pool.query(`
      SELECT (data::jsonb)->>'cta_text' label, COUNT(*)::int n
      FROM events
      WHERE event = 'cta_click'
        AND created_at >= NOW() - $1::INTERVAL
        AND data IS NOT NULL AND data <> '' AND data <> '{}'
        AND (data::jsonb)->>'cta_text' IS NOT NULL
      GROUP BY label ORDER BY n DESC LIMIT 5`, [interval]),

    // Top sections — cast TEXT→JSONB safely
    pool.query(`
      SELECT (data::jsonb)->>'section' section, COUNT(*)::int n
      FROM events
      WHERE event = 'section_view'
        AND created_at >= NOW() - $1::INTERVAL
        AND data IS NOT NULL AND data <> '' AND data <> '{}'
        AND (data::jsonb)->>'section' IS NOT NULL
      GROUP BY section ORDER BY n DESC`, [interval]),
  ]);

  const pageViews    = views.rows[0].n;
  const leadsCount   = leadsInRange.rows[0].n;
  const convRate     = pageViews > 0 ? ((leadsCount / pageViews) * 100).toFixed(1) : '0.0';

  return {
    pageViews,
    uniqueIPs:    unique.rows[0].n,
    formStarts:   starts.rows[0].n,
    leadsInRange: leadsCount,
    convRate,
    daily:        daily.rows,
    topEvents:    eventCounts.rows,
    topCTAs:      ctaRows.rows,
    topSections:  sectionRows.rows,
    days,
  };
}

// ── Events ────────────────────────────────────────────────
async function insertEvent({ event, page, data, ip }) {
  let jsonData;
  try { jsonData = typeof data === 'string' ? JSON.parse(data) : (data || {}); }
  catch { jsonData = {}; }
  await pool.query(
    'INSERT INTO events (event, page, data, ip) VALUES ($1,$2,$3,$4)',
    [event, page, jsonData, ip]
  );
}

module.exports = { init, insertLead, queryLeads, updateLead, deleteLead, getStats, getAnalytics, insertEvent };
