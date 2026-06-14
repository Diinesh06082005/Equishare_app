// server/middleware/errorHandler.js
function errorHandler(err, req, res, _next) {
  console.error(`[${new Date().toISOString()}] ERROR: ${err.message}`);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

module.exports = errorHandler;
