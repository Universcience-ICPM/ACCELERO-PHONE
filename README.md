# Smartphone Cubes

Prototype web local pour transformer des smartphones en controleurs d'une scene
Three.js affichee sur un Mac.

Chaque smartphone qui scanne le QR code rejoint la session. Le serveur attribue
un identifiant automatiquement, cree un cube pour ce telephone, puis adapte la
taille et la grille des cubes au nombre de smartphones connectes.

## Fonctionnalites

- serveur HTTPS local avec Express ;
- QR code unique vers la page controleur ;
- communication temps reel par WebSocket ;
- nombre de smartphones dynamique, sans limite fixe a deux joueurs ;
- cubes Three.js avec faces colorees, halos et faisceaux lumineux ;
- taille des cubes ajustee automatiquement selon le nombre de telephones ;
- controle par `DeviceOrientationEvent` ;
- permission capteurs iOS apres interaction utilisateur ;
- calibration au bouton `DEMARRER` ;
- bouton `RECALIBRER` ;
- verrouillage portrait demande au navigateur quand il est disponible ;
- araignee animee via `images/spiderWalk.gif`, visible uniquement sous les halos ;
- retour de collision quand l'axe du cone lumineux touche l'araignee ;
- vibration Web quand le navigateur la supporte ;
- son de collision via `public/sounds/collision.mp3` ou `collision.wav` ;
- flash visuel de secours sur le controleur ;
- mode debug avec `?debug=1`.

## Prerequis

- Node.js ;
- npm ;
- un Mac qui lance le serveur ;
- un ou plusieurs smartphones sur le meme Wi-Fi que le Mac.

Pour les capteurs mobiles, HTTPS est indispensable. Le projet genere un
certificat local auto-signe dans `certs/` si aucun certificat n'existe.

Sur iPhone, la vibration Web est souvent indisponible, y compris dans Chrome
iOS car il utilise le moteur WebKit d'iOS. Android Chrome prend mieux en charge
`navigator.vibrate`. Le son et le flash visuel servent donc aussi de retour
perceptible quand la vibration n'est pas disponible.

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

Ouvrir l'URL `Display` sur le Mac. Les smartphones scannent le QR code affiche
ou ouvrent directement l'URL `Controller`.

Si le port 3000 est deja utilise, arreter l'autre serveur ou lancer celui-ci sur
un autre port :

```bash
PORT=3001 npm start
```

## Utilisation

1. Lancer le serveur avec `npm start`.
2. Ouvrir l'URL `Display` sur le Mac.
3. Connecter les smartphones au meme Wi-Fi que le Mac.
4. Scanner le QR code avec chaque smartphone.
5. Sur chaque telephone, toucher `DEMARRER`.
6. Autoriser l'acces aux mouvements si le navigateur le demande.
7. Incliner le telephone pour piloter le cube associe.
8. Utiliser `RECALIBRER` pour redefinir la position neutre.

Chaque telephone connecte ajoute un cube. Lorsqu'un telephone quitte la session,
son cube est retire et la grille est recalculee.

## Son et vibration

Quand l'axe du faisceau lumineux d'un cube entre en collision avec l'araignee,
le serveur envoie un retour au smartphone correspondant.

Le controleur tente alors, dans cet ordre :

1. jouer le fichier audio de collision ;
2. jouer un son synthetique de secours ;
3. vibrer si `navigator.vibrate` est disponible ;
4. afficher un flash visuel.

Le fichier audio attendu est :

```text
public/sounds/collision.mp3
```

ou :

```text
public/sounds/collision.wav
```

Le projet essaie `collision.mp3` en premier, puis `collision.wav`. Un fichier
`collision.mp3` est deja present dans `public/sounds/`.

Le son mobile ne peut etre debloque qu'apres un geste utilisateur. Sur chaque
telephone, toucher `DEMARRER` ou `TEST VIBRATION + SON` apres le chargement de
la page.

Options utiles sur la page controleur :

```text
/controller?soundVolume=1
/controller?sound=autre-fichier.mp3
/controller?soundHz=1400&soundMs=260
```

- `soundVolume` va de `0` a `1` ;
- `sound` permet de tester un autre fichier place dans `public/sounds/` ;
- `soundHz` et `soundMs` reglent uniquement le son synthetique de secours.

Option utile sur la page `Display` :

```text
/?hapticIntensity=5
```

`hapticIntensity` va de `1` a `5`. La valeur par defaut est `5`.

## Mode Debug

