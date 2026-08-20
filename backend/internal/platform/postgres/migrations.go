package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// annotationRichTextMigration is deliberately idempotent. Fresh databases are
// initialized from db/schema.sql, while established installations are upgraded
// when the Go API starts.
const annotationRichTextMigration = `
ALTER TABLE annotations ADD COLUMN IF NOT EXISTS content jsonb;

DO $migration$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'annotations'
          AND column_name = 'title'
    ) THEN
        EXECUTE $sql$
            UPDATE annotations
            SET content = jsonb_build_object(
                'type', 'doc',
                'content', jsonb_build_array(
                    jsonb_build_object(
                        'type', 'heading',
                        'attrs', jsonb_build_object('level', 2),
                        'content', jsonb_build_array(
                            jsonb_build_object('type', 'text', 'text', title)
                        )
                    ),
                    jsonb_build_object(
                        'type', 'paragraph',
                        'content', jsonb_build_array(
                            jsonb_build_object('type', 'text', 'text', body)
                        )
                    )
                )
            )
            WHERE content IS NULL
        $sql$;
        ALTER TABLE annotations DROP COLUMN title;
        ALTER TABLE annotations DROP COLUMN body;
    END IF;
END
$migration$;

ALTER TABLE annotations ALTER COLUMN content SET NOT NULL;

CREATE TABLE IF NOT EXISTS annotation_comments (
    annotation_id uuid NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body varchar NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_annotation_comments_annotation_id
    ON annotation_comments (annotation_id);
`

type migration struct {
	version string
	sql     string
}

// Keep migrations append-only and ordered by version. A migration must remain
// safe to retry because a transaction can be interrupted before it is recorded.
var migrations = []migration{
	{version: "202608200001_rich_text_annotations_and_comments", sql: annotationRichTextMigration},
}

func runMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
        SELECT pg_advisory_xact_lock(hashtext('video-insight-schema-migrations'));
        CREATE TABLE IF NOT EXISTS go_schema_migrations (
            version varchar PRIMARY KEY,
            applied_at timestamp without time zone DEFAULT now() NOT NULL
        );
    `); err != nil {
		return err
	}
	for _, migration := range migrations {
		var applied bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM go_schema_migrations WHERE version = $1)`, migration.version).Scan(&applied); err != nil {
			return err
		}
		if applied {
			continue
		}
		if _, err := tx.Exec(ctx, migration.sql); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO go_schema_migrations (version) VALUES ($1)`, migration.version); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
