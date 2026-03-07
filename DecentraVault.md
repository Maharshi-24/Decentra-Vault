# Product Requirements Document (PRD)

## DecentraVault — Encrypted Decentralized File Storage as a Service

**Version:** 1.1  
**Status:** Draft  
**Last Updated:** March 2026  

---

## 1. Executive Summary

DecentraVault is a Developer-first SaaS platform that enables any application to store, encrypt, and retrieve user files across a decentralized blockchain network — with a single API call. Developers integrate DecentraVault the same way they integrate Firebase Storage or AWS S3, but with the added guarantees of end-to-end encryption, zero data loss, and tamper-proof file integrity through blockchain verification.

The platform abstracts all cryptographic and blockchain complexity behind a simple SDK so that developers can focus on building products, not infrastructure.

---

## 2. Problem Statement

### For Developers
- Building secure, decentralized file storage is complex, expensive, and time-consuming.
- Integrating encryption, IPFS, and blockchain verification requires specialized expertise most teams don't have.
- Centralized storage solutions (S3, Firebase) are single points of failure and high-value hacker targets.

### For End Users
- User data stored in centralized cloud systems is vulnerable to breaches.
- Once a server is compromised, data is exposed in plaintext.
- Data can be lost, deleted, or censored by a single storage provider.

### The Gap
There is no simple, developer-friendly SaaS that combines **encryption + decentralized storage + blockchain verification** into one plug-and-play service.

---

## 3. Vision

> *"The Firebase of decentralized, encrypted file storage — one API key, zero complexity, maximum security."*

DecentraVault empowers developers to give their users bank-grade file security without writing a single line of cryptographic or blockchain code.

---

## 4. Target Users

### Primary: Developers / Engineering Teams
- SaaS founders who want secure document storage without building infrastructure.
- Mobile/web app developers handling sensitive user files (medical records, legal docs, financial data).
- Enterprises needing compliant, auditable file storage.

### Secondary: End Users (via Developer Apps)
- Patients, customers, and individuals whose files are stored through apps built on DecentraVault.
- They benefit from security without ever knowing the underlying system.

---

## 5. Core Value Propositions

| Value | Description |
|---|---|
| **One-step integration** | A single SDK call handles encryption, upload, and blockchain anchoring. |
| **Zero data loss** | Files are fragmented and distributed across the IPFS/blockchain network — no single server holds the full file. |
| **Hacker-resistant** | Files are AES-256-GCM encrypted before leaving the client. Even if storage is breached, data is unreadable. |
| **Tamper-proof** | Every file hash is anchored on-chain. Any modification is instantly detectable. |
| **Zero-knowledge** | The server never decrypts files. All decryption happens locally in the SDK — not even DecentraVault can read user data. |
| **Developer convenience** | No cryptography expertise required. No blockchain knowledge needed. Just an API key. |

---

## 6. System Architecture Overview

### 6.1 High-Level Flow

```
Developer App (User uploads a file)
        ↓
SDK encrypts file client-side (AES-256-GCM)
        ↓
Encrypted file sent to DecentraVault API
        ↓
File fragmented and stored on IPFS (via Pinata)
        ↓
CID (Content Identifier) returned from IPFS
        ↓
SHA-256 hash of encrypted file computed
        ↓
Hash anchored to blockchain (Polygon)
        ↓
Metadata + encrypted key stored in database
        ↓
File ID returned to Developer App
```

### 6.2 Retrieval Flow

```
Developer App requests file by File ID
        ↓
API fetches CID from database
        ↓
Encrypted file downloaded from IPFS
        ↓
SHA-256 hash recomputed and verified against blockchain
        ↓
Encrypted key returned to SDK (server never decrypts)
        ↓
SDK decrypts key locally
        ↓
SDK decrypts file locally
        ↓
Plaintext file available in Developer App
```

> **Zero-Knowledge Guarantee:** The server never decrypts files or keys. All decryption happens client-side inside the SDK. Even DecentraVault cannot read user files.

### 6.3 Key System Components

- **Developer Portal** — Web dashboard for account creation, API key management, usage analytics.
- **REST API / SDK** — The integration layer developers use in their apps.
- **Encryption Service** — AES-256-GCM file encryption before any data leaves the client.
- **IPFS Storage Layer** — Decentralized file hosting. Pinata acts as a pinning service to keep files available on the IPFS network — it does not own the data, the network does.
- **Blockchain Anchoring** — File hash stored on Polygon for tamper-proof verification.
- **Database (Supabase)** — Stores metadata, encrypted keys, and developer records.

---

## 7. Database Design

### developers
| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key (Supabase Auth) |
| email | String | Developer email |
| plan | Enum | free / pro / enterprise |
| created_at | Timestamp | |

### api_keys
| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| developer_id | UUID | Foreign key → developers |
| key_prefix | String | First 8 chars e.g. `dv_92af` — safe for logs, never exposes full key |
| api_key_hash | String | SHA-256 hash of the full key (raw key never stored) |
| status | Enum | active / revoked |
| created_at | Timestamp | |

### files
| Column | Type | Notes |
|---|---|---|
| file_id | UUID | Primary key |
| developer_id | UUID | Foreign key → developers |
| cid | String | IPFS Content Identifier |
| hash | String | SHA-256 of encrypted file |
| merkle_proof | JSON | Sibling hashes needed to verify against Merkle root |
| merkle_root | String | The on-chain root this file belongs to |
| blockchain_tx | String | On-chain transaction reference |
| created_at | Timestamp | |

