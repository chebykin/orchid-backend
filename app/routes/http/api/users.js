const express = require('express');
const router = express.Router();

module.exports = () => {
  router.get('/ping', (req, res) => {
    res.send({ pong: true });
  });

  return router;
};
