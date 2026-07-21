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
const POST_IMAGES_DIR = path.join(POSTS_DIR, 'images');
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

// Post content may link out (e.g. to Facebook/Instagram); match the rest of
// the site's external-link convention: open in a new tab, guard against
// tabnabbing via rel="noopener noreferrer".
const postRenderer = new marked.Renderer();
const baseLinkRenderer = postRenderer.link.bind(postRenderer);
postRenderer.link = function (token) {
  let html = baseLinkRenderer(token);
  if (/^https?:\/\//.test(token.href)) {
    html = html.replace('<a ', '<a target="_blank" rel="noopener noreferrer" ');
  }
  return html;
};

// Resizes a post's cover image to card display dimensions and converts it to
// WebP, writing the result into public/assets/journal/ (generated, gitignored).
// Source images live in posts/images/ (committed, but outside public/ so raw
// unoptimized originals never get deployed). Images already in WebP are
// copied through as-is (assumed pre-optimized).
async function optimizeBlogImage(imageFilename) {
  const ext = path.extname(imageFilename).toLowerCase();
  const sourceAbs = path.join(POST_IMAGES_DIR, imageFilename);
  if (!fs.existsSync(sourceAbs)) {
    throw new Error(`Post image not found: posts/images/${imageFilename}`);
  }

  const outputName = `${path.basename(imageFilename, ext)}.webp`;
  const outputAbs = path.join(JOURNAL_IMAGES_DIR, outputName);

  if (!OPTIMIZABLE_EXT.has(ext)) {
    fs.copyFileSync(sourceAbs, outputAbs);
  } else {
    await sharp(sourceAbs)
      .resize(CARD_IMAGE_WIDTH, CARD_IMAGE_HEIGHT, { fit: 'cover' })
      .webp({ quality: 80 })
      .toFile(outputAbs);
  }

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
    .replace('href="#partenaires"', 'href="/#partenaires"')
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
      .journal-card-link { display: block; color: inherit; text-decoration: none; }
      .journal-card {
        position: relative;
        padding: 0;
        overflow: hidden;
        transition: box-shadow 0.3s, transform 0.3s;
      }
      .journal-card-link:hover .journal-card {
        box-shadow: var(--shadow-lg);
        transform: translateY(-2px);
      }
      .journal-card-photo { aspect-ratio: 16 / 9; overflow: hidden; }
      .journal-card-photo img { width: 100%; height: 100%; object-fit: cover; }
      .journal-card h3 { padding: 1.25rem 1.5rem 0; margin-bottom: 0; }
      .journal-card .journal-date { padding: 0 1.5rem; }
      .journal-card p:last-child { padding: 0 1.5rem 1.5rem; color: var(--text-mid); }
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

      /* === JOURNAL POST === */
      .post-back {
        display: inline-block;
        margin-bottom: 2rem;
        color: var(--green);
        text-decoration: none;
        font-size: 0.875rem;
        transition: color 0.3s;
      }
      .post-back:hover { color: var(--green-dark); }
      .post-header { margin-bottom: 2rem; }
      .post-header h1 { margin-bottom: 0.3rem; }
      .post-hero {
        max-width: 42rem;
        margin: 0 auto 2rem;
        border-radius: var(--radius);
        overflow: hidden;
        box-shadow: var(--shadow-lg);
      }
      .post-hero img { aspect-ratio: 16 / 9; object-fit: cover; }
      .post-content { max-width: 42rem; margin: 0 auto; }
      .post-content p {
        color: var(--text-mid);
        line-height: 1.7;
        margin-bottom: 1.25rem;
      }
      .post-content h2 {
        font-family: 'Lora', serif;
        font-size: 1.375rem;
        font-weight: 600;
        color: var(--brown);
        margin: 2rem 0 0.75rem;
      }
      .post-content ul {
        list-style: disc;
        padding-left: 1.25rem;
        margin-bottom: 1.25rem;
      }
      .post-content li { color: var(--text-mid); margin-bottom: 0.4rem; }
      .post-content blockquote {
        border-left: 3px solid var(--green);
        padding-left: 1rem;
        margin: 1.5rem 0;
        font-style: italic;
        color: var(--text-mid);
      }
      .post-content a {
        color: var(--green);
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .post-content a:hover { color: var(--green-dark); }
      .post-content strong { color: var(--text); }
      .post-newsletter-cta {
        max-width: 42rem;
        margin: 3rem auto 0;
        padding-top: 2rem;
        border-top: 1px solid rgb(208,201,184);
        text-align: center;
      }
      .post-newsletter-cta p {
        color: var(--text-mid);
        margin-bottom: 1rem;
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
    ? posts.map(post => `        <a class="journal-card-link" href="/journal/${post.slug}/">
          <article class="card journal-card">
${post.image ? `            <div class="journal-card-photo">
              <img src="${post.image}" alt="${escapeHtml(post.imageAlt)}" loading="lazy" decoding="async" width="600" height="338" />
            </div>\n` : ''}            <h3>${escapeHtml(post.title)}</h3>
            <p class="journal-date">${post.dateDisplay}</p>
            <p>${escapeHtml(post.excerpt)}</p>
          </article>
        </a>`).join('\n')
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

function renderPostPage(post, { headerRaw, footer }) {
  const canonical = `${SITE_URL}/journal/${post.slug}/`;
  const ogImage = post.image ? `${SITE_URL}${post.image}` : `${SITE_URL}/assets/hero.webp`;
  const head = renderHead({
    title: `${post.title} | Ferme Oréflore`,
    description: post.excerpt,
    canonical,
    ogImage,
    ogType: 'article',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      datePublished: post.dateISO,
      image: ogImage,
      description: post.excerpt,
      author: { '@type': 'Organization', name: 'Ferme Oréflore' },
      publisher: { '@type': 'Organization', name: 'Ferme Oréflore' },
      mainEntityOfPage: canonical,
    },
  });

  const main = `      <section class="section section-cream">
        <div class="container">
          <a class="post-back" href="/journal/">← Retour au journal</a>
          <div class="section-heading post-header">
            <h1>${escapeHtml(post.title)}</h1>
            <p class="journal-date">${post.dateDisplay}</p>
          </div>
${post.image ? `          <div class="post-hero">
            <img src="${post.image}" alt="${escapeHtml(post.imageAlt)}" loading="lazy" decoding="async" width="1200" height="675" />
          </div>\n` : ''}          <div class="post-content">
${post.html}
          </div>
          <div class="post-newsletter-cta">
            <p>Inscrivez-vous à l'infolettre pour recevoir de nos nouvelles.</p>
            <a href="/#contact" class="btn btn-green">S'inscrire à l'infolettre</a>
          </div>
        </div>
      </section>`;

  return renderPage({ head, header: renderHeader(headerRaw, { activeJournal: true }), main, footer });
}

function updateSitemap(posts) {
  const existing = fs.readFileSync(SITEMAP_PATH, 'utf8');
  const today = toISODate(new Date());
  const journalLastmod = posts.length ? posts[0].dateISO : today;

  const postEntries = posts.map(post =>
    `  <url>\n    <loc>${SITE_URL}/journal/${post.slug}/</loc>\n    <lastmod>${post.dateISO}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`
  ).join('\n');

  const entries = `  <url>\n    <loc>${SITE_URL}/journal/</loc>\n    <lastmod>${journalLastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>${postEntries ? `\n${postEntries}` : ''}`;

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
    if (data.image && !data.alt) {
      throw new Error(`posts/${file}: "image" is set but "alt" is missing — add descriptive alt text.`);
    }

    const date = data.date instanceof Date ? data.date : new Date(data.date);
    const slug = data.slug ? slugify(data.slug) : slugify(String(data.title));

    return {
      slug,
      title: String(data.title),
      image: data.image ? await optimizeBlogImage(data.image) : null,
      imageAlt: data.image ? String(data.alt) : '',
      date,
      dateISO: toISODate(date),
      dateDisplay: formatDate(date),
      excerpt: data.excerpt || data.description || toExcerpt(content),
      html: marked.parse(content, { renderer: postRenderer }),
    };
  }));
  posts.sort((a, b) => b.date - a.date);

  cleanStaleJournalDirs(new Set(posts.map(post => post.slug)));

  fs.writeFileSync(path.join(JOURNAL_DIR, 'index.html'), renderIndexPage(posts, { headerRaw, footer }));

  for (const post of posts) {
    const postDir = path.join(JOURNAL_DIR, post.slug);
    fs.mkdirSync(postDir, { recursive: true });
    fs.writeFileSync(path.join(postDir, 'index.html'), renderPostPage(post, { headerRaw, footer }));
  }

  updateSitemap(posts);

  console.log(`Built ${posts.length} journal post(s):`);
  for (const post of posts) console.log(`  - ${post.title}  (${post.dateISO})`);
}

await build();
