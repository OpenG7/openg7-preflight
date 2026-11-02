CREATE TABLE IF NOT EXISTS batch_selection_history (
  batch_id uuid NOT NULL REFERENCES proposal_batches(id), version integer NOT NULL,
  selection jsonb NOT NULL, actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(batch_id,version)
);
-- Preserve the current selection when upgrading a database that already has prepared batches.
INSERT INTO batch_selection_history(batch_id,version,selection,actor)
SELECT b.id,b.version,coalesce(jsonb_agg(jsonb_build_object(
  'proposalId',m.proposal_id,'proposalVersion',m.proposal_version,'sourceVersion',m.source_version,'excluded',m.excluded
) ORDER BY m.proposal_id) FILTER(WHERE m.proposal_id IS NOT NULL),'[]'::jsonb),b.created_by
FROM proposal_batches b LEFT JOIN batch_members m ON m.batch_id=b.id GROUP BY b.id
ON CONFLICT(batch_id,version) DO NOTHING;
