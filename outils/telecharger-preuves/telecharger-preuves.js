/**
 * telecharger-preuves.js
 * ------------------------------------------------------------------
 * Télécharge automatiquement les preuves de livraison (photos + reçus)
 * depuis le dashboard, une commande après l'autre.
 *
 * Pourquoi Playwright plutôt qu'une extension ou un script dans la page :
 * les images sont servies depuis S3 (Amazon) SANS en-tête
 * Access-Control-Allow-Origin. Un script injecté dans la page ne peut donc
 * pas lire le fichier (blocage CORS). Ici, c'est un vrai Chrome piloté qui
 * télécharge : le CORS ne s'applique pas.
 *
 * Prérequis (une seule fois) :
 *   npm init -y
 *   npm install playwright
 *   npx playwright install chromium
 *
 * Utilisation :
 *   1. Colle tes numéros de commande dans commandes.txt (un par ligne).
 *   2. node telecharger-preuves.js
 *   3. Au 1er lancement, connecte-toi dans la fenêtre Chrome qui s'ouvre,
 *      reviens au terminal et appuie sur Entrée. La session est mémorisée
 *      dans ./profil-chrome, tu ne le referas plus.
 *
 * Reprise : journal.csv note les commandes traitées ; si tu relances,
 * elles sont ignorées.
 * ------------------------------------------------------------------
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ============================ CONFIG ==============================
const CONFIG = {
  // URL d'une page commande. {ID} est remplacé par le numéro de commande.
  // À adapter à ton dashboard. Exemple :
  urlCommande: 'https://dashboard.paack.co/orders/{ID}',

  // Sélecteur CSS des images de preuve sur la page.
  // Le mieux : ne cibler que les vraies photos de preuve. Si tu ne sais pas,
  // laisse 'img' et affine ensuite avec filtreUrlImage ci-dessous.
  selecteurImages: 'img',

  // On ne garde que les URLs d'images qui contiennent ce texte
  // (ex. 'proof', 'pod', 's3'...). Laisse '' pour tout prendre.
  filtreUrlImage: '',

  // Dossiers
  dossierSortie: path.join(__dirname, 'preuves'),
  profilChrome: path.join(__dirname, 'profil-chrome'),
  fichierCommandes: path.join(__dirname, 'commandes.txt'),
  fichierJournal: path.join(__dirname, 'journal.csv'),

  // Un sous-dossier par commande (true) ou tout à plat (false)
  unDossierParCommande: false,

  // Pause entre deux commandes (ms). NE PAS descendre trop bas :
  // à 1,5 s / commande, 100 commandes = 2-3 min, indiscernable d'une
  // consultation humaine côté serveur.
  pauseEntreCommandes: 1500,

  // Temps d'attente max pour que les images apparaissent (ms)
  timeoutImages: 15000,

  // Taille minimale d'une image conservée (octets) : élimine icônes/logos
  tailleMiniOctets: 15000,
};
// ==================================================================

function log(msg) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] ${msg}`);
}

/** Lit commandes.txt et extrait les numéros (tolère un copier-coller de colonne). */
function lireCommandes() {
  if (!fs.existsSync(CONFIG.fichierCommandes)) {
    fs.writeFileSync(CONFIG.fichierCommandes, '# Un numéro de commande par ligne\n');
    log(`Fichier ${path.basename(CONFIG.fichierCommandes)} créé. Ajoute tes commandes et relance.`);
    process.exit(0);
  }
  const brut = fs.readFileSync(CONFIG.fichierCommandes, 'utf8');
  const ids = [];
  for (const ligne of brut.split(/\r?\n/)) {
    const t = ligne.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/\d{5,}/); // premier bloc de chiffres (5+)
    if (m) ids.push(m[0]);
  }
  return [...new Set(ids)]; // dédoublonne
}

/** Charge l'ensemble des commandes déjà traitées depuis journal.csv. */
function chargerJournal() {
  const faites = new Set();
  if (!fs.existsSync(CONFIG.fichierJournal)) {
    fs.writeFileSync(CONFIG.fichierJournal, 'commande;statut;nb_images;date\n');
    return faites;
  }
  const lignes = fs.readFileSync(CONFIG.fichierJournal, 'utf8').split(/\r?\n/).slice(1);
  for (const l of lignes) {
    const [cmd, statut] = l.split(';');
    if (cmd && statut === 'ok') faites.add(cmd.trim());
  }
  return faites;
}

