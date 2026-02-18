const { getDb, setCors } = require('../../lib/firebase-admin');

module.exports = async (req, res) => {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase não configurado' });

  try {
    const phone = (req.query.phone || '').toString().trim();
    if (!phone) return res.status(400).json({ error: 'phone é obrigatório' });

    // Normalizar: buscar por variantes do telefone (com/sem 55, com/sem 9o dígito)
    const clean = phone.replace(/\D/g, '');
    const variants = new Set([clean]);
    if (clean.startsWith('55')) variants.add(clean.substring(2));
    else variants.add('55' + clean);
    // 9o dígito
    for (const v of [...variants]) {
      if (v.length === 11 && v[2] === '9') variants.add(v.substring(0, 2) + v.substring(3));
      if (v.length === 10) variants.add(v.substring(0, 2) + '9' + v.substring(2));
      if (v.length === 13 && v[4] === '9') variants.add(v.substring(0, 4) + v.substring(5));
      if (v.length === 12) variants.add(v.substring(0, 4) + '9' + v.substring(4));
    }

    const snapshot = await db.collection('file_processing_queue')
      .where('status', '==', 'done')
      .limit(500)
      .get();

    const results = [];
    for (const doc of snapshot.docs) {
      const d = doc.data();
      if (!d.extractedText || d.extractedText.trim().length === 0) continue;
      const sp = (d.sourcePhone || '').replace(/\D/g, '');
      if (!sp) continue;
      let match = false;
      for (const v of variants) {
        if (sp === v || sp.endsWith(v) || v.endsWith(sp)) { match = true; break; }
      }
      if (!match) continue;
      results.push({
        id: doc.id,
        fileName: d.mediaFileName || '',
        mediaType: d.mediaType || '',
        extractedText: d.extractedText,
        processedAt: d.processedAt || '',
      });
    }

    return res.json(results);
  } catch (err) {
    console.error('Erro ao buscar textos extraídos:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
