module.exports = async (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'backend', 
    timestamp: new Date().toISOString() 
  });
};
