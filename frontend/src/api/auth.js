import { get, post } from "./client";

export const authApi = {
  status:       () => get("/api/auth/status"),
  connectGmail: (email, app_password) => post("/api/auth/connect", { email, app_password }),
  signOut:      () => post("/api/auth/signout"),
};
