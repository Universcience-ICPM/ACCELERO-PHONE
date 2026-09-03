# Prototype Web — Smartphones pilotant deux cubes 3D

## Objectif

Créer un prototype web minimal permettant à **deux utilisateurs simultanés** de piloter chacun un cube 3D affiché sur la page principale d’un Mac.

Les deux utilisateurs utilisent leur propre smartphone.

Le type d’appareil n’est pas imposé. Les combinaisons possibles sont :

- deux iPhone ;
- deux Android ;
- un iPhone et un Android.

L’attribution joueur 1 / joueur 2 dépend uniquement de l’ordre de connexion, jamais du système d’exploitation ou du navigateur.

Aucune application native ne doit être installée.

Les smartphones utilisent uniquement leur navigateur web :

- Safari sur iPhone ;
- Chrome ou navigateur compatible sur Android.

Le prototype doit permettre de valider :

- la lecture des capteurs d’orientation du smartphone ;
- la compatibilité iOS / Android quelle que soit la combinaison de deux smartphones ;
- la connexion de deux smartphones simultanément ;
- l’attribution automatique d’un cube à chaque smartphone ;
- la transmission temps réel vers le Mac ;
- la fluidité ;
- la latence ;
- la cohérence des axes ;
- la reconnexion après déconnexion.

---

# 1. Vue générale

Le système comporte trois types de clients :

1. le navigateur principal sur le Mac ;
2. le smartphone du joueur 1 ;
3. le smartphone du joueur 2.

Architecture souhaitée :

```text
                     MAC

             Navigateur principal
          ┌─────────────────────────┐
          │                         │
          │ Cube 1        Cube 2    │
          │                         │
          │       QR CODE           │
          │                         │
          └────────────┬────────────┘
                       │
                       │ WebSocket
                       │
               ┌───────┴────────┐
               │   Serveur      │
               │ Node.js        │
               │ Express + WS   │
               └───────┬────────┘
                       │
              ┌────────┴─────────┐
              │                  │
         Smartphone 1       Smartphone 2
          iOS/Android        iOS/Android
              │                  │
       orientation         orientation
       accéléromètre       accéléromètre
       gyroscope           gyroscope
```

---

# 2. Technologies proposées

## Serveur

Utiliser :

- Node.js ;
- Express ;
- WebSocket.

Librairies possibles :

```text
express
ws
qrcode
```

Éviter toute architecture inutilement complexe.

Pas de base de données.

Pas de framework frontend obligatoire.

---

## Page principale Mac

Utiliser :

- HTML ;
- CSS ;
- JavaScript ;
- Three.js.

La page doit afficher :

- deux cubes 3D ;
- un QR code unique ;
- l’état de connexion des joueurs ;
- éventuellement les valeurs d’orientation reçues pour le debug.

---

## Smartphones

Utiliser uniquement les API web :

```javascript
DeviceOrientationEvent
DeviceMotionEvent
```

Pas d’application native.

Pas d’ARKit.

Pas d’ARCore.

---

# 3. URL et QR code

La page principale du Mac doit afficher un QR code unique.

Le QR code pointe vers une URL du type :

```text
https://IP_OU_HOST/controller
```

ou, en développement local :

```text
https://192.168.1.100:3000/controller
```

Important :

les API de mouvement sur iOS nécessitent un contexte sécurisé.

Le prototype doit donc prévoir HTTPS.

Pour le développement local, utiliser si nécessaire :

- certificat local ;
- mkcert ;
- ou toute autre méthode simple permettant d’avoir HTTPS sur le réseau local.

---

# 4. Attribution des joueurs

Le même QR code doit être utilisé par les deux smartphones.

Les smartphones peuvent être deux iPhone, deux Android, ou une combinaison iPhone / Android. Le serveur ne doit faire aucune hypothèse sur le type d’appareil pour attribuer les joueurs.

Il ne doit pas exister :

```text
/qrcode-player1
/qrcode-player2
```

Le serveur attribue automatiquement un rôle.

Exemple :

