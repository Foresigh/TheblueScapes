const express    = require('express');
const crypto     = require('crypto');
const path       = require('path');
const geoip      = require('geoip-lite');
const { Resend } = require('resend');
const db         = require('./db/setup');

// ── Email setup ───────────────────────────────────────────
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.FROM_EMAIL || 'BlueScapes <onboarding@resend.dev>';

async function sendConfirmationEmail(lead) {
  if (!process.env.RESEND_API_KEY) return;
  if (!lead.email) return;
  await resend.emails.send({
    from: FROM,
    to: lead.email,
    subject: `We received your request, ${lead.first_name}!`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#08172e;padding:32px 24px;border-radius:8px 8px 0 0;text-align:center;">
          <h1 style="color:#C9A84C;margin:0;font-size:28px;">BLUE<span style="color:#fff;">SCAPES</span></h1>
          <p style="color:#aaa;margin:8px 0 0;font-size:14px;">Utah's Custom Pool Builders</p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;padding:32px 24px;border-radius:0 0 8px 8px;">
          <h2 style="color:#08172e;margin:0 0 16px;">Thanks, ${lead.first_name}! We got your request.</h2>
          <p style="color:#4b5563;line-height:1.7;">We've received your quote request and one of our team members will be in touch with you within <strong>1–2 business days</strong> to schedule your free consultation.</p>
          <p style="color:#4b5563;line-height:1.7;">In the meantime, if you have any urgent questions feel free to reach us directly:</p>
          <div style="background:#f9fafb;border-radius:8px;padding:16px 20px;margin:20px 0;">
            <p style="margin:0 0 8px;color:#08172e;"><strong>📞</strong> &nbsp;<a href="tel:8013605577" style="color:#0078B8;text-decoration:none;">801.360.5577</a></p>
            <p style="margin:0;color:#08172e;"><strong>✉️</strong> &nbsp;<a href="mailto:bluescapesutah@gmail.com" style="color:#0078B8;text-decoration:none;">bluescapesutah@gmail.com</a></p>
          </div>
          <p style="color:#4b5563;line-height:1.7;">We look forward to building something extraordinary for your family.</p>
          <p style="color:#4b5563;margin:0;">— The BlueScapes Team</p>
          <div style="margin-top:32px;padding-top:20px;border-top:1px solid #e5e7eb;text-align:center;">
            <p style="color:#9ca3af;font-size:12px;margin:0;">BlueScapes Utah &nbsp;·&nbsp; 801.360.5577 &nbsp;·&nbsp; bluescapesutah.com</p>
          </div>
        </div>
      </div>
    `,
  });
}

async function sendLeadEmail(lead) {
  if (!process.env.RESEND_API_KEY) return;
  const to = process.env.NOTIFY_EMAIL || 'bluescapesutah@gmail.com';
  await resend.emails.send({
    from: FROM,
    to,
    subject: `New Quote Request — ${lead.first_name} ${lead.last_name}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#08172e;padding:24px;border-radius:8px 8px 0 0;">
          <h2 style="color:#C9A84C;margin:0;">New Quote Request</h2>
          <p style="color:#aaa;margin:4px 0 0;">BlueScapes Website</p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#6b7280;width:140px;">Name</td><td style="padding:8px 0;font-weight:600;">${lead.first_name} ${lead.last_name}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Email</td><td style="padding:8px 0;"><a href="mailto:${lead.email}">${lead.email}</a></td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Phone</td><td style="padding:8px 0;"><a href="tel:${lead.phone}">${lead.phone}</a></td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;vertical-align:top;">Details</td><td style="padding:8px 0;white-space:pre-wrap;">${(lead.message || '').replace(/</g, '&lt;')}</td></tr>
          </table>
          <div style="margin-top:24px;">
            <a href="https://bluescapesutah.com/admin" style="background:#C9A84C;color:#08172e;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;">View in Admin Dashboard</a>
          </div>
        </div>
      </div>
    `,
  });
}

const app  = express();
const PORT = process.env.PORT || 3000;

const ADMIN_USER   = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS   = process.env.ADMIN_PASSWORD || 'bluescapes2025';
const TOKEN_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

// ── Token helpers ─────────────────────────────────────────
// Token is valid for 8-hour windows — no storage needed
function makeToken() {
  const window = Math.floor(Date.now() / (8 * 60 * 60 * 1000));
  return crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(`${ADMIN_USER}:${ADMIN_PASS}:${window}`)
    .digest('hex');
}

function validToken(token) {
  if (!token) return false;
  const now  = Math.floor(Date.now() / (8 * 60 * 60 * 1000));
  // Accept current window and the previous one (graceful expiry)
  return [now, now - 1].some(w => {
    const expected = crypto
      .createHmac('sha256', TOKEN_SECRET)
      .update(`${ADMIN_USER}:${ADMIN_PASS}:${w}`)
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  });
}

// ── Middleware ────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname), { index: false, dotfiles: 'deny' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const requireAuth = (req, res, next) => {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (validToken(token)) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

// ── Landing Page ──────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'privacy.html')));
app.get('/terms',   (req, res) => res.sendFile(path.join(__dirname, 'terms.html')));

// ── Public: Site Settings ─────────────────────────────────
app.get('/api/settings', async (req, res) => {
  try {
    const val = await db.getSetting('under_construction');
    res.json({ under_construction: val === 'true' });
  } catch {
    res.json({ under_construction: false });
  }
});

// ── Public: Approved Testimonials ────────────────────────
app.get('/api/testimonials', async (req, res) => {
  try {
    const rows = await db.getApprovedTestimonials();
    res.json(rows);
  } catch { res.json([]); }
});

// ── Public: Submit Testimonial ────────────────────────────
app.post('/api/testimonial', async (req, res) => {
  const { name, role, rating, message } = req.body;
  if (!name || !message) return res.status(400).json({ error: 'Name and message required' });
  try {
    const t = await db.insertTestimonial({ name, role, rating, message });
    res.json({ success: true, id: t.id });
  } catch (err) {
    console.error('insertTestimonial error:', err.message);
    res.status(500).json({ error: 'Could not save testimonial' });
  }
});

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
    sendLeadEmail(lead).catch(err => console.error('Email error:', err.message));
    sendConfirmationEmail(lead).catch(err => console.error('Confirmation email error:', err.message));
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
    await db.insertEvent({
      event, page: page || '', data: data || {}, ip: req.ip || '',
      user_agent: req.headers['user-agent'] || '',
    });
  } catch { /* never block the page for analytics */ }
  res.json({ ok: true });
});

// ── Admin: Login page (public) ────────────────────────────
app.get('/admin/login', (req, res) =>
  res.sendFile(path.join(__dirname, 'admin', 'login.html'))
);

// ── Admin: Login API ──────────────────────────────────────
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ token: makeToken() });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

// ── Admin: Dashboard (public shell, JS checks token) ──────
app.get('/admin', (req, res) =>
  res.sendFile(path.join(__dirname, 'admin', 'dashboard.html'))
);

// ── Admin: Protected API ──────────────────────────────────
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

app.get('/admin/api/testimonials', requireAuth, async (req, res) => {
  const rows = await db.getAllTestimonials();
  res.json(rows);
});

app.patch('/admin/api/testimonials/:id', requireAuth, async (req, res) => {
  await db.updateTestimonialStatus(req.params.id, req.body.status);
  res.json({ success: true });
});

app.delete('/admin/api/testimonials/:id', requireAuth, async (req, res) => {
  await db.deleteTestimonial(req.params.id);
  res.json({ success: true });
});

app.patch('/admin/api/settings', requireAuth, async (req, res) => {
  const { under_construction } = req.body;
  await db.setSetting('under_construction', under_construction ? 'true' : 'false');
  res.json({ success: true });
});

// ── Public: Banner ────────────────────────────────────────
app.get('/api/banner', async (req, res) => {
  try {
    const [enabled, title, offer] = await Promise.all([
      db.getSetting('banner_enabled'),
      db.getSetting('banner_title'),
      db.getSetting('banner_offer'),
    ]);
    res.json({
      enabled: enabled === 'true',
      title:   title  || 'Limited Time Offer',
      offer:   offer  || '10% Off — Book Your Free Consultation Today',
    });
  } catch { res.json({ enabled: false, title: '', offer: '' }); }
});

// ── Admin: Banner ─────────────────────────────────────────
app.patch('/admin/api/banner', requireAuth, async (req, res) => {
  const { enabled, title, offer } = req.body;
  await Promise.all([
    db.setSetting('banner_enabled', enabled ? 'true' : 'false'),
    db.setSetting('banner_title',   title  || ''),
    db.setSetting('banner_offer',   offer  || ''),
  ]);
  res.json({ success: true });
});

function detectDevice(ua = '') {
  if (!ua) return 'Unknown';
  if (/tablet|ipad/i.test(ua)) return 'Tablet';
  if (/mobile|android|iphone|ipod|blackberry|windows phone/i.test(ua)) return 'Mobile';
  return 'Desktop';
}

function shortReferrer(ref) {
  if (!ref || ref === 'Direct') return 'Direct';
  try { return new URL(ref).hostname.replace(/^www\./, ''); }
  catch { return ref.length > 40 ? ref.slice(0, 40) + '…' : ref; }
}

app.get('/admin/api/analytics', requireAuth, async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const [analytics, ipRows] = await Promise.all([
    db.getAnalytics(days),
    db.getTopIPs(days),
  ]);

  // Top locations (aggregated)
  const locationMap = {};
  for (const { ip, n } of ipRows) {
    const geo = geoip.lookup(ip);
    if (!geo?.country) continue;
    const label = [geo.city, geo.region, geo.country].filter(Boolean).join(', ');
    if (!locationMap[label]) locationMap[label] = { n: 0, country: geo.country };
    locationMap[label].n += n;
  }
  const topLocations = Object.entries(locationMap)
    .sort(([, a], [, b]) => b.n - a.n)
    .slice(0, 10)
    .map(([location, { n, country }]) => ({ location, n, country }));

  // Recent visitors with geo + device
  const recentVisitors = (analytics.recentVisitors || []).map(r => {
    const geo = geoip.lookup(r.ip);
    let data = {};
    try { data = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {}); } catch {}
    return {
      time:     r.created_at,
      page:     r.page || '/',
      location: geo ? [geo.city, geo.region, geo.country].filter(Boolean).join(', ') : 'Unknown',
      referrer: shortReferrer(data.referrer || 'Direct'),
      device:   detectDevice(r.user_agent),
    };
  });

  res.json({ ...analytics, topLocations, recentVisitors });
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
