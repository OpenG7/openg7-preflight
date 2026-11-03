# Vérifications de la première version

Ce bilan décrit la version initiale. Les vérifications ultérieures du connecteur
Funding, de PKCE et de la stack VPS sont dans [le bilan dédié](validation-funding-vps.md).

Exécution locale du 2 novembre 2026. Windows/PowerShell, Node24.21.0,
Docker29.6.1 et PostgreSQL17.9. Les vérifications Node22 ont également été
exécutées dans l’image de construction Docker, sans fournisseur IA payant.

| Commande ou vérification | Résultat observé |
| --- | --- |
| npm install puis npm ci dans Docker | Lockfile npm utilisable, dépendances installées |
| npm run typecheck | TypeScript strict réussi |
| npm test | 21 tests réussis, aucun skip |
| npm run test:integration | 11 tests réussis, PostgreSQL et pg-boss réels, aucun skip |
| npm run test:standards | 10 tests réussis; comparaison LF/CRLF de fixture corrigée |
| npm run check:standards | Standard respecté, bloc commun conservé |
| npm run build | Serveur et Angular compilés |
| npm run test:web | 3 tests Chromium réussis après correction des noms accessibles mobiles |
| docker build --target build -t openg7-preflight:build . | Construction Node22 réussie |
| Tests compilés dans openg7-preflight:build | 32 tests unitaires/intégration réussis, aucun skip |
| Build Angular dans openg7-preflight:build | Réussi, 355,03kB initiaux |
| docker build --target runtime -t openg7-preflight:local . | Image serveur sans dépendances de développement, utilisateur node |
| npm audit --omit=dev | Aucune alerte au contrôle; 16 modérées dans le CLI de développement complet |
| npm run infra:up puis db:migrate | PostgreSQL healthy; migrations001/002 appliquées et seconde exécution sans changement |
| npm run dev | API3000, worker indépendant et console4300 lancés ensemble |
| npm run demo:submit puis répétition | Deux missions review_ready, cinq résultats et une proposition chacune; répétition dédupliquée |
| git diff --check | Vérification finale sans erreur |

## Parcours vérifié

La soumission HTTP crée mission, tâches et outbox persistantes. Le worker réclame
les travaux pg-boss, exécute les contrôles et le fournisseur déterministe, valide
et conserve les résultats, puis prépare une proposition. Le briefing lit ces
états PostgreSQL. Le navigateur vérifie inspection du brouillon et de sa
provenance, sélection de deux propositions compatibles, exclusion d’un dossier,
version suivante et export ne contenant aucune décision exécutée.

Funding et Social diffèrent par leur définition et leurs entrées. Ils partagent
le même DAG, service, ordonnanceur, worker, résultats, erreurs et briefing.

Les intégrations testent réception concurrente/idempotence, tenant et application
interdits, contrats métier invalides, désordre/version source, obsolescence des
lots, informations manquantes, annulation, reprise stop/start, retries, timeout,
réponse IA invalide non persistée, budget durable et rejet d’un résultat tardif
après abandon/reprise de bail. Les tests JWT utilisent des signatures éphémères,
pas une instance Keycloak réelle.

Le navigateur couvre aussi clavier et largeur mobile390px, absence de débordement
horizontal et erreur API avec reprise visible. Une inspection visuelle1920×1080
a permis de compacter l’activité et de supprimer la date initiale1969.

## Portée des preuves

Aucune CI distante, intégration Funding/Social, identité OpenG7 ou inférence
OpenAI réelle n’a été exécutée. Le profil Compose full attend une configuration
JWT réelle et n’est pas présenté comme testé contre une identité de production.
Les [limites opérationnelles](architecture/operational-readiness.md) restent
applicables; aucune garantie exactly-once externe n’est revendiquée.

Avant Funding réel : définir le contrat source/version, provisionner identité et
permissions de service, puis valider la remise des propositions et les contrôles
d’autorité dans Funding, notamment versions, concurrence et autorisations.
