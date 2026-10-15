# LUNA

Modpack Fabric pour **Minecraft 26.2 et 26.1.2** : un maximum d'optimisations, un horizon à perte de vue grâce à **Voxy**,
de l'ambiance (sons, particules, nuages, lumières dynamiques), une sélection de packs de ressources et un thème
**LUNA** sur tous les menus.

![LUNA](branding/out/og.png)

Site : **https://luna-modpack.vercel.app** (sources : [LeVraiLunatix/luna-site](https://github.com/LeVraiLunatix/luna-site)).
Le contenu exact (mods, packs, shaders, versions) est dans [MODS.md](MODS.md), régénéré à chaque build.

## Éditions

| Édition | Fichier | Contenu |
|---|---|---|
| **LUNA** | `LUNA-<ver>+<mc>.mrpack` | tout : optimisations, Voxy, ambiance, packs de ressources, shaders, thème |
| **LUNA Lite** | `LUNA-Lite-<ver>+<mc>.mrpack` | optimisations, Voxy, cartes, Jade, REI, thème — sans packs, shaders ni mods d'ambiance |
| **LUNA Perf** | `LUNA-Perf-<ver>+<mc>.mrpack` | FPS d'abord : base Lite + particules/PNJ/génération allégées, sans gadgets (voice chat, cinématiques, Essential, REI…), sans shaders. Vidéo calibrée (distance 10, simulation 6, FPS illimités, AO coupée). Flags JVM et test Vulkan dans `LISEZMOI-PERF.txt` |
| **LUNA Vulkan** | `LUNA-Vulkan-<ver>+<mc>.mrpack` | LUNA Perf sur le moteur Vulkan natif (26.2+), préféré par défaut. Sans Voxy, Nvidium ni shaders (OpenGL uniquement). ~330 FPS mesurés contre ~113 en OpenGL (i5-10400F + RTX 5060, 1600×900) |
| **LUNA Server** | `LUNA-Server-<ver>+<mc>.zip` | serveur Fabric prêt à lancer (`start.bat` / `start.sh`) avec les mods utiles côté serveur |

Chaque édition existe pour chaque version de Minecraft déclarée dans `targets` de [pack.config.json](pack.config.json).
Les paquets sont publiés dans les [releases GitHub](https://github.com/LeVraiLunatix/luna-modpack/releases).

## Ce qu'il y a dedans

- **Optimisations** : Sodium, Lithium, C2ME, ScalableLux, FerriteCore, ModernFix, Nvidium, ImmediatelyFast,
  Entity Culling, MoreCulling, Better Block Entities, VMP, Ixeris, Gnetum, Particle Core… et Voxy pour le lointain.
- **Cartes et infos** : minimap et carte du monde Xaero (+ XaeroPlus), Jade, AppleSkin, compteur de jours
  au-dessus de la barre d'objets (les coordonnées sont sous la minimap).
- **Inventaire** : ClientSort (tri au clic molette) et Mouse Tweaks.
- **Ambiance** : Sound Physics Remastered, AmbientSounds, Presence Footsteps, Falling Leaves, Particle Rain,
  Wakes, Better Clouds, Subtle Effects, LambDynamicLights, 3D Skin Layers.
- **Packs de ressources** : Fresh Animations (+ extensions), Fresh Food, Better Leaves, Default Dark Mode,
  Fullbright UB… activés au premier lancement. Les moteurs qu'ils exigent sont inclus : EMF + ETF
  (Fresh Animations), Continuity (contours de NewGlowingOres), Respackopts.
- **Shaders** (désactivés par défaut) : BSL et Solas (qui affichent aussi le lointain de Voxy), Complementary
  Reimagined et Unbound, Bliss, MakeUp Ultra Fast. Sodium 0.9.1 + Iris 1.11.2 sont épinglés : avec 0.9.2 + 1.11.4,
  le terrain Voxy devenait du ciel dès qu'un shader était actif ([voxy#700](https://github.com/MCRcortex/voxy/issues/700)).
- **Confort** : REI (recettes), Freecam, Shoulder Surfing Reloaded, Simple Voice Chat, Flashback (vidéos).
- **Graves** : une tombe garde tes objets quand tu meurs (le mod active `keep_inventory` pour fonctionner).
- **Sona pour Minecraft** : le lecteur Sona en jeu (mod maison, sources dans `D:\Code\sona-minecraft`, builds
  livrés dans [vendor/](vendor) : 1.3.0 pour 26.2, 1.2.0 pour 26.1).
- **Thème LUNA** : logo, sous-titre « Beyond the horizon », splashs en anglais, panorama 3D réel capturé en jeu,
  boutons, curseurs, onglets et fonds de menus.

## Installer

1. Récupère le `.mrpack` de ton édition et de ta version de Minecraft (releases GitHub ou Modrinth).
2. Dans l'app Modrinth : **+ (Créer une instance) → Importer depuis un fichier** et choisis le `.mrpack`.
   Prism Launcher l'importe aussi.
3. Donne au moins **6 Go de RAM** à l'instance (4 Go pour Lite).

Au **premier lancement** d'une instance neuve, Default Options applique les réglages LUNA (packs de ressources
activés dans le bon ordre, distance de rendu 12, écran de chargement sombre). Ensuite tes réglages ne sont plus
jamais écrasés. Sur une instance qui existait déjà, active les packs à la main dans Options › Resource Packs.

