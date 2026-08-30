// Express 4 doesn't catch rejected promises from async route handlers on its
// own — an unhandled rejection here would just hang the request. Wrapping a
// handler in this forwards any thrown/rejected error to the error-handling
// middleware in server.js instead.
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
