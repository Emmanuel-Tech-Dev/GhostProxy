import { create } from "zustand";

const useAuthStore = create((set) => ({
  accessToken: null,
  user: null,
  isAuthenticated: false,
  theme: "dark",

  setAuth: (accessToken, user) =>
    set({
      accessToken,
      user,
      isAuthenticated: true,
    }),

  clearAuth: () =>
    set({
      accessToken: null,
      user: null,
      isAuthenticated: false,
    }),

  toggleTheme: () =>
    set((state) => ({
      theme: state.theme === "dark" ? "light" : "dark",
    })),
}));

export default useAuthStore;
