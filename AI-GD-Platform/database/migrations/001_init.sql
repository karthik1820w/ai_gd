CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE users (id BIGSERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin', created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE sessions (code TEXT PRIMARY KEY, topic TEXT NOT NULL, keywords TEXT[] DEFAULT '{}', admin_id BIGINT REFERENCES users(id), status TEXT NOT NULL DEFAULT 'lobby', created_at TIMESTAMPTZ DEFAULT now(), started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ);
CREATE TABLE session_participants (session_code TEXT REFERENCES sessions(code) ON DELETE CASCADE, pid TEXT, name TEXT NOT NULL, talk_ms BIGINT DEFAULT 0, turns INT DEFAULT 0, invites INT DEFAULT 0, PRIMARY KEY (session_code, pid));
CREATE TABLE utterances (id BIGSERIAL PRIMARY KEY, session_code TEXT REFERENCES sessions(code) ON DELETE CASCADE, pid TEXT, seq INT, text TEXT NOT NULL, relevance REAL, embedding vector(256), spoken_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX utterances_embedding ON utterances USING hnsw (embedding vector_cosine_ops);
CREATE TABLE evaluations (session_code TEXT REFERENCES sessions(code) ON DELETE CASCADE, pid TEXT, participation INT, knowledge INT, overall INT, relevance INT, feedback TEXT, PRIMARY KEY (session_code, pid));
