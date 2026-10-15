# Format `.luna`

Un `.luna` est un **`.mrpack` augmenté** : le même zip, avec deux fichiers en plus à la racine — `luna.json` (ce qu'un
lanceur doit savoir pour installer et lancer le pack) et `icon.png` (le logo). Les lanceurs qui ne connaissent pas le
format les ignorent : renommé en `.mrpack`, un `.luna` s'importe tel quel dans Modrinth App ou Prism.

Produit par `node build.mjs` à côté de chaque `.mrpack` : `dist/LUNA-<Edition>-<version>+<mc>.luna`.

## Contenu de l'archive

| Chemin | Rôle |
|---|---|
| `luna.json` | Manifeste LUNA (ci-dessous) |
| `icon.png` | Logo, PNG 512×512 |
| `modrinth.index.json` | Index standard [.mrpack](https://docs.modrinth.com/modpacks/format) : liste des mods avec URL, `sha1`, `sha512`, taille |
| `overrides/` | Fichiers copiés tels quels dans l'instance (`mods/` locaux, `config/`, `resourcepacks/`…) |

## `luna.json`

```json
{
  "formatVersion": 1,
  "id": "luna-vulkan",
  "name": "LUNA Vulkan",
  "version": "1.3.2",
  "summary": "…",
  "edition": "vulkan",
  "minecraft": "26.2",
  "loader": { "id": "fabric", "version": "0.19.5" },
  "java": {
    "major": 25,
    "memory": { "min": "2G", "max": "6G" },
    "args": ["-XX:+UseZGC", "-XX:+ZGenerational"]
  },
  "graphics": { "preferredApi": "vulkan", "supportedApis": ["vulkan", "opengl"] },
  "icon": "icon.png",
  "index": "modrinth.index.json"
}
```

| Champ | Sens |
|---|---|
| `formatVersion` | Version du format. Un lanceur refuse une valeur qu'il ne connaît pas. |
| `id` | Identifiant stable de l'édition (`luna`, `luna-lite`, `luna-perf`, `luna-vulkan`), à utiliser pour reconnaître une instance déjà installée et la mettre à jour. |
| `name`, `version`, `summary` | Texte affiché. `version` est celle du pack, pas de Minecraft. |
| `edition` | `full`, `lite`, `perf` ou `vulkan`. |
| `minecraft` | Version de Minecraft. |
| `loader` | Toujours Fabric ; `version` est la version du Fabric Loader. |
| `java.major` | Version de Java minimale (25). |
| `java.memory` | `min` (`-Xms`) et `max` (`-Xmx`). À ajuster si la machine a moins de RAM que `max`. |
| `java.args` | Arguments JVM à ajouter tels quels (peut être vide). |
| `graphics.preferredApi` | `opengl` ou `vulkan` : l'API que le pack demande (déjà posée dans `options.txt` par Default Options). |
| `graphics.supportedApis` | APIs sur lesquelles le pack tourne. Hors de cette liste, il plante (Voxy, Nvidium et Iris exigent OpenGL). |
| `icon`, `index` | Chemins dans l'archive. |

## Installer un `.luna` (ordre conseillé)

1. Lire `luna.json` ; refuser si `formatVersion` est inconnu.
2. Créer l'instance : Minecraft `minecraft`, Fabric Loader `loader.version`, Java `java.major`, `icon.png` comme logo.
3. Télécharger chaque entrée de `files` dans `modrinth.index.json` (`downloads[0]`), **vérifier `hashes.sha512`**
   (ou `sha1`) avant de l'écrire à `path`, et refuser le fichier si le hash diffère.
4. Copier `overrides/` dans le dossier de l'instance, sans écraser les réglages que le joueur a déjà modifiés
   (`options.txt` est lu par Default Options seulement au premier lancement).
5. Appliquer `java.memory` et `java.args` au lancement.

Les chemins d'archive et de `path` sont relatifs à l'instance : rejeter tout chemin absolu ou contenant `..`.

## Évolution

Ajouter un champ est compatible. Retirer ou changer le sens d'un champ incrémente `formatVersion`.
