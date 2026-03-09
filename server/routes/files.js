import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { ethers } from 'ethers';
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

// ── Blockchain setup (Polygon Amoy testnet) ────────────────────────────────
const polygonProvider = new ethers.JsonRpcProvider(process.env.POLYGON_AMOY_RPC);
const anchorWallet = new ethers.Wallet(process.env.WALLET_PRIVATE_KEY, polygonProvider);

console.log(`[Blockchain] Anchor wallet ready: ${anchorWallet.address}`);

/**
 * Upload an encrypted file buffer to Pinata (IPFS).
 * Uses Node.js native FormData + Blob (compatible with native fetch).
 * Returns the CID string.
 */
async function uploadToPinata(fileBuffer, fileHash) {
  // Use native Blob + FormData — no npm form-data package needed
  const blob = new Blob([fileBuffer], { type: 'application/octet-stream' });
  const form = new FormData();

  // Use the SHA-256 hash as filename — original name NEVER sent to Pinata
  // Pinata only sees an opaque hex string. No metadata reveals what the file is.
  form.append('file', blob, fileHash);
  form.append('pinataMetadata', JSON.stringify({ name: fileHash }));
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));

  // Do NOT set Content-Type manually — fetch sets it automatically with the correct boundary
  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`
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
 * Decrypt a Buffer with AES-256-GCM.
 * Returns the decrypted Buffer.
 */
function aesDecrypt(ciphertextHex, authTagHex, ivHex, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final()
  ]);
}

/**
 * Anchor a SHA-256 file hash on Polygon Amoy.
 * Sends a self-transaction with the hash encoded in the data field.
 * Non-blocking — updates the DB with blockchain_tx + status when done.
 */
async function anchorOnChain(fileId, hash) {
  try {
    console.log(`[Blockchain] Anchoring file ${fileId} with hash ${hash}...`);

    const tx = await anchorWallet.sendTransaction({
      to: anchorWallet.address,   // self-send (lowest cost)
      value: 0n,
      data: '0x' + hash           // SHA-256 hash embedded in tx data
    });

    console.log(`[Blockchain] Tx submitted: ${tx.hash} — waiting for confirmation...`);

    const receipt = await tx.wait(1); // wait for 1 block confirmation

    await supabase
      .from('files')
      .update({ blockchain_tx: receipt.hash, blockchain_status: 'confirmed' })
      .eq('file_id', fileId);

    console.log(`[Blockchain] ✅ Confirmed: ${receipt.hash}`);
  } catch (err) {
    console.error(`[Blockchain] ❌ Anchoring failed for ${fileId}:`, err.message);
    await supabase
      .from('files')
      .update({ blockchain_status: 'failed' })
      .eq('file_id', fileId);
  }
}

/**
 * Verify a file hash against its on-chain transaction.
 * Fetches the tx from Polygon, reads the data field, compares with expected hash.
 * Returns { verified, onChainHash }.
 */
async function verifyOnChain(blockchainTx, expectedHash) {
  const tx = await polygonProvider.getTransaction(blockchainTx);
  if (!tx) return { verified: false, onChainHash: null, reason: 'Transaction not found on chain' };

  const onChainHash = tx.data.startsWith('0x') ? tx.data.slice(2) : tx.data;
  const verified = onChainHash === expectedHash;
  return { verified, onChainHash };
}

/**
 * POST /api/files/upload
 * Authenticated via x-api-key header.
 * Accepts multipart/form-data with a "file" field.
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
    //    Filename = SHA-256 hash only — original name stays in our DB, never in Pinata
    const cid = await uploadToPinata(encryptedFile, fileHash);

    // ── 6. Store file metadata ─────────────────────────────────────────────────
    const { data: fileRecord, error: dbError } = await supabase
      .from('files')
      .insert({
        developer_id: developerId,
        cid: cid,
        hash: fileHash,
        original_name: file.originalname,
        mime_type: file.mimetype,
        size_bytes: file.size,
        blockchain_status: 'pending'
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
        iv: keyIv,                  // IV used to wrap the per-file key
        file_iv: fileIv,            // IV used to encrypt the actual file
        file_auth_tag: fileAuthTag, // GCM auth tag for the file — needed for decryption
        master_key_version: MASTER_KEY_VERSION
      });

    if (keyDbError) {
      console.error('DB Error storing file key:', keyDbError);
      // Rollback: remove orphaned file record
      await supabase.from('files').delete().eq('file_id', fileRecord.file_id);
      return res.status(500).json({ error: 'Failed to store encryption key' });
    }

    // Respond immediately — blockchain anchoring runs in the background
    res.status(201).json({
      message: 'File encrypted and uploaded to IPFS successfully',
      fileId: fileRecord.file_id,
      hash: fileHash,
      cid: cid,
      ipfsUrl: `${PINATA_GATEWAY}/${cid}`,
      blockchain_status: 'pending'
    });

    // ── 8. Anchor hash on Polygon Amoy (non-blocking, fire-and-forget) ────────
    anchorOnChain(fileRecord.file_id, fileHash);

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
      .select('file_id, original_name, mime_type, size_bytes, hash, cid, blockchain_tx, blockchain_status, created_at')
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
 * GET /api/files/:id/verify
 * Lightweight integrity check — verifies stored hash against Polygon blockchain.
 * Does NOT download the file from IPFS.
 */
router.get('/:id/verify', authenticateApiKey, async (req, res) => {
  try {
    const { data: file, error } = await supabase
      .from('files')
      .select('file_id, hash, blockchain_tx, blockchain_status')
      .eq('file_id', req.params.id)
      .eq('developer_id', req.developerId)
      .single();

    if (error || !file) return res.status(404).json({ error: 'File not found' });

    if (!file.blockchain_tx || file.blockchain_status !== 'confirmed') {
      return res.json({
        verified: false,
        reason: file.blockchain_status === 'pending'
          ? 'Blockchain anchoring is still pending'
          : 'File has not been anchored on chain',
        blockchain_status: file.blockchain_status
      });
    }

    const { verified, onChainHash } = await verifyOnChain(file.blockchain_tx, file.hash);

    res.json({
      verified,
      reason: verified
        ? 'Hash matches on-chain record — file is intact'
        : 'Hash mismatch — file may have been tampered with',
      file_id: file.file_id,
      hash: file.hash,
      on_chain_hash: onChainHash,
      blockchain_tx: file.blockchain_tx
    });
  } catch (error) {
    console.error('Verify Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/files/:id/download
 * Full retrieval pipeline:
 *   1. Fetch encrypted bytes from IPFS
 *   2. Re-hash and verify against blockchain
 *   3. Unwrap the per-file AES key
 *   4. Return encrypted bytes + key material to the SDK for client-side decryption
 *
 * The server NEVER decrypts the file — zero-knowledge guarantee.
 */
router.get('/:id/download', authenticateApiKey, async (req, res) => {
  try {
    // ── 1. Fetch file metadata ────────────────────────────────────────────────
    const { data: file, error: fileError } = await supabase
      .from('files')
      .select('file_id, cid, hash, blockchain_tx, blockchain_status, original_name, mime_type, size_bytes')
      .eq('file_id', req.params.id)
      .eq('developer_id', req.developerId)
      .single();

    if (fileError || !file) return res.status(404).json({ error: 'File not found' });

    // ── 2. Fetch the wrapped key + file IV from file_keys ──────────────────
    const { data: keyRecord, error: keyError } = await supabase
      .from('file_keys')
      .select('encrypted_key, iv, file_iv, file_auth_tag')
      .eq('file_id', req.params.id)
      .single();

    if (keyError || !keyRecord) return res.status(500).json({ error: 'Encryption key not found' });

    // ── 3. Download encrypted bytes from IPFS ───────────────────────────
    console.log(`[Download] Fetching CID ${file.cid} from IPFS...`);
    const ipfsResponse = await fetch(`${PINATA_GATEWAY}/${file.cid}`);
    if (!ipfsResponse.ok) throw new Error(`IPFS fetch failed: ${ipfsResponse.status}`);
    const encryptedBytes = Buffer.from(await ipfsResponse.arrayBuffer());

    // ── 4. Re-hash the downloaded bytes and compare with stored hash ────────
    const downloadedHash = crypto.createHash('sha256').update(encryptedBytes).digest('hex');
    const integrityOk = downloadedHash === file.hash;

    if (!integrityOk) {
      console.error(`[Download] ❌ Integrity FAILED for ${file.file_id}`);
      return res.status(422).json({
        error: 'Integrity check failed — downloaded file hash does not match stored hash',
        integrity: 'FAILED'
      });
    }

    // ── 5. Verify hash against Polygon blockchain ───────────────────────
    let blockchainVerified = false;
    let blockchainReason = file.blockchain_status;

    if (file.blockchain_tx && file.blockchain_status === 'confirmed') {
      const { verified, onChainHash } = await verifyOnChain(file.blockchain_tx, file.hash);
      blockchainVerified = verified;
      blockchainReason = verified ? 'ok' : 'hash_mismatch';
      if (!verified) {
        console.error(`[Download] ❌ Blockchain mismatch! DB hash: ${file.hash} | On-chain: ${onChainHash}`);
      }
    }

    // ── 6. Unwrap the per-file AES key using the server MASTER_KEY ────────
    //    The raw key is never stored — we decrypt the wrapped key here.
    const [encKeyHex, keyAuthTag] = keyRecord.encrypted_key.split(':');
    const fileKey = aesDecrypt(encKeyHex, keyAuthTag, keyRecord.iv, MASTER_KEY);

    console.log(`[Download] ✅ ${file.original_name} | Integrity: OK | Blockchain: ${blockchainReason}`);

    // ── 7. Return encrypted bytes + key material to SDK (server never decrypts) ──
    res.json({
      integrity: 'ok',
      blockchain: {
        verified: blockchainVerified,
        status: file.blockchain_status,
        tx: file.blockchain_tx || null,
        reason: blockchainReason
      },
      file: {
        name: file.original_name,
        mimeType: file.mime_type,
        sizeBytes: file.size_bytes
      },
      // Everything the SDK needs to decrypt the file client-side
      encrypted: {
        data: encryptedBytes.toString('base64'),  // encrypted file bytes
        key: fileKey.toString('hex'),             // unwrapped AES-256 key
        iv: keyRecord.file_iv,                    // IV for AES-GCM decryption
        authTag: keyRecord.file_auth_tag          // GCM authentication tag
      }
    });
  } catch (error) {
    console.error('File Download Error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
