const express = require('express');
const path    = require('path');
const db      = require('./db/setup');

const app  = express();
const PORT = process.env.PORT || 3000;

const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'bluescapes2025';

// ── Middleware ────────────────────────────────────────────
app.use(express.static(path.join(__dirname), { index: false, dotfiles: 'deny' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── HTTP Basic Auth for /admin ────────────────────────────
const requireAuth = (req, res, next) => {
  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    const [user, pass] = Buffer.from(header.slice(6), 'base64').toString().split(':');
    if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="BlueScapes Admin"');
  res.status(401).send('Login required');
};

// ── Landing Page ──────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── Public: Lead Capture ──────────────────────────────────
app.post('/api/contact', async (req, res) => {
  const { first_name, last_name, email, phone, project_type, message,
          utm_source, utm_medium, utm_campaign } = req.body;

  if (!first_name || !email || !phone)
    return res.status(400).json({ error: 'Missing required fields' });

  try {
    const lead = await db.insertLead({
      first_name:   first_name.trim(),
      last_name:    (last_name || '').trim(),
      email:        email.trim().toLowerCase(),
      phone:        phone.trim(),
      project_type: project_type || '',
      message:      (message || '').trim(),
      utm_source:   utm_source   || '',
      utm_medium:   utm_medium   || '',
      utm_campaign: utm_campaign || '',
      ip_address:   req.ip       || '',
      referrer:     req.get('referer') || '',
    });
    res.json({ success: true, id: lead.id });
  } catch (err) {
    console.error('insertLead error:', err.message);
    res.status(500).json({ error: 'Could not save lead' });
  }
});

// ── Public: Event Ping ────────────────────────────────────
app.post('/api/event', async (req, res) => {
  const { event, page, data } = req.body;
  if (!event) return res.status(400).json({ error: 'Missing event' });
  try {
    await db.insertEvent({ event, page: page || '', data: data || {}, ip: req.ip || '' });
  } catch { /* never block the page for analytics */ }
  res.json({ ok: true });
});

// ── Admin: Dashboard ──────────────────────────────────────
app.get('/admin', requireAuth, (req, res) =>
  res.sendFile(path.join(__dirname, 'admin', 'dashboard.html'))
);

// ── Admin: Leads API ──────────────────────────────────────
app.get('/admin/api/leads', requireAuth, async (req, res) => {
  const { status, project, search } = req.query;
  const [leads, stats] = await Promise.all([
    db.queryLeads({ status, project, search }),
    db.getStats(),
  ]);
  res.json({ leads, total: leads.length, stats });
});

app.patch('/admin/api/leads/:id', requireAuth, async (req, res) => {
  await db.updateLead(req.params.id, req.body);
  res.json({ success: true });
});

app.delete('/admin/api/leads/:id', requireAuth, async (req, res) => {
  await db.deleteLead(req.params.id);
  res.json({ success: true });
});

app.get('/admin/api/analytics', requireAuth, async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  res.json(await db.getAnalytics(days));
});

app.get('/admin/api/export', requireAuth, async (req, res) => {
  const leads = await db.queryLeads();
  const cols  = ['id','created_at','first_name','last_name','email','phone',
                  'project_type','status','utm_source','utm_medium','utm_campaign',
                  'referrer','message','notes'];
  const csv = [
    cols.join(','),
    ...leads.map(l => cols.map(c => `"${String(l[c] ?? '').replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="bluescapes-leads-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

// ── Fallback ──────────────────────────────────────────────
app.get('*', (req, res) => res.redirect('/'));

// ── Start ─────────────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set.');
  process.exit(1);
}

db.init()
  .then(() => app.listen(PORT, () => console.log(`BlueScapes running on port ${PORT}`)))
  .catch(err => { console.error('DB init failed:', err.message); process.exit(1); });
