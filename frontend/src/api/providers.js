import { get, post, del } from "./client";

export const providersApi = {
  list:         () => get("/api/providers"),
  models:       (pid) => get(`/api/providers/${pid}/models`),
  saveKey:      (provider_id, api_key) => post("/api/providers/key", { provider_id, api_key }),
  deleteKey:    (pid) => del(`/api/providers/key/${pid}`),
  test:         (provider_id, api_key) => post("/api/providers/test", { provider_id, api_key }),
  setActive:    (provider_id) => post("/api/providers/active", { provider_id }),
  setModel:     (provider_id, model) => post("/api/providers/model", { provider_id, model }),
};