function noterJournal(commande, statut, nbImages) {
  const ligne = `${commande};${statut};${nbImages};${new Date().toISOString()}\n`;
  fs.appendFileSync(CONFIG.fichierJournal, ligne);
}

/** Attend Entrée dans le terminal. */
function attendreEntree(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, () => { rl.close(); resolve(); }));
}

/** Devine une extension propre à partir de l'URL. */
function extensionDepuisUrl(url) {
  const m = url.split('?')[0].match(/\.(jpe?g|png|webp|gif|pdf)$/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

async function main() {
  const commandes = lireCommandes();
  if (commandes.length === 0) {
    log('Aucune commande trouvée dans commandes.txt.');
    return;
  }
  const dejaFaites = chargerJournal();
  const aTraiter = commandes.filter((c) => !dejaFaites.has(c));
  log(`${commandes.length} commande(s), ${aTraiter.length} à traiter (${dejaFaites.size} déjà faite(s)).`);
  if (aTraiter.length === 0) return;

  fs.mkdirSync(CONFIG.dossierSortie, { recursive: true });

  // Contexte persistant : la session de connexion est réutilisée.
  const contexte = await chromium.launchPersistentContext(CONFIG.profilChrome, {
    headless: false,
    acceptDownloads: true,
    viewport: { width: 1400, height: 900 },
  });
  const page = contexte.pages()[0] || (await contexte.newPage());

  // Première connexion
  const premiereFois = !fs.existsSync(path.join(CONFIG.profilChrome, 'Default'));
  if (premiereFois) {
    await page.goto(CONFIG.urlCommande.replace('{ID}', aTraiter[0]), { waitUntil: 'domcontentloaded' });
    await attendreEntree('\n>>> Connecte-toi dans la fenêtre Chrome, puis appuie sur Entrée ici... ');
  }

  let total = 0;
  for (const commande of aTraiter) {
    try {
      const url = CONFIG.urlCommande.replace('{ID}', commande);
      log(`Commande ${commande} → ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

      // Attendre l'apparition des images
      try {
        await page.waitForSelector(CONFIG.selecteurImages, { timeout: CONFIG.timeoutImages });
      } catch {
        log(`  ⚠ aucune image détectée pour ${commande}`);
      }

      // Récupérer les URLs des images
      let urls = await page.$$eval(CONFIG.selecteurImages, (imgs) =>
        imgs.map((i) => i.currentSrc || i.src).filter(Boolean)
      );
      urls = [...new Set(urls)];
      if (CONFIG.filtreUrlImage) {
        urls = urls.filter((u) => u.includes(CONFIG.filtreUrlImage));
      }

      // Dossier de destination
      const destDir = CONFIG.unDossierParCommande
        ? path.join(CONFIG.dossierSortie, commande)
        : CONFIG.dossierSortie;
      fs.mkdirSync(destDir, { recursive: true });

      // Télécharger chaque image via le contexte navigateur (pas de CORS)
      let n = 0;
      for (const u of urls) {
        try {
          const reponse = await contexte.request.get(u);
          if (!reponse.ok()) continue;
          const buf = await reponse.body();
          if (buf.length < CONFIG.tailleMiniOctets) continue; // icône/logo
          n += 1;
          const ext = extensionDepuisUrl(u);
          const nom = `${commande}_${String(n).padStart(2, '0')}.${ext}`;
          fs.writeFileSync(path.join(destDir, nom), buf);
          log(`  ✔ ${nom} (${Math.round(buf.length / 1024)} Ko)`);
        } catch (e) {
          log(`  ⚠ échec téléchargement d'une image : ${e.message}`);
        }
      }

      noterJournal(commande, n > 0 ? 'ok' : 'vide', n);
      total += n;
    } catch (e) {
      log(`  ✖ erreur commande ${commande} : ${e.message}`);
      noterJournal(commande, 'erreur', 0);
    }
    await page.waitForTimeout(CONFIG.pauseEntreCommandes);
  }

  log(`Terminé. ${total} image(s) téléchargée(s) dans ${CONFIG.dossierSortie}`);
  await contexte.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
