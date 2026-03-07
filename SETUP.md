# DecentraVault Setup Guide

## Prerequisites
- Node.js installed
- Supabase account with project created

## Setup Steps

### 1. Install Dependencies
Already completed with `npm install`

### 2. Configure Supabase Database

Go to your Supabase project dashboard → **SQL Editor** and run the schema from:
`server/database/schema.sql`

This creates the following tables:
- `developers` - Developer accounts
- `api_keys` - API key management
- `files` - File metadata and blockchain references
- `file_keys` - Encrypted file keys

### 3. Start the Server

```bash
npm run dev
```

The API will start on `http://localhost:3000`

### 4. Access the Developer Portal

Open your browser and go to:
```
http://localhost:3000
```

### 5. Test the Authentication

1. Click **Sign Up** tab
2. Create a developer account with email and password
3. After signup, switch to **Login** tab
4. Login with your credentials
5. You should see the Developer Dashboard

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Create developer account
- `POST /api/auth/login` - Login and get session token
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current developer info

### Health Check
- `GET /health` - Check if API is running

## Next Steps

After completing Step 1 (Supabase auth + developer dashboard), the roadmap continues with:

- **Step 2:** API key generation endpoint
- **Step 3:** API key authentication middleware
- **Step 4:** File upload endpoint
- **Step 5:** Pinata (IPFS) integration
- **Step 6:** SHA-256 hash generation
- **Step 7:** Polygon blockchain integration
- **Step 8:** File retrieval + hash verification
- **Step 9:** SDK packaging and documentation

## Troubleshooting

If you see database errors:
1. Make sure you ran the `schema.sql` in Supabase SQL Editor
2. Verify your `.env` file has correct credentials
3. Check that Row Level Security policies are properly set up
