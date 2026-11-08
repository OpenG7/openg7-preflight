import { editorialContextSchema, editorialPreparationSchema, type EditorialPreparation, type PreparationOutput } from '../../contracts/src/index.js';

/** Do not send arbitrary mission metadata or private administrative fields to the provider. */
export function editorialProviderData(input: Record<string, unknown>): Record<string, unknown> {
  if (input['editorialContext'] === undefined) return input;
  const context = editorialContextSchema.parse(input['editorialContext']);
  const publicIdentityAvailable = context.publicIdentity.consent && !!context.publicIdentity.displayName;
  return {
    title: publicIdentityAvailable ? context.publicIdentity.displayName : 'Préparation partielle de la commandite',
    publicFacts: publicIdentityAvailable ? context.sourceFacts : [],
    destinations: context.destinations.map(({ destination, format }) => ({ destination, format })),
    missingInformation: missingEditorialInformation(input),
  };
}

export function missingEditorialInformation(input: Record<string, unknown>): string[] {
  if (input['editorialContext'] === undefined) return [];
  const context = editorialContextSchema.parse(input['editorialContext']);
  return [...new Set([
    ...context.missingInformation,
    ...(!context.publicIdentity.consent ? ['public_name_consent'] : []),
    ...(!context.publicIdentity.displayName ? ['public_name'] : []),
    ...(context.mediaReferences.some(media => !media.destinations?.length) ? ['media_destination_authorization'] : []),
  ])];
}

/** Derive channel proposals from the validated v1 draft; never update source editorial versions. */
export function prepareEditorialProposal(input: Record<string, unknown>, draft: PreparationOutput, sourceVersion: number): EditorialPreparation | undefined {
  if (input['editorialContext'] === undefined) return undefined;
  const context = editorialContextSchema.parse(input['editorialContext']);
  const missingInformation = missingEditorialInformation(input);
  const publicIdentityAvailable = context.publicIdentity.consent && !!context.publicIdentity.displayName;
  const title = publicIdentityAvailable ? draft.title.slice(0, 160) : 'Préparation partielle de la commandite';
  const body = publicIdentityAvailable ? draft.body : '';
  const summary = publicIdentityAvailable ? draft.summary : '';
  const mediaReferences = context.mediaReferences.filter(media => media.destinations?.length);
  return editorialPreparationSchema.parse({
    schemaVersion: '1.0', sourceVersion,
    sourceCommitmentId: context.sourceCommitmentId,
    sourceSnapshotDigest: context.sourceSnapshotDigest,
    commitmentVersion: context.commitmentVersion,
    state: missingInformation.length ? 'partial' : 'ready_for_review',
    publicationAuthorized: false,
    common: {
      version: 1, title, presentation: body, recognition: summary,
      sourceFacts: publicIdentityAvailable ? context.sourceFacts : [],
      mediaReferences, missingInformation,
    },
    variants: context.destinations.map(destination => ({
      ...destination, version: 1, title,
      body: destination.destination === 'website' ? body : summary.slice(0, 2500),
      summary: summary.slice(0, 500), mediaReferences: mediaReferences.filter(media => media.destinations?.includes(destination.destination)),
      publicationAuthorized: false,
    })),
  });
}
