THIS IS THE BACKEND SETUP FOR NOXA APP

## Auth Setup (Signup/Login)

### 1) Environment variables

In the project root `.env`, make sure these are set:

```env
PORT=4000
MONGODB_URI=your_mongodb_connection_string
CLIENT_URL=http://localhost:5173
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=replace_with_another_long_random_secret
JWT_REFRESH_EXPIRES_IN=30d
```

### 2) Start server

```bash
npm run dev
```

### 3) Auth routes

Base path: `/api/v1/users`

- `POST /register` (signup)
- `POST /login`
- `POST /refresh`
- `POST /logout`
- `GET /me` (requires `Authorization: Bearer <token>`)

### 4) Request bodies

Signup:

```json
{
  "username": "samuel_01",
  "email": "samuel@email.com",
  "password": "strongpass123"
}
```

Login:

```json
{
  "email": "samuel@email.com",
  "password": "strongpass123"
}
```

Refresh token:

```json
{
  "refreshToken": "paste_refresh_token_from_login_response"
}
```

## AI Endpoint (Anthropic)

Install package:

```bash
npm install @anthropic-ai/sdk
```

Set in `.env`:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key
```

Route:

- `POST /api/ai` (protected, requires `Authorization: Bearer <accessToken>`)

Example request:

```bash
curl -X POST "http://localhost:4000/api/ai" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1000,
    "system": "You are a helpful assistant.",
    "messages": [
      { "role": "user", "content": "Write a short welcome message for Noxa users." }
    ]
  }'
```

Expected response shape (Anthropic JSON):

```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "model": "claude-sonnet-4-20250514",
  "content": [
    { "type": "text", "text": "..." }
  ],
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0
  }
}
```
