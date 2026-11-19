# Plan de recette — parcours complets et attentes par prestation

Plan établi le **18 novembre 2026**, fuseau `America/Toronto`.
Références inspectées : Preflight `d61af15`, Funding `4842e5ea`.
**Statut : plan à exécuter.** Aucun résultat de recette n’est annoncé ici.
Les regroupements proposés ci-dessous constituent des critères à livrer et à
vérifier; ils ne décrivent pas une fonctionnalité déjà disponible.
Les constats initiaux et les raccordements ajoutés sont à lire avec le
[bilan de qualification du cycle 500 CAD](qualification-cycle-prestations-2026-11-18.md).

## Objectif et périmètre

Vérifier chaque prestation promise par Funding, depuis le parcours de commande
jusqu’au résultat observable et à sa preuve, en passant par la préparation
Preflight lorsqu’elle est raccordée. Le dossier doit indiquer **qui peut agir
maintenant**, **de qui dépend sa résolution** et **quelles prestations peuvent
encore avancer**.

Une commande commerciale correspond ici à la contribution Funding existante.
Une prestation correspond à une obligation enregistrée : engagement, identifiant,
version, canal, cible et numéro de passage. Les avantages viennent de l’offre
acceptée ou de l’accord historique qualifié; ils ne sont jamais recalculés depuis
le montant et le barème du jour.

Paiement, préparation, adoption, revue, autorisation, visibilité, envoi et
acquittement d’une obligation sont des étapes distinctes. Funding conserve les
décisions et les preuves métier. Preflight prépare et présente les attentes
attestées par la source. Une simulation réussie conserve son caractère simulé;
elle ne solde pas une obligation exigeant une livraison réelle qualifiée.

Le plan couvre les prestations de commandite et leurs dépendances : formulaire,
consentements, médias, facturation et notifications. Les autres parcours Funding
restent référencés dans son inventaire propriétaire des scénarios de bout en bout.
Le workflow Social démonstratif de Preflight fait l’objet du contrôle C05;
aucune connexion Social réelle n’est présumée.

## Point de départ vérifié par lecture

| Surface | Couverture présente dans les sources | Limite pour cette recette |
| --- | --- | --- |
| Navigateur Preflight | Deux workflows, API, PostgreSQL, worker, briefing et lots dans [preflight.spec.ts](../tests/browser/preflight.spec.ts) | Identité de développement et IA simulée; missions soumises par API |
| Funding → Preflight | Transport HTTP/OAuth/JWKS, reprise, versions et propositions dans [funding.integration.mjs](../tests/cross-repo/funding.integration.mjs) | Initialisation par SQL/services; aucune adoption humaine réussie depuis les deux interfaces |
| Navigateur Funding | Recettes 100/250/500 CAD, dossier, médias, revue et envois sociaux simulés | Ces recettes ne démontrent pas le passage réel par Preflight |
| Interfaces du comptoir et de l’examen Funding | Parcours UI et adoption sur réponses API simulées | Leur réussite ne qualifie pas le relais et le worker distants |
| Blocages Funding | Étape, motifs, contrôles par obligation et certaines responsabilités admin/plateforme | Pas d’attribution complète au commanditaire; un même motif peut réunir média absent et média reçu à examiner |
| Blocages Preflight | `waiting_input`, informations manquantes et préparation éditoriale `partial` | Une proposition partielle peut être affichée parmi les propositions prêtes, sans responsable d’attente |

