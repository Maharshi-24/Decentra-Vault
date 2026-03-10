# 🚀 DecentraVault Integration Guide

**Build secure file storage into your app in under 10 minutes.**

This guide shows you exactly how to integrate DecentraVault so that **your end-users** can upload and retrieve files through **your application** — with bank-grade encryption, decentralized storage, and blockchain verification all handled automatically.

---

## 📋 Table of Contents

- [Prerequisites](#prerequisites)
- [Integration Overview](#integration-overview)
- [Step 1: Get Your API Key](#step-1-get-your-api-key)
- [Step 2: Install the SDK](#step-2-install-the-sdk)
- [Step 3: Setup Your Database](#step-3-setup-your-database)
- [Step 4: Implement File Upload](#step-4-implement-file-upload)
- [Step 5: Implement File Retrieval](#step-5-implement-file-retrieval)
- [Step 6: Add Verification (Optional)](#step-6-add-verification-optional)
- [Complete Integration Examples](#complete-integration-examples)
  - [Healthcare App — Medical Records](#healthcare-app--medical-records)
  - [Legal Platform — Document Storage](#legal-platform--document-storage)
  - [SaaS App — Customer Files](#saas-app--customer-files)
- [What Your Users See](#what-your-users-see)
- [Security Best Practices](#security-best-practices)
- [Troubleshooting](#troubleshooting)
- [Next Steps](#next-steps)

---

## Prerequisites

- **Node.js 18+** or any modern JavaScript runtime
- A database (PostgreSQL, MySQL, MongoDB, etc.) for your app
- Basic knowledge of async/await in JavaScript/TypeScript

---

## Integration Overview

Here's how DecentraVault fits into your application:

```
┌─────────────────────────────────────────────────────────────────┐
│                        YOUR APPLICATION                         │
│                                                                 │
│  ┌─────────────┐       ┌──────────────┐      ┌──────────────┐ │
│  │  Your Users │──────►│  Your Server │─────►│  Your Database│ │
│  │ (patients,  │       │   (API)      │      │               │ │
│  │  clients)   │       │              │      │  user_id      │ │
│  └─────────────┘       │      ↕       │      │  file_name    │ │
│                        │              │      │  dv_file_id ← Save this! │
│                        │ DecentraVault│      └──────────────┘ │
│                        │    SDK       │                        │
│                        └──────────────┘                        │
└────────────────────────────│──────────────────────────────────┘
                             │
                             ↓
              ┌──────────────────────────────┐
              │    DecentraVault Service     │
              │  (Encryption + IPFS + Chain) │
              └──────────────────────────────┘
```

**Key Concept:** 
- **Your users** → interact with **your app**
- **Your app** → uses **DecentraVault SDK** to store files securely
- **Your database** → stores the `fileId` to retrieve files later

---

## Step 1: Get Your API Key

1. Go to [https://decentra-vault.onrender.com](https://decentra-vault.onrender.com)
2. Click **Sign Up** and create a developer account
3. Navigate to **Dashboard → API Keys**
4. Click **Generate New API Key**
5. **Copy the key immediately** (starts with `dv_`) — it's only shown once!

**Store it securely:**

```bash
# .env
DECENTRAVAULT_API_KEY=dv_your_api_key_here
```

> ⚠️ **Never commit API keys to version control or expose them in client-side code!**

---

## Step 2: Install the SDK

```bash
npm install decentravault
```

Import in your backend code:

```javascript
import { DecentraVault } from 'decentravault';

const vault = new DecentraVault(process.env.DECENTRAVAULT_API_KEY);
```

For local development, point to your local server:

```javascript
const vault = new DecentraVault(process.env.DECENTRAVAULT_API_KEY, {
  baseUrl: 'http://localhost:3000/api'
});
```

---

## Step 3: Setup Your Database

You need to store the relationship between **your users** and **their files** in DecentraVault.

### Minimum Required Schema

```sql
-- Example: PostgreSQL
CREATE TABLE user_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,                    -- Your user's ID
  decentravault_file_id TEXT NOT NULL,      -- ← The fileId from DecentraVault
  original_filename TEXT NOT NULL,
  file_type TEXT,                           -- e.g. 'medical_record', 'invoice'
  uploaded_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_files_user ON user_files(user_id);
CREATE INDEX idx_user_files_dv_id ON user_files(decentravault_file_id);
```

### Recommended Schema (with metadata)

```sql
CREATE TABLE user_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Your app's data
  user_id UUID NOT NULL REFERENCES users(id),
  original_filename TEXT NOT NULL,
  file_category TEXT,                       -- 'medical', 'legal', 'financial'
  description TEXT,
  uploaded_by UUID REFERENCES users(id),
  uploaded_at TIMESTAMP DEFAULT NOW(),
  
  -- DecentraVault data (returned from SDK)
  decentravault_file_id TEXT NOT NULL,      -- ← Store this!
  file_hash TEXT,                           -- SHA-256 hash
  ipfs_cid TEXT,                            -- IPFS Content ID
  blockchain_tx TEXT,                       -- Polygon transaction hash
  blockchain_status TEXT,                   -- 'pending' | 'confirmed' | 'failed'
  
  -- Optional: cache for display
  mime_type TEXT,
  size_bytes INTEGER
);
```

---

## Step 4: Implement File Upload

### Backend Endpoint Example

```javascript
// routes/files.js
import { DecentraVault } from 'decentravault';
import multer from 'multer';

const vault = new DecentraVault(process.env.DECENTRAVAULT_API_KEY);
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/files/upload
app.post('/api/files/upload', authenticateUser, upload.single('file'), async (req, res) => {
  try {
    const userId = req.user.id;  // From your auth middleware
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    
    // 1. Upload to DecentraVault (encrypts + stores on IPFS + anchors on blockchain)
    const uploadResult = await vault.upload(
      file.buffer,
      file.originalname,
      file.mimetype
    );
    
    // 2. Save the fileId and metadata in YOUR database
    const record = await db.query(`
      INSERT INTO user_files (
        user_id,
        original_filename,
        decentravault_file_id,
        file_hash,
        ipfs_cid,
        blockchain_status,
        mime_type,
        size_bytes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      userId,
      file.originalname,
      uploadResult.fileId,          // ← Store this!
      uploadResult.hash,
      uploadResult.cid,
      uploadResult.blockchainStatus,
      file.mimetype,
      file.size
    ]);
    
    // 3. Return success to your user
    res.json({
      success: true,
      fileId: record.rows[0].id,    // Your database ID
      status: uploadResult.blockchainStatus,
      message: 'File uploaded securely'
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});
```

### Frontend (React Example)

```tsx
// components/FileUpload.tsx
import { useState } from 'react';

export function FileUpload() {
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState('');

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setStatus('Uploading...');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const result = await response.json();
      setStatus('✅ File uploaded and secured!');
      
      // Optionally wait for blockchain confirmation
      if (result.status === 'pending') {
        setStatus('✅ Uploaded! Waiting for blockchain confirmation...');
        // You could poll your backend or use websockets here
      }

    } catch (error) {
      setStatus('❌ Upload failed');
      console.error(error);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <input 
        type="file" 
        onChange={handleUpload} 
        disabled={uploading}
      />
      {status && <p>{status}</p>}
    </div>
  );
}
```

---

## Step 5: Implement File Retrieval

### Backend Endpoint Example

```javascript
// GET /api/files/:id/download
app.get('/api/files/:id/download', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const fileId = req.params.id;  // Your database ID
    
    // 1. Look up the file in YOUR database
    const record = await db.query(`
      SELECT 
        decentravault_file_id,
        original_filename,
        mime_type
      FROM user_files
      WHERE id = $1 AND user_id = $2
    `, [fileId, userId]);
    
    if (record.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const { decentravault_file_id, original_filename, mime_type } = record.rows[0];
    
    // 2. Retrieve from DecentraVault using the saved fileId
    const retrieveResult = await vault.retrieve(decentravault_file_id);
    
    // 3. Verify integrity
    if (retrieveResult.integrity !== 'ok') {
      return res.status(422).json({ 
        error: 'File integrity check failed',
        details: 'The file may have been tampered with'
      });
    }
    
    // 4. Return the decrypted file to your user
    res.setHeader('Content-Type', mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${original_filename}"`);
    res.send(Buffer.from(retrieveResult.file));
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});
```

### Frontend (React Example)

```tsx
// components/FileList.tsx
interface UserFile {
  id: string;
  originalFilename: string;
  uploadedAt: string;
}

export function FileList({ files }: { files: UserFile[] }) {
  
  async function downloadFile(fileId: string, filename: string) {
    try {
      const response = await fetch(`/api/files/${fileId}/download`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Download failed');
      }

      // Create a download link
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

    } catch (error) {
      alert('Download failed');
      console.error(error);
    }
  }

  return (
    <div>
      <h2>Your Files</h2>
      <ul>
        {files.map(file => (
          <li key={file.id}>
            <span>{file.originalFilename}</span>
            <span>{new Date(file.uploadedAt).toLocaleDateString()}</span>
            <button onClick={() => downloadFile(file.id, file.originalFilename)}>
              Download
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

## Step 6: Add Verification (Optional)

Show your users that their files are tamper-proof with blockchain verification.

```javascript
// GET /api/files/:id/verify
app.get('/api/files/:id/verify', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const fileId = req.params.id;
    
    // Look up the DecentraVault file ID
    const record = await db.query(`
      SELECT decentravault_file_id 
      FROM user_files
      WHERE id = $1 AND user_id = $2
    `, [fileId, userId]);
    
    if (record.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const { decentravault_file_id } = record.rows[0];
    
    // Verify against blockchain (no download required)
    const verifyResult = await vault.verify(decentravault_file_id);
    
    res.json({
      verified: verifyResult.verified,
      reason: verifyResult.reason,
      blockchainTx: verifyResult.blockchainTx,
      explorerUrl: verifyResult.blockchainTx 
        ? `https://amoy.polygonscan.com/tx/${verifyResult.blockchainTx}`
        : null
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Verification failed' });
  }
});
```

**Frontend Badge:**

```tsx
function VerifiedBadge({ fileId }: { fileId: string }) {
  const [verified, setVerified] = useState<boolean | null>(null);
  const [txUrl, setTxUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/files/${fileId}/verify`)
      .then(r => r.json())
      .then(data => {
        setVerified(data.verified);
        setTxUrl(data.explorerUrl);
      });
  }, [fileId]);

  if (verified === null) return <span>⏳ Verifying...</span>;
  if (!verified) return <span>⚠️ Verification failed</span>;
  
  return (
    <a href={txUrl!} target="_blank" rel="noopener">
      ✅ Blockchain Verified
    </a>
  );
}
```

---

## Complete Integration Examples

### Healthcare App — Medical Records

```javascript
// ═══════════════════════════════════════════════════════════════
// Patient uploads their X-ray
// ═══════════════════════════════════════════════════════════════

// POST /api/patients/:patientId/records
app.post('/api/patients/:patientId/records', authenticateDoctor, upload.single('file'), async (req, res) => {
  const patientId = req.params.patientId;
  const doctorId = req.user.id;
  const file = req.file;
  const { recordType, notes } = req.body;
  
  // Upload to DecentraVault
  const { fileId, hash, blockchainStatus } = await vault.upload(
    file.buffer,
    file.originalname,
    file.mimetype
  );
  
  // Save in your database
  await db.query(`
    INSERT INTO medical_records (
      patient_id,
      doctor_id,
      record_type,
      notes,
      decentravault_file_id,
      file_hash,
      blockchain_status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [patientId, doctorId, recordType, notes, fileId, hash, blockchainStatus]);
  
  res.json({ success: true, message: 'Medical record securely stored' });
});

// ═══════════════════════════════════════════════════════════════
// Patient views their medical history
// ═══════════════════════════════════════════════════════════════

// GET /api/patients/:patientId/records/:recordId
app.get('/api/patients/:patientId/records/:recordId', authenticatePatient, async (req, res) => {
  const { patientId, recordId } = req.params;
  
  // Verify patient owns this record
  const record = await db.query(`
    SELECT decentravault_file_id, record_type, notes, file_hash
    FROM medical_records
    WHERE id = $1 AND patient_id = $2
  `, [recordId, patientId]);
  
  if (record.rows.length === 0) {
    return res.status(404).json({ error: 'Record not found' });
  }
  
  // Retrieve from DecentraVault
  const { file, integrity, blockchain } = await vault.retrieve(
    record.rows[0].decentravault_file_id
  );
  
  if (integrity !== 'ok') {
    return res.status(422).json({ error: 'File integrity compromised' });
  }
  
  res.json({
    file: Buffer.from(file).toString('base64'),
    recordType: record.rows[0].record_type,
    notes: record.rows[0].notes,
    verified: blockchain.verified,
    blockchainTx: blockchain.tx
  });
});
```

---

### Legal Platform — Document Storage

```javascript
// ═══════════════════════════════════════════════════════════════
// Client uploads legal contract
// ═══════════════════════════════════════════════════════════════

// POST /api/contracts
app.post('/api/contracts', authenticateClient, upload.single('contract'), async (req, res) => {
  const clientId = req.user.id;
  const { contractType, parties } = req.body;
  
  // Upload to DecentraVault
  const uploadResult = await vault.upload(
    req.file.buffer,
    req.file.originalname,
    req.file.mimetype
  );
  
  // Save contract metadata
  const contract = await db.query(`
    INSERT INTO contracts (
      client_id,
      contract_type,
      parties,
      decentravault_file_id,
      ipfs_cid,
      file_hash
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `, [clientId, contractType, parties, uploadResult.fileId, uploadResult.cid, uploadResult.hash]);
  
  // Wait for blockchain confirmation (important for legal docs)
  await vault.waitForBlockchain(uploadResult.fileId);
  
  const verifyResult = await vault.verify(uploadResult.fileId);
  
  res.json({
    contractId: contract.rows[0].id,
    blockchainProof: verifyResult.blockchainTx,
    explorerUrl: `https://amoy.polygonscan.com/tx/${verifyResult.blockchainTx}`,
    message: 'Contract securely stored with blockchain proof'
  });
});

// ═══════════════════════════════════════════════════════════════
// Generate audit report for contract
// ═══════════════════════════════════════════════════════════════

// GET /api/contracts/:id/audit
app.get('/api/contracts/:id/audit', authenticateClient, async (req, res) => {
  const { id } = req.params;
  
  const contract = await db.query(`
    SELECT decentravault_file_id, file_hash, created_at
    FROM contracts
    WHERE id = $1 AND client_id = $2
  `, [id, req.user.id]);
  
  const verifyResult = await vault.verify(contract.rows[0].decentravault_file_id);
  
  res.json({
    contractId: id,
    uploadedAt: contract.rows[0].created_at,
    fileHash: contract.rows[0].file_hash,
    blockchainVerified: verifyResult.verified,
    blockchainTx: verifyResult.blockchainTx,
    onChainHash: verifyResult.onChainHash,
    auditStatus: verifyResult.verified ? 'UNTAMPERED' : 'INTEGRITY COMPROMISED'
  });
});
```

---

### SaaS App — Customer Files

```javascript
// ═══════════════════════════════════════════════════════════════
// Customer uploads file to their workspace
// ═══════════════════════════════════════════════════════════════

// POST /api/workspaces/:workspaceId/files
app.post('/api/workspaces/:workspaceId/files', authenticateUser, upload.single('file'), async (req, res) => {
  const { workspaceId } = req.params;
  const userId = req.user.id;
  const file = req.file;
  
  // Check user has access to workspace
  const access = await db.query(`
    SELECT 1 FROM workspace_members
    WHERE workspace_id = $1 AND user_id = $2
  `, [workspaceId, userId]);
  
  if (access.rows.length === 0) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  // Upload to DecentraVault
  const uploadResult = await vault.upload(file.buffer, file.originalname, file.mimetype);
  
  // Save in workspace
  await db.query(`
    INSERT INTO workspace_files (
      workspace_id,
      uploaded_by,
      file_name,
      decentravault_file_id,
      mime_type,
      size_bytes
    ) VALUES ($1, $2, $3, $4, $5, $6)
  `, [workspaceId, userId, file.originalname, uploadResult.fileId, file.mimetype, file.size]);
  
  res.json({ 
    success: true,
    fileId: uploadResult.fileId,
    status: uploadResult.blockchainStatus
  });
});

// ═══════════════════════════════════════════════════════════════
// List all files in workspace
// ═══════════════════════════════════════════════════════════════

// GET /api/workspaces/:workspaceId/files
app.get('/api/workspaces/:workspaceId/files', authenticateUser, async (req, res) => {
  const { workspaceId } = req.params;
  
  const files = await db.query(`
    SELECT 
      wf.id,
      wf.file_name,
      wf.mime_type,
      wf.size_bytes,
      wf.created_at,
      u.email as uploaded_by
    FROM workspace_files wf
    JOIN users u ON wf.uploaded_by = u.id
    WHERE wf.workspace_id = $1
    ORDER BY wf.created_at DESC
  `, [workspaceId]);
  
  res.json({ files: files.rows });
});
```

---

## What Your Users See

Your end-users **never interact directly** with DecentraVault. They only see your app's interface:

### Upload Experience:
```
┌────────────────────────────────────┐
│  Upload Medical Record             │
│                                    │
│  [Choose File] xray.jpg            │
│                                    │
│  Record Type: [X-ray ▾]           │
│                                    │
│  Notes: [Chest X-ray for checkup] │
│                                    │
│       [Upload Securely]            │
│                                    │
│  Status: ✅ Uploaded and encrypted │
│          ⛓️ Blockchain verified    │
└────────────────────────────────────┘
```

### Retrieval Experience:
```
┌────────────────────────────────────┐
│  My Medical Records                │
│                                    │
│  ✅ Chest X-ray                    │
│     Uploaded: Mar 10, 2026         │
│     Blockchain: Verified ✓         │
│     [Download] [View]              │
│                                    │
│  ✅ Blood Test Results             │
│     Uploaded: Mar 5, 2026          │
│     Blockchain: Verified ✓         │
│     [Download] [View]              │
└────────────────────────────────────┘
```

**Users never need to know:**
- What an API key is
- What IPFS means
- What a blockchain is
- What a `fileId` looks like

They just upload and download files like any normal app!

---

## Security Best Practices

### ✅ DO

- **Store API keys server-side only** — never expose them in client code
- **Validate user permissions** before uploading/downloading files
- **Save the `fileId`** immediately after upload — you can't retrieve files without it
- **Check `integrity`** on every retrieval before serving to users
- **Use HTTPS** for all API communications
- **Implement rate limiting** to prevent abuse

### ❌ DON'T

- Don't hardcode API keys in source code
- Don't expose DecentraVault endpoints directly to clients
- Don't skip integrity checks on retrieval
- Don't allow users to access files they don't own
- Don't forget to handle blockchain confirmation delays

---

## Troubleshooting

### Upload fails with 401 Unauthorized
- **Cause:** Invalid API key
- **Fix:** Check that your API key is correct and active in the dashboard

### Upload fails with 413 Payload Too Large
- **Cause:** File exceeds 10MB limit
- **Fix:** Implement file size validation before upload, or contact support for enterprise limits

### Blockchain status stays "pending" forever
- **Cause:** Blockchain network congestion or anchor wallet out of gas
- **Fix:** Wait longer (can take 30-60s), or check status via `/api/files/:id` endpoint

### Integrity check fails on retrieval
- **Cause:** File was tampered with on IPFS or database corruption
- **Fix:** This is a **critical security alert** — do not serve the file to users. Investigate immediately.

### "File not found" error on retrieve
- **Cause:** Wrong `fileId` or file was deleted
- **Fix:** Verify the `fileId` in your database is correct

---

## Next Steps

✅ You now know how to integrate DecentraVault into your application!

**Recommended next steps:**

1. **Test in development** — Use `baseUrl: 'http://localhost:3000/api'` to test locally
2. **Add file deletion** — Use `vault.delete(fileId)` when users delete files
3. **Implement file sharing** — Store multiple `user_id` entries for shared files
4. **Add progress indicators** — Use `vault.waitForBlockchain()` to show blockchain confirmation
5. **Monitor usage** — Check your dashboard for upload counts and storage usage
6. **Plan for scale** — Contact support about enterprise plans when you reach 1000+ uploads/month

**Need help?**
- 📖 [Full SDK Reference](./sdk/README.md)
- 💬 [Support](mailto:support@decentravault.com)
- 📝 [GitHub Issues](https://github.com/decentravault/sdk/issues)

---

**Built with DecentraVault? We'd love to hear about it!** Share your integration story at hello@decentravault.com