```text
premier smartphone connecté
→ playerId = 1

deuxième smartphone connecté
→ playerId = 2
```

Chaque joueur est associé à son cube :

```text
player 1 → cube 1
player 2 → cube 2
```

Si un troisième smartphone tente de rejoindre :

```text
Session complète
2 joueurs maximum
```

---

# 5. Page smartphone

L’interface smartphone doit rester extrêmement simple.

Exemple :

```text
┌─────────────────────────────┐
│                             │
│          JOUEUR 1           │
│                             │
│        [ DÉMARRER ]         │
│                             │
│  Inclinez votre téléphone   │
│                             │
│        ● connecté           │
│                             │
│      [ RECALIBRER ]         │
│                             │
└─────────────────────────────┘
```

Pour le joueur 2 :

```text
JOUEUR 2
```

---

# 6. Autorisation des capteurs

Sur iPhone, l’accès aux capteurs doit être demandé après une interaction utilisateur.

Le bouton :

```text
DÉMARRER
```

doit déclencher la demande d’autorisation.

Prévoir quelque chose du type :

```javascript
async function requestSensors() {

    if (
        typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function"
    ) {

        const permission =
            await DeviceOrientationEvent.requestPermission();

        if (permission !== "granted") {
            return;
        }
    }

    startSensors();
}
```

Faire de même pour `DeviceMotionEvent` si nécessaire.

Sur Android, si `requestPermission()` n’existe pas, démarrer directement les événements.

---

# 7. Données utilisées

Pour le premier prototype, utiliser principalement :

```javascript
deviceorientation
```

Valeurs :

```javascript
event.alpha
event.beta
event.gamma
```

Correspondance générale :

```text
alpha
rotation autour de l’axe vertical

beta
inclinaison avant / arrière

gamma
inclinaison gauche / droite
```

On peut également récupérer :

```javascript
devicemotion
```

pour de futurs tests :

```javascript
event.acceleration
event.accelerationIncludingGravity
event.rotationRate
```

Mais ne pas rendre l’accéléromètre obligatoire pour le MVP.

---

# 8. Calibration

La calibration est indispensable.

Quand l’utilisateur touche :

```text
DÉMARRER
```

l’orientation actuelle du téléphone devient l’orientation neutre.

Exemple :

```text
orientation actuelle
        ↓
        ZERO
        ↓
mouvements relatifs uniquement
```

Il faut mémoriser :

```javascript
zeroAlpha
zeroBeta
zeroGamma
```

Puis transmettre :

```javascript
relativeAlpha = alpha - zeroAlpha
relativeBeta  = beta  - zeroBeta
relativeGamma = gamma - zeroGamma
```

Prévoir également un bouton :

```text
RECALIBRER
```

qui redéfinit instantanément le zéro.

---

# 9. Orientation de l’écran du smartphone

Le système doit rester cohérent si le smartphone est utilisé :

- en portrait ;
- en paysage gauche ;
- en paysage droite.

Prendre en compte :

```javascript
screen.orientation.angle
```

ou son équivalent compatible.

Le but est que les mouvements aient toujours la même signification visuelle.

Exemple :

```text
incliner le téléphone vers la droite
→ cube vers la droite

quel que soit le mode portrait/paysage
```

---

# 10. Normalisation iOS / Android

Ne pas supposer que tous les navigateurs ont exactement les mêmes conventions.

Créer une couche de normalisation côté smartphone.

Exemple :

```javascript
function normalizeOrientation(alpha, beta, gamma) {
    return {
        alpha,
        beta,
        gamma
    };
}
```

Cette fonction pourra être adaptée selon :

```text
iOS
Android
orientation écran
navigateur
```

Éviter de mettre les corrections directement dans Three.js.

La sortie envoyée au serveur doit déjà être normalisée.

---

# 11. Transmission WebSocket

Chaque smartphone ouvre une connexion WebSocket.

Au moment de la connexion :

```json
{
  "type": "join",
  "client": "controller"
}
```

Le serveur répond :

```json
{
  "type": "assigned",
  "playerId": 1
}
```

ou :

