const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const routesHttpApiUsers = require('./routes/http/api/users');

app.use('/api/users', routesHttpApiUsers());

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
