-- DecentraVault Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Developers table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS developers (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  developer_id UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
  key_prefix TEXT NOT NULL, -- First 8 chars, e.g., 'dv_92af'
  api_key_hash TEXT NOT NULL UNIQUE, -- SHA-256 hash of full key
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Files table
CREATE TABLE IF NOT EXISTS files (
  file_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  developer_id UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
  cid TEXT NOT NULL, -- IPFS Content Identifier
  hash TEXT NOT NULL, -- SHA-256 of encrypted file
  merkle_proof JSONB, -- Sibling hashes for Merkle verification
  merkle_root TEXT, -- On-chain Merkle root
  blockchain_tx TEXT, -- Blockchain transaction reference
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- File Keys table (encryption keys wrapped with master key)
CREATE TABLE IF NOT EXISTS file_keys (
  file_id UUID PRIMARY KEY REFERENCES files(file_id) ON DELETE CASCADE,
  encrypted_key TEXT NOT NULL, -- File key wrapped with server master key
  iv TEXT NOT NULL, -- Initialization vector for AES-256-GCM
  master_key_version INTEGER NOT NULL DEFAULT 1, -- Enables key rotation
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_api_keys_developer ON api_keys(developer_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(api_key_hash);
CREATE INDEX IF NOT EXISTS idx_files_developer ON files(developer_id);
CREATE INDEX IF NOT EXISTS idx_files_cid ON files(cid);

-- Row Level Security (RLS) policies
ALTER TABLE developers ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_keys ENABLE ROW LEVEL SECURITY;

-- Policy: Developers can only see their own data
CREATE POLICY "Developers can view own data" 
  ON developers FOR SELECT 
  USING (auth.uid() = id);

CREATE POLICY "Developers can view own API keys" 
  ON api_keys FOR ALL 
  USING (developer_id = auth.uid());

CREATE POLICY "Developers can view own files" 
  ON files FOR ALL 
  USING (developer_id = auth.uid());

CREATE POLICY "Developers can view own file keys" 
  ON file_keys FOR ALL 
  USING (file_id IN (SELECT file_id FROM files WHERE developer_id = auth.uid()));
