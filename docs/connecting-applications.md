# Connecter une application

1. Convenir d’un contrat de mission v1 et de la correspondance objet/version source.
   Les entrées Funding/Social initiales sont synthétiques, pas leurs API existantes.
2. Provisionner une identité de service avec un tenant et les seules applications
   permises. Configurer AUTH_MODE=jwt, OIDC_ISSUER, OIDC_AUDIENCE et OIDC_JWKS_URL.
3. Envoyer les missions ou événements via [l’API](api.md), avec un identifiant
   d’événement stable. Réconcilier un timeout avant de renvoyer; un renvoi identique
   est accepté, un contenu différent sous la même clé est un conflit.
4. Notifier source.updated pour invalider les anciennes versions. Fournir les
   données nécessaires à une nouvelle mission ou aux informations manquantes.
5. Consulter les propositions ou exporter un lot versionné. La source revalide
   permission, version, statut, concurrence et consentements avant toute décision.
   Notifier ensuite /source-decision avec version et identifiant d’événement;
   cette notification n’exécute pas la décision.

Claims JWT signés requis (exemple synthétique, pas un jeton utilisable) :

```json
{
  "iss": "https://identity.example.invalid/realms/example",
  "aud": "preflight-api",
  "sub": "source-service-example",
  "iat": 1793660000,
  "exp": 1793660300,
  "tenant_id": "example-tenant",
  "applications": ["funding-platform"],
  "realm_access": { "roles": ["service_integration"] }
}
```

RS256 et ES256 sont acceptés. Les claims tenant_id et applications nécessitent
des mappers contrôlés dans l’identité réelle. Aucun en-tête client ne remplace
ces permissions signées. Keycloak/PKCE et les webhooks signés restent à raccorder.
La console conserve le JWT saisi en mémoire seulement, jusqu’au rechargement.

La production exige HTTPS pour issuer/JWKS et sslmode=verify-full pour PostgreSQL,
avec des identifiants non démonstratifs. Pour un transport sortant, implémenter
SourceApplicationAdapter avec idempotence, destinataire autorisé, signature,
audit et reprise. Aucune remise sortante automatique n’est activée dans la v0.1.

Sources inspectées : [inventaire](architecture/ecosystem-integration.md).

## Raccordement de Funding Platform

**État actuel :** les endpoints Preflight, le workflow Funding et les tests de
préparation existent. Le connecteur Funding, l’identité de service réelle et
l’import des propositions dans Funding ne sont pas livrés. Les démonstrations
actuelles soumettent des données synthétiques.

Le parcours ci-dessous est la cible du premier raccordement, par API HTTPS
authentifiée. Il ne définit aucune route supposée exister dans Funding.

```mermaid
sequenceDiagram
  participant F as Funding Platform
  participant P as API Preflight
  participant W as Worker Preflight
  participant H as Personne autorisée
  Note over F,P: Connecteur Funding à implémenter
  F->>F: Valider le changement métier et conserver sa livraison
  F->>P: POST /api/events : mission.submitted
  P-->>F: 202 + missionId, ou doublon 200
  W->>W: Préparer, contrôler et persister les résultats
  F->>P: Consulter mission, résultats et propositions
  P-->>F: Brouillon, provenance, version et conditions de revue
  H->>F: Examiner la proposition ou le lot préparé
  F->>F: Vérifier droits, version et règles; prendre la décision
  F->>P: POST /api/missions/:id/source-decision
  P-->>F: Suivi opérationnel clôturé
```

### Échanges disponibles côté Preflight

