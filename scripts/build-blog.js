// Builds the /journal blog from Markdown files in posts/ into static HTML
// pages under public/journal/. Run with `npm run build:blog`.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import matter from 'gray-matter';
import { marked } from 'marked';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = path.join(ROOT, 'posts');
const PUBLIC_DIR = path.join(ROOT, 'public');
const JOURNAL_DIR = path.join(PUBLIC_DIR, 'journal');
const JOURNAL_IMAGES_DIR = path.join(PUBLIC_DIR, 'assets', 'journal');
const INDEX_HTML_PATH = path.join(PUBLIC_DIR, 'index.html');
const SITEMAP_PATH = path.join(PUBLIC_DIR, 'sitemap.xml');
const SITE_URL = 'https://oreflore.ca';

// Blog card photos are displayed at 600x338 (16:9); generate 2x for retina.
const CARD_IMAGE_WIDTH = 1200;
const CARD_IMAGE_HEIGHT = 675;
const OPTIMIZABLE_EXT = new Set(['.jpg', '.jpeg', '.png']);

// ---------- helpers ----------

const DIACRITICS_RE = new RegExp('[̀-ͯ]', 'g');

function slugify(str) {
  return str
    .toString()
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toExcerpt(markdown, len = 160) {
  const text = markdown
    .replace(/^#+\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`>#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > len ? `${text.slice(0, len).replace(/\s+\S*$/, '')}…` : text;
}

function formatDate(date) {
  return new Intl.DateTimeFormat('fr-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
}

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

// Resizes a post's cover image to card display dimensions and converts it to
// WebP, writing the result into public/assets/journal/ (generated, gitignored).
// Images already in WebP are left as-is (assumed pre-optimized).
async function optimizeBlogImage(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  if (!OPTIMIZABLE_EXT.has(ext)) return imagePath;

  const sourceAbs = path.join(PUBLIC_DIR, imagePath.replace(/^\//, ''));
  if (!fs.existsSync(sourceAbs)) {
    throw new Error(`Blog image not found: ${imagePath}`);
  }

  const outputName = `${path.basename(imagePath, ext)}.webp`;
  const outputAbs = path.join(JOURNAL_IMAGES_DIR, outputName);

  await sharp(sourceAbs)
    .resize(CARD_IMAGE_WIDTH, CARD_IMAGE_HEIGHT, { fit: 'cover' })
    .webp({ quality: 80 })
    .toFile(outputAbs);

  return `/assets/journal/${outputName}`;
}

// ---------- extract shared design from public/index.html ----------
// index.html is the source of truth for fonts/colors/header/footer; the
// blog template pulls from it at build time instead of duplicating markup.

function extractTemplateParts() {
  const source = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

  const styleMatch = source.match(/<style>([\s\S]*?)<\/style>/);
  const headerMatch = source.match(/<header>[\s\S]*?<\/header>/);
  const footerMatch = source.match(/<footer>[\s\S]*?<\/footer>/);

  if (!styleMatch || !headerMatch || !footerMatch) {
    throw new Error('Could not extract <style>, <header> or <footer> from public/index.html');
  }

  return {
    css: styleMatch[1],
    headerRaw: headerMatch[0],
    footer: footerMatch[0],
  };
}

// Rewrites the homepage header for use on a subpage: in-page anchors need
// to point back at the homepage, and the Journal link gets marked active.
function renderHeader(headerRaw, { activeJournal = false } = {}) {
  let header = headerRaw
    .replace('<a href="#" class="nav-logo"', '<a href="/" class="nav-logo"')
    .replace('href="#histoire"', 'href="/#histoire"')
    .replace('href="#activites"', 'href="/#activites"')
    .replace('href="#visitez"', 'href="/#visitez"')
    .replace('href="#contact"', 'href="/#contact"');

  if (activeJournal) {
    header = header.replace('<a href="/journal/">Journal</a>', '<a href="/journal/" class="active">Journal</a>');
  }

  return header;
}

const BLOG_CSS = `
      /* === JOURNAL (blog) === */
      .section-heading h1 { margin-bottom: 1rem; }
      .section-beige .section-heading h1,
      .section-cream .section-heading h1 { color: var(--brown); }
      .journal-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 2rem;
      }
      .journal-subtitle { font-style: italic; }
      .journal-card { position: relative; padding: 0; overflow: hidden; opacity: 0.85; cursor: default; }
      .journal-card-photo { aspect-ratio: 16 / 9; overflow: hidden; }
      .journal-card-photo img { width: 100%; height: 100%; object-fit: cover; }
      .journal-card h3 { padding: 1.25rem 1.5rem 0; margin-bottom: 0; }
      .journal-card .journal-date { padding: 0 1.5rem; }
      .journal-card p:last-child { padding: 0 1.5rem 1.5rem; color: var(--text-mid); }
      .journal-badge {
        position: absolute;
        top: 0.75rem;
        right: 0.75rem;
        z-index: 1;
        background: var(--green);
        color: #fff;
        font-size: 0.7rem;
        font-style: normal;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        padding: 0.25rem 0.65rem;
        border-radius: 999px;
      }
      .journal-empty { color: var(--text-mid); text-align: center; }
      .journal-date {
        color: var(--green);
        font-style: italic;
        font-size: 0.9rem;
        margin: 0.35rem 0 0.75rem;
      }
      @media (max-width: 767px) {
        .journal-grid { grid-template-columns: 1fr; }
      }
`;

const SHARED_SCRIPT = `
    <script>
      const toggle = document.getElementById('nav-toggle');
      const links  = document.getElementById('nav-links');
      if (toggle && links) {
        toggle.addEventListener('click', () => {
          const isOpen = links.classList.toggle('open');
          toggle.setAttribute('aria-label', isOpen ? 'Fermer le menu' : 'Ouvrir le menu');
          toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });
        links.querySelectorAll('a').forEach(a =>
          a.addEventListener('click', () => {
            links.classList.remove('open');
            toggle.setAttribute('aria-label', 'Ouvrir le menu');
            toggle.setAttribute('aria-expanded', 'false');
          })
        );
      }
      const header = document.querySelector('header');
      if (header) {
        window.addEventListener('scroll', () => {
          header.classList.toggle('scrolled', window.scrollY > 60);
        }, { passive: true });
        new ResizeObserver(() => {
          document.documentElement.style.setProperty('--header-h', header.offsetHeight + 'px');
        }).observe(header);
      }
    </script>
`;

function renderHead({ title, description, canonical, ogImage, ogType, jsonLd }) {
  return `    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png" />
    <link rel="canonical" href="${canonical}" />
    <link rel="sitemap" type="application/xml" href="/sitemap.xml" />
    <meta name="theme-color" content="#5f7a5f" />
    <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/lora-latin.woff2" crossorigin />
    <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/satisfy-latin.woff2" crossorigin />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@700&display=swap" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@700&display=swap" media="print" onload="this.media='all'" />
    <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@700&display=swap" /></noscript>
    <meta property="og:url" content="${canonical}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:type" content="${ogType}" />
    <meta property="og:site_name" content="Ferme Oréflore" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${ogImage}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${ogImage}" />
    <title>${escapeHtml(title)}</title>
    ${jsonLd ? `<script type="application/ld+json">\n      ${JSON.stringify(jsonLd, null, 2)}\n    </script>` : ''}`;
}

function renderPage({ head, header, main, footer }) {
  return `<!doctype html>
<html lang="fr-CA">
  <head>
${head}
    <style>${BASE_CSS}${BLOG_CSS}</style>
  </head>
  <body>
    <a href="#main-content" class="skip-link">Aller au contenu</a>
${header}
    <main id="main-content">
${main}
    </main>
${footer}
${SHARED_SCRIPT}
  </body>
</html>
`;
}

function renderIndexPage(posts, { headerRaw, footer }) {
  const canonical = `${SITE_URL}/journal/`;
  const head = renderHead({
    title: 'Journal | Ferme Oréflore',
    description: "Les dernières nouvelles de la ferme Oréflore : récolte, activités et vie à la ferme.",
    canonical,
    ogImage: `${SITE_URL}/assets/hero.webp`,
    ogType: 'website',
  });

  const cards = posts.length
    ? posts.map(post => `        <article class="card journal-card">
          <span class="journal-badge">À venir</span>
${post.image ? `          <div class="journal-card-photo">
            <img src="${post.image}" alt="" loading="lazy" decoding="async" width="600" height="338" />
          </div>\n` : ''}          <h3>${escapeHtml(post.title)}</h3>
          <p class="journal-date">${post.dateDisplay}</p>
          <p>Contenu en rédaction...</p>
        </article>`).join('\n')
    : '        <p class="journal-empty">Aucun article pour le moment. Revenez bientôt !</p>';

  const main = `      <section class="section section-cream">
        <div class="container">
          <div class="section-heading">
            <h1>Journal</h1>
            <p class="journal-subtitle">Les dernières nouvelles de la Ferme Oréflore.</p>
          </div>
          <div class="journal-grid">
${cards}
          </div>
        </div>
      </section>`;

  return renderPage({ head, header: renderHeader(headerRaw, { activeJournal: true }), main, footer });
}

function updateSitemap(posts) {
  const existing = fs.readFileSync(SITEMAP_PATH, 'utf8');
  const today = toISODate(new Date());
  const journalLastmod = posts.length ? posts[0].dateISO : today;

  const entries = `  <url>\n    <loc>${SITE_URL}/journal/</loc>\n    <lastmod>${journalLastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`;

  const block = `  <!-- BLOG:START (auto-generated by scripts/build-blog.js, do not edit by hand) -->\n${entries}\n  <!-- BLOG:END -->`;

  let updated;
  if (/[ \t]*<!-- BLOG:START[\s\S]*?<!-- BLOG:END -->/.test(existing)) {
    updated = existing.replace(/[ \t]*<!-- BLOG:START[\s\S]*?<!-- BLOG:END -->/, block);
  } else {
    updated = existing.replace('</urlset>', `${block}\n</urlset>`);
  }
  fs.writeFileSync(SITEMAP_PATH, updated);
}

function cleanStaleJournalDirs(currentSlugs) {
  if (!fs.existsSync(JOURNAL_DIR)) return;
  for (const entry of fs.readdirSync(JOURNAL_DIR, { withFileTypes: true })) {
    if (entry.isDirectory() && !currentSlugs.has(entry.name)) {
      fs.rmSync(path.join(JOURNAL_DIR, entry.name), { recursive: true, force: true });
    }
  }
}

// ---------- build ----------

// The homepage's own <style>/<head> is unaffected — BASE_CSS is only used
// to compose the blog pages, kept as a module-level var set below.
let BASE_CSS = '';

async function build() {
  const { css, headerRaw, footer } = extractTemplateParts();
  BASE_CSS = css;

  fs.mkdirSync(JOURNAL_DIR, { recursive: true });
  fs.mkdirSync(JOURNAL_IMAGES_DIR, { recursive: true });

  const files = fs.existsSync(POSTS_DIR)
    ? fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'))
    : [];

  const posts = await Promise.all(files.map(async file => {
    const raw = fs.readFileSync(path.join(POSTS_DIR, file), 'utf8');
    const { data, content } = matter(raw);

    if (!data.title || !data.date) {
      throw new Error(`posts/${file}: frontmatter must include "title" and "date"`);
    }

    const date = data.date instanceof Date ? data.date : new Date(data.date);
    const slug = data.slug ? slugify(data.slug) : slugify(path.basename(file, '.md'));

    return {
      slug,
      title: String(data.title),
      image: data.image ? await optimizeBlogImage(data.image) : null,
      date,
      dateISO: toISODate(date),
      dateDisplay: formatDate(date),
      excerpt: data.excerpt || data.description || toExcerpt(content),
      html: marked.parse(content),
    };
  }));
  posts.sort((a, b) => b.date - a.date);

  // Individual post pages are not generated — entries are non-clickable
  // placeholders on the journal index, so no per-post directories remain.
  cleanStaleJournalDirs(new Set());

  fs.writeFileSync(path.join(JOURNAL_DIR, 'index.html'), renderIndexPage(posts, { headerRaw, footer }));

  updateSitemap(posts);

  console.log(`Built ${posts.length} journal post(s):`);
  for (const post of posts) console.log(`  - ${post.title}  (${post.dateISO})`);
}

await build();
