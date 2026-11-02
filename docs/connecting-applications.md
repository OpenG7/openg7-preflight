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
