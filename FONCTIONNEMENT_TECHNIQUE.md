# Fonctionnement Technique

Ce prototype permet a deux smartphones de piloter deux cubes 3D affiches sur un Mac.

L'idee generale est simple :

```text
smartphone
  -> lit l'orientation du telephone
  -> envoie les angles au serveur
  -> le serveur transmet au navigateur du Mac
  -> le cube correspondant tourne en 3D
```

## Les Trois Pieces

Le projet repose sur trois elements :

1. le serveur Node.js ;
2. la page principale sur le Mac ;
3. la page controleur sur smartphone.

## Serveur Node.js

Le fichier principal est :

```text
server.js
```

Il fait plusieurs choses :

- il lance un serveur HTTPS local ;
- il sert les fichiers HTML, CSS, JavaScript et images ;
- il genere le QR code ;
- il ouvre un serveur WebSocket ;
- il attribue automatiquement les joueurs ;
- il transmet les messages d'orientation aux pages connectees.

Les librairies principales sont :

```text
express
ws
qrcode
```

`express` sert les pages web.

`ws` gere la communication temps reel.

`qrcode` genere le QR code visible sur l'ecran du Mac.

## Pourquoi HTTPS

Les capteurs de mouvement sur smartphone, surtout sur iPhone, ne fonctionnent pas correctement sur une simple page HTTP.

Il faut donc une URL en :

```text
https://...
```

Le prototype cree automatiquement un certificat local dans :

```text
certs/
```

Ce certificat permet de lancer le serveur en HTTPS sur le reseau local.

Sur iPhone, Safari peut demander d'accepter le certificat ou refuser la page si le certificat n'est pas considere fiable.

## Page Mac

La page Mac est :

```text
public/index.html
```

Le code 3D est dans :

```text
public/js/display.js
```

Cette page affiche :

- deux cubes 3D ;
- un mur derriere les cubes ;
- un halo lumineux pour chaque cube ;
- un rayon doux emis depuis la face turquoise ;
- une araignee animee sur le mur ;
- le QR code pour connecter les smartphones ;
- l'etat des joueurs.

La 3D utilise :

```text
three
```

Three.js dessine les cubes, la lumiere, le mur, l'araignee et les animations dans un canvas WebGL.

## Page Smartphone

La page smartphone est :

```text
public/controller.html
```

Le code principal est :

```text
public/js/controller.js
```

La logique capteurs est separee dans :

```text
public/js/sensors.js
```

Quand un smartphone ouvre la page controleur :

1. il se connecte au serveur WebSocket ;
2. il demande un role ;
3. le serveur lui repond `joueur 1` ou `joueur 2` ;
4. l'utilisateur touche `DEMARRER` ;
5. le navigateur demande l'autorisation des capteurs si necessaire ;
6. le telephone commence a envoyer son orientation.

## Attribution Des Joueurs

Les roles ne dependent pas du type de telephone.

Le serveur applique uniquement cette regle :

```text
premier smartphone connecte  -> joueur 1
deuxieme smartphone connecte -> joueur 2
troisieme smartphone         -> session pleine
```

Donc toutes les combinaisons marchent :

- deux iPhone ;
- deux Android ;
- un iPhone et un Android.

Quand un smartphone se deconnecte, son slot est libere.

## Capteurs Smartphone

Le prototype utilise principalement :

```text
DeviceOrientationEvent
```

Le telephone fournit trois valeurs :

```text
alpha : rotation horizontale
beta  : inclinaison avant / arriere
gamma : inclinaison gauche / droite
```

Ces valeurs sont lues dans `sensors.js`.

Le code applique ensuite :

- une calibration ;
- une normalisation portrait / paysage ;
- un lissage leger.

## Calibration

Quand l'utilisateur touche `DEMARRER`, l'orientation actuelle devient le zero.

Exemple :

```text
telephone tenu naturellement
  -> DEMARRER
  -> cette position devient la position neutre
```

Ensuite, le cube suit les mouvements relatifs :

```text
orientation actuelle - orientation de depart
```

Le bouton `RECALIBRER` remplace simplement ce zero par la position actuelle.

## WebSocket

Le WebSocket permet une communication continue entre le smartphone, le serveur et le Mac.

Au lieu de recharger une page ou d'envoyer des requetes HTTP classiques, la connexion reste ouverte.

Un smartphone envoie par exemple :

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

Le serveur ne stocke rien.

Il retransmet simplement le message a la page Mac.

## Rotation Des Cubes

La page Mac recoit les angles du telephone.

Ensuite `display.js` convertit ces angles en rotation Three.js :

```text
alpha / beta / gamma
  -> conversion
  -> rotation X / Y / Z du cube
```

La fonction importante est :

```text
phoneOrientationToThree(...)
```

Elle evite de disperser les corrections d'axes dans tout le code.

## Lumiere Et Araignee

Chaque cube possede une face turquoise.

Depuis cette face, le prototype dessine une lumiere douce vers le mur.

Techniquement, ce n'est pas une vraie simulation physique de lumiere. C'est un effet visuel compose de :

- nappes transparentes avec texture degradee ;
- halo circulaire sur le mur ;
- test de profondeur pour que le cube cache correctement le faisceau.

L'araignee vient de :

```text
images/spiderWalk.gif
```

Le GIF est decode frame par frame avec :

```text
gifuct-js
```

Cela permet de garder l'animation originale du GIF dans une texture Three.js.

L'araignee suit une trajectoire sur le mur. Son opacite depend de sa distance aux halos.

En clair :

```text
hors halo  -> invisible
dans halo  -> visible
```

## Debug

Le mode debug s'active avec :

```text
?debug=1
```

Exemples :

```text
https://ADRESSE_IP_DU_MAC:3000/?debug=1
https://ADRESSE_IP_DU_MAC:3000/controller?debug=1
```

Sur le Mac, il affiche notamment :

- FPS ;
- angles recus ;
- latence indicative.

Sur smartphone, il affiche :

- etat WebSocket ;
- joueur attribue ;
- orientation ecran ;
- valeurs capteurs.

## Tests Automatises

Le script de QA est :

```text
scripts/qa-playwright.mjs
```

Il se lance avec :

```bash
npm run qa
```

Il verifie :

- que la page Mac charge ;
- que le canvas WebGL n'est pas vide ;
- qu'un cube bouge apres reception d'un message ;
- que le GIF de l'araignee charge ;
- que les frames du GIF avancent vraiment ;
- que l'araignee devient visible sous halo ;
- que la page controleur tient sur mobile ;
- qu'il n'y a pas d'erreurs navigateur.

## Resume

Le prototype est donc une petite architecture temps reel :

```text
iPhone / Android
  -> capteurs web
  -> WebSocket
  -> serveur Node.js
  -> WebSocket
  -> Three.js sur le Mac
```

Il n'y a pas d'application native, pas de base de donnees, pas de compte utilisateur.

Tout sert une seule validation :

```text
peut-on utiliser deux smartphones comme controleurs gestuels temps reel pour piloter deux objets 3D sur un Mac ?
```