Ajouter `?debug=1` a l'URL :

```text
https://ADRESSE_IP_DU_MAC:3000/?debug=1
https://ADRESSE_IP_DU_MAC:3000/controller?debug=1
```

La page Mac affiche notamment :

- FPS ;
- nombre de cubes ;
- grille calculee ;
- echelle des cubes ;
- valeurs d'orientation recues ;
- latence indicative ;
- etat des halos, faisceaux, araignee et retours haptiques dans l'objet QA.

La page controleur affiche notamment :

- etat WebSocket ;
- identifiant attribue ;
- orientation ecran ;
- valeurs capteurs brutes et normalisees ;
- etat du retour impact ;
- etat du son, de la vibration et du verrouillage portrait dans l'objet QA.

## Tests

Une QA automatisee Playwright est disponible :

```bash
npm run qa
```

Elle verifie notamment :

- chargement de la page ;
- rendu WebGL non vide ;
- simulation de plusieurs smartphones ;
- creation dynamique des cubes ;
- adaptation de l'echelle des cubes ;
- mouvement d'un cube apres message WebSocket ;
- chargement du GIF de l'araignee ;
- animation reelle des frames du GIF ;
- apparition de l'araignee sous halo ;
- suivi dynamique des halos ;
- retour vibration cote controleur ;
- retour son cote controleur ;
- layout mobile du controleur ;
- absence d'erreurs navigateur.

Les captures de test sont ecrites dans `.qa/`.

## Depannage

### `EADDRINUSE: address already in use 0.0.0.0:3000`

Le port 3000 est deja pris par un autre processus. Arreter l'autre serveur avec
`Ctrl+C` dans le terminal qui l'a lance, ou demarrer ce projet sur un autre port :

```bash
PORT=3001 npm start
```

### La page est inaccessible sur un smartphone

Verifier d'abord que tous les appareils sont sur le meme Wi-Fi. C'est
indispensable.

Verifier ensuite l'IP affichee au lancement du serveur. Si le Mac change de
reseau ou d'adresse IP, arreter le serveur avec `Ctrl+C`, puis relancer :

```bash
npm start
```

Le QR code sera regenere avec la nouvelle adresse.

### Safari/iPhone refuse la page

Safari peut bloquer le certificat HTTPS auto-signe. Ouvrir l'URL controleur
directement, puis accepter l'avertissement si Safari propose de continuer.

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

### Le telephone ne vibre pas

- Android Chrome supporte generalement `navigator.vibrate` ;
- iOS ne donne souvent pas acces a la vibration Web ;
- verifier que la collision concerne bien le smartphone qui doit vibrer ;
- utiliser `TEST VIBRATION + SON` sur le controleur ;
- ouvrir le `Display` avec `?debug=1` pour voir les retours haptiques envoyes.

### Le telephone ne joue pas le son

- toucher `DEMARRER` ou `TEST VIBRATION + SON` pour debloquer l'audio mobile ;
- monter le volume media du telephone ;
- sur iPhone, verifier le mode silencieux ;
- tester `/controller?soundVolume=1` ;
- verifier que `public/sounds/collision.mp3` ou `collision.wav` existe ;
- essayer un fichier court, clair et audible sur haut-parleur de telephone.

### Le QR code pointe vers une ancienne IP

Relancer le serveur. Le certificat et le QR code sont recalcules au demarrage
selon l'adresse reseau actuelle du Mac.

## Structure

```text
.
├── server.js
├── package.json
├── prototype_smartphones_cubes_codex.md
├── FONCTIONNEMENT_TECHNIQUE.md
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
│   ├── sounds/
│   │   ├── README.md
│   │   └── collision.mp3
│   └── vendor/
│       ├── gifuct-entry.js
│       └── gifuct.esm.js
├── scripts/
│   └── qa-playwright.mjs
└── usages/
    ├── *.md
    └── docx/
```

## Notes techniques

- `server.js` gere HTTPS, Express, WebSocket, QR code, attribution des
  smartphones et exposition des assets.
- `public/js/controller.js` gere la connexion smartphone, les permissions, le
  son, la vibration et l'envoi d'orientation.
- `public/js/sensors.js` gere normalisation, calibration et lissage des capteurs.
- `public/js/display.js` gere Three.js, les cubes dynamiques, les halos, les
  faisceaux, l'araignee et l'envoi des retours haptiques.
- `public/vendor/gifuct.esm.js` est genere par `npm run build:vendor` pour
  decoder les frames du GIF dans le navigateur.
