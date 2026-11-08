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
ces permissions signées. En production, les jetons humains doivent aussi contenir
`amr: ["pwd", "mfa"]` (au minimum la valeur `mfa` attestée par le fournisseur).
Un jeton valide sans cette preuve reçoit `403 mfa_required`. Hors production,
`OIDC_REQUIRE_MFA=true` active le même contrôle. Seul un jeton dont tous les rôles
Preflight reconnus sont `service_integration` est exempté; ajouter un rôle humain
réactive l’exigence MFA. Aucune valeur ACR arbitraire ne remplace cette preuve.
Pour le profil local explicitement sans MFA, `OIDC_REQUIRE_PASSWORD=true`
exige `amr` contenant `pwd` dans les jetons humains (`403 password_required`
sinon). Cette exigence additionnelle ne désactive jamais le MFA de production;
une valeur `OIDC_REQUIRE_MFA=false` reste refusée en production.
Le parcours console PKCE et le realm local Funding sont vérifiés; le realm
Keycloak de production et les webhooks signés restent à qualifier. Configurer ensemble
OIDC_BROWSER_CLIENT_ID et OIDC_BROWSER_REDIRECT_URI avec un client public, S256
et une URI/origine exactes. Le point public /api/auth/config ne retourne que ces
paramètres publics. Les jetons restent en mémoire, jusqu’au rechargement ou à
la déconnexion locale; les sessions de l’issuer ne sont pas révoquées par celle-ci.

Pour partager le realm `openg7` et les comptes Funding avec des clients et droits
distincts, suivre le [guide SSO du realm partagé](shared-realm-sso.md). Les rôles
Funding restent gérés dans Funding et ne deviennent pas des droits Preflight.

La production exige HTTPS pour issuer/JWKS et sslmode=verify-full pour PostgreSQL,
avec des identifiants non démonstratifs. Pour un transport sortant, implémenter
SourceApplicationAdapter avec idempotence, destinataire autorisé, signature,
audit et reprise. Aucune remise sortante automatique n’est activée dans la v0.1.

Sources inspectées : [inventaire](architecture/ecosystem-integration.md).

## Raccordement de Funding Platform

Le raccordement de l’Atelier utilise le client HTTP v1 de Funding et un registre
transactionnel des changements source. Le relais backend conserve une mission
stable, observe ses résultats et importe une proposition privée après revalidation.
L’adoption humaine alimente les brouillons Funding existants, sans approbation
ni publication. Son contrat et ses conditions d’activation sont décrits dans
`docs/technical/publication-workshop.md` du checkout Funding.

L’inspection du 8 novembre 2026 a constaté que les anciens bilans décrivaient un
connecteur absent du checkout Funding disponible; ce raccordement remplace ces
références. L’activation reste explicite et désactivée par défaut. Les identités,
les connexions de production et une inférence IA réelle restent à qualifier.

Le parcours utilise les contrats API v1. Les notifications de décision à la fin
restent à brancher aux actions métier Funding; aucune route Funding n’est inventée.

```mermaid
sequenceDiagram
  participant F as Funding Platform
  participant P as API Preflight
  participant W as Worker Preflight
  participant H as Personne autorisée
  Note over F,P: Activation explicite; identité réelle à qualifier
  F->>F: Valider le changement métier et conserver sa livraison
  F->>P: POST /api/events : mission.submitted
  P-->>F: 202 + missionId, ou doublon 200
  W->>W: Préparer, contrôler et persister les résultats
  F->>P: Consulter mission, résultats et propositions
  P-->>F: Brouillon, provenance, version et conditions de revue
  H->>F: Examiner la proposition ou le lot préparé
  F->>F: Vérifier droits, version et règles; prendre la décision
  opt Notification ultérieure à raccorder aux décisions Funding
    F->>P: POST /api/missions/:id/source-decision
    P-->>F: Suivi opérationnel clôturé
  end
```

### Échanges disponibles côté Preflight

| Étape | Port Preflight existant | Travail côté raccordement |
| --- | --- | --- |
| Authentifier Funding | JWT vérifié, rôle service_integration, tenant et applications | Client credentials livré; provisionner l’identité réelle et ses claims limités à funding-platform |
| Confier une préparation | POST /api/events avec mission.submitted, ou POST /api/missions | Outbox transactionnelle et relais livrés; activation désactivée par défaut |
| Préparer le brouillon | sponsorship-preparation-v1, version1.0 | editorialContext optionnel, contenu commun et déclinaisons Web/Facebook; anciennes entrées v1 compatibles |
| Consulter la préparation | GET /api/missions/:id et GET /api/proposals?application=funding-platform&status=prepared | Retour privé contrôlé puis adoption humaine dans les brouillons Funding |
| Préparer une revue collective | API review-batches, exclusion et export versionnés | Réutiliser la sélection dans Funding avec contrôle de chaque dossier et des droits de l’appelant |
| Invalider un ancien travail | POST /api/events avec source.updated | Changements pertinents capturés transactionnellement puis réconciliés; anciennes propositions conservées comme obsolètes |
| Fournir une information manquante | POST /api/missions/:id/input | Compléter une mission en attente; toute évolution du snapshot source doit aussi respecter son versionnement |
| Notifier une décision déjà prise | POST /api/missions/:id/source-decision | Envoyer sourceVersion, decision et eventId après validation et exécution autorisées dans Funding |
| Annuler depuis la source | POST /api/missions/:id/cancel | Client livré; sourceVersion et eventId obligatoires pour le rôle service, branchement métier encore à définir |

Le jeton technique reste dans le backend Funding. Preflight limite chaque accès
au tenant et aux applications du jeton; les deux systèmes gardent leurs propres
bases et responsabilités, même s’ils sont hébergés sur un seul VPS.

### Version source et snapshot

L’activation des engagements est vérifiée côté serveur dans sa transaction métier.
La migration additive de l’Atelier conserve les changements pertinents dans cette
transaction. Le relais prépare puis envoie les missions après commit; l’ouverture
de l’onglet ne crée pas de mission. Les reprises conservent les identifiants et le
contenu immuable de l’envoi.

Funding conserve sa préparation administrative et son examen par prestation.
L’import de proposition reste privé. L’adoption vérifie la source courante et les
brouillons manuels; la revue, l’autorisation et l’exécution restent des opérations
Funding distinctes, soumises à leurs contrôles existants.

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

Funding conserve l’intention d’envoi dans la transaction du changement métier,
puis effectue les appels réseau après commit avec reprises et clés stables.
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
