// supabase/functions/ai-proxy/index.ts
// Supabase Edge Function that proxies OpenAI API calls.
// The OPENAI_API_KEY is stored as a Supabase secret, never exposed to the frontend.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
        if (!OPENAI_API_KEY) {
            return new Response(
                JSON.stringify({ error: 'OpenAI API key not configured on server' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const { systemPrompt, userPrompt, jsonSchema, model } = await req.json();

        if (!systemPrompt || !userPrompt) {
            return new Response(
                JSON.stringify({ error: 'Missing systemPrompt or userPrompt' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Build the OpenAI request
        const requestBody: Record<string, unknown> = {
            model: model || 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        };

        // If a JSON schema is provided, use structured outputs
        if (jsonSchema) {
            requestBody.response_format = {
                type: 'json_schema',
                json_schema: {
                    name: 'historylens_response',
                    schema: jsonSchema,
                    strict: true
                }
            };
        }

        const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!openaiRes.ok) {
            const errData = await openaiRes.json().catch(() => ({}));
            return new Response(
                JSON.stringify({ error: errData.error?.message || `OpenAI API Error: ${openaiRes.status}` }),
                { status: openaiRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const data = await openaiRes.json();
        const content = data.choices[0].message.content;

        return new Response(
            JSON.stringify({ content }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (err) {
        return new Response(
            JSON.stringify({ error: err.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