La [description du raccordement](connecting-applications.md#raccordement-de-funding-platform)
et les [contrats](contracts.md) restent les références des échanges existants.
Dans le checkout Funding, consulter les chemins relatifs à sa racine :

- `docs/development/end-to-end-scenarios-inventory.md` et `docs/sponsorship-e2e-coverage.md`;
- `docs/technical/sponsorship-commitments.md` et `docs/technical/publication-workshop.md`;
- `packages/funding-core/src/sponsorship-offers.ts` et `sponsorship-publication-formats.ts`;
- `packages/funding-core/src/preflight-desk.ts` et `admin-service-preparation.ts`;
- `apps/funding-api/src/admin-service-preparation-scope.ts` et `sponsorship-progress.service.ts`.

## Conditions d’exécution et preuves

Utiliser une pile de test dédiée, des données synthétiques, les deux bases
distinctes et des identités de test identifiées. L’API et les workers sont
réellement exécutés. Les serveurs et dossiers de développement existants sont
préservés. `TEST_DATABASE_URL` désigne exclusivement une base de test.

Pour qualifier la chaîne entre applications, les requêtes applicatives du
navigateur passent réellement par Funding, son relais, Preflight et le retour
Funding. Une réponse API interceptée ou une écriture SQL qui remplace l’étape
testée ne constitue pas la preuve de cette étape. La mise en place de fixtures
historiques et l’injection de pannes sont consignées séparément.

La première campagne utilise des fournisseurs simulés pour l’IA, Stripe,
courriels/SMS et réseaux sociaux. Relever le mode de chaque composant plutôt que
présumer le profil du runner. Un webhook synthétique signé teste le traitement
applicatif, sans qualifier Stripe réel. Une identité OAuth locale ne qualifie pas
le realm de préproduction. Toute campagne avec comptes ou fournisseurs réels
constitue une qualification séparée, sur une cible explicitement choisie.

Pour chaque exécution, conserver sans secrets : identifiant de cas, date/fuseau,
révisions des deux dépôts, profil, acteurs/rôles, données initiales, étapes,
attendus et observés. Corréler référence du dossier, engagement/version,
obligation/version/ordinal, révision et empreinte source, événement, mission,
proposition, brouillon, décision et reçu disponibles. Conserver captures,
réponses utiles expurgées, audit et compteurs avant/après. Masquer jetons privés,
credentials, coordonnées privées inutiles et URL donnant accès au suivi.

## Matrice des prestations

La configuration inspectée propose Web dès **50 CAD**, Facebook dès **250 CAD**,
LinkedIn dès **500 CAD**. Les anciens tests à 100 CAD représentent un exemple de
palier Web. Relever les seuils effectifs au début de chaque campagne.
L’offre générée actuelle cible `openg7`, prévoit un passage par prestation,
sans délai ni durée fixes, avec `collective_text` comme format social par défaut.
Les formats ci-dessous sont des capacités déclarées dans le code Funding;
leur exécution et leur raccordement doivent être qualifiés individuellement.

| ID | Canal et format | Données et contrôle propres au parcours | Passage par Preflight à qualifier |
| --- | --- | --- | --- |
| P01 | Web | Identité et consentement requis; visibilité séparée; enrichissement image selon la promesse exacte | Adaptation Web existante; chaîne navigateur et adoption à prouver |
| P02 | Facebook — `collective_text` | Chaque commanditaire conserve son bloc de reconnaissance; image facultative pour l’offre v3 | Adaptation Facebook collective existante; composition et chaîne complète à prouver |
| P03 | Facebook — `individual_portrait` | Un seul commanditaire; présentation approuvée et image admissible pour ce format | Déclinaison individuelle à relier au format Funding exact; droits/sélection média à vérifier dans Funding |
| P04 | Facebook — `collective_composite` | Plusieurs sources identifiables; composition et droits de chaque média | Aucun raccordement complet au format visuel démontré; consigner le blocage sans rabattre sur du texte |
| P05 | LinkedIn — `collective_text` | Reconnaissance complète de chaque source; image facultative pour l’offre v3 | Destination ajoutée pendant la qualification; voir son bilan pour la preuve du parcours distant |
| P06 | LinkedIn — `individual_portrait` | Un seul commanditaire; présentation approuvée, image et destination exactes | Destination ajoutée; format et droits média restant à qualifier |
| P07 | LinkedIn — `collective_composite` | Composition collective, sources et médias exacts | Destination ajoutée; format visuel restant à qualifier |
| P08 | LinkedIn — `image_collection` | Plusieurs images; ordre, nombre admissible et droits contrôlés selon le contrat du transport | Destination ajoutée; collection restant à qualifier |

Pour Web et le texte collectif v3, l’absence d’une image facultative ne bloque
pas le texte. Une image promise par une ancienne offre reste due. L’affichage
intermédiaire du texte ne suffit pas à acquitter cette promesse.
L’historique sans format enregistré promet du texte, sans conversion implicite
en prestation avec image.

Le [contrat éditorial Preflight](../packages/contracts/src/editorial.ts) distingue
Web/Facebook/LinkedIn et individuel/collectif après l’extension de destination
décrite dans le bilan. Il ne représente pas tous les
formats créatifs Funding et ne qualifie pas les droits ni la sélection des médias.
Pour chaque P01–P08, relever séparément le résultat **Funding seul** et le résultat
**Funding → Preflight → Funding**. Une réussite locale à Funding ne ferme pas une
lacune de contrat ou de raccordement.

| ID | Variantes commerciales et cas refusés | Attendu |
| --- | --- | --- |
| V01 | 50/100, 250 et 500 CAD; juste sous chaque seuil et au seuil | Offre serveur correcte; aucune prestation ajoutée à partir d’une valeur déclarée par le navigateur |
| V02 | `image_collection` sur Facebook | Refus de combinaison indisponible; aucune transformation silencieuse ni promesse créée |
| V03 | Cible `openg20` déjà promise ou ajustée explicitement | Respecter cette cible; qualifier séparément disponibilité, transport et correspondance Preflight; aucun remplacement par `openg7` |
| V04 | Plusieurs passages enregistrés | Identité et ordinal de chaque passage conservés; prochain passage préparé après livraison qualifiée ou dispense du précédent, sans doublon |
| V05 | Échéance contractuelle | Origine documentée et calcul attendu; retard distinct du responsable; aucun délai inventé depuis le paiement |
| V06 | Durée Web `openg7` promise | Début, observations et attestation de durée prévus par Funding; présence actuelle et durée accomplie vérifiées séparément |
| V07 | Nouvelle durée sociale ou Web `openg20` | Refus `COMMITMENT_DURATION_UNSUPPORTED`; accord à résoudre explicitement, sans supprimer sa durée pour contourner le contrôle |
| V08 | Accord historique non qualifié, qualifié ou ancienne offre acceptée | À qualifier si inconnu; exigences et quantités conservées après qualification; aucune réinterprétation par le barème courant |
| V09 | Ajustement ou dispense autorisés | Version et audit conservés; dispense séparée d’une livraison et exclue des attentes actives; changement de destination/format maintenant l’obligation ouverte avec sa nouvelle version et réexamen des autorisations |

Les cibles, quantités, délais et durées reconnus par un schéma ne sont pas tous
des options commerciales proposées dans le parcours courant. Créer les variantes
historiques par les mécanismes de qualification/ajustement existants, avec preuves
synthétiques, plutôt que modifier arbitrairement une offre acceptée.

## Règles de regroupement à vérifier dans les deux applications

### Informations nécessaires par prestation

La projection métier propriétaire doit distinguer l’étape de travail, les
dépendances et les actions réellement possibles. Pour chaque attente, prévoir :

- obligation et version concernées, révision source et date d’observation;
- motif vérifiable et fait source qui le justifie;
- acteur dont dépend la résolution : commanditaire, administration, plateforme
  ou inconnu;
- prochaine action, son responsable et son écran propriétaire;
- caractère obligatoire ou facultatif de l’élément pour la prestation exacte;
- demande déjà adressée ou non au commanditaire, et son état connu.

Ces informations définissent un besoin de contrat, sans imposer ici des champs
JSON déjà disponibles. Réutiliser les références source existantes et versionner
l’extension avec ses consommateurs lorsqu’elle sera implémentée. Le moteur
générique conserve son rôle d’orchestration. L’IA ne déduit pas un responsable
depuis un libellé ou un code ambigu comme `required_media_missing`.

### Groupes de dossiers

| Groupe principal | Règle |
| --- | --- |
| Attente du commanditaire | Une réponse ou un élément obligatoire est attendu du commanditaire; aucune action admin utile ne peut actuellement faire progresser le travail restant |
| Attente admin | Une action administrative utile est possible; aucune attente commanditaire active n’est attestée |
| Mixte | Une attente commanditaire active coexiste avec une action admin réalisable, sur la même prestation ou sur une autre |
| Attente plateforme | Aucune action humaine requise maintenant; programmation, traitement ou reprise technique connus |
| À qualifier | Faits insuffisants, contradictoires, responsabilité inconnue ou incapacité non résolue; ne pas attribuer arbitrairement au commanditaire |

Pour l’agrégation, examiner toutes les obligations actives restantes du dossier.
Une action admin future qui dépend d’une réponse commanditaire n’est pas encore
une action réalisable. Si une responsabilité nécessaire reste inconnue, retenir
« À qualifier » et montrer néanmoins les actions connues qui restent possibles.
Sinon, appliquer les critères mixte, admin, commanditaire, puis plateforme.
Les dépendances techniques coexistantes restent visibles comme motifs
secondaires. Un incident qui exige investigation humaine est une action admin;
un retry technique borné sans action humaine relève de la plateforme.

Un dossier sans obligation active restante sort des files d’attente. Les comptes
de prestations livrées, dispensées (`state=adjusted`) et inconnues restent distincts.
Une modification de destination ou de format conserve l’obligation à réaliser.
Un dossier a un seul groupe principal; les prestations peuvent relever de
responsables différents. Les totaux dossiers comptent des dossiers uniques, les
totaux prestations des obligations uniques. Afficher clairement ces deux unités.
Un filtre de groupe conserve l’accès à toutes les prestations du dossier mixte.

Le groupe métier reste indépendant des états techniques Preflight et des étapes
Funding. `waiting_input` n’identifie pas à lui seul un commanditaire.
`review_ready` et `partial` peuvent coexister : la préparation partielle reste
consultable, avec ses attentes, sans être présentée comme entièrement exploitable.
Une proposition complète peut encore attendre une revue administrative.

### Situations discriminantes

| ID | Situation initiale / événement | Résultat attendu |
| --- | --- | --- |
| G01 | Information obligatoire absente; demande pertinente déjà adressée au commanditaire | Attente commanditaire si aucune autre action admin n’est possible; motif et prestation affichés |
| G02 | Information absente, mais l’admin doit encore préparer ou confirmer la demande | Action admin visible maintenant; dépendance commanditaire future distincte; pas de fausse demande annoncée comme envoyée |
| G03 | Formulaire complet soumis, revue non effectuée | Attente admin; aucune demande de resoumission injustifiée |
| G04 | Image obligatoire absente avec demande commanditaire en attente | Attente commanditaire pour la prestation avec image; les autres prestations avancent selon leurs propres besoins |
| G05 | Image reçue, revue ou sélection administrative manquante | Attente admin; ne pas redemander le même fichier au commanditaire |
| G06 | Droit d’usage non qualifié | Identifier le fait manquant : preuve attendue du commanditaire, qualification admin ou inconnu; ne pas assimiler automatiquement à une image absente |
| G07 | Image facultative absente pour Web/texte collectif v3 | Texte préparé et examinable selon ses autres conditions; absence d’image sans blocage artificiel |
| G08 | Dossier avec texte examinable et portrait attendant une photo | Groupe mixte; deux attentes distinctes; revue du texte possible |
| G09 | Complément commanditaire reçu et validé côté source | Attente résolue recalculée; passage à admin si revue nécessaire; versions/propositions obsolètes bloquées |
| G10 | Correction demandée après revue | L’action indique précisément qui corrige; une correction interne reste admin, une réponse demandée à l’entreprise devient attente commanditaire |
| G11 | Consentement explicitement refusé ou retiré | Respect du choix, blocage des usages concernés et résolution métier à examiner; aucune relance automatique pour obtenir un accord |
| G12 | Consentement ou preuve de consentement inconnus | À qualifier ou action admin de vérification; aucune supposition d’accord ou de refus |
| G13 | Préparation/envoi programmé, ou indisponibilité avec retry autorisé | Attente plateforme tant qu’aucune intervention humaine n’est requise; état et échéance observables |
| G14 | Résultat fournisseur incertain ou reprise épuisée | Intervention admin de réconciliation/investigation; pas de renvoi aveugle ni d’accusation de dossier commanditaire incomplet |
| G15 | Ancien accord ou preuve non qualifiés | À qualifier, action propriétaire et historique disponibles; absence de faux « livré » |
| G16 | Action admin sans nouveau matériau éditorial | Résoudre uniquement l’attente concernée; ne pas soumettre le formulaire à la place du commanditaire ni changer son consentement; pas de génération IA sans nécessité |

Le reclassement suit une nouvelle observation source contrôlée. Une modification
du matériau source applique l’invalidation prévue; un changement purement
administratif ne doit pas produire mécaniquement un nouveau brouillon IA.
Un rejeu ancien ne rétablit pas une attente résolue. L’interface indique une
observation périmée ou indisponible plutôt que présenter un regroupement supposé
à jour. Aucune relance externe ne résulte du seul changement de groupe.

## Parcours commun à exécuter pour P01–P08

1. **Commander.** Dans Funding, choisir l’offre et les formats effectivement
   disponibles, vérifier leurs promesses, accepter les conditions et passer par
   Checkout de test. Vérifier que le retour navigateur seul ne confirme rien.
2. **Confirmer.** Recevoir la confirmation serveur prévue. Relever contribution,
   engagement et obligations, facture/notifications applicables et absence de
   doublon au rejeu. Pour une variante historique, consigner son autre point
   d’entrée et ne pas prétendre avoir testé Checkout.
3. **Compléter le suivi.** Depuis l’accès privé du commanditaire, soumettre les
   informations, consentements et médias requis. Examiner aussi un état incomplet
   et relever qui doit agir. Un refus explicite reste distinct d’un oubli.
4. **Comparer les files.** Dans Funding et le briefing Preflight, vérifier groupe,
   motifs, actions et nombre d’obligations. Un dossier absent de Preflight faute
   de mission ou de transport d’attentes constitue une limite à consigner.
5. **Faire préparer.** Utiliser le déclencheur métier/administratif prévu dans
   Funding. Observer le relais après commit, la mission et le worker Preflight.
   Consulter ou rafraîchir une page ne crée pas une nouvelle préparation.
6. **Examiner le retour.** Vérifier contenu commun, variante, obligation/version,
   source courante, provenance et caractère partiel ou complet. Les informations
   privées inutiles restent hors du matériau IA et des textes publics.
7. **Adopter.** Avec les droits requis, effectuer les validations et l’adoption
   humaine Funding. Vérifier le brouillon privé exact, la préservation des
   modifications manuelles et les conflits explicites. L’adoption ne constitue
   ni une autorisation d’envoi ni une soumission du formulaire commanditaire.
8. **Autoriser.** Examiner le contenu exact, la cible, les médias/droits, le format,
   la version et l’horaire. Confirmer les décisions nécessaires dans Funding.
   La décision de visibilité Web conserve son contrôle distinct.
9. **Exécuter et constater.** Fermer le navigateur admin. Vérifier l’absence
   d’envoi avant échéance, le traitement par le worker, le reçu et le rejeu.
   Pour Web, vérifier la surface autorisée et ses médias. Documenter tout pilotage
   de l’horloge. Un reçu simulé reste simulé et ne vaut pas acquittement réel.
10. **Réconcilier.** Vérifier la preuve métier selon le contrat Funding, le suivi
    privé et les compteurs. Vérifier ensuite le retour de décision à Preflight
    lorsqu’il sera branché; ce branchement est actuellement un prérequis restant.
    `completed` clôt le suivi opérationnel, sans prouver la livraison métier.

Une étape non raccordée arrête la qualification de la chaîne à cet endroit.
Inscrire le résultat partiel et le prérequis manquant. Un appel manuel à une API
disponible peut vérifier son contrat séparément, mais ne remplace pas le
déclencheur métier manquant dans une recette navigateur complète.

## Commandes et incidents transverses

| ID | Action / incident | Résultat attendu |
| --- | --- | --- |
| C01 | Contribution personnelle publique/privée | Paiement et consentements distincts; aucune obligation de commandite ni mission inventée; dossier hors de cette file de prestations |
| C02 | Paiement abandonné, refusé, en attente ou confirmation retardée | Aucun paiement ou avantage présenté comme confirmé par le seul navigateur; progression après fait serveur confirmé |
| C03 | Refus administratif, remboursement ou contestation | Règles d’admissibilité Funding appliquées; autorisations incompatibles bloquées; aucune obligation automatiquement acquittée par l’événement financier |
| C04 | Réception/soumission/préparation répétées ou réponse perdue | Réconciliation de la même opération; pas de mission, facture, notification ni livraison logique en double |
| C05 | Workflow `editorial-brief-preparation-v1` démonstratif | Fonctionnement interne toujours explicite et simulé; pas de dossier commanditaire ou connexion Social inventés |
| C06 | Reprise manuelle, annulation, événements anciens ou désordonnés | Droits et version source vérifiés; travail intermédiaire conservé; ancien résultat incapable de redevenir courant; branchement source manquant signalé |
| C07 | Source ou média modifiés entre préparation, adoption et envoi | Ancienne proposition/autorisation bloquée aux étapes concernées; nouvelle revue requise selon le contrat; autres prestations indépendantes préservées |
| C08 | Deux administrateurs agissent sur la même version | Conflit explicite sans écrasement silencieux ni double décision; reprise depuis la version courante |
| C09 | Panne réseau/API/worker, arrêt puis redémarrage | Intention durable et résultats conservés; reprise bornée, provenance et historique visibles; pas de faux succès |
| C10 | Timeout/coût IA, sortie invalide ou tentatives épuisées | Échec inspectable et budget respecté; aucun résultat invalide adopté; attente technique ou investigation admin appropriée |
| C11 | Lot collectif dont une source perd son admissibilité | Contrôles dossier par dossier; source exclue/bloquée et composition réexaminée selon les règles; aucun envoi avec autorisation périmée |
| C12 | Lot de revue, exclusion puis export versionné Preflight | Sélection/version respectées; ancienne sélection refusée; export préparatoire sans décision métier |
| C13 | Mauvais rôle, tenant, application, session expirée ou accès privé anonyme | Refus serveur sans fuite de données; récupération explicite; aucune action sensible exécutée |
| C14 | FR/EN, mobile et clavier | Même groupe, motif et action compréhensibles; compteurs cohérents; navigation vers le dossier et la prestation exacts |
| C15 | Preuve simulée, historique non qualifié ou mauvaise obligation/version | Aucune livraison réelle déduite; preuve rejetée ou à qualifier selon Funding; historique conservé |

Le parcours normal, l’attente commanditaire pertinente, l’attente admin et le
reclassement sont obligatoires pour chaque P01–P08 applicable. Marquer un cas
sans objet avec justification : par exemple aucune photo requise pour du texte
collectif v3. Couvrir G08 et les lots avec plusieurs prestations/commanditaires.
Exécuter les incidents communs sur des représentants de chaque frontière :
commande, transport, préparation, adoption, autorisation, exécution et preuve.
Ne pas multiplier toutes les combinaisons sans risque propre; relever celles
qui nécessitent une variante spécifique, notamment collections et durées.

## Organisation de la campagne

### Jeux de dossiers synthétiques

| Jeu | Situation à préparer | Usage |
| --- | --- | --- |
| J01 | Offre acceptée complète, un dossier par format disponible | P01–P08, parcours normal; médias fournis par le suivi privé |
| J02 | Élément obligatoire demandé au commanditaire, réponse absente | G01/G04; comparer absence d’élément facultatif G07 |
| J03 | Informations et médias reçus, revue/sélection non effectuées | G03/G05/G06; vérifier absence de relance injustifiée |
| J04 | Même dossier : texte examinable, portrait incomplet, autre passage déjà livré avec preuve qualifiée si disponible | G08 et compteurs; ne pas compter une fixture simulée comme livraison réelle |
| J05 | Consentement refusé, consentement inconnu et accord historique non qualifié, dans des dossiers distincts | G11/G12/G15 et V08 |
| J06 | Plusieurs passages, cibles ou durée autorisées par un accord qualifié | V03–V07; conserver les versions et l’origine documentée des délais |
| J07 | Indisponibilité, envoi programmé et résultat incertain | G13/G14 et C09; distinguer retry automatique et action humaine |
| J08 | Deux administrateurs et une identité hors périmètre | C08/C13; utiliser des rôles et tenants de test distincts |

### Ordre de passage

1. **Établir le périmètre.** Relever versions, offre/configuration, disponibilité
   des transports et formats, flags actifs, identités et modes fournisseurs.
   Vérifier les préconditions du raccordement décrites dans son guide propriétaire;
   les producteurs Funding concurrents ne sont pas activés ensemble.
2. **Qualifier un parcours de référence.** Exécuter P01 puis P02 à travers les deux
   applications jusqu’au brouillon adopté. Ouvrir les écarts avant de décliner
   les autres prestations. Poursuivre les étapes d’autorisation/exécution selon
   leurs modes disponibles, avec qualification séparée des preuves.
3. **Qualifier les regroupements.** Exécuter G01–G16 sur J02–J05/J07; comparer les
   vues Funding/Preflight avant et après complément et intervention admin.
   Les champs et interfaces manquants restent des prérequis ouverts.
4. **Étendre à toutes les prestations.** Exécuter P03–P08 et V01–V09 applicables;
   tracer les limites de format, de destination et de durée individuellement.
5. **Éprouver la reprise et la gouvernance.** Exécuter C01–C15 pertinents,
   notamment concurrence, lots, permissions, redémarrage et preuve. Rejouer
   uniquement les cas affectés après correction, puis les parcours de référence.

### Suites existantes comme points d’appui

Les commandes ci-dessous existent; elles couvrent des morceaux de la recette.
Elles n’exécutent pas encore cette matrice complète. Aucun runner unique pour
P01–P08/G01–G16 n’est livré par ce document. La qualification du parcours distant
nécessitera d’étendre la recette navigateur ou de consigner ses étapes manuelles.

Dans Preflight, avec la base de test et les préconditions de chaque suite :

```sh
npm run test:integration
npm run test:web
npm run test:funding
```

`test:funding` exige aussi `FUNDING_CONNECTOR_ROOT` pointant vers le checkout
Funding compilé. La suite utilise une base Funding jetable et des schémas de
test Preflight. `test:web` utilise ses ports de test dédiés, l’IA mock et une
identité de développement. Ces profils restent distincts de la qualification
avec identité de préproduction.

Dans Funding, les recettes d’acceptation créent une pile jetable :

```sh
yarn test:e2e:acceptance sponsorship-tiers-acceptance.spec.ts --project=chromium
yarn test:e2e:acceptance sponsorship-publication-acceptance.spec.ts --project=chromium
yarn test:e2e:acceptance sponsorship-information-acceptance.spec.ts --project=chromium
yarn test:e2e:identity
```

Consulter `docs/development/validation.md` dans Funding pour les préconditions.
Les suites UI à API interceptée complètent l’ergonomie et ne prouvent pas la
chaîne distante. La suite Funding `test:e2e:playwright` effectue migration/seed
sur sa cible locale; privilégier ici la pile d’acceptation jetable.

## Registre de résultats et critères de sortie

Créer une ligne de résultat par cas, prestation et variante exécutés :

| Exécution | Cas/prestation | Révisions/profil | Groupe avant → après | Attendu / observé | Preuves | Résultat / écart |
| --- | --- | --- | --- | --- | --- | --- |
| À renseigner | Pxx + Gxx/Cxx/Vxx | À relever | À observer | À consigner | Références expurgées | À exécuter |

Résultats autorisés : **à exécuter**, **réussi**, **échoué**, **bloqué par
prérequis**, **sans objet justifié**. Une étape non raccordée ou un test ignoré
ne devient pas une réussite. Un écart indique le responsable du composant,
l’étape exacte, la reproduction, l’impact sur la prestation et le prochain contrôle.

La recette est terminée pour un périmètre déclaré lorsque :

- chaque prestation proposée a son parcours exécuté et ses preuves, ou une
  indisponibilité explicite empêchant de la déclarer qualifiée;
- les groupes sont expliqués par des faits source et concordent dans les deux
  applications; un dossier mixte conserve ses actions réalisables;
- le complément commanditaire et l’action admin reclassent correctement les
  attentes; aucun doublon, droit indu, faux prêt ou fausse livraison n’est constaté;
- les versions, l’audit, la confidentialité, les décisions humaines et la
  conservation des modifications manuelles sont vérifiés aux étapes sensibles;
- la livraison réelle, le reçu simulé, l’acquittement métier et la clôture
  opérationnelle Preflight disposent de constats distincts;
- les limites de raccordement, d’identité et de fournisseur restent visibles
  dans le bilan. Une chaîne partiellement validée est annoncée comme telle.

Les besoins fonctionnels restant à traiter incluent notamment le transport des
attentes par prestation, leurs regroupements dans les deux interfaces, la
distinction des préparations partielles dans le briefing, les formats/canaux
non raccordés et les notifications métier de décision/annulation. Leur suivi
s’inscrit dans les [travaux Funding restants](architecture/operational-readiness.md#raccorder-funding-platform).
