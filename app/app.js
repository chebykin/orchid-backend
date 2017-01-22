const server = require('http').createServer();
const express = require('express');

const app = express();
const WebSocketServer = require('ws').Server;
const config = require('./config/index');

const port = process.env.PORT || 3001;

const routesHttpApiUsers = require('./routes/http/api/users');

const routesWsRelay = require('./routes/ws/relay');

app.use('/api/users', routesHttpApiUsers());

(new WebSocketServer({
  server,
  path: '/relay',
})).on('connection', routesWsRelay(config).onConnection);

server.on('request', app);
server.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
