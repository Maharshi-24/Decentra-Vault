import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import FormData from 'form-data';
import { authenticateApiKey } from '../middleware/auth.js';
import { supabase } from '../config/supabase.js';

const router = express.Router();

// Multer: hold file in RAM temporarily before processing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Master key from env (32-byte hex → Buffer)
const MASTER_KEY = Buffer.from(process.env.MASTER_ENCRYPTION_KEY, 'hex');
const MASTER_KEY_VERSION = parseInt(process.env.MASTER_KEY_VERSION || '1');
const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_GATEWAY = 'https://gateway.pinata.cloud/ipfs';

/**
 * Upload an encrypted file buffer to Pinata (IPFS).
 * Returns the CID string.
 */
async function uploadToPinata(fileBuffer, originalName) {
  const form = new FormData();
  form.append('file', fileBuffer, {
    filename: `enc_${originalName}`,
    contentType: 'application/octet-stream'
  });

  const metadata = JSON.stringify({ name: `dv_${Date.now()}_${originalName}` });
  form.append('pinataMetadata', metadata);

  const options = JSON.stringify({ cidVersion: 1 });
  form.append('pinataOptions', options);

  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
      ...form.getHeaders()
    },
    body: form
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Pinata upload failed: ${err}`);
  }

  const result = await response.json();
  return result.IpfsHash; // The CID
}

/**
 * Encrypt a Buffer with AES-256-GCM.
 * Returns { ciphertext, iv, authTag } all as hex strings.
 */
function aesEncrypt(buffer, key) {
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

/**
 * POST /api/files/upload
 * Authenticated via x-api-key header.
 * Accepts multipart/form-data with a "file" field.
 *
 * Step 4: AES-256-GCM file encryption + file_keys storage.
 * Step 5 (next): Replace simulatedCid with real Pinata IPFS upload.
 */
router.post('/upload', authenticateApiKey, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file provided. Send multipart/form-data with field name "file".' });
    }

    const developerId = req.developerId;

    // ── 1. Generate a unique per-file AES-256 key ──────────────────────────────
    const fileKey = crypto.randomBytes(32); // 256-bit

    // ── 2. Encrypt the raw file with the per-file key ──────────────────────────
    const { ciphertext: encryptedFile, iv: fileIv, authTag: fileAuthTag } = aesEncrypt(file.buffer, fileKey);

    // ── 3. Hash the ENCRYPTED file (not the plaintext) ────────────────────────
    const fileHash = crypto.createHash('sha256').update(encryptedFile).digest('hex');

    // ── 4. Wrap the per-file key with the master key (key wrapping) ────────────
    //    Store this in file_keys — the raw fileKey is NEVER persisted.
    const { ciphertext: encryptedKey, iv: keyIv, authTag: keyAuthTag } = aesEncrypt(fileKey, MASTER_KEY);

    // ── 5. Upload encrypted file to Pinata (IPFS) ────────────────────────────
    //    We upload the ENCRYPTED bytes — plaintext never leaves the server.
    const cid = await uploadToPinata(encryptedFile, file.originalname);

    // ── 6. Store file metadata ─────────────────────────────────────────────────
    const { data: fileRecord, error: dbError } = await supabase
      .from('files')
      .insert({
        developer_id: developerId,
        cid: cid,
        hash: fileHash,
        original_name: file.originalname,
        mime_type: file.mimetype,
        size_bytes: file.size
      })
      .select()
      .single();

    if (dbError) {
      console.error('DB Error storing file metadata:', dbError);
      return res.status(500).json({ error: 'Failed to record file metadata' });
    }

    // ── 7. Store wrapped file key + IV in file_keys ───────────────────────────
    const { error: keyDbError } = await supabase
      .from('file_keys')
      .insert({
        file_id: fileRecord.file_id,
        encrypted_key: encryptedKey.toString('hex') + ':' + keyAuthTag,
        iv: keyIv,
        master_key_version: MASTER_KEY_VERSION
      });

    if (keyDbError) {
      console.error('DB Error storing file key:', keyDbError);
      // Rollback: remove orphaned file record
      await supabase.from('files').delete().eq('file_id', fileRecord.file_id);
      return res.status(500).json({ error: 'Failed to store encryption key' });
    }

    res.status(201).json({
      message: 'File encrypted and uploaded to IPFS successfully',
      fileId: fileRecord.file_id,
      hash: fileHash,
      cid: cid,
      ipfsUrl: `${PINATA_GATEWAY}/${cid}`
    });

  } catch (error) {
    console.error('File Upload Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/files
 * List files belonging to the authenticated developer.
 */
router.get('/', authenticateApiKey, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('files')
      .select('file_id, original_name, mime_type, size_bytes, hash, cid, created_at')
      .eq('developer_id', req.developerId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ files: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

/**
 * GET /api/files/:id
 * Get metadata for a single file by ID.
 */
router.get('/:id', authenticateApiKey, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('files')
      .select('file_id, original_name, mime_type, size_bytes, hash, cid, blockchain_tx, created_at')
      .eq('file_id', req.params.id)
      .eq('developer_id', req.developerId)
      .single();

    if (error || !data) return res.status(404).json({ error: 'File not found' });
    res.json({ file: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch file' });
  }
});

/**
 * DELETE /api/files/:id
 * Permanently delete a file record and its associated key.
 */
router.delete('/:id', authenticateApiKey, async (req, res) => {
  try {
    // Verify ownership
    const { data, error: fetchError } = await supabase
      .from('files')
      .select('file_id, developer_id')
      .eq('file_id', req.params.id)
      .eq('developer_id', req.developerId)
      .single();

    if (fetchError || !data) return res.status(404).json({ error: 'File not found' });

    // Delete the encryption key first (foreign key)
    await supabase.from('file_keys').delete().eq('file_id', data.file_id);

    // Delete the file record
    const { error: deleteError } = await supabase
      .from('files')
      .delete()
      .eq('file_id', data.file_id);

    if (deleteError) throw deleteError;
    res.json({ success: true, message: 'File deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

export default router;
