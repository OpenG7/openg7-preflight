# Qualification du cycle des prestations — 18 novembre 2026

## Périmètre et état de la campagne

Parcours de référence : commandite synthétique de **500 CAD**, offre acceptée
OpenG7, avec une obligation Web, une Facebook et une LinkedIn. Les formats
sociaux de ce parcours sont les formats texte collectifs de l’offre courante.
Ce résultat ne qualifie pas les autres formats, cibles ou accords historiques.

Révisions de départ : Preflight `d61af15`, Funding `4842e5ea`, avec modifications
locales de la présente mission. Le plan de recette et ses liens étaient déjà
présents dans l’arbre de travail Preflight; ils ont été conservés. Aucun commit,
push, déploiement ou compte de production n’est inclus dans cette campagne.

**La recette distante a réussi : 1 scénario Chromium, aucun échec ni test
ignoré, en 78,2 s.** Elle prouve la continuité jusqu’aux envois sociaux simulés,
la preuve et l’acquittement Web locaux, puis la réconciliation des seules
obligations Facebook/LinkedIn restantes. Elle ne prouve pas une livraison sociale
réelle. La contre-vérification Funding sans Preflight a également réussi :
1 scénario Chromium en 44,3 s, aucun échec ni test ignoré.

Environnement : hôte Windows, Node `24.21.0`, Docker `29.6.1`. Les recettes Docker
utilisent leurs runtimes Node 22 et des PostgreSQL jetables. Les tests Preflight
ont utilisé un PostgreSQL `17.9-alpine` dédié, base contenant `test`, port hôte
loopback attribué dynamiquement et données en tmpfs. Ce conteneur a été retiré
après les tests. Les services de développement préexistants ont été préservés.

Les fournisseurs IA, paiement, courriels/SMS et réseaux sociaux sont simulés
dans les recettes. Le transport entre applications utilise leurs vraies API,
OAuth/JWKS signés locaux, PostgreSQL et workers. L’identité synthétique ne
qualifie pas un realm réel. La surface Web est l’application locale réelle.

## Ruptures reproduites et raccordements corrigés

1. **LinkedIn absent du snapshot Funding.** Un test PostgreSQL de commandite
   500 CAD exigeant les trois destinations échouait : seules Web et Facebook
   étaient présentes. Le filtre et le contrat du snapshot ont été étendus à
   LinkedIn. L’offre, les obligations et leurs versions restent propriétaires
   de Funding.
2. **LinkedIn refusé par Preflight.** Deux nouveaux tests du contrat et de la
   préparation échouaient avant correction avec `invalid_value`. Le contrat
   éditorial v1 accepte désormais LinkedIn, y compris la portée des médias;
   les entrées Web/Facebook existantes restent compatibles.
3. **Adoption sociale forcée sur Facebook.** Le raccordement Funding utilisait
   ce canal pour créer/réemployer un brouillon et enregistrer le résultat
   d’adoption. Il utilise désormais la destination exacte de l’obligation.
   Une vérification destination/obligation/version protège aussi l’adoption.
4. **Examen UI de la nouvelle destination.** Le libellé LinkedIn et l’affichage
   de son format social réutilisent le composant et les traductions existants.

Aucune migration, nouvelle architecture ou règle d’acquittement n’a été ajoutée.
L’adoption reste explicite et transactionnelle, conserve les modifications
manuelles et ne crée aucune autorisation, preuve ou livraison. Les corps
sociaux conservent la borne interne Funding de 2 500 caractères.
Déployer le contrat Preflight avant le producteur Funding émettant LinkedIn;
un consommateur ancien doit refuser une destination inconnue, sans la supprimer
ou la convertir silencieusement.

Le profil d’acceptation est une extension explicite du runner jetable Funding,
avec `--preflight-root`. Il ajoute une base Preflight privée, son API/worker et
un émetteur OAuth synthétique dans le projet Compose unique de la recette.
Les endpoints HTTP d’identité et de Preflight restent loopback dans l’espace
réseau de l’API Funding. Les contrôles TLS et d’authentification de production
restent inchangés. Les artefacts utilisateur `output/` et les rapports navigateur
sont exclus du contexte Docker Preflight.

