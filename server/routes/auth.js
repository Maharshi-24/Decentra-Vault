import express from 'express';
import { supabase } from '../config/supabase.js';

const router = express.Router();

/**
 * POST /api/auth/signup
 * Register a new developer account
 */
router.post('/signup', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required' 
      });
    }

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true // Auto-confirm for MVP
    });

    if (authError) {
      return res.status(400).json({ 
        error: authError.message 
      });
    }

    // Create developer record
    const { data: developer, error: devError } = await supabase
      .from('developers')
      .insert({
        id: authData.user.id,
        email: authData.user.email,
        plan: 'free'
      })
      .select()
      .single();

    if (devError) {
      // Rollback: delete auth user if developer record fails
      await supabase.auth.admin.deleteUser(authData.user.id);
      return res.status(500).json({ 
        error: 'Failed to create developer account' 
      });
    }

    res.status(201).json({
      message: 'Account created successfully',
      developer: {
        id: developer.id,
        email: developer.email,
        plan: developer.plan
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ 
      error: 'Internal server error' 
    });
  }
});

/**
 * POST /api/auth/login
 * Authenticate developer and return session token
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required' 
      });
    }

    // Sign in with Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return res.status(401).json({ 
        error: 'Invalid credentials' 
      });
    }

    // Fetch developer details
    const { data: developer, error: devError } = await supabase
      .from('developers')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (devError) {
      return res.status(500).json({ 
        error: 'Failed to fetch developer data' 
      });
    }

    res.json({
      message: 'Login successful',
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at
      },
      developer: {
        id: developer.id,
        email: developer.email,
        plan: developer.plan
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      error: 'Internal server error' 
    });
  }
});

/**
 * POST /api/auth/logout
 * Invalidate session
 */
router.post('/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];

    if (!token) {
      return res.status(400).json({ 
        error: 'No token provided' 
      });
    }

    const { error } = await supabase.auth.admin.signOut(token);

    if (error) {
      return res.status(500).json({ 
        error: 'Logout failed' 
      });
    }

    res.json({ message: 'Logged out successfully' });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ 
      error: 'Internal server error' 
    });
  }
});

/**
 * GET /api/auth/me
 * Get current authenticated developer
 */
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];

    if (!token) {
      return res.status(401).json({ 
        error: 'Authentication required' 
      });
    }

    // Verify token and get user
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ 
        error: 'Invalid or expired token' 
      });
    }

    // Fetch developer details
    const { data: developer, error: devError } = await supabase
      .from('developers')
      .select('*')
      .eq('id', user.id)
      .single();

    if (devError) {
      return res.status(500).json({ 
        error: 'Failed to fetch developer data' 
      });
    }

    res.json({
      developer: {
        id: developer.id,
        email: developer.email,
        plan: developer.plan,
        created_at: developer.created_at
      }
    });

  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ 
      error: 'Internal server error' 
    });
  }
});

export default router;
