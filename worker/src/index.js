/**
 * Cloudflare Worker: FACEIT API Proxy
 * 
 * This worker acts as a secure middleman between the GitHub Pages frontend
 * and the FACEIT Open API. The API key is stored as a Cloudflare Secret
 * and is never exposed to the browser.
 * 
 * Deploy with: wrangler deploy
 * Set secret:  wrangler secret put FACEIT_API_KEY
 */

const FACEIT_API_BASE = 'https://open.faceit.com/data/v4';

// Allowed origins (your GitHub Pages domain)
const ALLOWED_ORIGINS = [
  'https://reskeyo.github.io',
  'http://localhost',
  'http://127.0.0.1',
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const isAllowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, isAllowed),
      });
    }

    // Only allow GET requests
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', keyConfigured: !!env.FACEIT_API_KEY }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, isAllowed) },
      });
    }

    // Strip /faceit prefix and forward to FACEIT API
    // e.g. /faceit/players?nickname=s1mple → https://open.faceit.com/data/v4/players?nickname=s1mple
    if (!url.pathname.startsWith('/faceit/')) {
      return new Response(JSON.stringify({ error: 'Invalid endpoint. Use /faceit/<endpoint>' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, isAllowed) },
      });
    }

    const faceitPath = url.pathname.replace('/faceit/', '');
    const faceitUrl = `${FACEIT_API_BASE}/${faceitPath}${url.search}`;

    try {
      const faceitResponse = await fetch(faceitUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${env.FACEIT_API_KEY}`,
          'Accept': 'application/json',
        },
      });

      const data = await faceitResponse.text();

      return new Response(data, {
        status: faceitResponse.status,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(origin, isAllowed),
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Failed to reach FACEIT API', details: err.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, isAllowed) },
      });
    }
  },
};

function corsHeaders(origin, isAllowed) {
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : 'https://reskeyo.github.io',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}
