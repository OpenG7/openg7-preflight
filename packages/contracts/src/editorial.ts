import { z } from 'zod';

const identifier = z.string().trim().min(1).max(128);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sourceFactSchema = z.object({ key: identifier, value: z.string().min(1).max(4000) }).strict();
const mediaReferenceSchema = z.object({
  id: identifier,
  publicUseAllowed: z.literal(true),
  destinations: z.array(z.enum(['website', 'facebook'])).min(1).max(2).optional(),
}).strict();
const destinationBaseSchema = z.object({
  destination: z.enum(['website', 'facebook']),
  obligationId: identifier,
  obligationVersion: version,
  format: z.enum(['individual', 'collective']),
}).strict();
const destinationSchema = destinationBaseSchema.refine(value => value.destination !== 'website' || value.format === 'individual', 'website_format_invalid');

/** Optional sponsorship v1 input. Only explicitly allowed preparation facts belong here. */
export const editorialContextSchema = z.object({
  schemaVersion: z.literal('1.0'),
  sourceCommitmentId: identifier,
  sourceSnapshotDigest: z.string().regex(/^[a-f0-9]{64}$/),
  commitmentVersion: version,
  publicIdentity: z.object({ consent: z.boolean(), displayName: z.string().trim().min(1).max(200).optional() }).strict()
    .refine(value => value.consent || value.displayName === undefined, 'unconsented_public_name'),
  sourceFacts: z.array(sourceFactSchema).max(50),
  missingInformation: z.array(identifier).max(50),
  destinations: z.array(destinationSchema).min(1).max(20)
    .refine(values => new Set(values.map(value => value.obligationId)).size === values.length, 'duplicate_obligation'),
  mediaReferences: z.array(mediaReferenceSchema).max(20),
}).strict();
export type EditorialContext = z.infer<typeof editorialContextSchema>;

/** A preparation is never an approval or publication, including when ready for review. */
export const editorialPreparationSchema = z.object({
  schemaVersion: z.literal('1.0'),
  sourceVersion: version,
  sourceCommitmentId: identifier,
  sourceSnapshotDigest: z.string().regex(/^[a-f0-9]{64}$/),
  commitmentVersion: version,
  state: z.enum(['partial', 'ready_for_review']),
  publicationAuthorized: z.literal(false),
  common: z.object({
    version: z.literal(1),
    title: z.string().min(1).max(160),
    presentation: z.string().max(20000),
    recognition: z.string().max(4000),
    sourceFacts: z.array(sourceFactSchema).max(50),
    mediaReferences: z.array(mediaReferenceSchema).max(20),
    missingInformation: z.array(identifier).max(100),
  }).strict(),
  variants: z.array(destinationBaseSchema.extend({
    version: z.literal(1),
    title: z.string().min(1).max(160),
    body: z.string().max(20000),
    summary: z.string().max(500),
    mediaReferences: z.array(mediaReferenceSchema).max(20),
    publicationAuthorized: z.literal(false),
  }).strict()
    .refine(value => value.destination !== 'website' || value.format === 'individual', 'website_format_invalid')
    .refine(value => value.destination !== 'facebook' || value.body.length <= 2500, 'facebook_body_too_long')).min(1).max(20)
    .refine(values => new Set(values.map(value => value.obligationId)).size === values.length, 'duplicate_obligation'),
}).strict().refine(value => value.state !== 'ready_for_review' || value.common.missingInformation.length === 0, 'missing_information');
export type EditorialPreparation = z.infer<typeof editorialPreparationSchema>;
