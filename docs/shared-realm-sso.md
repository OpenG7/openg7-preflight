# Partager le realm Funding avec Preflight

Funding et Preflight peuvent partager le realm Keycloak `openg7` et ses comptes.
La session SSO reste chez Keycloak. Funding garde sa session serveur et ses droits
métier; Preflight reçoit son propre jeton, limité à son tenant et ses applications.
Un propriétaire Funding ne devient pas administrateur Preflight automatiquement.

## Prérequis et portée

Le dépôt Funding possède le realm et le flux navigateur `openg7-browser-sso`.
Ce flux réutilise une session SSO admissible; autrement, le sous-flux dédié
`openg7-sso-password-otp` exige mot de passe et OTP. Le MFA doit être réellement
attesté dans `amr`, y compris après réutilisation de la session, dans le profil
standard MFA. Le flux strict
`openg7-password-otp` est conservé et n'est pas modifié par la migration.
Consulter le guide
`docs/operations/keycloak-vps.md` et l'outil de migration SSO du dépôt Funding.
Un realm déjà présent n'est pas mis à jour par le seul remplacement du JSON Git.
Keycloak peut masquer les valeurs des références AMR dans ses réponses Admin API.
L'outil Funding crée donc le chemin SSO avec ses propres références natives
contrôlées, sans prétendre lire les valeurs masquées. Son résultat exige une
recette de connexion avec jetons signés, y compris lors d'une réutilisation SSO.

Preflight fournit [le provisionnement des clients](../infrastructure/identity/shared-realm.mjs)
dans ce realm existant. Il ne remplace ni ne réimporte le realm, ne change pas le
client administrateur Funding et n'accorde aucun droit aux comptes humains.
Le plan est en lecture seule par défaut. L'application exige `--apply` et refuse
un realm dont le flux navigateur actif n'est pas `openg7-browser-sso`.

Le modèle livré associe **un client console à un tenant et à une liste explicite
d'applications**. Ces valeurs sont définies par l'exploitant, pas dans des
attributs que l'utilisateur peut modifier. Les personnes auxquelles un rôle
Preflight est attribué reçoivent ce périmètre. Pour plusieurs tenants, utiliser
des clients/configurations distincts et des déploiements correspondants; cette
recette ne fournit pas de sélecteur de tenant ni de droits variables par personne.
Chaque audience et client est lié de façon immuable au tenant et à son périmètre
d'applications. Une audience ne peut pas être réutilisée pour un autre tenant ou
un autre périmètre : choisir aussi une audience distincte, afin que les rôles d'un
déploiement ne donnent pas accès à un autre. Les changements de périmètre exigent
une migration dédiée des clients et habilitations; l'outil les refuse.

## Clients et droits créés

| Objet | Configuration |
| --- | --- |
| `preflight-api` | Audience et conteneur de rôles dédiés; aucun flux interactif |
| `preflight-console` | Client public Authorization Code/PKCE S256, callback et origine HTTPS exacts, scope demandé `openid` |
| Rôles console | `viewer`, `operator`, `administrator`, à attribuer explicitement aux personnes habilitées |
| Rôle technique | `service_integration`, réservé au client de service optionnel |
| Claims console | `sub`, `tenant_id`, `applications`, `realm_access.roles`, audience Preflight et `amr` réel |

Le mapper de rôles ne lit que les rôles du client audience Preflight, jamais les
rôles globaux du realm. Le scope de la console n'inclut pas `service_integration`.
Les scopes par défaut et optionnels restent vides; l'outil détache les scopes
hérités ou ajoutés aux seuls clients qu'il gère via les endpoints dédiés. Les
mappers nécessaires sont propres aux clients. Un compte sans rôle Preflight conserve son accès Funding,
mais son jeton est refusé par Preflight.

## Préparer et examiner le plan

