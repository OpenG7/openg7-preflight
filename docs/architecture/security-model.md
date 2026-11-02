# Sécurité

L’API vérifie les JWT signés avec issuer, audience, expiration et clés JWKS.
Keycloak peut fournir ces jetons; aucun realm OpenG7 réel n’est présumé configuré.
Le mapping des claims et les variables sont dans [le guide d’intégration](../connecting-applications.md).
La console conserve le jeton saisi uniquement en mémoire; elle ne fournit pas
encore le parcours OIDC Authorization Code/PKCE d’une connexion centralisée.

| Rôle | Portée |
| --- | --- |
| viewer | Consulter missions, résultats, propositions et briefing autorisés |
| operator | Préparer des lots, reprendre, compléter ou annuler une mission |
| administrator | Opérations et audit de son tenant, sans pouvoir métier externe |
| service_integration | Soumettre événements et notifier les décisions prises à la source |

Toutes les opérations filtrent tenant **et** applications autorisées. Une identité
ne choisit pas son tenant dans un en-tête client. Un rôle administrateur ne donne
pas accès à tous les tenants. Les événements sont authentifiés et dédupliqués;
les notifications de décision ne sont acceptées que de l’identité source habilitée.

Le mode `development` exige explicitement un environnement de développement et une
écoute sur loopback. L’identité de démonstration vient de la configuration serveur.
Ce mode est refusé en production. Le déploiement réel nécessite des JWT vérifiables,
des secrets gérés et une base privée; le Compose fourni est exclusivement local.

Entrées strictes, limites de corps/requêtes, pagination, erreurs expurgées, traces
d’accès et audit des interventions réduisent les surfaces d’abus. Les logs ne
contiennent ni corps de mission, ni clé IA, ni bearer. Les résultats peuvent
contenir des informations sources : limiter leurs entrées et prévoir rétention,
chiffrement, sauvegardes et habilitations selon les exigences réelles du tenant.

Preflight ne signe aucune décision commerciale. Les exports de lots sont des
documents de préparation : l’application source doit revalider autorisation,
version, concurrence et statut avant toute décision ou publication.
