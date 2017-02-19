const kurento = require('kurento-client');
kurento.register('kurento-module-thatoverlay');


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
        // createMediaElements(pipeline, ws, function (error, webRtcEndpoint, filter) {
        //
        // });
        return pipeline.create('WebRtcEndpoint', (endpointError, webRtcEndpoint) => {
          if (endpointError) {
            stop(sessionId);
            return callback(endpointError);
          }

          if (presenter === null) {
            stop(sessionId);
            return callback(noPresenterMessage);
          }

          pipeline.create('thatoverlay.ThatOverlay', {}, function(error, filter) {
            if (error) {
              return callback(error);
            }

            filter.setup(15, 15, "USERNAME", "Arial 16", 1, 1, 1, 1.0, "255.255.255.255" + "/n" + "12JAN2016 16:23:11Z", "Arial 16", 1, 1, 1, 0.5, 45, function(error) {
              if (error) {
                console.log(error);
                //return callback(error);
              }
              webRtcEndpoint.connect(filter, (connectThatOverlayEndpointError) => {
                if (connectThatOverlayEndpointError) {
                  stop(sessionId);
                  return callback(connectThatOverlayEndpointError);
                }

                filter.connect(webRtcEndpoint, (connectThatOverlayFilterError) => {
                  if (connectThatOverlayFilterError) {
                    stop(sessionId);
                    return callback(connectThatOverlayFilterError);
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

      // setup overlay filter
      presenter.pipeline.create('thatoverlay.ThatOverlay', (createThatOverlayError, filter) => {
        if (createThatOverlayError) {
          stop(sessionId);
          return callback(createThatOverlayError);
        }

        filter.setup(30, 30, "USERNAME", "Arial 50", 1, 1, 1, 1.0, "255.255.255.255" + "/n" + "12JAN2016 16:23:11Z",
          "Arial 50", 1, 1, 1, 0.5, 45, (setupThatOverlayError) => {
            if (setupThatOverlayError) {
              stop(sessionId);
              return callback(setupThatOverlayError);
            }

            webRtcEndpoint.connect(filter, (connectThatOverlayEndpointError) => {
              if (connectThatOverlayEndpointError) {
                stop(sessionId);
                return callback(connectThatOverlayEndpointError);
              }

              filter.connect(webRtcEndpoint, (connectThatOverlayFilterError) => {
                if (connectThatOverlayFilterError) {
                  stop(sessionId);
                  return callback(connectThatOverlayFilterError);
                }

                // / setup overlay filter
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
              })
            })
        });
      });


    });
  };

  const createMediaElements = (pipeline, ws, callback) => {
    pipeline.create('WebRtcEndpoint', function(error, webRtcEndpoint) {
      if (error) {
        return callback(error);
      }

      pipeline.create('thatoverlay.ThatOverlay', {}, function(error, filter) {
        if (error) {
          return callback(error);
        }

        filter.setup(15, 15, "USERNAME", "Arial 16", 1, 1, 1, 1.0, "255.255.255.255" + "/n" + "12JAN2016 16:23:11Z", "Arial 16", 1, 1, 1, 0.5, 45, function(error) {
          if (error) {
            console.log(error);
            //return callback(error);
          }
          return callback(null, webRtcEndpoint, filter);
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