## Matrice des douze étapes

Les chemins préfixés **Funding** sont relatifs à son checkout. Les tests de
services/fixtures prouvent les règles indiquées, sans remplacer une preuve de
parcours depuis Checkout. « Couvert dans les sources » et « exécuté » restent
deux constats distincts.

| Étape | Fonction existante / propriétaire | Entrée et contrat | Couverture automatisée | Résultat exécuté disponible | Lacune ou limite |
| --- | --- | --- | --- | --- | --- |
| 1. Commande et engagements acceptés | Funding : `public-payments.http.ts`, `sponsorship-commitments/offers.ts` | `GET /api/sponsorship-offer`, `POST /api/checkout-sessions`; version et empreinte d’offre serveur | Parcours partagé `sponsorship-publication-journey.ts`, helper `acceptance-offer.ts` | Formulaire et acceptation de l’offre 500 CAD exécutés dans le navigateur | Checkout fournisseur simulé; accord commercial réel non créé |
| 2. Confirmation serveur du paiement | Funding : webhook Stripe et persistance financière | `POST /api/stripe/webhook`; corps signé, identifiant dédupliqué, faits serveur corrélés | Checkout simulé et webhook signé de la recette 500 | Confirmation serveur, dossier et notifications du profil de test constatés; rejeu vérifié | Stripe réel non qualifié; retour navigateur seul sans autorité |
| 3. Obligations et versions | Funding : `contributions-write.repository.ts`, `sponsorship-commitments/repository.ts` | Activation transactionnelle à partir de l’offre figée; obligation par avantage/ordinal | Régression Atelier 500 et lectures du parcours navigateur | Trois obligations uniques de version 1 créées après paiement; Web passe ensuite en version 2 à l’acquittement | Aucun barème historique ni autre format qualifié par ce seul cas |
| 4. Renseignements, consentements, médias | Funding : suivi privé, gestion et revue média | `POST /api/sponsorship-followup/details` et `/media`; consentements/usages et versions | Parcours navigateur; intégrations preuves/médias | Formulaire, deux téléversements HTTP et revue admin exécutés; confidentialité avant visibilité contrôlée | Faits de consentement et usages synthétiques; aucun droit commercial réel qualifié |
| 5. Déclenchement Funding | Funding : `preflight/workshop-routes.ts`, `workshop.ts` | `POST /api/admin/sponsorships/publication-workshop/prepare`; contribution, version source et requête | 16 tests Node Atelier/API/client, 4 intégrations Atelier et recette distante | Clic UI observé, mission de révision source 5 reçue et suivie jusqu’à son résultat | Ne pas confondre cette révision avec la version de l’engagement |
| 6. Transport et worker Preflight | Funding : client/relais; Preflight : API, moteur et worker | OAuth `client_credentials`, JWT/JWKS; `POST /api/missions`, mission v1 | [Recette inter-dépôts](../tests/cross-repo/funding.integration.mjs), moteur PostgreSQL et navigateur distant | HTTP/OAuth/JWKS réels; cinq tâches terminées, une tentative chacune; provenance IA `mock` | Fournisseur IA et émetteur d’identité synthétiques |
| 7. Retour des propositions | Funding : `workshop.ts`, `workshop-proposal.ts` | Lecture des missions/résultats; tenant, source/version, empreinte, provenance et import privé | Intégrations Atelier/inter-dépôts et recette distante | Trois variantes Web/Facebook/LinkedIn courantes affichées dans Funding avec obligation/version exactes | Aucune autorisation ou livraison déduite de `review_ready` |
| 8. Examen et adoption humaine | Funding : routes Atelier, `workshop-adoption.ts` | `POST .../adopt`; proposition/version/requête; revue source et comparaison aux brouillons | Intégrations Atelier 500 et recette UI distante | Confirmation UI; résumé Web adopté et deux brouillons sociaux natifs reliés aux variantes, encore `draft`, sans approbation ni publication | Adoption atomique sur toutes les variantes; protection du texte manuel vérifiée séparément en intégration |
| 9. Autorisations propres aux prestations | Funding : commandes publication et décision Web | Snapshot exact contenu/média/cible/horaire; `POST /api/admin/sponsorships/website-visibility`, confirmation et version | Recette distante et intégrations preuve/médias | Nouvelle revue N0 après adoption; autorisations sociales exactes; Facebook modifié révoqué tandis que LinkedIn avance; décision Web distincte | Droits/usages réels hors des données synthétiques non qualifiés |
| 10. Publication autorisée | Funding : worker publication et service de visibilité Web | Revalidation avant envoi et reçu; décision distincte de visibilité | Recette navigateur fermant la page admin; intégrations worker | Deux envois `mock`, une tentative chacun, rejeu sans nouvel envoi; surface Web locale et média public constatés | `published` social reste simulé; aucune publication sur compte social réel |
| 11. Qualification des preuves | Funding : `sponsorship-fulfilment/evidence.ts`, `website-evidence.ts` | Preuve de l’obligation/version exacte; qualification Web ou fournisseur social | 22 tests preuve/médias/réconciliation et recette distante | Une preuve `website_verified` qualifiée liée à Web; aucune preuve sociale simulée admise | Visibilité observée ponctuellement; vérifications de fournisseur social réel non exécutées |
| 12. Acquittement et réconciliation | Funding : `evidence-write.ts`, projections; Preflight : suivi source | Transaction preuve → obligation → audit; révision source et clôture opérationnelle distinctes | Intégrations fulfilment et recette distante | Web `fulfilled`; Facebook/LinkedIn `pending`; nouvelle source Preflight 8 sans Web, ancienne mission `superseded` | Social mock non acquitté; notification métier automatique Funding → `source-decision` non raccordée; aucune clôture globale affirmée |

