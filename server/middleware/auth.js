import crypto from 'crypto';
import { supabase } from '../config/supabase.js';

/**
 * Middleware to authenticate requests using DecentraVault API Keys (dv_xxxx)
 */
export const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
      return res.status(401).json({ 
        error: 'Missing API Key. Provide it in the x-api-key header.' 
      });
    }

    // Hash the provided key to compare with stored hash
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    // Look up the key in the database
    const { data: keyRecord, error } = await supabase
      .from('api_keys')
      .select('developer_id, status')
      .eq('api_key_hash', keyHash)
      .single();

    if (error || !keyRecord) {
      return res.status(401).json({ 
        error: 'Invalid API Key' 
      });
    }

    if (keyRecord.status !== 'active') {
      return res.status(403).json({ 
        error: 'This API Key has been revoked' 
      });
    }

    // Attach developer ID to the request for use in later routes
    req.developerId = keyRecord.developer_id;
    next();

  } catch (error) {
    console.error('API Key Auth Error:', error);
    res.status(500).json({ error: 'Authentication service error' });
  }
};
