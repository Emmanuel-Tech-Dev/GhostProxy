import client from "./client";

export const getOverview = () => client.get("/api/analytics/overview");

export const getRequestsOverTime = (params) =>
  client.get("/api/analytics/requests-over-time", { params });

export const getByRoute = (params) =>
  client.get("/api/analytics/by-route", { params });

export const getStatusCodes = (params) =>
  client.get("/api/analytics/status-codes", { params });

export const getTopClients = (params) =>
  client.get("/api/analytics/top-clients", { params });

export const getRecentLogs = (params) =>
  client.get("/api/analytics/recent-logs", { params });
