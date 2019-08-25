// ZelFront configuration
const path = require('path')
const express = require('express')
const zelfront = path.join(__dirname, '../ZelFront/dist')

const ZelBackApp = express()
ZelBackApp.use(express.static(zelfront))

ZelBackApp.get('*', (req, res) => {
  res.sendFile(path.join(zelfront, 'index.html'))
})

ZelBackApp.listen(16126)