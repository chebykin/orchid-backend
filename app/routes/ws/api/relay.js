const kurento = require('kurento-client');
const config = require('../../../config/config');

// TODO pass config from app.js
const Relay = () => {
  let kurentoClient;

  const getKurentoClient = (cb) => {
    if (kurentoClient !== null) {
      return cb(null, kurentoClient);
    }

    return kurento(config.ws_uri, (error, _kurentoClient) => {
      if (error) {
        console.log(`Could not find media server at address ${config.ws_uri}`);
        return cb(`Could not find media server at address${config.ws_uri
           }. Exiting with error ${error}`);
      }

      kurentoClient = _kurentoClient;
      return cb(null, kurentoClient);
    });
  };
};

export default Relay;
