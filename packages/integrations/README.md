# Intégrations de l’écosystème

Inspection locale du 2 novembre 2026 : les README et architectures des dépôts
`openg7-agent-runtime` et `openg7-model-gateway` déclarent explicitement un état
de cadrage et de gouvernance. Aucun manifest applicatif ni contrat OpenAPI n’a
été trouvé. Les packages et routes décrits dans ces dépôts sont des cibles,
pas des dépendances utilisables. Aucun appel à ces services n’est implémenté.

Les ports `SourceApplicationAdapter`, `AgentRuntimeAdapter` et
`ModelGatewayAdapter` sont des interfaces locales de Preflight. Ils ne décrivent
pas une API existante des autres projets. Leur raccordement exige un contrat
vérifié, une authentification, un périmètre tenant/application, des versions,
une stratégie d’idempotence et une recette avec le service propriétaire.

Funding Platform et Social utilisent des événements de démonstration signalés
comme simulés. Preflight ne lit ni n’écrit directement leurs bases et ne possède
aucun mécanisme de publication ou d’approbation commerciale.

Le fournisseur OpenAI optionnel utilise le contrat HTTP Responses avec
`text.format` JSON Schema strict, vérifié dans la
[documentation officielle](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
Les réponses sont revalidées avec Zod. Aucun outil n’est offert au modèle.
L’activation exige `AI_PROVIDER=openai`, `AI_EXTERNAL_ENABLED=true`, une clé,
un modèle compatible et les tarifs de ce modèle explicitement configurés.
Le budget est une estimation conservatrice avant appel ; le coût calculé avec
les tokens est estimé, pas une facture du fournisseur. Les timeouts peuvent
interrompre l’attente sans garantir l’arrêt de la facturation externe.

Le mode `mock` est une simulation déterministe explicite. Sans fournisseur
configuré, le worker échoue de façon visible ; il ne bascule pas silencieusement
vers une simulation. Aucun appel réel n’est nécessaire pour les tests locaux.
