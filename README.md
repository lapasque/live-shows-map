# Live Shows Map

Carte interactive des dates et salles de spectacle en France, au Benelux et en Suisse.

## Structure GitHub Pages

- `index.html` : page principale
- `assets/css/styles.css` : feuilles de style
- `assets/js/app.js` : logique JavaScript
- `data/artists.json` : liste des fichiers de données artistes
- `data/*.json` : données de chaque artiste
- `.nojekyll` : désactive le traitement Jekyll

Le site est publié depuis la branche `main`.

Pour ajouter un artiste, ajoutez son fichier JSON dans `data/` puis son nom de fichier dans `data/artists.json`. Le nom affiché dans la liste déroulante est lu depuis la propriété `name` du fichier de données.
