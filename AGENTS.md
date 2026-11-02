# OpenG7 Preflight — consignes

## Mission

Construire le système transverse de préparation opérationnelle OpenG7 Preflight.
Il reçoit des missions, prépare des résultats et propositions vérifiables et
alimente un briefing persistant. L’IA prépare; les humains gouvernent; chaque
application source conserve ses règles et son autorité métier.

<!-- openg7:common:start -->

## Socle commun OpenG7

<!-- openg7-standard: 1 -->

- Respecter la mission du dépôt. Le code, les manifests et les tests décrivent
  l'existant; une architecture cible ou une roadmap ne prouve pas une livraison.
- Avant modification : `git status --short`, instructions des chemins concernés,
  code utile et équivalents existants. Préserver les changements de l'utilisateur.
- Lire uniquement les références déclenchées par le chemin ou le sujet traité,
  même pour un test ou un package. Chercher avec `rg`, lire la section utile;
  ne pas charger tout `docs/`, les registres ou les historiques par défaut.
- Réutiliser les contrats publics; éviter cycles, imports privés entre domaines,
  duplication métier et refactorisations étrangères à la demande.
- Ne placer aucun secret ni donnée privée inutile dans Git, sorties, logs, tests
  ou documentation. Exemples synthétiques; droits vérifiés côté serveur.
- Respecter l'autorisation déjà donnée et son périmètre. Préparer et vérifier les
  changements locaux autorisés; une demande de code n'autorise pas une opération
  de production, un envoi externe, une publication ou une destruction de données.
- Commit, push et ouverture de PR seulement dans le cadre demandé par l’utilisateur;
  une autorisation déjà donnée reste valable pour cette même opération et portée.
- Pour un effet externe : cible, droits, entrées/sorties, limites, idempotence,
  audit et reprise explicites. Réconcilier un résultat incertain avant de relancer.
- Choisir les validations selon le changement et les scripts réellement présents.
  Tester le comportement et les échecs pertinents; une modification documentaire
  seule ne déclenche pas les suites applicatives, les seeds ou un déploiement.
- Mettre à jour la référence propriétaire et les consommateurs d'un contrat dans
  le même changement. Les différences locales justifient une mission, une stack
  effective ou un risque métier; elles ne recopient pas le socle.
- Terminer par le diff, les contrôles applicables et `git diff --check`. Rapporter
  résultat, validations exécutées, limites et opérations restantes, sans faux succès.

<!-- openg7:common:end -->

## Périmètre local

- Node.js 22.12+, TypeScript strict, npm unique, Fastify, PostgreSQL/pg-boss;
  console Angular standalone. API HTTP et worker sont des processus indépendants.
- Contrats publics versionnés dans packages/contracts; orchestration générique
  dans packages/engine; fournisseurs dans packages/ai; ports dans packages/integrations.
- Toujours filtrer les opérations par tenant et applications autorisées. Valider
  permissions, version source et état avant mutation; auditer les interventions.
- Une proposition n’est jamais une approbation métier. Aucun paiement, publication
  externe ou accès en écriture aux bases des applications sources.
- Les simulations sont explicites dans les résultats et la console. Ne pas
  inventer de contrat d’intégration ni présenter un adaptateur non raccordé comme actif.
- Réception et traitements sont idempotents; effets externes au moins une fois
  avec contrôle explicite, sans promesse exactly-once. Préserver les résultats
  intermédiaires et bloquer les résultats devenus obsolètes.
- Conserver le bloc commun synchronisé; la mission et l’architecture sont locales.

## Lectures selon la tâche

<!-- prettier-ignore -->
| Déclencheur | Référence |
| --- | --- |
| Frontières et dépendances | [Architecture](docs/ARCHITECTURE.md) |
| Missions, tâches et reprise | [Moteur](docs/architecture/workflow-engine.md), [cycle de vie](docs/architecture/mission-lifecycle.md) |
| Contrats et intégrations | [Contrats](docs/contracts.md), [intégrations](docs/architecture/ecosystem-integration.md) |
| Authentification et isolation | [Sécurité](docs/architecture/security-model.md) |
| Budgets des consignes ou propagation du socle | [Standard](docs/standards/README.md), [manifest](scripts/sync-manifest.json) |
| CI ou dispatch | [Workflows](.github/workflows/README.md) |

## Validation

Documentation/gouvernance : `npm run check:standards` et `git diff --check`.
Code : `npm run typecheck`, `npm test`, `npm run build` selon la portée.
Persistance/reprise : `npm run test:integration`, avec une base PostgreSQL de test
distincte configurée par TEST_DATABASE_URL; ne jamais utiliser une base métier.

Outillage modifié : `node --test scripts/__tests__/standards.test.mjs`.

## Maintenance

Pour changer les consignes : [standard et budgets](docs/standards/README.md).
Mettre à jour contrats, migrations et documentation propriétaire ensemble.
Les migrations appliquées sont immuables; ajouter une migration versionnée.
