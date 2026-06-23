// Homecooking: grobe Nährwert-Schätzung für ein Rezept via Claude (Anthropic Messages API)
// Manuell deployen: `supabase functions deploy estimate-nutrition --project-ref hqmyycqfbbslaiwcubtg --use-api`
// Secret ANTHROPIC_API_KEY wird mit ai-suggest geteilt (gleiches Supabase-Projekt).
// Nicht Teil der laufenden App (wie supabase/schema.sql) — kein Auto-Deploy.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const MODEL = 'claude-haiku-4-5-20251001';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const NUTRITION_TOOL = {
  name: 'return_nutrition',
  description: 'Liefert eine grobe Nährwert-Schätzung für das gesamte Rezept (alle Portionen zusammen).',
  input_schema: {
    type: 'object',
    properties: {
      calories: { type: 'number', description: 'Gesamte Kalorien (kcal) für das ganze Rezept.' },
      protein: { type: 'number', description: 'Gesamtes Eiweiß (g) für das ganze Rezept.' },
      carbs: { type: 'number', description: 'Gesamte Kohlenhydrate (g) für das ganze Rezept.' },
      fat: { type: 'number', description: 'Gesamtes Fett (g) für das ganze Rezept.' },
    },
    required: ['calories', 'protein', 'carbs', 'fat'],
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: userData, error: userError } = await supabaseClient.auth.getUser();
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: 'Nicht angemeldet.' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const { ingredients = [], portions = 2 } = await req.json();
  const ingredientText = ingredients
    .map((i) => [i.qty, i.unit, i.name].filter(Boolean).join(' '))
    .join('\n');

  const userPrompt = `Zutaten für ein Rezept mit ${portions} Portionen:
${ingredientText || '(keine Zutaten angegeben)'}

Schätze grob die Nährwerte für das GESAMTE Rezept (alle Portionen zusammen, nicht pro Portion). Eine Näherung reicht, exakte Werte sind nicht nötig. Antworte ausschließlich über das Tool return_nutrition.`;

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      tools: [NUTRITION_TOOL],
      tool_choice: { type: 'tool', name: 'return_nutrition' },
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    return new Response(JSON.stringify({ error: 'Claude API Fehler: ' + errText }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const anthropicData = await anthropicRes.json();
  const toolUse = anthropicData.content?.find((c) => c.type === 'tool_use');
  if (!toolUse) {
    return new Response(JSON.stringify({ error: 'Keine strukturierte Antwort von Claude erhalten.' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(toolUse.input), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});
