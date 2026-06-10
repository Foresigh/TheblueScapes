const express    = require('express');
const crypto     = require('crypto');
const path       = require('path');
const geoip      = require('geoip-lite');
const { Resend } = require('resend');
const db         = require('./db/setup');

// ── Email setup ───────────────────────────────────────────
const resend   = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM     = process.env.FROM_EMAIL || 'BlueScapes <onboarding@resend.dev>';
const SITE_URL = process.env.SITE_URL   || 'https://bluescapesutah.com';

const EMAIL_HEADER = `
  <div style="background:#08172e;padding:40px 24px 32px;text-align:center;border-radius:8px 8px 0 0;">
    <img src="${SITE_URL}/images/logo.PNG" alt="BlueScapes" width="130" style="display:block;margin:0 auto 20px;border-radius:50%;" />
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
      <tr>
        <td style="vertical-align:middle;padding-right:14px;">
          <div style="height:1px;width:50px;background:linear-gradient(to right,transparent,#C9A84C);"></div>
        </td>
        <td style="vertical-align:middle;">
          <span style="font-family:Georgia,serif;font-size:30px;font-weight:700;letter-spacing:2px;color:#00AEEF;">BLUE</span><span style="font-family:Georgia,serif;font-size:30px;font-weight:700;letter-spacing:2px;color:#ffffff;">SCAPES</span>
        </td>
        <td style="vertical-align:middle;padding-left:14px;">
          <div style="height:1px;width:50px;background:linear-gradient(to left,transparent,#C9A84C);"></div>
        </td>
      </tr>
    </table>
    <p style="color:#C9A84C;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin:12px 0 0;">Utah's Premier Custom Pool Builders</p>
  </div>`;

const EMAIL_FOOTER = `
  <div style="background:#06111f;padding:32px 28px 20px;border-radius:0 0 8px 8px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="vertical-align:top;width:50%;padding-right:20px;">
          <p style="color:#6b8ba4;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 12px;">Services</p>
          <p style="margin:0 0 8px;"><a href="${SITE_URL}/#services" style="color:#94a3b8;text-decoration:none;font-size:13px;">Custom Pools</a></p>
          <p style="margin:0 0 8px;"><a href="${SITE_URL}/#services" style="color:#94a3b8;text-decoration:none;font-size:13px;">Luxury Spas</a></p>
          <p style="margin:0 0 8px;"><a href="${SITE_URL}/#services" style="color:#94a3b8;text-decoration:none;font-size:13px;">Swim Spas</a></p>
          <p style="margin:0;"><a href="${SITE_URL}/#services" style="color:#94a3b8;text-decoration:none;font-size:13px;">Cold Plunge Systems</a></p>
        </td>
        <td style="vertical-align:top;width:50%;padding-left:20px;">
          <p style="color:#6b8ba4;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 12px;">Contact</p>
          <p style="margin:0 0 8px;"><a href="tel:8013605577" style="color:#94a3b8;text-decoration:none;font-size:13px;">801.360.5577</a></p>
          <p style="margin:0 0 8px;"><a href="mailto:dcooper@bluescapes.co" style="color:#94a3b8;text-decoration:none;font-size:13px;">dcooper@bluescapes.co</a></p>
          <p style="margin:0 0 8px;"><a href="${SITE_URL}/#process" style="color:#94a3b8;text-decoration:none;font-size:13px;">How It Works</a></p>
          <p style="margin:0;"><a href="${SITE_URL}/#portfolio" style="color:#94a3b8;text-decoration:none;font-size:13px;">Our Work</a></p>
        </td>
      </tr>
    </table>
    <div style="border-top:1px solid rgba(255,255,255,0.07);margin:24px 0 16px;"></div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="text-align:center;padding-bottom:12px;">
          <a href="${SITE_URL}/#contact" style="background:#00AEEF;color:#fff;padding:10px 28px;border-radius:50px;text-decoration:none;font-weight:700;font-size:13px;display:inline-block;">Get a Free Quote</a>
        </td>
      </tr>
      <tr>
        <td style="text-align:center;">
          <span style="color:#4a6080;font-size:12px;">
            <a href="${SITE_URL}/privacy" style="color:#4a6080;text-decoration:none;">Privacy Policy</a>
            &nbsp;·&nbsp;
            <a href="${SITE_URL}/terms" style="color:#4a6080;text-decoration:none;">Terms of Service</a>
          </span>
        </td>
      </tr>
      <tr>
        <td style="text-align:center;padding-top:10px;">
          <span style="color:#2d4a66;font-size:11px;">Built by <a href="https://revampdigitalllc.com" style="color:#00AEEF;text-decoration:none;font-weight:600;">Revamp Digital LLC</a></span>
        </td>
      </tr>
    </table>
  </div>`;

