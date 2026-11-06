# Ferme Oréflore — site web (oreflore.ca)

Site statique d'une bleuetière et crêperie de Ripon (Québec). Contenu et interface en français (`lang="fr-CA"`).

## Pile technique

- Cloudflare Workers Static Assets : `wrangler.toml` sert `public/` (`[assets] directory = "public"`), sans script Worker ni framework.
- `public/index.html` est la page d'accueil, CSS et JS en ligne. C'est la source de vérité du style, de l'en-tête et du pied de page.
- Chaque push sur `main` déclenche `.github/workflows/deploy.yml` (`npm ci`, `npm run build:blog`, `cloudflare/wrangler-action@v3`). Pousser, c'est mettre en production.
- `wranglerVersion: "4"` doit rester épinglé dans `deploy.yml`. wrangler lit `public/_redirects` et `public/_headers` au moment du déploiement. Une version trop ancienne déploie le site sans erreur, mais ignore ces deux fichiers : redirections et règles de cache disparaissent sans bruit.
- Infolettre : Google Apps Script (`apps-script/Code.gs`), qui écrit dans Google Sheets et Brevo, derrière Cloudflare Turnstile.
- Outils Cloudflare : seulement le serveur MCP public `cloudflare-docs`. Ne jamais installer les serveurs OAuth qui donnent accès au compte.

## Flux de travail

- Tout se fait sur `main`, historique linéaire. Messages de commit en anglais, à l'impératif, sans préfixe (ex. « Shorten the crêperie's Saturday hours to 8h - 12h »).
- Prévisualisation : `npx wrangler dev --port 8788`, puis http://127.0.0.1:8788. Elle applique `_headers` et `_redirects`.
- `preview/` (ignoré par git) contient les gabarits HTML de l'infolettre.

## Journal

- Articles en Markdown dans `posts/`. Frontmatter : `title` et `date` obligatoires ; `image` (fichier de `posts/images/`) exige `alt` ; `slug` et `excerpt` facultatifs. Le slug vient du titre.
- `npm run build:blog` génère `public/journal/**` et `public/assets/journal/` (ignorés par git, reconstruits en CI) et réécrit le bloc BLOG de `public/sitemap.xml`, qui lui est suivi : le commiter avec le reste.
- Le script recopie dans chaque page du journal la première feuille de style, l'en-tête et le pied de page de `index.html` au moyen d'expressions régulières naïves (`<style>`, `<header>`, `<footer>`). Elles prennent la première occurrence du fichier, **commentaires compris**, et le build ne signale rien.
  - Ne jamais écrire ces trois balises en clair dans un commentaire de `index.html` : écrire « l'en-tête », « le pied de page », « la feuille de style ».
  - Le CSS propre à l'accueil va dans un bloc `<style id="…">` distinct, hors de portée de l'expression.
  - Pour vérifier un changement de l'accueil : copier `public/journal/` avant, reconstruire après, `diff -r`. Seuls les changements voulus doivent apparaître.

## Images

- WebP dans `public/assets/`, avec `width` et `height` explicites. Sous la ligne de flottaison : `loading="lazy" decoding="async"`. Image LCP : `loading="eager" fetchpriority="high"`.
- Le hero est préchargé avec `media=` calé sur le point de rupture CSS de 900 px (`hero-mobile.webp`, `hero.webp`), pas avec `imagesrcset`.
- Les originaux des articles restent dans `posts/images/`, hors de `public/`, donc jamais déployés. Le build les recadre en WebP 1200 × 675.
- Images d'infolettre : JPG ou PNG dans `public/assets/infolettre/`, car plusieurs clients courriel lisent mal le WebP.
- `/assets/*` est en cache 7 jours sans empreinte dans le nom : une image remplacée sous le même nom reste périmée chez les visiteurs. Changer le nom.
- Pas d'image non référencée dans `public/`.
- `alt` descriptif ; `alt=""` si l'image est décorative ou si le texte voisin la nomme déjà.

## Polices

- Lora (romain et italique) auto-hébergée en WOFF2 latin dans `public/assets/fonts/`, préchargée, en cache un an `immutable` : changer le nom du fichier si la police change.
- Satisfy (logo, h1, h2) est intégrée en base64 dans la feuille de style. Après tout changement du jeu de glyphes, régénérer avec `python scripts/subset-satisfy.py` (fonttools et brotli). La police complète reste dans `fonts-src/`.
- Aucune police externe.

## Accessibilité

