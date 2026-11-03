# Préparer le déploiement VPS

Cette procédure prépare le déploiement; aucune exécution sur un VPS n’est incluse
dans les vérifications locales. Les adresses, identités, certificats et secrets
réels doivent être fournis par l’exploitant avant une recette de préproduction.
Le [suivi opérationnel](architecture/operational-readiness.md#travaux-restants)
reste la référence des raccordements non qualifiés.

## Topologie

```mermaid
flowchart LR
  Browser[Navigateur] --> Gateway[Proxy HTTPS existant]
  Funding[Backend Funding] --> Gateway
  subgraph Preflight
    Gateway --> Web[Angular statique / Nginx]
    Web --> API[API JWT]
    API --> DB[(PostgreSQL privé TLS)]
    Worker[Worker autonome] --> DB
    Migrator[Migration ponctuelle] --> DB
  end
  Worker --> Provider[Fournisseur IA configuré]
  API --> Identity[Issuer et JWKS OIDC]
```

[compose.production.yml](../compose.production.yml) est autonome : il ne fusionne
pas les identifiants, le mock ou NODE_ENV=development du Compose local. Le service
web publie uniquement `127.0.0.1:8087`; API et PostgreSQL n’ont aucun port hôte.
Le proxy HTTPS existant assure l’accès public. La stack ne réserve ni 80 ni 443
et ne modifie pas le déploiement Funding.

Pour un Traefik déjà conteneurisé, [compose.traefik.yml](../compose.traefik.yml)
attache seulement le web au réseau externe de la passerelle. Le nom de ce réseau,
l’hôte public, l’entrypoint TLS et le resolver doivent correspondre à la
configuration réellement présente; aucune configuration OpenG7 n’est présumée.
Le web partage le réseau de l’API et n’est pas attaché au réseau PostgreSQL.
Nginx réinterroge le DNS Docker pour suivre le remplacement d’un conteneur API.

## Configuration et fichiers protégés

Copier [production.env.example](../infrastructure/production/production.env.example)
hors du checkout, par exemple dans le répertoire de configuration de l’exploitant.
Ce fichier contient uniquement des paramètres publics et des chemins de secrets.
Remplacer les valeurs `replace-with-*` et `example.invalid`.

| Élément | Contrat |
| --- | --- |
| Images | Tags de livraison explicites pour serveur et web, pas latest |
| PostgreSQL | Base preflight; compte bootstrap preflight_admin et compte applicatif preflight_app distincts |
| URL PostgreSQL | Fichier secret contenant l’URL avec sslmode=verify-full et sslrootcert=/run/secrets/postgres_ca |
| Certificat serveur | Chaîne signée par la CA fournie, SAN correspondant au nom PostgreSQL utilisé dans l’URL, clé correspondante non chiffrée pour le démarrage automatisé |
| Identité API | Issuer/JWKS HTTPS, audience et claims tenant/applications/rôles contrôlés |
| Identité console | Client public OIDC, Authorization Code avec PKCE S256, URI de retour HTTPS et origines exactes autorisées |
| Fournisseur | Clé en fichier secret, modèle compatible et tarifs explicitement vérifiés |

Pour réutiliser le realm Keycloak de Funding, préparer les clients et habilitations
avec le [guide du realm partagé](shared-realm-sso.md). Le contrôle API de production
exige une preuve `amr` contenant `mfa` pour les rôles humains, y compris après une
réutilisation SSO; un jeton portant uniquement `service_integration` suit le parcours
technique distinct. Les droits Funding ne deviennent jamais des droits Preflight.

Forme du contenu du fichier d’URL (valeur illustrative à remplacer, jamais à
enregistrer dans Git) :

```text
postgresql://preflight_app:URL_ENCODED_APP_PASSWORD@postgres:5432/preflight?sslmode=verify-full&sslrootcert=/run/secrets/postgres_ca
```

Le mot de passe de cette URL doit correspondre au fichier du compte applicatif.
Le mot de passe d’initialisation administrateur doit être différent. Les secrets
de l’application sont lus par l’utilisateur Node non privilégié (uid1000 dans
l’image construite) : régler les droits/ACL des fichiers hôtes pour cet accès,
sans les rendre lisibles à tous. Les fichiers administrateur et clé serveur sont
lus à l’initialisation PostgreSQL puis copiés dans son espace privé avec les
permissions requises. Les certificats CA sont publics, les clés restent privées.

Les secrets Compose sont montés en fichiers et accordés par service; une
installation Compose autonome ne constitue pas un coffre-fort chiffré. Protéger
le système de fichiers et les sauvegardes de l’hôte. Références officielles :
[secrets Compose](https://docs.docker.com/compose/how-tos/use-secrets/) et
[TLS PostgreSQL17](https://www.postgresql.org/docs/17/ssl-tcp.html).

L’initialisation des rôles et du mot de passe applicatif ne s’exécute que sur un
volume neuf. Une base existante ou une rotation de secret exige une opération
explicite et cohérente côté PostgreSQL, fichier d’URL et services; remplacer un
fichier seul ne change pas le mot de passe du rôle dans la base.

## Vérifications avant démarrage

Depuis la racine, avec le chemin du fichier de paramètres publics :

```sh
PREFLIGHT_CONFIG=/etc/openg7/preflight/production.env
node infrastructure/production/check-config.mjs --env-file "$PREFLIGHT_CONFIG"
docker compose --env-file "$PREFLIGHT_CONFIG" -f compose.production.yml config --quiet
```

Le contrôle Node ne contacte aucun service. Il vérifie notamment valeurs
requises, absence de secrets inline, correspondance URL/mot de passe, certificats,
clé, validité et nom DNS PostgreSQL. Il n’affiche ni valeurs ni chemins privés.
Il ne prouve pas les droits hôte, la disponibilité DNS, la révocation des
certificats, le fonctionnement de l’issuer ou l’accès réel au modèle.

Pour Traefik, vérifier aussi la composition complète :

```sh
docker compose --env-file "$PREFLIGHT_CONFIG" -f compose.production.yml -f compose.traefik.yml config --quiet
```

## Construction et lancement explicitement autorisés

Les commandes suivantes sont à exécuter sur la cible choisie uniquement après
autorisation de la livraison, vérification du volume concerné et sauvegarde.

```sh
docker compose --env-file "$PREFLIGHT_CONFIG" -f compose.production.yml build
docker compose --env-file "$PREFLIGHT_CONFIG" -f compose.production.yml up -d --wait
```

Ajouter `-f compose.traefik.yml` aux deux commandes si ce mode a été vérifié.
Le service migrate termine les migrations avant le démarrage API/worker. Un échec
de migration empêche leur démarrage. Les migrations appliquées sont immuables.
Les mises à jour exigent un nouveau tag, une sauvegarde et une vérification de
compatibilité; un retour applicatif ne doit pas annuler aveuglément une migration.

PostgreSQL utilise un compte applicatif non superuser. Ce compte possède les
objets qu’il crée et les droits CREATE nécessaires aux migrations et à
l’initialisation/maintenance du schéma pg-boss dans la seule base Preflight.
Ce modèle n’est pas une séparation stricte entre propriétaire de migrations et
runtime sans DDL; un tel durcissement doit tenir compte des fonctions et
partitions gérées par pg-boss, puis faire l’objet d’une recette dédiée.

## Santé et continuité

Les services longs possèdent `restart: unless-stopped`; Docker doit lui-même
être démarré par le système du VPS. Cette politique couvre la sortie du processus
et le redémarrage de l’hôte, pas un simple statut unhealthy.

- PostgreSQL : disponibilité locale, puis connexion TLS vérifiée par l’API.
- API : health check interne /health/ready avec accès aux tables requises.
- Web : serveur statique et contrôle /healthz; les routes /health de l’API ne
  sont pas publiées par Nginx.
- Worker : battement récent produit après vérification PostgreSQL; son absence
  signale une défaillance à la supervision. Ce contrôle ne certifie pas la
  disponibilité d’un fournisseur IA ou l’absence d’un travail lent.

Les limites de mémoire/CPU fournies sont des plafonds initiaux à ajuster aux
ressources et à la charge mesurée du VPS. Les logs Docker tournent avec une
limite de taille; Nginx exclut les query strings, notamment les codes OIDC.
L’API ne fait pas confiance aux en-têtes d’adresse client du proxy : son limiteur
actuel voit le proxy comme un appelant commun. Ajuster le plafond et le contrôle
de trafic à la passerelle; ne pas activer une confiance proxy globale non vérifiée.

Sauvegarder la base avec pg_dump, chiffrer et conserver une copie hors du VPS,
puis tester la restauration sur une base jetable. Aucun script de cette livraison
ne restaure ou ne supprime automatiquement une base existante. Une restauration
réelle exige cible, arrêt des écritures, sauvegarde préalable et plan de retour.

## Recette locale jetable

Avec Docker local, OpenSSL et les images de test construites :

```sh
docker build -t preflight-vps-smoke:server .
docker build -f infrastructure/production/Dockerfile.web -t preflight-vps-smoke:web .
node infrastructure/production/smoke-local.mjs --execute-local
```

Le script utilise uniquement un projet Compose au nom unique, un volume neuf,
une CA et des secrets synthétiques dans .local. Il ne lance pas le worker
configuré pour un fournisseur réel. Il peut exercer le moteur dans un processus
de fixture avec un fournisseur explicitement simulé afin de vérifier les droits
pg-boss et la persistance. Ses propres conteneurs, volume et fichiers temporaires
sont retirés à la fin; un échec de nettoyage est signalé et les fichiers sont
conservés pour une reprise ciblée. Le rapport sans secret est dans
`.local/production-smoke-results.json`.

Cette recette ne qualifie ni Traefik/DNS publics, ni une identité Keycloak réelle,
ni un fournisseur IA réel, ni un redémarrage du VPS, ni une restauration de
production. Les preuves obtenues doivent rester distinctes de ces raccordements.
