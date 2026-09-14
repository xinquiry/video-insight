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

const videoProcessingMigration = `
ALTER TABLE videos ALTER COLUMN size_bytes TYPE bigint;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS processing_status varchar DEFAULT 'ready' NOT NULL;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS processing_error varchar;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS processing_attempts integer DEFAULT 0 NOT NULL;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS processing_started_at timestamp without time zone;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS processing_available_at timestamp without time zone DEFAULT now() NOT NULL;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_videos_processing_status'
          AND conrelid = 'videos'::regclass
    ) THEN
        ALTER TABLE videos ADD CONSTRAINT ck_videos_processing_status
            CHECK (processing_status IN ('pending', 'processing', 'ready', 'failed'));
    END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS ix_videos_processing_queue
    ON videos (processing_status, processing_available_at);
`

const driveExportsMigration = `
CREATE TABLE IF NOT EXISTS drive_exports (
    video_id uuid NOT NULL UNIQUE REFERENCES videos(id) ON DELETE CASCADE,
    group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    requested_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status varchar DEFAULT 'pending' NOT NULL,
    destination_path varchar NOT NULL,
    size_bytes bigint,
    error varchar,
    attempts integer DEFAULT 0 NOT NULL,
    started_at timestamp without time zone,
    available_at timestamp without time zone DEFAULT now() NOT NULL,
    completed_at timestamp without time zone,
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now()
);

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_drive_exports_status'
          AND conrelid = 'drive_exports'::regclass
    ) THEN
        ALTER TABLE drive_exports ADD CONSTRAINT ck_drive_exports_status
            CHECK (status IN ('pending', 'preparing', 'uploading', 'completed', 'failed'));
    END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS ix_drive_exports_queue
    ON drive_exports (status, available_at);
CREATE INDEX IF NOT EXISTS ix_drive_exports_group_id
    ON drive_exports (group_id);
`

type migration struct {
	version string
	sql     string
}

// Keep migrations append-only and ordered by version. A migration must remain
// safe to retry because a transaction can be interrupted before it is recorded.
var migrations = []migration{
	{version: "202608200001_rich_text_annotations_and_comments", sql: annotationRichTextMigration},
	{version: "202608210001_video_processing", sql: videoProcessingMigration},
	{version: "202609140001_drive_exports", sql: driveExportsMigration},
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
