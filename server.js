const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

app.use(express.json());
app.use(express.static(path.join(__dirname)));

/* ---- DB init ---- */
pool.query(`
  CREATE TABLE IF NOT EXISTS estimate_requests (
    id            SERIAL PRIMARY KEY,
    source        VARCHAR(20)  DEFAULT 'form',
    name          VARCHAR(255),
    phone         VARCHAR(50),
    email         VARCHAR(255),
    address       TEXT,
    project_type  VARCHAR(100),
    home_size     VARCHAR(50),
    timeline      VARCHAR(100),
    notes         TEXT,
    created_at    TIMESTAMPTZ  DEFAULT NOW()
  )
`).catch(err => console.error('DB init:', err.message));

/* ---- HubSpot contact push ---- */
async function pushToHubSpot({ name, phone, email, address, project_type, home_size, timeline, notes }) {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) return;

  const nameParts  = (name || '').trim().split(/\s+/);
  const firstname  = nameParts[0] || '';
  const lastname   = nameParts.slice(1).join(' ') || '';

  const noteLines = [
    project_type && `Project: ${project_type}`,
    home_size    && `Home size: ${home_size}`,
    timeline     && `Timeline: ${timeline}`,
    notes        && `Notes: ${notes}`,
    address      && `Address: ${address}`,
  ].filter(Boolean).join('\n');

  const body = JSON.stringify({
    properties: {
      firstname,
      lastname,
      phone:   phone   || '',
      email:   email   || '',
      address: address || '',
      message: noteLines,
    },
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.hubapi.com',
      path: '/crm/v3/objects/contacts',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', (err) => {
      console.error('HubSpot push error:', err.message);
      resolve();
    });
    req.write(body);
    req.end();
  });
}