- Cible WCAG AA. Un score Lighthouse ou axe de 100 ne prouve rien ici : le grain des sections (pseudo-élément `::after`) fait abandonner à axe le test de contraste. Calculer les ratios à la main depuis les variables de `:root`.
- Vert en taille de texte courant : `--green-text` (6,14:1 sur `--cream`), jamais `--green` (4,19:1, échec).
- Liens externes : `target="_blank" rel="noopener noreferrer"`.
- Cibles tactiles d'au moins 44 px, titres sans saut de niveau, `prefers-reduced-motion` respecté, lien d'évitement « Aller au contenu » en premier.

## Formulaire d'infolettre

- `fetch` POST vers l'URL `/exec` d'Apps Script, corps `URLSearchParams`. Garder ce type : le form-urlencoded est sûr pour CORS, donc pas de preflight, auquel Apps Script ne sait pas répondre. Pas de `mode: 'no-cors'` : la réponse JSON doit rester lisible.
- Apps Script répond 200 même en échec : c'est le champ `success` qui tranche. Le champ `error` s'affiche tel quel au visiteur : français correct, aucun détail interne.
- `apps-script/Code.gs` est une copie de référence **sans secrets** : les vraies clés Turnstile et Brevo ne vivent que dans l'éditeur Apps Script, le dépôt garde les valeurs de remplacement. Turnstile échoue fermé si la clé manque.
- Modifier `Code.gs` ne déploie rien. Recopier dans l'éditeur Apps Script et publier une nouvelle version du déploiement existant ; un nouveau déploiement changerait l'URL `/exec` et casserait le formulaire.

## Contenu de référence

- Ferme Oréflore S.E.N.C. — https://oreflore.ca
- Crêperie : 42, Montée Meunier, Ripon (Québec) J0V 1V0 — samedis, 8h - 13h, toute l'année. C'est l'adresse du JSON-LD et du pied de page.
- Bleuetière (autocueillette et kiosque) : 51B, Montée Meunier, Ripon (Québec) J0V 1V0 — dimanches, 10h - 16h, en saison seulement (dates fixées chaque année).
- Téléphone : 819 484-0277 (`+18194840277` dans `tel:` et le JSON-LD). Courriel : info@oreflore.ca.
- Réseaux : facebook.com/ferme.oreflore, instagram.com/ferme.oreflore.

## Horaires

Tout changement d'horaire (saison, fermeture ponctuelle) touche trois endroits, plus la section ci-dessus :

1. le texte de `index.html` : étiquettes des cartes Activités et liste des heures de « Visitez nos lieux » ;
2. `openingHoursSpecification` dans le JSON-LD. Les `validFrom`/`validThrough` expirent seuls mais ne se renouvellent jamais ;
3. la fiche Google, à mettre à jour à la main hors du dépôt : le rappeler.

- La bascule de saison de l'autocueillette est décrite dans le commentaire au-dessus de `.activites-grid`. La crêperie n'en dépend pas.
- Fermeture ponctuelle : entrée `openingHoursSpecification` avec `opens`/`closes` à `00:00` et `validFrom` = `validThrough`, le format documenté par Google (pas `specialOpeningHoursSpecification`).
- Avis temporaire sur l'accueil : hors de l'en-tête et du pied de page, CSS dans son propre `<style id>`. Le retirer, avec ses entrées JSON-LD, une fois la date passée.

## Secrets

Aucun secret dans le dépôt. Jetons Cloudflare : secrets GitHub Actions. Clés Turnstile et Brevo : éditeur Apps Script. `pw.txt` (local, ignoré par git) : ne jamais l'ouvrir, le copier ni le commiter.

## Règles de session

- Ne commiter et ne pousser que sur demande explicite.
- Lancer `npm run build:blog` dès que `posts/`, la feuille de style, l'en-tête ou le pied de page de `index.html` changent.
- Calculer le contraste à la main.
- Pour arrêter `wrangler dev`, vérifier l'arbre de processus complet : TaskStop ne tue que l'enveloppe, et un port libre ne prouve rien (deux `node` et un `workerd.exe` peuvent survivre). `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*wrangler*' }`, puis remonter `ParentProcessId`. Ne jamais tuer un processus non identifié.
- Proposer de noter en mémoire toute décision ou tout piège nouveau.

## Début de session

1. Résumer l'état du site et le backlog d'après la mémoire, en signalant ce qui est échu.
2. Vérifier `git status`.
3. Lancer le serveur de prévisualisation (`npx wrangler dev --port 8788`).
