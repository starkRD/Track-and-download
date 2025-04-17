// pages/api/order-tracking.js

import { google } from 'googleapis'
import Shopify from 'shopify-api-node'

export default async function handler(req, res) {
  // 0. CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // 1. Validate query
  const query = (req.query.query || '').trim()
  if (!query) {
    return res.status(400).json({ error: 'Missing order ID or email.' })
  }

  // 2. Lookup Shopify order
  let shopifyOrder = null
  let customerEmail = ''
  try {
    const shopify = new Shopify({
      shopName:       process.env.SHOPIFY_STORE,
      accessToken:    process.env.SHOPIFY_ADMIN_TOKEN,
    })

    // 2a. by name (with “#” prefix, status:any)
    const nameQuery = query.startsWith('#') ? query : `#${query}`
    console.log('🔍 Trying name lookup (status:any):', nameQuery)
    const byName = await shopify.order.list({
      name:   nameQuery,
      status: 'any',
      limit:  1
    })
    if (byName.length) {
      shopifyOrder  = byName[0]
    }

    // 2b. fallback to numeric ID
    if (!shopifyOrder && !isNaN(Number(query))) {
      try {
        console.log('🔍 Trying ID lookup:', query)
        shopifyOrder = await shopify.order.get(Number(query))
      } catch (err) {
        console.log('❌ Order ID lookup failed:', err.message)
      }
    }

    // 2c. fallback to email
    if (!shopifyOrder && query.includes('@')) {
      console.log('🔍 Trying email lookup (status:any):', query)
      const byEmail = await shopify.order.list({
        email:  query.toLowerCase(),
        status: 'any',
        limit:  1
      })
      if (byEmail.length) {
        shopifyOrder = byEmail[0]
      }
    }

    if (!shopifyOrder) {
      return res.status(404).json({
        error: 'Order not found. Please check the order number or email and try again.'
      })
    }

    customerEmail = (shopifyOrder.email || '').trim().toLowerCase()
  } catch (err) {
    console.error('Shopify error:', err)
    return res.status(500).json({ error: 'Error accessing Shopify API.' })
  }

  // 3. Fulfillment check
  const isFulfilled = (shopifyOrder.fulfillment_status || '').toLowerCase() === 'fulfilled'

  // 4. Load Google Sheets
  let songs: string[] = []
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key:  (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    })
    const sheets = google.sheets({ version: 'v4', auth })
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range:         'Sheet1!A2:Z'
    })
    const rows = data.values || []

    const normName = shopifyOrder.name.replace('#','').trim()
    for (const row of rows) {
      const sheetId    = (row[1] || '').replace('#','').trim()
      const readyFlag  = (row[4] || '').trim().toLowerCase()
      const uploadCell = (row[3] || '').trim()
      if ((sheetId === normName || sheetId === query) && readyFlag === 'yes') {
        songs = uploadCell
          .split(/[\n,]+/)
          .map(s => s.trim())
          .filter(s => s)
        console.log('✅ Sheet match for', sheetId, '→ songs:', songs)
        break
      }
    }
  } catch (err) {
    console.error('Google Sheets error:', err)
  }

  // 5. Return all data
  return res.status(200).json({
    isFulfilled,
    songs,
    emailFromShopify: customerEmail,
    order: {
      name:               shopifyOrder.name,
      id:                 shopifyOrder.id,
      created_at:         shopifyOrder.created_at,
      fulfillment_status: shopifyOrder.fulfillment_status,
      line_items:         shopifyOrder.line_items.map(i => ({ variant_id: i.variant_id }))
    }
  })
}
