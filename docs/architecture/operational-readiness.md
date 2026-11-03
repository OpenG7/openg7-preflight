# Préparation opérationnelle v0.1

## Déploiement local

```mermaid
flowchart LR
  Browser[Navigateur :4300] --> Web[Angular dev server loopback]
  Web -->|proxy /api| API[API Node :3000 loopback]
  API --> PG[PostgreSQL Docker :55432 loopback]
  Worker[Worker Node indépendant] <--> PG
  Worker --> Provider[Mock explicite ou fournisseur configuré]
```

Commandes : [README](../../README.md). Compose démarre PostgreSQL avec volume
persistant et health check. Dockerfile construit le serveur Node22. Le profil
full est optionnel et exige une identité JWT configurée; ce n’est pas une
installation de production. Appliquer les migrations avant le démarrage.

## Compatibilité retenue

| Élément | Choix et vérification |
| --- | --- |
| Node | Cible22.12+, tests locaux Node24.21; tests et builds Node22 dans Docker, CI configurée |
| TypeScript | 5.9.3 strict et noUncheckedIndexedAccess |
| Angular | 21.2.26, CLI/build21.2.29; [matrice officielle](https://angular.dev/reference/versions) Node22.12+ et TS5.9 |
| Fastify | 5.12.8, plugin rate-limit compatible Fastify5 |
| PostgreSQL | 17.9-alpine, image réellement lancée |
| pg-boss | 12.38.0; [prérequis officiels](https://github.com/timgit/pg-boss) Node22.12+, PostgreSQL13+ |
| Contrats | Zod4.6.7, enveloppes strictes version1.0 |
| Packages | npm unique et package-lock.json |

## Limites explicites

- Funding/Social : événements de démonstration, aucun raccordement réel.
- IA : mock par défaut; OpenAI testé par fixtures HTTP, pas par appel live.
- Identité : JWT vérifiés; Keycloak réel et connexion PKCE console non raccordés.
- Résultats : schéma et contrôles déterministes, pas de mesure universelle de vérité.
- Coût : réservations conservatrices et estimations, pas de facturation fournisseur.
- Lots : export préparatoire, aucune approbation ni remise sortante automatique.
- File : reprise durable, sans promesse exactly-once sur les effets externes.
- Exploitation : sauvegardes/restauration, rétention, chiffrement et supervision à qualifier.
- Dépendances : audit runtime initial sans alerte; 16 alertes modérées dans la
  chaîne CLI Angular21 de développement, sans correction majeure forcée.

Les preuves reproductibles sont dans [validation.md](../validation.md).
Une simulation réussie n’est jamais qualifiée de test de production.

## Travaux restants

Suivi initial du 2 novembre 2026. Les cases ci-dessous sont ouvertes : elles
décrivent les livraisons attendues, sans annoncer un déploiement ni un raccordement.

### Préparer le VPS

- [ ] **VPS-01 — Livraison production.** Ajouter un Compose de production avec
  API et worker indépendants, images identifiées, configuration hors dépôt et
  hébergement du build Angular. Configurer le proxy HTTPS et le routage /api.
  Critère : accès console/API sur le VPS avec NODE_ENV=production, sans serveur
  Angular de développement ni modification du socle des autres applications.
- [ ] **VPS-02 — Identité réelle.** Raccorder issuer, audience, JWKS et claims
  tenant/applications/rôles; livrer la connexion interactive OIDC/PKCE de la
  console et une identité de service Funding limitée à son périmètre.
  Critère : connexion humaine et appels de service vérifiés avec refus des
  mauvais rôles, tenants, audiences et applications.
- [ ] **VPS-03 — Persistance et secrets.** Configurer PostgreSQL privé avec TLS
  vérifié, comptes dédiés, secrets gérés et migrations exécutées lors de la
  livraison. Prévoir rétention et sauvegardes hors du VPS.
  Critère : restauration testée et données conservées après redémarrage;
  aucune valeur de démonstration utilisée en production.
- [ ] **VPS-04 — Fournisseur IA réel.** Configurer un modèle compatible, ses
  tarifs vérifiés, sa clé et l’activation explicite. Qualifier les sorties avec
  des exemples synthétiques et les limites de coût/temps.
  Critère : résultat réel avec provenance identifiable, schéma validé et
  échecs visibles; le mode mock reste refusé en production.
- [ ] **VPS-05 — Fonctionnement continu.** Ajouter les politiques de redémarrage,
  le suivi de santé du worker, les alertes sur erreurs/quarantaine et les limites
  de ressources. Organiser la collecte des métriques et des logs expurgés.
  Critère : reprise vérifiée après arrêt forcé et redémarrage du VPS, avec
  résultats déjà persistés préservés et erreurs consultables.
- [ ] **VPS-06 — Recette et mises à jour.** Tester une installation neuve, une
  mise à jour avec migrations et le retour à une version applicative compatible.
  Traiter ou justifier les alertes de dépendances de développement avant livraison.
  Critère : procédure reproductible documentée, preuves enregistrées et aucune
  prétention de haute disponibilité ou d’effet externe exactly-once.

### Raccorder Funding Platform

Le [parcours et les responsabilités](../connecting-applications.md#raccordement-de-funding-platform)
décrivent les échanges; les points ci-dessous suivent uniquement le travail restant.

- [ ] **FUNDING-01 — Contrat source.** Convenir du déclencheur métier, de l’objet
  analysé, du tenant et des données minimales. Définir la révision entière monotone
  attendue par Preflight et son lien avec le snapshot/les versions Funding;
  une empreinte ou un horodatage de préparation ne se recopie pas comme entier.
  Critère : contrat partagé revu et fixtures valides, invalides et obsolètes.
- [ ] **FUNDING-02 — Soumission durable.** Implémenter le connecteur Funding vers
  l’API Preflight, avec une intention d’envoi conservée dans la transaction
  métier et une émission réseau après commit, identifiants d’événement stables,
  reprises et rapprochement eventId/missionId.
  Réutiliser un mécanisme existant s’il fournit ces garanties; sinon prévoir
  une outbox transactionnelle et son relais.
  Critère : coupure réseau puis renvoi sans perte de mission ni préparation doublonnée.
- [ ] **FUNDING-03 — Changements source.** Transmettre les nouvelles révisions et
  les informations manquantes; définir le traitement des annulations et ses droits.
  Le rôle service_integration ne peut pas actuellement appeler /cancel, réservé
  aux opérateurs/administrateurs; cette frontière doit être traitée explicitement.
  Critère : un ancien résultat reste bloqué malgré le désordre des événements.
- [ ] **FUNDING-04 — Retour des préparations.** Implémenter la consultation
  authentifiée des missions/résultats/propositions et leur présentation dans
  Funding, avec curseur ou suivi durable adapté au contrat disponible.
  La première option est une lecture par Funding; une remise automatique par
  webhook ou par deliverProposal est une extension à livrer séparément.
  Critère : contenu, provenance, version et exceptions visibles sans import
  direct dans un état métier approuvé ou publié.
- [ ] **FUNDING-05 — Autorité et lots.** Raccorder la revue aux services de Funding;
  revérifier droits, version/snapshot, concurrence, statut et consentements pour
  chaque dossier, y compris dans un lot. Notifier ensuite la décision déjà prise
  à Preflight avec une clé d’événement stable.
  Critère : une proposition obsolète ou hors périmètre ne peut provoquer de
  décision, et Preflight ne publie ni ne prend de décision financière.
- [ ] **FUNDING-06 — Recette entre applications.** Vérifier les deux côtés avec
  identités réelles de préproduction, doublons, pannes réseau, versions changées,
  permissions refusées, annulation, reprise et lots partiellement exclus.
  Critère : preuves de bout en bout avant d’annoncer Funding comme connectée.