## État individuel des trois prestations

Les constats suivants proviennent de la recette navigateur distante réussie,
sur le dossier synthétique `OG7-2026-S3WCMJ`, contribution
`85a4a44f-5e15-4a4f-bb6b-9f39204c5f34`, montant `50000` unités mineures CAD.

| Prestation | Préparation | Adoption humaine | Autorisation | Exécution | Livraison qualifiée | Obligation acquittée |
| --- | --- | --- | --- | --- | --- | --- |
| Web OpenG7 | Réussie | Résumé adopté | Décision explicite de visibilité | Site et média localement accessibles | `website_verified` qualifiée dans Funding | `fulfilled`, version 2 |
| Facebook | Réussie | Brouillon natif adopté | Révoquée après modification puis réenregistrée | `published`, `mode=mock`, 1 tentative | Aucune preuve réelle; absence attendue | `pending`, version 1, preuve nulle |
| LinkedIn | Réussie | Brouillon natif adopté | Autorisation exacte indépendante de Facebook | `published`, `mode=mock`, 1 tentative | Aucune preuve réelle; absence attendue | `pending`, version 1, preuve nulle |

| Canal | Obligation synthétique | Preuve qualifiée |
| --- | --- | --- |
| Web | `62b3a49a-4b3d-453d-982e-0980560a8b2b` | `ecbb8e4b-e78d-4afd-8ea4-aa03f8140dd6` |
| Facebook | `a9a92051-793a-49d4-837c-948daaf230ce` | Aucune |
| LinkedIn | `94a19d64-0712-4506-b2f8-369265d67bb7` | Aucune |

La mission adoptée `fb48a0a9-3eda-48a7-8e34-dc05f6f9a235`, révision source 5,
référence la proposition `1269c0a1-11c8-4d88-a058-c71e28f11f3a`.
Après acquittement Web, la mission `9ad146ba-e0bc-4b8b-a814-51482589328b`,
révision source 8, ne prépare plus que Facebook/LinkedIn. L’ancienne mission est
`superseded`. Ce retour est observé via le relais et les lectures réelles;
aucun appel artificiel à `source-decision` n’a été utilisé.

Pour le social, `recordSocialFulfilment` n’enregistre aucune preuve lorsque le
mode est différent de `live`. Un reçu `mock-*`, même associé à un statut
`published`, ne suffit pas à acquitter l’obligation. Pour Web, la décision
explicite de visibilité sur la surface locale, les faits et les droits requis
peuvent produire `website_verified` et acquitter l’obligation synthétique sans
durée. Cela qualifie le comportement local, pas une livraison commerciale réelle.