async function sendConfirmationEmail(lead) {
  if (!resend) { console.log('[email] RESEND_API_KEY not set — skipping confirmation'); return; }
  if (!lead.email) return;
  console.log(`[email] Sending confirmation to ${lead.email}`);
  const result = await resend.emails.send({
    from: FROM,
    to: lead.email,
    subject: `We received your request, ${lead.first_name}!`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;border-radius:8px;overflow:hidden;">
        ${EMAIL_HEADER}
        <div style="background:#fff;padding:32px 28px;">
          <h2 style="color:#08172e;margin:0 0 16px;font-size:20px;">Thanks, ${lead.first_name}! We received your request.</h2>
          <p style="color:#4b5563;line-height:1.7;margin:0 0 14px;">Your quote request has been received and a member of our team will be in touch within <strong>1–2 business days</strong> to schedule your free consultation.</p>
          <p style="color:#4b5563;line-height:1.7;margin:0 0 20px;">For urgent questions, reach us directly:</p>
          <div style="background:#f9fafb;border-radius:8px;padding:16px 20px;margin:0 0 24px;">
            <p style="margin:0 0 8px;color:#08172e;font-size:15px;"><strong>📞</strong> &nbsp;<a href="tel:8013605577" style="color:#0078B8;text-decoration:none;">801.360.5577</a></p>
            <p style="margin:0;color:#08172e;font-size:15px;"><strong>✉️</strong> &nbsp;<a href="mailto:dcooper@bluescapes.co" style="color:#0078B8;text-decoration:none;">dcooper@bluescapes.co</a></p>
          </div>
          <p style="color:#4b5563;line-height:1.7;margin:0 0 6px;">We look forward to building something extraordinary for your family.</p>
          <p style="color:#4b5563;margin:0;font-weight:600;">— The BlueScapes Team</p>
        </div>
        ${EMAIL_FOOTER}
      </div>
    `,
  });
  console.log(`[email] Confirmation sent — id: ${result?.data?.id || 'unknown'}`);
}

function parseMessageFields(message) {
  const lines = (message || '').split('\n');
  const fields = [];
  let details = '';
  for (const line of lines) {
    const sep = line.indexOf(': ');
    if (sep > 0 && !line.startsWith('Project Details')) {
      fields.push({ label: line.slice(0, sep), value: line.slice(sep + 2) });
    } else if (line.startsWith('Project Details: ')) {
      details = line.slice('Project Details: '.length);
    }
  }
  return { fields, details };
}

async function sendLeadEmail(lead) {
  if (!resend) { console.log('[email] RESEND_API_KEY not set — skipping lead notification'); return; }
  const to = (process.env.NOTIFY_EMAIL || 'dcooper@bluescapes.co')
    .split(',').map(e => e.trim()).filter(Boolean);
  console.log(`[email] Sending lead notification to ${to.join(', ')}`);
  const { fields, details } = parseMessageFields(lead.message);
  const extraRows = fields.map(f =>
    `<tr><td style="padding:10px 0;color:#6b7280;width:160px;vertical-align:top;border-bottom:1px solid #f3f4f6;">${f.label}</td>` +
    `<td style="padding:10px 0;font-weight:500;border-bottom:1px solid #f3f4f6;">${f.value}</td></tr>`
  ).join('');
  const detailsRow = details ? `
    <tr>
      <td colspan="2" style="padding:16px 0 0;">
        <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#9ca3af;margin-bottom:8px;">Project Details</div>
        <div style="background:#f9fafb;border-radius:6px;padding:14px 16px;color:#374151;line-height:1.7;font-size:14px;">${details.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>
      </td>
    </tr>` : '';

  await resend.emails.send({
    from: FROM,
    to,
    subject: `New Quote Request — ${lead.first_name} ${lead.last_name}`,
    html: `
      <div style="font-family:sans-serif;max-width:620px;margin:0 auto;border-radius:8px;overflow:hidden;">
        ${EMAIL_HEADER}
        <div style="background:#fff;padding:24px 28px;">
          <p style="color:#6b7280;font-size:12px;margin:0 0 20px;">Submitted ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr>
              <td style="padding:10px 0;color:#6b7280;width:160px;border-bottom:1px solid #f3f4f6;">Name</td>
              <td style="padding:10px 0;font-weight:700;font-size:16px;color:#08172e;border-bottom:1px solid #f3f4f6;">${lead.first_name} ${lead.last_name}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;color:#6b7280;border-bottom:1px solid #f3f4f6;">Email</td>
              <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;"><a href="mailto:${lead.email}" style="color:#0078B8;text-decoration:none;font-weight:500;">${lead.email}</a></td>
            </tr>
            <tr>
              <td style="padding:10px 0;color:#6b7280;border-bottom:1px solid #f3f4f6;">Phone</td>
              <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;"><a href="tel:${lead.phone}" style="color:#0078B8;text-decoration:none;font-weight:500;">${lead.phone}</a></td>
            </tr>
            ${extraRows}
            ${detailsRow}
          </table>
          <div style="margin-top:24px;padding-top:20px;border-top:1px solid #f3f4f6;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding-right:10px;">
                  <a href="mailto:${lead.email}" style="background:#08172e;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;display:inline-block;">Reply to ${lead.first_name}</a>
                </td>
                <td>
                  <a href="${SITE_URL}/admin" style="background:#C9A84C;color:#08172e;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;display:inline-block;">View in Dashboard</a>
                </td>
              </tr>
            </table>
          </div>
        </div>
        ${EMAIL_FOOTER}
      </div>
    `,
  });
  console.log(`[email] Lead notification sent to ${to.join(', ')}`);
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
    sendLeadEmail(lead).catch(err => console.error('Email error:', err.message || err));
    sendConfirmationEmail(lead).catch(err => console.error('Confirmation email error:', err.message || err));
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