### file_keys
| Column | Type | Notes |
|---|---|---|
| file_id | UUID | Foreign key → files |
| encrypted_key | String | File key wrapped with server master key |
| iv | String | Initialization vector for AES-256-GCM |
| master_key_version | Integer | Which master key version was used — enables key rotation |
| created_at | Timestamp | |

> **Security Note:** Raw encryption keys are never stored. All file keys are wrapped with a versioned server master key (key wrapping). The `master_key_version` field enables future key rotation without re-encrypting all files at once.

---

## 8. Encryption Key Flow

```
File Key (generated per file)
        ↓
Encrypt file → encrypted_file
        ↓
encrypted_key = AES_encrypt(fileKey, SERVER_MASTER_KEY)
        ↓
Store encrypted_key + IV in file_keys table
```

This means even a full database breach exposes no usable keys.

---

## 9. Blockchain Integrity — Merkle Tree Strategy

### Phase 1 (Launch)
Each file hash is stored directly on-chain:
```
fileID → hash → blockchain transaction
```
Simple to build and verify. Suitable for early-stage volume.

### Phase 2 (Scale)
Every N files are batched into a **Merkle Tree**:
```
hash1 + hash2 → hash12
hash3 + hash4 → hash34
hash12 + hash34 → rootHash → blockchain
```
One transaction represents N files, dramatically reducing on-chain costs while maintaining full verifiability. Any individual file can be proven against the root via a Merkle Proof.

Each file's Merkle proof (the sibling hashes needed to recompute the root) is stored in the `files` table at upload time. Without storing the proof, future verification becomes impossible once the tree is no longer in memory.

---

## 10. Developer Experience

### 10.1 Onboarding Flow
1. Developer signs up at the DecentraVault portal.
2. Dashboard auto-generates a unique API key.
3. Developer installs the SDK (`npm install decentravault`).
4. One-line integration in their app.

### 10.2 SDK Usage Example

**Upload a file:**
```javascript
import { DecentraVault } from 'decentravault';

const vault = new DecentraVault('YOUR_API_KEY');

const { fileId } = await vault.upload(file);
```

**Retrieve a file:**
```javascript
const file = await vault.retrieve(fileId);
```

That is the entire developer surface. All encryption, IPFS, and blockchain logic is handled internally.

---

## 11. API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/generate-api-key` | Generate a new API key for a developer |
| POST | `/upload` | Upload and encrypt a file |
| GET | `/file/:id` | Retrieve a file by ID |
| DELETE | `/file/:id` | Delete a file |
| GET | `/file/:id/verify` | Verify file integrity against blockchain |

All endpoints require an `x-api-key` header for authentication.

---

## 12. Security Design

| Layer | Mechanism |
|---|---|
| **Transit** | HTTPS/TLS for all API communication |
| **File Encryption** | AES-256-GCM per-file encryption (CBC is not used — vulnerable to padding attacks) |
| **Zero-Knowledge** | Server returns encrypted key to SDK; all decryption is client-side only |
| **Key Wrapping** | File keys encrypted with versioned server master key; supports rotation |
| **API Authentication** | SHA-256 hashed API keys with debuggable prefix (`dv_xxxx`); raw keys never stored |
| **Integrity Verification** | On-chain SHA-256 hash + Merkle proof comparison on every retrieval |
| **Decentralized Storage** | No single server holds a complete, readable file |

---

## 13. Feature Scope

### MVP (Phase 1)
- Developer registration and portal dashboard
- API key generation and management
- File upload with AES-256 encryption
- IPFS storage via Pinata
- Blockchain hash anchoring (per-file)
- File retrieval with integrity verification
- JavaScript/TypeScript SDK

### Phase 2
- Merkle Tree batching for cost-efficient blockchain anchoring
- Usage analytics dashboard
- Billing and plan management (Free / Pro / Enterprise)
- File deletion and key revocation

### Phase 3
- Multi-language SDKs (Python, Go, Swift)
- Webhook support for upload/retrieval events
- Team accounts and role-based access
- Compliance exports (SOC 2, HIPAA-ready)

---

## 14. Non-Functional Requirements

| Requirement | Target |
|---|---|
| **Availability** | 99.9% uptime SLA |
| **Upload Latency** | < 3 seconds for files under 10MB |
| **Retrieval Latency** | < 2 seconds for cached CIDs |
| **Encryption** | AES-256-GCM |
| **Blockchain Network** | Polygon (low cost, EVM compatible) |
| **Scalability** | Designed for millions of files per developer |

---

## 15. Development Roadmap

| Step | Task |
|---|---|
| 1 | Supabase auth + developer dashboard |
| 2 | API key generation endpoint |
| 3 | API key authentication middleware |
| 4 | File upload endpoint |
| 5 | Pinata (IPFS) integration |
| 6 | SHA-256 hash generation |
| 7 | Polygon blockchain integration |
| 8 | File retrieval + hash verification |
| 9 | SDK packaging and documentation |

---

## 16. Success Metrics

- **Developer Adoption:** Number of active API keys
- **File Operations:** Daily upload and retrieval volume
- **Integrity Score:** % of files passing blockchain verification
- **Uptime:** Monthly availability percentage
- **Time to First Upload:** Average time from signup to first successful file upload (target: < 10 minutes)

---

## 17. Out of Scope (v1)

- Real-time file collaboration
- File versioning / history
- End-to-end encrypted file sharing between users
- Mobile SDK (deferred to Phase 3)

---

*This document reflects the architecture, design decisions, and technical context established during the initial system design phase.*