/* ---- POST /api/submit ---- */
app.post('/api/submit', async (req, res) => {
  const { source, name, phone, email, address, project_type, home_size, timeline, notes } = req.body;
  try {
    await pool.query(
      `INSERT INTO estimate_requests
         (source, name, phone, email, address, project_type, home_size, timeline, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        source       || 'form',
        name         || '',
        phone        || '',
        email        || '',
        address      || '',
        project_type || '',
        home_size    || '',
        timeline     || '',
        notes        || '',
      ]
    );
    // Fire-and-forget to HubSpot — don't block the response
    pushToHubSpot({ name, phone, email, address, project_type, home_size, timeline, notes });
    res.json({ ok: true });
  } catch (err) {
    console.error('Submit error:', err.message);
    res.status(500).json({ ok: false });
  }
});

/* ---- GET /admin (Basic Auth) ---- */
app.get('/admin', async (req, res) => {
  const pass    = process.env.ADMIN_PASSWORD || 'vivid2025';
  const expected = 'Basic ' + Buffer.from(`admin:${pass}`).toString('base64');
  if (req.headers.authorization !== expected) {
    res.set('WWW-Authenticate', 'Basic realm="Vivid DFW Admin"');
    return res.status(401).send('Unauthorized');
  }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM estimate_requests ORDER BY created_at DESC'
    );
    res.send(adminPage(rows));
  } catch (err) {
    res.status(500).send('Database error: ' + err.message);
  }
});

/* ---- HTML admin page ---- */
function esc(v) {
  if (!v) return '<span class="empty">—</span>';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function adminPage(rows) {
  const formatDate = iso => {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  };

  const rowsHtml = rows.length === 0
    ? `<tr><td colspan="10" class="empty-state">No submissions yet.</td></tr>`
    : rows.map(r => `
      <tr>
        <td class="td-date">${formatDate(r.created_at)}</td>
        <td><span class="badge badge-${r.source}">${r.source}</span></td>
        <td class="td-name"><strong>${esc(r.name)}</strong></td>
        <td><a href="tel:${esc(r.phone)}">${esc(r.phone)}</a></td>
        <td><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></td>
        <td>${esc(r.address)}</td>
        <td>${esc(r.project_type)}</td>
        <td>${esc(r.home_size)}</td>
        <td>${esc(r.timeline)}</td>
        <td class="td-notes">${esc(r.notes)}</td>
      </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Estimate Requests — Vivid DFW</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --navy: #1B2B4B; --navy-dark: #0F1E36;
      --gold: #C49A3A; --gold-pale: #F5EDD6;
      --white: #fff; --cream: #FAF9F6; --border: #E2E8F0;
      --text: #1A202C; --muted: #718096;
      --font: 'Inter', -apple-system, sans-serif;
    }
    body { font-family: var(--font); background: var(--cream); color: var(--text); font-size: 14px; }

    header {
      background: var(--navy-dark);
      padding: 18px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky; top: 0; z-index: 10;
      box-shadow: 0 2px 8px rgba(0,0,0,.25);
    }
    .header-logo { font-size: 1rem; font-weight: 700; color: #fff; letter-spacing: -.01em; }
    .header-logo span { color: var(--gold); }
    .header-meta { font-size: 0.78rem; color: rgba(255,255,255,.45); }
    .header-count {
      background: var(--gold); color: #fff;
      padding: 4px 12px; border-radius: 20px;
      font-size: 0.78rem; font-weight: 600;
    }

    .toolbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 32px; background: #fff;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap; gap: 12px;
    }
    .toolbar h1 { font-size: 1rem; font-weight: 600; }
    .export-btn {
      padding: 8px 18px; background: var(--navy); color: #fff;
      border: none; border-radius: 6px; font-size: 0.8rem; font-weight: 600;
      cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;
    }
    .export-btn:hover { background: var(--navy-dark); }

    .table-wrap { overflow-x: auto; padding: 24px 32px; }

    table { width: 100%; border-collapse: collapse; background: #fff;
            border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
    thead { background: var(--navy); }
    thead th {
      padding: 14px 14px; text-align: left;
      font-size: 0.7rem; font-weight: 600; letter-spacing: .08em;
      text-transform: uppercase; color: rgba(255,255,255,.6);
      white-space: nowrap;
    }
    thead th:first-child { border-radius: 0; }

    tbody tr { border-bottom: 1px solid var(--border); transition: background 120ms; }
    tbody tr:last-child { border-bottom: none; }
    tbody tr:hover { background: #f7f9fc; }

    td { padding: 13px 14px; vertical-align: top; }
    td a { color: var(--navy); text-decoration: none; font-weight: 500; }
    td a:hover { text-decoration: underline; }

    .td-date  { white-space: nowrap; font-size: 0.78rem; color: var(--muted); }
    .td-name  { white-space: nowrap; }
    .td-notes { max-width: 220px; font-size: 0.82rem; color: var(--muted); line-height: 1.5; }

    .empty { color: #CBD5E0; font-size: 0.8rem; }
    .empty-state { text-align: center; padding: 48px; color: var(--muted); font-size: 0.9rem; }

    .badge {
      display: inline-block; padding: 3px 10px; border-radius: 20px;
      font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
    }
    .badge-form { background: var(--gold-pale); color: #92700d; }
    .badge-chat { background: #ebf4ff; color: #2b6cb0; }

    @media (max-width: 768px) {
      .table-wrap { padding: 12px 16px; }
      .toolbar { padding: 12px 16px; }
      header { padding: 14px 16px; }
    }
  </style>
</head>
<body>

<header>
  <div class="header-logo">Vivid<span>DFW</span> Painting</div>
  <div style="display:flex;align-items:center;gap:16px;">
    <span class="header-meta">Estimate Requests · Central Time</span>
    <span class="header-count">${rows.length} total</span>
  </div>
</header>

<div class="toolbar">
  <h1>All Estimate Requests</h1>
  <a href="/admin/export.csv" class="export-btn">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
    Export CSV
  </a>
</div>

<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Date (CT)</th>
        <th>Source</th>
        <th>Name</th>
        <th>Phone</th>
        <th>Email</th>
        <th>Address</th>
        <th>Project</th>
        <th>Home Size</th>
        <th>Timeline</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</div>

</body>
</html>`;
}

/* ---- GET /admin/export.csv ---- */
app.get('/admin/export.csv', async (req, res) => {
  const pass     = process.env.ADMIN_PASSWORD || 'vivid2025';
  const expected = 'Basic ' + Buffer.from(`admin:${pass}`).toString('base64');
  if (req.headers.authorization !== expected) {
    res.set('WWW-Authenticate', 'Basic realm="Vivid DFW Admin"');
    return res.status(401).send('Unauthorized');
  }
  const { rows } = await pool.query(
    'SELECT * FROM estimate_requests ORDER BY created_at DESC'
  );
  const cols = ['id','source','name','phone','email','address','project_type','home_size','timeline','notes','created_at'];
  const csv  = [
    cols.join(','),
    ...rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(',')),
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="vivid-estimates.csv"');
  res.send(csv);
});

app.listen(PORT, () => console.log(`Vivid DFW server on :${PORT}`));