## Validations exécutées

| Commande / périmètre | Résultat observé | Portée exacte |
| --- | --- | --- |
| Preflight : deux nouvelles régressions LinkedIn, avant correction | 2 échecs | Destination et portée média refusées par le contrat précédent |
| Funding : nouvelle régression Atelier 500, avant correction | 1 échec | LinkedIn absent du snapshot |
| Preflight : `npm run typecheck` | Réussi | TypeScript serveur/contrats |
| Preflight : `npm test` | 63 réussites, 0 échec, 0 ignoré | Contrats, moteur, API, fournisseurs et identité; fournisseurs synthétiques |
| Preflight : `npm run test:integration` | 13 réussites, 0 échec, 0 ignoré | PostgreSQL/worker isolés, trois variantes, reprise, budgets, obsolescence |
| Preflight : `npm run test:funding` | 5 réussites, 0 échec, 0 ignoré | Vrais HTTP/OAuth/JWKS et worker, base Funding jetable; commande/paiement par fixture |
| Preflight : `npm run test:web` | 10 réussites, 0 échec, 0 ignoré | 3 scénarios console/pile réelle et 7 scénarios OIDC à interfaces simulées |
| Preflight : `npm run build` | Réussi | Serveur et console Angular |
| Preflight : `node --test scripts/__tests__/standards.test.mjs` | 10 réussites, 0 échec, 0 ignoré | Régressions de l’outillage de standards |
| Funding : compilation TypeScript et lint ciblé API | Réussis | Raccordement modifié |
| Funding : 16 tests Node Atelier/API/client | 16 réussites, 0 échec, 0 ignoré | Contrats, contrôles HTTP et client |
| Funding : intégrations Atelier PostgreSQL | 4 réussites, 0 échec, 0 ignoré | Dont régression 500, adoption native et protection du texte manuel |
| Funding : complément du test 500 après assertions Web supplémentaires | 1 réussite, 0 échec, 0 ignoré | Résumé adopté; site privé; revue inchangée; pas de soumission du formulaire à la place du commanditaire |
| Funding : preuves, portée médias et réconciliation PostgreSQL | 22 réussites, 0 échec, 0 ignoré | Containers dédiés; règles de preuve et concurrence; pas de livraison sociale réelle |
| Funding : suite Node complète, dernier passage | 8 034 tests, 8 026 réussites, 0 échec, 8 ignorés; 78,8 s | Les 8 ignorés concernent disponibilité `age`, symlink et commandes ACME POSIX sous Windows |
| Funding : typecheck de la nouvelle recette et tests du runner | Réussite; 10 tests runner réussis | Profil explicite, isolation, ordre des contrôles et nettoyage |
| Funding : lint global après correction des groupes d’imports des helpers | Réussi, 0 erreur, 1 avertissement existant | Directive ESLint inutilisée dans `scripts/smoke-public.mjs:165`; aucune correction étrangère à la mission |
| Funding : première référence navigateur sans Preflight | Échec après 41,9 s | Commande, confirmation signée, trois obligations et médias constatés; arrêt sur une attente de test antérieure au contrôle N0 actuel |
| Funding : première recette navigateur distante | Échec après 19,3 s | Arrêt de recette sur une lecture admin paginée ne contenant pas le dossier; recherche ciblée et polling ajoutés |
| Funding : deuxième recette navigateur distante | Échec après 1,9 min | Préparation réelle, trois variantes, adoption UI confirmée et brouillons sociaux privés constatés; arrêt avant composition faute de nouvelle revue source après adoption |
| Funding : recette distante avec revue du contenu adopté | 1 réussite Chromium, 0 échec, 0 ignoré, 0 reprise Playwright; 78,2 s | Vraies API/relais/workers; trois variantes, adoption, indépendance, preuve Web et réconciliation constatées |
| Funding : référence sans Preflight avant correction de l’attente média | Échec : refus média attendu, réponse 200 | Une fois le N0 fourni, le collectif texte v3 peut être autorisé sans image; l’attente de refus était erronée |
| Funding : référence sans Preflight sur recette corrigée | 1 réussite Chromium, 0 échec, 0 ignoré, 0 reprise Playwright; 44,3 s | Web qualifié/acquitté et deux envois sociaux mock sans preuve réelle; contre-vérification du parcours partagé |
| Funding : builds Docker API/Web/Preflight et `docker compose config --quiet` | Réussis | Images Node 22; Angular production et profil Compose jetable réellement démarrés |
| Documentation et whitespace dans les deux dépôts | Réussis | Standards/budgets/liens Funding, standards Preflight et `git diff --check` |

