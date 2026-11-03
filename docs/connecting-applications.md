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
ces permissions signées. Le parcours console PKCE est livré; le realm Keycloak
réel et les webhooks signés restent à qualifier. Configurer ensemble
OIDC_BROWSER_CLIENT_ID et OIDC_BROWSER_REDIRECT_URI avec un client public, S256
et une URI/origine exactes. Le point public /api/auth/config ne retourne que ces
paramètres publics. Les jetons restent en mémoire, jusqu’au rechargement ou à
la déconnexion locale; les sessions de l’issuer ne sont pas révoquées par celle-ci.

La production exige HTTPS pour issuer/JWKS et sslmode=verify-full pour PostgreSQL,
avec des identifiants non démonstratifs. Pour un transport sortant, implémenter
SourceApplicationAdapter avec idempotence, destinataire autorisé, signature,
audit et reprise. Aucune remise sortante automatique n’est activée dans la v0.1.

Sources inspectées : [inventaire](architecture/ecosystem-integration.md).

## Raccordement de Funding Platform

**État actuel :** le connecteur est implémenté dans le dépôt Funding, dans un
module et un relais indépendants du moteur Preflight. Une recette locale teste
l’activation Funding, OAuth/JWKS signé, l’API et le worker Preflight, puis l’import
de propositions privées dans Funding. Le panneau administratif Funding les
présente en lecture seule. Les identités de service et connexions de production
restent à configurer et qualifier; l’IA de recette est explicitement simulée.

Le parcours utilise les contrats API v1. Les notifications de décision à la fin
restent à brancher aux actions métier Funding; aucune route Funding n’est inventée.

```mermaid
sequenceDiagram
  participant F as Funding Platform
  participant P as API Preflight
  participant W as Worker Preflight
  participant H as Personne autorisée
  Note over F,P: Connecteur testé localement; identité réelle à qualifier
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
| Authentifier Funding | JWT vérifié, rôle service_integration, tenant et applications | Client credentials livré; provisionner l’identité réelle et ses claims limités à funding-platform |
| Confier une préparation | POST /api/events avec mission.submitted, ou POST /api/missions | Outbox transactionnelle et relais livrés; activation désactivée par défaut |
| Préparer le brouillon | sponsorship-preparation-v1, version1.0 | title, description et benefits dérivés d’un snapshot minimisé dans Funding |
| Consulter la préparation | GET /api/missions/:id et GET /api/proposals?application=funding-platform&status=prepared | Lecture, validation, import privé et panneau administratif livrés |
| Préparer une revue collective | API review-batches, exclusion et export versionnés | Réutiliser la sélection dans Funding avec contrôle de chaque dossier et des droits de l’appelant |
| Invalider un ancien travail | POST /api/events avec source.updated | Réconciliation des sources suivies livrée; chaque mutation ne possède pas encore son propre événement transactionnel |
| Fournir une information manquante | POST /api/missions/:id/input | Compléter une mission en attente; toute évolution du snapshot source doit aussi respecter son versionnement |
| Notifier une décision déjà prise | POST /api/missions/:id/source-decision | Envoyer sourceVersion, decision et eventId après validation et exécution autorisées dans Funding |
| Annuler depuis la source | POST /api/missions/:id/cancel | Client livré; sourceVersion et eventId obligatoires pour le rôle service, branchement métier encore à définir |

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
Preflight exige source.version entier positif et croissant pour l’objet analysé.
Le connecteur utilise subjectType=sponsorship-commitment, l’identifiant de
l’engagement et une révision monotone propre à son snapshot observé. L’empreinte
sourceSnapshotDigest lie le contenu envoyé aux faits relus lors de l’import.
Cette révision n’est ni le digest d’approbation ni une version de publication.

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

Le relais Funding consulte les missions et importe les propositions après
revalidation des données courantes. Aucun webhook sortant ni implémentation de
deliverProposal ne pousse les résultats depuis Preflight. Une telle extension
devra définir ses signatures et garanties avec l’application propriétaire.

La proposition rassemble les contrôles et le brouillon, pas une autorisation de
publier. Funding conserve ses vérifications d’éligibilité, droits, consentements,
concurrence et publication. source-decision enregistre une décision déjà prise
par la source; cette route n’approuve ni ne publie à sa place.

Le [suivi des travaux restants](architecture/operational-readiness.md#raccorder-funding-platform)
fixe les livraisons et critères de recette du raccordement.
