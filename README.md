# Smartphone Cubes

Prototype web local permettant a deux smartphones de piloter deux cubes 3D affiches sur un Mac.

Le meme QR code est utilise par les deux telephones. Le serveur attribue automatiquement les roles :

- premier smartphone connecte : joueur 1 ;
- deuxieme smartphone connecte : joueur 2 ;
- troisieme smartphone : session pleine.

Les smartphones peuvent etre deux iPhone, deux Android, ou une combinaison iPhone / Android.

## Fonctionnalites

- serveur HTTPS local avec Express ;
- communication temps reel par WebSocket ;
- deux cubes Three.js avec faces colorees ;
- controle par `DeviceOrientationEvent` ;
- permission capteurs iOS apres interaction utilisateur ;
- calibration au bouton `DEMARRER` ;
- bouton `RECALIBRER` ;
- reconnexion automatique du controleur ;
- QR code vers la page controleur ;
- mur arriere, halos lumineux et faisceaux emis par les faces turquoise ;
- araignee animee via `images/spiderWalk.gif`, visible uniquement sous les halos ;
- mode debug avec `?debug=1`.

## Prerequis

- Node.js ;
- npm ;
- deux smartphones sur le meme Wi-Fi que le Mac.

Pour iPhone/Safari, HTTPS est indispensable pour les capteurs. Le projet genere un certificat local auto-signe dans `certs/` si aucun certificat n'existe.

## Installation

Depuis ce dossier :

```bash
npm install
```

L'installation genere aussi le bundle navigateur du decodeur GIF :

```bash
npm run build:vendor
```

Cette etape est lancee automatiquement par `postinstall`.

## Lancement

```bash
npm start
```

Le terminal affiche des URLs de ce type :

```text
Server running
Display:    https://ADRESSE_IP_DU_MAC:3000/
Controller: https://ADRESSE_IP_DU_MAC:3000/controller
```

Ouvrir l'URL `Display` sur le Mac. Les smartphones scannent le QR code affiche ou ouvrent directement l'URL `Controller`.

## Utilisation

1. Lancer le serveur avec `npm start`.
2. Ouvrir l'URL `Display` sur le Mac.
3. Connecter les deux smartphones au meme Wi-Fi que le Mac.
4. Scanner le QR code avec chaque smartphone.
5. Sur chaque telephone, toucher `DEMARRER`.
6. Autoriser l'acces aux mouvements si Safari/iOS le demande.
7. Incliner le telephone pour piloter le cube associe.
8. Utiliser `RECALIBRER` pour redefinir la position neutre.

## Mode Debug

Ajouter `?debug=1` a l'URL :

```text
https://ADRESSE_IP_DU_MAC:3000/?debug=1
https://ADRESSE_IP_DU_MAC:3000/controller?debug=1
```

La page Mac affiche FPS, valeurs d'orientation et latence indicative. La page controleur affiche l'etat WebSocket, le joueur attribue, l'orientation ecran et les valeurs capteurs.

## Tests

Une QA automatisee Playwright est disponible :

```bash
npm run qa
```

Elle verifie notamment :

- chargement de la page ;
- rendu WebGL non vide ;
- mouvement d'un cube apres message WebSocket ;
- chargement du GIF de l'araignee ;
- animation reelle des frames du GIF ;
- apparition de l'araignee sous halo ;
- layout mobile du controleur ;
- absence d'erreurs navigateur.

Les captures de test sont ecrites dans `.qa/`.

## Depannage

### La page est inaccessible sur un smartphone

Verifier d'abord que tous les appareils sont sur le meme Wi-Fi. C'est indispensable.

Verifier ensuite l'IP affichee au lancement du serveur. Si le Mac change de reseau ou d'adresse IP, arreter le serveur avec `Ctrl+C`, puis relancer :

```bash
npm start
```

Le QR code sera regenere avec la nouvelle adresse.

### Safari/iPhone refuse la page

Safari peut bloquer le certificat HTTPS auto-signe. Ouvrir l'URL controleur directement, puis accepter l'avertissement si Safari propose de continuer.

Si Safari garde un ancien etat, vider les donnees du site dans :

```text
Reglages > Apps > Safari > Avance > Donnees de sites
```

Chercher puis supprimer l'ancienne adresse IP ou l'adresse actuelle du Mac.

### Les capteurs ne repondent pas

- verifier que l'URL commence par `https://` ;
- toucher `DEMARRER` avant d'attendre les mouvements ;
- accepter la permission sur iPhone ;
- tester `?debug=1` pour voir les valeurs capteurs ;
- verifier que le telephone n'est pas en mode economie d'energie trop restrictif.

### Le QR code pointe vers une ancienne IP

Relancer le serveur. Le certificat et le QR code sont recalcules au demarrage selon l'adresse reseau actuelle du Mac.

## Structure

```text
.
├── server.js
├── package.json
├── prototype_smartphones_cubes_codex.md
├── images/
│   └── spiderWalk.gif
├── certs/
│   ├── cert.pem
│   ├── key.pem
│   └── openssl.cnf
├── public/
│   ├── index.html
│   ├── controller.html
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── controller.js
│   │   ├── display.js
│   │   └── sensors.js
│   └── vendor/
│       ├── gifuct-entry.js
│       └── gifuct.esm.js
└── scripts/
    └── qa-playwright.mjs
```

## Notes Techniques

- `server.js` gere HTTPS, Express, WebSocket, QR code, attribution joueurs et exposition des assets.
- `public/js/controller.js` gere la connexion smartphone, les permissions et l'envoi d'orientation.
- `public/js/sensors.js` gere normalisation, calibration et lissage des capteurs.
- `public/js/display.js` gere Three.js, les cubes, les halos, les faisceaux et l'araignee.
- `public/vendor/gifuct.esm.js` est genere par `npm run build:vendor` pour decoder les frames du GIF dans le navigateur.
