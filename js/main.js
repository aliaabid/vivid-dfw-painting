/* ============================================================
   VIVID DFW PAINTING — MAIN JS
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initScrollAnimations();
  initFAQ();
  initUploadZone();
  initChatWidget();
});

/* ---- Navigation ---- */
function initNav() {
  const nav = document.querySelector('.nav');
  if (!nav) return;

  // Only drive scroll-state on the hero page; inner pages are always scrolled
  const hasHero = !!document.querySelector('.hero');
  if (hasHero) {
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  const hamburger = nav.querySelector('.nav-hamburger');
  const mobileMenu = document.querySelector('.nav-mobile');
  const closeBtn   = document.querySelector('.nav-mobile-close');

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      // Set display:flex first, then on next frame add .open so opacity transition fires
      mobileMenu.style.display = 'flex';
      requestAnimationFrame(() => mobileMenu.classList.add('open'));
      document.body.style.overflow = 'hidden';
    });
  }
  if (closeBtn && mobileMenu) {
    closeBtn.addEventListener('click', closeMobile);
    mobileMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMobile));
  }
  function closeMobile() {
    mobileMenu.classList.remove('open');
    document.body.style.overflow = '';
    // After fade-out, hide with display:none so it's fully out of the render tree
    setTimeout(() => {
      if (!mobileMenu.classList.contains('open')) mobileMenu.style.display = 'none';
    }, 260);
  }

  const heroBg = document.querySelector('.hero-bg');
  if (heroBg) {
    const img = new Image();
    img.onload = () => heroBg.classList.add('loaded');
    img.src = heroBg.style.backgroundImage.replace(/url\(["']?/, '').replace(/["']?\)/, '');
  }
}

/* ---- Scroll animations ---- */
function initScrollAnimations() {
  const els = document.querySelectorAll('.fade-up');
  if (!els.length) return;

  // threshold:0 fires the moment any pixel of the element enters the viewport —
  // much more reliable on mobile than 0.12 which can silently miss elements.
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const delay = entry.target.dataset.delay || 0;
        setTimeout(() => entry.target.classList.add('visible'), Number(delay));
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0, rootMargin: '0px 0px -40px 0px' });

  els.forEach(el => observer.observe(el));

  // Hard fallback: if IntersectionObserver silently fails (rare on some mobile
  // WebViews), reveal everything after 1.5 s so the page is never stuck blank.
  setTimeout(() => {
    document.querySelectorAll('.fade-up:not(.visible)').forEach(el => {
      el.classList.add('visible');
    });
  }, 1500);
}

/* ---- FAQ accordion ---- */
function initFAQ() {
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));
      if (!isOpen) item.classList.add('open');
    });
  });
}

/* ---- File upload zone ---- */
function initUploadZone() {
  const zone  = document.querySelector('.upload-zone');
  const input = document.getElementById('fileInput');
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = 'var(--navy)'; });
  zone.addEventListener('dragleave', () => zone.style.borderColor = '');
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.style.borderColor = '';
    handleFiles(e.dataTransfer.files);
  });
  input.addEventListener('change', () => handleFiles(input.files));

  function handleFiles(files) {
    const preview = document.querySelector('.upload-preview');
    if (!preview) return;
    Array.from(files).slice(0, 8).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = e => {
        const img = document.createElement('img');
        img.src = e.target.result;
        img.className = 'preview-thumb';
        preview.appendChild(img);
      };
      reader.readAsDataURL(file);
    });
  }
}

/* ---- Estimate form ---- */
const estimateForm = document.getElementById('estimateForm');
if (estimateForm) {
  estimateForm.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = estimateForm.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    const data = Object.fromEntries(new FormData(estimateForm));
    try {
      await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'form', ...data }),
      });
    } catch (_) { /* still show success even if network glitch */ }

    estimateForm.innerHTML = `
      <div style="text-align:center;padding:48px 24px;">
        <div style="width:72px;height:72px;background:rgba(196,154,58,.12);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 24px;color:var(--gold);font-size:2rem;">✓</div>
        <h3 style="font-family:var(--font-heading);font-size:1.6rem;margin-bottom:12px;">Request Received</h3>
        <p style="max-width:400px;margin:0 auto 8px;">Thank you! Our estimating team will review your project details and provide a detailed estimate within 24–48 hours.</p>
        <p style="font-size:0.82rem;color:var(--text-muted);margin:0;">We'll reach out via phone and email with your estimate.</p>
      </div>`;
    }, 1200);
  });
}

