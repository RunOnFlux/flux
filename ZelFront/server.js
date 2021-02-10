// Flux Home configuration
const path = require('path');
const express = require('express');

const home = path.join(__dirname, '../ZelFront/dist');

const homeApp = express();
homeApp.use(express.static(home));

homeApp.get('*', (req, res) => {
  res.sendFile(path.join(home, 'index.html'));
});

homeApp.listen(16126);
