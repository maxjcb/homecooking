// Homecooking: KI-Rezeptvorschläge via Claude (Anthropic Messages API)
// Manuell deployen: `supabase functions deploy ai-suggest`
// Secret setzen:    `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`
// Nicht Teil der laufenden App (wie supabase/schema.sql) — kein Auto-Deploy.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const MODEL = 'claude-haiku-4-5-20251001';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    source: { type: 'string', enum: ['existing', 'new'] },
    recipeId: { type: 'string', description: 'Nur bei source=existing: id aus der übergebenen Rezeptliste.' },
    name: { type: 'string' },
    time: { type: 'number' },
    portions: { type: 'number' },
    ingredients: { type: 'array', items: { type: 'string' } },
    steps: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
    missingIngredients: { type: 'array', items: { type: 'string' } },
  },
  required: ['source', 'name', 'missingIngredients'],
};

const SUGGESTIONS_TOOL = {
  name: 'return_suggestions',
  description: 'Liefert Rezeptvorschläge gruppiert nach benötigtem Einkaufsaufwand.',
  input_schema: {
    type: 'object',
    properties: {
      noShopping: { type: 'array', items: SUGGESTION_SCHEMA },
      smallShopping: { type: 'array', items: SUGGESTION_SCHEMA },
      bigShopping: { type: 'array', items: SUGGESTION_SCHEMA },
    },
    required: ['noShopping', 'smallShopping', 'bigShopping'],
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

  const { items = [], recipes = [], profiles = {} } = await req.json();

  const profileText = Object.values(profiles)
    .map((p) => `${p.name}: ${p.diet || 'keine Angabe'}`)
    .join('; ');
  const pantryText = items
    .map((i) => `${i.name} (${i.qtyType === 'fill' ? i.qty + '% gefüllt' : (i.qty ?? '') + ' ' + (i.unit ?? '')}, ${i.store})`)
    .join('\n');
  const recipeText = recipes
    .map((r) => `- id: ${r.id} | ${r.name} | Zutaten: ${(r.ingredients || []).join(', ')}`)
    .join('\n');

  const userPrompt = `Haushalt (beide vegetarisch, individuelle Ausnahmen): ${profileText}

Aktueller Vorrat:
${pantryText || '(leer)'}

Gespeicherte Rezepte:
${recipeText || '(keine)'}

Schlage Gerichte in drei Stufen vor:
1. noShopping: sofort kochbar, nichts fehlt im Vorrat.
2. smallShopping: nur wenige (1-3) zusätzliche Zutaten nötig.
3. bigShopping: mehr zusätzliche Zutaten nötig, auch aufwändigere/neue Gerichte erlaubt.

Bevorzuge dabei proteinreiche vegetarische Gerichte (z.B. mit Hülsenfrüchten, Tofu, Eiern, Quark, Käse, Nüssen als zentralen Zutaten) – wähle in jeder Stufe, wenn möglich, proteinreiche Optionen vor weniger proteinreichen.

Nutze für jede Stufe 2-3 Vorschläge, gerne eine Mischung aus bestehenden Rezepten (source="existing", mit recipeId) und neuen Ideen (source="new", mit vollständigen ingredients/steps). Halte ingredients/steps bei neuen Rezepten knapp (kurze Stichpunkte, keine ausführlichen Erklärungen). Liste bei jedem Vorschlag die fehlenden Zutaten in missingIngredients (leeres Array wenn nichts fehlt). Antworte ausschließlich über das Tool return_suggestions.`;

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      tools: [SUGGESTIONS_TOOL],
      tool_choice: { type: 'tool', name: 'return_suggestions' },
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
