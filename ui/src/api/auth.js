import client from "./client";
import axios from "axios";
import settings from "../config/settings";

export const register = (data) => client.post("/auth/register", data);

export const login = (data) => client.post("/auth/login", data);

export const logout = () => client.post("/auth/logout");

export const getMe = () => client.get("/auth/me");

export const refresh = () =>
  axios.post(`${settings.baseURL}/auth/refresh`, {}, { withCredentials: true });
