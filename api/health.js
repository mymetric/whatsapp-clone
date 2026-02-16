module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.json({ status: 'ok', timestamp: new Date().toISOString() });
};
