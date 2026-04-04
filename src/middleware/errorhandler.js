function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  // Map known error types to appropriate HTTP status codes.
  let statusCode = err.statusCode || err.status || 500;

  if (err.name === "TokenExpiredError") statusCode = 401;
  if (err.name === "JsonWebTokenError") statusCode = 401;
  if (err.name === "ValidationError") statusCode = 400;

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
