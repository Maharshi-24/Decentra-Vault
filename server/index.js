import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { supabase } from './config/supabase.js';
import authRoutes from './routes/auth.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve frontend

// Routes
app.use('/api/auth', authRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'DecentraVault API is running' });
});

try {
  app.listen(PORT, () => {
    console.log(`🚀 DecentraVault API running on http://localhost:${PORT}`);
  }).on('error', (err) => {
    console.error('🔥 SERVER FAILED TO START:', err);
  });
} catch (err) {
  console.error('🔥 APP.LISTEN CRASHED:', err);
}

process.on('uncaughtException', (err) => {
  console.error('🔥 UNCAUGHT EXCEPTION:', err);
});
