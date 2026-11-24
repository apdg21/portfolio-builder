// ===== Globals =====
let currentPage = 1;
let samplesPerPage = window.innerWidth <= 768 ? 4 : 8;
let data = {};

// ===== Path helpers =====
// Uploaded images arrive as data URIs and project links as full URLs; only
// bare filenames belong inside the template's own folders.
function rpAssetUrl(value, fallback) {
  if (!value) return fallback || '';
  if (/^(data:|https?:|blob:|\/\/|\/|\.\.?\/)/i.test(value)) return value;
  return 'assets/' + value;
}

// ===== Load JSON Content =====
async function loadContent() {
  try {
    const response = await fetch('data.json');
    data = await response.json();
    renderPortfolio();
  } catch (err) {
    console.error('Failed to load JSON', err);
  }
}

// ===== Render Portfolio Sections =====
function renderPortfolio() {
  document.getElementById('logo').textContent = data.logo;
  document.getElementById('hero').innerHTML = `<p>${data.hero}</p>`;
  document.getElementById('about').innerHTML = `
    <img src="${rpAssetUrl(data.ui && data.ui.profileImage, 'profile.jpg')}" alt="Profile Image" class="profile-img">
    <p>${data.about}</p>
  `;
  document.getElementById('footer-text').textContent = data.footer;
  
  renderSamples();
  renderTestimonials();
  renderSocialLinks();

  const contactForm = document.getElementById('contact-form');
  if (contactForm) contactForm.dataset.recipient = (data.contactEmail || '').trim();
}

// ===== Render Samples with Pagination =====
function renderSamples() {
  const grid = document.getElementById('samples-grid');
  grid.innerHTML = '';
  samplesPerPage = window.innerWidth <= 768 ? 4 : 9;
  const start = (currentPage - 1) * samplesPerPage;
  const samples = Array.isArray(data.samples) ? data.samples : [];
  const paginated = samples.slice(start, start + samplesPerPage);

  paginated.forEach(sample => {
    const card = document.createElement('div');
    card.className = 'sample-card';
    card.innerHTML = `
      <img src="${rpAssetUrl(sample.image, '1.jpg')}" alt="${sample.title}" loading="lazy" />
      <h3>${sample.title}</h3>
      <p>${sample.description}</p>
    `;
    RPProjectCard.wire(card, { link: sample.link, title: sample.title });
    grid.appendChild(card);
  });

  const totalPages = Math.ceil(samples.length / samplesPerPage) || 1;
  document.getElementById('page-info').textContent = `Page ${currentPage} of ${totalPages}`;
  document.getElementById('prev').disabled = currentPage === 1;
  document.getElementById('next').disabled = currentPage === totalPages;
  document.querySelector('.pagination').style.display = totalPages <= 1 ? 'none' : 'flex';
}

// ===== Testimonials =====
function renderTestimonials() {
  const container = document.getElementById('testimonial-list');
  container.innerHTML = '';
  (Array.isArray(data.testimonials) ? data.testimonials : []).forEach(t => {
    const div = document.createElement('div');
    div.className = 'testimonial';
    div.innerHTML = `<blockquote>${t.quote}</blockquote><p>- ${t.author}</p>`;
    container.appendChild(div);
  });
}

// ===== Social Links =====
function renderSocialLinks() {
  const container = document.getElementById('social-links');
  container.innerHTML = '';
  const platforms = ['linkedin', 'twitter', 'github'];
  platforms.forEach(p => {
    if (data.social[p]) {
      const a = document.createElement('a');
      a.href = data.social[p];
      a.setAttribute('aria-label', `${p} profile`);
      a.target = '_blank';
      a.innerHTML = `<i class="fab fa-${p}"></i>`;
      container.appendChild(a);
    }
  });
}

// ===== Pagination Events =====
document.getElementById('prev').addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage--;
    renderSamples();
  }
});

document.getElementById('next').addEventListener('click', () => {
  const totalPages = Math.ceil((data.samples || []).length / samplesPerPage) || 1;
  if (currentPage < totalPages) {
    currentPage++;
    renderSamples();
  }
});

// ===== Hamburger Menu Toggle =====
document.querySelector('.hamburger').addEventListener('click', () => {
  document.querySelector('nav').classList.toggle('active');
});

// ===== Smooth Scroll for Navigation =====
document.querySelectorAll('nav a').forEach(anchor => {
  anchor.addEventListener('click', e => {
    e.preventDefault();
    const targetId = anchor.getAttribute('href').substring(1);
    document.getElementById(targetId).scrollIntoView({ behavior: 'smooth' });
    document.querySelector('nav').classList.remove('active'); // Close menu on click
  });
});

// ===== Resize Listener =====
window.addEventListener('resize', () => {
  const newPerPage = window.innerWidth <= 768 ? 4 : 8;
  if (newPerPage !== samplesPerPage) {
    samplesPerPage = newPerPage;
    currentPage = 1;
    renderSamples();
  }
});

// ===== Contact Form Delivery =====
const contactForm = document.getElementById('contact-form');
const contactStatus = document.getElementById('success-msg');

function showContactStatus(text, ok) {
  if (!contactStatus) return;
  contactStatus.textContent = text;
  contactStatus.style.color = ok ? '' : '#b91c1c';
  contactStatus.hidden = false;
  contactStatus.style.opacity = '1';
  if (ok) {
    setTimeout(() => {
      contactStatus.style.transition = 'opacity 0.5s ease';
      contactStatus.style.opacity = '0';
      setTimeout(() => { contactStatus.hidden = true; contactStatus.style.transition = ''; }, 500);
    }, 4000);
  }
}

contactForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const recipient = contactForm.dataset.recipient;
  if (!recipient) {
    showContactStatus('This contact form is not set up yet.', false);
    return;
  }
  const button = contactForm.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    const response = await fetch(`https://formsubmit.co/ajax/${recipient}`, {
      method: 'POST',
      body: new FormData(contactForm),
      headers: { 'Accept': 'application/json' }
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.success) {
      contactForm.reset();
      showContactStatus('Message sent successfully!', true);
    } else {
      showContactStatus(result.message || 'Could not send your message. Please try again.', false);
    }
  } catch (err) {
    console.error('Form submission error:', err);
    showContactStatus('Could not send your message. Please check your connection.', false);
  } finally {
    if (button) button.disabled = false;
  }
});

// ===== Load JSON File (Offline Only) =====
document.getElementById('load-json')?.addEventListener('click', () => {
  document.getElementById('json-file').click();
});

document.getElementById('json-file')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      data = JSON.parse(e.target.result);
      currentPage = 1;
      renderPortfolio();
    } catch (err) {
      alert('Invalid JSON file.');
    }
  };
  reader.readAsText(file);
});

// ===== Hide Admin Buttons Online =====
function hideAdminOnline() {
  const admin = document.querySelector('.admin');
  if (!admin) {
    console.error('Admin element not found');
    return;
  }
  // Simple fetch to test online status
  fetch('data.json', { method: 'HEAD' })
    .then(() => {
      console.log('Online: Hiding admin buttons');
      admin.classList.remove('offline');
    })
    .catch(() => {
      console.log('Offline: Showing admin buttons');
      admin.classList.add('offline');
    });
}

// Live preview (builder editor): new data arrives without a reload.
window.__rpRender = function (next) {
  if (!next) return;
  data = next;
  currentPage = 1;
  renderPortfolio();
};

// Initialize
hideAdminOnline();
loadContent();
