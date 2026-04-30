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
  // Add user_agent column to existing tables without it
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS user_agent TEXT DEFAULT ''`);

  // Testimonials table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS testimonials (
      id         SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      name       TEXT NOT NULL,
      role       TEXT DEFAULT '',
      rating     INT  DEFAULT 5,
      message    TEXT NOT NULL,
      status     TEXT DEFAULT 'pending'
    )
  `);

  // Settings table (key/value)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )
  `);
  await pool.query(`
    INSERT INTO settings (key, value) VALUES ('under_construction', 'false')
    ON CONFLICT (key) DO NOTHING
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

  const [views, unique, starts, leadsInRange, daily, eventCounts, ctaRows, sectionRows,
         todayViews, weekViews, todayUnique, topPages, topReferrers, recentRows] = await Promise.all([
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

    // Today page views
    pool.query(`SELECT COUNT(*)::int n FROM events WHERE event='page_view' AND created_at::date = CURRENT_DATE`),
    // This week page views
    pool.query(`SELECT COUNT(*)::int n FROM events WHERE event='page_view' AND created_at >= date_trunc('week', CURRENT_DATE)`),
    // Today unique visitors
    pool.query(`SELECT COUNT(DISTINCT ip)::int n FROM events WHERE event='page_view' AND created_at::date = CURRENT_DATE`),
    // Top pages
    pool.query(`SELECT COALESCE(NULLIF(page,''),'/') page, COUNT(*)::int n FROM events
      WHERE event='page_view' AND created_at >= NOW() - $1::INTERVAL
      GROUP BY page ORDER BY n DESC LIMIT 8`, [interval]),
    // Top referrers
    pool.query(`SELECT
        COALESCE(NULLIF(NULLIF((data::jsonb)->>'referrer',''),'direct'),'Direct') ref,
        COUNT(*)::int n
      FROM events
      WHERE event='page_view' AND created_at >= NOW() - $1::INTERVAL
        AND data IS NOT NULL AND data <> '' AND data <> '{}'
      GROUP BY ref ORDER BY n DESC LIMIT 8`, [interval]),
    // Recent visitors (last 30 page views)
    pool.query(`SELECT created_at, page, ip, user_agent,
        CASE WHEN data IS NOT NULL AND data <> '' AND data <> '{}' THEN data ELSE '{}' END AS data
      FROM events WHERE event='page_view'
      ORDER BY created_at DESC LIMIT 30`),
  ]);

  const pageViews    = views.rows[0].n;
  const leadsCount   = leadsInRange.rows[0].n;
  const convRate     = pageViews > 0 ? ((leadsCount / pageViews) * 100).toFixed(1) : '0.0';

  return {
    pageViews,
    uniqueIPs:      unique.rows[0].n,
    formStarts:     starts.rows[0].n,
    leadsInRange:   leadsCount,
    convRate,
    daily:          daily.rows,
    topEvents:      eventCounts.rows,
    topCTAs:        ctaRows.rows,
    topSections:    sectionRows.rows,
    todayViews:     todayViews.rows[0].n,
    weekViews:      weekViews.rows[0].n,
    todayUnique:    todayUnique.rows[0].n,
    topPages:       topPages.rows,
    topReferrers:   topReferrers.rows,
    recentVisitors: recentRows.rows,
    days,
  };
}

// ── Events ────────────────────────────────────────────────
async function insertEvent({ event, page, data, ip, user_agent = '' }) {
  let jsonData;
  try { jsonData = typeof data === 'string' ? JSON.parse(data) : (data || {}); }
  catch { jsonData = {}; }
  await pool.query(
    'INSERT INTO events (event, page, data, ip, user_agent) VALUES ($1,$2,$3,$4,$5)',
    [event, page, jsonData, ip, user_agent]
  );
}

// ── Geo ───────────────────────────────────────────────────
async function getTopIPs(days = 30) {
  const { rows } = await pool.query(
    `SELECT ip, COUNT(*)::int n FROM events
     WHERE created_at >= NOW() - $1::INTERVAL
       AND ip IS NOT NULL AND ip <> '' AND ip <> '::1' AND ip <> '127.0.0.1'
     GROUP BY ip ORDER BY n DESC LIMIT 200`,
    [`${days} days`]
  );
  return rows;
}

// ── Settings ──────────────────────────────────────────────
async function getSetting(key) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key=$1', [key]);
  return rows[0]?.value ?? null;
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

// ── Testimonials ──────────────────────────────────────────
async function insertTestimonial({ name, role, rating, message }) {
  const { rows } = await pool.query(
    `INSERT INTO testimonials (name, role, rating, message) VALUES ($1,$2,$3,$4) RETURNING id`,
    [name, role || '', Math.min(5, Math.max(1, parseInt(rating) || 5)), message]
  );
  return rows[0];
}

async function getApprovedTestimonials() {
  const { rows } = await pool.query(
    `SELECT id, created_at, name, role, rating, message FROM testimonials WHERE status='approved' ORDER BY created_at DESC`
  );
  return rows;
}

async function getAllTestimonials() {
  const { rows } = await pool.query(`SELECT * FROM testimonials ORDER BY created_at DESC`);
  return rows;
}

async function updateTestimonialStatus(id, status) {
  await pool.query(`UPDATE testimonials SET status=$1 WHERE id=$2`, [status, id]);
}

async function deleteTestimonial(id) {
  await pool.query(`DELETE FROM testimonials WHERE id=$1`, [id]);
}

module.exports = { init, insertLead, queryLeads, updateLead, deleteLead, getStats, getAnalytics, insertEvent, getTopIPs, getSetting, setSetting, insertTestimonial, getApprovedTestimonials, getAllTestimonials, updateTestimonialStatus, deleteTestimonial };