La première exécution Node complète pendant l’écriture des imports de recette
avait donné 8 033 tests, 8 022 réussites, 3 échecs de découverte et 8 ignorés.
Après stabilisation, les trois fichiers concernés ont donné 20 réussites, puis
la suite complète courante ci-dessus a été exécutée avec zéro échec. Ce premier
échec n’est pas présenté comme une réussite ou comme un défaut externe présumé.

La première référence navigateur avait attendu `SPONSOR_MEDIA_REQUIRED` sur une
commande d’autorisation sans décision de modération. L’API a renvoyé
`MODERATION_DECISION_REQUIRED`, contrôle humain prioritaire actuel. La recette
conserve désormais une assertion explicite de ce refus, puis utilise les vrais
mécanismes de revue avant de vérifier le contrôle média. Ce changement corrige
le protocole de test; il ne désactive aucun contrôle métier. Lors de la
contre-vérification suivante, une fois le N0 fourni, l’API a autorisé le format
collectif texte v3 sans image. Le refus média attendu par l’ancienne recette
était donc lui aussi incorrect pour ce format à image facultative. La recette
conserve les contrôles 401/N0 et la revue UI des médias ajoutés, sans imposer une
image que l’offre n’exige pas. Les formats à image obligatoire gardent leur
qualification distincte dans la matrice générale.
La première recette distante s’est ensuite arrêtée sur une vérification de
statut utilisant la première page administrative sans filtre. La lecture de
contrôle a été corrigée pour rechercher et vérifier le dossier précis; aucun
changement de droit ou de statut métier n’a été utilisé pour franchir ce point.

Le deuxième passage distant a démontré la chaîne jusqu’à l’adoption confirmée,
puis a constaté l’absence de compositions sociales. L’adoption du résumé Web
avait modifié le contenu source et rendu le N0 précédent obsolète. Le
planificateur bloque ce contenu déjà examiné tant qu’une nouvelle revue explicite
n’a pas porté sur sa version courante. La recette ajoute ce geste UI après
l’adoption, avant composition. Les règles de modération restent inchangées;
ce contrôle découvert à l’exécution est documenté dans l’Atelier Funding.

## Reproduction et artefacts

Dans Preflight, fournir une `TEST_DATABASE_URL` de test distincte et
`FUNDING_CONNECTOR_ROOT` pointant vers le checkout Funding compilé, puis utiliser
les scripts `test:integration`, `test:funding` et `test:web` existants. Les ports
navigateur de test restent distincts de ceux des serveurs de développement.

Dans Funding, l’entrée de la recette distante est :

```powershell
node scripts/admin-acceptance.mjs --preflight-root C:\GitHub\openg7-preflight sponsorship-preflight-acceptance.spec.ts --project=chromium
```

Le runner crée son propre projet, ses bases et ses identités, ignore `.env`,
contrôle les modes simulés et retire sa pile après collecte des résultats.
La référence sans Preflight s’exécute avec le même runner, sans son option :

```powershell
node scripts/admin-acceptance.mjs sponsorship-publication-acceptance.spec.ts --project=chromium
```

Un [extrait de preuve synthétique](qualification-cycle-prestations-2026-11-18.evidence.json)
est conservé dans ce dépôt. Il contient les résultats, les références des
obligations/missions/brouillons/livraisons, leurs états observés et les empreintes
SHA256 de cinq artefacts originaux. Il exclut les credentials, tokens de suivi,
contacts et corps de contenu inutiles au constat. Le rapport ne dépend donc pas
uniquement d’une base jetable désormais retirée.

