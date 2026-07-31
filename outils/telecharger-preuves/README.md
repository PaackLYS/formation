# Téléchargement automatique des preuves de livraison

Ouvre chaque commande d'une liste, télécharge les photos + reçus et les range,
nommés par numéro de commande (`239350155_01.jpg`, `239350155_02.png`…).

## Pourquoi ce script (et pas une extension)

Les images sont servies depuis S3 **sans en-tête CORS**. Une extension ou un
script injecté dans la page ne peut pas lire le fichier. Ici c'est un vrai
Chrome piloté par Playwright qui télécharge : le CORS ne s'applique pas.

## Installation (une seule fois)

Nécessite **Node.js** (vérifie avec `node -v` dans le terminal VS Code ;
sinon installe la version LTS depuis nodejs.org).

```bash
cd outils/telecharger-preuves
npm init -y
npm install playwright
npx playwright install chromium
```

## Utilisation

1. Colle tes numéros de commande dans `commandes.txt` (un par ligne — un
   copier-coller de colonne depuis un Sheet passe très bien).
2. Lance :
   ```bash
   node telecharger-preuves.js
   ```
3. **1er lancement** : une fenêtre Chrome s'ouvre, connecte-toi au dashboard,
   reviens au terminal et appuie sur Entrée. La session est mémorisée dans
   `profil-chrome/`, à ne refaire qu'en cas de déconnexion.

Les fichiers arrivent dans `preuves/`. Le `journal.csv` note ce qui a été fait :
si tu interromps ou relances, les commandes déjà traitées (`ok`) sont ignorées.

## Réglages (bloc `CONFIG` en haut du .js)

| Réglage | Rôle |
|---|---|
| `urlCommande` | Modèle d'URL d'une page commande, `{ID}` = le numéro. **À adapter à ton dashboard.** |
| `selecteurImages` | Sélecteur CSS des images. `img` par défaut. |
| `filtreUrlImage` | Ne garde que les URLs contenant ce texte (ex. `proof`, `pod`). |
| `unDossierParCommande` | `true` = un sous-dossier par commande. |
| `pauseEntreCommandes` | Pause entre commandes (ms). Ne pas trop descendre. |
| `tailleMiniOctets` | Ignore les images plus petites (icônes, logos). |
| `timeoutImages` | Attente max d'apparition des images (ms). |

Teste sur 2-3 commandes avant une vraie série.

> Note : ces fichiers (`profil-chrome/`, `preuves/`, `journal.csv`, tes vraies
> commandes) sont exclus du dépôt via `.gitignore` — ils restent en local.