```json
{
  "type": "assigned",
  "playerId": 2
}
```

---

# 12. Message d’orientation

Format proposé :

```json
{
  "type": "orientation",
  "playerId": 1,
  "alpha": 12.4,
  "beta": -23.8,
  "gamma": 7.1,
  "timestamp": 1720000000000
}
```

Le serveur retransmet ce message à la page principale.

Ne pas stocker les données.

Transmission temps réel uniquement.

---

# 13. Fréquence d’envoi

Ne pas envoyer nécessairement tous les événements reçus.

Limiter la transmission à environ :

```text
30 à 60 Hz
```

Valeur cible initiale :

```text
60 Hz maximum
```

Si nécessaire :

```text
30 Hz
```

pour réduire la charge.

Le rendu Three.js doit rester à :

```text
requestAnimationFrame
```

---

# 14. Lissage

Les capteurs peuvent produire du bruit.

Prévoir un lissage léger.

Exemple :

```javascript
filtered =
    filtered * 0.8 +
    newValue * 0.2;
```

Le coefficient doit être facile à modifier.

Ne pas appliquer un filtrage trop fort, pour ne pas créer de latence perceptible.

---

# 15. Page principale

La page principale doit afficher deux cubes Three.js.

Exemple de disposition :

```text
┌──────────────────────────────────────────────┐
│                                              │
│       JOUEUR 1          JOUEUR 2             │
│                                              │
│        CUBE 1            CUBE 2              │
│                                              │
│                                              │
│               QR CODE                        │
│                                              │
│       Scannez pour participer                │
│                                              │
│ Joueur 1 : connecté / attente                │
│ Joueur 2 : connecté / attente                │
│                                              │
└──────────────────────────────────────────────┘
```

---

# 16. Cubes

Chaque cube possède six couleurs différentes.

Exemple :

```text
avant   rouge
arrière cyan
gauche  vert
droite  jaune
haut    bleu
bas     magenta
```

Le choix exact des couleurs n’est pas critique.

Le but est de fournir un retour visuel immédiat permettant de comprendre l’orientation.

Ajouter :

- éclairage simple ;
- perspective 3D ;
- éventuellement une légère ombre.

Ne pas utiliser de textures.

---

# 17. Rotation Three.js

La rotation du cube doit suivre les valeurs du smartphone.

Pour une première version, on peut convertir :

```text
alpha
beta
gamma
```

en rotations Euler.

Attention aux systèmes d’axes.

Three.js utilise :

```text
X
Y
Z
```

et les conventions ne correspondent pas directement aux valeurs iOS / Android.

Créer une fonction dédiée :

```javascript
function phoneOrientationToThree(alpha, beta, gamma) {
    // conversion
}
```

Ne pas disperser ces conversions dans le code.

---

# 18. Rotation relative

Le cube ne doit pas prendre l’orientation absolue réelle du téléphone.

Le cube doit suivre l’orientation relative à la calibration.

Exemple :

```text
téléphone au moment de DÉMARRER
→ cube droit

rotation téléphone +20°
→ cube +20°
```

---

# 19. Limites

Pour le premier prototype, il est acceptable de limiter les rotations.

Exemple :

```text
beta  : -90° → +90°
gamma : -90° → +90°
```

Alpha peut rester libre.

Éviter les comportements visuellement instables.

---

# 20. Connexion / déconnexion

Lorsqu’un joueur se déconnecte :

```text
player 1 disconnected
```

le serveur doit libérer :

```text
slot 1
```

Le prochain smartphone peut alors devenir :

```text
player 1
```

Même comportement pour player 2.

Sur la page Mac :

```text
JOUEUR 1
● connecté
```

devient :

```text
JOUEUR 1
○ en attente
```

Le cube peut :

- rester dans sa dernière orientation ;
- ou revenir progressivement au neutre.

Pour le MVP, revenir progressivement au neutre est préférable.

---

# 21. Reconnexion

Si le WebSocket est coupé temporairement :

```text
Wi-Fi instable
écran verrouillé
Safari passe en arrière-plan
```

