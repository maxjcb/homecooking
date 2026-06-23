// Homecooking: KI-Rezeptvorschläge via Claude (Anthropic Messages API)
// Manuell deployen: `supabase functions deploy ai-suggest --project-ref hqmyycqfbbslaiwcubtg --use-api`
// Secret setzen:    `supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref hqmyycqfbbslaiwcubtg`
// Nicht Teil der laufenden App (wie supabase/schema.sql) — kein Auto-Deploy.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const MODEL = 'claude-haiku-4-5-20251001';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const INGREDIENT_SCHEMA = {
  type: 'object',
  properties: {
    qty: { type: 'number', description: 'Menge als Zahl, z.B. 200 oder 1. Null/weglassen, wenn keine sinnvolle Zahl existiert (z.B. "eine Prise").' },
    unit: { type: 'string', description: 'Einheit, z.B. "g", "EL", "Stk". Null/weglassen, wenn nicht zutreffend.' },
    name: { type: 'string', description: 'Name der Zutat ohne Menge/Einheit, z.B. "Linsen".' },
  },
  required: ['name'],
};

const NUTRITION_SCHEMA = {
  type: 'object',
  properties: {
    calories: { type: 'number' },
    protein: { type: 'number' },
    carbs: { type: 'number' },
    fat: { type: 'number' },
  },
  required: ['calories', 'protein', 'carbs', 'fat'],
};

const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    source: { type: 'string', enum: ['existing', 'new'] },
    recipeId: { type: 'string', description: 'Nur bei source=existing: id aus der übergebenen Rezeptliste.' },
    name: { type: 'string' },
    time: { type: 'number' },
    portions: { type: 'number' },
    ingredients: { type: 'array', items: INGREDIENT_SCHEMA, description: 'Nur bei source=new befüllen. Jede Zutat MUSS eine Mengenangabe (qty+unit) enthalten, sofern sinnvoll möglich.' },
    steps: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
    missingIngredients: { type: 'array', items: { type: 'string' } },
    nutrition: { ...NUTRITION_SCHEMA, description: 'Nur bei source=new befüllen: grobe Nährwert-Schätzung für das GESAMTE Rezept (alle Portionen zusammen).' },
  },
  required: ['source', 'name', 'missingIngredients'],
};

const SUGGESTIONS_TOOL = {
  name: 'return_suggestions',
  description: 'Liefert Rezeptvorschläge gruppiert nach Einkaufsbedarf.',
  input_schema: {
    type: 'object',
    properties: {
      noShopping: { type: 'array', items: SUGGESTION_SCHEMA },
      shopping: { type: 'array', items: SUGGESTION_SCHEMA },
    },
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

  const {
    items = [],
    recipes = [],
    profiles = {},
    preference = '',
    excludeNames = [],
    onlyBucket = null,
    count = null,
  } = await req.json();

  const profileText = Object.values(profiles)
    .map((p) => `${p.name}: ${p.diet || 'keine Angabe'}`)
    .join('; ');
  const pantryText = items
    .map((i) => `${i.name} (${i.qtyType === 'fill' ? i.qty + '% gefüllt' : (i.qty ?? '') + ' ' + (i.unit ?? '')}, ${i.store})`)
    .join('\n');
  const formatIngredient = (i) => [i.qty, i.unit, i.name].filter(Boolean).join(' ');
  const recipeText = recipes
    .map((r) => `- id: ${r.id} | ${r.name} | Zutaten: ${(r.ingredients || []).map(formatIngredient).join(', ')}`)
    .join('\n');
  const preferenceText = preference?.trim() && preference.trim().toLowerCase() !== 'keine präferenz'
    ? `Küchen-/Geschmackspräferenz: "${preference.trim()}". Berücksichtige dies bei der Auswahl/Erfindung der Gerichte.`
    : 'Keine besondere Küchen-/Geschmackspräferenz angegeben.';
  const excludeText = excludeNames.length
    ? `Bereits vorgeschlagen, NICHT erneut nennen: ${excludeNames.join(', ')}.`
    : '';

  const basePrompt = `Haushalt (beide vegetarisch, individuelle Ausnahmen): ${profileText}

Aktueller Vorrat:
${pantryText || '(leer)'}

Gespeicherte Rezepte:
${recipeText || '(keine)'}

${preferenceText}
${excludeText}

Bevorzuge proteinreiche vegetarische Gerichte (z.B. mit Hülsenfrüchten, Tofu, Eiern, Quark, Käse, Nüssen als zentralen Zutaten). Gib bei neuen Rezepten (source="new") für jede Zutat qty+unit+name an (z.B. {qty:200, unit:"g", name:"Linsen"}) und eine grobe Nährwert-Schätzung (nutrition) fürs gesamte Rezept.`;

  const userPrompt = onlyBucket
    ? `${basePrompt}

Liefere ausschließlich im Feld "${onlyBucket}" genau ${count || 2} NEUE Rezeptideen (source="new", mit vollständigen ingredients/steps, Mengenangaben siehe oben). Lass das jeweils andere Feld weg bzw. leer. Antworte ausschließlich über das Tool return_suggestions.`
    : `${basePrompt}

Schlage Gerichte in zwei Stufen vor:
1. noShopping: sofort kochbar, nichts fehlt im Vorrat.
2. shopping: es fehlen Zutaten (egal ob wenige oder viele).

Nutze für jede Stufe 2-3 Vorschläge, gerne eine Mischung aus bestehenden Rezepten (source="existing", mit recipeId) und neuen Ideen (source="new"). Halte ingredients/steps bei neuen Rezepten knapp (kurze Stichpunkte, keine ausführlichen Erklärungen). Liste bei jedem Vorschlag die fehlenden Zutaten in missingIngredients (leeres Array wenn nichts fehlt). Antworte ausschließlich über das Tool return_suggestions.`;

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

  return new Response(JSON.stringify({
    noShopping: toolUse.input.noShopping || [],
    shopping: toolUse.input.shopping || [],
  }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});
