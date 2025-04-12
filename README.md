# SongCart Order Tracking Backend

This serverless API reads from a Google Sheet linked to a Google Form and returns song readiness + download info for a given Order ID.

### Endpoint
`GET /api/order-tracking?query=#1153`

### Response
```json
{
  "isSongReady": true,
  "songUrl": "https://drive.google.com/uc?export=download&id=...",
  "email": "r****@gmail.com"
}
