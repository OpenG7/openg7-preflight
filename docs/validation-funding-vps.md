# Vérifications du raccordement Funding et de la préparation VPS

Campagne du **2 novembre 2026**, fuseau **America/Toronto**. Ces résultats
concernent les deux checkouts locaux et des environnements de test isolés.
Ils ne qualifient aucun VPS ni fournisseur externe de production.

## Résultats observés

| Commande ou recette | Résultat |
| --- | --- |
| Preflight : npm test | 31 tests réussis, aucun ignoré; les 5 tests d’infrastructure sont inclus dans ce nombre |
| Preflight : npm run test:integration | 12 tests PostgreSQL/pg-boss réussis, aucun ignoré |
| Preflight : npm run test:funding | 4 résultats Node réussis : le test conteneur et ses 3 sous-tests |
| Preflight : npm run test:web | 3 tests Chromium réussis, dernier rapport Playwright à l’état passed |
| Production locale : smoke-local.mjs --execute-local | 14 contrôles réussis, ressources jetables nettoyées |
| Funding : yarn test | Snapshot de la campagne avant les deux nouveaux cas de replay tardif : 7572 tests recensés, 7564 réussis, 8 ignorés, aucun échec |
| Funding : tests consumer ciblés après revue | 11 tests réussis, incluant les deux nouveaux cas de replay tardif |
| Funding : yarn build | Compilation TypeScript réussie |
| Funding : build Angular production | Réussi |
| Funding : yarn lint | Réussi; avertissement préexistant de directive eslint-disable inutilisée |
| Funding : yarn docs:check | Réussi |

Les huit cas ignorés de la suite Funding ne sont pas comptés comme vérifiés.
La suite complète Funding ci-dessus a précédé les deux ajouts de replay tardif;
la preuve postérieure est la suite consumer ciblée de 11 tests. Aucun résultat
d’une nouvelle suite complète de 7574 tests n’est revendiqué.
La suite navigateur utilise une pile dédiée sur les ports **4400/3400** et une
base de test explicite. Elle ne réutilise pas les services utilisateur sur
3000/4300. Ces ports restent distincts des paramètres habituels de développement.

## Parcours entre applications vérifié

La recette utilise une offre publique et un engagement synthétiques dans une
base Funding jetable. Elle appelle le vrai code d’activation Funding et le vrai
relais du connecteur, puis traverse les étapes suivantes :

1. Enregistrement de l’intention de soumission avec l’activation de l’engagement.
2. Obtention d’un jeton client_credentials auprès d’un fournisseur OAuth local
   de test, signé RS256 et vérifié par les clés JWKS locales.
3. Soumission HTTP authentifiée à l’API Preflight, avec tenant et application
   contrôlés, révision source et clé d’événement stable.
4. Persistance PostgreSQL et exécution par le worker commun pg-boss avec un
   fournisseur IA déterministe explicitement simulé.
5. Conservation des résultats et de leur provenance, puis récupération par le
   client Funding et import dans un état privé **proposed**.
6. Vérification d’une version source modifiée, de l’annulation et d’un refus
   d’accès pour un autre tenant (HTTP403).

Il s’agit d’une activation exécutée par le code réel sur des faits de paiement
**synthétiques**. Aucun paiement Stripe réel, approbation commerciale ou contenu
publié n’est produit par cette recette. L’import proposed ne vaut aucune
approbation et n’accorde aucune autorité métier à Preflight.

Les références fonctionnelles restent les [contrats](contracts.md),
l’[API](api.md) et le [guide de raccordement](connecting-applications.md).

## Reproduire les vérifications

Prérequis : versions Node et gestionnaires de packages des deux dépôts, Docker
local, dépendances installées et PostgreSQL de test disponible. Le gestionnaire
reste npm dans Preflight et Yarn4 dans Funding; aucun lockfile n’est partagé.

Depuis le checkout Funding qui contient le connecteur :

```sh
yarn install --immutable
yarn build
yarn test
yarn lint
yarn workspace @openg7/funding-web build --configuration production
yarn docs:check
```

Depuis la racine Preflight :

```sh
npm ci
npm run setup
npm run infra:up
npm test
npm run test:integration
npm run test:web
```

Le fichier .env ignoré doit définir TEST_DATABASE_URL vers une base de test
locale distincte; les tests navigateur refusent une cible qui ne correspond
pas à leur périmètre de test. Ne jamais utiliser une base métier existante.

Pour la recette entre dépôts, préciser le checkout Funding **déjà compilé**.
Exemple PowerShell avec le worktree isolé utilisé pour cette campagne :

```powershell
$env:FUNDING_CONNECTOR_ROOT = 'C:\GitHub\openg7-funding-preflight-connector'
npm run test:funding
```

Équivalent sur un shell Linux, avec le chemin réel du checkout construit :

```sh
FUNDING_CONNECTOR_ROOT=/path/to/funding-checkout npm run test:funding
```

FUNDING_CONNECTOR_ROOT sert uniquement au lanceur de recette : il charge les
modules Funding construits et ses outils de base jetable. **Aucun import d’un
checkout voisin n’est nécessaire au runtime des applications.** Le raccordement
déployé utilise des contrats versionnés et des appels HTTP authentifiés.

La reproduction du contrôle TLS et des images est détaillée dans le
[guide VPS](deployment-vps.md#recette-locale-jetable). La recette génère ses
propres secrets et certificats synthétiques, vérifie PostgreSQL chiffré et non
superuser, initialise réellement pg-boss, traite une mission avec un fournisseur
de fixture, vérifie le refus du trafic PostgreSQL clair et la réexécution des
migrations, puis retire uniquement ses propres ressources. Son rapport local
expurgé est .local/production-smoke-results.json.

La recette vérifie aussi les en-têtes X-Content-Type-Options: nosniff,
Referrer-Policy: no-referrer et X-Frame-Options: DENY sur la console (/), le refus
API non authentifié (/api/session, HTTP401) et la configuration OIDC publique
(/api/auth/config, HTTP200). Leur présence est contrôlée dans les réponses HTTP
réelles, après correction de l’héritage des add_header Nginx entre locations.

## Limites et raccordements restants

- Le DNS public, le proxy HTTPS existant, les certificats et le redémarrage du
  VPS n’ont pas été qualifiés sur une cible réelle.
- Aucun realm Keycloak réel ni secret de service OpenG7 n’a été utilisé. La
  recette OAuth/JWKS locale ne constitue pas une qualification du fournisseur
  d’identité de production ou de la connexion humaine à ce fournisseur.
- Aucun modèle IA payant n’a été appelé. Les résultats de la recette portent
  explicitement leur provenance simulée; modèle, tarifs et secrets réels restent
  à fournir et qualifier.
- Les points d’appel automatiques pour les décisions finales et les annulations
  dans tous les parcours métier Funding restent à raccorder et recetter. Des
  méthodes client/API testées ne prouvent pas que chaque transition métier les
  déclenche déjà. Les autorisations et versions doivent être revérifiées par Funding.
- Aucune sauvegarde/restauration de production n’a été exécutée; la procédure
  doit être qualifiée sur une cible autorisée avant exploitation.
- La livraison durable utilise reprises, idempotence et contrôles de version;
  aucune garantie **exactly-once sur les effets externes** n’est revendiquée.

Le [suivi opérationnel](architecture/operational-readiness.md#travaux-restants)
distingue le code livré des raccordements et recettes encore nécessaires.
