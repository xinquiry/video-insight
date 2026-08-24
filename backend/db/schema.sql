CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE groups (
    name varchar NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX ix_groups_name ON groups (name);

CREATE TABLE users (
    username varchar NOT NULL,
    password_hash varchar NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now(),
    is_admin boolean DEFAULT false NOT NULL,
    group_id uuid NOT NULL REFERENCES groups(id)
);
CREATE UNIQUE INDEX ix_users_username ON users (username);
CREATE INDEX ix_users_group_id ON users (group_id);

CREATE TABLE videos (
    title varchar NOT NULL,
    description varchar,
    object_key varchar NOT NULL UNIQUE,
    original_filename varchar NOT NULL,
    content_type varchar NOT NULL,
    size_bytes bigint NOT NULL,
    processing_status varchar DEFAULT 'ready' NOT NULL,
    processing_error varchar,
    processing_attempts integer DEFAULT 0 NOT NULL,
    processing_started_at timestamp without time zone,
    processing_available_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now(),
    group_id uuid NOT NULL REFERENCES groups(id)
);
ALTER TABLE videos ADD CONSTRAINT ck_videos_processing_status
    CHECK (processing_status IN ('pending', 'processing', 'ready', 'failed'));
CREATE INDEX ix_videos_title ON videos (title);
CREATE INDEX ix_videos_group_id ON videos (group_id);
CREATE INDEX ix_videos_processing_queue
    ON videos (processing_status, processing_available_at);

CREATE TABLE annotations (
    video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    timestamp_seconds double precision NOT NULL,
    content jsonb NOT NULL,
    kind varchar NOT NULL,
    color varchar NOT NULL,
    custom_data json NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now(),
    duration_seconds double precision DEFAULT 6.0 NOT NULL,
    position_x double precision,
    position_y double precision,
    region_x double precision,
    region_y double precision,
    region_width double precision,
    region_height double precision,
    shape varchar DEFAULT 'marker' NOT NULL,
    display_mode varchar DEFAULT 'card' NOT NULL,
    interactive boolean DEFAULT true NOT NULL
);
CREATE INDEX ix_annotations_timestamp_seconds ON annotations (timestamp_seconds);
CREATE INDEX ix_annotations_video_id ON annotations (video_id);

CREATE TABLE annotation_comments (
    annotation_id uuid NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body varchar NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now()
);
CREATE INDEX ix_annotation_comments_annotation_id ON annotation_comments (annotation_id);
