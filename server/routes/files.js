import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { authenticateApiKey } from '../middleware/auth.js';
import { supabase } from '../config/supabase.js';

const router = express.Router();

// Multer memory storage (files stored in RAM temporarily before IPFS)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

/**
 * POST /api/upload
 * Secured by API Key: dv_xxxx
 */
router.post('/', authenticateApiKey, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file provided in the request body (form-data: "file")' });
    }

    // Prepare metadata
    const developerId = req.developerId;
    const fileHash = crypto.createHash('sha-256').update(file.buffer).digest('hex');

    // NOTE: In Step 5, we will add Pinata (IPFS) upload logic here
    // For now, we simulate the CID (Content Identifier)
    const simulatedCid = `dv_sim_cid_${crypto.randomBytes(16).toString('hex')}`;

    // Store metadata in files table
    const { data: fileRecord, error: dbError } = await supabase
      .from('files')
      .insert({
        developer_id: developerId,
        cid: simulatedCid,
        hash: fileHash
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database Error storing file metadata:', dbError);
      return res.status(500).json({ error: 'Failed to record file metadata' });
    }

    res.status(201).json({
      message: 'File metadata recorded successfully (Step 4 completed)',
      fileId: fileRecord.file_id,
      cid: simulatedCid,
      hash: fileHash
    });

  } catch (error) {
    console.error('File Upload Error:', error);
    res.status(500).json({ error: 'Internal server error processing file upload' });
  }
});

export default router;
