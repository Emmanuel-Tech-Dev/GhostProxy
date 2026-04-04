import axios from "axios";
import settings from "../config/settings";
import useAuthStore from "../store/authStore";

const client = axios.create({
  baseURL: settings.baseURL,
  withCredentials: true,
});

client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;

      try {
        const { data } = await axios.post(
          `${settings.baseURL}/auth/refresh`,
          {},
          { withCredentials: true },
        );

        useAuthStore.getState().setAuth(data.data.access_token, data.data.user);

        original.headers.Authorization = `Bearer ${data.data.access_token}`;
        return client(original);
      } catch {
        useAuthStore.getState().clearAuth();
        window.location.href = "/login";
      }
    }

    return Promise.reject(error);
  },
);

export default client;
