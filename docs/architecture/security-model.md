# Sécurité

L’API vérifie les JWT signés avec issuer, audience, expiration et clés JWKS.
Keycloak peut fournir ces jetons; aucun realm OpenG7 réel n’est présumé configuré.
Le mapping des claims et les variables sont dans [le guide d’intégration](../connecting-applications.md).
En production, tout jeton portant un rôle humain doit attester `amr` contenant
`mfa`; une session SSO authentifiée seulement par mot de passe reçoit
`403 mfa_required`. `OIDC_REQUIRE_MFA=true` active aussi cette règle hors
production. Seule une identité portant exclusivement le rôle technique
`service_integration` est exemptée; un rôle humain supplémentaire rétablit
l’exigence MFA. Les permissions ne sont jamais déduites du nom ou de l’email.
Un profil JWT local peut exiger `amr` contenant `pwd` avec
`OIDC_REQUIRE_PASSWORD=true`. Un jeton humain sans cette preuve reçoit
`403 password_required`; le rôle technique seul reste exempté. Ce réglage
n’abaisse jamais l’exigence MFA de production et se cumule à celle-ci si les
deux contrôles sont activés.
La console démarre automatiquement Authorization Code/PKCE S256 à l’ouverture
lorsque le client public et l’URI de retour sont configurés côté serveur et que
l’API demande une session. Le fournisseur peut réutiliser sa session SSO du même
realm; chaque application conserve ses propres jetons et droits. oauth4webapi contrôle la réponse,
state et nonce; le vérificateur temporaire est à usage unique dans sessionStorage
avec une limite de dix minutes. Les jetons d’accès restent en mémoire et sont
vérifiés par l’API. Une saisie technique de JWT reste disponible. La déconnexion
locale efface le jeton; elle ne révoque pas une session chez le fournisseur.
Un marqueur sans jeton dans sessionStorage empêche les boucles de redirection
après échec, refus d’accès ou déconnexion volontaire. Une nouvelle tentative
explicite reste disponible; une session acceptée par l’API réarme la connexion
automatique au prochain chargement. Un refus MFA ou de droits n’entraîne aucune
nouvelle redirection automatique.
Après un refus MFA ou de preuve de mot de passe, la reprise explicite demande une nouvelle authentification
au fournisseur (`prompt=login`), afin de ne pas réutiliser la même session insuffisante.
Le profil du realm local Funding est vérifié avec des jetons signés et un
navigateur réel; la qualification d'un realm de production reste à effectuer.

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
des secrets gérés et une base privée. La stack dédiée `compose.production.yml`
impose le MFA humain et PostgreSQL TLS; le Compose par défaut reste local.

Entrées strictes, limites de corps/requêtes, pagination, erreurs expurgées, traces
d’accès et audit des interventions réduisent les surfaces d’abus. Les logs ne
contiennent ni corps de mission, ni clé IA, ni bearer. Les résultats peuvent
contenir des informations sources : limiter leurs entrées et prévoir rétention,
chiffrement, sauvegardes et habilitations selon les exigences réelles du tenant.

Preflight ne signe aucune décision commerciale. Les exports de lots sont des
documents de préparation : l’application source doit revalider autorisation,
version, concurrence et statut avant toute décision ou publication.