| Étape | Port Preflight existant | Travail côté raccordement |
| --- | --- | --- |
| Authentifier Funding | JWT vérifié, rôle service_integration, tenant et applications | Configurer l’identité; utiliser applications=[funding-platform] et le tenant autorisé |
| Confier une préparation | POST /api/events avec mission.submitted, ou POST /api/missions | Produire la mission versionnée et conserver eventId/missionId pour la reprise |
| Préparer le brouillon | sponsorship-preparation-v1, version1.0 | Fournir title, description et benefits depuis un snapshot validé par Funding |
| Consulter la préparation | GET /api/missions/:id et GET /api/proposals?application=funding-platform&status=prepared | Implémenter la lecture et l’import; le détail de mission fournit les résultats référencés par la proposition |
| Préparer une revue collective | API review-batches, exclusion et export versionnés | Réutiliser la sélection dans Funding avec contrôle de chaque dossier et des droits de l’appelant |
| Invalider un ancien travail | POST /api/events avec source.updated | Notifier la révision et soumettre au besoin une nouvelle mission; l’invalidation seule ne crée pas de nouvelle préparation |
| Fournir une information manquante | POST /api/missions/:id/input | Compléter une mission en attente; toute évolution du snapshot source doit aussi respecter son versionnement |
| Notifier une décision déjà prise | POST /api/missions/:id/source-decision | Envoyer sourceVersion, decision et eventId après validation et exécution autorisées dans Funding |

Le jeton technique reste dans le backend Funding. Preflight limite chaque accès
au tenant et aux applications du jeton; les deux systèmes gardent leurs propres
bases et responsabilités, même s’ils sont hébergés sur un seul VPS.

### Contrat de version à préciser

L’inspection ciblée du dépôt Funding le 2 novembre 2026 confirme que l’activation
des engagements est déjà vérifiée côté serveur dans sa transaction métier
(sponsorship-commitments/repository.ts et contributions-write.repository.ts,
sous apps/funding-api/src). C’est un point de déclenchement à raccorder, avec
enregistrement durable de l’intention d’envoi dans la transaction et livraison
réseau après commit, plutôt qu’un déclenchement depuis le navigateur.

Funding possède aussi une préparation et une approbation auditable propres dans
admin-preparation.service.ts et admin-dossier-preparation.http.ts. Le connecteur
devra utiliser ce domaine avec un contrat revu, sans transformer l’import d’une
proposition Preflight en approbation humaine automatique. Ses mécanismes d’effets
différés/idempotents de notifications constituent une référence à examiner, pas
une liaison Preflight déjà disponible.

L’inspection de Funding montre des versions numériques d’engagement, mais aussi
des empreintes et horodatages textuels pour certaines préparations/publications.
Preflight exige actuellement source.version entier positif et croissant pour
l’objet analysé. Le raccordement doit définir quel snapshot métier fait foi et
comment lui associer cette révision; l’identité d’un engagement, une empreinte
de préparation et une version de publication ne sont pas interchangeables.

Une modification de la source peut rendre une proposition obsolète après sa
consultation ou son export. Funding doit donc revalider son snapshot courant au
moment de la décision, même si Preflight affichait review_ready auparavant.

### Fiabilité et autorité

Funding devra conserver l’intention d’envoi dans la même transaction que le
changement métier, puis effectuer les appels réseau après commit avec reprises
et clés d’événement stables.
L’outbox interne de Preflight fiabilise ses propres tâches; elle ne garantit pas
qu’un changement Funding a effectivement été transmis. En cas de timeout, le
connecteur pourra renvoyer la même mission avec le même eventId : une réception
identique retourne le même missionId, un contenu différent provoque un conflit.

Pour cette première liaison, Funding peut lire les propositions à travers les
endpoints existants. Cette boucle de lecture et son suivi restent à construire;
aucun webhook sortant ni implémentation de deliverProposal ne pousse actuellement
les résultats vers Funding. Les signatures et garanties de tout futur transport
sortant devront être définies avec l’application propriétaire.

La proposition rassemble les contrôles et le brouillon, pas une autorisation de
publier. Funding conserve ses vérifications d’éligibilité, droits, consentements,
concurrence et publication. source-decision enregistre une décision déjà prise
par la source; cette route n’approuve ni ne publie à sa place.

Le [suivi des travaux restants](architecture/operational-readiness.md#raccorder-funding-platform)
fixe les livraisons et critères de recette du raccordement.