La recette distante réussie est conservée sous
`test-results/acceptance-preflight-passed-20261118/` dans Funding :

- `run.json` : projet, révisions, arbres modifiés, origine locale et modes;
- `results.json` : 1 attendu, 0 inattendu, 0 ignoré, 0 instable; durée 78 225,5 ms;
- `preflight-chain-evidence.json` : mission, cinq tâches, trois variantes et
  corrélation aux brouillons natifs;
- `sponsorship-publication-evidence.json` : autorisations/audit, deux reçus mock,
  obligations finales et unique preuve Web;
- `preflight-reconciliation-evidence.json` : nouvelle révision, deux destinations
  restantes et obsolescence de la mission adoptée;
- six captures : dossier soumis, trois variantes, adoption confirmée,
  autorisation LinkedIn, reçu Facebook et visibilité Web.

La recette a commencé le **18 novembre 2026 à 19:54:56 America/Toronto**
(`2026-11-19T00:54:56.660Z`). Sa pile jetable a été retirée avec succès.
Les premiers essais échoués restent conservés dans
`acceptance-funding-reference-20261118`, `acceptance-preflight-attempt1-20261118`
et `acceptance-preflight-attempt2-20261118`, sous `test-results/` Funding.
La référence corrigée réussie est conservée dans
`test-results/acceptance-funding-reference-passed-20261118/` : son `results.json`
atteste 1 attendu, 0 inattendu, 0 ignoré, 0 instable en 44 256,3 ms;
`sponsorship-publication-evidence.json` et cinq captures conservent ses constats.
Après les deux recettes, `docker ps` retrouve les onze services de développement
initiaux et aucun conteneur d’acceptation restant.

Le profil distant démarre sans le seed métier générique de 22 dossiers : ce
scénario crée son propre dossier depuis Checkout. Les seuls réglages SQL gardés
du helper historique remettent `last_prepared_at` à `NULL` sur les feeds visés,
worker arrêté, pour établir la fenêtre de préparation. Le passage à heure
contrôlée appelle ensuite le vrai service worker et reste borné à trois minutes.
Ces réglages ne fabriquent aucun paiement, brouillon adopté, autorisation ou preuve.

Les fixtures SQL des tests d’intégration, l’émetteur OAuth synthétique, les
contrôles read-only et les éventuels réglages de calendrier sont distingués des
étapes applicatives testées. Aucun succès navigateur ne doit être inféré d’une
écriture directe d’un paiement, d’une adoption, d’une autorisation ou d’une preuve.

## Limites restant à qualifier

- Publication Facebook/LinkedIn réelle, comptes fournisseurs, droits effectifs
  et qualification de leurs reçus; les obligations sociales restent ouvertes
  en mode mock par conception.
- Identités et infrastructure de préproduction, inférence IA réelle et qualité
  éditoriale au-delà des sorties déterministes validées par schéma.
- Observation Web continue : la présence publique a été constatée pendant la
  recette, mais le champ d’observation ultérieure de la preuve reste `unknown`.
  Aucune garantie de durée de visibilité ou de surveillance continue n’est affirmée.
- Notification métier automatique de décision à Preflight; la présence de son
  endpoint ne prouve pas son déclenchement par Funding.
- Adoption partielle d’un ensemble dont un brouillon a été modifié : le contrat
  actuel protège le contenu manuel en refusant l’adoption globale. Cela ne
  démontre pas un import partiel par obligation.
- Formats visuels, collections, autres cibles et accords à plusieurs passages
  ou durée : hors du parcours de référence texte 500 CAD, à traiter avec la
  [matrice complète](recette-parcours-prestations.md).
- Distinction structurée des attentes commanditaire/admin et dossiers mixtes :
  exigence du plan précédent, sans implémentation ajoutée à cette qualification.
- Le nouveau profil distant est opt-in. Son exécution locale réussie ne prouve
  pas qu’une CI ordinaire sans `--preflight-root` l’a exécuté.

La campagne vise à établir les preuves disponibles et les interruptions restantes.
Le critère « toutes les obligations livrées réellement et acquittées » ne peut
pas être déclaré atteint à partir de fournisseurs sociaux simulés.
