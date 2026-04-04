/**
 * middleware/errorHandler.js
 *
 * Central error handler. Express calls this when next(err) is invoked
 * or when an async handler throws.
 *
 * Design: A single error handler at the bottom of the middleware stack
 * ensures all errors are formatted consistently. Individual route handlers
 * do not need to worry about error response shape.
 */

function errorHandler(err, req, res, next) {
  // If the response is already streaming, delegate to Express default handler.
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.statusCode || err.status || 500;

  console.error(
    `[ErrorHandler] ${req.method} ${req.path} -> ${statusCode}:`,
    err.message,
  );

  res.status(statusCode).json({
    success: false,
    error: err.message || "Internal Server Error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
}

export default errorHandler;
