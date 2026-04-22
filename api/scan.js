export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { imageData, mimeType, isPdf } = req.body;

  const contentItem = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageData } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageData } };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: `Je bent een helper voor een groentewinkel. Lees de leveranciersbon.
Geef ALLEEN een JSON array terug, geen markdown:
[{"naam":"Tomaten","eenheid":"per kg","inkoop":1.20,"cat":"Groente","land":"Nederland"}]
Categorieën: Groente, Fruit, Kruiden, Aardappelen, Overig. Land in het Nederlands of "Onbekend".`,
      messages: [{ role: 'user', content: [contentItem, { type: 'text', text: 'Geef alle producten met inkoopprijzen als JSON array.' }] }],
    }),
  });

  const data = await response.json();
  res.status(200).json(data);
}
