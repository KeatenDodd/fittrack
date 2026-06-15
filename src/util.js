'use strict';

// Wrap an async route handler so thrown errors reach the error middleware.
function wrap(tFn) {
  return function (tReq, tRes, tNext) {
    Promise.resolve(tFn(tReq, tRes, tNext)).catch(tNext);
  };
}

// Throw a typed HTTP error that the error middleware turns into a JSON body.
function httpError(tStatus, tMessage) {
  const oErr = new Error(tMessage);
  oErr.iStatus = tStatus;
  return oErr;
}

module.exports = { wrap, httpError };
