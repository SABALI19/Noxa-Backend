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