le contrôleur doit tenter une reconnexion automatique.

Exemple :

```text
retry toutes les 1 seconde
```

avec une limite raisonnable.

Une reconnexion peut recevoir un nouveau `playerId`.

---

# 22. Debug

Ajouter un mode debug activable simplement.

Exemple :

```text
?debug=1
```

Sur smartphone, afficher :

```text
alpha
beta
gamma

relative alpha
relative beta
relative gamma

screen orientation

WebSocket status

playerId
```

Sur le Mac :

```text
player 1 values
player 2 values
fps
latence approximative
```

---

# 23. Latence

Ajouter `timestamp` dans les messages.

Le Mac peut calculer :

```javascript
Date.now() - message.timestamp
```

Attention :

les horloges du smartphone et du Mac ne sont pas nécessairement parfaitement synchronisées.

Cette mesure est donc indicative.

Pour une mesure précise, un ping/pong WebSocket peut être ajouté plus tard.

---

# 24. Sécurité / réseau

Le prototype est conçu pour fonctionner principalement sur un réseau local.

Les smartphones et le Mac doivent être sur le même Wi-Fi.

Ne pas ouvrir inutilement le serveur vers Internet.

Prévoir une configuration simple :

```text
HOST
PORT
HTTPS
```

---

# 25. Organisation recommandée

Structure possible :

```text
smartphone-cubes/
│
├── server.js
│
├── package.json
│
├── certs/
│   ├── cert.pem
│   └── key.pem
│
└── public/
    │
    ├── index.html
    ├── controller.html
    │
    ├── css/
    │   └── style.css
    │
    └── js/
        ├── display.js
        ├── controller.js
        └── sensors.js
```

---

# 26. Rôle des fichiers

## `server.js`

Responsabilités :

- serveur HTTPS ;
- Express ;
- WebSocket ;
- attribution player 1 / player 2 ;
- retransmission des orientations ;
- gestion des déconnexions.

---

## `index.html`

Page principale destinée au Mac.

Contient :

- canvas Three.js ;
- cube 1 ;
- cube 2 ;
- QR code ;
- état des joueurs.

---

## `controller.html`

Page ouverte sur smartphone.

Contient :

- numéro du joueur ;
- bouton Démarrer ;
- bouton Recalibrer ;
- état connexion.

---

## `sensors.js`

Responsabilités :

- permissions ;
- DeviceOrientation ;
- DeviceMotion éventuel ;
- calibration ;
- orientation écran ;
- normalisation ;
- filtrage.

---

## `controller.js`

Responsabilités :

- WebSocket ;
- join ;
- playerId ;
- envoi orientation ;
- reconnexion.

---

## `display.js`

Responsabilités :

- Three.js ;
- création des cubes ;
- réception WebSocket ;
- conversion orientation → rotation ;
- animation.

---

# 27. États possibles côté smartphone

Prévoir les états :

```text
connexion serveur
↓
attente attribution
↓
player 1 / player 2
↓
attente DÉMARRER
↓
demande autorisation
↓
contrôle actif
```

Et les erreurs :

```text
capteurs indisponibles
permission refusée
session pleine
WebSocket inaccessible
HTTPS manquant
```

---

# 28. Messages utilisateur

Exemples :

## Connexion

```text
Connexion…
```

## Joueur attribué

```text
Vous êtes le joueur 1
```

## Autorisation

```text
Touchez DÉMARRER puis autorisez l’accès aux mouvements du téléphone.
```

## Session complète

```text
Deux joueurs sont déjà connectés.
```

## Permission refusée

```text
L’accès aux capteurs a été refusé.
Rechargez la page pour réessayer.
```

---

# 29. Contraintes ergonomiques

L’expérience doit rester très simple.

Un visiteur doit pouvoir :

```text
scanner QR
↓
ouvrir la page
↓
toucher DÉMARRER
↓
incliner le téléphone
↓
voir immédiatement son cube bouger
```

Objectif :

```text
moins de 10 secondes
```

entre le scan du QR code et la première interaction.

---

# 30. Hors périmètre du MVP