/* ============================================================
   VIVID ESTIMATE ASSISTANT — CHAT WIDGET
   ============================================================ */
function initChatWidget() {
  const widget = document.getElementById('chatWidget');
  if (!widget) return;

  const toggle   = widget.querySelector('.chat-toggle');
  const body     = widget.querySelector('.chat-body');

  let isOpen     = false;
  let step       = 0;
  let answers    = {};
  let inputLock  = false;

  toggle.addEventListener('click', () => {
    isOpen = !isOpen;
    widget.classList.toggle('open', isOpen);
    if (isOpen && step === 0) {
      setTimeout(() => kickOff(), 300);
    }
    if (isOpen) body.scrollTop = body.scrollHeight;
  });

  function kickOff() {
    step = 1;
    showTyping().then(() => {
      addBotMsg('Hi! I\'m the <strong>Vivid Estimate Assistant</strong>. I\'ll help you get started on your free painting estimate. 👋');
      return delay(600);
    }).then(() => showTyping()).then(() => {
      addBotMsg('What would you like painted?');
      addOptions([
        { label: 'Interior Painting', value: 'Interior' },
        { label: 'Exterior Painting', value: 'Exterior' },
        { label: 'Cabinet Painting',  value: 'Cabinets' },
        { label: 'Multiple Areas',    value: 'Multiple Areas' },
      ], handleServiceChoice);
    });
  }

  function handleServiceChoice(val) {
    answers.service = val;
    addUserMsg(val);
    step = 2;
    showTyping().then(() => {
      addBotMsg('Great choice! Approximately how large is your home?');
      addOptions([
        { label: 'Under 1,500 sq ft',   value: 'Under 1,500 sq ft' },
        { label: '1,500 – 2,500 sq ft', value: '1,500–2,500 sq ft' },
        { label: '2,500 – 4,000 sq ft', value: '2,500–4,000 sq ft' },
        { label: '4,000+ sq ft',         value: '4,000+ sq ft' },
      ], handleSizeChoice);
    });
  }

  function handleSizeChoice(val) {
    answers.size = val;
    addUserMsg(val);
    step = 3;
    showTyping().then(() => {
      addBotMsg('When are you hoping to start your project?');
      addOptions([
        { label: 'As soon as possible',  value: 'ASAP' },
        { label: 'Within 1 month',       value: 'Within 1 month' },
        { label: '1–3 months out',       value: '1–3 months' },
        { label: 'Just planning ahead',  value: 'Just exploring' },
      ], handleTimeline);
    });
  }

  function handleTimeline(val) {
    answers.timeline = val;
    addUserMsg(val);
    step = 4;
    showTyping().then(() => {
      addBotMsg('Any additional details about your project? (optional)');
      addTextInput('Describe your project…', handleDetails);
    });
  }

  function handleDetails(val) {
    answers.details = val;
    if (val) addUserMsg(val);
    step = 5;
    showTyping().then(() => {
      addBotMsg('Almost done! Please share your contact info so we can send your estimate.');
      addContactForm();
    });
  }

  function handleContactSubmit(data) {
    answers.contact = data;
    step = 6;
    fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source:       'chat',
        name:         data.name,
        phone:        data.phone,
        email:        data.email,
        address:      data.address,
        project_type: answers.service   || '',
        home_size:    answers.size      || '',
        timeline:     answers.timeline  || '',
        notes:        answers.details   || '',
      }),
    }).catch(() => {});
    showTyping(1000).then(() => {
      clearInputArea();
      addSuccess(data.name);
    });
  }

  /* ---- Rendering helpers ---- */
  function addBotMsg(html) {
    const msg = document.createElement('div');
    msg.className = 'chat-msg bot';
    msg.innerHTML = `<div class="chat-bubble">${html}</div>`;
    body.appendChild(msg);
    scrollBottom();
  }

  function addUserMsg(text) {
    const msg = document.createElement('div');
    msg.className = 'chat-msg user';
    msg.innerHTML = `<div class="chat-bubble">${text}</div>`;
    body.appendChild(msg);
    scrollBottom();
  }

  function addOptions(opts, cb) {
    const wrap = document.createElement('div');
    wrap.className = 'chat-msg bot';
    const inner = document.createElement('div');
    inner.className = 'chat-options';
    opts.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'chat-option';
      btn.textContent = opt.label;
      btn.addEventListener('click', () => {
        if (inputLock) return;
        inputLock = true;
        wrap.querySelectorAll('.chat-option').forEach(b => { b.disabled = true; b.classList.remove('selected'); });
        btn.classList.add('selected');
        setTimeout(() => {
          inputLock = false;
          cb(opt.value);
        }, 200);
      });
      inner.appendChild(btn);
    });
    wrap.appendChild(inner);
    body.appendChild(wrap);
    scrollBottom();
  }

  function addTextInput(placeholder, cb) {
    const wrap = document.createElement('div');
    wrap.className = 'chat-msg bot';
    wrap.innerHTML = `
      <div class="chat-input-row">
        <textarea class="chat-input" placeholder="${placeholder}" rows="2" style="resize:none;"></textarea>
        <button class="chat-send">Send</button>
      </div>`;
    body.appendChild(wrap);
    scrollBottom();
    const input = wrap.querySelector('.chat-input');
    const send  = wrap.querySelector('.chat-send');
    const submit = () => {
      const val = input.value.trim();
      wrap.remove();
      cb(val);
    };
    send.addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
    input.focus();
  }

  function addContactForm() {
    const wrap = document.createElement('div');
    wrap.className = 'chat-msg bot';
    wrap.innerHTML = `
      <div class="chat-form-fields">
        <input class="chat-field" type="text"  id="cf-name"    placeholder="Your name *"           />
        <input class="chat-field" type="tel"   id="cf-phone"   placeholder="Phone number *"         />
        <input class="chat-field" type="email" id="cf-email"   placeholder="Email address *"        />
        <input class="chat-field" type="text"  id="cf-address" placeholder="Property address (city)" />
        <button class="chat-submit">Submit Estimate Request →</button>
      </div>`;
    body.appendChild(wrap);
    scrollBottom();

    wrap.querySelector('.chat-submit').addEventListener('click', () => {
      const name    = wrap.querySelector('#cf-name').value.trim();
      const phone   = wrap.querySelector('#cf-phone').value.trim();
      const email   = wrap.querySelector('#cf-email').value.trim();
      const address = wrap.querySelector('#cf-address').value.trim();

      if (!name || !phone || !email) {
        wrap.querySelectorAll('.chat-field').forEach(f => {
          if (f.hasAttribute('id') && ['cf-name','cf-phone','cf-email'].includes(f.id) && !f.value.trim()) {
            f.style.borderColor = '#e53e3e';
          }
        });
        return;
      }
      wrap.remove();
      handleContactSubmit({ name, phone, email, address });
    });
  }

  function addSuccess(name) {
    const firstName = name.split(' ')[0];
    const msg = document.createElement('div');
    msg.className = 'chat-msg bot';
    msg.innerHTML = `
      <div class="chat-success">
        <div class="chat-success-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <h4>Thank you, ${firstName}!</h4>
        <p>Your estimate request has been received. Our estimating team will review your project and provide a detailed estimate within <strong>24–48 hours</strong>.</p>
      </div>`;
    body.appendChild(msg);
    scrollBottom();
  }

  function clearInputArea() {
    body.querySelectorAll('.chat-options, .chat-input-row, .chat-form-fields').forEach(el => {
      if (!el.closest('.chat-msg.user')) el.remove();
    });
  }

  /* ---- Typing indicator ---- */
  function showTyping(ms = 800) {
    return new Promise(resolve => {
      const indicator = document.createElement('div');
      indicator.className = 'chat-msg bot';
      indicator.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
      body.appendChild(indicator);
      scrollBottom();
      setTimeout(() => {
        indicator.remove();
        resolve();
      }, ms);
    });
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
  function scrollBottom() { setTimeout(() => { body.scrollTop = body.scrollHeight; }, 50); }
}
