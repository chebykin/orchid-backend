const kurento = require('kurento-client');

module.exports = (config) => {
  let idCounter = 0;
  let cachedKurentoClient = null;
  let presenter = null;
  let viewers = [];
  const candidatesQueue = [];
  const noPresenterMessage = 'No active presenter. Try again later...';


  const getKurentoClient = (cb) => {
    if (cachedKurentoClient !== null) {
      return cb(null, cachedKurentoClient);
    }

    return kurento(config.ws_uri, (error, _kurentoClient) => {
      if (error) {
        console.log(`Could not find media server at address ${config.ws_uri}`);
        return cb(`Could not find media server at address${config.ws_uri
          }. Exiting with error ${error}`);
      }

      cachedKurentoClient = _kurentoClient;
      return cb(null, cachedKurentoClient);
    });
  };

  const clearCandidatesQueue = (sessionId) => {
    if (candidatesQueue[sessionId]) {
      delete candidatesQueue[sessionId];
    }
  };

  const stop = (sessionId) => {
    if (presenter !== null && presenter.id === sessionId) {
      viewers.forEach((element) => {
        const viewer = element;

        if (viewer.ws) {
          viewer.ws.send(JSON.stringify({
            id: 'stopCommunication',
          }));
        }
      });

      if ('pipeline' in presenter && presenter.pipeline !== null) {
        presenter.pipeline.release();
      }

      presenter = null;
      viewers = [];
    } else if (viewers[sessionId]) {
      viewers[sessionId].webRtcEndpoint.release();
      delete viewers[sessionId];
    }

    clearCandidatesQueue(sessionId);
  };

  const nextUniqueId = () => {
    idCounter += 1;
    return idCounter.toString();
  };

  const onIceCandidate = (sessionId, _candidate) => {
    const candidate = kurento.getComplexType('IceCandidate')(_candidate);

    if (presenter && presenter.id === sessionId && presenter.webRtcEndpoint) {
      console.info('Sending presenter candidate');
      presenter.webRtcEndpoint.addIceCandidate(candidate);
    } else if (viewers[sessionId] && viewers[sessionId].webRtcEndpoint) {
      console.info('Sending viewer candidate');
      viewers[sessionId].webRtcEndpoint.addIceCandidate(candidate);
    } else {
      console.info('Queueing candidate');
      if (!candidatesQueue[sessionId]) {
        candidatesQueue[sessionId] = [];
      }
      candidatesQueue[sessionId].push(candidate);
    }
  };

  const initPresenter = (sessionId, ws, sdpOffer, callback) => {
    clearCandidatesQueue(sessionId);

    if (presenter !== null) {
      stop(sessionId);

      // TODO: handle exception correctly
      return callback('Another user is currently acting as presenter. Try again later ...');
    }

    presenter = {
      id: sessionId,
      pipeline: null,
      webRtcEndpoint: null,
    };

    return getKurentoClient((clientError, kurentoClient) => {
      if (clientError) {
        stop(sessionId);
        return callback(clientError);
      }

      if (presenter === null) {
        stop(sessionId);
        return callback(noPresenterMessage);
      }

      return kurentoClient.create('MediaPipeline', (pipelineError, pipeline) => {
        if (pipelineError) {
          stop(sessionId);
          return callback(pipelineError);
        }

        if (presenter === null) {
          stop(sessionId);
          return callback(noPresenterMessage);
        }

        presenter.pipeline = pipeline;
        return pipeline.create('WebRtcEndpoint', (endpointError, webRtcEndpoint) => {
          if (endpointError) {
            stop(sessionId);
            return callback(endpointError);
          }

          if (presenter === null) {
            stop(sessionId);
            return callback(noPresenterMessage);
          }

          presenter.webRtcEndpoint = webRtcEndpoint;

          if (candidatesQueue[sessionId]) {
            while (candidatesQueue[sessionId].length) {
              const candidate = candidatesQueue[sessionId].shift();
              webRtcEndpoint.addIceCandidate(candidate);
            }
          }

          webRtcEndpoint.on('OnIceCandidate', (event) => {
            const candidate = kurento.getComplexType('IceCandidate')(event.candidate);
            ws.send(JSON.stringify({
              action: 'iceCandidate',
              candidate,
            }));
          });

          webRtcEndpoint.processOffer(sdpOffer, (offerError, sdpAnswer) => {
            if (offerError) {
              stop(sessionId);
              return callback(offerError);
            }

            if (presenter === null) {
              stop(sessionId);
              return callback(noPresenterMessage);
            }

            return callback(null, sdpAnswer);
          });

          return webRtcEndpoint.gatherCandidates((error) => {
            if (error) {
              stop(sessionId);
              return callback(error);
            }

            return null;
          });
        });
      });
    });
  };

  const initViewer = (sessionId, ws, sdpOffer, callback) => {
    clearCandidatesQueue(sessionId);

    if (presenter === null) {
      stop(sessionId);
      return callback(noPresenterMessage);
    }

    return presenter.pipeline.create('WebRtcEndpoint', (createEndpointError, webRtcEndpoint) => {
      if (createEndpointError) {
        stop(sessionId);
        return callback(createEndpointError);
      }

      viewers[sessionId] = {
        webRtcEndpoint,
        ws,
      };

      if (presenter === null) {
        stop(sessionId);
        return callback(noPresenterMessage);
      }

      if (candidatesQueue[sessionId]) {
        while (candidatesQueue[sessionId].length) {
          const candidate = candidatesQueue[sessionId].shift();
          webRtcEndpoint.addIceCandidate(candidate);
        }
      }

      webRtcEndpoint.on('OnIceCandidate', (event) => {
        const candidate = kurento.getComplexType('IceCandidate')(event.candidate);
        ws.send(JSON.stringify({
          action: 'iceCandidate',
          candidate,
        }));
      });

      return webRtcEndpoint.processOffer(sdpOffer, (error, sdpAnswer) => {
        if (error) {
          stop(sessionId);
          return callback(error);
        }
        if (presenter === null) {
          stop(sessionId);
          return callback(noPresenterMessage);
        }

        return presenter.webRtcEndpoint.connect(webRtcEndpoint, (connectEndpointError) => {
          if (connectEndpointError) {
            stop(sessionId);
            return callback(connectEndpointError);
          }
          if (presenter === null) {
            stop(sessionId);
            return callback(noPresenterMessage);
          }

          callback(null, sdpAnswer);
          return webRtcEndpoint.gatherCandidates((gatherError) => {
            if (gatherError) {
              stop(sessionId);
              return callback(gatherError);
            }

            return null;
          });
        });
      });
    });
  };

  return {
    onConnection(ws) {
      const sessionId = nextUniqueId();

      ws.on('error', (err) => {
        console.log(`WS Relay: websocket connection ERROR: ${err}`);
        stop(sessionId);
      });

      ws.on('close', (info) => {
        console.log(`WS Relay: websocket connection CLOSE: ${info}`);
        stop(sessionId);
      });

      ws.on('message', (rawMessage) => {
        const msg = JSON.parse(rawMessage);

        if (msg.action !== 'onIceCandidate') {
          console.log(`WS Relay: websocket connection MESSAGE: ${rawMessage}`);
        }

        switch (msg.action) {
          case 'initPresenter':
            initPresenter(sessionId, ws, msg.sdpOffer, (error, sdpAnswer) => {
              if (error) {
                return ws.send(JSON.stringify({
                  action: 'presenterResponse',
                  response: 'rejected',
                  message: error,
                }));
              }

              return ws.send(JSON.stringify({
                action: 'presenterResponse',
                response: 'accepted',
                sdpAnswer,
              }));
            });
            break;
          case 'initViewer':
            initViewer(sessionId, ws, msg.sdpOffer, (error, sdpAnswer) => {
              if (error) {
                return ws.send(JSON.stringify({
                  action: 'viewerResponse',
                  response: 'rejected',
                  message: error,
                }));
              }

              return ws.send(JSON.stringify({
                action: 'viewerResponse',
                response: 'accepted',
                sdpAnswer,
              }));
            });
            break;

          case 'stop':
            stop(sessionId);
            break;
          case 'onIceCandidate':
            onIceCandidate(sessionId, msg.candidate);
            break;
          default:
            ws.send(JSON.stringify({
              action: 'error',
              message: `Invalid message ${msg}`,
            }));
            break;
        }
      });
    },
  };
};
