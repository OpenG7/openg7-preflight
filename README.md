# OpenG7 Preflight

> « C'est la plateforme qui doit avoir préparé mon travail avant mon arrivée. »

Preflight est le système transverse de préparation du travail de l’écosystème
OpenG7. Il reçoit des missions, analyse les besoins, organise les tâches, mobilise
des capacités IA, vérifie les résultats, identifie les exceptions et prépare des
propositions pour les personnes autorisées, indépendamment de leur présence.

**L’IA prépare. Les humains gouvernent. Les applications métier gardent l’autorité.**
Aucune publication, approbation commerciale ou opération financière n’est effectuée.

## Première version

Le monolithe modulaire possède une API Fastify, un worker indépendant, PostgreSQL,
une file pg-boss, des contrats Zod versionnés et une console Angular standalone.
Deux workflows utilisent le même moteur :

- `sponsorship-preparation-v1` : présentation Web à partir d’un engagement synthétique Funding.
- `editorial-brief-preparation-v1` : brief éditorial à partir d’un sujet synthétique Social.

Le parcours est réel : **API → PostgreSQL → worker → résultats → proposition → briefing**.
Les missions, tâches, résultats intermédiaires, propositions, lots et historiques
sont persistés. Le fournisseur par défaut est une **simulation déterministe**,
identifiée dans chaque brouillon; aucune inférence réelle n’est prétendue.
Funding, Social, Keycloak, le runtime et le model gateway ne sont pas raccordés.

## Démarrage local

Prérequis : Node.js **22.12+** (cible Node 22 LTS; Node 24 également compatible),
npm 10 ou plus et Docker avec Compose. PostgreSQL écoute uniquement sur loopback,
port 55432. La console utilise le port 4300, l’API le port 3000.

Depuis la racine :

```sh
npm ci
npm run setup
npm run infra:up
npm run db:migrate
npm run dev
```

`setup` crée `.env` sans écraser un fichier existant. `infra:up` attend que PostgreSQL
soit healthy avant les migrations. `dev` lance API, worker et
console; les processus peuvent aussi être lancés séparément avec `dev:api`,
`dev:worker` et `dev:web`.

Ouvrir **http://127.0.0.1:4300**. Dans un autre terminal :

```sh
npm run demo:submit
```

Ce script soumet deux missions explicitement synthétiques et attend leur état
`review_ready`. L’administratrice retrouve leurs résultats et propositions dans
le briefing. Répéter la commande réutilise les mêmes clés et démontre la
déduplication; `npm run demo:submit -- --run=autre-exemple` prépare de nouveaux dossiers.

La console permet de filtrer et inspecter les missions, consulter les résultats
et leur provenance, préparer des lots homogènes, exclure des dossiers, exporter
une sélection versionnée, reprendre ou annuler avec confirmation et consulter
les intégrations/politiques. Les exports restent des propositions.

L’authentification locale est activée explicitement par `.env.example` : identité
serveur `openg7-demo`, rôle administrateur et deux applications autorisées.
Elle exige `NODE_ENV=development` et une écoute loopback. Elle est refusée en
production. Pour un JWT signé et les claims attendus, voir [sécurité](docs/architecture/security-model.md)
et [connexion d’application](docs/connecting-applications.md).

## Commandes et vérifications

```sh
npm run typecheck
npm test
npm run test:integration
npm run test:standards
npm run check:standards
npm run build
git diff --check
```

Les tests d’intégration exigent `TEST_DATABASE_URL` et utilisent des schémas
temporaires dans la base de test dédiée, jamais une base métier. Le Compose neuf
crée `preflight` et `preflight_test`. Les tests unitaires restent utilisables sans
PostgreSQL; les intégrations se lancent séparément avec test:integration.

Pour les tests navigateur, avec PostgreSQL migré et les trois processus lancés :

```sh
npx playwright install chromium
npm run test:web
```

Le build serveur est dans `dist/`; le build Angular dans `apps/admin-web/dist/admin-web/browser/`.
`start:api` et `start:worker` exécutent les serveurs compilés avec `.env`.
Le Dockerfile compile le serveur sur Node 22; le profil Compose `full` exige une
configuration JWT réelle (l’authentification locale est interdite sur `0.0.0.0`).
Ce profil n’installe pas une identité ni une console de production.

Arrêter l’infrastructure locale sans effacer les données : `npm run infra:down`.

## Organisation

| Emplacement | Responsabilité |
| --- | --- |
| apps/api | HTTP, authentification, permissions et health checks |
| apps/worker | Processus autonome de traitement |
| apps/admin-web | Briefing et console Angular par fonctionnalités |
| packages/contracts | Enveloppes v1 et validation runtime |
| packages/engine | Modèle, service, planification, PostgreSQL et pg-boss |
| packages/ai | Port fournisseur, mock explicite et OpenAI Responses |
| packages/integrations | Ports futurs et inventaire des connexions |
| migrations | SQL versionné, suivi des checksums et verrou de migration |
| tests | Contrats, API, fournisseurs, moteur et persistance réelle |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) et [vision](docs/architecture/vision.md).
- [Contrats](docs/contracts.md) et [API HTTP](docs/api.md).
- [Ajouter un workflow](docs/adding-workflows.md) et [connecter une application](docs/connecting-applications.md).
- [Diagnostic](docs/troubleshooting.md) et [état vérifié, compatibilité et limites](docs/architecture/operational-readiness.md).
- [Consignes](AGENTS.md) et [standard commun OpenG7](docs/standards/README.md).

L’adaptateur OpenAI est activable uniquement avec clé, modèle, tarifs et accord
explicite dans la configuration. Les tests vérifient son contrat HTTP avec des
réponses synthétiques; aucun appel payant n’est lancé par la démonstration.

## English

OpenG7 Preflight prepares work before people arrive. This first executable version
uses a shared PostgreSQL-backed engine, an independent pg-boss worker, a Fastify
API and an Angular console for two workflows. It persists drafts, provenance,
review proposals, versioned batches and a real operational briefing. Demo sources
and the default AI provider are explicitly simulated. External applications and
centralized identity are not connected. Business authority remains with each
source application. See the documentation above for setup, validation and limits.
