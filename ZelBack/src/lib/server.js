import express from 'express';
import eWS from 'express-ws';
import bodyParser from 'body-parser';
import cors from 'cors';
import morgan from 'morgan';
import routes from '../routes.js';

// const { json } = pkg;

const expressWs = eWS(express());
const { app } = expressWs;

app.use(morgan('combined'));
app.use(bodyParser.json());
app.use(cors());

// require('../routes')(app, expressWs);
routes(app, expressWs);

export default app;
