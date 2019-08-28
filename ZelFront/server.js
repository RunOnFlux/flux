// ZelFront configuration
const path = require('path');
const express = require('express');

const zelfront = path.join(__dirname, '../ZelFront/dist');

const ZelFrontApp = express();
ZelFrontApp.use(express.static(zelfront));

ZelFrontApp.get('*', (req, res) => {
  res.sendFile(path.join(zelfront, 'index.html'));
});

ZelFrontApp.listen(16126);
