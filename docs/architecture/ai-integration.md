# Fournisseurs IA

Le port `AiProvider` expose une entrée typée, des limites et un résultat validé
par Zod. Les capacités initiales préparent une présentation Web ou une synthèse
éditoriale. Chaque résultat identifie fournisseur, modèle, simulation, horodatage,
empreinte de l’entrée et estimation de coût; les jetons sont conservés si reçus.

`mock` est une simulation déterministe explicite, sans inférence réelle et sans
coût fournisseur. Les tests et démonstrations l’utilisent par défaut.

`openai` utilise l’API Responses et les sorties structurées strictes. Le contrat
est vérifié contre la [documentation officielle](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
Il exige `AI_EXTERNAL_ENABLED=true`, une clé locale, un modèle choisi et ses tarifs
vérifiés. Aucun appel réel n’est exécuté par les tests. Les tests HTTP injectent
des réponses synthétiques, y compris erreurs et sorties invalides.

Les prix sont des paramètres explicites, pas des constantes prétendument à jour.
Le budget est vérifié avant l’appel avec une réservation conservatrice. Les coûts
dérivés des jetons restent des estimations; ils ne sont pas une facture fournisseur.
Un fournisseur absent, une réponse refusée/incomplète, un schéma invalide ou un
timeout sont des erreurs explicites, pas un basculement silencieux vers mock.

Les documents sources sont des données non fiables. Aucun outil, accès réseau
arbitraire, publication ou exécution de code n’est accordé au modèle. Les instructions
séparent contenu et consignes; la validation de sortie ne prouve pas la vérité
des faits. Les autorisations et preuves manquantes restent à vérifier à la source.

Le model gateway et le runtime OpenG7 restent des ports futurs, sans API inventée.