Ne pas implémenter pour l’instant :

- position 3D réelle du téléphone ;
- ARKit ;
- ARCore ;
- WebXR ;
- caméra du smartphone ;
- streaming vidéo ;
- multitouch avancé ;
- vibrations ;
- audio ;
- compte utilisateur ;
- authentification ;
- base de données ;
- historique ;
- Unity ;
- application mobile native.

---

# 31. Évolution ultérieure possible

Si le prototype fonctionne, l’architecture pourra ensuite servir à piloter :

- Unity ;
- TouchDesigner ;
- Unreal Engine ;
- Python ;
- installations muséales ;
- objets 3D ;
- personnages ;
- caméras ;
- simulations physiques.

On pourra également ajouter :

```text
secousse
→ action

rotation rapide
→ lancer

inclinaison
→ déplacement

écran tactile
→ boutons

2 smartphones
→ interaction coopérative
```

---

# 32. Critères de validation

Le prototype est considéré comme validé si :

## Connexion

- le Mac affiche un QR code ;
- un premier smartphone scanne le QR code ;
- un deuxième smartphone scanne le même QR code ;
- les deux appareils se connectent simultanément ;
- les combinaisons iPhone + iPhone, Android + Android et iPhone + Android restent possibles.

## Attribution

- premier smartphone = joueur 1 ;
- deuxième smartphone = joueur 2 ;
- l’attribution ne dépend pas du système d’exploitation ;
- player 1 contrôle uniquement cube 1 ;
- player 2 contrôle uniquement cube 2.

## Capteurs

- chaque smartphone connecté transmet son orientation ;
- iOS et Android sont pris en charge quand ils sont utilisés ;
- incliner le téléphone produit une rotation immédiatement visible.

## Calibration

- la position lors de `DÉMARRER` devient le zéro ;
- `RECALIBRER` fonctionne.

## Fluidité

Objectif :

```text
30 FPS minimum
```

et idéalement :

```text
60 FPS
```

## Latence

Le mouvement doit sembler direct.

Objectif qualitatif :

```text
pas de retard gênant perceptible
```

## Robustesse

- déconnexion détectée ;
- slot joueur libéré ;
- nouveau téléphone accepté.

---

# 33. Priorités d’implémentation

Procéder dans cet ordre :

## Étape 1

Créer le serveur Node.js HTTPS.

## Étape 2

Créer la page Mac avec deux cubes Three.js statiques.

## Étape 3

Ajouter WebSocket.

## Étape 4

Créer la page smartphone.

## Étape 5

Tester `DeviceOrientationEvent` sur Android et iOS.

## Étape 6

Ajouter la demande de permission iOS.

## Étape 7

Faire piloter un cube par un smartphone.

## Étape 8

Ajouter le deuxième smartphone.

## Étape 9

Ajouter calibration.

## Étape 10

Normaliser portrait / paysage et iOS / Android.

## Étape 11

Ajouter QR code.

## Étape 12

Ajouter reconnexion et gestion de session.

---

# 34. Principe important

Ne pas chercher à construire immédiatement une architecture générique.

Le but de ce prototype est de répondre à une question simple :

> Peut-on utiliser simultanément deux smartphones iOS et/ou Android, sans application installée, comme contrôleurs gestuels de deux objets 3D affichés sur un Mac avec une latence suffisamment faible pour une installation interactive ?

Tout développement doit rester orienté vers cette validation.

---

# 35. Résultat attendu

Au lancement :

```bash
npm install
npm start
```

Le terminal doit afficher quelque chose du type :

```text
Server running
Display:
https://192.168.1.100:3000/

Controller:
https://192.168.1.100:3000/controller
```

Le Mac ouvre :

```text
/
```

Les smartphones scannent le QR code qui mène à :

```text
/controller
```

Une fois les deux contrôleurs activés :

```text
Smartphone joueur 1
   ↓
Cube 1

Smartphone joueur 2
   ↓
Cube 2
```

Chaque cube reproduit en temps réel l’inclinaison et la rotation relative du smartphone associé.