Le thème LUNA existe en mod (toujours actif) et en pack « LUNA UI » placé en haut de la liste : il passe ainsi
devant les packs d'interface comme Default Dark Mode, qui restent appliqués partout ailleurs (inventaires…).

## Bien utiliser Voxy

Voxy ne « voit » que le terrain déjà chargé. Pour avoir tout l'horizon dès le départ dans un monde solo :

1. Prégénère le monde avec Chunky : `/chunky radius 1500` puis `/chunky start`.
2. Importe-le dans Voxy : `/voxy import world "<nom du monde>"`.

Garde une distance de rendu normale basse (8 à 12 chunks) : c'est Voxy qui dessine le lointain. Côté shaders,
seuls ceux qui supportent explicitement Voxy affichent les LOD.

## Identité visuelle

```bash
node branding/generate.mjs
```

Dessine le logo, le sous-titre, les sprites d'interface, les fonds, l'icône Modrinth et écrit les splashs, dans
`luna-ui/assets/` et `branding/out/`. Le panorama vient de `branding/panorama/` (capture réelle) ; si ce dossier
est vide, un panorama procédural est dessiné à la place.

### Recapturer le panorama 3D

Minecraft 26.2 sait capturer un vrai panorama (6 faces) quand on le lance avec les propriétés de debug
`MC_DEBUG_ENABLED` et `MC_DEBUG_PANORAMA_SCREENSHOT` :

```bash
node tools/test-launch.mjs --panorama
```

En jeu : place-toi (le regard donne la face d'ouverture de l'écran titre), cache l'interface avec F1, puis
**Ctrl+F2**. Les faces arrivent dans `.test/<mc>/instance-full/screenshots/` : copie-les dans `branding/panorama/` et relance
le générateur. Xaero est retiré pendant cette séance (sa minimap plante pendant la capture).
[tools/game-input.ps1](tools/game-input.ps1) permet d'envoyer des commandes au jeu depuis PowerShell
(utiliser des coordonnées absolues : `~` est une touche morte en AZERTY).

## Construire le pack

```bash
node build.mjs                              # toutes les versions × éditions + serveurs
node build.mjs --mc 26.2 --edition lite     # une seule combinaison
```

Le script résout chaque mod, pack et shader de [pack.config.json](pack.config.json) sur Modrinth (version épinglée
ou la plus récente pour la version de Minecraft visée ; épinglages par version dans `targets.<mc>.pin`), ajoute les dépendances, vérifie les hashs, contrôle les
`depends`/`breaks` de chaque `fabric.mod.json` (jars embarqués et mods maison compris), construit le mod et le pack
LUNA UI, écrit les réglages Default Options, puis produit les paquets dans `dist/` et `MODS.md`. Le pack serveur
ne garde que les mods compatibles serveur dont toutes les dépendances existent côté serveur.

```bash
node tools/check-versions.mjs --missing 26.3 26.2 26.1.2
```

Liste les mods absents d'une version de Minecraft : c'est ainsi qu'on saura quand Voxy arrive en 26.3 (une vérification
automatique tourne aussi chaque lundi sur GitHub).

### Publier une version

Mettre à jour `version` dans `pack.config.json`, écrire `modrinth/changelog-<version>.md`, puis :

```bash
git tag v1.3.0
git push origin v1.3.0
```

GitHub Actions construit tous les paquets et crée la release avec le changelog. Il reste à déposer les `.mrpack` sur
Modrinth (une version par fichier : `1.3.0+26.2`, `1.3.0+26.1.2`…).

### Tester pour de vrai

```bash
node tools/test-launch.mjs [--mc 26.1.2] [--edition lite]
node tools/test-launch.mjs --server --mc 26.2
```

Installe le pack dans une instance jetable (`.test/<mc>/`), génère un monde avec le serveur vanilla (triches activées),
lance le jeu en solo (compte hors ligne), vérifie qu'il charge le monde sans crash et capture l'écran.
`--menu` s'arrête sur l'écran titre et le capture dans `.test/screens/`. `--server` démarre le pack serveur jusqu'à « Done ».

## Publier sur Modrinth

Crée un projet de type **Modpack**, puis **Versions → Create a version** et dépose le `.mrpack` (loader Fabric,
version 26.2), avec `branding/out/icon.png` en icône. Pense à créditer et lier Voxy sur la page du projet, comme
son auteur le demande. Sona et LUNA UI sont des mods maison livrés dans le pack (overrides).

## Licence

© 2026 Lunatix — tous droits réservés (voir [LICENSE](LICENSE)). Le code et le thème LUNA UI sont publiés pour être
lisibles et vérifiables, pas pour être réutilisés. Les mods, packs et shaders tiers restent la propriété de leurs
auteurs et sont téléchargés depuis leurs pages Modrinth officielles.
