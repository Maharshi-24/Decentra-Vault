import express from 'express';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';

const router = express.Router();

/**
 * POST /api/keys/generate
 * Generate a new API key for the authenticated developer
 */
router.post('/generate', async (req, res) => {
  try {
    const { name } = req.body;
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization header missing' });
    }

    const token = authHeader.split('Bearer ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    // Generate a secure random key
    const rawKey = `dv_${crypto.randomBytes(24).toString('hex')}`;
    const keyPrefix = rawKey.substring(0, 8); // e.g. 'dv_92af'
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    // Store in database
    const { data, error: dbError } = await supabase
      .from('api_keys')
      .insert({
        developer_id: user.id,
        name: name || 'My API Key',
        key_prefix: keyPrefix,
        api_key_hash: keyHash,
        status: 'active'
      })
      .select()
      .single();

    if (dbError) {
      console.error('DB Error generating key:', dbError);
      return res.status(500).json({ error: 'Failed to save API key' });
    }

    // Return the raw key ONLY once (not stored in DB)
    res.status(201).json({
      message: 'API key generated successfully',
      apiKey: rawKey,
      details: {
        id: data.id,
        prefix: data.key_prefix,
        created_at: data.created_at
      }
    });

  } catch (error) {
    console.error('Key generation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/keys
 * List all API keys for the developer (masked)
 */
router.get('/', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing token' });

    const token = authHeader.split('Bearer ')[1];
    const { data: { user } } = await supabase.auth.getUser(token);

    if (!user) return res.status(401).json({ error: 'Invalid session' });

    const { data, error } = await supabase
      .from('api_keys')
      .select('id, name, key_prefix, status, created_at')
      .eq('developer_id', user.id)
      .neq('status', 'deleted')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ keys: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch keys' });
  }
});

/**
 * DELETE /api/keys/:id
 * Toggle status between active/revoked or mark as deleted
 */
router.delete('/:id', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing token' });

    const token = authHeader.split('Bearer ')[1];
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid session' });

    const { data, error: fetchError } = await supabase
      .from('api_keys')
      .select('status, developer_id')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !data || data.developer_id !== user.id) {
      return res.status(404).json({ error: 'Key not found' });
    }

    const mode = req.query.mode || 'delete'; // 'delete' or 'toggle'
    let newStatus;

    if (mode === 'delete') {
      newStatus = 'deleted';
    } else {
      newStatus = data.status === 'active' ? 'revoked' : 'active';
    }

    const { error: updateError } = await supabase
      .from('api_keys')
      .update({ status: newStatus })
      .eq('id', req.params.id);

    if (updateError) throw updateError;
    res.json({ success: true, status: newStatus });

  } catch (error) {
    res.status(500).json({ error: 'Failed to manage key' });
  }
});

export default router;