Copier [l'exemple public](../infrastructure/identity/shared-realm.example.json)
hors du dépôt et remplacer issuer, URL de retour, tenant et applications par la
cible autorisée. Les noms de clients peuvent être adaptés; ils doivent être
distincts du client administrateur Funding. Garder le même issuer HTTPS que
Funding. La console et le backend Preflight doivent tous deux pouvoir joindre
ce nom DNS avec un certificat valide.

L'outil utilise un jeton d'administration Keycloak fourni dans un fichier protégé,
hors du dépôt. Utiliser un accès limité aux opérations nécessaires dans le realm
visé : lecture du realm, gestion des clients/rôles/scopes et, si le service est
activé, gestion de ses seules attributions. Le jeton n'est accepté ni dans les
arguments ni dans le JSON public. Ne pas journaliser sa valeur ou les réponses
brutes de l'administration Keycloak.
Les fichiers de jeton et de secret doivent être réguliers, sans lien symbolique
et de 16 Kio maximum. Sous Unix, ils doivent être privés, par exemple en mode
`0600`; sous Windows, protéger leurs ACL. L'outil refuse également toute exécution
avec `NODE_TLS_REJECT_UNAUTHORIZED=0`, avant de contacter Keycloak.

```sh
npm run identity:realm -- --config /etc/openg7/preflight/shared-realm.json --admin-token-file /run/secrets/keycloak-admin-token
```

L'outil n'utilise que les modules intégrés de Node. Depuis le checkout Preflight,
il peut aussi être exécuté entièrement dans Docker, sans Node/npm sur l'hôte :

```sh
docker run --rm --read-only --user 1000:1000 \
  --mount "type=bind,source=$PWD,target=/workspace,readonly" \
  --mount type=bind,source=/etc/openg7/preflight,target=/etc/openg7/preflight,readonly \
  --mount type=bind,source=/run/secrets/keycloak-admin-token,target=/run/secrets/keycloak-admin-token,readonly \
  node:22-bookworm-slim node /workspace/infrastructure/identity/shared-realm.mjs \
  --config /etc/openg7/preflight/shared-realm.json --admin-token-file /run/secrets/keycloak-admin-token
```

Adapter les chemins hôtes et leurs ACL pour l'UID 1000; les chemins mentionnés
dans le JSON doivent aussi exister dans le conteneur. L'issuer HTTPS doit être
joignable depuis celui-ci. Cette commande prépare le même plan; `--apply`
reste nécessaire pour les écritures sur une cible autorisée.

Le résultat contient uniquement le realm, l'état `ssoReady` et les changements
prévus, sans jeton ni secret. `ssoReady` contrôle le nom du flux actif; ce n'est
pas une preuve que ses étapes et le fournisseur réel ont été qualifiés.
Examiner le fichier public et le plan ensemble. Activer les événements
d'administration Keycloak pour auditer l'intervention, sans enregistrer les
secrets dans les représentations d'événements.

L'outil refuse les collisions avec des clients existants qu'il ne gère pas,
les mappers étrangers, les rôles inattendus/composites et un scope de service
trop large. Il n'adopte pas automatiquement un client existant et ne le supprime
pas. Examiner une collision et choisir des identifiants dédiés avant de continuer.

## Appliquer sur une cible autorisée

Après migration du flux Funding, sauvegarde/export protégé de la configuration
existante et validation du plan :

```sh
npm run identity:realm -- --config /etc/openg7/preflight/shared-realm.json --admin-token-file /run/secrets/keycloak-admin-token --apply
```

Les écritures sont bornées aux clients gérés, à leurs mappers, aux rôles Preflight
et à leurs scopes. Après application, une nouvelle lecture vérifie la convergence.
Une répétition relit l'état et ne recrée pas les objets déjà
conformes. Les écritures Admin API sont indépendantes, pas une transaction globale.
En cas de timeout ou de réponse incertaine, l'outil s'arrête. Relancer d'abord
**sans `--apply`** pour réconcilier l'état avant toute nouvelle écriture. Conserver
les résultats d'intervention sans secrets. Aucun réimport écrasant, suppression
de compte/client/rôle, changement de mot de passe ni rotation de secret n'est effectué.

Attribuer ensuite, pour chaque subject Keycloak vérifié, le seul rôle humain
nécessaire dans le client audience Preflight. Ne pas utiliser une correspondance
automatique depuis les rôles métier Funding. Contrôler l'accès dans les deux
applications avec le même compte, puis le refus d'un compte sans rôle Preflight.

Configurer ensemble côté API :

```dotenv
AUTH_MODE=jwt
OIDC_ISSUER=https://auth.example.invalid/realms/openg7
OIDC_JWKS_URL=https://auth.example.invalid/realms/openg7/protocol/openid-connect/certs
OIDC_AUDIENCE=preflight-api
OIDC_BROWSER_CLIENT_ID=preflight-console
OIDC_BROWSER_REDIRECT_URI=https://preflight.example.invalid/
```

Les URL ci-dessus sont synthétiques. Utiliser exactement les valeurs du fichier
de provisionnement et le callback servi par la console. L'API exige une preuve
MFA pour les humains en production. Les [contrats JWT et permissions](connecting-applications.md)
restent autoritaires; aucune saisie de tenant ou de rôle côté navigateur ne les
remplace. Les déconnexions applicatives restent locales : cette livraison ne
garantit pas une déconnexion globale de toutes les applications.

## Développement localhost avec mot de passe seul

Quand le profil local Funding a été explicitement configuré avec
`FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY=true`, il possède son propre flux
navigateur de développement. Pour partager aussi cette session avec Preflight,
ajouter au fichier public :

```json
{
  "localPasswordSso": {
    "fundingClientId": "openg7-funding-admin",
    "flowId": "123e4567-e89b-12d3-a456-426614174000"
  }
}
```

L'UUID illustratif doit être remplacé par l'identifiant réel du flux déjà associé
au client Funding. L'option est acceptée uniquement avec l'issuer exact
`https://auth.openg7.test/realms/openg7` et un callback Preflight HTTPS dont le nom
est `localhost`, par exemple `https://localhost:8444/`. Aucun autre issuer, nom
d'hôte ou callback HTTP n'est accepté, même en mode de recette loopback.

Avant toute écriture, l'outil vérifie en lecture seule que le client Funding est
confidentiel, utilise un callback HTTPS localhost et référence déjà ce même flux.
Le flux doit porter le nom géré `openg7-local-password-only-` suivi du hash court
du client Funding, avec Cookie alternatif, mot de passe alternatif et OTP absent
ou désactivé. Seule la console Preflight reprend cet override; le client Funding
et les flux du realm ne sont pas modifiés par cet outil. La migration globale
vers `openg7-browser-sso` reste un prérequis. Le résultat indique explicitement
`authenticationProfile: "localhost_password_sso"`.

Le runtime Preflight local utilise `NODE_ENV=development`,
`OIDC_REQUIRE_MFA=false` et `OIDC_REQUIRE_PASSWORD=true`, afin de vérifier une
preuve de mot de passe réelle dans les jetons. La production conserve son
exigence MFA. Cette exception ne remplace pas le profil standard et n'attribue
aucun rôle humain supplémentaire. Le plan puis l'application emploient les mêmes
commandes que ci-dessus; une répétition conserve l'override local vérifié.

Pour revenir au profil MFA Preflight, retirer `localPasswordSso` du fichier public,
examiner le plan puis l'appliquer. L'outil efface explicitement les overrides du
client Preflight et vérifie que celui-ci réutilise le flux MFA du realm. Le client
Funding reste inchangé et son propre retour au MFA appartient à son outil local.
Réactiver `OIDC_REQUIRE_MFA=true` dans le runtime Preflight et vérifier une
nouvelle connexion complète; les anciennes sessions ne sont pas révoquées par
ce seul changement de configuration.

## Identité de service Funding optionnelle

Ajouter au JSON public un bloc de configuration dont le chemin est absolu :

```json
{
  "fundingService": {
    "clientId": "funding-preflight",
    "secretFile": "/etc/openg7/preflight/secrets/funding-preflight-client"
  }
}
```

Ce bloc complète les champs de l'exemple. Le secret, distinct du jeton
d'administration, contient au moins 32 caractères sans espace et reste dans le
fichier protégé. Le client est confidentiel, utilise `client_credentials` sans
flux navigateur, possède uniquement `service_integration` et reçoit
`applications: ["funding-platform"]`, même si la console autorise d'autres
applications. Aucune identité humaine n'hérite de ce rôle par ce provisionnement.
Une rotation d'un secret existant est refusée et nécessite une opération dédiée
coordonnée avec le backend Funding. Ce provisionnement ne déploie ni n'active un
connecteur métier et ne confère aucun droit de paiement ou de publication.

## Vérifications et limites

`npm run test:identity` teste le plan sans écriture, les scopes et refus,
l'idempotence, la reprise après réponse incertaine et l'isolation du service avec
des réponses Admin API synthétiques. La recette Keycloak Docker jetable est
distincte; aucune réussite locale ne qualifie le realm en service.
Le mode HTTP loopback du module est réservé à cette recette et n'est pas exposé
par la commande de provisionnement; la commande exige HTTPS avec TLS vérifié.

### Stack locale Docker avec le Funding existant

L'[overlay local](../compose.identity.local.yml) complète le Compose de base avec
migrations, API, worker et console compilée. Funding, son Keycloak et son HTTPS
local doivent déjà fonctionner. Cet overlay conserve le volume PostgreSQL
`openg7-preflight_preflight-data` et les données Preflight existantes. Son worker
utilise explicitement l'IA simulée; aucun fournisseur payant n'est activé.

Ce profil local conserve le choix explicite du mot de passe seul : l'API vérifie
`amr` contenant `pwd` avec `OIDC_REQUIRE_PASSWORD=true`, et ne demande pas le
MFA (`OIDC_REQUIRE_MFA=false`, `NODE_ENV=development`). Configurer auparavant
`localPasswordSso` pour reprendre le flux local Funding vérifié. Cette option
est limitée à HTTPS localhost; la configuration de production exige toujours MFA.

Copier [l'exemple public local](../infrastructure/identity/local-stack.env.example)
dans `.local/identity-local.env` sans remplacer un fichier existant. Adapter les
chemins vers la CA publique et les fichiers de certificat/clé `localhost` déjà
préparés par Funding; ne pas copier leur contenu dans Git. Sous Windows, les
chemins peuvent utiliser `C:/GitHub/...`. La clé serveur doit être lisible par
l'utilisateur Nginx du conteneur (UID 101) avec des droits hôte limités; seule la
CA publique est montée dans l'API via `NODE_EXTRA_CA_CERTS`.

Préparer le realm partagé et les habilitations comme décrit plus haut, avec le
callback exact `https://localhost:8444/`. Ne pas changer les URL ou les clients
Funding. Le port peut être adapté, à condition de changer aussi le callback dans
Keycloak et `PREFLIGHT_LOCAL_OIDC_REDIRECT_URI`.

Depuis la racine Preflight :

```sh
docker compose --env-file .local/identity-local.env -f docker-compose.yml -f compose.identity.local.yml --profile identity-local config --quiet
docker compose --env-file .local/identity-local.env -f docker-compose.yml -f compose.identity.local.yml --profile identity-local build preflight-api preflight-web
docker compose --env-file .local/identity-local.env -f docker-compose.yml -f compose.identity.local.yml --profile identity-local up -d --wait
```

Ouvrir **https://localhost:8444/**. Le certificat doit être reconnu par le
navigateur. Les health checks internes HTTP n'attestent pas cette confiance TLS;
vérifier aussi l'accès HTTPS réel et la découverte OIDC depuis l'API.

Utiliser uniquement le profil `identity-local`, sans `full`. Les services portent
des noms `preflight-*` : un service nommé `api` sur le réseau Funding entrerait en
collision avec son alias DNS existant. L'API Preflight rejoint le réseau
externe `openg7-edge` pour joindre `auth.openg7.test`. Le serveur Web rejoint aussi
ce réseau avec l'alias dédié `preflight.openg7.test`, afin que l'API Funding puisse
lire les propositions en HTTPS. La console publie son propre port TLS sur
loopback et ne modifie pas Traefik Funding. API, worker et base Preflight ne
reçoivent aucun nouveau port hôte par cet overlay.

Pour arrêter uniquement les processus Preflight ajoutés, en conservant les deux
bases et Funding :

```sh
docker compose --env-file .local/identity-local.env -f docker-compose.yml -f compose.identity.local.yml --profile identity-local stop preflight-web preflight-worker preflight-api
```

Ne pas utiliser `down -v`. Le fichier `.env` habituel n'est pas modifié par cette
configuration; le fichier local explicite est passé à chaque commande.

### Lecture des propositions depuis Funding local

Le menu Preflight de Funding consulte les propositions par son propre backend.
Cette lecture utilise l'identité de service optionnelle décrite plus haut,
limitée au tenant configuré et à `funding-platform`; aucun jeton humain Funding
n'est transféré au navigateur Preflight. Le rôle `service_integration` permet
aussi des opérations d'intégration : c'est le module de consultation Funding
qui borne ses appels Preflight à la lecture. Il n'approuve aucune proposition
et n'active pas le connecteur producteur.

Le certificat servi par `preflight-web` doit couvrir à la fois `localhost` et
`preflight.openg7.test`, avec la même CA locale déjà approuvée par Funding.
Un certificat qui ne couvre que `localhost` ne suffit pas pour l'appel entre
conteneurs. Avec mkcert déjà installé et cette CA vérifiée, générer un certificat
dédié dans un répertoire privé ignoré, puis adapter `PREFLIGHT_LOCAL_CERT_FILE`
et `PREFLIGHT_LOCAL_KEY_FILE` dans le fichier local explicite. Ne pas remplacer
les certificats Funding ni changer l'issuer `auth.openg7.test` ou le callback
console `https://localhost:8444/`. Ne pas désactiver la vérification TLS.

Dans le checkout Funding, l'overlay `docker-compose.preflight-inbox.yml`
complète les mêmes fichiers Compose que l'installation locale existante.
Configurer côté serveur les valeurs publiques suivantes et le chemin protégé
du secret du client de service, jamais sa valeur dans Git :

```dotenv
PREFLIGHT_INBOX_ENABLED=true
PREFLIGHT_URL=https://preflight.openg7.test:8443
PREFLIGHT_CONSOLE_URL=https://localhost:8444/
PREFLIGHT_TENANT_ID=example-tenant
PREFLIGHT_TOKEN_URL=https://auth.openg7.test/realms/openg7/protocol/openid-connect/token
PREFLIGHT_CLIENT_ID=funding-preflight-inbox
PREFLIGHT_CLIENT_SECRET_FILE=/absolute/private/path/funding-preflight-inbox-client
```

Remplacer le tenant et le client illustratifs par ceux du provisionnement
autorisé. Protéger le secret par ses droits hôte et le rendre lisible par l'UID
1000 de l'API. Sa source est montée en lecture seule. Au démarrage, l'overlay
copie sa valeur sans l'afficher dans un tmpfs privé de l'API : répertoire `0700`,
fichier `0400`, appartenant à cet UID. Cette copie est nécessaire notamment
avec Docker Desktop, dont les montages Windows peuvent présenter un mode
`0777` malgré les ACL privées de l'hôte. Elle disparaît à l'arrêt du conteneur.
Le backend conserve son contrôle strict du fichier privé. La CA publique déjà
montée par `docker-compose.identity.local.yml` reste dans `NODE_EXTRA_CA_CERTS`.

Depuis Funding, contrôler la composition sans afficher les variables privées :

```sh
docker compose --env-file .env -f docker-compose.yml -f docker-compose.local-tls.yml -f docker-compose.identity.yml -f docker-compose.identity.local.yml -f docker-compose.preflight-inbox.yml config --quiet
```

Cet overlay force `PREFLIGHT_ENABLED=false` et laisse
`PREFLIGHT_INBOX_ENABLED=false` par défaut. Activer explicitement la seule
consultation après provisionnement et vérification HTTPS. Sans activation,
Funding affiche le raccordement désactivé; une erreur de transport reste visible
et ne devient pas une liste vide. Cette zone lit les propositions disponibles
dans Preflight, sans import durable ni mutation d'un dossier Funding. Conserver
ce même overlay pour les recréations locales suivantes.

### Recette locale avec Keycloak réel

Prérequis : Docker local avec conteneurs Linux, Node compatible avec le dépôt,
OpenSSL et un checkout Funding contenant le flux SSO et son outil de migration.
Construire depuis le checkout Funding l'image de test si elle est absente :

```sh
docker build -f docker/keycloak/Dockerfile -t openg7-keycloak:26.8.0-local .
docker pull postgres:16-alpine
```

Depuis Preflight, en PowerShell (adapter le chemin du checkout Funding) :

```powershell
$env:PREFLIGHT_KEYCLOAK_SSO_TEST = '1'
$env:FUNDING_SSO_ROOT = 'C:\GitHub\openg7-funding-platform'
npm run test:identity:sso
```

Sous Linux, passer les mêmes variables à la commande. `PREFLIGHT_TEST_OPENSSL`
permet de préciser l'exécutable OpenSSL; le chemin Git for Windows est utilisé
par défaut sous Windows. La recette ne lit aucun `.env` ni realm existant. Elle
crée ses conteneurs, réseau et certificats synthétiques, publie uniquement des
ports loopback, puis retire ses propres ressources.

Elle vérifie une migration réelle du flux strict vers SSO par Admin API derrière
un endpoint HTTPS local avec CA vérifiée, sa répétition sans modification, les
deux sens Funding/Preflight avec le même utilisateur et le MFA conservé, l'API
Preflight avec JWKS réel, les droits distincts, le refus d'un compte non habilité,
l'identité de service, la correction des scopes hérités et la révocation de la
session SSO. Le transport HTTP navigateur est réservé au fournisseur jetable;
la qualification DNS/HTTPS et des comptes de l'installation réelle reste séparée.

`npm run test:web:oidc` vérifie séparément les redirections de la console,
les refus, la déconnexion locale et la reprise MFA avec un fournisseur synthétique,
sans PostgreSQL ni `.env`.

Vérification locale du 3 novembre 2026 : les deux scénarios Keycloak 26.8.0
(realm neuf et migration de realm existant) réussissent, ainsi que 53 tests
Preflight et 7 tests navigateur synthétiques. Les 15 tests de provisionnement
réussissent aussi sous Node 22 dans Docker, y compris les permissions Unix.
Les ressources des recettes jetables ont été nettoyées. La déconnexion globale
reste à raccorder.

### Installation localhost active

Le 3 novembre 2026, le realm local Funding existant a été raccordé à Preflight
après sauvegarde privée de sa base d'identité et vérification du catalogue de
sauvegarde. Les comptes existants, leurs mots de passe et leurs OTP sont conservés.
Le choix local du mot de passe seul est maintenu dans les deux applications :
Funding reste sur `https://localhost` et Preflight sur `https://localhost:8444/`.
Le compte propriétaire Funding vérifié a reçu explicitement le rôle administrateur
du tenant local Preflight; aucun rôle métier Funding n'est déduit automatiquement.

Un compte synthétique temporaire limité au rôle `viewer` a vérifié les deux sens
SSO sans nouveau formulaire, les signatures et preuves `pwd`, l'accès API Preflight,
le refus de l'audit administrateur et la connexion automatique de la console dans
un navigateur avec TLS vérifié. Le callback Funding n'a pas été visité avec ce
compte de recette; aucune session métier synthétique n'a été créée dans Funding.
Le compte temporaire a été supprimé après le test. Les conteneurs Preflight sont
sains, l'IA reste simulée et aucune cible de production n'a été modifiée.
