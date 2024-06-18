const express = require('express');
// const eWS = require('express-ws');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');

// const options = {
//   wsOptions: {
//     maxPayload: 1_048_576 * 16, // 16MiB,
//   },
// };

const app = express();
// const expressWs = eWS(app, null, options);

app.use(compression());
app.use(morgan('combined'));
app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
app.use(cors());

require('../routes')(app);

module.exports = app;
